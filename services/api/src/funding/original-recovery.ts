import { createHash } from "node:crypto";
import type { PrismaClient, Prisma } from "../generated/prisma/client.js";
import type { Lease } from "../jobs/queue.js";
import { openCase } from "../jobs/queue.js";
import { assertLease } from "../prelaunch/domain.js";
import { lockOrder, applyPaymentEvidence } from "./receipts.js";
import { confirmRefund } from "./refunds.js";
import { OriginalChannelRegistry } from "./original-channel.js";

export type LegacyAuthorization = (kind: "PAYMENT" | "REFUND", row: { id: string; amountCents: number; channel: string;
  merchantScope: string; providerConfigId: string }, action: "QUERY" | "SEND") => Promise<void>;

// This assembly accepts no new-payment or prepay operation. All terminal mutations
// go through existing monetary-evidence/state-machine helpers.
export function originalRecoveryHandlers(db: PrismaClient, registry: OriginalChannelRegistry, owner: string, authorize: LegacyAuthorization) {
  if (!owner.trim() || typeof authorize !== "function") throw Error("Original recovery authority required");
  async function paymentQuery(lease: Lease) {
    const payment = await db.payment.findUniqueOrThrow({ where: { id: lease.refId } });
    const channel = registry.resolve(payment);
    await authorize("PAYMENT", payment, "QUERY");
    await db.$transaction(tx => assertLease(tx, lease));
    if (["CONFIRMED", "CLOSED"].includes(payment.resolutionState)) return;
    if (payment.resolutionState === "MANUAL") throw Error("Historical payment requires evidence review");
    const fact = await channel.queryPayment({ ...payment, totalCents: payment.amountCents });
    if (fact.status !== "SUCCEEDED") throw Error("Original payment remains unresolved");
    await authorize("PAYMENT", payment, "QUERY");
    await db.$transaction(tx => assertLease(tx, lease));
    await applyPaymentEvidence(db, { kind: "PAYMENT_SUCCEEDED", channel: "wechat", merchantScope: payment.merchantScope,
      merchantOrderNo: payment.merchantOrderNo, channelTradeNo: fact.channelTradeNo!, amountCents: fact.amountCents,
      paidAt: fact.paidAt!, currency: "CNY", evidenceHash: createHash("sha256").update(JSON.stringify(fact)).digest("hex") }, owner);
  }
  async function validateRefund(tx: Prisma.TransactionClient, id: string, lease: Lease) {
    const initial = await tx.refund.findUniqueOrThrow({ where: { id } });
    await lockOrder(tx, initial.orderId);
    await assertLease(tx, lease);
    if (!initial.receiptId) throw Error("Original receipt missing");
    await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${initial.receiptId} FOR UPDATE`;
    const refund = await tx.refund.findUniqueOrThrow({ where: { id }, include: { receipt: { include: { payment: true } } } });
    registry.resolve(refund);
    await authorize("REFUND", refund, "QUERY");
    const receipt = refund.receipt!;
    const payment = receipt.payment;
    if (receipt.channel !== refund.channel || receipt.merchantScope !== refund.merchantScope || receipt.orderId !== refund.orderId
      || receipt.paymentId !== refund.paymentId || !payment || payment.providerConfigId !== refund.providerConfigId
      || payment.channel !== refund.channel || payment.merchantScope !== refund.merchantScope || payment.orderId !== refund.orderId
      || payment.merchantOrderNo !== receipt.merchantOrderNo || payment.amountCents !== receipt.amountCents
      || payment.resolutionState !== "CONFIRMED" || receipt.currency !== "CNY" || !receipt.paidAt
      || refund.amountCents <= 0 || refund.amountCents > receipt.amountCents) throw Error("Original refund receipt identity conflict");
    if (refund.resolutionState === "CONFIRMED") return refund;
    if (!["NEW", "UNKNOWN"].includes(refund.resolutionState) || !["REFUNDING", "FAILED"].includes(refund.status))
      throw Error("Refund requires approved recovery state");
    const total = await tx.refund.aggregate({ where: { receiptId: receipt.id,
      NOT: { status: "REJECTED", resolutionState: "REJECTED" } }, _sum: { amountCents: true } });
    if ((total._sum.amountCents ?? 0) > receipt.amountCents || await tx.refund.count({ where: {
      orderId: refund.orderId, receiptId: null, resolutionState: "MANUAL" } })) throw Error("Original refund budget unresolved");
    return refund;
  }
  async function refundRecovery(lease: Lease) {
    const initial = await db.$transaction(tx => validateRefund(tx, lease.refId, lease));
    if (initial.resolutionState === "CONFIRMED") return;
    const channel = registry.resolve(initial);
    const fact = await channel.queryRefund({ ...initial, originalTradeNo: initial.receipt!.channelTradeNo, totalCents: initial.amountCents });
    if (fact.status === "SUCCEEDED") {
      await db.$transaction(tx => validateRefund(tx, lease.refId, lease));
      if (!await confirmRefund(db, { channel: initial.channel, merchantScope: initial.merchantScope,
        merchantRefundNo: initial.merchantRefundNo, originalTradeNo: fact.originalTradeNo,
        channelRefundNo: fact.channelRefundNo, amountCents: fact.amountCents }, owner)) throw Error("Original refund evidence conflict");
      return;
    }
    if (fact.status !== "NOT_FOUND") throw Error("Original refund remains unresolved");
    const claimed = await db.$transaction(async tx => {
      const current = await validateRefund(tx, lease.refId, lease);
      if (current.resolutionState !== "NEW") {
        await openCase(tx, "LEGACY_REFUND_UNKNOWN_ABSENCE", current.id, owner);
        return null;
      }
      await authorize("REFUND", current, "SEND");
      return tx.refund.update({ where: { id: current.id }, data: { resolutionState: "UNKNOWN", version: { increment: 1 } } });
    });
    if (!claimed) throw Error("Unknown original refund requires evidence; resend forbidden");
    // Persist UNKNOWN before transport: crashes preserve the budget and forbid
    // re-sending even if a subsequent query returns NOT_FOUND.
    const beforeSend = async () => db.$transaction(async tx => {
      const current = await validateRefund(tx, claimed.id, lease);
      await authorize("REFUND", current, "SEND");
      if (current.version !== claimed.version || current.resolutionState !== "UNKNOWN"
        || current.merchantRefundNo !== claimed.merchantRefundNo || current.receiptId !== claimed.receiptId
        || current.amountCents !== claimed.amountCents) throw Error("Original refund dispatch authority changed");
    });
    await channel.submitRefund({ ...claimed, totalCents: claimed.amountCents, originalTradeNo: initial.receipt!.channelTradeNo,
      merchantOrderNo: initial.receipt!.merchantOrderNo, originalAmountCents: initial.receipt!.amountCents }, beforeSend);
    // Provider acknowledgement is not money arrival; retry must query evidence.
    throw Error("Original refund acknowledgement requires query confirmation");
  }
  return { RECOVER_PAYMENT: paymentQuery, RECOVER_REFUND: refundRecovery };
}
