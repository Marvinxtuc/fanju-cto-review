import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import type { PaymentProvider } from "../providers.js";
import { applyPaymentEvidence, lockOrder } from "./receipts.js";

// Serialize parameter publication against both monetary updates and the retry exhaustion gate.
// Channel I/O is always outside this transaction. No queue path locks a payment after a job.
export async function publishPrepay(db: PrismaClient, paymentId: string, version: number,
  result?: { prepayId?: string; paymentParams?: unknown }) {
  return db.$transaction(async tx => {
    const initial = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const order = await lockOrder(tx, initial.orderId);
    await tx.$queryRaw`SELECT id FROM "Payment" WHERE id = ${paymentId} FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM "DurableJob" WHERE "businessKey" = ${`payment:${paymentId}`} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: paymentId } });
    const job = await tx.durableJob.findUnique({ where: { businessKey: `payment:${paymentId}` } });
    const requiresReview = payment.resolutionState === "MANUAL" || !job || job.state === "MANUAL";
    const blocked = requiresReview || payment.status !== "PENDING" || payment.resolutionState === "CLOSED"
      || order.status !== "PENDING_PAYMENT" || !order.registrationActive || !order.capacityHeld
      || !["PUBLISHED", "REGISTRATION_OPEN"].includes(order.activity.status)
      || order.activity.registrationEndsAt <= new Date()
      || !!(order.inventoryLockedUntil && order.inventoryLockedUntil <= new Date());
    if (blocked || payment.version !== version) return { payment, processing: false, requiresReview, payable: false };
    if (result?.prepayId) {
      const updated = await tx.payment.update({ where: { id: paymentId },
        data: { prepayId: result.prepayId, resolutionState: "UNKNOWN", version: { increment: 1 } } });
      return { payment: updated, processing: false, requiresReview: false, payable: true,
        ...(result.paymentParams ? { paymentParams: result.paymentParams } : {}) };
    }
    return { payment, processing: false, requiresReview: false, payable: true,
      ...(result?.paymentParams ? { paymentParams: result.paymentParams } : {}) };
  });
}

// Called only after the API has checked the current user's payment permission and original binding.
export async function recoverPrepay(db: PrismaClient, paymentId: string, provider: PaymentProvider, owner: string) {
  const { order, ...payment } = await db.payment.findUniqueOrThrow({ where: { id: paymentId }, include: { order: { include: { user: true } } } });
  if (provider.mode !== payment.channel) throw new Error("Original channel unavailable");
  const job = await db.durableJob.findUnique({ where: { businessKey: `payment:${payment.id}` } });
  if (payment.resolutionState === "MANUAL" || job?.state === "MANUAL") return { payment, processing: false, requiresReview: true };
  if (payment.resolutionState === "CONFIRMED" || payment.resolutionState === "CLOSED") return { payment, processing: false, requiresReview: false };
  if (!provider.queryPayment) return { payment, processing: false, requiresReview: true };
  try {
    const result = await provider.queryPayment(payment.merchantOrderNo);
    if (result.merchantOrderNo !== payment.merchantOrderNo || (result.status !== "NOT_FOUND" && result.currency !== "CNY")) throw new Error("Channel query conflict");
    if (result.status === "SUCCEEDED") {
      if (!result.channelTradeNo) throw new Error("Missing channel transaction");
      await applyPaymentEvidence(db, { kind: "PAYMENT_SUCCEEDED", channel: provider.mode, merchantScope: payment.merchantScope,
        merchantOrderNo: payment.merchantOrderNo, channelTradeNo: result.channelTradeNo, amountCents: result.amountCents,
        ...(result.paidAt ? { paidAt: result.paidAt } : {}), currency: "CNY", evidenceHash: createHash("sha256").update(JSON.stringify(result)).digest("hex") }, owner);
    } else if (result.status !== "NOT_FOUND" && result.amountCents !== payment.amountCents) {
      throw new Error("Channel query amount conflict");
    } else if (result.status === "CLOSED") {
      await db.$transaction(async tx => {
        await lockOrder(tx, payment.orderId);
        await tx.payment.updateMany({ where: { id: payment.id, version: payment.version, status: "PENDING" },
          data: { resolutionState: "CLOSED", version: { increment: 1 } } });
      });
    } else {
      const gate = await publishPrepay(db, payment.id, payment.version);
      if (!gate.payable) return gate;
      // A signed pending result permits obtaining parameters using the SAME merchant number.
      const created = await provider.createPayment({ merchantOrderNo: payment.merchantOrderNo, amountCents: payment.amountCents,
        openid: order.user.wechatOpenid });
      if (created.channel !== payment.channel || !created.prepayId) throw new Error("Channel prepayment recovery failed");
      return await publishPrepay(db, payment.id, payment.version, created);
    }
    const latest = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
    return { payment: latest, processing: false, requiresReview: latest.resolutionState === "MANUAL" };
  } catch (error) {
    await db.payment.updateMany({ where: { id: payment.id, version: payment.version, status: "PENDING" },
      data: { resolutionState: "UNKNOWN", version: { increment: 1 } } });
    throw error;
  }
}
