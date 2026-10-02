import {it,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {recordedRefundObligationView} from './refund-obligation-view.js';
function fixture(){
 const body={kind:'LATE_PAYMENT_FULL_REFUND_OBLIGATION',registrationId:'reg',intentId:'intent',receiptId:'receipt',F:40,D:60,totalCents:100,paidAt:'2026-10-01T00:00:00.000Z',holdExpiresAt:'2026-10-01T00:00:00.000Z',ruleReference:'DR01-04',execution:'PENDING_FORMAL_DISPATCH_AUTHORITY',membershipEffect:'NONE'};
 const event={source:'wechat-late-refund-obligation-v11',state:'APPLIED',eventKey:'LATE_REFUND:receipt',merchantScope:'scope',verificationMaterialId:'config',verifiedAt:new Date(),normalizedPayload:body,payloadHash:createHash('sha256').update(JSON.stringify(body)).digest('hex')};
 const receipt={id:'receipt',channel:'wechat',merchantScope:'scope',merchantOrderNo:'order',currency:'CNY',amountCents:100,paidAt:new Date(body.paidAt)};
 const intent={id:'intent',registrationId:'reg',channel:'wechat',merchantScope:'scope',merchantOrderNo:'order',totalCents:100,providerConfigId:'config'};
 const components=[{receiptId:'receipt',kind:'F',originalCents:40},{receiptId:'receipt',kind:'D',originalCents:60}];
 return {event:event as any,receipt:receipt as any,intent:intent as any,components:components as any};
}
it('reconstructs JSONB order and reports a confirmed partial refund without reducing the original obligation',()=>{const f=fixture();f.event.normalizedPayload=Object.fromEntries(Object.entries(f.event.normalizedPayload).reverse());const result=recordedRefundObligationView(f.event,'reg',f.receipt,f.intent,f.components,[{receiptId:'receipt',state:'CONFIRMED',totalCents:40}] as any);expect(result?.amountCents).toBe(100);expect(result?.remainingCents).toBe(60);expect(result?.state).toBe('AWAITING_EXECUTION');});
it('rejects tampered amount, hash, config, foreign owner or invalid components',()=>{const f=fixture();for(const event of [{...f.event,payloadHash:'bad'},{...f.event,state:'MANUAL'},{...f.event,verificationMaterialId:'other'},{...f.event,normalizedPayload:{...f.event.normalizedPayload,totalCents:99}},{...f.event,normalizedPayload:{...f.event.normalizedPayload,extra:'not-allowed'}}])expect(recordedRefundObligationView(event,'reg',f.receipt,f.intent,f.components,[])).toBeNull();expect(recordedRefundObligationView(f.event,'foreign-reg',f.receipt,f.intent,f.components,[])).toBeNull();expect(recordedRefundObligationView(f.event,'reg',f.receipt,f.intent,[],[])).toBeNull();});
