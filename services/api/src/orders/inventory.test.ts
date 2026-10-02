import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fundingTestDatabase } from "../../test-support/funding-db.js";
import { LOCAL_MOCK_BINDING, PersistentMockChannel } from "../funding/mock-channel.js";
import { expireOrder, releaseTerminalOrder } from "./inventory.js";
import { scheduleExpiration } from "./inventory.js";
import { runOne } from "../jobs/queue.js";
import { confirmRefund } from "../funding/refunds.js";
import { ensurePaymentIntent } from "../funding/intents.js";

const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const fixture = fundingTestDatabase();
const { db } = fixture;
const channel = new PersistentMockChannel(db);

async function makeOrder() {
  const user = await db.user.create({ data: { wechatOpenid: `l1_${randomUUID()}` } });
  const restaurant = await db.restaurant.create({ data: { name: "测试餐厅", district: "测试区", businessArea: "测试区",
    address: "测试地址", contactName: "测试负责人", contactPhone: "13800138000", budgetCents: 9900,
    capacity: 6, cuisineTags: [] } });
  const activity = await db.activity.create({ data: { restaurantId: restaurant.id, title: "菜单体验", theme: "菜单体验",
    description: "菜单体验", district: "测试区", businessArea: "测试区", startsAt: new Date(Date.now() + 172800000),
    endsAt: new Date(Date.now() + 180000000), registrationEndsAt: new Date(Date.now() + 86400000),
    serviceFeeCents: 9900, mealFeePolicyText: "现场结算", capacity: 6, status: "REGISTRATION_OPEN" } });
  const order = await db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 9900,
    agreementVersion: "v1", inventoryLockedUntil: new Date(Date.now() - 1000) } });
  return { user, activity, order };
}

