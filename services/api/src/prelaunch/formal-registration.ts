import {randomUUID} from 'node:crypto';
import type {PrismaClient} from '../generated/prisma/client.js';
import {createRegistration,sha256,json,object,dbNow,type FormalRegistrationBoundary,type Tx} from './domain.js';
import {authorizeRuntimePolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {formalCanonicalJson} from './formal-json.js';
import {matchesConsentDocuments} from './consent-evidence.js';
import {verifyFormalActor} from './formal-supply.js';
import {expireFormalHoldInTransaction} from './formal-hold-expiry.js';
import {verifiedFormalNoFundsClosure} from './formal-rejoin-safety.js';
import {reject,requireRole,type LocalPrincipal} from './contracts.js';
type Runtime=Awaited<ReturnType<typeof authorizeRuntimePolicy>>;
const profileProof=(p:{userId:string;gender:string|null;adultConfirmed:boolean;adaptationConfirmed:boolean;version:number;availableTimes:string[]})=>({
 userId:p.userId,gender:p.gender,adultConfirmed:p.adultConfirmed,adaptationConfirmed:p.adaptationConfirmed,version:p.version,availableTimes:p.availableTimes});

export async function saveFormalProfile(db:PrismaClient,actor:LocalPrincipal,policyId:string,
 input:{gender:'MALE'|'FEMALE';adultDeclaration:true;serviceCompatible:true},source:RuntimeAuthoritySource){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 if(!['MALE','FEMALE'].includes(input.gender)||input.adultDeclaration!==true||input.serviceCompatible!==true)reject(400,'INVALID_PROFILE');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId!} FOR UPDATE`;
  await verifyFormalActor(tx,actor);
  const runtime=await authorizeRuntimePolicy(tx,policyId,'POLICY_RUNTIME',source);
  const row=await tx.v11Profile.upsert({where:{userId:actor.userId!},create:{userId:actor.userId!,gender:input.gender,adultConfirmed:true,adaptationConfirmed:true,version:1},
   update:{gender:input.gender,adultConfirmed:true,adaptationConfirmed:true,version:{increment:1}}});
  await tx.auditLog.create({data:{action:'profile.v11-formal-declared',targetType:'V11Profile',targetId:row.id,
   metadata:{scope:'FORMAL_USER_DECLARATION',proofDigest:sha256(formalCanonicalJson(profileProof(row))),policyDigest:runtime.policy.bundleDigest,
    actorId:actor.id,actorVersion:actor.version,personId:actor.personId,authorityId:runtime.grant.id}}});
  return {profileVersion:row.version,gender:row.gender,adultDeclaration:row.adultConfirmed,serviceCompatible:row.adaptationConfirmed};
 });
}
export function formalRegistrationBoundary(source:RuntimeAuthoritySource,caseOwner:string):FormalRegistrationBoundary{
 if(!caseOwner.trim())throw Error('Formal registration case owner required');
 const runtimes=new WeakMap<object,Runtime>();
 const runtime=(tx:Tx)=>{const r=runtimes.get(tx);if(!r)throw Error('Formal registration transaction context unavailable');return r;};
 return {
  async validateSupply(tx,actor,supply){
   await verifyFormalActor(tx,actor);const r=await authorizeRuntimePolicy(tx,supply.policyId,'NEW_REGISTRATION',source);
   const snap=object(supply.snapshot),quote=object(snap.quote);
   if(supply.status!=='FORMAL_APPROVED'||snap.scope!=='FORMAL_SUPPLY'||snap.environment!==r.binding.environment
    ||snap.policyDigest!==r.policy.bundleDigest||snap.parameterDigest!==r.binding.parameterDigest
    ||supply.digest!==sha256(formalCanonicalJson(supply.snapshot))||quote.supplyRevisionId!==supply.id
    ||quote.policyBundleId!==r.policy.bundleDigest||quote.F!==supply.serviceFeeCents||quote.D!==supply.depositCents
    ||quote.total!==supply.serviceFeeCents+supply.depositCents||quote.mealCollection!=='DIRECT_TO_RESTAURANT')reject(409,'FORMAL_SUPPLY_EVIDENCE_INVALID');
   const proof=await tx.auditLog.findFirst({where:{action:'supply.v11-platform-approved',targetType:'V11SupplyRevision',targetId:supply.id,
    metadata:{path:['supplyDigest'],equals:supply.digest}}});if(!proof)reject(409,'FORMAL_SUPPLY_EVIDENCE_INVALID');
   const published=await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetType:'Activity',targetId:supply.activityId,
    metadata:{path:['supplyId'],equals:supply.id}}});if(!published)reject(409,'FORMAL_PUBLICATION_REQUIRED');
   runtimes.set(tx,r);
  },
  async validateProfile(tx,actor,profile){
   if(!profile||!profile.adultConfirmed||!profile.adaptationConfirmed)return false;
   const proof=await tx.auditLog.findFirst({where:{action:'profile.v11-formal-declared',targetType:'V11Profile',targetId:profile.id,
    metadata:{path:['proofDigest'],equals:sha256(formalCanonicalJson(profileProof(profile)))}}});const meta=object(proof?.metadata);
   return meta.scope==='FORMAL_USER_DECLARATION'&&meta.policyDigest===runtime(tx).policy.bundleDigest&&meta.actorId===actor.id;
  },
  async validateConsent(tx,actor,consent,policy){
   if(!consent.source.startsWith('FORMAL_USER_DELIVERY:')||!matchesConsentDocuments(object(policy.docsJson).documents,consent.documentHashesJson,consent.publicHashesJson))reject(409,'CONSENT_EVIDENCE_INVALID');
   const deliveryId=consent.source.slice('FORMAL_USER_DELIVERY:'.length);
   const delivery=await tx.v11Request.findUnique({where:{id:deliveryId}});const body=object(delivery?.payload);
   const audit=await tx.auditLog.findFirst({where:{action:'policy.v11-formal-consent',targetType:'V11BundleConsent',targetId:consent.id}});
   if(!delivery||delivery.userId!==actor.userId||delivery.source!=='FORMAL_BUSINESS_ROUTE'||delivery.kind!=='FORMAL_POLICY_DELIVERY'
    ||body.policyId!==policy.id||body.policyDigest!==policy.bundleDigest||object(audit?.metadata).deliveryId!==deliveryId)reject(409,'CONSENT_EVIDENCE_INVALID');
  },
  allowConcurrentWaitlist(tx){return runtime(tx).parameters.waitlistConcurrency==='SERIAL_TRANSACTION_RESERVED_EXPOSURE';},
  async admissionBlockers(tx,supply,membership){
   if(membership==='FORMAL')return [];
   const p=runtime(tx).parameters,blockers=[];
   if(p.fifoClock===null||p.fifoTieBreak===null)blockers.push('OP-05');
   if(p.waitlistExposureCents===null)blockers.push('OP-08');
   if(blockers.length)return blockers;
   // Losing qualification does not discharge channel money. Retain exposure for
   // expired/cancelled entries until original-channel recovery is confirmed.
   const rows=await tx.v11Registration.findMany({where:{activityId:supply.activityId,category:'WAITLIST',policy:{status:'FORMAL_RUNTIME'}},
    include:{v11PaymentIntent_registrationId:true,v11RefundInstruction_registrationId:true,v11ReceiptBinding_registrationId:{include:{receipt:true}}}});
   let exposure=supply.serviceFeeCents+supply.depositCents;
   for(const row of rows){
    const received=row.v11ReceiptBinding_registrationId.reduce((sum,binding)=>sum+binding.receipt.amountCents,0);
    // Reuse the same original-channel proof as refund/re-entry checks. A local
    // CLOSED state alone cannot discharge potential waitlist channel money.
    if(received===0&&!row.active&&(await verifiedFormalNoFundsClosure(tx,row.id)).verified)continue;
    const recovered=row.v11RefundInstruction_registrationId.filter(r=>r.state==='CONFIRMED').reduce((n,r)=>n+r.totalCents,0);
    exposure+=Math.max(0,Math.max(received,row.serviceFeeCents+row.depositCents)-recovered);
   }
   return exposure>p.waitlistExposureCents!?['OP-08']:[];
  },
  async expire(tx,activityId,at){
   const holds=await tx.v11SeatHold.findMany({where:{state:'HELD',expiresAt:{lte:at},registration:{activityId,policy:{status:'FORMAL_RUNTIME'}}},orderBy:{registrationId:'asc'}});
   for(const hold of holds)await expireFormalHoldInTransaction(tx,hold.registrationId,runtime(tx).binding,caseOwner);
  },
  async created(tx,actor,reg){
   const r=runtime(tx);
   if(reg.category==='WAITLIST'){
    const maximum=await tx.v11Registration.aggregate({where:{activityId:reg.activityId},_max:{queueOrdinal:true}});
    await tx.v11Registration.update({where:{id:reg.id},data:{queueOrdinal:(maximum._max.queueOrdinal??0n)+1n}});
   }
   await tx.v11PaymentIntent.create({data:{registrationId:reg.id,channel:r.binding.channel,merchantScope:r.binding.merchantScope,
    providerConfigId:r.binding.providerConfigId,merchantOrderNo:'v11_'+randomUUID(),totalCents:reg.serviceFeeCents+reg.depositCents}});
   await tx.auditLog.create({data:{action:'registration.v11-formal-created',targetType:'V11Registration',targetId:reg.id,
    metadata:{actorId:actor.id,personId:actor.personId,actorVersion:actor.version,policyDigest:r.policy.bundleDigest,
     parameterDigest:r.binding.parameterDigest,authorityId:r.grant.id,environment:r.binding.environment}}});
  },
 };
}
export async function createFormalRegistration(db:PrismaClient,actor:LocalPrincipal,
 input:Parameters<typeof createRegistration>[2],source:RuntimeAuthoritySource,caseOwner:string){
 // Scope the idempotency key to the authenticated user and formal namespace.
 return createRegistration(db,actor,{...input,businessKey:'formal_'+sha256(JSON.stringify([actor.userId,input.businessKey]))},formalRegistrationBoundary(source,caseOwner));
}
