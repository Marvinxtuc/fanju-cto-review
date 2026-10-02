import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import type { BoundPayment } from './wechat-channel.js';
import { registrationLock, dbNow } from './domain.js';
import { enqueue } from '../jobs/queue.js';

// Internal persistence seam. The formal route must authorize owner/policy/hold under
// its registration lock before claiming; a merchant number is never replaced on retry.
export function createPaymentPreparationStore(db: PrismaClient,
  authorize: (tx: Prisma.TransactionClient, registrationId: string) => Promise<void>) {
  if (typeof authorize !== 'function') throw Error('Formal preparation authorization required');
  async function validateQualification(input: BoundPayment & { id: string; preparationVersion: number }, state: 'SUBMITTING' | 'PREPARED') {
      return db.$transaction(async tx => {
        const initial = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: input.id } });
        const reg = await registrationLock(tx, initial.registrationId);
        await authorize(tx, reg.id);
        const current = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: input.id } });
        const hold = await tx.v11SeatHold.findUnique({ where: { registrationId: reg.id } });
        if (current.preparationState !== state || current.preparationVersion !== input.preparationVersion
          || !current.active || !['NEW','SUBMITTING','UNKNOWN'].includes(current.state)
          || current.channel !== input.channel || current.merchantScope !== input.merchantScope
          || current.providerConfigId !== input.providerConfigId || current.merchantOrderNo !== input.merchantOrderNo
          || current.totalCents !== input.totalCents || !reg.active || reg.eligibilityState !== 'PENDING_PAYMENT'
          || hold?.state !== 'HELD' || hold.expiresAt <= await dbNow(tx)
          || current.totalCents !== reg.serviceFeeCents + reg.depositCents)
          throw Error('Payment qualification changed before send');
        if (state === 'PREPARED' && !current.prepayId) throw Error('Prepared payment reference required');
        return current;
      });
  }
  return {
    async claim(input: BoundPayment & { id: string; preparationVersion: number }) {
      return db.$transaction(async tx => {
        const initial = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: input.id } });
        // Same lock order as cancellation and seat transitions; do not authorize a
        // snapshot read before those transactions acquire their registration lock.
        const reg = await registrationLock(tx, initial.registrationId);
        await authorize(tx, reg.id);
        const current = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: input.id } });
        if (current.channel !== 'wechat' || current.channel !== input.channel || current.merchantScope !== input.merchantScope
          || current.providerConfigId !== input.providerConfigId || current.merchantOrderNo !== input.merchantOrderNo
          || current.totalCents !== input.totalCents) throw Error('Payment preparation binding conflict');
        if (!current.active || !['NEW','SUBMITTING','UNKNOWN'].includes(current.state)) throw Error('Payment intent unavailable');
        const hold = await tx.v11SeatHold.findUnique({ where: { registrationId: reg.id } });
        if (!reg.active || reg.eligibilityState !== 'PENDING_PAYMENT' || hold?.state !== 'HELD'
          || hold.expiresAt <= await dbNow(tx) || current.totalCents !== reg.serviceFeeCents + reg.depositCents)
          throw Error('Payment qualification unavailable');
        const updated = await tx.v11PaymentIntent.updateMany({
          where: { id: current.id, preparationVersion: input.preparationVersion, preparationState: 'NOT_STARTED', active: true,
            state: { in: ['NEW','SUBMITTING','UNKNOWN'] } },
          data: { preparationState: 'SUBMITTING', preparationVersion: { increment: 1 } },
        });
        if (updated.count !== 1) throw Error('Payment preparation already claimed; query existing merchant number');
        // Commit recovery with submission ownership, before any network operation.
        // A crash after channel dispatch cannot leave an intent without a durable query.
        const at = await dbNow(tx);
        await enqueue(tx, 'V11_QUERY_PAYMENT', `v11:wechat-query:${current.id}`, current.id, new Date(at.getTime() + 30_000));
        return tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: input.id } });
      });
    },
    async assertSendAllowed(input: BoundPayment & { id: string; preparationVersion: number }) {
      await validateQualification(input, 'SUBMITTING');
    },
    async readPrepared(input: BoundPayment & { id: string; preparationVersion: number }) {
      return validateQualification(input, 'PREPARED');
    },
    async savePrepared(id: string, version: number, prepayId: string) {
      if (!prepayId || prepayId.length > 256) throw Error('Invalid prepayment reference');
      const changed = await db.v11PaymentIntent.updateMany({ where: { id, preparationVersion: version, preparationState: 'SUBMITTING' },
        data: { preparationState: 'PREPARED', prepayId, preparationVersion: { increment: 1 } } });
      if (changed.count !== 1) throw Error('Stale preparation result; query merchant number');
    },
    async markUnknown(id: string, version: number) {
      await db.v11PaymentIntent.updateMany({ where: { id, preparationVersion: version, preparationState: 'SUBMITTING' },
        data: { preparationState: 'UNKNOWN', preparationVersion: { increment: 1 } } });
    },
  };
}
