import type { PaymentProvider, RefundProvider, ProviderEnv, ChannelPaymentResult } from '../providers.js';
import { bindingFor } from '../funding/intents.js';
import type { ChannelBinding } from '../funding/mock-channel.js';

export type BoundPayment = ChannelBinding & { merchantOrderNo: string; totalCents: number };
export type BoundRefund = ChannelBinding & { merchantRefundNo: string; originalTradeNo: string; totalCents: number };
function fail(): never { throw Error('Wechat channel identity or amount conflict'); }
function amount(value: number) { if (!Number.isSafeInteger(value) || value <= 0 || value > 2_147_483_647) fail(); }
function reference(value: string) { if (!value || value.length > 160 || !/^[A-Za-z0-9_.:-]+$/.test(value)) fail(); }

// Deliberately has no mock-style pay() returning SUCCEEDED. Only query yields a payment fact.
export function createWechatChannel(env: ProviderEnv, payment: PaymentProvider, refund: RefundProvider) {
  if (payment.mode !== 'wechat' || refund.mode !== 'wechat' || !payment.queryPayment || !payment.closePayment || !refund.queryRefund)
    throw Error('Real query-capable payment and refund providers required');
  const expected = bindingFor(env, 'wechat');
  const appId = env.WECHAT_MINIAPP_APP_ID!;
  function assertBinding(input: ChannelBinding) {
    if (input.channel !== expected.channel || input.merchantScope !== expected.merchantScope || input.providerConfigId !== expected.providerConfigId) fail();
  }
  function validate(input: BoundPayment) { assertBinding(input); reference(input.merchantOrderNo); amount(input.totalCents); }
  function paymentFact(input: BoundPayment, value: ChannelPaymentResult) {
    if (value.merchantOrderNo !== input.merchantOrderNo) fail();
    if (value.status === 'NOT_FOUND') return value;
    if (!['SUCCEEDED','PENDING','CLOSED'].includes(value.status) || value.currency !== 'CNY' || value.amountCents !== input.totalCents) fail();
    if (value.status === 'SUCCEEDED' && (!value.channelTradeNo || !value.paidAt || !Number.isFinite(Date.parse(value.paidAt)))) fail();
    return value;
  }
  async function queryPayment(input: BoundPayment) {
    validate(input);
    return paymentFact(input, await payment.queryPayment!(input.merchantOrderNo));
  }
  return {
    assertBinding,
    queryPayment,
    async submitRefund(input: BoundRefund & { merchantOrderNo: string; originalAmountCents: number }, beforeSend: () => Promise<void>) {
      if (typeof beforeSend !== 'function') throw Error('Refund send guard required');
      assertBinding(input); reference(input.merchantRefundNo); reference(input.originalTradeNo); amount(input.totalCents); amount(input.originalAmountCents);
      const original = await queryPayment({ ...input, totalCents: input.originalAmountCents });
      if (original.status !== 'SUCCEEDED' || original.channelTradeNo !== input.originalTradeNo || input.totalCents > original.amountCents) fail();
      await beforeSend();
      const result = await refund.createRefund({ merchantRefundNo: input.merchantRefundNo, merchantOrderNo: input.merchantOrderNo, amountCents: input.totalCents }, beforeSend);
      if (result.channel !== 'wechat') fail();
      return result;
    },
    async preparePayment(input: BoundPayment, openid: string, beforeSend: () => Promise<void>) {
      if (typeof beforeSend !== 'function') throw Error('Payment send guard required');
      validate(input); if (!openid || openid.length > 160) fail();
      const existing = await queryPayment(input);
      if (existing.status !== 'NOT_FOUND') return { kind: 'EXISTING' as const, fact: existing };
      await beforeSend();
      const prepared = await payment.createPayment({ merchantOrderNo: input.merchantOrderNo, amountCents: input.totalCents, openid });
      const p = prepared.paymentParams;
      if (prepared.channel !== 'wechat' || !prepared.prepayId || !p || p.appId !== appId || p.signType !== 'RSA'
        || p.package !== `prepay_id=${prepared.prepayId}` || !/^\d+$/.test(p.timeStamp) || !p.nonceStr || !p.paySign) fail();
      return { kind: 'PREPARED' as const, prepayId: prepared.prepayId, paymentParams: p };
    },
    resumePayment(input: BoundPayment & { prepayId: string }) {
      validate(input);
      if (!input.prepayId || input.prepayId.length > 256 || !payment.resumePayment) fail();
      const params = payment.resumePayment(input.prepayId);
      if (params.appId !== appId || params.signType !== 'RSA' || params.package !== `prepay_id=${input.prepayId}`
        || !/^\d+$/.test(params.timeStamp) || !params.nonceStr || !params.paySign) fail();
      return { kind: 'PREPARED' as const, prepayId: input.prepayId, paymentParams: params };
    },
    async closePayment(input: BoundPayment, beforeSend: () => Promise<void>) {
      if (typeof beforeSend !== 'function') throw Error('Payment closure send guard required');
      const before = await queryPayment(input);
      if (before.status === 'SUCCEEDED' || before.status === 'CLOSED') return before;
      // An absent order is not proof that its merchant number is permanently closed.
      if (before.status === 'NOT_FOUND') throw Error('Payment absent; closure not established');
      await beforeSend();
      try { await payment.closePayment!(input.merchantOrderNo, beforeSend); }
      catch { // A payer may have won the race. Query instead of fabricating a CLOSED result.
        const after = await queryPayment(input);
        if (after.status === 'SUCCEEDED' || after.status === 'CLOSED') return after;
        throw Error('Payment closure remains unknown');
      }
      const after = await queryPayment(input);
      if (after.status !== 'SUCCEEDED' && after.status !== 'CLOSED') throw Error('Payment closure remains unknown');
      return after;
    },
    async queryRefund(input: BoundRefund) {
      assertBinding(input); reference(input.merchantRefundNo); reference(input.originalTradeNo); amount(input.totalCents);
      const value = await refund.queryRefund!(input.merchantRefundNo);
      if (value.status === 'NOT_FOUND') {
        if (value.merchantRefundNo !== input.merchantRefundNo) fail();
        return value;
      }
      if (value.merchantRefundNo !== input.merchantRefundNo || value.originalTradeNo !== input.originalTradeNo
        || value.amountCents !== input.totalCents || value.currency !== 'CNY' || !value.channelRefundNo
        || !['SUCCEEDED','PENDING','CLOSED','FAILED'].includes(value.status)) fail();
      return value;
    },
  };
}
