import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { enqueue, openCase } from "../jobs/queue.js";
import { lockOrder } from "./receipts.js";
import { hasUnsettledFunding, markOrderState, releaseTerminalOrder } from "../orders/inventory.js";

// A failed/unknown channel response still consumes the budget until proven unaccepted.
export async function reserveRefund(tx: Prisma.TransactionClient, refundId: string, receiptId: string) {
  const original = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  await lockOrder(tx, original.orderId);
  await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id = ${receiptId} FOR UPDATE`;
  const receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: receiptId }, include: { payment: true } });
  const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
  if (refund.resolutionState === "MANUAL") throw Object.assign(new Error("Historical refund requires evidence review"), { statusCode: 409 });
  if (refund.receiptId) {
    if (refund.receiptId !== receipt.id) throw new Error("Refund original receipt conflict");
    if (refund.status === "FAILED" && refund.resolutionState !== "CONFIRMED") {
      const job = await tx.durableJob.findUnique({ where: { businessKey: `refund:${refund.id}` } });
      if (!job || ["MANUAL", "DONE"].includes(job.state)) {
        throw Object.assign(new Error("Refund recovery requires manual case review"), { statusCode: 409 });
      }
      return tx.refund.update({ where: { id: refund.id }, data: { status: "REFUNDING", version: { increment: 1 } } });
    }
    return refund;
  }
  if (refund.status !== "REVIEWING" || receipt.orderId !== refund.orderId || !receipt.payment
    || receipt.payment.providerConfigId === "legacy-unverified") throw new Error("Refund requires verified original payment binding");
  if (await tx.refund.count({ where: { orderId: refund.orderId, id: { not: refund.id }, receiptId: null,
    resolutionState: "MANUAL" } })) throw new Error("Unverified historical refunds still reserve this order budget");
  const reserved = await tx.refund.aggregate({ where: {
    receiptId: receipt.id,
    NOT: { status: "REJECTED", resolutionState: "REJECTED" },
  }, _sum: { amountCents: true } });
  if ((reserved._sum.amountCents ?? 0) + refund.amountCents > receipt.amountCents) throw new Error("Refund exceeds original receipt budget");
  const updated = await tx.refund.update({ where: { id: refund.id }, data: {
    receiptId: receipt.id, paymentId: receipt.payment.id, channel: receipt.channel,
    merchantScope: receipt.merchantScope, providerConfigId: receipt.payment.providerConfigId,
    status: "REFUNDING", resolutionState: "NEW", version: { increment: 1 },
  } });
  await enqueue(tx, "RECOVER_REFUND", `refund:${updated.id}`, updated.id);
  return updated;
}

export async function prepareObligation(db: PrismaClient, obligationId: string, owner: string) {
  return db.$transaction(async tx => {
    const initial = await tx.refundObligation.findUniqueOrThrow({ where: { id: obligationId } });
    if (!initial.orderId) {
      await openCase(tx, "UNASSOCIATED_REFUND_OBLIGATION", obligationId, owner);
      return null;
    }
    await lockOrder(tx, initial.orderId);
    await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id = ${initial.receiptId} FOR UPDATE`;
    const obligation = await tx.refundObligation.findUniqueOrThrow({ where: { id: obligationId }, include: { refund: true } });
    if (obligation.refund) return obligation.refund;
    const refund = await tx.refund.create({ data: {
      orderId: initial.orderId, obligationId, amountCents: obligation.amountCents,
      reason: obligation.cause, requestedBy: "SYSTEM", status: "REVIEWING",
    } });
    const reserved = await reserveRefund(tx, refund.id, obligation.receiptId);
    await tx.refundObligation.update({ where: { id: obligationId }, data: { state: "PROCESSING" } });
    return reserved;
  });
}

export async function recordRefund(tx: Prisma.TransactionClient, input: {
  merchantRefundNo: string; channel: string; merchantScope: string; channelRefundNo: string;
  originalTradeNo: string; amountCents: number;
}, owner: string) {
    const initial = await tx.refund.findUnique({ where: { merchantRefundNo: input.merchantRefundNo } });
    if (!initial || !initial.receiptId) {
      await openCase(tx, "UNASSOCIATED_REFUND", input.merchantRefundNo, owner);
      return false;
    }
    const order = await lockOrder(tx, initial.orderId);
    await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id = ${initial.receiptId} FOR UPDATE`;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: initial.id }, include: { receipt: true } });
    if (refund.channel !== input.channel || refund.merchantScope !== input.merchantScope
      || refund.receipt?.channelTradeNo !== input.originalTradeNo || refund.amountCents !== input.amountCents
      || (refund.channelRefundNo && refund.channelRefundNo !== input.channelRefundNo)) {
      await openCase(tx, "REFUND_FACT_CONFLICT", refund.id, owner);
      return false;
    }
    if (refund.status === "SUCCEEDED" && refund.resolutionState === "CONFIRMED") {
      if (order.status === "REFUNDED" && order.registrationActive) await releaseTerminalOrder(tx, order.id, "REFUNDED");
      return true;
    }
    await tx.refund.update({ where: { id: refund.id }, data: { status: "SUCCEEDED", resolutionState: "CONFIRMED",
      channelRefundNo: input.channelRefundNo, version: { increment: 1 } } });
    if (refund.obligationId) {
      await tx.refundObligation.update({ where: { id: refund.obligationId }, data: { state: "SATISFIED" } });
    }
    if (["REFUNDING", "REFUND_REVIEWING", "GROUP_FAILED", "CANCELED"].includes(order.status)
      && !(await hasUnsettledFunding(tx, order.id))) {
      await markOrderState(tx, order.id, "REFUNDED");
      await releaseTerminalOrder(tx, order.id, "REFUNDED");
    } else if (order.status === "REFUNDED" && order.registrationActive
      && !(await hasUnsettledFunding(tx, order.id))) {
      await releaseTerminalOrder(tx, order.id, "REFUNDED");
    } else if (!refund.obligationId && !["REFUNDING", "REFUND_REVIEWING", "GROUP_FAILED", "CANCELED"].includes(order.status)) {
      await openCase(tx, "REFUND_FULFILLMENT_REVIEW", refund.id, owner);
    }
    await tx.auditLog.create({ data: { action: "funding.refund.confirmed", targetType: "Refund", targetId: refund.id } });
    return true;
 }
export async function confirmRefund(db: PrismaClient, input: Parameters<typeof recordRefund>[1], owner: string) {
  return db.$transaction(tx => recordRefund(tx, input, owner));
}

export async function recordRefundFailure(db: PrismaClient, refundId: string, expectedVersion: number, reason: string) {
  return db.$transaction(async tx => {
    const initial = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    const order = await lockOrder(tx, initial.orderId);
    if (initial.receiptId) await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id = ${initial.receiptId} FOR UPDATE`;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id: refundId } });
    if (refund.version !== expectedVersion || refund.resolutionState === "CONFIRMED" || refund.status !== "REFUNDING") return refund;
    const updated = await tx.refund.update({ where: { id: refund.id }, data: {
      status: "FAILED", resolutionState: "UNKNOWN", version: { increment: 1 },
    } });
    if (!refund.obligationId && order.status === "REFUNDING") {
      await tx.order.updateMany({ where: { id: order.id, status: "REFUNDING" }, data: {
        status: "REFUND_REVIEWING", version: { increment: 1 },
      } });
    }
    await tx.auditLog.create({ data: { action: "refund.callback.failed", targetType: "Refund", targetId: refund.id,
      reason, metadata: { orderId: order.id, budgetStillReserved: true } } });
    return updated;
  });
}
