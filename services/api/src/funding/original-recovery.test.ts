import { randomUUID } from "node:crypto";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { fundingTestDatabase } from "../../test-support/funding-db.js";
import type { PaymentProvider, RefundProvider, ChannelRefundResult } from "../providers.js";
import { OriginalChannelRegistry } from "./original-channel.js";
import { LOCAL_MOCK_BINDING } from "./mock-channel.js";
import { originalRecoveryHandlers } from "./original-recovery.js";
import { applyPaymentEvidence } from "./receipts.js";
import { reserveRefund } from "./refunds.js";
import { runOne, claimJob } from "../jobs/queue.js";

const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const fixture = fundingTestDatabase(); const { db } = fixture;
function transport() {
  const env = { WECHAT_PAY_MCH_ID: "synthetic-old-merchant", WECHAT_MINIAPP_APP_ID: "synthetic-old-app", WECHAT_PAY_CONFIG_VERSION: "synthetic-old-config" };
  const originals = new Map<string, { trade: string; amount: number }>();
  const refunds = new Map<string, ChannelRefundResult>();
  let loseResponse = false;
  const queryPayment = vi.fn(async (merchantOrderNo: string) => {
    const p = originals.get(merchantOrderNo);
    return p ? { merchantOrderNo, status: "SUCCEEDED" as const, channelTradeNo: p.trade,
      amountCents: p.amount, currency: "CNY" as const, paidAt: new Date().toISOString() } : { merchantOrderNo, status: "NOT_FOUND" as const };
  });
  const queryRefund = vi.fn(async (merchantRefundNo: string) => refunds.get(merchantRefundNo) ?? { merchantRefundNo, status: "NOT_FOUND" as const });
  const createRefund = vi.fn(async (input: { merchantRefundNo: string; merchantOrderNo: string; amountCents: number }, guard?: () => Promise<void>) => {
    await guard?.();
    const original = originals.get(input.merchantOrderNo)!;
    refunds.set(input.merchantRefundNo, { merchantRefundNo: input.merchantRefundNo, status: "SUCCEEDED", originalTradeNo: original.trade,
      channelRefundNo: `synthetic-refund-${input.merchantRefundNo}`, amountCents: input.amountCents, currency: "CNY" });
    if (loseResponse) throw Error("Synthetic lost response");
    return { channel: "wechat", channelRefundNo: `synthetic-refund-${input.merchantRefundNo}` };
  });
  const payment = { mode: "wechat", queryPayment, closePayment: vi.fn(), createPayment: vi.fn() } as unknown as PaymentProvider;
  const refund = { mode: "wechat", queryRefund, createRefund } as unknown as RefundProvider;
  const registry = new OriginalChannelRegistry(); const binding = registry.registerWechat(env, payment, refund);
  return { registry, binding, originals, refunds, queryPayment, queryRefund, createRefund, lose: () => { loseResponse = true; } };
}
async function order(t: ReturnType<typeof transport>, paid = true) {
  const user = await db.user.create({ data: { wechatOpenid: `mock_${randomUUID()}` } });
  const restaurant = await db.restaurant.create({ data: { name: "合成餐厅", district: "测试区", businessArea: "测试区", address: "合成地址", contactName: "合成负责人", contactPhone: "13800138000", budgetCents: 100, capacity: 6 } });
  const activity = await db.activity.create({ data: { restaurantId: restaurant.id, title: "菜单体验", theme: "菜单体验", description: "菜单体验", district: "测试区", businessArea: "测试区",
    startsAt: new Date(), endsAt: new Date(), registrationEndsAt: new Date(), serviceFeeCents: 100, mealFeePolicyText: "现场结算", capacity: 6 } });
  const row = await db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 100, status: "CLOSED", agreementVersion: "synthetic-v1" } });
  const payment = await db.payment.create({ data: { orderId: row.id, ...t.binding, amountCents: 100 } });
  const trade = `synthetic-trade-${randomUUID()}`; t.originals.set(payment.merchantOrderNo, { trade, amount: 100 });
  if (!paid) {
    await db.durableJob.create({ data: { kind: "RECOVER_PAYMENT", businessKey: `payment:${payment.id}`, refId: payment.id, runAt: new Date(0) } });
    return { order: row, payment, refund: null };
  }
  const { receipt } = await applyPaymentEvidence(db, { kind: "PAYMENT_SUCCEEDED", merchantScope: t.binding.merchantScope, channel: "wechat", merchantOrderNo: payment.merchantOrderNo,
    channelTradeNo: trade, amountCents: 100, currency: "CNY", paidAt: new Date().toISOString(), evidenceHash: "synthetic-proof" }, "synthetic-owner");
  const request = await db.refund.create({ data: { orderId: row.id, amountCents: 100, requestedBy: "synthetic-owner", reason: "synthetic-refund" } });
  const refund = await db.$transaction(tx => reserveRefund(tx, request.id, receipt.id));
  await db.durableJob.update({ where: { businessKey: `refund:${refund.id}` }, data: { runAt: new Date(0) } });
  return { order: row, payment, refund };
}
suite("signed original-channel transport assembly on isolated legacy tables", () => {
  beforeAll(fixture.setup); afterAll(fixture.close);
  it("recovers a lost original-channel response through existing confirmation helper exactly once", async () => {
    const t = transport(), data = await order(t); t.lose();
    const handlers = originalRecoveryHandlers(db, t.registry, "synthetic-owner", async () => {});
    const scope = { ...t.binding, refIds: [data.refund!.id] };
    await runOne(db, "a", "synthetic-owner", handlers, ["RECOVER_REFUND"], scope);
    expect(t.createRefund).toHaveBeenCalledTimes(1);
    expect((await db.refund.findUniqueOrThrow({ where: { id: data.refund!.id } })).resolutionState).toBe("UNKNOWN");
    await db.durableJob.update({ where: { businessKey: `refund:${data.refund!.id}` }, data: { runAt: new Date(0) } });
    await runOne(db, "b", "synthetic-owner", handlers, ["RECOVER_REFUND"], scope);
    expect(t.createRefund).toHaveBeenCalledTimes(1);
    expect((await db.refund.findUniqueOrThrow({ where: { id: data.refund!.id } })).resolutionState).toBe("CONFIRMED");
    expect(await db.auditLog.count({ where: { targetId: data.refund!.id, action: "funding.refund.confirmed" } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("CLOSED");
  });
  it("keeps UNKNOWN + NOT_FOUND reserved and opens responsibility without re-send", async () => {
    const t = transport(), data = await order(t);
    await db.refund.update({ where: { id: data.refund!.id }, data: { resolutionState: "UNKNOWN" } });
    await runOne(db, "a", "synthetic-owner", originalRecoveryHandlers(db, t.registry, "synthetic-owner", async () => {}), ["RECOVER_REFUND"], { ...t.binding, refIds: [data.refund!.id] });
    expect(t.createRefund).not.toHaveBeenCalled();
    expect((await db.refund.findUniqueOrThrow({ where: { id: data.refund!.id } })).resolutionState).toBe("UNKNOWN");
    expect(await db.financialCase.count({ where: { category: "LEGACY_REFUND_UNKNOWN_ABSENCE", sourceRef: data.refund!.id } })).toBe(1);
  });
  it("claims only approved IDs and original merchant, leaving unrelated jobs untouched", async () => {
    const t = transport(), data = await order(t), unrelated = await order(t);
    const other = await order(t); await db.refund.update({ where: { id: other.refund!.id }, data: { merchantScope: "b".repeat(64) } });
    const lease = await claimJob(db, "a", ["RECOVER_REFUND"], { ...t.binding, refIds: [data.refund!.id, other.refund!.id] });
    expect(lease!.refId).toBe(data.refund!.id);
    for (const r of [unrelated.refund!, other.refund!]) {
      const job = await db.durableJob.findUniqueOrThrow({ where: { businessKey: `refund:${r.id}` } });
      expect(job.state).toBe("READY"); expect(job.attempts).toBe(0); expect(job.generation).toBe(0);
    }
  });
  it("missing original config and revoked grants have zero transport I/O", async () => {
    const t = transport(), data = await order(t);
    await runOne(db, "a", "synthetic-owner", originalRecoveryHandlers(db, new OriginalChannelRegistry(), "synthetic-owner", async () => {}), ["RECOVER_REFUND"], { ...t.binding, refIds: [data.refund!.id] });
    expect(t.queryRefund).not.toHaveBeenCalled(); expect(t.createRefund).not.toHaveBeenCalled();
    await db.durableJob.update({ where: { businessKey: `refund:${data.refund!.id}` }, data: { runAt: new Date(0) } });
    await runOne(db, "a", "synthetic-owner", originalRecoveryHandlers(db, t.registry, "synthetic-owner", async () => { throw Error("revoked"); }), ["RECOVER_REFUND"], { ...t.binding, refIds: [data.refund!.id] });
    expect(t.queryRefund).not.toHaveBeenCalled(); expect(t.createRefund).not.toHaveBeenCalled();
    expect((await db.refund.findUniqueOrThrow({ where: { id: data.refund!.id } })).resolutionState).toBe("NEW");
  });
  it("queries an original payment and applies evidence without initiating a new charge", async () => {
    const t = transport(), data = await order(t, false);
    const lease = await claimJob(db, "a", ["RECOVER_PAYMENT"], { ...t.binding, refIds: [data.payment.id] });
    await originalRecoveryHandlers(db, t.registry, "synthetic-owner", async () => {}).RECOVER_PAYMENT(lease!);
    expect((await db.payment.findUniqueOrThrow({ where: { id: data.payment.id } })).resolutionState).toBe("CONFIRMED");
    expect(t.createRefund).not.toHaveBeenCalled(); expect(t.queryPayment).toHaveBeenCalledTimes(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: data.order.id } })).status).toBe("CLOSED");
  });
  it("mock and original workers share the queue without stealing other channel jobs", async () => {
    const t = transport(), real = await order(t), mock = await order(t);
    await db.refund.update({ where: { id: mock.refund!.id }, data: LOCAL_MOCK_BINDING });
    const generic = await db.durableJob.create({ data: { kind: "DELIVER_INBOX", businessKey: randomUUID(), refId: "synthetic-notification", runAt: new Date(0) } });
    const scope = { ...LOCAL_MOCK_BINDING, scopedKinds: ["RECOVER_REFUND"] };
    const mockLease = await claimJob(db, "mock", ["RECOVER_REFUND", "DELIVER_INBOX"], scope);
    const inbox = await claimJob(db, "mock", ["RECOVER_REFUND", "DELIVER_INBOX"], scope);
    expect(new Set([mockLease!.refId, inbox!.refId])).toEqual(new Set([mock.refund!.id, generic.refId]));
    const unclaimed = await db.durableJob.findUniqueOrThrow({ where: { businessKey: `refund:${real.refund!.id}` } });
    expect(unclaimed.state).toBe("READY"); expect(unclaimed.attempts).toBe(0);
    const original = await claimJob(db, "original", ["RECOVER_REFUND"], { ...t.binding, refIds: [real.refund!.id] });
    expect(original!.refId).toBe(real.refund!.id);
  });
  it("lease expiry during channel query blocks dispatch before the side effect", async () => {
    const t = transport(), data = await order(t);
    const lease = (await claimJob(db, "old-worker", ["RECOVER_REFUND"], { ...t.binding, refIds: [data.refund!.id] }))!;
    t.queryRefund.mockImplementationOnce(async merchantRefundNo => {
      await db.durableJob.update({ where: { id: lease.id }, data: { leaseUntil: new Date(0) } });
      return { merchantRefundNo, status: "NOT_FOUND" };
    });
    await expect(originalRecoveryHandlers(db, t.registry, "synthetic-owner", async () => {}).RECOVER_REFUND(lease)).rejects.toThrow("STALE_WORKER_LEASE");
    expect(t.createRefund).not.toHaveBeenCalled();
    expect((await db.refund.findUniqueOrThrow({ where: { id: data.refund!.id } })).resolutionState).toBe("NEW");
  });
});
