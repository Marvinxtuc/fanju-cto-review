import {createHash} from 'node:crypto';
import type {Tx} from './domain.js';
const object=(value:unknown):Record<string,unknown>=>value!==null&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
const sha256=(value:string)=>createHash('sha256').update(value).digest('hex');
/** Shared with refund follow-up: absent receipts or a CLOSED field alone are not
 * proof. Require the converged original-channel event and exclude success/conflict. */
export async function verifiedFormalNoFundsClosure(tx:Tx,registrationId:string){
 const intents=await tx.v11PaymentIntent.findMany({where:{registrationId}}),eventIds:string[]=[];
 if(!intents.length||intents.some(i=>i.active||!['NEW','SUBMITTING','UNKNOWN','CLOSED'].includes(i.state)||i.channel!=='wechat'))return {verified:false,eventIds};
 for(const intent of intents){
  const event=await tx.receivedEvent.findUnique({where:{source_merchantScope_eventKey:{source:'wechat-closed-query-v11',merchantScope:intent.merchantScope,eventKey:'PAYMENT_CLOSED:'+intent.id}}}),p=object(event?.normalizedPayload);
  if(!event||event.state==='MANUAL'||event.verificationMaterialId!==intent.providerConfigId||p.kind!=='PAYMENT_CLOSED'||p.sourceId!==intent.id||p.merchantOrderNo!==intent.merchantOrderNo||p.amountCents!==intent.totalCents||p.currency!=='CNY'||event.payloadHash!==sha256(JSON.stringify({kind:p.kind,sourceId:p.sourceId,merchantOrderNo:p.merchantOrderNo,amountCents:p.amountCents,currency:p.currency})))return {verified:false,eventIds:[]};
  const audit=await tx.auditLog.findFirst({where:{action:'funding.v11-closed-query-converged',targetType:'ReceivedEvent',targetId:event.id}}),proof=object(audit?.metadata);
  if(proof.scope!=='CHANNEL_CLOSURE_OBSERVATION_ONLY'||proof.intentId!==intent.id
   ||await tx.receivedEvent.count({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,normalizedPayload:{path:['sourceId'],equals:intent.id}}})>0
   ||await tx.receivedEvent.count({where:{source:'wechat-closed-query-v11',merchantScope:intent.merchantScope,eventKey:{startsWith:'PAYMENT_CLOSED:'+intent.id+':conflict:'},state:'MANUAL'}})>0)return {verified:false,eventIds:[]};
  eventIds.push(event.id);
 }
 if(await tx.v11ReceiptBinding.count({where:{registrationId}})>0||await tx.channelReceipt.count({where:{OR:intents.map(i=>({channel:i.channel,merchantScope:i.merchantScope,merchantOrderNo:i.merchantOrderNo}))}})>0)return {verified:false,eventIds:[]};
 return {verified:true,eventIds};
}
export async function formalRejoinSafety(tx:Tx,userId:string,activityId:string){
 const rows=await tx.v11Registration.findMany({where:{userId,activityId,snapshot:{path:['priceScope'],equals:'FORMAL_QUOTE'}}});
 if(!rows.length)return {state:'NO_PRIOR_REGISTRATION' as const,blockerIds:[],proofKind:null,eventIds:[]};
 const eventIds:string[]=[];
 for(const row of rows){
  const closure=await verifiedFormalNoFundsClosure(tx,row.id);
  const refunds=await tx.v11RefundInstruction.count({where:{registrationId:row.id,state:{not:'CONFIRMED'}}});
  const duties=await tx.v11Request.count({where:{registrationId:row.id,kind:{in:['FORMAL_MANDATORY_REFUND','FORMAL_REFUND_APPLICATION']},state:{notIn:['NO_FUNDS_CHANNEL_CLOSED','REFUND_CONFIRMED','NO_ADDITIONAL_REFUND']}}});
  // Re-entry after collected/refunded money is an OP08 business decision, not an
  // implied right inferred from a refund list or an ended membership.
  if(row.active||!['ENDED','EXPIRED','CANCELED'].includes(row.eligibilityState)||!closure.verified||refunds||duties)return {state:'BLOCKED_POLICY' as const,blockerIds:['OP-08'],proofKind:null,eventIds:[]};
  eventIds.push(...closure.eventIds);
 }
 return {state:'NO_MONEY_CHANNEL_CLOSED' as const,blockerIds:[],proofKind:'VERIFIED_ORIGINAL_CHANNEL_CLOSURE' as const,eventIds};
}
