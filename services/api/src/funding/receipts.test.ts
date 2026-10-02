import { runOne } from "../jobs/queue.js";
import { recoverPrepay, publishPrepay } from "./prepay.js";
import type { PaymentProvider } from "../providers.js";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fundingTestDatabase } from "../../test-support/funding-db.js";
import { applyPaymentEvidence, type PaymentEvidence } from "./receipts.js";
import { ensurePaymentIntent } from "./intents.js";
import { LOCAL_MOCK_BINDING } from "./mock-channel.js";
import { reconcileKnown } from "../reconciliation/service.js";
import { reserveRefund, prepareObligation, confirmRefund, recordRefundFailure } from "./refunds.js";
import { PersistentMockChannel } from "./mock-channel.js";
import { recoveryHandlers } from "./recovery.js";
import { persistTrustedEvent, applyEvent } from "../events/inbox.js";
import { currentCandidates } from "../orders/formation.js";
const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const fixture = fundingTestDatabase();
const { db } = fixture;
async function order(status: "PENDING_PAYMENT" | "CLOSED" = "PENDING_PAYMENT") {
  const user = await db.user.create({ data: { wechatOpenid: `mock_${randomUUID()}` } });
  const restaurant = await db.restaurant.create({ data: {
    name: "测试餐厅", district: "测试区域", businessArea: "测试区域", address: "测试地址",
    contactName: "测试负责人", contactPhone: "13800138000", budgetCents: 10000, capacity: 20, cuisineTags: [],
  } });
  const activity = await db.activity.create({ data: {
    restaurantId: restaurant.id, title: "菜单体验", theme: "菜单体验", description: "菜单体验",
    district: "测试区域", businessArea: "测试区域", startsAt: new Date(Date.now() + 172_800_000),
    endsAt: new Date(Date.now() + 180_000_000), registrationEndsAt: new Date(Date.now() + 86_400_000),
    serviceFeeCents: 9900, mealFeePolicyText: "餐费现场结算", capacity: 20, status: "REGISTRATION_OPEN",
  } });
  const order = await db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 9900, status, agreementVersion: "v1" } });
  const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900, channel: "mock", merchantScope: "mock-local", providerConfigId: "mock-v1" } });
  const evidence: PaymentEvidence = { kind: "PAYMENT_SUCCEEDED", channel: "mock", merchantScope: "mock-local", merchantOrderNo: payment.merchantOrderNo, channelTradeNo: randomUUID(), amountCents: 9900, currency: "CNY", evidenceHash: "fixture-evidence" };
  return { order, payment, evidence };
}
suite("independent monetary facts and event recovery", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.close);
  it("reuses one merchant number across twenty payment attempts and rejects a channel switch", async () => {
    const data = await order();
    // Remove the unused fixture intent to exercise concurrent creation, in this disposable test schema only.
    await db.payment.delete({ where: { id: data.payment.id } });
    const results = await Promise.all(Array.from({ length: 20 }, () => ensurePaymentIntent(db, data.order.id, data.order.userId, LOCAL_MOCK_BINDING)));
    expect(new Set(results.map(r => r.payment.merchantOrderNo)).size).toBe(1);
    expect(await db.payment.count({ where: { orderId: data.order.id } })).toBe(1);
    await expect(ensurePaymentIntent(db, data.order.id, data.order.userId, { ...LOCAL_MOCK_BINDING, providerConfigId: "other" })).rejects.toThrow("unavailable");
  });
  it("recovers lost prepayment persistence using the original number and stops at manual review", async () => {
    const data = await order();
    await ensurePaymentIntent(db, data.order.id, data.order.userId, LOCAL_MOCK_BINDING);
    const calls: string[] = [];
    const provider: PaymentProvider = { mode: "mock", queryPayment: async merchantOrderNo => ({ merchantOrderNo, status: "NOT_FOUND" }),
      createPayment: async input => { calls.push(input.merchantOrderNo); return { channel: "mock", prepayId: "recovered-prepay" }; },
      applySuccessCallback: async () => ({ channelTradeNo: "unused", callbackNonce: "unused" }) };
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_test_prepay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."prepayId" IS NOT NULL THEN RAISE EXCEPTION 'injected prepay persistence failure'; END IF; RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_test_prepay BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION reject_test_prepay()`);
    try {
      await expect(recoverPrepay(db, data.payment.id, provider, "local-review")).rejects.toThrow();
      expect((await db.payment.findUniqueOrThrow({ where: { id: data.payment.id } })).resolutionState).toBe("UNKNOWN");
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER reject_test_prepay ON "Payment"`);
      await db.$executeRawUnsafe(`DROP FUNCTION reject_test_prepay()`);
    }
    const recovered = await recoverPrepay(db, data.payment.id, provider, "local-review");
    expect(recovered.payment.prepayId).toBe("recovered-prepay");
    expect(calls).toEqual([data.payment.merchantOrderNo, data.payment.merchantOrderNo]);
    expect(await db.payment.count({ where: { orderId: data.order.id } })).toBe(1);
    await db.durableJob.update({ where: { businessKey: `payment:${data.payment.id}` }, data: { state: "MANUAL", attempts: 8 } });
    const manual = await recoverPrepay(db, data.payment.id, provider, "local-review");
    expect(manual.processing).toBe(false);expect(manual.requiresReview).toBe(true);
    expect("order" in manual.payment).toBe(false);
    expect(calls).toHaveLength(2);
  });
  it("suppresses existing and delayed prepay parameters after manual escalation", async () => {
    const data = await order();
    await ensurePaymentIntent(db, data.order.id, data.order.userId, LOCAL_MOCK_BINDING);
    const provider: PaymentProvider = { mode: "mock",
      queryPayment: async merchantOrderNo => ({ merchantOrderNo, status: "PENDING", amountCents: 9900, currency: "CNY" }),
      createPayment: async () => {
        await db.durableJob.update({ where: { businessKey: `payment:${data.payment.id}` }, data: { state: "MANUAL", attempts: 8 } });
        return { channel: "mock", prepayId: "late-params" };
      }, applySuccessCallback: async () => ({ channelTradeNo: "unused", callbackNonce: "unused" }) };
    const late = await recoverPrepay(db, data.payment.id, provider, "local-review");
    expect(late.requiresReview).toBe(true);
    expect("paymentParams" in late).toBe(false);
    expect(late.payment.prepayId).toBeNull();
    await db.payment.update({ where: { id: data.payment.id }, data: { prepayId: "previous-params" } });
    const existing = await publishPrepay(db, data.payment.id, data.payment.version, { paymentParams: { package: "previous-params" } });
    expect(existing.requiresReview).toBe(true);
    expect("paymentParams" in existing).toBe(false);
  });
  it("records a trusted successful query with a conflicting amount without fulfilling the order", async () => {
    const data = await order();
    await ensurePaymentIntent(db, data.order.id, data.order.userId, LOCAL_MOCK_BINDING);
    const provider: PaymentProvider = { mode: "mock", queryPayment: async merchantOrderNo => ({ merchantOrderNo,
      status: "SUCCEEDED", amountCents: 10000, currency: "CNY", channelTradeNo: randomUUID(), paidAt: new Date().toISOString() }),
      createPayment: async () => { throw new Error("Must not create another payment"); },
      applySuccessCallback: async () => ({ channelTradeNo: "unused", callbackNonce: "unused" }) };
    const result = await recoverPrepay(db, data.payment.id, provider, "local-review");
    expect(result.requiresReview).toBe(true);
    expect(result.payment.resolutionState).toBe("MANUAL");
    const receipt = await db.channelReceipt.findFirstOrThrow({ where: { paymentId: data.payment.id } });
    expect(receipt.amountCents).toBe(10000);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("PENDING_PAYMENT");
    expect(await db.financialCase.count({ where: { category: "AMOUNT_CONFLICT", sourceRef: receipt.id } })).toBe(1);
  });
  it("records exactly one receipt under twenty concurrent confirmations", async () => {
    const data = await order();
    const results = await Promise.all(Array.from({ length: 20 }, () => applyPaymentEvidence(db, data.evidence, "local-review")));
    expect(results.filter(r => r.outcome === "fulfilled")).toHaveLength(1);
    expect(await db.channelReceipt.count({ where: { orderId: data.order.id } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("PAID_PENDING_GROUP");
  });
  it("keeps late money after CLOSED and creates full refund duty without resurrection", async () => {
    const data = await order("CLOSED");
    const result = await applyPaymentEvidence(db, data.evidence, "local-review");
    expect(result.receipt.amountCents).toBe(9900);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("CLOSED");
    const duty = await db.refundObligation.findFirstOrThrow({ where: { receiptId: result.receipt.id } });
    expect(duty.amountCents).toBe(9900);
    expect(duty.cause).toBe("LATE_RECEIPT");
    expect(await db.durableJob.count({ where: { refId: duty.id } })).toBe(1);
  });
  it("uses verified payment time when inbox consumption happens after the inventory deadline", async () => {
    const data = await order();
    const deadline = new Date(Date.now() - 1000);
    const paidAt = new Date(deadline.getTime() - 2000).toISOString();
    await db.order.update({ where: { id: data.order.id }, data: { createdAt: new Date(deadline.getTime() - 900000), inventoryLockedUntil: deadline } });
    const event = await persistTrustedEvent(db, { source: "timely-callback", eventKey: randomUUID(), verificationMaterialId: "fixture",
      evidence: { ...data.evidence, paidAt } }, "local-review");
    await db.receivedEvent.update({ where: { id: event.event.id }, data: { verifiedAt: new Date(paidAt) } });
    await applyEvent(db, event.event.id, "local-review");
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("PAID_PENDING_GROUP");
    const receipt = await db.channelReceipt.findFirstOrThrow({ where: { orderId: data.order.id } });
    expect(receipt.paidAt?.toISOString()).toBe(paidAt);
    await expect(db.channelReceipt.update({ where: { id: receipt.id }, data: { paidAt: new Date() } })).rejects.toThrow("immutable");
    const closed = await order("CLOSED");
    await db.order.update({ where: { id: closed.order.id }, data: { inventoryLockedUntil: deadline } });
    const result = await applyPaymentEvidence(db, { ...closed.evidence, paidAt }, "local-review");
    expect((await db.order.findUniqueOrThrow({ where: { id: closed.order.id } })).status).toBe("CLOSED");
    expect(await db.refundObligation.count({ where: { receiptId: result.receipt.id } })).toBe(1);
    const late = await order();
    await db.order.update({ where: { id: late.order.id }, data: { inventoryLockedUntil: deadline } });
    await applyPaymentEvidence(db, { ...late.evidence, paidAt: new Date().toISOString() }, "local-review");
    expect((await db.order.findUniqueOrThrow({ where: { id: late.order.id } })).status).toBe("PENDING_PAYMENT");
    expect(await db.financialCase.count({ where: { category: "FULFILLMENT_REQUIRES_REVIEW" } })).toBeGreaterThan(0);
  });
  it("retains a second actual collection and its own refund obligation", async () => {
    const data = await order();
    await applyPaymentEvidence(db, data.evidence, "local-review");
    const second = await applyPaymentEvidence(db, { ...data.evidence, channelTradeNo: randomUUID() }, "local-review");
    expect(await db.channelReceipt.count({ where: { orderId: data.order.id } })).toBe(2);
    expect((await db.refundObligation.findFirstOrThrow({ where: { receiptId: second.receipt.id } })).cause).toBe("EXTRA_RECEIPT");
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("PAID_PENDING_GROUP");
  });
  it("keeps the primary payment confirmed when an extra collection has a different amount", async () => {
    const data = await order();
    await applyPaymentEvidence(db, data.evidence, "local-review");
    const extra = await applyPaymentEvidence(db, { ...data.evidence,
      channelTradeNo: randomUUID(), amountCents: 10000 }, "local-review");
    expect((await db.payment.findUniqueOrThrow({ where: { id: data.payment.id } })).resolutionState).toBe("CONFIRMED");
    expect((await db.$transaction(tx => currentCandidates(tx, data.order.activityId))).map(candidate => candidate.id))
      .toContain(data.order.id);
    expect((await db.refundObligation.findFirstOrThrow({ where: { receiptId: extra.receipt.id } })).amountCents).toBe(10000);
  });
  it("preserves unassociated receipts, rejects conflicting facts and prevents mutation", async () => {
    const data = await order();
    const result = await applyPaymentEvidence(db, { ...data.evidence, merchantOrderNo: randomUUID() }, "local-review");
    expect(result.receipt.orderId).toBeNull();
    expect(await db.financialCase.count({ where: { sourceRef: result.receipt.id } })).toBe(1);
    await expect(db.channelReceipt.update({ where: { id: result.receipt.id }, data: { amountCents: 1 } })).rejects.toThrow();
    const conflict = await applyPaymentEvidence(db, { ...data.evidence, channelTradeNo: result.receipt.channelTradeNo, amountCents: 1 }, "local-review");
    expect(conflict.outcome).toBe("conflict");
  });
  it("serializes competing refund reservations and keeps unknown amounts reserved", async () => {
    const data = await order();
    const { receipt } = await applyPaymentEvidence(db, data.evidence, "local-review");
    const requests = await Promise.all(Array.from({ length: 20 }, () => db.refund.create({ data: {
      orderId: data.order.id, amountCents: 9900, reason: "测试退款", requestedBy: "TEST",
    } })));
    const results = await Promise.allSettled(requests.map(r => db.$transaction(tx => reserveRefund(tx, r.id, receipt.id))));
    expect(results.filter(r => r.status === "fulfilled")).toHaveLength(1);
    const reserved = await db.refund.findFirstOrThrow({ where: { receiptId: receipt.id } });
    await db.refund.update({ where: { id: reserved.id }, data: { status: "FAILED", resolutionState: "UNKNOWN" } });
    const other = requests.find(r => r.id !== reserved.id)!;
    await expect(db.$transaction(tx => reserveRefund(tx, other.id, receipt.id))).rejects.toThrow("budget");
  });
  it("recovers channel acceptance after a lost response without a second refund", async () => {
    const data = await order("CLOSED");
    const channel = new PersistentMockChannel(db);
    const paid = await channel.pay(data.payment.merchantOrderNo, data.payment.amountCents);
    const { receipt } = await applyPaymentEvidence(db, { ...data.evidence, channelTradeNo: paid.channelNo }, "local-review");
    const duty = await db.refundObligation.findFirstOrThrow({ where: { receiptId: receipt.id } });
    const refund = (await prepareObligation(db, duty.id, "local-review"))!;
    const accepted = await channel.refund(refund.merchantRefundNo, paid.channelNo, refund.amountCents);
    // Channel accepted, process lost the response before updating the local refund.
    expect((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("REFUNDING");
    await recoveryHandlers(db, channel, "local-review").RECOVER_REFUND({ refId: refund.id });
    await recoveryHandlers(db, channel, "local-review").RECOVER_REFUND({ refId: refund.id });
    expect(await db.mockChannelTransaction.count({ where: { originalTradeNo: paid.channelNo } })).toBe(1);
    expect((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).channelRefundNo).toBe(accepted.channelNo);
    expect((await db.refundObligation.findUniqueOrThrow({ where: { id: duty.id } })).state).toBe("SATISFIED");
    const staleFailure = await recordRefundFailure(db, refund.id, refund.version, "delayed failure");
    expect(staleFailure.status).toBe("SUCCEEDED");
    expect(staleFailure.resolutionState).toBe("CONFIRMED");
    await reconcileKnown(db, "mock-local", async (_binding, kind, merchantNo) => {
      const known = await channel.query(kind, merchantNo);
      return known ? { ...known, ...(kind === "REFUND" ? { channelNo: "wrong-refund-reference" } : {}) } : null;
    }, "local-review");
    expect(await db.financialCase.count({ where: { category: "REFUND_FACT_CONFLICT", sourceRef: refund.id } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("CLOSED");
    await expect(recoveryHandlers(db, new PersistentMockChannel(db), "local-review").RECOVER_PAYMENT({ refId: "missing" })).rejects.toThrow();
    expect(() => channel.assertBinding({ channel: "wechat", merchantScope: "elsewhere", providerConfigId: "unknown" })).toThrow("unavailable");
  });
  it("keeps one refund effect when paused worker A returns after expired lease takeover B", async () => {
    const data = await order("CLOSED");
    const channel = new PersistentMockChannel(db);
    const paid = await channel.pay(data.payment.merchantOrderNo, data.payment.amountCents);
    const { receipt } = await applyPaymentEvidence(db, { ...data.evidence, channelTradeNo: paid.channelNo }, "local-review");
    const obligation = await db.refundObligation.findFirstOrThrow({ where: { receiptId: receipt.id } });
    const refund = (await prepareObligation(db, obligation.id, "local-review"))!;
    const job = await db.durableJob.update({ where: { businessKey: `refund:${refund.id}` }, data: { kind: "REFUND_RACE_TEST", runAt: new Date(0) } });
    let release!: () => void;
    let accepted!: () => void;
    const paused = new Promise<void>(resolve => { release = resolve; });
    const reachedChannel = new Promise<void>(resolve => { accepted = resolve; });
    class PausedChannel extends PersistentMockChannel {
      override async refund(merchantNo: string, trade: string, amount: number) {
        const result = await super.refund(merchantNo, trade, amount);
        accepted();await paused;return result;
      }
    }
    const a = runOne(db, "worker-a", "local-review", {
      REFUND_RACE_TEST: recoveryHandlers(db, new PausedChannel(db), "local-review").RECOVER_REFUND,
    }, ["REFUND_RACE_TEST"]);
    try {
      await Promise.race([reachedChannel, a.then(() => { throw new Error("Worker A exited before reaching the channel barrier"); })]);
      await db.durableJob.update({ where: { id: job.id }, data: { leaseUntil: new Date(0) } });
      await runOne(db, "worker-b", "local-review", { REFUND_RACE_TEST: recoveryHandlers(db, channel, "local-review").RECOVER_REFUND }, ["REFUND_RACE_TEST"]);
      expect((await db.durableJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("DONE");
    } finally { release();await a; }
    expect(await db.mockChannelTransaction.count({ where: { originalTradeNo: paid.channelNo } })).toBe(1);
    expect((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).resolutionState).toBe("CONFIRMED");
    expect((await db.durableJob.findUniqueOrThrow({ where: { id: job.id } })).generation).toBe(2);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("CLOSED");
  });
  it("rejects a queried refund for a different original trade even when the amount matches", async () => {
    const data = await order("CLOSED");
    const channel = new PersistentMockChannel(db);
    const paid = await channel.pay(data.payment.merchantOrderNo, data.payment.amountCents);
    const { receipt } = await applyPaymentEvidence(db, { ...data.evidence, channelTradeNo: paid.channelNo }, "local-review");
    const obligation = await db.refundObligation.findFirstOrThrow({ where: { receiptId: receipt.id } });
    const refund = (await prepareObligation(db, obligation.id, "local-review"))!;
    const otherPaid = await channel.pay(randomUUID(), refund.amountCents);
    await channel.refund(refund.merchantRefundNo, otherPaid.channelNo, refund.amountCents);
    await expect(recoveryHandlers(db, channel, "local-review").RECOVER_REFUND({ refId: refund.id })).rejects.toThrow("original transaction conflict");
    const saved = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
    expect(saved.resolutionState).toBe("UNKNOWN");
    expect(saved.channelRefundNo).toBeNull();
    expect((await db.refundObligation.findUniqueOrThrow({ where: { id: obligation.id } })).state).toBe("PROCESSING");
    expect(await db.financialCase.count({ where: { category: "REFUND_FACT_CONFLICT", sourceRef: refund.id } })).toBe(1);
  });
  it("converges an approved refund after failure and rejects reapproval of exhausted jobs", async () => {
    const data = await order();
    const { receipt } = await applyPaymentEvidence(db, data.evidence, "local-review");
    const request = await db.refund.create({ data: { orderId: data.order.id, amountCents: 9900, reason: "测试退款", requestedBy: "TEST" } });
    const reserved = await db.$transaction(tx => reserveRefund(tx, request.id, receipt.id));
    await db.order.update({ where: { id: data.order.id }, data: { status: "REFUNDING" } });
    await recordRefundFailure(db, reserved.id, reserved.version, "fixture failure");
    await db.durableJob.update({ where: { businessKey: `refund:${reserved.id}` }, data: { state: "MANUAL", attempts: 8 } });
    await expect(db.$transaction(tx => reserveRefund(tx, reserved.id, receipt.id))).rejects.toThrow("manual case");
    expect((await db.refund.findUniqueOrThrow({ where: { id: reserved.id } })).status).toBe("FAILED");
    expect(await confirmRefund(db, { merchantRefundNo: reserved.merchantRefundNo, channel: "mock", merchantScope: "mock-local",
      channelRefundNo: randomUUID(), originalTradeNo: receipt.channelTradeNo, amountCents: 9900 }, "local-review")).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("REFUNDED");
  });
  it("never applies a refund fact belonging to another receipt", async () => {
    const data = await order("CLOSED");
    const { receipt } = await applyPaymentEvidence(db, data.evidence, "local-review");
    const duty = await db.refundObligation.findFirstOrThrow({ where: { receiptId: receipt.id } });
    const refund = (await prepareObligation(db, duty.id, "local-review"))!;
    expect(await confirmRefund(db, { merchantRefundNo: refund.merchantRefundNo, channel: "mock", merchantScope: "mock-local", channelRefundNo: randomUUID(), originalTradeNo: "wrong", amountCents: 9900 }, "local-review")).toBe(false);
    expect((await db.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("REFUNDING");
  });
  it("does not acknowledge persistence when the recovery job cannot commit", async () => {
    const data = await order();
    const eventKey = randomUUID();
    await db.$executeRawUnsafe(`CREATE FUNCTION reject_test_job() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected storage failure'; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER reject_test_job BEFORE INSERT ON "DurableJob" FOR EACH ROW EXECUTE FUNCTION reject_test_job()`);
    try {
      await expect(persistTrustedEvent(db, { source: "mock-callback", eventKey, verificationMaterialId: "fixture", evidence: data.evidence }, "local-review")).rejects.toThrow();
      expect(await db.receivedEvent.count({ where: { eventKey } })).toBe(0);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER reject_test_job ON "DurableJob"`);
      await db.$executeRawUnsafe(`DROP FUNCTION reject_test_job()`);
    }
  });
  it("commits event and recovery job together and applies after a reconnect", async () => {
    const data = await order();
    const trusted = { source: "mock-callback", eventKey: randomUUID(), verificationMaterialId: "mock-fixture-v1", evidence: data.evidence };
    const saved = await persistTrustedEvent(db, trusted, "local-review");
    expect(await db.channelReceipt.count({ where: { orderId: data.order.id } })).toBe(0);
    expect(await db.durableJob.count({ where: { refId: saved.event.id } })).toBe(1);
    await db.$disconnect();
    await applyEvent(db, saved.event.id, "local-review");
    await applyPaymentEvidence(db, { ...data.evidence, evidenceHash: "query-evidence" }, "local-review");
    expect(await db.channelReceipt.count({ where: { orderId: data.order.id } })).toBe(1);
    expect((await persistTrustedEvent(db, trusted, "local-review")).event.id).toBe(saved.event.id);
    expect((await persistTrustedEvent(db, { ...trusted, evidence: { ...data.evidence, amountCents: 1 } }, "local-review")).conflict).toBe(true);
    expect((await db.receivedEvent.findUniqueOrThrow({ where: { id: saved.event.id } })).state).toBe("APPLIED");
  });
});