suite("L1 durable inventory and historical registration", () => {
  beforeAll(fixture.setup); afterAll(fixture.close);

  it("closes an expired order without a payment intent and retains a historical row", async () => {
    const { user, activity, order } = await makeOrder();
    const result = await expireOrder(db, order.id, channel, "local-review");
    expect(result.kind).toBe("released");
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "CLOSED", registrationActive: false, capacityHeld: false, version: 1,
    });
    const replacement = await db.order.create({ data: { userId: user.id, activityId: activity.id,
      amountCents: 9900, agreementVersion: "v1" } });
    expect(replacement.id).not.toBe(order.id);
    await expect(db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 9900,
      agreementVersion: "v1" } })).rejects.toThrow();
    expect(await db.order.count({ where: { userId: user.id, activityId: activity.id } })).toBe(2);
  });

  it("closes the original mock merchant number before releasing a slot", async () => {
    const { user, activity, order } = await makeOrder();
    // The API normally creates this before expiry; seed it to exercise the recovery race.
    const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900, ...LOCAL_MOCK_BINDING } });
    const result = await expireOrder(db, order.id, channel, "local-review");
    expect(result.kind).toBe("released");
    expect((await channel.query("PAYMENT", payment.merchantOrderNo))?.status).toBe("CLOSED");
    await expect(channel.pay(payment.merchantOrderNo, 9900)).rejects.toThrow("closed");
    expect(await db.channelReceipt.count({ where: { orderId: order.id } })).toBe(0);
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).resolutionState).toBe("CLOSED");
    await db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 9900, agreementVersion: "v1" } });
  });

  it("serializes first payment intent against canceling a pending registration", async () => {
    const { user, order } = await makeOrder();
    await db.order.update({ where: { id: order.id }, data: {
      inventoryLockedUntil: new Date(Date.now() + 60_000),
    } });
    const [intent, canceled] = await Promise.allSettled([
      ensurePaymentIntent(db, order.id, user.id, LOCAL_MOCK_BINDING),
      expireOrder(db, order.id, channel, "local-review", true),
    ]);
    expect(canceled.status).toBe("fulfilled");
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "CANCELED", registrationActive: false, capacityHeld: false,
    });
    const payments = await db.payment.findMany({ where: { orderId: order.id } });
    if (intent.status === "fulfilled") {
      expect(payments).toHaveLength(1);
      expect(payments[0]?.resolutionState).toBe("CLOSED");
      expect((await channel.query("PAYMENT", payments[0]!.merchantOrderNo))?.status).toBe("CLOSED");
      await expect(channel.pay(payments[0]!.merchantOrderNo, 9900)).rejects.toThrow("closed");
    } else {
      expect(payments).toHaveLength(0);
    }
  });

  it("keeps the slot when the original channel cannot confirm closure", async () => {
    const { order } = await makeOrder();
    const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900,
      ...LOCAL_MOCK_BINDING } });
    const unavailable = new PersistentMockChannel(db);
    unavailable.closePayment = async () => { throw new Error("Channel close timed out"); };
    await expect(expireOrder(db, order.id, unavailable, "local-review")).rejects.toThrow("timed out");
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "PENDING_PAYMENT", registrationActive: true, capacityHeld: true,
    });
    expect((await db.payment.findUniqueOrThrow({ where: { id: payment.id } })).resolutionState).toBe("NEW");
  });

  it("preserves a succeeded channel fact instead of closing it as unpaid", async () => {
    const { user, order } = await makeOrder();
    const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900, ...LOCAL_MOCK_BINDING } });
    const fact = await channel.pay(payment.merchantOrderNo, 9900);
    const result = await expireOrder(db, order.id, channel, "local-review");
    expect(result.kind).toBe("paid");
    expect((await channel.query("PAYMENT", payment.merchantOrderNo))?.status).toBe("SUCCEEDED");
    expect(await db.channelReceipt.count({ where: { orderId: order.id } })).toBe(1);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).registrationActive).toBe(true);
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).capacityHeld).toBe(true);
    expect(user.id).toBe(order.userId);
    expect(fact.channelNo).toBeTruthy();
  });

  it("keeps an unknown refund budget occupied until every original receipt is confirmed refunded", async () => {
    const { order } = await makeOrder();
    const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900,
      status: "SUCCEEDED", resolutionState: "CONFIRMED", ...LOCAL_MOCK_BINDING } });
    const receipt = await db.channelReceipt.create({ data: { channel: "mock", merchantScope: "mock-local",
      channelTradeNo: `mock_${randomUUID()}`, merchantOrderNo: payment.merchantOrderNo, paymentId: payment.id,
      orderId: order.id, amountCents: 9900, currency: "CNY", verifiedAt: new Date(), evidenceHash: "fixture" } });
    const refund = await db.refund.create({ data: { orderId: order.id, paymentId: payment.id, receiptId: receipt.id,
      amountCents: 9900, status: "FAILED", resolutionState: "UNKNOWN", reason: "fixture", requestedBy: "SYSTEM" } });
    expect((await db.$transaction(tx => releaseTerminalOrder(tx, order.id, "REFUNDED"))).released).toBe(false);
    await db.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED", resolutionState: "CONFIRMED" } });
    expect((await db.$transaction(tx => releaseTerminalOrder(tx, order.id, "REFUNDED"))).released).toBe(true);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "REFUNDED", registrationActive: false, capacityHeld: false,
    });
  });

  it("does not release a locally successful payment whose channel receipt is missing", async () => {
    const { order } = await makeOrder();
    await db.payment.create({ data: { orderId: order.id, amountCents: 9900,
      status: "SUCCEEDED", resolutionState: "CONFIRMED", ...LOCAL_MOCK_BINDING } });
    expect((await db.$transaction(tx => releaseTerminalOrder(tx, order.id, "CLOSED"))).released).toBe(false);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "PENDING_PAYMENT", registrationActive: true, capacityHeld: true,
    });
  });

  it("does not release a historical refund without a verified original receipt", async () => {
    const { order } = await makeOrder();
    await db.refund.create({ data: { orderId: order.id, amountCents: 9900,
      status: "FAILED", resolutionState: "MANUAL", reason: "historical", requestedBy: "SYSTEM" } });
    expect((await db.$transaction(tx => releaseTerminalOrder(tx, order.id, "CLOSED"))).released).toBe(false);
  });

  it("releases a refunded order when the last extra-receipt obligation is settled", async () => {
    const { order } = await makeOrder();
    const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900,
      status: "SUCCEEDED", resolutionState: "CONFIRMED", ...LOCAL_MOCK_BINDING } });
    const makeReceipt = async () => db.channelReceipt.create({ data: { channel: "mock", merchantScope: "mock-local",
      channelTradeNo: `mock_${randomUUID()}`, merchantOrderNo: payment.merchantOrderNo,
      paymentId: payment.id, orderId: order.id, amountCents: 9900, currency: "CNY",
      verifiedAt: new Date(), evidenceHash: "fixture" } });
    const original = await makeReceipt();
    const extra = await makeReceipt();
    const obligation = await db.refundObligation.create({ data: { receiptId: extra.id, orderId: order.id,
      businessKey: `fixture:${randomUUID()}`, cause: "EXTRA_RECEIPT", amountCents: 9900,
      state: "PROCESSING", owner: "local-review", deadline: new Date(Date.now() + 86_400_000), policyVersion: "test" } });
    await db.order.update({ where: { id: order.id }, data: { status: "REFUNDING" } });
    const makeRefund = async (receiptId: string, obligationId?: string) => db.refund.create({ data: {
      orderId: order.id, paymentId: payment.id, receiptId, ...(obligationId ? { obligationId } : {}),
      amountCents: 9900, status: "REFUNDING", resolutionState: "UNKNOWN", reason: "fixture",
      requestedBy: "SYSTEM", channel: "mock", merchantScope: "mock-local", providerConfigId: "mock-v1",
    } });
    const normalRefund = await makeRefund(original.id);
    const extraRefund = await makeRefund(extra.id, obligation.id);
    const confirm = async (refund: typeof normalRefund, tradeNo: string) => confirmRefund(db, {
      merchantRefundNo: refund.merchantRefundNo, channel: "mock", merchantScope: "mock-local",
      channelRefundNo: `mock_refund_${refund.id}`, originalTradeNo: tradeNo, amountCents: 9900,
    }, "local-review");
    expect(await confirm(normalRefund, original.channelTradeNo)).toBe(true);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "REFUNDING", registrationActive: true, capacityHeld: true,
    });
    expect(await confirm(extraRefund, extra.channelTradeNo)).toBe(true);
    expect(await db.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({
      status: "REFUNDED", registrationActive: false, capacityHeld: false,
    });
    expect((await db.refundObligation.findUniqueOrThrow({ where: { id: obligation.id } })).state).toBe("SATISFIED");
    expect(await confirm(extraRefund, extra.channelTradeNo)).toBe(true);
  });

  it("lets the durable worker close an expired order after a process restart", async () => {
    const { order } = await makeOrder();
    await db.$transaction(tx => scheduleExpiration(tx, order.id, order.inventoryLockedUntil!));
    expect(await runOne(db, "l1-worker-a", "local-review", {
      EXPIRE_ORDER: lease => expireOrder(db, lease.refId, channel, "local-review").then(() => {}),
    }, ["EXPIRE_ORDER"])).toBe(true);
    expect(await db.durableJob.findUniqueOrThrow({ where: { businessKey: `expire:${order.id}` } })).toMatchObject({ state: "DONE" });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).capacityHeld).toBe(false);
    expect((await expireOrder(db, order.id, channel, "local-review")).kind).toBe("terminal");
  });

  it("retries a task claimed before the order deadline instead of losing the expiration", async () => {
    const { order } = await makeOrder();
    await db.order.update({ where: { id: order.id }, data: { inventoryLockedUntil: new Date(Date.now() + 60_000) } });
    await db.$transaction(tx => scheduleExpiration(tx, order.id, new Date(Date.now() - 1000)));
    await runOne(db, "l1-worker-early", "local-review", { EXPIRE_ORDER: async lease => {
      const result = await expireOrder(db, lease.refId, channel, "local-review");
      if (result.kind === "early" || result.kind === "unknown") throw new Error("Retry after deadline");
    } }, ["EXPIRE_ORDER"]);
    expect(await db.durableJob.findUniqueOrThrow({ where: { businessKey: `expire:${order.id}` } })).toMatchObject({ state: "RETRY" });
    expect((await db.order.findUniqueOrThrow({ where: { id: order.id } })).capacityHeld).toBe(true);
  });

  it("settles concurrent channel success and expiry without releasing confirmed money", async () => {
    const { order } = await makeOrder();
    const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900, ...LOCAL_MOCK_BINDING } });
    const [charged, expired] = await Promise.allSettled([
      channel.pay(payment.merchantOrderNo, 9900), expireOrder(db, order.id, channel, "local-review"),
    ]);
    expect(expired.status).toBe("fulfilled");
    const fact = await channel.query("PAYMENT", payment.merchantOrderNo);
    const current = await db.order.findUniqueOrThrow({ where: { id: order.id } });
    if (charged.status === "fulfilled") {
      expect(fact?.status).toBe("SUCCEEDED");
      expect(await db.channelReceipt.count({ where: { orderId: order.id } })).toBe(1);
      expect(current.registrationActive).toBe(true);
    } else {
      expect(fact?.status).toBe("CLOSED");
      expect(current).toMatchObject({ status: "CLOSED", registrationActive: false, capacityHeld: false });
    }
  });
});
