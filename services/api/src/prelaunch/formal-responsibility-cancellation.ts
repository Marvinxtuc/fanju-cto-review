import type { PrismaClient } from '../generated/prisma/client.js';
import { evaluateCancellation, type PrelaunchTableState } from '@timeleft-shanghai/shared';
import { activityLock, registrationLock, dbNow, object, json, sha256 } from './domain.js';
import { formalCanonicalJson } from './formal-json.js';
import { authorizeHistoricalPolicy, type RuntimeAuthoritySource } from './formal-runtime-policy.js';
import { requireRole, reject, type LocalPrincipal } from './contracts.js';
import { verifyFormalActor } from './formal-supply.js';
import { refreshFormalTable } from './formal-qualification.js';
import { openCase } from '../jobs/queue.js';
import { randomUUID } from 'node:crypto';

export function formalResponsibilityCancellation(db: PrismaClient, source: RuntimeAuthoritySource, owner: string) {
 if (!owner.trim()) throw Error('Formal responsibility cancellation owner required');
 return {
  async propose(actor: LocalPrincipal, activityId: string, businessKey: string) {
   requireRole(actor,'RESTAURANT');
   return db.$transaction(async tx=>{
    await activityLock(tx,activityId);await verifyFormalActor(tx,actor);
    const activity=await tx.activity.findUniqueOrThrow({where:{id:activityId}});
    if(activity.restaurantId!==actor.restaurantId)reject(404,'RESOURCE_NOT_FOUND');
    if(['COMPLETED','CANCELED'].includes(activity.status))reject(409,'RESPONSIBILITY_CANCELLATION_UNAVAILABLE');
    const key='formal-restaurant-cancellation:'+sha256(formalCanonicalJson({actorId:actor.id,activityId,businessKey}));
    const prior=await tx.v11Request.findUnique({where:{businessKey:key}});
    if(prior)return {requestId:prior.id,state:prior.state,activityId,membershipEnded:false,newMoneySubmitted:false};
    const body={scope:'FORMAL_RESTAURANT_CANCELLATION_PROPOSAL',activityId,restaurantId:actor.restaurantId,actorId:actor.id,personId:actor.personId,actorVersion:actor.version};
    const row=await tx.v11Request.create({data:{businessKey:key,kind:'FORMAL_RESPONSIBILITY_CANCELLATION_PROPOSAL',source:'FORMAL_RESTAURANT',blockerIds:[],payload:json(body),state:'PENDING_PLATFORM_APPROVAL',acceptedAt:await dbNow(tx)}});
    await tx.auditLog.create({data:{action:'cancellation.v11-restaurant-proposed',targetType:'V11Request',targetId:row.id,metadata:body}});
    return {requestId:row.id,state:row.state,activityId,membershipEnded:false,newMoneySubmitted:false};
   });
  },
  async accept(actor: LocalPrincipal, activityId: string, input: { businessKey: string; reason:'PLATFORM_CANCEL'|'RESTAURANT_CANCEL'; proposalId?:string|undefined }) {
   requireRole(actor,'OPS');
   return db.$transaction(async tx=>{
    await activityLock(tx,activityId);await verifyFormalActor(tx,actor);
    const activity=await tx.activity.findUniqueOrThrow({where:{id:activityId}});
    const key='formal-responsibility-cancellation:'+sha256(formalCanonicalJson({activityId,businessKey:input.businessKey}));
    const prior=await tx.v11Request.findUnique({where:{businessKey:key}});
    if(prior){const p=object(prior.payload);if(p.reason!==input.reason||p.proposalId!==(input.proposalId??null))reject(409,'IDEMPOTENCY_CONFLICT');return {requestId:prior.id,state:prior.state,...p,newMoneySubmitted:false};}
    if(['COMPLETED','CANCELED'].includes(activity.status))reject(409,'RESPONSIBILITY_CANCELLATION_UNAVAILABLE');
    if(input.reason==='RESTAURANT_CANCEL'){
     if(!input.proposalId)reject(409,'RESTAURANT_CANCELLATION_PROPOSAL_REQUIRED');
     const proposal=await tx.v11Request.findUnique({where:{id:input.proposalId}}),p=object(proposal?.payload);
     const proof=proposal?await tx.auditLog.findFirst({where:{action:'cancellation.v11-restaurant-proposed',targetId:proposal.id}}):null;
     if(!proposal||proposal.kind!=='FORMAL_RESPONSIBILITY_CANCELLATION_PROPOSAL'||proposal.source!=='FORMAL_RESTAURANT'
      ||proposal.state!=='PENDING_PLATFORM_APPROVAL'||p.activityId!==activityId||p.restaurantId!==activity.restaurantId
      ||!proof||formalCanonicalJson(proof.metadata)!==formalCanonicalJson(proposal.payload))reject(409,'RESTAURANT_CANCELLATION_PROVENANCE_INVALID');
    }else if(input.proposalId)reject(400,'PLATFORM_CANCELLATION_PROPOSAL_UNEXPECTED');
    const publication=await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetId:activityId},orderBy:{createdAt:'desc'}});
    const published=object(publication?.metadata);
    const supply=typeof published.supplyId==='string'?await tx.v11SupplyRevision.findUnique({where:{id:published.supplyId}}):null;
    if(!publication||!supply||supply.activityId!==activityId||supply.status!=='FORMAL_APPROVED'
     ||object(supply.snapshot).scope!=='FORMAL_SUPPLY'||supply.digest!==sha256(formalCanonicalJson(supply.snapshot)))reject(409,'FORMAL_RESPONSIBILITY_ACTIVITY_PROVENANCE_REQUIRED');
    const activityRuntime=await authorizeHistoricalPolicy(tx,supply.policyId,'DECIDE_REFUND',source);
    if(published.policyDigest!==activityRuntime.policy.bundleDigest||object(supply.snapshot).environment!==activityRuntime.binding.environment)reject(409,'FORMAL_RESPONSIBILITY_ACTIVITY_PROVENANCE_REQUIRED');
    const at=await dbNow(tx),registrations=await tx.v11Registration.findMany({where:{activityId,active:true,policy:{status:'FORMAL_RUNTIME'}},orderBy:{id:'asc'}});
    const prepared=[],normalOverlaps=[];
    for(const initial of registrations){
     const reg=await registrationLock(tx,initial.id);const runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'DECIDE_REFUND',source);
     const member=await tx.v11Membership.findUnique({where:{registrationId:reg.id},include:{table:true}});
     const attendance=await tx.v11Attendance.findUnique({where:{registrationId:reg.id}});
     const normalRequests=await tx.v11Request.findMany({where:{registrationId:reg.id,kind:'FORMAL_MANDATORY_REFUND',payload:{path:['reason'],equals:'NORMAL_FULFILLMENT'}},select:{id:true,acceptedAt:true,state:true}});
     if(attendance?.restaurantResult==='NORMAL'||normalRequests.length){
      const dispositions=await tx.v11Disposition.findMany({where:{sourceRef:{in:normalRequests.map(r=>r.id)}},select:{id:true,sourceRef:true,kind:true,amountCents:true,state:true}});
      normalOverlaps.push({registrationId:reg.id,attendanceId:attendance?.id??null,fulfillmentConfirmedAt:attendance?.confirmedAt?.toISOString()??null,normalRequests:normalRequests.map(r=>({...r,acceptedAt:r.acceptedAt.toISOString()})),dispositions});
     }
     const tableState=member?.table.state==='UNFORMED'?'WAITING':member?.table.state??'WAITING';
     const rule=evaluateCancellation({startAt:reg.activity.startsAt.getTime(),acceptedAt:at.getTime(),membership:reg.category==='WAITLIST'?'WAITLIST':'FORMAL',
      category:reg.category==='LATE_FORMED'?'LATE_FORMED':reg.category==='ORDINARY'?'ORDINARY':'UNRESOLVED',tableState:tableState as PrelaunchTableState,
      funding:{F:reg.serviceFeeCents,D:reg.depositCents},reason:input.reason});
     if(rule.status!=='READY'||!rule.effect)reject(409,'RESPONSIBILITY_REFUND_RULE_UNAVAILABLE');
     prepared.push({reg,member,runtime,tableState,rule});
    }
    if(normalOverlaps.length){
     const proposal=input.proposalId?await tx.v11Request.findUnique({where:{id:input.proposalId}}):null;
     const payload={scope:'FORMAL_RESPONSIBILITY_FULFILLMENT_RIGHTS_REVIEW',activityId,restaurantId:activity.restaurantId,reason:input.reason,proposalId:input.proposalId??null,
      actorId:actor.id,personId:actor.personId,actorVersion:actor.version,originalRequestAcceptedAt:at.toISOString(),originalProposalAcceptedAt:proposal?.acceptedAt.toISOString()??null,
      registrationIds:prepared.map(p=>p.reg.id),originalRights:prepared.map(p=>({registrationId:p.reg.id,policyId:p.reg.policyId,policyDigest:p.reg.policy.bundleDigest,startsAt:p.reg.activity.startsAt.toISOString(),F:p.reg.serviceFeeCents,D:p.reg.depositCents,tableId:p.member?.tableId??null,tableState:p.tableState,activeMember:p.member?.active??false})),normalOverlaps,
      reviewOwner:owner,reviewRequired:true,cancellationAccepted:false,membershipEnded:false,refundRequestIds:[],compensationRequired:true,compensationAmount:null,compensationState:'AWAITING_PROFESSIONAL_REVIEW',newMoneySubmitted:false};
     const review=await tx.v11Request.create({data:{businessKey:key,kind:'FORMAL_RESPONSIBILITY_CANCELLATION',source:'FORMAL_OPS_INTAKE',payload:json(payload),state:'AWAITING_FULFILLMENT_RIGHTS_REVIEW',blockerIds:['OP-09','RV-02'],acceptedAt:at}});
     await openCase(tx,'V11_RESPONSIBILITY_FULFILLMENT_RIGHTS_REVIEW',review.id,owner);
     await tx.auditLog.create({data:{action:'cancellation.v11-responsibility-rights-review',targetType:'V11Request',targetId:review.id,metadata:json(payload)}});
     return {requestId:review.id,state:review.state,...payload};
    }
    const plannedRefundIds=prepared.map(()=>randomUUID());
    const payload={scope:'FORMAL_RESPONSIBILITY_CANCELLATION',activityId,restaurantId:activity.restaurantId,reason:input.reason,proposalId:input.proposalId??null,
     actorId:actor.id,personId:actor.personId,actorVersion:actor.version,acceptedAt:at.toISOString(),registrationIds:prepared.map(x=>x.reg.id),
     compensationRequired:true,compensationAmount:null,compensationState:'AWAITING_PROFESSIONAL_REVIEW',refundRequestIds:plannedRefundIds,cancellationAccepted:true,membershipEnded:true,newMoneySubmitted:false};
    const cancellation=await tx.v11Request.create({data:{businessKey:key,kind:'FORMAL_RESPONSIBILITY_CANCELLATION',source:'FORMAL_BUSINESS_ROUTE',blockerIds:[],payload:json(payload),state:'CANCELLATION_ACCEPTED_REFUND_PENDING',acceptedAt:at}});
    const refundRequestIds:string[]=[],tableIds=new Set<string>();
    for(const [index,p] of prepared.entries()){
     const {reg,member,runtime}=p;
     const body={scope:'FORMAL_KNOWN_REFUND_DUE',receiptId:null,reason:input.reason,F:reg.serviceFeeCents,D:reg.depositCents,cancellationRequestId:cancellation.id};
     const due=await tx.v11Request.create({data:{id:plannedRefundIds[index]!,businessKey:`formal-responsibility-refund:${cancellation.id}:${reg.id}`,kind:'FORMAL_MANDATORY_REFUND',source:'FORMAL_BUSINESS_ROUTE',blockerIds:[],userId:reg.userId,registrationId:reg.id,payload:json(body),state:'ACCEPTED',acceptedAt:at}});
     refundRequestIds.push(due.id);
     const rights={registrationId:reg.id,activityId,cancellationRequestId:cancellation.id,reason:input.reason,acceptedAt:at.toISOString(),policyId:reg.policyId,policyDigest:reg.policy.bundleDigest,
      parameterDigest:runtime.binding.parameterDigest,authorityId:runtime.grant.id,startsAt:reg.activity.startsAt.toISOString(),F:reg.serviceFeeCents,D:reg.depositCents,
      category:reg.category,tableId:member?.tableId??null,tableState:p.tableState,activeMember:member?.active??false,ruleCode:p.rule.code};
     // Persist original rights before any member or seat mutation.
     await tx.auditLog.create({data:{action:'refund.v11-responsibility-rights',targetType:'V11Request',targetId:due.id,metadata:json(rights)}});
     await tx.auditLog.create({data:{action:'refund.v11-known-obligation',targetType:'V11Request',targetId:due.id,metadata:json(body)}});
     await tx.v11Registration.update({where:{id:reg.id},data:{active:false,eligibilityState:'ENDED',cancelAcceptedAt:at,version:{increment:1}}});
     await tx.v11SeatHold.updateMany({where:{registrationId:reg.id,state:'HELD'},data:{state:'RELEASED',releasedAt:at,version:{increment:1}}});
     if(member?.active){await tx.v11Membership.update({where:{id:member.id},data:{active:false,leftAt:at}});tableIds.add(member.tableId);}
     await tx.v11PaymentIntent.updateMany({where:{registrationId:reg.id,active:true},data:{active:false,version:{increment:1}}});
     await tx.v11DeliveryProof.create({data:{registrationId:reg.id,noticeKey:`formal-responsibility:${cancellation.id}:${reg.id}`,kind:'RESPONSIBILITY_CANCELLATION',state:'CREATED',proofType:'SERVER_INBOX_PENDING'}});
    }
    await tx.activity.update({where:{id:activityId},data:{status:'CANCELED'}});
    // No lifecycle promotion is allowed into the canceled activity.
    for(const tableId of tableIds)await refreshFormalTable(tx,tableId,at);
    if(input.proposalId)await tx.v11Request.update({where:{id:input.proposalId},data:{state:'CANCELLATION_ACCEPTED',version:{increment:1}}});
    await openCase(tx,'V11_RESPONSIBILITY_COMPENSATION_REVIEW',cancellation.id,owner);
    await tx.auditLog.create({data:{action:'cancellation.v11-responsibility-accepted',targetType:'V11Request',targetId:cancellation.id,metadata:json(payload)}});
    return {requestId:cancellation.id,state:cancellation.state,activityId,refundRequestIds,cancellationAccepted:true,membershipEnded:true,compensationRequired:true,compensationAmount:null,newMoneySubmitted:false};
   });
  }
 };
}
