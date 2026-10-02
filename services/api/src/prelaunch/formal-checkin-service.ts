import {loadCheckinProfessionalApproval,checkinProfessionalRulesDigest} from './formal-checkin-professional.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import {activityLock,registrationLock,dbNow,object,sha256,json} from './domain.js';
import {formalCanonicalJson} from './formal-json.js';
import {requireRole,requireOwner,reject,type LocalPrincipal} from './contracts.js';
import {verifyFormalActor} from './formal-supply.js';
import {authorizeHistoricalPolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import type {loadFormalCheckinSigning} from './formal-checkin-signing.js';
export async function formalCheckinDetail(db:PrismaClient,actor:LocalPrincipal,registrationId:string){
 requireRole(actor,'USER');
 return db.$transaction(async tx=>{
  const reg=await registrationLock(tx,registrationId);await verifyFormalActor(tx,actor);requireOwner(actor,reg.userId);
  const attendance=await tx.v11Attendance.findUnique({where:{registrationId}});
  if(!attendance?.checkinAt)return {registrationId,checkinAt:null,scope:'FORMAL_CHECKIN',fulfillmentConfirmed:false};
  const proof=await tx.auditLog.findFirst({where:{action:'checkin.v11-formal-recorded',targetId:attendance.id}}),fact=object(proof?.metadata);
  if(!proof)return {registrationId,checkinAt:null,scope:'FORMAL_CHECKIN',legacyCheckinPresent:true,fulfillmentConfirmed:false};
  if(fact.registrationId!==registrationId||fact.checkinAt!==attendance.checkinAt.toISOString()||fact.qrDigest!==attendance.qrDigest)reject(409,'FORMAL_CHECKIN_FACT_PROVENANCE_INVALID');
  return {registrationId,checkinAt:attendance.checkinAt,scope:'FORMAL_CHECKIN',fulfillmentConfirmed:false};
 });
}
export function formalCheckinService(db:PrismaClient,source:RuntimeAuthoritySource,signing:ReturnType<typeof loadFormalCheckinSigning>,professional:ReturnType<typeof loadCheckinProfessionalApproval>){
 return {
  async issue(actor:LocalPrincipal,activityId:string,supplyId:string){
   requireRole(actor,'RESTAURANT');
   return db.$transaction(async tx=>{
    await activityLock(tx,activityId);await verifyFormalActor(tx,actor);
    const activity=await tx.activity.findUniqueOrThrow({where:{id:activityId}});
    if(activity.restaurantId!==actor.restaurantId)reject(404,'RESOURCE_NOT_FOUND');
    if(activity.status==='CANCELED')reject(409,'CHECKIN_ACTIVITY_CANCELED');
    const supply=await tx.v11SupplyRevision.findUnique({where:{id:supplyId}});
    const publication=await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetId:activityId,metadata:{path:['supplyId'],equals:supplyId}}});
    if(!publication||!supply||supply.activityId!==activityId||supply.status!=='FORMAL_APPROVED'
     ||object(supply.snapshot).scope!=='FORMAL_SUPPLY'||supply.digest!==sha256(formalCanonicalJson(supply.snapshot)))reject(409,'FORMAL_CHECKIN_SUPPLY_PROVENANCE_REQUIRED');
    const runtime=await authorizeHistoricalPolicy(tx,supply.policyId,'CHECKIN_ISSUE',source);
    if(object(publication.metadata).policyDigest!==runtime.policy.bundleDigest||runtime.binding.environment!==signing.environment)reject(409,'FORMAL_CHECKIN_ENVIRONMENT_INVALID');
    const at=await dbNow(tx),signedApproval=professional({environment:signing.environment,activityId,restaurantId:activity.restaurantId,supplyId,supplyDigest:supply.digest,policyId:supply.policyId,policyDigest:runtime.policy.bundleDigest,signingKeyId:signing.keyId,technicalTtlSeconds:signing.technicalTtlSeconds},at,signing.publicKeySha256),claims={scope:'FORMAL_CHECKIN' as const,audience:'fanju-formal-attendance' as const,environment:signing.environment,
     keyId:signing.keyId,professionalApprovalId:signedApproval.approval.id,professionalApprovalDigest:signedApproval.digest,rulesDigest:checkinProfessionalRulesDigest,activityId,restaurantId:activity.restaurantId,supplyId,policyId:supply.policyId,policyDigest:runtime.policy.bundleDigest,
     issuerActorId:actor.id,issuerPersonId:actor.personId,issuerActorVersion:actor.version,authorityId:runtime.grant.id,
     nonce:signing.nonce(),issuedAt:at.getTime(),expiresAt:at.getTime()+signing.technicalTtlSeconds*1000};
    const token=signing.sign(claims);
    await tx.auditLog.create({data:{action:'checkin.v11-formal-token-issued',targetType:'Activity',targetId:activityId,metadata:json({...claims,tokenDigest:sha256(token),businessWindowDetermined:false})}});
    return {scope:'FORMAL_CHECKIN',token,activityId,supplyId,expiresAt:new Date(claims.expiresAt),engineeringTtlSeconds:signing.technicalTtlSeconds,businessWindowDetermined:false,qrEncoding:'LOCAL_CLIENT_GIF'};
   });
  },
  async record(actor:LocalPrincipal,registrationId:string,token:string){
   requireRole(actor,'USER');
   return db.$transaction(async tx=>{
    const reg=await registrationLock(tx,registrationId);await verifyFormalActor(tx,actor);requireOwner(actor,reg.userId);
    const at=await dbNow(tx);let claims;
    try{claims=signing.verify(token,at.getTime());}catch{reject(400,'INVALID_OR_EXPIRED_FORMAL_CHECKIN_TOKEN');}
    const runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'CHECKIN_RECORD',source);
    const issuingRuntime=await authorizeHistoricalPolicy(tx,reg.policyId,'CHECKIN_ISSUE',source);
    if(issuingRuntime.grant.id!==claims.authorityId)reject(409,'FORMAL_CHECKIN_ISSUANCE_AUTHORITY_CHANGED');
    const member=await tx.v11Membership.findUnique({where:{registrationId}});
    if(!reg.active||reg.eligibilityState!=='FORMAL'||!member?.active||reg.activity.status==='CANCELED')reject(409,'FORMAL_MEMBERSHIP_REQUIRED');
    if(claims.activityId!==reg.activityId||claims.restaurantId!==reg.activity.restaurantId||claims.supplyId!==reg.supplyId||claims.policyId!==reg.policyId
     ||claims.policyDigest!==reg.policy.bundleDigest||claims.environment!==runtime.binding.environment)reject(409,'FORMAL_CHECKIN_SCOPE_MISMATCH');
    const supply=await tx.v11SupplyRevision.findUnique({where:{id:reg.supplyId}});
    if(!supply||supply.status!=='FORMAL_APPROVED'||supply.digest!==sha256(formalCanonicalJson(supply.snapshot)))reject(409,'FORMAL_CHECKIN_SUPPLY_PROVENANCE_REQUIRED');
    const signedApproval=professional({environment:signing.environment,activityId:reg.activityId,restaurantId:reg.activity.restaurantId,supplyId:reg.supplyId,supplyDigest:supply.digest,policyId:reg.policyId,policyDigest:reg.policy.bundleDigest,signingKeyId:signing.keyId,technicalTtlSeconds:signing.technicalTtlSeconds},at,signing.publicKeySha256);
    if(claims.professionalApprovalId!==signedApproval.approval.id||claims.professionalApprovalDigest!==signedApproval.digest||claims.rulesDigest!==checkinProfessionalRulesDigest)reject(409,'FORMAL_CHECKIN_PROFESSIONAL_APPROVAL_CHANGED');
    await tx.$queryRaw`SELECT id FROM "V11Actor" WHERE id=${claims.issuerActorId} FOR SHARE`;
    const issuer=await tx.v11Actor.findUnique({where:{id:claims.issuerActorId}});
    if(!issuer||!issuer.enabled||issuer.role!=='RESTAURANT'||issuer.restaurantId!==claims.restaurantId||issuer.personId!==claims.issuerPersonId||issuer.version!==claims.issuerActorVersion)reject(409,'FORMAL_CHECKIN_ISSUER_REVOKED');
    const issued=await tx.auditLog.findFirst({where:{action:'checkin.v11-formal-token-issued',targetId:reg.activityId,metadata:{path:['tokenDigest'],equals:sha256(token)}}});
    if(!issued||object(issued.metadata).authorityId!==claims.authorityId)reject(409,'FORMAL_CHECKIN_ISSUANCE_PROVENANCE_INVALID');
    const prior=await tx.v11Attendance.findUnique({where:{registrationId}});
    if(prior?.checkinAt){
     const proof=await tx.auditLog.findFirst({where:{action:'checkin.v11-formal-recorded',targetId:prior.id}});
     if(!proof||object(proof.metadata).registrationId!==reg.id||object(proof.metadata).checkinAt!==prior.checkinAt.toISOString()
      ||object(proof.metadata).qrDigest!==prior.qrDigest)reject(409,'FORMAL_CHECKIN_FACT_PROVENANCE_INVALID');
     return {registrationId,checkinAt:prior.checkinAt,scope:'FORMAL_CHECKIN',idempotent:true,fulfillmentConfirmed:false};
    }
    const attendance=await tx.v11Attendance.upsert({where:{registrationId},create:{registrationId,checkinAt:at,qrDigest:sha256(token)},update:{checkinAt:at,qrDigest:sha256(token),version:{increment:1}}});
    await tx.auditLog.create({data:{action:'checkin.v11-formal-recorded',targetType:'V11Attendance',targetId:attendance.id,metadata:json({registrationId,checkinAt:at.toISOString(),qrDigest:sha256(token),
     professionalApprovalId:signedApproval.approval.id,professionalApprovalDigest:signedApproval.digest,rulesDigest:checkinProfessionalRulesDigest,policyDigest:reg.policy.bundleDigest,supplyId:reg.supplyId,actorId:actor.id,personId:actor.personId,actorVersion:actor.version,issuerActorId:issuer.id,
     authorityId:runtime.grant.id,scope:'FORMAL_CHECKIN',restaurantResultChanged:false,refundCreated:false,businessWindowDetermined:false})}});
    return {registrationId,checkinAt:at,scope:'FORMAL_CHECKIN',idempotent:false,fulfillmentConfirmed:false};
   });
  }
 };
}
