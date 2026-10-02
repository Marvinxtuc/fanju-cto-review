import type { PrismaClient } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import type { Lease } from '../jobs/queue.js';
import { assertLease, registrationLock } from './domain.js';

// Accounting allocation only. No seats, penalties, refund requests or settlement decisions.
export function createReceiptAllocator(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>) {
  return async (receiptId: string, intentId: string, lease?: Lease) => db.$transaction(async tx => {
    const initial = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    const reg = await registrationLock(tx, initial.registrationId);
    if (lease) {
      if (lease.kind !== 'V11_QUERY_PAYMENT' || lease.refId !== intentId) throw Error('Allocation worker reference mismatch');
      await assertLease(tx, lease);
    }
    const intent = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    channel.assertBinding(intent);
    await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${receiptId} FOR UPDATE`;
    const receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    if (receipt.channel !== 'wechat' || receipt.channel !== intent.channel || receipt.merchantScope !== intent.merchantScope
      || receipt.merchantOrderNo !== intent.merchantOrderNo || receipt.currency !== 'CNY' || !receipt.paidAt
      || receipt.amountCents !== intent.totalCents || receipt.amountCents !== reg.serviceFeeCents + reg.depositCents
      || !Number.isSafeInteger(reg.serviceFeeCents) || !Number.isSafeInteger(reg.depositCents)
      || reg.serviceFeeCents < 0 || reg.depositCents < 0) throw Error('Receipt allocation identity or amount conflict');
    const prior = await tx.v11ReceiptBinding.findUnique({ where: { receiptId } });
    if (prior && (prior.intentId !== intentId || prior.registrationId !== reg.id || !['PRIMARY','EXTRA'].includes(prior.classification)))
      throw Error('Receipt already allocated to another identity');
    const components = await tx.v11FundComponent.findMany({ where: { receiptId } });
    if (prior) {
      if (components.length !== 2 || components.find(x => x.kind === 'F')?.originalCents !== reg.serviceFeeCents
        || components.find(x => x.kind === 'D')?.originalCents !== reg.depositCents) throw Error('Existing fund components conflict');
      return { classification: prior.classification };
    }
    if (components.length) throw Error('Orphan fund components require reconciliation');
    const count = await tx.v11ReceiptBinding.count({ where: { registrationId: reg.id } });
    const classification = count ? 'EXTRA' : 'PRIMARY';
    await tx.v11ReceiptBinding.create({ data: { receiptId, intentId, registrationId: reg.id, classification } });
    await tx.v11FundComponent.createMany({ data: [
      { receiptId, kind: 'F', originalCents: reg.serviceFeeCents }, { receiptId, kind: 'D', originalCents: reg.depositCents },
    ] });
    await tx.auditLog.create({ data: { action: 'funding.v11-receipt-allocated', targetType: 'ChannelReceipt', targetId: receiptId,
      metadata: { scope: 'MONETARY_ALLOCATION_ONLY', intentId, registrationId: reg.id, classification } } });
    return { classification };
  });
}
