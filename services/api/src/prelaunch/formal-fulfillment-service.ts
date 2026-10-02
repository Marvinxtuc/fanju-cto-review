import {nextShanghaiNaturalDay} from '@timeleft-shanghai/shared';
import type {PrismaClient} from '../generated/prisma/client.js';
import {registrationLock,dbNow,json,object,requestRecord,sha256} from './domain.js';
import {requireRole,reject,type LocalPrincipal} from './contracts.js';
import {verifyFormalActor} from './formal-supply.js';
import {authorizeHistoricalPolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
export function formalFulfillmentService(db:PrismaClient,source:RuntimeAuthoritySource){
 async function confirm(actor:LocalPrincipal,registrationId:string,result:'NORMAL'|'ABNORMAL'){
  requireRole(actor,'RESTAURANT');
  return db.$transaction(async tx=>{
   const reg=await registrationLock(tx,registrationId);await verifyFormalActor(tx,actor);
   if(reg.activity.restaurantId!==actor.restaurantId)reject(404,'RESOURCE_NOT_FOUND');
   const runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'RECOVER_FUNDS',source),at=await dbNow(tx);
   if(at<reg.activity.endsAt)reject(409,'ACTIVITY_NOT_ENDED');
   if(!reg.active||reg.eligibilityState!=='FORMAL')reject(409,'FORMAL_MEMBERSHIP_REQUIRED');
   const member=await tx.v11Membership.findUnique({where:{registrationId}});
   if(!member?.active)reject(409,'FORMAL_MEMBERSHIP_REQUIRED');
   const prior=await tx.v11Attendance.findUnique({where:{registrationId}});
   if(prior?.restaurantResult&&prior.restaurantResult!==result)reject(409,'FULFILLMENT_RESULT_CONFLICT');
   if(prior?.restaurantResult){
    const audit=await tx.auditLog.findFirst({where:{action:'fulfillment.v11-formal-confirmed',targetType:'V11Attendance',targetId:prior.id}});
    if(!audit||object(audit.metadata).result!==result)reject(409,'FORMAL_FULFILLMENT_PROVENANCE_INVALID');
   }
   const attendance=prior?.restaurantResult?prior:await tx.v11Attendance.upsert({where:{registrationId},create:{registrationId,restaurantActorId:actor.id,restaurantResult:result,confirmedAt:at},update:{restaurantActorId:actor.id,restaurantResult:result,confirmedAt:at,version:{increment:1}}});
   if(!prior?.restaurantResult)await tx.auditLog.create({data:{action:'fulfillment.v11-formal-confirmed',targetType:'V11Attendance',targetId:attendance.id,metadata:{registrationId,result,confirmedAt:at.toISOString(),actorId:actor.id,personId:actor.personId,actorVersion:actor.version,policyDigest:reg.policy.bundleDigest,authorityId:runtime.grant.id}}});
   let request;
   if(result==='NORMAL'){
    const day=nextShanghaiNaturalDay(reg.activity.endsAt.getTime());if(!day.effect)reject(409,'FULFILLMENT_DAY_INVALID');
    const notBefore=new Date(day.effect.date+'T00:00:00+08:00').toISOString();
    const primary=await tx.v11ReceiptBinding.findFirst({where:{registrationId,classification:'PRIMARY'},orderBy:{createdAt:'asc'}});
    const payload={scope:'FORMAL_KNOWN_REFUND_DUE',receiptId:primary?.receiptId??null,reason:'NORMAL_FULFILLMENT',F:0,D:reg.depositCents,notBefore,fulfillmentId:attendance.id};
    request=await requestRecord(tx,{businessKey:'formal-normal-fulfillment:'+registrationId,kind:'FORMAL_MANDATORY_REFUND',source:'FORMAL_BUSINESS_ROUTE',userId:reg.userId,registrationId,acceptedAt:attendance.confirmedAt!,state:'ACCEPTED',payload});
    const original=object(request.payload);if(original.reason!=='NORMAL_FULFILLMENT'||original.F!==0||original.D!==reg.depositCents||original.notBefore!==notBefore)reject(409,'FORMAL_FULFILLMENT_OBLIGATION_CONFLICT');
    await tx.auditLog.upsert({where:{id:'v11_due_'+sha256(request.id).slice(0,40)},update:{},create:{id:'v11_due_'+sha256(request.id).slice(0,40),action:'refund.v11-known-obligation',targetType:'V11Request',targetId:request.id,metadata:json(request.payload)}});
   }else request=await requestRecord(tx,{businessKey:'formal-abnormal-fulfillment:'+registrationId,kind:'FORMAL_FULFILLMENT_REVIEW',source:'FORMAL_BUSINESS_ROUTE',userId:reg.userId,registrationId,acceptedAt:attendance.confirmedAt!,state:'AWAITING_MANUAL_DECISION',blockers:['OP-13','RV-02'],payload:{scope:'FORMAL_FULFILLMENT_REVIEW',result:'ABNORMAL',attendanceId:attendance.id,automaticBreach:false,depositSettlementAllowed:false}});
   await tx.v11DeliveryProof.upsert({where:{noticeKey:'formal-fulfillment:'+registrationId},update:{},create:{noticeKey:'formal-fulfillment:'+registrationId,registrationId,requestId:request.id,kind:result==='NORMAL'?'NORMAL_DEPOSIT_OBLIGATION':'ABNORMAL_REVIEW_PENDING',state:'CREATED',proofType:'SERVER_INBOX_PENDING'}});
   return {registrationId,restaurantResult:result,confirmedAt:attendance.confirmedAt,requestId:request.id,state:request.state,refundConfirmed:false,automaticBreach:false};
  });
 }
 return {confirm};
}
