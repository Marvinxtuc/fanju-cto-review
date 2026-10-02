import type {PrismaClient,Prisma} from '../generated/prisma/client.js';
import {isDeepStrictEqual} from 'node:util';
import {inspectFormalPolicyMaterial} from './formal-policy-material.js';
import {inspectFormalBusinessParameters} from './formal-business-parameters.js';
import {verifyFormalActionAuthority,type AuthorityContext,type AuthorityTrust,type FormalAction} from './formal-action-authority.js';
import {sha256,json,object,dbNow} from './domain.js';
import {requireRole,reject,type LocalPrincipal} from './contracts.js';
import {resolveVerifiedIdentity} from './principal.js';

export type RuntimeAuthorityInput={raw:string;signature:string;trust:AuthorityTrust;context:AuthorityContext};
export type RuntimeAuthoritySource=(policyDigest:string,action:FormalAction)=>Promise<RuntimeAuthorityInput>;
export function runtimePolicyDigest(materialSha256:string,parameterDigest:string,environment:AuthorityContext['environment']){
 return sha256(JSON.stringify({scope:'FORMAL_RUNTIME_POLICY',materialSha256,parameterDigest,environment}));
}
// Explicit internal command. No startup auto-activation and no archive conversion.
// A separately pinned signed POLICY_RUNTIME grant must exist before creation.
export async function assembleFormalRuntimePolicy(db:PrismaClient,actor:LocalPrincipal,archiveId:string,
 parameterRaw:string,authority:RuntimeAuthorityInput){
 requireRole(actor,'OPS','REVIEWER');
 const params=inspectFormalBusinessParameters(parameterRaw,authority.context.parameterDigest);
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "V11Actor" WHERE id=${actor.id} FOR SHARE`;
  await resolveVerifiedIdentity({actorId:actor.id,personId:actor.personId,role:actor.role,actorVersion:actor.version,
   userId:actor.userId,restaurantId:actor.restaurantId},id=>tx.v11Actor.findUnique({where:{id}}));
  const archive=await tx.v11PolicyMaterialArchive.findUniqueOrThrow({where:{id:archiveId}});
  if(archive.scope!=='MATERIAL_ONLY'||archive.materialSha256!==authority.context.materialSha256
   ||archive.releaseVersion!==authority.context.releaseVersion)throw Error('Runtime material binding invalid');
  const material=inspectFormalPolicyMaterial(archive.rawMaterial,{sha256:archive.materialSha256,
   releaseVersion:archive.releaseVersion,inheritedBaselineHash:archive.inheritedBaselineHash},authority.trust.evidence);
  const digest=runtimePolicyDigest(archive.materialSha256,authority.context.parameterDigest,authority.context.environment);
  if(digest!==authority.context.policyDigest)throw Error('Runtime policy digest invalid');
  const grant=verifyFormalActionAuthority(authority.raw,authority.signature,authority.trust,authority.context,'POLICY_RUNTIME',await dbNow(tx));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-runtime-policy:${digest}`},0))`;
  const prior=await tx.v11PolicySnapshot.findUnique({where:{bundleDigest:digest},include:{runtimeBinding:true}});
  if(prior){
   if(prior.status!=='FORMAL_RUNTIME'||prior.runtimeBinding?.archiveId!==archive.id
    ||prior.runtimeBinding.parameterRaw!==parameterRaw||object(prior.docsJson).scope!=='FORMAL_RUNTIME_POLICY')
    throw Error('Runtime policy provenance conflict');
   return {policyId:prior.id,policyDigest:digest,environment:authority.context.environment};
  }
  const row=await tx.v11PolicySnapshot.create({data:{bundleVersion:material.version,bundleDigest:digest,
   baselineHash:archive.inheritedBaselineHash,status:'FORMAL_RUNTIME',blockersJson:[],
   docsJson:json({scope:'FORMAL_RUNTIME_POLICY',environment:authority.context.environment,documents:material.documents,parameterVersion:params.version})}});
  await tx.v11RuntimePolicyBinding.create({data:{policyId:row.id,archiveId:archive.id,
   environment:authority.context.environment,releaseVersion:authority.context.releaseVersion,
   parameterRaw,parameterDigest:authority.context.parameterDigest,authorityRaw:authority.raw,
   authoritySignature:authority.signature,authorityDigest:sha256(authority.raw),issuerId:grant.issuerId}});
  await tx.auditLog.create({data:{action:'policy.v11-runtime-assembled',targetType:'V11PolicySnapshot',targetId:row.id,
   metadata:{environment:authority.context.environment,actorId:actor.id,personId:actor.personId,authorityId:grant.id,authorityDigest:sha256(authority.raw)}}});
  return {policyId:row.id,policyDigest:digest,environment:authority.context.environment};
 });
}
// Read fresh authority for each action, including send-boundary reevaluation.
export async function authorizeRuntimePolicy(tx:Prisma.TransactionClient,policyId:string,action:FormalAction,source:RuntimeAuthoritySource){
 await tx.$queryRaw`SELECT id FROM "V11PolicySnapshot" WHERE id=${policyId} FOR SHARE`;
 const policy=await tx.v11PolicySnapshot.findUniqueOrThrow({where:{id:policyId},include:{runtimeBinding:{include:{archive:true}}}});
 const b=policy.runtimeBinding;
 if(policy.status!=='FORMAL_RUNTIME'||!b||object(policy.docsJson).scope!=='FORMAL_RUNTIME_POLICY'
  ||object(policy.docsJson).environment!==b.environment||runtimePolicyDigest(b.archive.materialSha256,b.parameterDigest,b.environment as AuthorityContext['environment'])!==policy.bundleDigest)
  throw Error('Formal runtime policy unavailable');
 const authority=await source(policy.bundleDigest,action).catch(()=>reject(503,'FORMAL_ACTION_AUTHORITY_UNAVAILABLE'));
 if(authority.context.policyDigest!==policy.bundleDigest||authority.context.environment!==b.environment
  ||authority.context.releaseVersion!==b.releaseVersion||authority.context.materialSha256!==b.archive.materialSha256
  ||authority.context.parameterDigest!==b.parameterDigest)reject(503,'FORMAL_ACTION_AUTHORITY_UNAVAILABLE');
 const material=inspectFormalPolicyMaterial(b.archive.rawMaterial,{sha256:b.archive.materialSha256,releaseVersion:b.releaseVersion,
  inheritedBaselineHash:b.archive.inheritedBaselineHash},authority.trust.evidence);
 if(policy.baselineHash!==b.archive.inheritedBaselineHash||policy.bundleVersion!==material.version
  ||!isDeepStrictEqual(object(policy.docsJson).documents,material.documents))throw Error('Runtime public policy changed');
 const grant=verifyFormalActionAuthority(authority.raw,authority.signature,authority.trust,authority.context,action,await dbNow(tx));
 return {policy,grant,parameters:inspectFormalBusinessParameters(b.parameterRaw,b.parameterDigest),binding:authority.context,authority};
}
/** Recovery of historical obligations has its own fresh action grant. Rechecking
 * current new-sale conclusions must not strand a trusted historic receipt. The
 * frozen archive, original public terms and parameters remain hash-bound. */
export async function authorizeHistoricalPolicy(tx:Prisma.TransactionClient,policyId:string,
 action:'DECIDE_REFUND'|'EXECUTE_REFUND'|'RECOVER_FUNDS'|'CLOSE_DIFFERENCE'|'CHECKIN_ISSUE'|'CHECKIN_RECORD',source:RuntimeAuthoritySource){
 await tx.$queryRaw`SELECT id FROM "V11PolicySnapshot" WHERE id=${policyId} FOR SHARE`;
 const policy=await tx.v11PolicySnapshot.findUniqueOrThrow({where:{id:policyId},include:{runtimeBinding:{include:{archive:true}}}});
 const b=policy.runtimeBinding;
 if(policy.status!=='FORMAL_RUNTIME'||!b||object(policy.docsJson).scope!=='FORMAL_RUNTIME_POLICY'
  ||object(policy.docsJson).environment!==b.environment||sha256(b.archive.rawMaterial)!==b.archive.materialSha256
  ||runtimePolicyDigest(b.archive.materialSha256,b.parameterDigest,b.environment as AuthorityContext['environment'])!==policy.bundleDigest)
  throw Error('Historical runtime policy provenance unavailable');
 const material=object(JSON.parse(b.archive.rawMaterial));
 const docs=Array.isArray(material.documents)?material.documents.map(value=>{
  const d=object(value);return {kind:d.kind,documentId:d.documentId,version:d.version,fullHash:d.fullHash,publicHash:d.publicHash,publicText:d.publicText};
 }):null;
 if(!isDeepStrictEqual(object(policy.docsJson).documents,docs)||policy.baselineHash!==b.archive.inheritedBaselineHash)
  throw Error('Historical runtime policy changed');
 const authority=await source(policy.bundleDigest,action).catch(()=>reject(503,'FORMAL_ACTION_AUTHORITY_UNAVAILABLE'));
 if(authority.context.policyDigest!==policy.bundleDigest||authority.context.environment!==b.environment
  ||authority.context.releaseVersion!==b.releaseVersion||authority.context.materialSha256!==b.archive.materialSha256
  ||authority.context.parameterDigest!==b.parameterDigest)reject(503,'FORMAL_ACTION_AUTHORITY_UNAVAILABLE');
 const grant=verifyFormalActionAuthority(authority.raw,authority.signature,authority.trust,authority.context,action,await dbNow(tx));
 return {policy,grant,parameters:inspectFormalBusinessParameters(b.parameterRaw,b.parameterDigest),binding:authority.context,authority};
}
