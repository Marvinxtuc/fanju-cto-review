import {hasFormalCancelledCloseAuthority} from './formal-close-authority.js';
import {isUnsettledPayment} from './unsettled-payment.js';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import { registrationLock, dbNow, assertLease } from './domain.js';
import type { Lease } from '../jobs/queue.js';

// Internal trusted-query intake. Never accepts caller-supplied SUCCEEDED or paidAt.
// Facts remain RECEIVED until the formal qualification/refund processor applies them.
export function createPaymentQueryIntake(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>) {
  return async (intentId: string, lease?: Lease) => {
    if (lease) {
      if (lease.refId !== intentId || lease.kind !== 'V11_QUERY_PAYMENT') throw Error('Query worker reference mismatch');
      await db.$transaction(tx => assertLease(tx, lease));
    }
    const initial = await db.v11PaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    const fact = await channel.queryPayment(initial);
    if (fact.status === 'CLOSED') return db.$transaction(async tx => {
      const registration = await registrationLock(tx, initial.registrationId);
      if (lease) await assertLease(tx, lease);
      const current = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
      channel.assertBinding(current);
      if (current.registrationId !== initial.registrationId || current.merchantOrderNo !== initial.merchantOrderNo
        || current.merchantScope !== initial.merchantScope || current.providerConfigId !== initial.providerConfigId
        || current.totalCents !== initial.totalCents || current.totalCents !== fact.amountCents)
        throw Error('Payment identity changed during closure query');
      // A closed channel order alone cannot cancel a registration or discard money.
      // Formal expiry revokes submission authority but deliberately preserves UNKNOWN.
      // Require the committed expiry, its audit and original recovery task before
      // accepting a trusted CLOSED observation; never infer closure from expiry.
      let formalExpiry = false;
      if (!current.active && isUnsettledPayment(current) && !registration.active
        && registration.eligibilityState === 'EXPIRED' && !registration.paidEffectiveAt
        && !registration.cancelAcceptedAt && (registration.category !== 'WAITLIST'||registration.policy.status==='FORMAL_RUNTIME')) {
        const hold = await tx.v11SeatHold.findUnique({ where: { registrationId: registration.id } });
        if (hold?.state === 'EXPIRED' && hold.releasedAt && hold.releasedAt >= hold.expiresAt
          && hold.expiresAt.getTime() === registration.acceptedAt.getTime() + 600000
          && current.totalCents === registration.serviceFeeCents + registration.depositCents) {
          const audit = await tx.auditLog.findFirst({ where: {
            action: 'qualification.v11-formal-hold-expired', targetType: 'V11SeatHold', targetId: hold.id,
            metadata: { path: ['effectiveDeadline'], equals: hold.expiresAt.toISOString() } } });
          const metadata = audit?.metadata as Record<string, unknown> | undefined;
          const task = await tx.durableJob.findUnique({ where: {
            businessKey: `v11:formal-expire-query:${current.id}` } });
          formalExpiry = metadata?.scope === 'FROZEN_FORMAL_HOLD_EXPIRY_ONLY'
            && metadata.registrationId === registration.id && metadata.channelClosed === false
            && metadata.membershipChanged === false && task?.kind === 'V11_QUERY_PAYMENT'
            && task.refId === current.id
            && await tx.v11Membership.count({ where: { registrationId: registration.id } }) === 0;
        }
      }
      const ordinaryCancellation=await hasFormalCancelledCloseAuthority(tx,registration,current);
      if (current.active || (current.state !== 'CLOSED' && !formalExpiry&&!ordinaryCancellation))
        return { kind: 'UNCONFIRMED' as const, status: fact.status };
      const receipts = await tx.channelReceipt.count({ where: { channel: current.channel,
        merchantScope: current.merchantScope, merchantOrderNo: current.merchantOrderNo } });
      const successEvents = await tx.receivedEvent.count({ where: { source: 'wechat-query-v11', merchantScope: current.merchantScope,
        normalizedPayload: { path: ['sourceId'], equals: current.id } } });
      const payload = { kind: 'PAYMENT_CLOSED', sourceId: current.id, merchantOrderNo: current.merchantOrderNo,
        amountCents: current.totalCents, currency: fact.currency };
      const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const identity = { source: 'wechat-closed-query-v11', merchantScope: current.merchantScope, eventKey: `PAYMENT_CLOSED:${current.id}` };
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${identity.source}:${identity.merchantScope}:${identity.eventKey}`},0))`;
      const prior = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: identity } });
      const changedEvidence = !!prior && prior.payloadHash !== payloadHash;
      const observationIdentity = changedEvidence ? { ...identity, eventKey: `${identity.eventKey}:conflict:${payloadHash}` } : identity;
      const previousObservation = changedEvidence
        ? await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: observationIdentity } }) : prior;
      const unresolvedConflicts = await tx.receivedEvent.count({ where: { source: identity.source, merchantScope: identity.merchantScope,
        eventKey: { startsWith: `${identity.eventKey}:conflict:` }, state: 'MANUAL' } });
      const conflict = receipts > 0 || successEvents > 0 || changedEvidence || prior?.state === 'MANUAL' || unresolvedConflicts > 0;
      const event = await tx.receivedEvent.upsert({ where: { source_merchantScope_eventKey: observationIdentity },
        create: { ...observationIdentity, payloadHash, normalizedPayload: payload, verificationMaterialId: current.providerConfigId,
          verifiedAt: await dbNow(tx), state: conflict ? 'MANUAL' : 'RECEIVED' },
        update: conflict ? { state: 'MANUAL' } : {} });
      if (!previousObservation || (conflict && previousObservation.state !== 'MANUAL')) await tx.auditLog.create({ data: {
        action: conflict ? 'funding.v11-closed-query-conflict' : 'funding.v11-closed-query-converged',
        targetType: 'ReceivedEvent', targetId: event.id, metadata: { scope: 'CHANNEL_CLOSURE_OBSERVATION_ONLY', intentId: current.id,
          ...(changedEvidence ? { originalEventId: prior!.id } : {}) } } });
      return conflict ? { kind: 'CONFLICT' as const, eventId: event.id, originalEventId: prior?.id ?? event.id }
        : { kind: 'CLOSED_CONVERGED' as const, eventId: event.id };
    });
    if (fact.status !== 'SUCCEEDED') return { kind: 'UNCONFIRMED' as const, status: fact.status };
    const payload = { kind: 'PAYMENT', sourceId: initial.id, merchantOrderNo: initial.merchantOrderNo,
      channelNo: fact.channelTradeNo!, amountCents: fact.amountCents, currency: fact.currency, paidAt: fact.paidAt! };
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return db.$transaction(async tx => {
      await registrationLock(tx, initial.registrationId);
      if (lease) await assertLease(tx, lease);
      const current = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
      channel.assertBinding(current);
      if (current.registrationId !== initial.registrationId || current.merchantOrderNo !== initial.merchantOrderNo
        || current.totalCents !== fact.amountCents) throw Error('Payment identity changed during query');
      const source = 'wechat-query-v11'; const eventKey = `PAYMENT:${fact.channelTradeNo}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${source}:${current.merchantScope}:${eventKey}`},0))`;
      const key = { source, merchantScope: current.merchantScope, eventKey };
      const prior = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: key } });
      if (prior) {
        if (prior.payloadHash !== payloadHash) {
          const conflictKey = { ...key, eventKey: `${eventKey}:conflict:${payloadHash}` };
          let conflict = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: conflictKey } });
          if (!conflict) {
            conflict = await tx.receivedEvent.create({ data: { ...conflictKey, payloadHash, normalizedPayload: payload,
              verificationMaterialId: current.providerConfigId, verifiedAt: await dbNow(tx), state: 'MANUAL' } });
            await tx.auditLog.create({ data: { action: 'funding.v11-payment-query-conflict', targetType: 'ReceivedEvent', targetId: conflict.id,
              metadata: { scope: 'VERIFIED_CHANNEL_QUERY', originalEventId: prior.id, intentId: current.id } } });
          }
          return { kind: 'CONFLICT' as const, eventId: conflict.id, originalEventId: prior.id };
        }
        return { kind: 'RECEIVED' as const, eventId: prior.id };
      }
      const event = await tx.receivedEvent.create({ data: { ...key, payloadHash, normalizedPayload: payload,
        verificationMaterialId: current.providerConfigId, verifiedAt: await dbNow(tx), state: 'RECEIVED' } });
      await tx.auditLog.create({ data: { action: 'funding.v11-payment-query-received', targetType: 'ReceivedEvent', targetId: event.id,
        metadata: { scope: 'VERIFIED_CHANNEL_QUERY', intentId: current.id } } });
      // Cancellation/closed local intent does not discard actual money received.
      return { kind: 'RECEIVED' as const, eventId: event.id };
    });
  };
}
