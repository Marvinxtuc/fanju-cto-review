import type {PrismaClient,Prisma} from '../generated/prisma/client.js';
import {validateSupplyRevision,quoteFunding,assertVisibleCopyAllowed} from '@timeleft-shanghai/shared';
import {z} from 'zod';
import {activityLock,dbNow,json,object,sha256} from './domain.js';
import {formalCanonicalJson} from './formal-json.js';
import {authorizeRuntimePolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {requireRole,reject,type LocalPrincipal} from './contracts.js';
import {resolveVerifiedIdentity} from './principal.js';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
export const formalSupplyProposalSchema=z.object({policyId:id,businessKey:id,
 min:z.number().int().min(4).max(8),target:z.number().int().min(4).max(8),max:z.number().int().min(4).max(8),
 maxTables:z.number().int().min(1).max(1000),strategy:z.enum(['FILL_TO_TARGET','FILL_TO_MAX']),
 depositCents:z.number().int().min(0).max(2_147_483_647),waitlistMax:z.number().int().min(0).max(100000).nullable()}).strict();
export type FormalSupplyProposal=z.infer<typeof formalSupplyProposalSchema>;
export async function verifyFormalActor(tx:Prisma.TransactionClient,actor:LocalPrincipal){
 await tx.$queryRaw`SELECT id FROM "V11Actor" WHERE id=${actor.id} FOR SHARE`;
 await resolveVerifiedIdentity({actorId:actor.id,personId:actor.personId,role:actor.role,actorVersion:actor.version,
  userId:actor.userId,restaurantId:actor.restaurantId},id=>tx.v11Actor.findUnique({where:{id}}));
}
export async function publishFormalActivity(db:PrismaClient,actor:LocalPrincipal,activityId:string,supplyId:string,source:RuntimeAuthoritySource){
 requireRole(actor,'OPS');
 return db.$transaction(async tx=>{
  await activityLock(tx,activityId);await verifyFormalActor(tx,actor);
  const activity=await tx.activity.findUniqueOrThrow({where:{id:activityId},include:{restaurant:true}});
  const supply=await tx.v11SupplyRevision.findUniqueOrThrow({where:{id:supplyId}});
  const runtime=await authorizeRuntimePolicy(tx,supply.policyId,'ACTIVITY_PUBLISH',source);
  const snapshot=object(supply.snapshot);
  if(supply.activityId!==activityId||supply.status!=='FORMAL_APPROVED'||snapshot.scope!=='FORMAL_SUPPLY'
   ||snapshot.environment!==runtime.binding.environment||supply.digest!==sha256(formalCanonicalJson(supply.snapshot)))reject(409,'SUPPLY_NOT_APPROVED');
  if(activity.restaurant.status!=='ACTIVE'||activity.registrationEndsAt<=await dbNow(tx)
   ||activity.registrationEndsAt>=activity.startsAt||activity.endsAt<=activity.startsAt)reject(409,'ACTIVITY_PUBLICATION_INVALID');
  assertVisibleCopyAllowed([activity.title,activity.theme,activity.description,activity.mealFeePolicyText,activity.restaurant.name].join('\n'));
  const metadata={supplyId,policyDigest:runtime.policy.bundleDigest,authorityId:runtime.grant.id,actorId:actor.id,actorVersion:actor.version};
  if(['PUBLISHED','REGISTRATION_OPEN'].includes(activity.status)){
   const prior=await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetId:activityId,metadata:{path:['supplyId'],equals:supplyId}}});
   if(!prior)reject(409,'ACTIVITY_PUBLICATION_PROVENANCE_CONFLICT');
   return {activityId,supplyId,state:activity.status};
  }
  if(activity.status!=='DRAFT')reject(409,'ACTIVITY_PUBLICATION_INVALID');
  await tx.activity.update({where:{id:activityId},data:{status:'PUBLISHED'}});
  await tx.auditLog.create({data:{action:'activity.v11-formal-published',targetType:'Activity',targetId:activityId,metadata}});
  return {activityId,supplyId,state:'PUBLISHED'};
 });
}
// A restaurant proposes D and an auditable layout; it cannot set platform F or
// declare approval through a client boolean. Proposal is separate from revision.
export async function proposeFormalSupply(db:PrismaClient,actor:LocalPrincipal,activityId:string,input:FormalSupplyProposal,source:RuntimeAuthoritySource){
 requireRole(actor,'RESTAURANT');const proposal=formalSupplyProposalSchema.parse(input);
 return db.$transaction(async tx=>{
  await activityLock(tx,activityId);await verifyFormalActor(tx,actor);
  const activity=await tx.activity.findUniqueOrThrow({where:{id:activityId},include:{restaurant:true}});
  if(activity.restaurantId!==actor.restaurantId)reject(404,'RESOURCE_NOT_FOUND');
  if(activity.restaurant.status!=='ACTIVE'||!['DRAFT','PUBLISHED','REGISTRATION_OPEN'].includes(activity.status))reject(409,'SUPPLY_ACTIVITY_UNAVAILABLE');
  if(proposal.min>proposal.target||proposal.target>proposal.max)reject(400,'SUPPLY_INVALID');
  const runtime=await authorizeRuntimePolicy(tx,proposal.policyId,'POLICY_RUNTIME',source);
  const body={activityId,restaurantId:actor.restaurantId,policyDigest:runtime.policy.bundleDigest,proposal,
   actorId:actor.id,personId:actor.personId,actorVersion:actor.version,environment:runtime.binding.environment};
  const digest=sha256(formalCanonicalJson(body));
  const key='formal-supply-proposal:'+sha256(JSON.stringify([actor.id,activityId,proposal.businessKey]));
  const prior=await tx.v11Request.findUnique({where:{businessKey:key}});
  if(prior){if(prior.source!=='FORMAL_RESTAURANT'||object(prior.payload).proposalDigest!==digest)reject(409,'IDEMPOTENCY_CONFLICT');return {proposalId:prior.id,acceptedAt:prior.acceptedAt,state:prior.state};}
  const row=await tx.v11Request.create({data:{businessKey:key,kind:'FORMAL_SUPPLY_PROPOSAL',source:'FORMAL_RESTAURANT',
   acceptedAt:await dbNow(tx),state:'PENDING_PLATFORM_APPROVAL',blockerIds:[],payload:json({body,proposalDigest:digest})}});
  await tx.auditLog.create({data:{action:'supply.v11-restaurant-proposed',targetType:'V11Request',targetId:row.id,
   metadata:{proposalDigest:digest,actorId:actor.id,personId:actor.personId,actorVersion:actor.version}}});
  return {proposalId:row.id,acceptedAt:row.acceptedAt,state:row.state};
 });
}
export async function approveFormalSupply(db:PrismaClient,actor:LocalPrincipal,proposalId:string,activityFeeCents:number|null,source:RuntimeAuthoritySource){
 requireRole(actor,'OPS');if(activityFeeCents!==null&&(!Number.isSafeInteger(activityFeeCents)||activityFeeCents<0||activityFeeCents>2_147_483_647))reject(400,'INVALID_PRICE');
 return db.$transaction(async tx=>{
  const initial=await tx.v11Request.findUniqueOrThrow({where:{id:proposalId}});const initialBody=object(object(initial.payload).body);
  if(typeof initialBody.activityId!=='string')reject(409,'FORMAL_SUPPLY_EVIDENCE_INVALID');
  await activityLock(tx,initialBody.activityId);await verifyFormalActor(tx,actor);
  await tx.$queryRaw`SELECT id FROM "V11Request" WHERE id=${proposalId} FOR UPDATE`;
  const request=await tx.v11Request.findUniqueOrThrow({where:{id:proposalId}});const payload=object(request.payload),body=object(payload.body);
  if(request.kind!=='FORMAL_SUPPLY_PROPOSAL'||request.source!=='FORMAL_RESTAURANT'||payload.proposalDigest!==sha256(formalCanonicalJson(body)))reject(409,'FORMAL_SUPPLY_EVIDENCE_INVALID');
  const proposal=formalSupplyProposalSchema.parse(body.proposal);
  const confirmation=await tx.auditLog.findFirst({where:{action:'supply.v11-restaurant-proposed',targetId:request.id,
   metadata:{path:['proposalDigest'],equals:payload.proposalDigest as string}}});
  if(!confirmation)reject(409,'FORMAL_SUPPLY_EVIDENCE_INVALID');
  const activity=await tx.activity.findUniqueOrThrow({where:{id:initialBody.activityId},include:{restaurant:true}});
  if(activity.restaurantId!==body.restaurantId||activity.restaurant.status!=='ACTIVE'
   ||!['DRAFT','PUBLISHED','REGISTRATION_OPEN'].includes(activity.status))reject(409,'SUPPLY_ACTIVITY_UNAVAILABLE');
  const runtime=await authorizeRuntimePolicy(tx,proposal.policyId,'SUPPLY_APPROVE',source);
  if(body.policyDigest!==runtime.policy.bundleDigest||body.environment!==runtime.binding.environment)reject(409,'FORMAL_SUPPLY_EVIDENCE_INVALID');
  const p=runtime.parameters;
  const supplyId='v11s_'+sha256(request.id).slice(0,40);
  const supply={revisionId:supplyId,restaurantId:activity.restaurantId,activityId:activity.id,min:proposal.min,target:proposal.target,max:proposal.max,
   maxTables:proposal.maxTables,allocationStrategy:proposal.strategy,restaurantConfirmed:true,platformApproved:true,
   D:proposal.depositCents,D_MIN:p.depositMinCents,D_MAX:p.depositMaxCents,WAITLIST_MAX:proposal.waitlistMax??p.waitlistMax};
  const quote=quoteFunding({supply,policyBundleId:runtime.policy.bundleDigest,defaultF:p.defaultServiceFeeCents,activityF:activityFeeCents});
  if(quote.status!=='READY'||!quote.effect)return {proposalId,state:'BLOCKED_PARAMETERS',blockerIds:quote.blockerIds,code:quote.code};
  if(supply.WAITLIST_MAX!>0&&p.waitlistExposureCents===null)return {proposalId,state:'BLOCKED_PARAMETERS',blockerIds:['OP-08'],code:'WAITLIST_EXPOSURE_UNRESOLVED'};
  const approvalDigest=sha256(formalCanonicalJson({proposalDigest:payload.proposalDigest,activityFeeCents,parameterDigest:runtime.binding.parameterDigest}));
  if(request.state==='RESOLVED'){
   if(payload.approvalDigest!==approvalDigest||typeof payload.supplyId!=='string')reject(409,'IDEMPOTENCY_CONFLICT');
   return {proposalId,supplyId:payload.supplyId,state:'FORMAL_APPROVED',quote:quote.effect};
  }
  if(request.state!=='PENDING_PLATFORM_APPROVAL')reject(409,'SUPPLY_PROPOSAL_STATE_CONFLICT');
  const existingPublication=await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetType:'Activity',targetId:activity.id}});
  if(existingPublication)return {proposalId,state:'BLOCKED_PARAMETERS',blockerIds:['OP-09'],code:'FORMAL_PUBLISHED_REVISION_CHANGE_REQUIRES_USER_RIGHTS_DECISION'};
  const count=await tx.v11SupplyRevision.aggregate({where:{activityId:activity.id},_max:{revision:true}});
  const snapshot={scope:'FORMAL_SUPPLY',environment:runtime.binding.environment,policyDigest:runtime.policy.bundleDigest,
   parameterDigest:runtime.binding.parameterDigest,parameterVersion:p.version,proposalId,proposalDigest:payload.proposalDigest,
   approvalDigest,restaurantPersonId:body.personId,platformActorId:actor.id,platformPersonId:actor.personId,
   platformActorVersion:actor.version,quote:quote.effect,supply,authorityId:runtime.grant.id};
  const row=await tx.v11SupplyRevision.create({data:{id:supplyId,activityId:activity.id,restaurantId:activity.restaurantId,policyId:proposal.policyId,
   revision:(count._max.revision??0)+1,personId:body.personId as string,minSize:proposal.min,targetSize:proposal.target,maxSize:proposal.max,
   maxTables:proposal.maxTables,capacity:validateSupplyRevision(supply).effect!.capacity,serviceFeeCents:quote.effect.F,depositCents:quote.effect.D,
   waitlistMax:supply.WAITLIST_MAX,strategy:proposal.strategy,snapshot:json(snapshot),digest:sha256(formalCanonicalJson(snapshot)),
   status:'FORMAL_APPROVED',signedAt:await dbNow(tx)}});
  await tx.v11Request.update({where:{id:request.id},data:{state:'RESOLVED',payload:json({...payload,supplyId:row.id,approvalDigest})}});
  await tx.auditLog.create({data:{action:'supply.v11-platform-approved',targetType:'V11SupplyRevision',targetId:row.id,
   metadata:{proposalId,proposalDigest:payload.proposalDigest as string,supplyDigest:row.digest,authorityId:runtime.grant.id,actorId:actor.id,personId:actor.personId}}});
  return {proposalId,supplyId:row.id,state:'FORMAL_APPROVED',quote:quote.effect};
 });
}
