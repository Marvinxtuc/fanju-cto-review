import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { createWechatChannel } from './wechat-channel.js';
import { registrationLock, reserveWechatRefundBudget } from './domain.js';

export function createWechatRefundReserver(db: PrismaClient, channel: ReturnType<typeof createWechatChannel>,
  authorize: (tx: Prisma.TransactionClient, registrationId: string) => Promise<void>) {
  if (typeof authorize !== 'function') throw Error('Formal refund authorization required');
  return async (receiptId: string, desired: { F: number; D: number }, businessKey: string) => db.$transaction(async tx => {
    const allocation = await tx.v11ReceiptBinding.findUniqueOrThrow({ where: { receiptId } });
    if (!allocation.registrationId || !allocation.intentId || !['PRIMARY','EXTRA'].includes(allocation.classification)) throw Error('Refund allocation unavailable');
    const reg = await registrationLock(tx, allocation.registrationId);
    await authorize(tx, reg.id);
    const intent = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: allocation.intentId } });
    channel.assertBinding(intent);
    const receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: receiptId } });
    if (intent.registrationId !== reg.id || receipt.merchantOrderNo !== intent.merchantOrderNo || receipt.amountCents !== intent.totalCents
      || receipt.currency !== 'CNY' || !receipt.paidAt) throw Error('Original payment binding unavailable');
    return reserveWechatRefundBudget(tx, reg, receiptId, desired, businessKey, intent);
  });
}
