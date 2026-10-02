import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fundingTestDatabase } from "../../test-support/funding-db.js";
import { resolveVerifiedCase } from "../reconciliation/cases.js";
import { claimLegacyMockPayment } from "./legacy.js";
import { applyPaymentEvidence } from "./receipts.js";
import { reserveRefund, confirmRefund } from "./refunds.js";
const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const fixture = fundingTestDatabase();
const { db } = fixture;
async function legacy() {
  const user = await db.user.create({ data: { wechatOpenid: `mock_${randomUUID()}` } });
  const restaurant = await db.restaurant.create({ data: { name: "测试餐厅", district: "测试区", businessArea: "测试区", address: "测试地址", contactName: "测试负责人", contactPhone: "13800138000", budgetCents: 9900, capacity: 6, cuisineTags: [] } });
  const activity = await db.activity.create({ data: { restaurantId: restaurant.id, title: "菜单体验", theme: "菜单体验", description: "菜单体验", district: "测试区", businessArea: "测试区", startsAt: new Date(), endsAt: new Date(), registrationEndsAt: new Date(), serviceFeeCents: 9900, mealFeePolicyText: "现场结算", capacity: 6 } });
  const order = await db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 9900, status: "CLOSED", agreementVersion: "v1" } });
  const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900, channel: "mock", resolutionState: "MANUAL" } });
  const { receipt } = await applyPaymentEvidence(db, { kind: "PAYMENT_SUCCEEDED", channel: "mock", merchantScope: "mock-local",
    merchantOrderNo: payment.merchantOrderNo, channelTradeNo: randomUUID(), amountCents: 9900, currency: "CNY", evidenceHash: "controlled-mock-proof" }, "test-owner");
  return { order, payment, receipt };
}
suite("legacy mock evidence rehearsal", () => {
  beforeAll(fixture.setup); afterAll(fixture.close);
  it("claims verified evidence idempotently without changing fulfillment or losing unknown refund budget", async () => {
    const data = await legacy();
    const refund = await db.refund.create({ data: { orderId: data.order.id, amountCents: 9900, status: "FAILED", resolutionState: "MANUAL", requestedBy: "fixture", reason: "fixture" } });
    const input = { paymentId: data.payment.id, receiptId: data.receipt.id, operator: "fixture-operator", reviewer: "fixture-reviewer" };
    const issue = await db.financialCase.findFirstOrThrow({ where: { sourceRef: data.receipt.id, category: "UNASSOCIATED_RECEIPT" } });
    const review = { caseId: issue.id, operator: "test-owner", reviewer: "independent-reviewer" };
    await expect(resolveVerifiedCase(db, review)).rejects.toThrow("terminal evidence");
    expect((await claimLegacyMockPayment(db, input)).paymentId).toBe(data.payment.id);
    await claimLegacyMockPayment(db, input);
    await expect(resolveVerifiedCase(db, { ...review, operator: "someone-else" })).rejects.toThrow("owner");
    expect((await resolveVerifiedCase(db, review)).state).toBe("RESOLVED");
    expect((await resolveVerifiedCase(db, review)).state).toBe("RESOLVED");
    expect(await db.auditLog.count({ where: { targetId: issue.id, action: "funding.case.resolve" } })).toBe(1);
    expect(await db.auditLog.count({ where: { targetId: data.payment.id, action: "funding.legacy.mock-claim" } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("CLOSED");
    const reserved = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(reserved.receiptId).toBe(data.receipt.id);
    expect(reserved.resolutionState).toBe("MANUAL");
    expect(await db.durableJob.count({ where: { refId: refund.id } })).toBe(0);
    await expect(db.$transaction(tx => reserveRefund(tx, refund.id, data.receipt.id))).rejects.toThrow("evidence review");
    const extra = await db.refund.create({ data: { orderId: data.order.id, amountCents: 1, requestedBy: "fixture", reason: "fixture" } });
    await expect(db.$transaction(tx => reserveRefund(tx, extra.id, data.receipt.id))).rejects.toThrow("budget");
  });
  it("verifies a historical successful refund only when its channel evidence arrives", async () => {
    const data = await legacy();
    const refund = await db.refund.create({ data: { orderId: data.order.id, amountCents: 9900, status: "SUCCEEDED", resolutionState: "MANUAL", requestedBy: "fixture", reason: "fixture" } });
    await claimLegacyMockPayment(db, { paymentId: data.payment.id, receiptId: data.receipt.id, operator: "test-owner", reviewer: "independent" });
    const issue = await db.financialCase.findFirstOrThrow({ where: { category: "LEGACY_REFUND_REQUIRES_EVIDENCE", sourceRef: refund.id } });
    const review = { caseId: issue.id, operator: "test-owner", reviewer: "independent" };
    await expect(resolveVerifiedCase(db, review)).rejects.toThrow("terminal evidence");
    const channelRefundNo = randomUUID();
    expect(await confirmRefund(db, { channel: "mock", merchantScope: "mock-local", merchantRefundNo: refund.merchantRefundNo,
      channelRefundNo, originalTradeNo: data.receipt.channelTradeNo, amountCents: 9900 }, "test-owner")).toBe(true);
    const verified = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(verified.resolutionState).toBe("CONFIRMED");
    expect(verified.channelRefundNo).toBe(channelRefundNo);
    expect((await resolveVerifiedCase(db, review)).state).toBe("RESOLVED");
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("CLOSED");
  });
  it("refuses mismatched evidence or over-reserved legacy refunds atomically", async () => {
    const data = await legacy();
    const other = await legacy();
    const input = { paymentId: data.payment.id, receiptId: data.receipt.id, operator: "one", reviewer: "two" };
    await expect(claimLegacyMockPayment(db, { ...input, receiptId: other.receipt.id })).rejects.toThrow("association");
    await expect(claimLegacyMockPayment(db, { ...input, reviewer: "one" })).rejects.toThrow("Independent");
    await db.refund.create({ data: { orderId: data.order.id, amountCents: 10000, status: "FAILED", resolutionState: "MANUAL", requestedBy: "fixture", reason: "fixture" } });
    await expect(claimLegacyMockPayment(db, input)).rejects.toThrow("budget");
    expect((await db.payment.findUniqueOrThrow({ where: { id: data.payment.id } })).merchantScope).toBe("legacy-unverified");
    expect((await db.channelReceipt.findUniqueOrThrow({ where: { id: data.receipt.id } })).paymentId).toBeNull();
  });
});
