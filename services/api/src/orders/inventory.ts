import type { Prisma, PrismaClient, OrderStatus } from "../generated/prisma/client.js";
import { enqueue } from "../jobs/queue.js";
import { lockOrder } from "../funding/receipts.js";
import { PersistentMockChannel } from "../funding/mock-channel.js";
import { applyPaymentEvidence } from "../funding/receipts.js";
import { createHash } from "node:crypto";

type Tx = Prisma.TransactionClient;

// This is deliberately stricter than the visible order status. Unknown funds keep the slot.
export async function hasUnsettledFunding(tx: Tx, orderId: string): Promise<boolean> {
  const [payments, receipts, obligations, unboundRefunds] = await Promise.all([
    tx.payment.findMany({ where: { orderId }, select: { id: true, status: true, resolutionState: true } }),
    tx.channelReceipt.findMany({ where: { orderId }, select: { id: true, paymentId: true, amountCents: true } }),
    tx.refundObligation.findMany({ where: { orderId }, select: { state: true } }),
    tx.refund.findMany({ where: { orderId, receiptId: null }, select: { status: true, resolutionState: true } }),
  ]);
  if (payments.some(payment => payment.status === "PENDING" && payment.resolutionState !== "CLOSED")) return true;
  // A local success without its independent receipt cannot prove the money was settled.
  if (payments.some(payment => payment.status === "SUCCEEDED"
    && !receipts.some(receipt => receipt.paymentId === payment.id))) return true;
  if (obligations.some(obligation => obligation.state !== "SATISFIED")) return true;
  if (unboundRefunds.some(refund => refund.status !== "REJECTED" || refund.resolutionState !== "REJECTED")) return true;
  for (const receipt of receipts) {
    const refunds = await tx.refund.findMany({ where: { receiptId: receipt.id }, select: {
      amountCents: true, status: true, resolutionState: true } });
    if (refunds.some(refund => refund.status !== "SUCCEEDED" && refund.status !== "REJECTED")) return true;
    const paidBack = refunds.filter(refund => refund.status === "SUCCEEDED" && refund.resolutionState === "CONFIRMED")
      .reduce((total, refund) => total + refund.amountCents, 0);
    if (paidBack < receipt.amountCents) return true;
  }
  return false;
}

export async function releaseTerminalOrder(tx: Tx, orderId: string, status: "CLOSED" | "CANCELED" | "REFUNDED") {
  const order = await lockOrder(tx, orderId);
  if (await hasUnsettledFunding(tx, orderId)) return { released: false, order };
  const updated = await tx.order.update({ where: { id: orderId }, data: {
    status, registrationActive: false, capacityHeld: false, version: { increment: 1 },
  } });
  await tx.auditLog.create({ data: { action: "order.inventory.released", targetType: "Order", targetId: orderId,
    metadata: { fromStatus: order.status, toStatus: status } } });
  return { released: true, order: updated };
}

export async function markOrderState(tx: Tx, orderId: string, status: OrderStatus) {
  return tx.order.update({ where: { id: orderId }, data: {
    status, version: { increment: 1 },
    ...(["PAID_PENDING_GROUP", "GROUPED", "REFUND_REVIEWING", "REFUNDING", "COMPLETED"].includes(status)
      ? { registrationActive: true, capacityHeld: true } : {}),
  } });
}

// The caller holds the Activity/Order lock when creating the order.
export async function scheduleExpiration(tx: Tx, orderId: string, deadline: Date) {
  return enqueue(tx, "EXPIRE_ORDER", `expire:${orderId}`, orderId, deadline);
}

export async function expireOrder(db: PrismaClient, orderId: string, channel: PersistentMockChannel,
  owner: string, canceledByUser = false) {
  const snapshot = await db.$transaction(async tx => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "PENDING_PAYMENT") return { kind: "terminal" as const, order };
    if (!canceledByUser && order.inventoryLockedUntil && order.inventoryLockedUntil > new Date()) {
      return { kind: "early" as const, order };
    }
    const payment = await tx.payment.findFirst({ where: { orderId, active: true } });
    if (!payment) {
      const closed = await releaseTerminalOrder(tx, orderId, canceledByUser ? "CANCELED" : "CLOSED");
      if (!closed.released) throw new Error("Unsettled funds prevent inventory release");
      return { kind: "released" as const, order: closed.order };
    }
    return { kind: "payment" as const, order, payment };
  });
  if (snapshot.kind !== "payment") return snapshot;
  const { payment } = snapshot;
  if (payment.channel !== "mock") throw Object.assign(new Error("Original channel close unavailable"), { statusCode: 409 });
  channel.assertBinding(payment);
  const fact = await channel.closePayment(payment.merchantOrderNo, payment.amountCents);
  if (fact.status === "SUCCEEDED") {
    await applyPaymentEvidence(db, { kind: "PAYMENT_SUCCEEDED", channel: "mock", merchantScope: payment.merchantScope,
      merchantOrderNo: payment.merchantOrderNo, channelTradeNo: fact.channelNo, amountCents: fact.amountCents,
      paidAt: fact.createdAt.toISOString(), currency: "CNY", evidenceHash: createHash("sha256").update(fact.id).digest("hex") }, owner);
    return { kind: "paid" as const, order: await db.order.findUniqueOrThrow({ where: { id: orderId } }) };
  }
  return db.$transaction(async tx => {
    const order = await lockOrder(tx, orderId);
    if (order.status !== "PENDING_PAYMENT") return { kind: "terminal" as const, order };
    const current = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
    if (current.status !== "PENDING" || current.merchantOrderNo !== payment.merchantOrderNo) {
      return { kind: "unknown" as const, order };
    }
    await tx.payment.update({ where: { id: payment.id }, data: { resolutionState: "CLOSED", version: { increment: 1 } } });
    const closed = await releaseTerminalOrder(tx, orderId, canceledByUser ? "CANCELED" : "CLOSED");
    if (!closed.released) throw new Error("Unsettled funds prevent inventory release");
    return { kind: "released" as const, order: closed.order };
  });
}
