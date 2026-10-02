import { recordVerifiedRefundTime } from './refund-completion-time.js';
import { createHash } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import { openCase, type Lease } from '../jobs/queue.js';
import { assertLease, registrationLock, dbNow } from './domain.js';

export function createRefundQueryConfirmation(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>, caseOwner: string) {
  if (!caseOwner.trim()) throw Error('Financial case owner required');
  return async (instructionId: string, lease?: Lease) => {
    if (lease) {
      if (lease.kind !== 'V11_QUERY_REFUND' || lease.refId !== instructionId) throw Error('Refund query reference mismatch');
      await db.$transaction(tx => assertLease(tx, lease));
    }
    const initial = await db.v11RefundInstruction.findUniqueOrThrow({ where: { id: instructionId } });
    const fact = await channel.queryRefund(initial);
    if (fact.status !== 'SUCCEEDED') return { kind: 'UNCONFIRMED' as const };
    const payload = { kind: 'REFUND', sourceId: instructionId, merchantRefundNo: fact.merchantRefundNo,
      channelNo: fact.channelRefundNo, originalTradeNo: fact.originalTradeNo, amountCents: fact.amountCents, currency: fact.currency };
    const payloadHash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
    return db.$transaction(async tx => {
      if (initial.registrationId) await registrationLock(tx, initial.registrationId);
      await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${initial.receiptId} FOR UPDATE`;
      if (lease) await assertLease(tx, lease);
      const current = await tx.v11RefundInstruction.findUniqueOrThrow({ where: { id: instructionId } });
      channel.assertBinding(current);
      const receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: current.receiptId } });
      const source = 'wechat-refund-query-v11'; const eventKey = `REFUND:${fact.channelRefundNo}`;
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${source}:${current.merchantScope}:${eventKey}`},0))`;
      const identity = { source, merchantScope: current.merchantScope, eventKey };
      let event = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: identity } });
      const evidenceConflict = !!event && event.payloadHash !== payloadHash;
      if (evidenceConflict) event = await tx.receivedEvent.upsert({ where: { source_merchantScope_eventKey: { ...identity, eventKey: `${eventKey}:conflict:${payloadHash}` } }, update: {},
        create: { ...identity, eventKey: `${eventKey}:conflict:${payloadHash}`, payloadHash, normalizedPayload: payload,
          verificationMaterialId: current.providerConfigId, verifiedAt: await dbNow(tx), state: 'MANUAL' } });
      event ??= await tx.receivedEvent.create({ data: { ...identity, payloadHash, normalizedPayload: payload,
        verificationMaterialId: current.providerConfigId, verifiedAt: await dbNow(tx) } });
      const rows = await tx.v11Disposition.findMany({ where: { sourceRef: current.id, kind: 'REFUND' }, include: { component: true } });
      const sum = (kind: string) => rows.filter(x => x.component.kind === kind).reduce((s,x) => s+x.amountCents,0);
      const invalid = evidenceConflict || current.receiptId !== initial.receiptId || current.registrationId !== initial.registrationId
        || receipt.channel !== current.channel || receipt.merchantScope !== current.merchantScope || receipt.channelTradeNo !== current.originalTradeNo
        || current.merchantRefundNo !== fact.merchantRefundNo || current.originalTradeNo !== fact.originalTradeNo || current.totalCents !== fact.amountCents
        || current.totalCents !== current.serviceFeeCents + current.depositCents || current.totalCents > receipt.amountCents || receipt.currency !== 'CNY'
        || fact.currency !== 'CNY' || !fact.channelRefundNo || (current.channelRefundNo && current.channelRefundNo !== fact.channelRefundNo)
        || rows.some(x => x.component.receiptId !== receipt.id || !['RESERVED','COMPLETED'].includes(x.state))
        || sum('F') !== current.serviceFeeCents || sum('D') !== current.depositCents;
      if (invalid) {
        await tx.receivedEvent.update({ where: { id: event.id }, data: { state: 'MANUAL' } });
        await openCase(tx, 'V11_REFUND_QUERY_CONFLICT', event.id, caseOwner);
        return { kind: 'CONFLICT' as const };
      }
      await recordVerifiedRefundTime(tx,current,receipt,fact,caseOwner);
      if (current.state !== 'CONFIRMED') {
        await tx.v11RefundInstruction.update({ where: { id: current.id }, data: { state: 'CONFIRMED', channelRefundNo: fact.channelRefundNo, version: { increment: 1 } } });
        await tx.v11Disposition.updateMany({ where: { sourceRef: current.id, kind: 'REFUND', state: 'RESERVED' }, data: { state: 'COMPLETED' } });
        await tx.auditLog.create({ data: { action: 'funding.v11-refund-query-confirmed', targetType: 'V11RefundInstruction', targetId: current.id,
          metadata: { scope: 'VERIFIED_CHANNEL_QUERY', eventId: event.id } } });
      }
      await tx.receivedEvent.update({ where: { id: event.id }, data: { state: 'APPLIED' } });
      return { kind: 'CONFIRMED' as const };
    });
  };
}
