import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { root, verifyOwnedEnvironment, childEnvironment, registerOwnedApi, unregisterOwnedApi } from '../../scripts/prelaunch-owned-env.mjs';

// Every fact below is a newly owned synthetic fixture, never an actual approval.
// Times are manipulated only in this disposable database to exercise original boundaries.
test('owned HTTP app and real PostgreSQL aftersales preserve rights, budgets, reviewer identities and immutable snapshots', {timeout:120_000}, async t => {
 const sourceRoot=process.env.PRELAUNCH_SOURCE_ROOT??root;
 const scratch=dirname(process.env.PRELAUNCH_ENV_FILE??'');
 const main=await verifyOwnedEnvironment(scratch), channelEnv=await verifyOwnedEnvironment(scratch,'channel');
 const requireApi=createRequire(resolve(sourceRoot,'services/api/package.json'));
 const { PrismaPg }=requireApi('@prisma/adapter-pg');
 const { PrismaClient }=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/generated/prisma/client.js')));
 const { PersistentMockChannel }=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/funding/mock-channel.js')));
 const { aftersalesRoute }=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/prelaunch/aftersales.js')));
 const { reserveRefund }=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/prelaunch/domain.js')));
 const { claimJob, finishJob, retryJob }=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/jobs/queue.js')));
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:main.runtime.database_url})});
 const channelDb=new PrismaClient({adapter:new PrismaPg({connectionString:channelEnv.runtime.database_url})});
 const channel=new PersistentMockChannel(channelDb);
 const prefix=`prelaunch_qa_${randomUUID().replaceAll('-','')}`;
 const password=randomBytes(24).toString('hex'),salt=randomBytes(16);
 const passwordHash=`scrypt:${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`;
 const restaurant=await db.restaurant.create({data:{id:prefix+'_rest',name:'合成测试餐厅',district:'上海',businessArea:'测试',address:'合成地址',contactName:'SIMULATION_ONLY',contactPhone:'synthetic-local',budgetCents:3000,cuisineTags:[],capacity:8}});
 const user=await db.user.create({data:{id:prefix+'_user',wechatOpenid:'mock_'+prefix,phone:'synthetic-local'}});
 const other=await db.user.create({data:{id:prefix+'_other',wechatOpenid:'mock_'+prefix+'_other',phone:'synthetic-local'}});
 const policy=await db.v11PolicySnapshot.create({data:{id:prefix+'_policy',bundleVersion:'SIMULATION_ONLY:QA',bundleDigest:prefix,baselineHash:'TEST_ONLY',docsJson:{scope:'TEST_ONLY'},blockersJson:['RV-01','RV-02']}});
 const consent=await db.v11BundleConsent.create({data:{id:prefix+'_consent',userId:user.id,policyId:policy.id,documentHashesJson:{scope:'SIMULATION_ONLY'},publicHashesJson:{},acceptedAt:new Date()}});
 const actor=async(role,suffix,userId=null,restaurantId=null,personId=prefix+'_'+suffix+'_person')=>db.v11Actor.create({data:{id:prefix+'_'+suffix,role,personId,passwordHash,userId,restaurantId}});
 const u=await actor('USER','actor',user.id),o=await actor('USER','other_actor',other.id),ops=await actor('OPS','ops'),reviewer=await actor('REVIEWER','reviewer'),rest=await actor('RESTAURANT','restaurant',null,restaurant.id);
 const asPrincipal=a=>({...a,role:a.role});
 async function fixture(suffix,ended=false) {
  const now=Date.now();
  const a=await db.activity.create({data:{id:prefix+'_'+suffix+'_activity',restaurantId:restaurant.id,title:'合成餐饮体验',theme:'SIMULATION_ONLY',description:'合成测试',district:'上海',businessArea:'测试',startsAt:new Date(now+(ended?-3:30)*3600_000),endsAt:new Date(now+(ended?-1:32)*3600_000),registrationEndsAt:new Date(now+(ended?-4:28)*3600_000),serviceFeeCents:1000,mealFeePolicyText:'餐费到店自理',capacity:8,status:'PUBLISHED'}});
  const supply=await db.v11SupplyRevision.create({data:{id:prefix+'_'+suffix+'_supply',activityId:a.id,restaurantId:restaurant.id,policyId:policy.id,revision:1,minSize:4,targetSize:6,maxSize:8,maxTables:1,capacity:8,serviceFeeCents:1000,depositCents:2000,waitlistMax:2,strategy:'FILL_TO_TARGET',snapshot:{scope:'TEST_ONLY',approval:{scope:'TEST_ONLY',simulationBatchHour:10}},digest:prefix+suffix,status:'SIMULATION_APPROVED',personId:rest.personId,signedAt:new Date()}});
  const reg=await db.v11Registration.create({data:{id:prefix+'_'+suffix+'_reg',userId:user.id,activityId:a.id,supplyId:supply.id,policyId:policy.id,consentId:consent.id,category:'ORDINARY',eligibilityState:'FORMAL',serviceFeeCents:1000,depositCents:2000,snapshot:{scope:'TEST_ONLY'},acceptedAt:new Date(now-3600_000),paidEffectiveAt:new Date(now-3600_000)}});
  const trade=await channel.pay(prefix+'_'+suffix+'_order',3000);
  const receipt=await db.channelReceipt.create({data:{id:prefix+'_'+suffix+'_receipt',channel:'mock',merchantScope:'mock-local',channelTradeNo:trade.channelNo,merchantOrderNo:prefix+'_'+suffix+'_order',amountCents:3000,evidenceHash:'SIMULATION_ONLY',verifiedAt:new Date(),paidAt:new Date()}});
  await db.v11ReceiptBinding.create({data:{receiptId:receipt.id,registrationId:reg.id,classification:'PRIMARY'}});
  for(const [kind,amount]of [['F',1000],['D',2000]])await db.v11FundComponent.create({data:{receiptId:receipt.id,kind,originalCents:amount}});
  return{a,supply,reg,trade,receipt};
 }
 let server;
 try {
  await t.test('HTTP readiness, authenticated profile, strict input, roles, token revocation and no private response',async()=>{
   server=spawn(process.execPath,['dist/prelaunch/server.js'],{cwd:resolve(sourceRoot,'services/api'),env:{...childEnvironment(main.runtime),PRELAUNCH_API_PORT:'0'},stdio:['ignore','pipe','pipe','ipc']});
   let stderr='';server.stderr.on('data',d=>stderr+=d);server.stdout.on('data',()=>{});
   const ready=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(new Error('Owned API READY timeout')),15000);server.once('exit',()=>{clearTimeout(timer);reject(new Error('Owned API exited before READY'));});server.once('message',message=>{clearTimeout(timer);done(message);});});
   const base=registerOwnedApi(scratch,server,ready);
   const request=async(path,method='GET',body,token)=>{
    const res=await fetch(base+path,{method,headers:{'x-fanju-contract':'prelaunch-v11-1',...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
    return{status:res.status,body:await res.json()};
   };
   assert.equal((await request('/health/ready')).status,200);
   const p='/api/prelaunch/v11';
   assert.equal((await request(p+'/registrations')).status,401);
   const login=await request(p+'/auth/login','POST',{actorId:u.id,password});assert.equal(login.status,200);assert.ok(login.body.token);
   const token=login.body.token;
   assert.equal((await request(p+'/profile','PUT',{gender:'MALE',timePreferences:[],adultDeclaration:true,serviceCompatible:true},token)).status,200);
   assert.equal((await request(p+'/profile','PUT',{gender:'MALE',adultDeclaration:true,serviceCompatible:true,approved:true},token)).status,400);
   assert.equal((await request(p+'/ops/summary','GET',undefined,token)).status,403);
   assert.equal((await request(p+'/registrations?limit=51','GET',undefined,token)).status,400);
   const privateResponse=await request(p+'/registrations/'+prefix+'_missing','GET',undefined,token);
   assert.equal(privateResponse.status,404);assert.ok(!JSON.stringify(privateResponse.body).includes('stack'));assert.ok(!JSON.stringify(privateResponse.body).includes(main.runtime.password));
   await db.v11Actor.update({where:{id:u.id},data:{version:{increment:1}}});
   assert.equal((await request(p+'/registrations','GET',undefined,token)).status,401);
   server.kill('SIGTERM');const [code]=await once(server,'exit');assert.equal(code,0);unregisterOwnedApi(scratch,server.pid);server=null;
  });
  await t.test('normal fulfillment schedules D once, preserves F, and can be read repeatedly',async()=>{
   const f=await fixture('normal',true);
   const r=await aftersalesRoute(db,asPrincipal(rest),'fulfillment',{body:{registrationId:f.reg.id,result:'NORMAL'}});
   assert.equal(r.channelConfirmed,false);
   await aftersalesRoute(db,asPrincipal(rest),'fulfillment',{body:{registrationId:f.reg.id,result:'NORMAL'}});
   const instructions=await db.v11RefundInstruction.findMany({where:{registrationId:f.reg.id}});
   assert.equal(instructions.length,1);assert.equal(instructions[0].serviceFeeCents,0);assert.equal(instructions[0].depositCents,2000);assert.equal(instructions[0].originalTradeNo,f.trade.channelNo);
   const dispositions=await db.v11Disposition.findMany({where:{component:{receiptId:f.receipt.id}}});
   assert.equal(dispositions.reduce((n,r)=>n+r.amountCents,0),2000);
   assert.equal(await channelDb.mockChannelTransaction.count({where:{kind:'REFUND',originalTradeNo:f.trade.channelNo}}),0,'Scheduling is not a channel refund');
  });
  await t.test('two rounds retain explanation and require a different final reviewer person',async()=>{
   const f=await fixture('dispute',true);
   await aftersalesRoute(db,asPrincipal(rest),'fulfillment',{body:{registrationId:f.reg.id,result:'ABNORMAL'}});
   let request=await db.v11Request.findUniqueOrThrow({where:{businessKey:'dispute:'+f.reg.id}});
   // Undelivered notice cannot support an adverse decision; explanation is retained.
   await assert.rejects(aftersalesRoute(db,asPrincipal(ops),'decision',{id:request.id,body:{decision:'BREACH',reason:'合成复核'}}),e=>e.code==='DELIVERY_EVIDENCE_UNRESOLVED');
   const pending=await aftersalesRoute(db,asPrincipal(u),'explanation',{id:request.id,body:{businessKey:prefix+'_before_notice',statement:'合成说明'}});assert.ok(pending.request.id);
   const notice=await db.v11DeliveryProof.findFirstOrThrow({where:{requestId:request.id,kind:'ABNORMAL_NOTICE'}});
   await aftersalesRoute(db,asPrincipal(u),'receiveNotice',{id:notice.id});
   await aftersalesRoute(db,asPrincipal(u),'explanation',{id:request.id,body:{businessKey:prefix+'_explain',statement:'合成说明'}});
   await aftersalesRoute(db,asPrincipal(ops),'decision',{id:request.id,body:{decision:'BREACH',reason:'模拟首轮裁决'}});
   const result=await db.v11DeliveryProof.findFirstOrThrow({where:{requestId:request.id,kind:'FIRST_RESULT'}});
   await aftersalesRoute(db,asPrincipal(u),'receiveNotice',{id:result.id});
   await aftersalesRoute(db,asPrincipal(u),'review',{id:request.id,body:{businessKey:prefix+'_review',statement:'模拟复核申请'}});
   await assert.rejects(aftersalesRoute(db,asPrincipal(ops),'decision',{id:request.id,body:{decision:'REFUND_D',reason:'同人不得终审'}}),e=>e.code==='DISTINCT_REVIEWER_PERSON_REQUIRED');
   await aftersalesRoute(db,asPrincipal(reviewer),'decision',{id:request.id,body:{decision:'REFUND_D',reason:'模拟不同人终审'}});
   const decisions=await db.v11Decision.findMany({where:{requestId:request.id},orderBy:{createdAt:'asc'}});
   assert.equal(decisions.length,2);assert.notEqual(decisions[0].personId,decisions[1].personId);
   assert.equal((await db.v11RefundInstruction.findFirstOrThrow({where:{registrationId:f.reg.id}})).depositCents,2000);
  });
  await t.test('core restaurant change rejection preserves snapshot and separately records unresolved compensation',async()=>{
   const f=await fixture('change');
   const change=await aftersalesRoute(db,asPrincipal(ops),'createChange',{body:{activityId:f.a.id,supplyId:f.supply.id,kind:'RESTAURANT',proposedSnapshot:{restaurantName:'合成新餐厅'},businessKey:prefix+'_change'}});
   await aftersalesRoute(db,asPrincipal(u),'respondChange',{id:change.change.id,body:{choice:'REJECT'}});
   const reg=await db.v11Registration.findUniqueOrThrow({where:{id:f.reg.id}});assert.equal(reg.active,false);
   const instruction=await db.v11RefundInstruction.findFirstOrThrow({where:{registrationId:f.reg.id}});assert.equal(instruction.totalCents,3000);
   assert.equal((await db.activity.findUniqueOrThrow({where:{id:f.a.id}})).restaurantId,restaurant.id);
   const compensation=await db.v11Request.findFirstOrThrow({where:{registrationId:f.reg.id,kind:'EXTRA_COMPENSATION'}});assert.equal(compensation.payload.amountCents,null);assert.ok(compensation.blockerIds.includes('OP-09'));
  });
  await t.test('privacy export excludes direct identifiers, closure retains obligations and original money facts',async()=>{
   const f=await fixture('privacy');
   const created=await aftersalesRoute(db,asPrincipal(u),'createRight',{body:{kind:'EXPORT',businessKey:prefix+'_export'}});
   const resolved=await aftersalesRoute(db,asPrincipal(ops),'processRight',{id:created.request.id});
   const exported=JSON.stringify(resolved.export);assert.ok(!exported.includes('wechatOpenid'));assert.ok(!exported.includes('phone'));assert.ok(!exported.includes(passwordHash));
   await assert.rejects(aftersalesRoute(db,asPrincipal(o),'getRight',{id:created.request.id}),e=>e.code==='RESOURCE_NOT_FOUND');
   const correction=await aftersalesRoute(db,asPrincipal(u),'createRight',{body:{kind:'CORRECTION',businessKey:prefix+'_correction',correction:{gender:'FEMALE',timePreferences:['TEST_ONLY'],adultDeclaration:true,serviceCompatible:true}}});
   await aftersalesRoute(db,asPrincipal(ops),'processRight',{id:correction.request.id});
   assert.equal((await db.v11Profile.findUniqueOrThrow({where:{userId:user.id}})).gender,'FEMALE');
   const closure=await aftersalesRoute(db,asPrincipal(u),'createRight',{body:{kind:'CLOSURE',businessKey:prefix+'_closure'}});
   const retained=await aftersalesRoute(db,asPrincipal(ops),'processRight',{id:closure.request.id});assert.equal(retained.request.state,'OBLIGATIONS_PENDING');
   assert.equal((await db.channelReceipt.findUniqueOrThrow({where:{id:f.receipt.id}})).amountCents,3000);assert.equal((await channel.query('PAYMENT',prefix+'_privacy_order')).amountCents,3000);
  });
  await t.test('20 competing refunds serialize component budgets and channel original-trade budget independently',async()=>{
   const f=await fixture('budget');
   let release;const barrier=new Promise(done=>release=done);
   const operations=Array.from({length:20},(_,i)=>(async()=>{await barrier;return db.$transaction(tx=>reserveRefund(tx,f.reg,f.receipt.id,{F:1000,D:2000},prefix+'_refund_'+i));})());
   release();await Promise.all(operations);
   const instructions=await db.v11RefundInstruction.findMany({where:{registrationId:f.reg.id}});assert.equal(instructions.length,1);assert.equal(instructions[0].totalCents,3000);
   const refund=await channel.refund(instructions[0].merchantRefundNo,f.trade.channelNo,3000);
   assert.equal((await channel.refund(instructions[0].merchantRefundNo,f.trade.channelNo,3000)).id,refund.id);
   await assert.rejects(channel.refund(prefix+'_excess',f.trade.channelNo,1),/budget exceeded/);
   assert.equal((await channelDb.mockChannelTransaction.aggregate({where:{kind:'REFUND',originalTradeNo:f.trade.channelNo,status:'SUCCEEDED'},_sum:{amountCents:true}}))._sum.amountCents,3000);
   // Real separate channel result remains queryable before local receipt acknowledgement.
   assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:instructions[0].id}})).state,'NEW');
  });
  await t.test('A lease expiration B completion fences old A finish and retry',async()=>{
   const kind=prefix+'_LEASE';
   const job=await db.durableJob.create({data:{kind,businessKey:prefix+'_lease',refId:prefix,runAt:new Date(0)}});
   const a=await claimJob(db,prefix+'_workerA',[kind]);assert.equal(a.id,job.id);
   await db.durableJob.update({where:{id:job.id},data:{leaseUntil:new Date(0)}}); // TEST_ONLY forced lease expiration.
   const b=await claimJob(db,prefix+'_workerB',[kind]);assert.ok(b.generation>a.generation);
   assert.equal(await finishJob(db,b),true);assert.equal(await finishJob(db,a),false);assert.equal(await retryJob(db,a,'SIMULATION-owner'),false);
   assert.equal((await db.durableJob.findUniqueOrThrow({where:{id:job.id}})).state,'DONE');
  });
 } finally {
  if(server){server.kill('SIGKILL');unregisterOwnedApi(scratch,server.pid);}
  // Preserve only this test's synthetic facts for recovery/evidence inspection. No broad cleanup.
  await db.$disconnect();await channelDb.$disconnect();
 }
});
