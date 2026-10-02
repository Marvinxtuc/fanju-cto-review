import {isUnsettledPayment} from './unsettled-payment.js';
import type {PrismaClient,Prisma} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {registrationLock,dbNow} from './domain.js';
import {enqueue,openCase} from '../jobs/queue.js';
function assertBinding(binding:ChannelBinding,owner:string){if(binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(binding.merchantScope)||!binding.providerConfigId.trim()||!owner.trim())throw Error('Explicit formal expiry binding required');}
export function createFormalHoldExpirer(db:PrismaClient,binding:ChannelBinding,owner:string){
 assertBinding(binding,owner);
 return async(registrationId:string)=>db.$transaction(tx=>expireFormalHoldInTransaction(tx,registrationId,binding,owner),{timeout:15000});
}
export async function expireFormalHoldInTransaction(tx:Prisma.TransactionClient,registrationId:string,binding:ChannelBinding,owner:string){
 assertBinding(binding,owner);
  const reg=await registrationLock(tx,registrationId),hold=await tx.v11SeatHold.findUnique({where:{registrationId}}),now=await dbNow(tx);
  if(!hold)return {kind:'NO_HOLD' as const};
  if(hold.state==='EXPIRED')return {kind:'ALREADY_EXPIRED' as const};
  if(hold.state!=='HELD'||hold.expiresAt>now)return {kind:'NOT_DUE' as const};
  const intents=await tx.v11PaymentIntent.findMany({where:{registrationId,channel:'wechat'}});
  if(!intents.length||!intents.some(x=>!isUnsettledPayment(x)||x.merchantScope===binding.merchantScope))return {kind:'OUT_OF_SCOPE' as const};
  const member=await tx.v11Membership.findUnique({where:{registrationId}});
  const timelyEvidence=await tx.receivedEvent.count({where:{source:'wechat-query-v11',merchantScope:binding.merchantScope,verifiedAt:{lt:hold.expiresAt},OR:intents.map(x=>({normalizedPayload:{path:['sourceId'],equals:x.id}}))}});
  if((reg.category==='WAITLIST'&&reg.policy.status!=='FORMAL_RUNTIME')||hold.expiresAt.getTime()!==reg.acceptedAt.getTime()+600000||reg.eligibilityState!=='PENDING_PAYMENT'||!reg.active||reg.paidEffectiveAt||reg.cancelAcceptedAt||member||timelyEvidence
   ||intents.some(x=>!isUnsettledPayment(x)||x.merchantScope!==binding.merchantScope||x.providerConfigId!==binding.providerConfigId||x.totalCents!==reg.serviceFeeCents+reg.depositCents)){
   const financialCase=await openCase(tx,'V11_FORMAL_HOLD_EXPIRY_REVIEW',hold.id,owner);
   return {kind:'REVIEW_REQUIRED' as const,caseId:financialCase.id};
  }
  await tx.v11SeatHold.update({where:{id:hold.id},data:{state:'EXPIRED',releasedAt:now,version:{increment:1}}});
  await tx.v11Registration.update({where:{id:reg.id},data:{eligibilityState:'EXPIRED',active:false,version:{increment:1}}});
  // Local submission authority ends. Channel money status remains unchanged.
  await tx.v11PaymentIntent.updateMany({where:{registrationId,channel:'wechat',active:true},data:{active:false,version:{increment:1}}});
  for(const intent of intents){await enqueue(tx,'V11_QUERY_PAYMENT',`v11:formal-expire-query:${intent.id}`,intent.id);await enqueue(tx,'V11_CLOSE_EXPIRED_PAYMENT',`v11:formal-expire-close:${intent.id}`,intent.id);}
  await tx.auditLog.create({data:{action:'qualification.v11-formal-hold-expired',targetType:'V11SeatHold',targetId:hold.id,
   metadata:{scope:'FROZEN_FORMAL_HOLD_EXPIRY_ONLY',registrationId,ruleReference:'DR01-04',effectiveDeadline:hold.expiresAt.toISOString(),observedAt:now.toISOString(),queryCount:intents.length,channelClosed:false,membershipChanged:false}}});
  return {kind:'EXPIRED' as const};
}
export async function scanFormalHoldExpiryBatch(db:PrismaClient,binding:ChannelBinding,owner:string,afterId?:string){
 assertBinding(binding,owner);const clock=await db.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;if(!clock[0])throw Error('Database expiry clock unavailable');
 const rows=await db.v11SeatHold.findMany({where:{state:'HELD',expiresAt:{lte:clock[0].now},...(afterId?{id:{gt:afterId}}:{}),registration:{v11PaymentIntent_registrationId:{some:{channel:'wechat',merchantScope:binding.merchantScope}}}},orderBy:{id:'asc'},take:50,select:{id:true,registrationId:true}});
 const expire=createFormalHoldExpirer(db,binding,owner);const counts={expired:0,review:0,failed:0,skipped:0};
 for(const row of rows){try{const result=await expire(row.registrationId);if(result.kind==='EXPIRED')counts.expired++;else if(result.kind==='REVIEW_REQUIRED')counts.review++;else counts.skipped++;}catch{counts.failed++;}}
 return {counts,nextCursor:rows.length===50?rows[49]!.id:null};
}
