import {randomUUID} from 'node:crypto';
import type {PrismaClient,Prisma} from '../generated/prisma/client.js';
import {authorizeRuntimePolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {dbNow,json,object,sha256} from './domain.js';
import {matchesConsentDocuments} from './consent-evidence.js';
import {requireRole,requireOwner,reject,type LocalPrincipal} from './contracts.js';
import {resolveVerifiedIdentity} from './principal.js';
import {formalCanonicalJson as canonical} from './formal-json.js';
async function currentActor(tx:Prisma.TransactionClient,actor:LocalPrincipal){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 await tx.$queryRaw`SELECT id FROM "V11Actor" WHERE id=${actor.id} FOR SHARE`;
 await resolveVerifiedIdentity({actorId:actor.id,personId:actor.personId,role:actor.role,actorVersion:actor.version,
  userId:actor.userId,restaurantId:actor.restaurantId},id=>tx.v11Actor.findUnique({where:{id}}));
}
// Delivery proof captures the exact text/version served by the formal route.
// No consent is inferred from login, material existence or a profile checkbox.
export async function deliverFormalPolicy(db:PrismaClient,actor:LocalPrincipal,policyId:string,source:RuntimeAuthoritySource){
 return db.$transaction(async tx=>{
  await currentActor(tx,actor);
  const runtime=await authorizeRuntimePolicy(tx,policyId,'POLICY_RUNTIME',source);
  const docs=object(runtime.policy.docsJson).documents as Array<{documentId:string;fullHash:string;publicHash:string;publicText:string}>;
  const fullHashes=Object.fromEntries(docs.map(d=>[d.documentId,d.fullHash]));
  const publicHashes=Object.fromEntries(docs.map(d=>[d.documentId,d.publicHash]));
  const body={policyId,policyDigest:runtime.policy.bundleDigest,environment:runtime.binding.environment,
   actorId:actor.id,actorVersion:actor.version,fullHashes,publicHashes};
  const at=await dbNow(tx);
  const delivery=await tx.v11Request.create({data:{businessKey:`formal-policy-delivery:${randomUUID()}`,kind:'FORMAL_POLICY_DELIVERY',
   source:'FORMAL_BUSINESS_ROUTE',userId:actor.userId!,state:'DELIVERED',acceptedAt:at,blockerIds:[],payload:json({...body,proofDigest:sha256(canonical(body))})}});
  await tx.auditLog.create({data:{action:'policy.v11-formal-delivered',targetType:'V11Request',targetId:delivery.id,
   metadata:json({policyId,policyDigest:body.policyDigest,actorId:actor.id,actorVersion:actor.version,proofDigest:sha256(canonical(body))})}});
  return {policyId,policyDigest:body.policyDigest,deliveryId:delivery.id,documents:docs,fullHashes,publicHashes};
 });
}
export async function acceptFormalPolicyConsent(db:PrismaClient,actor:LocalPrincipal,input:{policyId:string;deliveryId:string;fullHashes:unknown;publicHashes:unknown},source:RuntimeAuthoritySource){
 return db.$transaction(async tx=>{
  await currentActor(tx,actor);
  const runtime=await authorizeRuntimePolicy(tx,input.policyId,'POLICY_RUNTIME',source);
  const delivery=await tx.v11Request.findUniqueOrThrow({where:{id:input.deliveryId}});requireOwner(actor,delivery.userId??'');
  const proof=object(delivery.payload);
  const body={policyId:proof.policyId,policyDigest:proof.policyDigest,environment:proof.environment,
   actorId:proof.actorId,actorVersion:proof.actorVersion,fullHashes:proof.fullHashes,publicHashes:proof.publicHashes};
  if(delivery.kind!=='FORMAL_POLICY_DELIVERY'||delivery.source!=='FORMAL_BUSINESS_ROUTE'||delivery.state!=='DELIVERED'
   ||proof.policyId!==input.policyId||proof.policyDigest!==runtime.policy.bundleDigest||proof.environment!==runtime.binding.environment
   ||proof.actorId!==actor.id||proof.actorVersion!==actor.version
   ||!matchesConsentDocuments(object(runtime.policy.docsJson).documents,input.fullHashes,input.publicHashes)
   ||!matchesConsentDocuments(object(runtime.policy.docsJson).documents,proof.fullHashes,proof.publicHashes)
   ||proof.proofDigest!==sha256(canonical(body)))reject(409,'FORMAL_CONSENT_DELIVERY_INVALID');
  const audit=await tx.auditLog.findFirst({where:{action:'policy.v11-formal-delivered',targetType:'V11Request',targetId:delivery.id,
   metadata:{path:['proofDigest'],equals:proof.proofDigest as string}}});if(!audit)reject(409,'FORMAL_CONSENT_DELIVERY_INVALID');
  await tx.$queryRaw`SELECT id FROM "V11Request" WHERE id=${delivery.id} FOR UPDATE`;
  const consentSource=`FORMAL_USER_DELIVERY:${delivery.id}`;
  const prior=await tx.v11BundleConsent.findFirst({where:{userId:actor.userId!,policyId:input.policyId,source:consentSource}});
  if(prior)return {consentId:prior.id,acceptedAt:prior.acceptedAt};
  const row=await tx.v11BundleConsent.create({data:{userId:actor.userId!,policyId:input.policyId,source:consentSource,
   documentHashesJson:json(input.fullHashes),publicHashesJson:json(input.publicHashes),acceptedAt:await dbNow(tx)}});
  await tx.auditLog.create({data:{action:'policy.v11-formal-consent',targetType:'V11BundleConsent',targetId:row.id,
   metadata:{deliveryId:delivery.id,policyId:input.policyId,policyDigest:runtime.policy.bundleDigest,actorId:actor.id,actorVersion:actor.version}}});
  return {consentId:row.id,acceptedAt:row.acceptedAt};
 });
}
