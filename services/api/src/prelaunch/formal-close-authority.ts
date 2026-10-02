import type {V11PaymentIntent,V11Registration} from '../generated/prisma/client.js';
import {dbNow,object,type Tx} from './domain.js';
import {isUnsettledPayment} from './unsettled-payment.js';
// Shared evidence check for scheduling and send-time fencing. No writes or I/O.
export async function hasFormalExpiryCloseAuthority(tx:Tx,reg:V11Registration,intent:V11PaymentIntent){
   if(intent.registrationId!==reg.id||intent.channel!=='wechat'||intent.active||!isUnsettledPayment(intent)
    ||reg.active||reg.eligibilityState!=='EXPIRED'||reg.paidEffectiveAt||reg.cancelAcceptedAt||intent.totalCents!==reg.serviceFeeCents+reg.depositCents)return false;
   if(reg.category==='WAITLIST'&&(await tx.v11PolicySnapshot.findUniqueOrThrow({where:{id:reg.policyId}})).status!=='FORMAL_RUNTIME')return false;
   const hold=await tx.v11SeatHold.findUnique({where:{registrationId:reg.id}}),now=await dbNow(tx);
   if(!hold||hold.state!=='EXPIRED'||!hold.releasedAt||hold.releasedAt<hold.expiresAt||hold.expiresAt>now||hold.expiresAt.getTime()!==reg.acceptedAt.getTime()+600000)return false;
   const audit=await tx.auditLog.findFirst({where:{action:'qualification.v11-formal-hold-expired',targetType:'V11SeatHold',targetId:hold.id,metadata:{path:['effectiveDeadline'],equals:hold.expiresAt.toISOString()}}});
   const metadata=object(audit?.metadata),query=await tx.durableJob.findUnique({where:{businessKey:`v11:formal-expire-query:${intent.id}`}});
   if(metadata.scope!=='FROZEN_FORMAL_HOLD_EXPIRY_ONLY'||metadata.registrationId!==reg.id||metadata.channelClosed!==false||metadata.membershipChanged!==false||query?.kind!=='V11_QUERY_PAYMENT'||query.refId!==intent.id)return false;
   const intents=await tx.v11PaymentIntent.findMany({where:{registrationId:reg.id},select:{id:true,channel:true,merchantScope:true,merchantOrderNo:true}});
   if(await tx.v11Membership.count({where:{registrationId:reg.id}})
    ||await tx.channelReceipt.count({where:{OR:intents.map(x=>({channel:x.channel,merchantScope:x.merchantScope,merchantOrderNo:x.merchantOrderNo}))}})
    ||await tx.receivedEvent.count({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,OR:intents.map(x=>({normalizedPayload:{path:['sourceId'],equals:x.id}}))}}))return false;
 return true;
}

/** OP04 unpaid cancellation ends local collection. The original order can be
 * closed only using its committed ordinary exit, rights and durable query. */
export async function hasFormalCancelledCloseAuthority(tx:Tx,reg:V11Registration,intent:V11PaymentIntent){
 if(intent.registrationId!==reg.id||intent.channel!=='wechat'||intent.active||!isUnsettledPayment(intent)||reg.active||reg.eligibilityState!=='ENDED'||reg.paidEffectiveAt||!reg.cancelAcceptedAt||intent.totalCents!==reg.serviceFeeCents+reg.depositCents)return false;
 const request=await tx.v11Request.findFirst({where:{registrationId:reg.id,kind:'FORMAL_REFUND_APPLICATION',source:'FORMAL_USER_INTAKE'},orderBy:[{acceptedAt:'asc'},{id:'asc'}]});
 if(!request||request.acceptedAt.getTime()!==reg.cancelAcceptedAt.getTime()||object(request.payload).requestCategory!=='ORDINARY_CANCEL')return false;
 const rights=await tx.auditLog.findFirst({where:{action:'refund.v11-formal-acceptance-rights',targetId:request.id}}),exit=await tx.auditLog.findFirst({where:{action:'refund.v11-formal-member-exit-at-intake',targetId:request.id}});
 const snapshot=object(rights?.metadata),proof=object(exit?.metadata),policy=await tx.v11PolicySnapshot.findUniqueOrThrow({where:{id:reg.policyId}});
 if(policy.status!=='FORMAL_RUNTIME'||snapshot.registrationId!==reg.id||snapshot.policyDigest!==policy.bundleDigest||snapshot.acceptedAt!==request.acceptedAt.toISOString()||snapshot.activeMember!==false||snapshot.F!==reg.serviceFeeCents||snapshot.D!==reg.depositCents||proof.registrationId!==reg.id||proof.acceptedAt!==request.acceptedAt.toISOString()||proof.decisionSource!=='FJ-OP04-CANCEL-ACCEPTED-20261002-01')return false;
 const hold=await tx.v11SeatHold.findUnique({where:{registrationId:reg.id}}),query=await tx.durableJob.findUnique({where:{businessKey:'v11:formal-cancel-query:'+intent.id}});
 if(!hold||hold.state!=='RELEASED'||hold.releasedAt?.getTime()!==request.acceptedAt.getTime()||query?.kind!=='V11_QUERY_PAYMENT'||query.refId!==intent.id||await tx.v11Membership.count({where:{registrationId:reg.id}}))return false;
 return await tx.v11ReceiptBinding.count({where:{registrationId:reg.id}})===0&&await tx.channelReceipt.count({where:{channel:intent.channel,merchantScope:intent.merchantScope,merchantOrderNo:intent.merchantOrderNo}})===0&&await tx.receivedEvent.count({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,normalizedPayload:{path:['sourceId'],equals:intent.id}}})===0;
}
export async function hasFormalUnpaidCloseAuthority(tx:Tx,reg:V11Registration,intent:V11PaymentIntent){
 return await hasFormalExpiryCloseAuthority(tx,reg,intent)||await hasFormalCancelledCloseAuthority(tx,reg,intent);
}
