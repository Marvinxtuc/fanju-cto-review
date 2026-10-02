import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { VerifiedPaymentNotification } from '../wechat-pay.js';
import type { ChannelBinding } from '../funding/mock-channel.js';
import { enqueue, openCase } from '../jobs/queue.js';
import { registrationLock, dbNow } from './domain.js';

// Internal only: the HTTP route must verify/decrypt the exact raw callback first.
// Persist a trusted trigger and recover through query; never apply caller claims.
export function createPaymentNotificationTrigger(db: PrismaClient, binding: ChannelBinding, caseOwner: string) {
  if (binding.channel !== 'wechat' || !caseOwner.trim()) throw Error('Real notification binding and case owner required');
  return async (callback: VerifiedPaymentNotification, verificationMaterialId: string) => {
    if (!verificationMaterialId) throw Error('Verified notification material required');
    const initial = await db.v11PaymentIntent.findUnique({ where: { merchantOrderNo: callback.merchantOrderNo } });
    if (!initial) return { handled: false as const };
    return db.$transaction(async tx => {
      await registrationLock(tx, initial.registrationId);
      const intent = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: initial.id } });
      if (intent.channel !== binding.channel || intent.merchantScope !== binding.merchantScope || intent.providerConfigId !== binding.providerConfigId
        || intent.registrationId !== initial.registrationId || intent.merchantOrderNo !== callback.merchantOrderNo) throw Error('Notification binding mismatch');
      const payload = { kind: 'PAYMENT_QUERY_TRIGGER', sourceId: intent.id, merchantOrderNo: callback.merchantOrderNo,
        channelTradeNo: callback.channelTradeNo, amountCents: callback.amountCents, paidAt: callback.paidAt, currency: 'CNY' };
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const source = 'wechat-notify-trigger-v11';
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${source}:${intent.merchantScope}:${callback.eventId}`},0))`;
      const key = { source, merchantScope: intent.merchantScope, eventKey: callback.eventId };
      const prior = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: key } });
      const conflict = !!prior && prior.payloadHash !== hash;
      const mismatch = callback.amountCents !== intent.totalCents;
      const eventKey = conflict ? `${callback.eventId}:conflict:${hash}` : callback.eventId;
      let event = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: { ...key, eventKey } } });
      const duplicate = !!event;
      if (!event) {
        event = await tx.receivedEvent.create({ data: { ...key, eventKey, payloadHash: hash, normalizedPayload: payload,
          verificationMaterialId, verifiedAt: await dbNow(tx), state: conflict || mismatch ? 'MANUAL' : 'RECEIVED' } });
        await tx.auditLog.create({ data: { action: 'funding.v11-payment-notification-trigger', targetType: 'ReceivedEvent', targetId: event.id,
          metadata: { scope: 'VERIFIED_CHANNEL_NOTIFICATION', intentId: intent.id, conflict, amountMismatch: mismatch } } });
      }
      if (conflict || mismatch) await openCase(tx, 'V11_PAYMENT_NOTIFICATION_CONFLICT', event.id, caseOwner);
      // A separate key per verified event wakes recovery even if the original query
      // job is already DONE/MANUAL. Preserve its prior failure and review evidence.
      await enqueue(tx, 'V11_QUERY_PAYMENT', `v11:notify-query:${event.id}`, intent.id);
      return { handled: true as const, duplicate, conflict: conflict || mismatch, eventId: event.id };
    });
  };
}
