import { createHash } from 'node:crypto';
import { z } from 'zod';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import type { Lease } from '../jobs/queue.js';
import { assertLease, registrationLock } from './domain.js';
const payloadSchema = z.object({ kind: z.literal('PAYMENT'), sourceId: z.string().min(1), merchantOrderNo: z.string().min(1),
  channelNo: z.string().min(1), amountCents: z.number().int().positive(), currency: z.literal('CNY'), paidAt: z.string().datetime({offset:true}) }).strict();

// Monetary ledger only: preserves paidAt without granting seats or applying policy.
export function createPaymentReceiptLedger(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>) {
  return async (eventId: string, lease?: Lease) => db.$transaction(async tx => {
    const initial = await tx.receivedEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (initial.source !== 'wechat-query-v11' || !['RECEIVED','RECEIPT_RECORDED'].includes(initial.state)) throw Error('Untrusted receipt event');
    const data = payloadSchema.parse(initial.normalizedPayload);
    // Reconstruct the intake's projection: JSONB key order differs from insertion order.
    const projected = { kind: data.kind, sourceId: data.sourceId, merchantOrderNo: data.merchantOrderNo,
      channelNo: data.channelNo, amountCents: data.amountCents, currency: data.currency, paidAt: data.paidAt };
    if (createHash('sha256').update(JSON.stringify(projected)).digest('hex') !== initial.payloadHash) throw Error('Receipt evidence hash mismatch');
    const intent = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: data.sourceId } });
    if (lease && (lease.kind !== 'V11_QUERY_PAYMENT' || lease.refId !== intent.id)) throw Error('Receipt worker reference mismatch');
    await registrationLock(tx, intent.registrationId);
    if (lease) await assertLease(tx, lease);
    const lockedEvent = await tx.receivedEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (!['RECEIVED','RECEIPT_RECORDED'].includes(lockedEvent.state) || lockedEvent.payloadHash !== initial.payloadHash)
      throw Error('Receipt event changed during processing');
    channel.assertBinding(intent);
    if (initial.merchantScope !== intent.merchantScope || initial.verificationMaterialId !== intent.providerConfigId
      || data.merchantOrderNo !== intent.merchantOrderNo || data.amountCents !== intent.totalCents) throw Error('Receipt binding mismatch');
    const identity = { channel: intent.channel, merchantScope: intent.merchantScope, channelTradeNo: data.channelNo };
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${identity.channel}:${identity.merchantScope}:${identity.channelTradeNo}`},0))`;
    let receipt = await tx.channelReceipt.findUnique({ where: { channel_merchantScope_channelTradeNo: identity } });
    if (receipt && (receipt.merchantOrderNo !== data.merchantOrderNo || receipt.amountCents !== data.amountCents
      || receipt.currency !== data.currency || receipt.paidAt?.toISOString() !== new Date(data.paidAt).toISOString())) throw Error('Receipt transaction conflict');
    if (!receipt) {
      receipt = await tx.channelReceipt.create({ data: { ...identity, merchantOrderNo: data.merchantOrderNo,
        amountCents: data.amountCents, currency: data.currency, paidAt: new Date(data.paidAt), evidenceHash: initial.payloadHash, verifiedAt: initial.verifiedAt } });
      await tx.auditLog.create({ data: { action: 'funding.v11-receipt-recorded', targetType: 'ChannelReceipt', targetId: receipt.id,
        metadata: { scope: 'VERIFIED_CHANNEL_QUERY', eventId, intentId: intent.id } } });
    }
    await tx.receivedEvent.update({ where: { id: eventId }, data: { state: 'RECEIPT_RECORDED' } });
    return { receiptId: receipt.id };
  });
}
