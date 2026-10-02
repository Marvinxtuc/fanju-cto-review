import { openCase } from "../jobs/queue.js";
import { createHash } from "node:crypto";
import type { PrismaClient } from "../generated/prisma/client.js";
import { applyPaymentEvidence } from "./receipts.js";
import { confirmRefund } from "./refunds.js";
import { PersistentMockChannel } from "./mock-channel.js";

export function recoveryHandlers(db: PrismaClient, channel: PersistentMockChannel, owner: string) {
  return {
    RECOVER_PAYMENT: async (lease: { refId: string }) => {
      const payment = await db.payment.findUniqueOrThrow({ where: { id: lease.refId } });
      if (payment.resolutionState === "CONFIRMED" || payment.resolutionState === "CLOSED") return;
      channel.assertBinding(payment);
      // Every retry queries the immutable merchant number before any side effect.
      const fact = await channel.query("PAYMENT", payment.merchantOrderNo);
      if (!fact || fact.status !== "SUCCEEDED") throw new Error("Payment still unknown");
      await applyPaymentEvidence(db, { kind: "PAYMENT_SUCCEEDED", channel: "mock", merchantScope: payment.merchantScope,
        merchantOrderNo: payment.merchantOrderNo, channelTradeNo: fact.channelNo, amountCents: fact.amountCents,
        paidAt: fact.createdAt.toISOString(), currency: "CNY", evidenceHash: createHash("sha256").update(JSON.stringify(fact)).digest("hex") }, owner);
    },
    RECOVER_REFUND: async (lease: { refId: string }) => {
      const refund = await db.refund.findUniqueOrThrow({ where: { id: lease.refId }, include: { receipt: true } });
      if (refund.resolutionState === "CONFIRMED") return;
      channel.assertBinding(refund);
      if (!["NEW", "UNKNOWN"].includes(refund.resolutionState) || !["REFUNDING", "FAILED"].includes(refund.status)) {
        throw new Error("Refund requires approved recovery state");
      }
      if (!refund.receipt) throw new Error("Original receipt missing");
      // Reject a stale/cross-merchant association before even querying the channel.
      // A refund's own binding cannot authorize spending a different receipt.
      if (refund.receipt.channel !== refund.channel || refund.receipt.merchantScope !== refund.merchantScope
        || refund.receipt.orderId !== refund.orderId || refund.receipt.paymentId !== refund.paymentId
        || refund.receipt.currency !== "CNY" || !Number.isSafeInteger(refund.amountCents)
        || refund.amountCents <= 0 || refund.amountCents > refund.receipt.amountCents) {
        throw new Error("Original refund receipt identity conflict");
      }
      // Mark unknown before dispatch; a crash cannot release this reservation.
      await db.refund.updateMany({ where: { id: refund.id, version: refund.version, resolutionState: "NEW" },
        data: { resolutionState: "UNKNOWN", version: { increment: 1 } } });
      const fact = await channel.query("REFUND", refund.merchantRefundNo)
        ?? await channel.refund(refund.merchantRefundNo, refund.receipt.channelTradeNo, refund.amountCents);
      if (fact.status !== "SUCCEEDED") throw new Error("Refund still unknown");
      if (fact.kind !== "REFUND" || fact.originalTradeNo !== refund.receipt.channelTradeNo || fact.amountCents !== refund.amountCents) {
        await db.$transaction(tx => openCase(tx, "REFUND_FACT_CONFLICT", refund.id, owner));
        throw new Error("Refund original transaction conflict");
      }
      if (!await confirmRefund(db, { channel: "mock", merchantScope: refund.merchantScope,
        merchantRefundNo: refund.merchantRefundNo, originalTradeNo: fact.originalTradeNo,
        channelRefundNo: fact.channelNo, amountCents: fact.amountCents }, owner)) throw new Error("Refund conflict");
    },
  };
}
