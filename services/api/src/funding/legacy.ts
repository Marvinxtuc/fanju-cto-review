import type { PrismaClient } from "../generated/prisma/client.js";
import { lockOrder } from "./receipts.js";
import { openCase } from "../jobs/queue.js";
import { LOCAL_MOCK_BINDING } from "./mock-channel.js";

// Offline rehearsal only. A real historical account needs its own approved evidence mapping.
export async function claimLegacyMockPayment(db: PrismaClient, input: {
  paymentId: string; receiptId: string; operator: string; reviewer: string;
}) {
  if (!input.operator.trim() || !input.reviewer.trim() || input.operator === input.reviewer) throw new Error("Independent review required");
  return db.$transaction(async tx => {
    const initial = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
    const order = await lockOrder(tx, initial.orderId);
    await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id = ${input.receiptId} FOR UPDATE`;
    const payment = await tx.payment.findUniqueOrThrow({ where: { id: input.paymentId } });
    const receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: input.receiptId } });
    const binding = LOCAL_MOCK_BINDING;
    if (payment.channel !== binding.channel || receipt.channel !== binding.channel || receipt.merchantScope !== binding.merchantScope
      || receipt.merchantOrderNo !== payment.merchantOrderNo || receipt.amountCents !== payment.amountCents
      || (payment.channelTradeNo && payment.channelTradeNo !== receipt.channelTradeNo)
      || (receipt.paymentId && receipt.paymentId !== payment.id) || (receipt.orderId && receipt.orderId !== payment.orderId)) {
      throw new Error("Historical evidence association conflict");
    }
    if (payment.providerConfigId !== "legacy-unverified" || payment.merchantScope !== "legacy-unverified") {
      if (payment.providerConfigId === binding.providerConfigId && payment.merchantScope === binding.merchantScope && receipt.paymentId === payment.id) return receipt;
      throw new Error("Only unverified legacy bindings may be claimed");
    }
    if (await tx.channelReceipt.count({ where: { orderId: order.id, id: { not: receipt.id } } })) throw new Error("Multiple historical receipts require separate review");
    // No assumption that FAILED means no refund. All unbound legacy refunds must fit the verified receipt.
    const refunds = await tx.refund.findMany({ where: { orderId: order.id }, orderBy: { id: "asc" } });
    if (refunds.some(r => r.receiptId && r.receiptId !== receipt.id)
      || refunds.some(r => !r.receiptId && r.providerConfigId !== "legacy-unverified")
      || refunds.reduce((sum, r) => sum + (r.status === "REJECTED" && r.resolutionState === "REJECTED" ? 0 : r.amountCents), 0) > receipt.amountCents) {
      throw new Error("Historical refund budget requires separate review");
    }
    const associated = await tx.channelReceipt.update({ where: { id: receipt.id }, data: { paymentId: payment.id, orderId: order.id } });
    await tx.payment.update({ where: { id: payment.id }, data: { ...binding, channelTradeNo: receipt.channelTradeNo,
      status: "SUCCEEDED", resolutionState: "CONFIRMED", version: { increment: 1 } } });
    for (const refund of refunds) {
      if (refund.receiptId) continue;
      await tx.refund.update({ where: { id: refund.id }, data: { ...binding, receiptId: receipt.id, paymentId: payment.id,
        resolutionState: "MANUAL", version: { increment: 1 } } });
      await openCase(tx, "LEGACY_REFUND_REQUIRES_EVIDENCE", refund.id, input.operator);
    }
    // Association alone must never resurrect historical fulfillment or dispatch a refund.
    await openCase(tx, "LEGACY_FULFILLMENT_REQUIRES_REVIEW", receipt.id, input.operator);
    await tx.auditLog.create({ data: { action: "funding.legacy.mock-claim", targetType: "Payment", targetId: payment.id,
      metadata: { receiptId: receipt.id, evidenceHash: receipt.evidenceHash, operator: input.operator, reviewer: input.reviewer,
        preservedOrderStatus: order.status, refundsReserved: refunds.length } } });
    return associated;
  });
}
