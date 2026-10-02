import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,verifyOwnedEnvironment,childEnvironment} from '../../scripts/prelaunch-owned-env.mjs';
import {formalRuntimeFixture} from './formal-runtime-fixture.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT??root;const require=createRequire(resolve(repo,'services/api/package.json'));
const {PrismaPg}=require('@prisma/adapter-pg');const {PrismaClient}=await import(pathToFileURL(resolve(repo,'services/api/dist/generated/prisma/client.js')));
const {createFormalPolicyArchive}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/formal-policy-archive.js')));
const {assembleFormalRuntimePolicy,authorizeRuntimePolicy}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/formal-runtime-policy.js')));
const {buildApp}=await import(pathToFileURL(resolve(repo,'services/api/dist/app.js')));
const {signSession}=await import(pathToFileURL(resolve(repo,'services/api/dist/auth.js')));
test('independent runtime provenance on verified isolated PostgreSQL',async t=>{
 const {runtime}=await verifyOwnedEnvironment(dirname(process.env.PRELAUNCH_ENV_FILE??''),'empty');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:runtime.database_url})});
 const prefix='formal_'+randomUUID().replaceAll('-','');const f=formalRuntimeFixture(prefix);
 const row=await db.v11Actor.create({data:{id:prefix+'_ops',personId:prefix+'_person',role:'OPS',passwordHash:'EXTERNAL_SESSION_ONLY'}});
 const actor={id:row.id,personId:row.personId,role:'OPS',version:row.version,userId:null,restaurantId:null};
 let archive,policy;
 try{
  archive=await createFormalPolicyArchive(db).archive(f.materialRaw,{sha256:f.context.materialSha256,releaseVersion:f.context.releaseVersion,
   inheritedBaselineHash:f.material.inheritedBaselineHash},f.trust.evidence,actor);
  await t.test('archive alone creates no runtime policy',async()=>{assert.equal(await db.v11RuntimePolicyBinding.count({where:{archiveId:archive.archiveId}}),0);});
  await t.test('forged grant cannot assemble runtime policy',async()=>{const a=f.authority();a.signature=Buffer.alloc(64).toString('base64');
   await assert.rejects(assembleFormalRuntimePolicy(db,actor,archive.archiveId,f.parameterRaw,a));assert.equal(await db.v11RuntimePolicyBinding.count({where:{archiveId:archive.archiveId}}),0);});
  await t.test('signed explicit assembly creates a distinct isolated runtime snapshot and preserves archive',async()=>{
   policy=await assembleFormalRuntimePolicy(db,actor,archive.archiveId,f.parameterRaw,f.authority());
   assert.equal(policy.environment,'ISOLATED_TEST');assert.equal((await db.v11PolicyMaterialArchive.findUniqueOrThrow({where:{id:archive.archiveId}})).scope,'MATERIAL_ONLY');
   assert.equal(await db.v11RuntimePolicyBinding.count({where:{archiveId:archive.archiveId}}),1);
   assert.deepEqual(await assembleFormalRuntimePolicy(db,actor,archive.archiveId,f.parameterRaw,f.authority()),policy);
  });
  await t.test('fresh scoped action grant and revocation are enforced',async()=>{
   const a=f.authority();await db.$transaction(tx=>authorizeRuntimePolicy(tx,policy.policyId,'PREPARE_PAYMENT',async()=>a));
   f.trust.revokedIds.add(f.grant.id);await assert.rejects(db.$transaction(tx=>authorizeRuntimePolicy(tx,policy.policyId,'PREPARE_PAYMENT',async()=>a)));f.trust.revokedIds.clear();
  });
  await t.test('recovery-only grant preserves old policy without new-charge authority',async()=>{
   const actions=f.grant.actions;f.grant.actions=['RECOVER_FUNDS'];const a=f.authority();
   await db.$transaction(tx=>authorizeRuntimePolicy(tx,policy.policyId,'RECOVER_FUNDS',async()=>a));
   await assert.rejects(db.$transaction(tx=>authorizeRuntimePolicy(tx,policy.policyId,'PREPARE_PAYMENT',async()=>a)));f.grant.actions=actions;
  });
  await t.test('isolated runtime cannot authorize production context',async()=>{
   const a=f.authority();a.context={...a.context,environment:'PRODUCTION'};
   await assert.rejects(db.$transaction(tx=>authorizeRuntimePolicy(tx,policy.policyId,'RECOVER_FUNDS',async()=>a)));
  });
  await t.test('runtime binding is immutable in database',async()=>{
   await assert.rejects(db.$executeRaw`UPDATE "V11RuntimePolicyBinding" SET "releaseVersion"='tampered' WHERE "policyId"=${policy.policyId}`);
   await assert.rejects(db.$executeRaw`DELETE FROM "V11RuntimePolicyBinding" WHERE "policyId"=${policy.policyId}`);
  });
  await t.test('existing draft cannot be promoted and new runtime cannot omit provenance',async()=>{
   const draft=await db.v11PolicySnapshot.create({data:{bundleVersion:'SIMULATION_ONLY:'+prefix,bundleDigest:'draft_'+prefix,
    baselineHash:f.material.inheritedBaselineHash,status:'LOCAL_DRAFT',docsJson:{scope:'TEST_ONLY'},blockersJson:[]}});
   await assert.rejects(db.v11PolicySnapshot.update({where:{id:draft.id},data:{status:'FORMAL_RUNTIME',
    bundleVersion:prefix+'_promoted',docsJson:{scope:'FORMAL_RUNTIME_POLICY',environment:'ISOLATED_TEST'}}}));
   await assert.rejects(db.v11PolicySnapshot.create({data:{bundleVersion:prefix+'_unbound',bundleDigest:'unbound_'+prefix,
    baselineHash:f.material.inheritedBaselineHash,status:'FORMAL_RUNTIME',docsJson:{scope:'FORMAL_RUNTIME_POLICY',environment:'ISOLATED_TEST'},blockersJson:[]}}));
   assert.equal((await db.v11PolicySnapshot.findUniqueOrThrow({where:{id:draft.id}})).status,'LOCAL_DRAFT');
  });
  await t.test('public-text tamper rejects action and rolls back test write',async()=>{
   await assert.rejects(db.$transaction(async tx=>{await tx.v11PolicySnapshot.update({where:{id:policy.policyId},data:{docsJson:{scope:'FORMAL_RUNTIME_POLICY',environment:'ISOLATED_TEST',documents:[]}}});
    return authorizeRuntimePolicy(tx,policy.policyId,'RECOVER_FUNDS',async()=>f.authority());}));
   await db.$transaction(tx=>authorizeRuntimePolicy(tx,policy.policyId,'RECOVER_FUNDS',async()=>f.authority()));
  });
  await t.test('main application formal policy routes capture exact delivery and authenticated consent',async t=>{
   const user=await db.user.create({data:{wechatOpenid:'mock_'+prefix,phone:'13800138000'}});
   const own=await db.v11Actor.create({data:{userId:user.id,personId:prefix+'_user-person',role:'USER',passwordHash:'EXTERNAL_SESSION_ONLY'}});
   const other=await db.user.create({data:{wechatOpenid:'mock_'+prefix+'_other'}});
   await db.v11Actor.create({data:{userId:other.id,personId:prefix+'_other-person',role:'USER',passwordHash:'EXTERNAL_SESSION_ONLY'}});
   const app=await buildApp({prisma:db,providerEnv:{...childEnvironment(runtime),AUTH_PROVIDER:'wechat',PHONE_PROVIDER:'wechat',
    WECHAT_MINIAPP_APP_ID:'synthetic-formal-app',WECHAT_MINIAPP_APP_SECRET:'wx_test_secret',FEATURE_V11_IDENTITY:'true',FEATURE_V11_FORMAL_BUSINESS:'true'},
    formalRuntimeAuthoritySource:async()=>f.authority(),providerHttpClient:async()=>{throw Error('No channel call allowed in policy test');}});
   const headers={authorization:'Bearer '+signSession(app,{sub:user.id,role:'USER'})};const url='/api/v11/policies/'+policy.policyId;
   let delivery;
   try{
    await t.test('unsigned read is denied and preview endpoints remain absent',async()=>{
     assert.equal((await app.inject({url:url+'/delivery'})).statusCode,401);
     assert.equal((await app.inject({url:'/api/prelaunch/v11/policy/current'})).statusCode,404);
    });
    await t.test('formal route delivers exactly three public documents',async()=>{
     const r=await app.inject({url:url+'/delivery',headers});assert.equal(r.statusCode,200,r.body);delivery=r.json();
     assert.equal(delivery.documents.length,3);assert.equal(delivery.policyDigest,policy.policyDigest);
     assert.ok(delivery.documents.every(d=>!('fullText'in d)));assert.equal(await db.v11BundleConsent.count({where:{userId:user.id}}),0);
    });
    await t.test('changed hash and other-user delivery cannot create consent',async()=>{
     const payload={deliveryId:delivery.deliveryId,fullHashes:delivery.fullHashes,publicHashes:delivery.publicHashes};
     const bad={...payload,publicHashes:{...payload.publicHashes,[Object.keys(payload.publicHashes)[0]]:'0'.repeat(64)}};
     assert.equal((await app.inject({method:'POST',url:url+'/consents',headers,payload:bad})).statusCode,409);
     assert.equal((await app.inject({method:'POST',url:url+'/consents',headers:{authorization:'Bearer '+signSession(app,{sub:other.id,role:'USER'})},payload})).statusCode,404);
     assert.equal(await db.v11BundleConsent.count({where:{userId:user.id}}),0);
    });
    await t.test('explicit consent records original time and replays one source id',async()=>{
     const payload={deliveryId:delivery.deliveryId,fullHashes:delivery.fullHashes,publicHashes:delivery.publicHashes};
     const r=await app.inject({method:'POST',url:url+'/consents',headers,payload});assert.equal(r.statusCode,200,r.body);
     const replay=await app.inject({method:'POST',url:url+'/consents',headers,payload});assert.deepEqual(replay.json(),r.json());
     const consent=await db.v11BundleConsent.findUniqueOrThrow({where:{id:r.json().consentId}});
     assert.equal(consent.source,'FORMAL_USER_DELIVERY:'+delivery.deliveryId);
     assert.equal(await db.auditLog.count({where:{action:'policy.v11-formal-consent',targetId:consent.id}}),1);
    });
    await t.test('actor version revocation denies later acceptance',async()=>{
     await db.v11Actor.update({where:{id:own.id},data:{enabled:false,version:{increment:1}}});
     assert.equal((await app.inject({method:'POST',url:url+'/consents',headers,payload:{deliveryId:delivery.deliveryId,fullHashes:delivery.fullHashes,publicHashes:delivery.publicHashes}})).statusCode,401);
    });
   }finally{await app.close();}
  });
 }finally{await db.$disconnect();}
});
