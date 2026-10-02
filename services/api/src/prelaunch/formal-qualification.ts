import {evaluatePaymentQualification,evaluateTableLifecycle,type PrelaunchTableState} from '@timeleft-shanghai/shared';
import type {PrismaClient} from '../generated/prisma/client.js';
import {registrationLock,activityLock,assignFormal,object,json,sha256,requestRecord,type Tx} from './domain.js';
import {authorizeRuntimePolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {reject} from './contracts.js';
import type {createWechatChannel} from './wechat-channel.js';

// Known obligations are durable requests, distinct from approval and channel send.
export async function recordFormalRefundDue(tx:Tx,registrationId:string,receiptId:string,reason:string,at:Date){
 const reg=await tx.v11Registration.findUniqueOrThrow({where:{id:registrationId}});
 if(reason==='LATE_RECEIPT'){
  const responsibility=await tx.v11Request.findFirst({where:{registrationId,kind:'FORMAL_MANDATORY_REFUND',source:'FORMAL_BUSINESS_ROUTE',
   OR:[{payload:{path:['reason'],equals:'PLATFORM_CANCEL'}},{payload:{path:['reason'],equals:'RESTAURANT_CANCEL'}}]}});
  const proof=responsibility?await tx.auditLog.findFirst({where:{action:'refund.v11-responsibility-rights',targetId:responsibility.id}}):null;
  // One activity cancellation owns all original receipts, including a payment
  // discovered later. Do not create a second full-refund duty for the same funds.
  if(responsibility&&proof)return responsibility;
 }
 const body={scope:'FORMAL_KNOWN_REFUND_DUE',receiptId,reason,F:reg.serviceFeeCents,D:reg.depositCents};
 const row=await requestRecord(tx,{businessKey:`formal-refund-due:${receiptId}:${reason}`,kind:'FORMAL_MANDATORY_REFUND',
  userId:reg.userId,registrationId,payload:body,state:'ACCEPTED',acceptedAt:at,source:'FORMAL_BUSINESS_ROUTE'});
 await tx.auditLog.upsert({where:{id:'v11_due_'+sha256(row.id).slice(0,40)},update:{},create:{id:'v11_due_'+sha256(row.id).slice(0,40),
  action:'refund.v11-known-obligation',targetType:'V11Request',targetId:row.id,metadata:body}});
 return row;
}
export async function refreshFormalTable(tx:Tx,tableId:string,at:Date){
 const table=await tx.v11Table.findUniqueOrThrow({where:{id:tableId},include:{activity:true,supply:true}});
 const count=await tx.v11Membership.count({where:{tableId,active:true}});
 const t24=new Date(table.activity.startsAt.getTime()-24*3600000);
 const historical=at>t24&&table.t24FormedAt===null?await tx.v11Membership.count({where:{tableId,joinedAt:{lte:t24},OR:[{leftAt:null},{leftAt:{gt:t24}}]}}):null;
 const decision=evaluateTableLifecycle({state:(table.state==='UNFORMED'?'WAITING':table.state) as PrelaunchTableState,
  activeFormalCount:count,min:table.supply.minSize,max:table.supply.maxSize,startAt:table.activity.startsAt.getTime(),acceptedAt:at.getTime(),
  formedAtT24:table.t24FormedAt!==null?true:at<=t24?null:historical!>=table.supply.minSize,everFormed:table.everFormed});
 if(decision.status==='INVALID_INPUT')reject(409,'FORMAL_TABLE_STATE_INVALID');
 if(decision.effect&&(decision.effect.state!==table.state||decision.effect.action!=='NONE')){
  const e=decision.effect,version=table.version+1;
  await tx.v11Table.update({where:{id:table.id},data:{state:e.state,version,everFormed:table.everFormed||e.state==='FORMED',
   ...(e.state==='FAILED'?{failedAt:at}:{}),...(at.getTime()===t24.getTime()&&e.state==='FORMED'?{t24FormedAt:t24}:{})}});
  await tx.v11TableEvent.create({data:{tableId,businessKey:`formal-table:${tableId}:${version}`,kind:e.action,acceptedAt:at,version,
   snapshot:{scope:'FORMAL_TABLE',count,supplyId:table.supplyId,policyId:table.supply.policyId,state:e.state,blockerIds:decision.blockerIds}}});
  const members=await tx.v11Membership.findMany({where:{tableId,active:true}});
  for(const member of members){
   // Server inbox delivery is a separate, truthful proof; no simulated channel receipt.
   await tx.v11DeliveryProof.create({data:{registrationId:member.registrationId,noticeKey:`formal-table:${tableId}:${version}:${member.registrationId}`,
    kind:`TABLE_${e.action}`,state:'CREATED',proofType:'SERVER_INBOX_PENDING'}});
   if(e.action==='FAIL_AND_REFUND'){
    await tx.v11Membership.update({where:{id:member.id},data:{active:false,leftAt:at}});
    await tx.v11Registration.update({where:{id:member.registrationId},data:{active:false,eligibilityState:'CANCELED',version:{increment:1}}});
    const receipts=await tx.v11ReceiptBinding.findMany({where:{registrationId:member.registrationId}});
    for(const receipt of receipts)await recordFormalRefundDue(tx,member.registrationId,receipt.receiptId,'FORMATION_FAILED',at);
   }
  }
 }
 if(decision.status==='BLOCKED_POLICY')await requestRecord(tx,{businessKey:`formal-table-blocker:${tableId}:${table.version}`,kind:'LOW_PERSON_DECISION',
  payload:{tableId,count,scope:'FORMAL_TABLE'},blockers:decision.blockerIds,acceptedAt:at,source:'FORMAL_BUSINESS_ROUTE'});
 return decision;
}
export function formalQualifier(db:PrismaClient,source:RuntimeAuthoritySource,channel:ReturnType<typeof createWechatChannel>){
 return async(receiptId:string)=>db.$transaction(async tx=>{
  const binding=await tx.v11ReceiptBinding.findUniqueOrThrow({where:{receiptId}});
  if(!binding.registrationId||!binding.intentId)reject(409,'FORMAL_RECEIPT_UNALLOCATED');
  const reg=await registrationLock(tx,binding.registrationId);
  const receipt=await tx.channelReceipt.findUniqueOrThrow({where:{id:receiptId}});
  const intent=await tx.v11PaymentIntent.findUniqueOrThrow({where:{id:binding.intentId}});channel.assertBinding(intent);
  const event=await tx.receivedEvent.findFirst({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,payloadHash:receipt.evidenceHash,verificationMaterialId:intent.providerConfigId}});
  const p=object(event?.normalizedPayload),projection={kind:p.kind,sourceId:p.sourceId,merchantOrderNo:p.merchantOrderNo,channelNo:p.channelNo,amountCents:p.amountCents,currency:p.currency,paidAt:p.paidAt};
  if(!event||!['RECEIPT_RECORDED','APPLIED'].includes(event.state)||sha256(JSON.stringify(projection))!==receipt.evidenceHash||p.kind!=='PAYMENT'
   ||p.sourceId!==intent.id||p.merchantOrderNo!==intent.merchantOrderNo||p.channelNo!==receipt.channelTradeNo||p.amountCents!==receipt.amountCents
   ||p.currency!=='CNY'||typeof p.paidAt!=='string'||new Date(p.paidAt).toISOString()!==receipt.paidAt?.toISOString()
   ||receipt.amountCents!==reg.serviceFeeCents+reg.depositCents)reject(409,'FORMAL_RECEIPT_EVIDENCE_INVALID');
  const already=await tx.auditLog.findFirst({where:{action:'qualification.v11-formal-receipt-applied',targetType:'ChannelReceipt',targetId:receiptId}});
  if(already)return object(already.metadata);
  if(reg.eligibilityState==='PAYMENT_REVIEW'){
   const preserved=await tx.v11Request.findFirst({where:{registrationId:reg.id,kind:'PAYMENT_QUALIFICATION'},orderBy:{acceptedAt:'asc'}});
   return {state:'BLOCKED_POLICY',requestId:preserved?.id,blockerIds:preserved?.blockerIds??['OP-05'],receiptId,acceptedAt:preserved?.acceptedAt};
  }
  const at=event.verifiedAt;
  const result=evaluatePaymentQualification({reservedAt:reg.acceptedAt.getTime(),confirmedAt:at.getTime(),startAt:reg.activity.startsAt.getTime(),status:'SUCCEEDED',
   expected:{F:reg.serviceFeeCents,D:reg.depositCents},received:{F:reg.serviceFeeCents,D:reg.depositCents}});
  const hold=await tx.v11SeatHold.findUniqueOrThrow({where:{registrationId:reg.id}});
  if(binding.classification==='EXTRA'||!reg.active||reg.cancelAcceptedAt||hold.state!=='HELD'||result.effect?.refundRequired.F||result.effect?.refundRequired.D){
   await recordFormalRefundDue(tx,reg.id,receipt.id,binding.classification==='EXTRA'?'EXTRA_PAYMENT':'LATE_RECEIPT',at);
   if(reg.eligibilityState==='PENDING_PAYMENT'){
    await tx.v11Registration.update({where:{id:reg.id},data:{active:false,eligibilityState:'EXPIRED',version:{increment:1}}});
    if(hold.state==='HELD')await tx.v11SeatHold.update({where:{id:hold.id},data:{state:'EXPIRED',releasedAt:at,version:{increment:1}}});
   }
   await tx.v11PaymentIntent.update({where:{id:intent.id},data:{state:'SUCCEEDED',active:false,version:{increment:1}}});
   const metadata={state:'REFUND_DUE',receiptId,registrationId:reg.id};
   await tx.auditLog.create({data:{action:'qualification.v11-formal-receipt-applied',targetType:'ChannelReceipt',targetId:receipt.id,metadata}});return metadata;
  }
  const runtime=await authorizeRuntimePolicy(tx,reg.policyId,'RECORD_PAYMENT',source);channel.assertBinding(runtime.binding);
  if(result.status!=='READY'||result.effect?.qualification!=='FORMAL_OR_WAITLIST'){
   const request=await requestRecord(tx,{businessKey:`formal-qualification:${receiptId}`,kind:'PAYMENT_QUALIFICATION',registrationId:reg.id,userId:reg.userId,
    payload:{receiptId,code:result.code},blockers:result.blockerIds,acceptedAt:at,source:'FORMAL_BUSINESS_ROUTE'});
   if(result.effect?.releaseReservation){
    await tx.v11SeatHold.update({where:{id:hold.id},data:{state:'RELEASED',releasedAt:at,version:{increment:1}}});
    await tx.v11Registration.update({where:{id:reg.id},data:{active:false,eligibilityState:'PAYMENT_REVIEW',version:{increment:1}}});
   }
   return {state:'BLOCKED_POLICY',requestId:request.id,blockerIds:result.blockerIds};
  }
  if(reg.category==='WAITLIST'){
   if(runtime.parameters.fifoClock===null||runtime.parameters.fifoTieBreak===null)reject(409,'FORMAL_FIFO_UNRESOLVED',['OP-05']);
   if(reg.queueOrdinal===null)reject(409,'FORMAL_FIFO_ORDINAL_REQUIRED',['OP-05']);
   await tx.v11Registration.update({where:{id:reg.id},data:{eligibilityState:'WAITLIST',paidEffectiveAt:at,version:{increment:1}}});
  }else await assignFormal(tx,reg,at,{refresh:refreshFormalTable,audit:(tx,tableId)=>tx.auditLog.create({data:{action:'table.v11-formal-soft-tiebreak',targetType:'V11Table',targetId:tableId,metadata:{scope:'FORMAL_TABLE'}}})});
  await tx.v11SeatHold.update({where:{id:hold.id},data:{state:'RELEASED',releasedAt:at,version:{increment:1}}});
  await tx.v11PaymentIntent.update({where:{id:intent.id},data:{state:'SUCCEEDED',active:false,version:{increment:1}}});
  const metadata={state:reg.category==='WAITLIST'?'WAITLIST':'FORMAL',receiptId,registrationId:reg.id,effectiveAt:at.toISOString(),authorityId:runtime.grant.id};
  await tx.auditLog.create({data:{action:'qualification.v11-formal-receipt-applied',targetType:'ChannelReceipt',targetId:receipt.id,metadata:json(metadata)}});return metadata;
 });
}

