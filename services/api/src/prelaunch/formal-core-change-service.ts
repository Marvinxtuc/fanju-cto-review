import type {PrismaClient, Prisma} from '../generated/prisma/client.js';
import {z} from 'zod';
import {getOwnTableVisibility,assertVisibleCopyAllowed,type PrelaunchTableState} from '@timeleft-shanghai/shared';
import {activityLock,registrationLock,dbNow,object,json,sha256} from './domain.js';
import {formalCanonicalJson} from './formal-json.js';
import {authorizeRuntimePolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {requireRole,reject,type LocalPrincipal} from './contracts.js';
import {verifyFormalActor} from './formal-supply.js';
import {refreshFormalTable} from './formal-qualification.js';
import {openCase} from '../jobs/queue.js';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/), digest=z.string().regex(/^[a-f0-9]{64}$/);
const snapshotSchema=z.object({scope:z.literal('FORMAL_CORE_CHANGE_SNAPSHOT'),activityId:id,supplyId:id,supplyDigest:digest,policyId:id,policyDigest:digest,restaurantId:id,restaurantName:z.string().min(1).max(120),district:z.string().min(1).max(80),businessArea:z.string().min(1).max(120),startsAt:z.string().datetime(),endsAt:z.string().datetime(),F:z.number().int().nonnegative(),D:z.number().int().nonnegative(),min:z.number().int().positive(),target:z.number().int().positive(),max:z.number().int().positive(),maxTables:z.number().int().positive()}).strict();
const approvalSchema=z.object({scope:z.literal('FORMAL_CORE_CHANGE_APPROVAL'),businessKey:id,activityId:id,originalSupplyId:id,originalSupplyDigest:digest,originalSnapshotDigest:digest,policyDigest:digest,proposedSnapshotDigest:digest,proposedSupplyId:id,professionalSignoff:z.literal('APPROVED'),supplySignoff:z.literal('APPROVED')}).strict();
type ChangeLike={id:string;activityId:string;supplyId:string;kind:string;originalSnapshot:unknown;proposedSnapshot:unknown;acceptedAt:Date};
export const formalCoreChangeDigest=(row:ChangeLike)=>sha256(formalCanonicalJson({id:row.id,activityId:row.activityId,supplyId:row.supplyId,kind:row.kind,originalSnapshot:row.originalSnapshot,proposedSnapshot:row.proposedSnapshot,acceptedAt:row.acceptedAt.toISOString()}));
async function supplySnapshot(tx:Prisma.TransactionClient,supplyId:string){
 const supply=await tx.v11SupplyRevision.findUniqueOrThrow({where:{id:supplyId},include:{activity:{include:{restaurant:true}}}}),s=object(supply.snapshot);
 const q=object(s.quote),sp=object(s.supply);
 if(q.F!==supply.serviceFeeCents||q.D!==supply.depositCents||sp.min!==supply.minSize||sp.target!==supply.targetSize||sp.max!==supply.maxSize||sp.maxTables!==supply.maxTables||sp.restaurantId!==supply.restaurantId||sp.activityId!==supply.activityId||sp.revisionId!==supply.id||sp.allocationStrategy!==supply.strategy)reject(409,'CORE_CHANGE_SUPPLY_COLUMNS_CHANGED');
 const audit=await tx.auditLog.findFirst({where:{action:'supply.v11-platform-approved',targetType:'V11SupplyRevision',targetId:supply.id}}),a=object(audit?.metadata);
 const proposal=typeof s.proposalId==='string'?await tx.v11Request.findUnique({where:{id:s.proposalId}}):null,p=object(proposal?.payload),b=object(p.body);
 const restaurantProof=proposal?await tx.auditLog.findFirst({where:{action:'supply.v11-restaurant-proposed',targetId:proposal.id}}):null;
 if(supply.status!=='FORMAL_APPROVED'||s.scope!=='FORMAL_SUPPLY'||supply.digest!==sha256(formalCanonicalJson(supply.snapshot))||!audit||a.supplyDigest!==supply.digest||a.proposalId!==s.proposalId||a.proposalDigest!==s.proposalDigest||!proposal||proposal.state!=='RESOLVED'||proposal.source!=='FORMAL_RESTAURANT'||p.supplyId!==supply.id||p.proposalDigest!==sha256(formalCanonicalJson(b))||p.proposalDigest!==s.proposalDigest||!restaurantProof||object(restaurantProof.metadata).proposalDigest!==p.proposalDigest||b.activityId!==supply.activityId||b.restaurantId!==supply.restaurantId)reject(409,'CORE_CHANGE_SUPPLY_PROVENANCE_INVALID');
 const snapshot=snapshotSchema.parse({scope:'FORMAL_CORE_CHANGE_SNAPSHOT',activityId:supply.activityId,supplyId:supply.id,supplyDigest:supply.digest,policyId:supply.policyId,policyDigest:s.policyDigest,restaurantId:supply.restaurantId,restaurantName:supply.activity.restaurant.name,district:supply.activity.restaurant.district,businessArea:supply.activity.restaurant.businessArea,startsAt:supply.activity.startsAt.toISOString(),endsAt:supply.activity.endsAt.toISOString(),F:supply.serviceFeeCents,D:supply.depositCents,min:supply.minSize,target:supply.targetSize,max:supply.maxSize,maxTables:supply.maxTables});
 assertVisibleCopyAllowed([snapshot.restaurantName,snapshot.district,snapshot.businessArea].join('\n'));
 return {supply,snapshot};
}
export function formalCoreChangeService(db:PrismaClient,source:RuntimeAuthoritySource,owner:string){
 if(!owner.trim())throw Error('Formal core change owner required');
 return {
 async propose(actor:LocalPrincipal,activityId:string,input:{businessKey:string;proposedSupplyId:string}){
  requireRole(actor,'OPS');return db.$transaction(async tx=>{
   const candidate=await tx.v11SupplyRevision.findUniqueOrThrow({where:{id:input.proposedSupplyId}});
   for(const locked of [...new Set([activityId,candidate.activityId])].sort())await activityLock(tx,locked);await verifyFormalActor(tx,actor);
   const publication=await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetType:'Activity',targetId:activityId},orderBy:{createdAt:'desc'}}),pub=object(publication?.metadata);
   if(typeof pub.supplyId!=='string')reject(409,'CORE_CHANGE_ORIGINAL_PUBLICATION_REQUIRED');
   const original=await supplySnapshot(tx,pub.supplyId as string),proposed=await supplySnapshot(tx,input.proposedSupplyId);
   if(original.supply.activityId!==activityId||proposed.supply.activityId===activityId||original.supply.policyId!==proposed.supply.policyId||pub.policyDigest!==original.snapshot.policyDigest||original.snapshot.policyDigest!==proposed.snapshot.policyDigest||['CANCELED','COMPLETED'].includes(original.supply.activity.status))reject(409,'CORE_CHANGE_PROVENANCE_INVALID');
   // Lock the candidate source too. Never modify the already published supply/activity.
   
   if(await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetType:'Activity',targetId:proposed.supply.activityId}}))reject(409,'CORE_CHANGE_CANDIDATE_MUST_BE_UNPUBLISHED');
   const current=await supplySnapshot(tx,input.proposedSupplyId);
   if(formalCanonicalJson(current.snapshot)!==formalCanonicalJson(proposed.snapshot))reject(409,'CORE_CHANGE_CANDIDATE_CHANGED');
   const runtime=await authorizeRuntimePolicy(tx,original.supply.policyId,'CORE_CHANGE_PROPOSE',source);
   const originalSnapshotDigest=sha256(formalCanonicalJson(original.snapshot));
   const expected={scope:'FORMAL_CORE_CHANGE_APPROVAL',businessKey:input.businessKey,activityId,originalSupplyId:original.supply.id,originalSupplyDigest:original.supply.digest,originalSnapshotDigest,policyDigest:runtime.policy.bundleDigest,proposedSnapshotDigest:sha256(formalCanonicalJson(proposed.snapshot)),proposedSupplyId:proposed.supply.id,professionalSignoff:'APPROVED',supplySignoff:'APPROVED'};
   const specialistSchema=z.object({scope:z.literal('FORMAL_CORE_CHANGE_PROFESSIONAL_SIGNOFF'),businessKey:id,activityId:id,originalSupplyDigest:digest,originalSnapshotDigest:digest,proposedSnapshotDigest:digest,conclusion:z.literal('APPROVED')}).strict();
   const specialistExpected={scope:'FORMAL_CORE_CHANGE_PROFESSIONAL_SIGNOFF',businessKey:input.businessKey,activityId,originalSupplyDigest:original.supply.digest,originalSnapshotDigest,proposedSnapshotDigest:expected.proposedSnapshotDigest,conclusion:'APPROVED'};
   const specialist=runtime.grant.evidence.filter(e=>e.responsibility==='CORE_CHANGE_PROFESSIONAL_SIGNOFF').some(e=>{try{return formalCanonicalJson(specialistSchema.parse(JSON.parse(runtime.authority.trust.evidence.get(e.referenceId)!)))===formalCanonicalJson(specialistExpected);}catch{return false;}});
   const bound=runtime.grant.evidence.filter(e=>e.responsibility==='CORE_CHANGE_PROPOSAL').some(e=>{try {const parsed=approvalSchema.parse(JSON.parse(runtime.authority.trust.evidence.get(e.referenceId)!));return formalCanonicalJson(parsed)===formalCanonicalJson(expected);}catch{return false;}});
   if(!bound||!specialist||original.snapshot.policyDigest!==runtime.policy.bundleDigest||object(original.supply.snapshot).environment!==runtime.binding.environment||object(proposed.supply.snapshot).environment!==runtime.binding.environment)reject(503,'CORE_CHANGE_OBJECT_APPROVAL_REQUIRED');
   const key='formal-core-change:'+sha256(formalCanonicalJson({activityId,businessKey:input.businessKey}));
   const prior=await tx.v11CoreChange.findUnique({where:{businessKey:key}});
   if(prior){if(formalCanonicalJson(prior.originalSnapshot)!==formalCanonicalJson(original.snapshot)||formalCanonicalJson(prior.proposedSnapshot)!==formalCanonicalJson(proposed.snapshot))reject(409,'IDEMPOTENCY_CONFLICT');return {changeId:prior.id,state:prior.state,changeDigest:formalCoreChangeDigest(prior),applied:false};}
   const row=await tx.v11CoreChange.create({data:{activityId,supplyId:original.supply.id,businessKey:key,kind:'FORMAL_CORE_CHANGE',originalSnapshot:json(original.snapshot),proposedSnapshot:json(proposed.snapshot),state:'FORMAL_PROPOSED',acceptedAt:await dbNow(tx)}});
   await tx.auditLog.create({data:{action:'change.v11-formal-proposed',targetType:'V11CoreChange',targetId:row.id,metadata:{changeDigest:formalCoreChangeDigest(row),policyDigest:runtime.policy.bundleDigest,authorityId:runtime.grant.id,authorityDigest:sha256(runtime.authority.raw),businessKey:input.businessKey,actorId:actor.id}}});
   return {changeId:row.id,state:row.state,changeDigest:formalCoreChangeDigest(row),applied:false};
  });
 },
 async respond(actor:LocalPrincipal,changeId:string,registrationId:string,choice:'ACCEPT'|'REJECT'){
  requireRole(actor,'USER');return db.$transaction(async tx=>{
   const initial=await tx.v11CoreChange.findUniqueOrThrow({where:{id:changeId}});await activityLock(tx,initial.activityId);await verifyFormalActor(tx,actor);
   const reg=await registrationLock(tx,registrationId);if(reg.userId!==actor.userId)reject(404,'RESOURCE_NOT_FOUND');
   const change=await tx.v11CoreChange.findUniqueOrThrow({where:{id:changeId}}),old=snapshotSchema.parse(change.originalSnapshot),proposed=snapshotSchema.parse(change.proposedSnapshot);
   const proof=await tx.auditLog.findFirst({where:{action:'change.v11-formal-proposed',targetType:'V11CoreChange',targetId:changeId}}),changeDigest=formalCoreChangeDigest(change);
   if(change.state!=='FORMAL_PROPOSED'||change.kind!=='FORMAL_CORE_CHANGE'||!proof||object(proof.metadata).changeDigest!==changeDigest||object(proof.metadata).policyDigest!==reg.policy.bundleDigest||reg.activityId!==change.activityId||reg.supplyId!==change.supplyId||reg.policyId!==old.policyId||reg.policy.status!=='FORMAL_RUNTIME')reject(409,'CORE_CHANGE_FORMAL_PROVENANCE_REQUIRED');
   const prior=await tx.v11ChangeChoice.findUnique({where:{changeId_registrationId:{changeId,registrationId}}});
   if(prior){if(prior.choice!==choice)reject(409,'CORE_CHANGE_CHOICE_CONFLICT');return {choiceId:prior.id,choice:prior.choice,acceptedAt:prior.acceptedAt,membershipEnded:choice==='REJECT',applied:false,newMoneySubmitted:false};}
   if(!reg.active||reg.category==='WAITLIST'||reg.activity.startsAt.toISOString()!==old.startsAt||['CANCELED','COMPLETED'].includes(reg.activity.status))reject(409,'CORE_CHANGE_RESPONSE_UNAVAILABLE');
   const at=await dbNow(tx),member=await tx.v11Membership.findUnique({where:{registrationId},include:{table:true}});
   if(!member?.active||member.joinedAt>change.acceptedAt||reg.acceptedAt>change.acceptedAt||reg.serviceFeeCents!==old.F||reg.depositCents!==old.D)reject(409,'CORE_CHANGE_FORMAL_MEMBERSHIP_REQUIRED');
   if(choice==='ACCEPT'&&old.restaurantId!==proposed.restaurantId&&!formalCoreChangeNameVisible(reg,member))reject(409,'CORE_CHANGE_RESTAURANT_DISCLOSURE_REQUIRED');
   const attendance=choice==='REJECT'?await tx.v11Attendance.findUnique({where:{registrationId}}):null;
   if(choice==='REJECT'&&attendance?.restaurantResult==='NORMAL'){
    const key='formal-core-change-rejection-review:'+change.id+':'+reg.id;
    let review=await tx.v11Request.findUnique({where:{businessKey:key}});
    if(!review){
     const payload={scope:'FORMAL_CORE_CHANGE_FULFILLMENT_REVIEW',changeId,changeDigest,registrationId,requestedChoice:'REJECT',originalChangeAcceptedAt:change.acceptedAt.toISOString(),attendanceId:attendance.id,fulfillmentConfirmedAt:attendance.confirmedAt?.toISOString()??null,membershipEnded:false,newMoneySubmitted:false,originalF:reg.serviceFeeCents,originalD:reg.depositCents,policyDigest:reg.policy.bundleDigest};
     review=await tx.v11Request.create({data:{businessKey:key,kind:'CORE_CHANGE_REJECTION_REVIEW',source:'FORMAL_USER_INTAKE',userId:reg.userId,registrationId,payload:json(payload),acceptedAt:at,state:'AWAITING_FULFILLMENT_RIGHTS_REVIEW',blockerIds:['OP-09','RV-02']}});
     await tx.auditLog.create({data:{action:'change.v11-rejection-review-intake',targetType:'V11Request',targetId:review.id,metadata:json(payload)}});
    }
    await openCase(tx,'V11_CORE_CHANGE_REJECTION_REVIEW',review.id,owner);
    return {requestId:review.id,choice:'REJECT',acceptedAt:review.acceptedAt,pendingReview:true,membershipEnded:false,applied:false,newMoneySubmitted:false};
   }
   const selected=await tx.v11ChangeChoice.create({data:{changeId,registrationId,choice,acceptedAt:at}});
   await tx.auditLog.create({data:{action:'change.v11-formal-choice-accepted',targetType:'V11ChangeChoice',targetId:selected.id,metadata:{changeDigest,registrationId,userId:reg.userId,choice,acceptedAt:at.toISOString()}}});
   if(choice==='REJECT'){
    const body={scope:'FORMAL_KNOWN_REFUND_DUE',receiptId:null,reason:'CORE_CHANGE_REJECTED',F:reg.serviceFeeCents,D:reg.depositCents,changeId,choiceId:selected.id,changeDigest};
    const due=await tx.v11Request.create({data:{businessKey:'formal-core-change-refund:'+selected.id,kind:'FORMAL_MANDATORY_REFUND',source:'FORMAL_BUSINESS_ROUTE',userId:reg.userId,registrationId,payload:json(body),state:'ACCEPTED',blockerIds:[],acceptedAt:at}});
    await tx.auditLog.create({data:{action:'refund.v11-core-change-rights',targetType:'V11Request',targetId:due.id,metadata:{registrationId,userId:reg.userId,policyId:reg.policyId,policyDigest:reg.policy.bundleDigest,supplyId:reg.supplyId,category:reg.category,tableId:member!.tableId,memberExitAt:at.toISOString(),tableState:member!.table.state,startsAt:reg.activity.startsAt.toISOString(),F:reg.serviceFeeCents,D:reg.depositCents,acceptedAt:at.toISOString(),changeId,choiceId:selected.id,changeDigest}}});
    await tx.auditLog.create({data:{action:'refund.v11-known-obligation',targetType:'V11Request',targetId:due.id,metadata:json(body)}});
    await tx.v11Registration.update({where:{id:registrationId},data:{active:false,eligibilityState:'ENDED',cancelAcceptedAt:at,version:{increment:1}}});
    await tx.v11SeatHold.updateMany({where:{registrationId,state:'HELD'},data:{state:'RELEASED',releasedAt:at,version:{increment:1}}});
    await tx.v11Membership.update({where:{id:member!.id},data:{active:false,leftAt:at}});
    await tx.v11PaymentIntent.updateMany({where:{registrationId,active:true},data:{active:false,version:{increment:1}}});
    await refreshFormalTable(tx,member!.tableId,at);
   }
   await openCase(tx,'V11_FORMAL_CORE_CHANGE_RESPONSE',selected.id,owner);
   return {choiceId:selected.id,choice,acceptedAt:at,membershipEnded:choice==='REJECT',applied:false,newMoneySubmitted:false};
  });
 }
 };
}

export function formalCoreChangeNameVisible(reg:{active:boolean;eligibilityState:string},member:{active:boolean;table:{state:string;everFormed:boolean}}|null){
 return getOwnTableVisibility({membership:reg.eligibilityState==='FORMAL'?'FORMAL':'NONE',memberValid:member?.active??false,ownTable:!!member,state:(member?.table.state==='UNFORMED'?'WAITING':member?.table.state??'WAITING') as PrelaunchTableState,everFormed:member?.table.everFormed??false,terminalAccess:reg.active?'ACTIVE':'UNRESOLVED'}).effect?.showName===true;
}
export function formalCoreChangePublicSnapshot(raw:unknown,showName:boolean){
 const s=snapshotSchema.parse(raw);
 return {startsAt:s.startsAt,endsAt:s.endsAt,F:s.F,D:s.D,min:s.min,target:s.target,max:s.max,maxTables:s.maxTables,restaurantName:showName?s.restaurantName:null,district:s.district,businessArea:s.businessArea};
}
