import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { root, verifyOwnedEnvironment, childEnvironment, redact } from '../../scripts/prelaunch-owned-env.mjs';

test('restored owned PostgreSQL discovers post-backup channel success and replays newer privacy correction without reviving expired seats', {timeout:120_000}, async()=>{
 const scratch=dirname(process.env.PRELAUNCH_ENV_FILE??''),sourceRoot=process.env.PRELAUNCH_SOURCE_ROOT??root;
 const main=await verifyOwnedEnvironment(scratch),channelEnv=await verifyOwnedEnvironment(scratch,'channel');
 const req=createRequire(resolve(sourceRoot,'services/api/package.json'));const {PrismaPg}=req('@prisma/adapter-pg');
 const {PrismaClient}=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/generated/prisma/client.js')));
 const {PersistentMockChannel}=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/funding/mock-channel.js')));
 const {aftersalesRoute}=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/prelaunch/aftersales.js')));
 const {reconcileMockChannel,privacyReplay}=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/prelaunch/reconciliation.js')));
 const {applyMockEvent}=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/prelaunch/domain.js')));
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:main.runtime.database_url})});
 const channelDb=new PrismaClient({adapter:new PrismaPg({connectionString:channelEnv.runtime.database_url})});
 const channel=new PersistentMockChannel(channelDb);let restored;
 const prefix='restore_'+randomUUID().replaceAll('-',''),now=Date.now();
 try {
  const user=await db.user.create({data:{id:prefix+'_user',wechatOpenid:'mock_'+prefix,phone:'synthetic-local'}});
  const userActor=await db.v11Actor.create({data:{id:prefix+'_actor',personId:prefix+'_person',role:'USER',userId:user.id,passwordHash:'UNUSABLE_SYNTHETIC_NO_LOGIN'}});
  const ops=await db.v11Actor.create({data:{id:prefix+'_ops',personId:prefix+'_ops_person',role:'OPS',passwordHash:'UNUSABLE_SYNTHETIC_NO_LOGIN'}});
  await db.v11Profile.create({data:{userId:user.id,gender:'MALE',adultConfirmed:true,adaptationConfirmed:true,availableTimes:['BEFORE_BACKUP_TEST_ONLY']}});
  const restaurant=await db.restaurant.create({data:{id:prefix+'_restaurant',name:'合成恢复餐厅',district:'上海',businessArea:'测试',address:'合成恢复地址',contactName:'SIMULATION_ONLY',contactPhone:'synthetic-local',budgetCents:3000,cuisineTags:[],capacity:8}});
  const activity=await db.activity.create({data:{id:prefix+'_activity',restaurantId:restaurant.id,title:'合成恢复餐饮',theme:'SIMULATION_ONLY',description:'合成恢复测试',district:'上海',businessArea:'测试',startsAt:new Date(now+30*3600_000),endsAt:new Date(now+32*3600_000),registrationEndsAt:new Date(now+28*3600_000),serviceFeeCents:1000,mealFeePolicyText:'餐费自理',capacity:8,status:'PUBLISHED'}});
  const policy=await db.v11PolicySnapshot.create({data:{id:prefix+'_policy',bundleVersion:'SIMULATION_ONLY:RESTORE',bundleDigest:prefix,baselineHash:'TEST_ONLY',docsJson:{scope:'TEST_ONLY'},blockersJson:['RV-01']}});
  const supply=await db.v11SupplyRevision.create({data:{id:prefix+'_supply',activityId:activity.id,restaurantId:restaurant.id,policyId:policy.id,revision:1,minSize:4,targetSize:6,maxSize:8,maxTables:1,capacity:8,serviceFeeCents:1000,depositCents:2000,waitlistMax:2,strategy:'FILL_TO_TARGET',snapshot:{scope:'TEST_ONLY',approval:{scope:'TEST_ONLY',simulationBatchHour:10}},digest:prefix,status:'SIMULATION_APPROVED',personId:prefix+'_restaurant_person',signedAt:new Date()}});
  const consent=await db.v11BundleConsent.create({data:{userId:user.id,policyId:policy.id,documentHashesJson:{scope:'TEST_ONLY'},publicHashesJson:{},acceptedAt:new Date(now-20*60_000)}});
  const reg=await db.v11Registration.create({data:{id:prefix+'_reg',userId:user.id,activityId:activity.id,supplyId:supply.id,policyId:policy.id,consentId:consent.id,category:'ORDINARY',eligibilityState:'PENDING_PAYMENT',serviceFeeCents:1000,depositCents:2000,snapshot:{scope:'TEST_ONLY'},acceptedAt:new Date(now-15*60_000)}});
  await db.v11SeatHold.create({data:{registrationId:reg.id,state:'HELD',expiresAt:new Date(now-5*60_000)}});
  const intent=await db.v11PaymentIntent.create({data:{registrationId:reg.id,merchantOrderNo:prefix+'_order',totalCents:3000,state:'SUBMITTING'}});
  // The owned backup is taken before any newer channel or privacy action.
  const backup=await new Promise(done=>{
   const child=spawn(process.execPath,['scripts/prelaunch-recovery.mjs',scratch],{cwd:root,env:childEnvironment(main.runtime),stdio:['ignore','pipe','pipe']});let out='',err='';
   const timer=setTimeout(()=>child.kill('SIGKILL'),60000);child.stdout.on('data',d=>out+=d);child.stderr.on('data',d=>err+=d);child.once('error',()=>{});child.once('close',code=>{clearTimeout(timer);done({code,out:redact(out,main.runtime),err:redact(err,main.runtime)});});
  });
  assert.equal(backup.code,0,backup.err);
  const target=await verifyOwnedEnvironment(scratch,'restore');restored=new PrismaClient({adapter:new PrismaPg({connectionString:target.runtime.database_url})});
  assert.equal((await restored.v11Profile.findUniqueOrThrow({where:{userId:user.id}})).gender,'MALE');
  const payment=await channel.pay(intent.merchantOrderNo,3000);
  assert.equal(await restored.channelReceipt.count({where:{merchantOrderNo:intent.merchantOrderNo}}),0);
  const correction=await aftersalesRoute(db,userActor,'createRight',{body:{kind:'CORRECTION',businessKey:prefix+'_correction',correction:{gender:'FEMALE',timePreferences:['AFTER_BACKUP_TEST_ONLY'],adultDeclaration:true,serviceCompatible:true}}});
  await aftersalesRoute(db,ops,'processRight',{id:correction.request.id});
  const replay=await privacyReplay(db,restored,ops);assert.ok(replay.replayed>=1);assert.equal(replay.preserveMoneyFacts,true);
  const profile=await restored.v11Profile.findUniqueOrThrow({where:{userId:user.id}});assert.equal(profile.gender,'FEMALE');assert.deepEqual(profile.availableTimes,['AFTER_BACKUP_TEST_ONLY']);
  const disposition=await db.v11PrivacyDisposition.findFirstOrThrow({where:{requestId:correction.request.id}});
  const proof=await restored.v11PrivacyDisposition.findUniqueOrThrow({where:{businessKey:disposition.businessKey}});assert.equal(proof.appliedAt.toISOString(),disposition.appliedAt.toISOString());assert.deepEqual(proof.fields,disposition.fields);
  const second=await privacyReplay(db,restored,ops);assert.equal(second.replayed,0,'Repeated privacy replay cannot reapply already journaled actions');
  const reconcile=await reconcileMockChannel(restored,channelDb,ops);assert.ok(reconcile.recovered>=1);
  const event=await restored.receivedEvent.findFirstOrThrow({where:{source:'prelaunch-mock-v11',normalizedPayload:{path:['sourceId'],equals:intent.id}}});
  await applyMockEvent(restored,event.id);
  const receipt=await restored.channelReceipt.findUniqueOrThrow({where:{channel_merchantScope_channelTradeNo:{channel:'mock',merchantScope:'mock-local',channelTradeNo:payment.channelNo}}});assert.equal(receipt.amountCents,3000);
  const current=await restored.v11Registration.findUniqueOrThrow({where:{id:reg.id}});assert.equal(current.active,false);assert.equal(current.eligibilityState,'EXPIRED');assert.equal(await restored.v11Membership.count({where:{registrationId:reg.id,active:true}}),0);
  assert.equal((await restored.v11RefundInstruction.aggregate({where:{registrationId:reg.id},_sum:{totalCents:true}}))._sum.totalCents,3000,'Recovered late money must remain a full refund obligation');
  await reconcileMockChannel(restored,channelDb,ops);
  assert.equal(await restored.channelReceipt.count({where:{channelTradeNo:payment.channelNo}}),1);
  assert.equal((await restored.v11RefundInstruction.aggregate({where:{registrationId:reg.id},_sum:{totalCents:true}}))._sum.totalCents,3000);
  // Bidirectional negative evidence: a synthetic local receipt with no channel fact.
  const missing=await restored.channelReceipt.create({data:{channel:'mock',merchantScope:'mock-local',channelTradeNo:prefix+'_missing_trade',merchantOrderNo:prefix+'_missing_order',amountCents:3000,evidenceHash:'TEST_ONLY_FAULT_INJECTION',verifiedAt:new Date()}});
  await restored.v11ReceiptBinding.create({data:{receiptId:missing.id,registrationId:reg.id,classification:'EXTRA'}});
  const reverse=await reconcileMockChannel(restored,channelDb,ops);assert.ok(reverse.businessWithoutChannel>=1);
  assert.ok(await restored.financialCase.findUnique({where:{caseKey:'V11_BUSINESS_RECEIPT_CHANNEL_MISMATCH:'+missing.id}}));
  const receiptAgain=await restored.channelReceipt.findUniqueOrThrow({where:{id:receipt.id}});assert.equal(receiptAgain.amountCents,3000);
 } finally {await Promise.all([db.$disconnect(),channelDb.$disconnect(),restored?.$disconnect()]);}
});
