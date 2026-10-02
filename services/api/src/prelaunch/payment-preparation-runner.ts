import type { createPaymentPreparationStore } from './payment-preparation.js';
import type { createWechatChannel, BoundPayment } from './wechat-channel.js';

// Internal operation; public assembly must check principal, policy and seat eligibility
// before reaching this seam. No retry can reclaim SUBMITTING/UNKNOWN in the store.
export function createPaymentPreparationRunner(store: ReturnType<typeof createPaymentPreparationStore>, channel: ReturnType<typeof createWechatChannel>) {
  return async (input: BoundPayment & { id: string; preparationVersion: number }, openid: string) => {
    channel.assertBinding(input);
    const claimed = await store.claim(input);
    try {
      const outcome = await channel.preparePayment(claimed, openid, () => store.assertSendAllowed(claimed));
      if (outcome.kind === 'PREPARED') {
        await store.savePrepared(claimed.id, claimed.preparationVersion, outcome.prepayId);
        return outcome;
      }
      // A previous channel order can exist even though local prepayment acknowledgement
      // was lost. Keep it unresolved until the event/query recovery path processes it.
      await store.markUnknown(claimed.id, claimed.preparationVersion);
      return outcome;
    } catch (error) {
      await store.markUnknown(claimed.id, claimed.preparationVersion);
      throw error;
    }
  };
}
