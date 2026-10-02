import type { createPaymentPreparationStore } from './payment-preparation.js';
import type { createWechatChannel, BoundPayment } from './wechat-channel.js';

// Recover only a persisted prepayment. Missing/unknown acknowledgements never cause
// a second submission; trusted query recovers money independently of this operation.
export function createPaymentPreparationResumer(store: ReturnType<typeof createPaymentPreparationStore>, channel: ReturnType<typeof createWechatChannel>) {
  return async (input: BoundPayment & { id: string; preparationVersion: number }) => {
    channel.assertBinding(input);
    const prepared = await store.readPrepared(input);
    const fact = await channel.queryPayment(prepared);
    // Authorization/hold may change during the network query. Do not return even an
    // existing payment fact to a revoked caller, and do not sign a canceled intent.
    const current = await store.readPrepared(prepared);
    if (fact.status !== 'PENDING') return { kind: 'EXISTING' as const, fact };
    return channel.resumePayment({ ...current, prepayId: current.prepayId! });
  };
}