/** Automatic promotion retains the accepted ordinal and original funded terms.
 * The configured clock selects order; the activity transaction serializes exits. */
export async function promoteFormalWaitlist(tx:Tx,activityId:string,at:Date,source:RuntimeAuthoritySource){
 await activityLock(tx,activityId);const activity=await tx.activity.findUniqueOrThrow({where:{id:activityId}});
 if(!['PUBLISHED','REGISTRATION_OPEN'].includes(activity.status)||at>=activity.registrationEndsAt||at.getTime()>=activity.startsAt.getTime()-24*3600000)return;
 const rows=await tx.v11Registration.findMany({where:{activityId,active:true,eligibilityState:'WAITLIST',policy:{status:'FORMAL_RUNTIME'}},include:{supply:{include:{policy:true}}}});
 const candidates=[];
 for(const reg of rows){
  const runtime=await authorizeRuntimePolicy(tx,reg.policyId,'RECORD_PAYMENT',source);
  if(!runtime.parameters.fifoClock||!runtime.parameters.fifoTieBreak||reg.queueOrdinal===null||!reg.paidEffectiveAt){await requestRecord(tx,{businessKey:'formal-promotion-blocked:'+reg.id,kind:'WAITLIST_PROMOTION',registrationId:reg.id,userId:reg.userId,payload:{scope:'FORMAL_WAITLIST',originalAcceptedAt:reg.acceptedAt},blockers:['OP-05'],source:'FORMAL_BUSINESS_ROUTE',acceptedAt:at});return;}
  candidates.push({reg,clock:runtime.parameters.fifoClock,at:runtime.parameters.fifoClock==='REGISTRATION_ACCEPTED'?reg.acceptedAt:reg.paidEffectiveAt});
 }
 if(new Set(candidates.map(c=>c.clock)).size>1){await requestRecord(tx,{businessKey:'formal-promotion-clock-conflict:'+activityId,kind:'WAITLIST_PROMOTION',payload:{scope:'FORMAL_WAITLIST',policyIds:rows.map(r=>r.policyId)},blockers:['OP-05','OP-09'],source:'FORMAL_BUSINESS_ROUTE',acceptedAt:at});return;}
 candidates.sort((a,b)=>a.at.getTime()-b.at.getTime()||(a.reg.queueOrdinal!<b.reg.queueOrdinal!?-1:a.reg.queueOrdinal!>b.reg.queueOrdinal!?1:0));
 for(const {reg,clock} of candidates){
  const members=await tx.v11Membership.count({where:{active:true,registration:{activityId}}}),holds=await tx.v11SeatHold.count({where:{state:'HELD',expiresAt:{gt:at},registration:{activityId,category:{not:'WAITLIST'}}}});
  if(members+holds>=reg.supply.capacity)break;
  await assignFormal(tx,reg,at,{refresh:refreshFormalTable,audit:(tx,tableId)=>tx.auditLog.create({data:{action:'table.v11-formal-soft-tiebreak',targetType:'V11Table',targetId:tableId,metadata:{scope:'FORMAL_TABLE'}}})});
  await tx.v11Registration.update({where:{id:reg.id},data:{category:'ORDINARY',version:{increment:1}}});
  await requestRecord(tx,{businessKey:'formal-promotion:'+reg.id,kind:'WAITLIST_PROMOTION',registrationId:reg.id,userId:reg.userId,payload:{scope:'FORMAL_WAITLIST',clock,originalOrdinal:reg.queueOrdinal!.toString()},source:'FORMAL_BUSINESS_ROUTE',acceptedAt:at,state:'RESOLVED'});
  await tx.v11DeliveryProof.create({data:{registrationId:reg.id,noticeKey:'formal-promotion:'+reg.id,kind:'WAITLIST_PROMOTED',state:'CREATED',proofType:'SERVER_INBOX_PENDING'}});
 }
}
