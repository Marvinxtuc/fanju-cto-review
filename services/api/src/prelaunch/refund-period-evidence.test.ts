import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {trustedRefundCompletionTime} from './refund-period-evidence.js';
function fixture(){
 const refund={id:'refund-a',receiptId:'receipt-a',merchantScope:'synthetic-scope',providerConfigId:'synthetic-v1',merchantRefundNo:'merchant-refund',channelRefundNo:'channel-refund',originalTradeNo:'trade-a',channel:'wechat',state:'CONFIRMED',totalCents:40,serviceFeeCents:40,depositCents:0};
 const receipt={id:'receipt-a',merchantScope:refund.merchantScope,channel:'wechat',channelTradeNo:'trade-a',currency:'CNY',amountCents:100,paidAt:new Date('2026-09-29T02:00:00Z')};
 const payload={kind:'REFUND_COMPLETION_TIME',sourceId:refund.id,receiptId:receipt.id,merchantRefundNo:refund.merchantRefundNo,channelRefundNo:refund.channelRefundNo,originalTradeNo:refund.originalTradeNo,amountCents:40,currency:'CNY',refundedAt:'2026-09-30T02:00:00.000Z'};
 const event={id:'time-event',source:'wechat-refund-time-query-v11',merchantScope:refund.merchantScope,eventKey:'REFUND_TIME:'+refund.channelRefundNo,state:'APPLIED',verificationMaterialId:'synthetic-v1',verifiedAt:new Date('2026-10-01T02:00:00Z'),normalizedPayload:payload,payloadHash:createHash('sha256').update(JSON.stringify(payload)).digest('hex')};
 return {refund:refund as any,receipt:receipt as any,event:event as any};
}
describe('refund completion period evidence',()=>{
 it('uses exact applied trusted-query evidence and ignores local update times',()=>{const {refund,receipt,event}=fixture();refund.updatedAt=new Date('2025-01-01');expect(trustedRefundCompletionTime(refund,receipt,[event])).toEqual({status:'TRUSTED',refundedAt:'2026-09-30T02:00:00.000Z',eventId:'time-event'});expect(trustedRefundCompletionTime(refund,receipt,[])).toEqual({status:'MISSING'});});
 it('rejects conflicting siblings and non-applied evidence',()=>{const {refund,receipt,event}=fixture();for(const events of [[{...event,state:'MANUAL'}],[event,{...event,eventKey:event.eventKey+':conflict:other',state:'MANUAL'}]])expect(trustedRefundCompletionTime(refund,receipt,events)).toEqual({status:'CONFLICT'});});
 it('checks exact payload hash, material, amount, scope and extra fields',()=>{const {refund,receipt,event}=fixture();for(const altered of [{...event,payloadHash:'bad'},{...event,verificationMaterialId:'other'},{...event,normalizedPayload:{...event.normalizedPayload,amountCents:39}},{...event,normalizedPayload:{...event.normalizedPayload,extra:'not-allowed'}}])expect(trustedRefundCompletionTime(refund,receipt,[altered])).toEqual({status:'CONFLICT'});expect(trustedRefundCompletionTime(refund,{...receipt,channelTradeNo:'wrong'},[event])).toEqual({status:'CONFLICT'});});
 it('does not use CSV or notification sources as completion authority',()=>{const {refund,receipt,event}=fixture();for(const source of ['wechat-bill-observation-v11','wechat-refund-notify-trigger-v11'])expect(trustedRefundCompletionTime(refund,receipt,[{...event,source}])).toEqual({status:'MISSING'});});
 it('uses independent verified notification time and requires exact corroboration from both sources',()=>{
  const {refund,receipt,event}=fixture(),notify={...event,id:'notify-time',source:'wechat-refund-time-notify-v11'};
  expect(trustedRefundCompletionTime(refund,receipt,[notify]).status).toBe('TRUSTED');expect(trustedRefundCompletionTime(refund,receipt,[event,notify]).status).toBe('TRUSTED');
  for(const other of [{...notify,payloadHash:'changed'},{...notify,normalizedPayload:{...notify.normalizedPayload,amountCents:39}},{...notify,verifiedAt:new Date(NaN)},{...notify,state:'MANUAL'},{...notify,verificationMaterialId:'wrong'}])expect(trustedRefundCompletionTime(refund,receipt,[event,other]).status).toBe('CONFLICT');
 });
 it('rejects time before payment or later than verified observation and invalid local money',()=>{const {refund,receipt,event}=fixture();expect(trustedRefundCompletionTime(refund,{...receipt,paidAt:new Date('2026-10-01')},[event])).toEqual({status:'CONFLICT'});expect(trustedRefundCompletionTime(refund,receipt,[{...event,verifiedAt:new Date('2026-09-28')}])).toEqual({status:'CONFLICT'});expect(trustedRefundCompletionTime({...refund,totalCents:150},receipt,[event])).toEqual({status:'CONFLICT'});});
});
