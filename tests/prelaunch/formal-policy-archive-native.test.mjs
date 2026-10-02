import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit owned source root required');
const require=createRequire(`${repo}/services/api/package.json`);const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {createFormalPolicyArchive}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/formal-policy-archive.js`));
const hash=text=>createHash('sha256').update(text).digest('hex');
function fixture(prefix){
 const attachments=new Map();const kinds=['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY'];
 const gates=['OP-03','OP-04','OP-05','OP-07','OP-08','OP-09','OP-10','OP-11','OP-12','OP-13','OP-14','OP-15','RV-01','RV-02','RV-03','RV-04','RV-05','RV-06','RV-07'];
 const material={scope:'FORMAL_POLICY_RELEASE_MATERIAL',bundleId:prefix,version:'synthetic-v1',releaseVersion:'synthetic-release',inheritedBaselineHash:hash('synthetic-baseline'),documents:kinds.map(kind=>{
  const publicText='synthetic test '+kind,fullText='TEST_ONLY<!-- PUBLIC_POLICY_START -->'+publicText+'<!-- PUBLIC_POLICY_END -->';
  return {kind,documentId:kind,version:'synthetic-v1',fullText,fullHash:hash(fullText),publicText,publicHash:hash(publicText)};
 }),evidence:gates.map(gateId=>{const text='synthetic evidence '+gateId;attachments.set(gateId,text);return {gateId,referenceId:gateId,sha256:hash(text),kind:gateId.startsWith('OP-')?'BUSINESS_DECISION':'SPECIALIST_CONCLUSION'};})};
 const raw=JSON.stringify(material);return {material,raw,attachments,pin:{sha256:hash(raw),releaseVersion:'synthetic-release',inheritedBaselineHash:hash('synthetic-baseline')}};
}
test('policy material archive is immutable and cannot grant runtime authority',async t=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);
 const prefix='material_archive_'+randomUUID().replaceAll('-','');
 try{
  const row=await db.v11Actor.create({data:{personId:prefix,role:'OPS',passwordHash:'synthetic-unused'}});
  const actor={id:row.id,personId:row.personId,role:'OPS',userId:null,restaurantId:null,version:row.version};
  const f=fixture(prefix),store=createFormalPolicyArchive(db);let saved;
  await t.test('ten concurrent imports preserve exact bytes with one record and audit',async()=>{
   const before=await db.v11PolicySnapshot.count();const results=await Promise.all(Array.from({length:10},()=>store.archive(f.raw,f.pin,f.attachments,actor)));
   assert.equal(new Set(results.map(x=>x.archiveId)).size,1);saved=results[0];assert.equal(saved.releaseAuthorized,false);assert.equal(saved.activation,'NOT_ASSESSED');
   const archived=await db.v11PolicyMaterialArchive.findUniqueOrThrow({where:{id:saved.archiveId}});assert.equal(archived.rawMaterial,f.raw);assert.equal(archived.scope,'MATERIAL_ONLY');
   assert.equal(await db.auditLog.count({where:{action:'policy.v11-material-archived',targetId:saved.archiveId}}),1);assert.equal(await db.v11PolicySnapshot.count(),before);
  });
  await t.test('reads recheck pins and attachments and expose public projection only',async()=>{
   const read=await store.read(saved.archiveId,f.pin,f.attachments,actor);assert.equal(read.releaseAuthorized,false);assert.equal(read.documents.length,3);assert.ok(read.documents.every(x=>!('fullText'in x)));
   await assert.rejects(store.read(saved.archiveId,{...f.pin,releaseVersion:'other'},f.attachments,actor));
   await assert.rejects(store.read(saved.archiveId,f.pin,new Map(),actor));
  });
  await t.test('database rejects changing bytes, changing scope or deleting archived material',async()=>{
   await assert.rejects(db.v11PolicyMaterialArchive.update({where:{id:saved.archiveId},data:{rawMaterial:'changed'}}));
   await assert.rejects(db.v11PolicyMaterialArchive.update({where:{id:saved.archiveId},data:{scope:'ACTIVE'}}));
   await assert.rejects(db.v11PolicyMaterialArchive.delete({where:{id:saved.archiveId}}));
   assert.equal((await db.v11PolicyMaterialArchive.findUniqueOrThrow({where:{id:saved.archiveId}})).rawMaterial,f.raw);
  });
  await t.test('same named release cannot be replaced by another digest',async()=>{
   const other=fixture(prefix);other.material.documents[0].fullText='metadata '+other.material.documents[0].fullText;other.material.documents[0].fullHash=hash(other.material.documents[0].fullText);
   const raw=JSON.stringify(other.material);await assert.rejects(store.archive(raw,{...other.pin,sha256:hash(raw)},other.attachments,actor));
   assert.equal(await db.v11PolicyMaterialArchive.count({where:{bundleId:prefix}}),1);
  });
  await t.test('audit failure rolls back the newly inserted archive',async()=>{
   const other=fixture(prefix+'_rollback');const failing={$transaction:callback=>db.$transaction(tx=>callback(new Proxy(tx,{get(target,key){return key==='auditLog'?{...target.auditLog,create:async()=>{throw Error('synthetic audit failure');}}:target[key];}})))};
   await assert.rejects(createFormalPolicyArchive(failing).archive(other.raw,other.pin,other.attachments,actor),/audit failure/);
   assert.equal(await db.v11PolicyMaterialArchive.count({where:{bundleId:prefix+'_rollback'}}),0);
  });
  await t.test('role hints, stale actor versions and disabled accounts cannot archive or read',async()=>{
   await assert.rejects(store.archive(f.raw,f.pin,f.attachments,{...actor,role:'USER'}));
   await assert.rejects(store.read(saved.archiveId,f.pin,f.attachments,{...actor,version:actor.version+1}));
   await db.v11Actor.update({where:{id:actor.id},data:{enabled:false}});
   await assert.rejects(store.read(saved.archiveId,f.pin,f.attachments,actor));
   await assert.rejects(store.archive(f.raw,f.pin,f.attachments,actor));
   await assert.rejects(db.v11Actor.delete({where:{id:actor.id}}));
  });
 }finally{await db.$disconnect();}
});
