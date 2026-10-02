import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import { enqueue, type Lease } from '../jobs/queue.js';
import { assertLease, registrationLock, dbNow } from './domain.js';

// Internal dispatcher: production assembly must supply a formal policy/authority verifier.
export function createRefundDispatcher(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>,
  authorize: (tx: Prisma.TransactionClient, instructionId: string) => Promise<void>) {
  if (typeof authorize !== 'function') throw Error('Formal refund dispatch authorization required');
  return async (instructionId: string, lease: Lease) => {
    if (lease.kind !== 'V11_WECHAT_REFUND' || lease.refId !== instructionId) throw Error('Refund dispatch reference mismatch');
    await db.$transaction(tx => assertLease(tx, lease));
    const initial = await db.v11RefundInstruction.findUniqueOrThrow({ where: { id: instructionId } });
    channel.assertBinding(initial);
    const fact = await channel.queryRefund(initial);
    const prepared = await db.$transaction(async tx => {
      if (initial.registrationId) await registrationLock(tx, initial.registrationId);
      await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${initial.receiptId} FOR UPDATE`;
      await assertLease(tx, lease);
      await authorize(tx, instructionId);
      const current = await tx.v11RefundInstruction.findUniqueOrThrow({ where: { id: instructionId } });
      channel.assertBinding(current);
      const receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: current.receiptId } });
      if (current.receiptId !== initial.receiptId || current.merchantRefundNo !== initial.merchantRefundNo || current.originalTradeNo !== initial.originalTradeNo
        || current.totalCents !== initial.totalCents || receipt.channel !== current.channel || receipt.merchantScope !== current.merchantScope
        || receipt.channelTradeNo !== current.originalTradeNo || receipt.currency !== 'CNY' || !receipt.paidAt) throw Error('Original refund identity changed');
      const rows = await tx.v11Disposition.findMany({ where: { sourceRef: current.id, kind: 'REFUND' }, include: { component: true } });
      if (rows.some(x => x.component.receiptId !== receipt.id || !['RESERVED','COMPLETED'].includes(x.state))
        || rows.filter(x=>x.component.kind==='F').reduce((s,x)=>s+x.amountCents,0)!==current.serviceFeeCents
        || rows.filter(x=>x.component.kind==='D').reduce((s,x)=>s+x.amountCents,0)!==current.depositCents
        || current.totalCents!==current.serviceFeeCents+current.depositCents || current.totalCents>receipt.amountCents) throw Error('Refund reservation conflict');
      if (current.state === 'CONFIRMED') return { kind: 'CONFIRMED' as const };
      await enqueue(tx, 'V11_QUERY_REFUND', `v11:wechat-refund-query:${current.id}`, current.id, new Date((await dbNow(tx)).getTime()+30000));
      if (fact.status !== 'NOT_FOUND') return { kind: 'QUERY_REQUIRED' as const };
      // Unknown/submitting attempts retain the same number and reservation; absence
      // alone does not authorize a second send after an unacknowledged attempt.
      if (current.state !== 'NEW') return { kind: 'QUERY_REQUIRED' as const };
      if (rows.some(x => x.state !== 'RESERVED')) throw Error('Refund budget is no longer reserved');
      const claimed = await tx.v11RefundInstruction.update({ where: { id: current.id }, data: { state: 'SUBMITTING', version: { increment: 1 } } });
      return { kind: 'CLAIMED' as const, instruction: claimed, receipt };
    });
    if (prepared.kind !== 'CLAIMED') return prepared;
    const claimed = prepared.instruction;
    try {
      const ack = await channel.submitRefund({ ...claimed, merchantOrderNo: prepared.receipt.merchantOrderNo, originalAmountCents: prepared.receipt.amountCents },
        () => db.$transaction(async tx => {
          if (claimed.registrationId) await registrationLock(tx, claimed.registrationId);
          await assertLease(tx, lease);
          await authorize(tx, claimed.id);
          const current = await tx.v11RefundInstruction.findUniqueOrThrow({ where: { id: claimed.id } });
          channel.assertBinding(current);
          if (current.state !== 'SUBMITTING' || current.version !== claimed.version
            || current.receiptId !== claimed.receiptId || current.merchantRefundNo !== claimed.merchantRefundNo
            || current.originalTradeNo !== claimed.originalTradeNo || current.totalCents !== claimed.totalCents)
            throw Error('Refund dispatch authority changed before send');
        }));
      await db.$transaction(async tx => {
        if (claimed.registrationId) await registrationLock(tx, claimed.registrationId);
        await assertLease(tx, lease);
        await tx.v11RefundInstruction.updateMany({ where: { id: claimed.id, state: 'SUBMITTING', version: claimed.version },
          data: { state: 'UNKNOWN', ...(ack.channelRefundNo ? { channelRefundNo: ack.channelRefundNo } : {}), version: { increment: 1 } } });
      });
      return { kind: 'QUERY_REQUIRED' as const };
    } catch (error) {
      await db.$transaction(async tx => {
        if (claimed.registrationId) await registrationLock(tx, claimed.registrationId);
        await assertLease(tx, lease);
        await tx.v11RefundInstruction.updateMany({ where: { id: claimed.id, state: 'SUBMITTING', version: claimed.version }, data: { state: 'UNKNOWN', version: { increment: 1 } } });
      });
      throw error;
    }
  };
}
