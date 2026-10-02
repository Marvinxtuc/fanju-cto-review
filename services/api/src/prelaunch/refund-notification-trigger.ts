import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { VerifiedRefundNotification } from '../wechat-pay.js';
import type { ChannelBinding } from '../funding/mock-channel.js';
import { enqueue, openCase } from '../jobs/queue.js';
import { registrationLock, dbNow } from './domain.js';
import {recordVerifiedRefundNotificationTime} from './refund-completion-time.js';

// Internal verified notification seam; acknowledgement is never budget completion.
export function createRefundNotificationTrigger(db: PrismaClient, binding: ChannelBinding, caseOwner: string) {
  if (binding.channel !== 'wechat' || !caseOwner.trim()) throw Error('Real notification binding and case owner required');
  return async (callback: VerifiedRefundNotification, verificationMaterialId: string) => {
    if (!verificationMaterialId) throw Error('Verified notification material required');
    const initial = await db.v11RefundInstruction.findUnique({ where: { merchantRefundNo: callback.merchantRefundNo } });
    if (!initial) return { handled: false as const };
    return db.$transaction(async tx => {
      if (initial.registrationId) await registrationLock(tx, initial.registrationId);
      await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${initial.receiptId} FOR UPDATE`;
      const instruction = await tx.v11RefundInstruction.findUniqueOrThrow({ where: { id: initial.id } });
      if (instruction.channel !== binding.channel || instruction.merchantScope !== binding.merchantScope || instruction.providerConfigId !== binding.providerConfigId
        || instruction.receiptId !== initial.receiptId || instruction.registrationId !== initial.registrationId
        || instruction.merchantRefundNo !== callback.merchantRefundNo) throw Error('Refund notification binding mismatch');
      const payload = { kind: 'REFUND_QUERY_TRIGGER', sourceId: instruction.id, merchantRefundNo: callback.merchantRefundNo,
        channelRefundNo: callback.channelRefundNo, originalTradeNo: callback.originalTradeNo, amountCents: callback.amountCents, currency: 'CNY' };
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const source = 'wechat-refund-notify-trigger-v11';
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${source}:${instruction.merchantScope}:${callback.eventId}`},0))`;
      const key = { source, merchantScope: instruction.merchantScope, eventKey: callback.eventId };
      const prior = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: key } });
      const mismatch = callback.amountCents !== instruction.totalCents || callback.originalTradeNo !== instruction.originalTradeNo
        || (!!instruction.channelRefundNo && instruction.channelRefundNo !== callback.channelRefundNo);
      const conflict = !!prior && prior.payloadHash !== hash;
      const eventKey = conflict ? `${callback.eventId}:conflict:${hash}` : callback.eventId;
      let event = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: { ...key, eventKey } } });
      const duplicate = !!event;
      if (!event) {
        event = await tx.receivedEvent.create({ data: { ...key, eventKey, payloadHash: hash, normalizedPayload: payload,
          verificationMaterialId, verifiedAt: await dbNow(tx), state: conflict || mismatch ? 'MANUAL' : 'RECEIVED' } });
        await tx.auditLog.create({ data: { action: 'funding.v11-refund-notification-trigger', targetType: 'ReceivedEvent', targetId: event.id,
          metadata: { scope: 'VERIFIED_CHANNEL_NOTIFICATION', instructionId: instruction.id, conflict, identityMismatch: mismatch } } });
      }
      if (conflict || mismatch) await openCase(tx, 'V11_REFUND_NOTIFICATION_CONFLICT', event.id, caseOwner);
      if(!conflict&&!mismatch&&callback.refundedAt){
        const receipt=await tx.channelReceipt.findUniqueOrThrow({where:{id:instruction.receiptId}});
        await recordVerifiedRefundNotificationTime(tx,instruction,receipt,{status:'SUCCEEDED',merchantRefundNo:callback.merchantRefundNo,
          channelRefundNo:callback.channelRefundNo,originalTradeNo:callback.originalTradeNo,amountCents:callback.amountCents,currency:'CNY',refundedAt:callback.refundedAt},caseOwner,{eventId:event.id,verificationMaterialId});
      }
      await enqueue(tx, 'V11_QUERY_REFUND', `v11:refund-notify-query:${event.id}`, instruction.id);
      return { handled: true as const, duplicate, conflict: conflict || mismatch, eventId: event.id };
    });
  };
}
