import { z } from "zod";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import { enqueue, openCase } from "../jobs/queue.js";

export const paymentEvidenceSchema = z.object({
  kind: z.literal("PAYMENT_SUCCEEDED"), channel: z.enum(["mock", "wechat"]),
  merchantScope: z.string().min(1).max(160), merchantOrderNo: z.string().min(1).max(160),
  channelTradeNo: z.string().min(1).max(160), amountCents: z.number().int().positive().max(2_147_483_647),
  paidAt: z.string().datetime({ offset: true }).optional(),
  currency: z.literal("CNY"), evidenceHash: z.string().min(1).max(256),
}).strict();
export type PaymentEvidence = z.infer<typeof paymentEvidenceSchema>;

export async function lockOrder(tx: Prisma.TransactionClient, orderId: string) {
  const locator = await tx.order.findUniqueOrThrow({ where: { id: orderId }, select: { activityId: true, userId: true } });
  await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${locator.activityId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${locator.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${orderId} FOR UPDATE`;
  return tx.order.findUniqueOrThrow({ where: { id: orderId }, include: { activity: true } });
}

// Callers must supply verified, normalized channel evidence, never user form data.
export async function recordPayment(tx: Prisma.TransactionClient, input: PaymentEvidence, owner: string) {
  const evidence = paymentEvidenceSchema.parse(input);
  const locatedPayment = await tx.payment.findUnique({ where: { merchantOrderNo: evidence.merchantOrderNo } });
  const bound = locatedPayment && locatedPayment.channel === evidence.channel && locatedPayment.merchantScope === evidence.merchantScope;
  const order = bound ? await lockOrder(tx, locatedPayment.orderId) : null;
  const payment = bound ? await tx.payment.findUniqueOrThrow({ where: { id: locatedPayment.id } }) : null;
  const identity = { channel: evidence.channel, merchantScope: evidence.merchantScope, channelTradeNo: evidence.channelTradeNo };
  const key = `${evidence.channel}:${evidence.merchantScope}:${evidence.channelTradeNo}`;
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
  const existing = await tx.channelReceipt.findUnique({ where: { channel_merchantScope_channelTradeNo: identity } });
  if (existing) {
    if (existing.amountCents !== evidence.amountCents || existing.merchantOrderNo !== evidence.merchantOrderNo
      || (existing.paidAt && evidence.paidAt && existing.paidAt.getTime() !== new Date(evidence.paidAt).getTime())) {
      await openCase(tx, "RECEIPT_CONFLICT", existing.id, owner);
      return { receipt: existing, outcome: "conflict" as const };
    }
    return { receipt: existing, outcome: "duplicate" as const };
  }
  const paidAt = evidence.paidAt ? new Date(evidence.paidAt) : null;
  const prior = order ? await tx.channelReceipt.count({ where: { orderId: order.id } }) : 0;
  const receipt = await tx.channelReceipt.create({ data: {
    ...identity, merchantOrderNo: evidence.merchantOrderNo, amountCents: evidence.amountCents,
    currency: evidence.currency, evidenceHash: evidence.evidenceHash, verifiedAt: new Date(), paidAt,
    ...(bound && order && payment ? { paymentId: payment.id, orderId: order.id } : {}),
  } });
  if (!bound || !order || !payment) {
    await openCase(tx, "UNASSOCIATED_RECEIPT", receipt.id, owner);
    return { receipt, outcome: "manual" as const };
  }
  const amountMatches = payment.amountCents === evidence.amountCents;
  const canFulfill = prior === 0 && amountMatches && order.status === "PENDING_PAYMENT"
    && order.registrationActive && order.capacityHeld
    && ["PUBLISHED", "REGISTRATION_OPEN", "LOCKING"].includes(order.activity.status)
    && order.activity.startsAt > new Date()
    && (!order.inventoryLockedUntil || order.inventoryLockedUntil > (paidAt ?? new Date()));
  // A confirmed monetary fact is never overwritten by a late failed request.
  await tx.payment.update({ where: { id: payment.id }, data: {
    status: "SUCCEEDED", resolutionState: prior === 0 ? (amountMatches ? "CONFIRMED" : "MANUAL") : payment.resolutionState,
    version: { increment: 1 },
    ...(prior === 0 ? { channelTradeNo: evidence.channelTradeNo } : {}),
  } });
  if (canFulfill) {
    const updated = await tx.order.updateMany({ where: { id: order.id, status: "PENDING_PAYMENT" }, data: {
      status: "PAID_PENDING_GROUP", registrationActive: true, capacityHeld: true, version: { increment: 1 },
    } });
    if (updated.count !== 1) throw new Error("Order transition lost its lock");
  } else if (prior > 0 || ["CLOSED", "CANCELED", "REFUNDED", "PAYMENT_FAILED"].includes(order.status)) {
    const obligation = await tx.refundObligation.create({ data: {
      receiptId: receipt.id, orderId: order.id, businessKey: `receipt:${receipt.id}:full-refund`,
      cause: prior > 0 ? "EXTRA_RECEIPT" : "LATE_RECEIPT", amountCents: receipt.amountCents,
      owner, deadline: new Date(Date.now() + 86_400_000), policyVersion: "late-extra-full-v1",
    } });
    await enqueue(tx, "REFUND_OBLIGATION", `obligation:${obligation.id}`, obligation.id);
  } else {
    await openCase(tx, amountMatches ? "FULFILLMENT_REQUIRES_REVIEW" : "AMOUNT_CONFLICT", receipt.id, owner);
  }
  await tx.auditLog.create({ data: { action: "funding.receipt.recorded", targetType: "ChannelReceipt", targetId: receipt.id,
    metadata: { orderId: order.id, appliedToFulfillment: canFulfill } } });
  return { receipt, outcome: canFulfill ? "fulfilled" as const : "compensation" as const };
}
export async function applyPaymentEvidence(db: PrismaClient, input: PaymentEvidence, owner: string) {
  return db.$transaction(tx => recordPayment(tx, input, owner));
}
