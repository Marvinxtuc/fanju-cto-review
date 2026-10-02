import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomBytes, randomUUID, scryptSync } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import { root, verifyOwnedEnvironment, childEnvironment, registerOwnedApi, unregisterOwnedApi, TASK_ID } from '../../scripts/prelaunch-owned-env.mjs';

test('real owned HTTP supply-to-payment-to-cancellation journey survives separate worker deaths after channel success', {timeout:180_000}, async()=>{
 const sourceRoot=process.env.PRELAUNCH_SOURCE_ROOT??root;
 const scratch=dirname(process.env.PRELAUNCH_ENV_FILE??'');
 const main=await verifyOwnedEnvironment(scratch,'empty'),other=await verifyOwnedEnvironment(scratch,'channel');
 const {PrismaPg}=createRequire(resolve(sourceRoot,'services/api/package.json'))('@prisma/adapter-pg');
 const {PrismaClient}=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/generated/prisma/client.js')));
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:main.runtime.database_url})});
 const channel=new PrismaClient({adapter:new PrismaPg({connectionString:other.runtime.database_url})});
 assert.equal(await db.activity.count(),0,'Dedicated fresh empty generation must have no activity');
 assert.equal(await db.v11SupplyRevision.count(),0,'Dedicated fresh empty generation must have no supply');
 assert.equal(await db.v11Registration.count(),0,'Dedicated fresh empty generation must have no registration');
 const id='prelaunch_http_'+randomUUID().replaceAll('-',''),password=randomBytes(24).toString('hex'),salt=randomBytes(16);
 const passwordHash=`scrypt:${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`;
 const user=await db.user.create({data:{id:id+'_user',wechatOpenid:'mock_'+id,phone:'synthetic-local'}});
 async function seedActor(suffix,role,userId=null,restaurantId=null){return db.v11Actor.create({data:{id:id+'_'+suffix,personId:id+'_'+suffix+'_person',role,passwordHash,userId,restaurantId}});}
 const userActor=await seedActor('user_actor','USER',user.id),ops=await seedActor('ops','OPS'),restaurantActor=await seedActor('restaurant','RESTAURANT');
 let server,worker;const env=childEnvironment(main.runtime);
 function launch(file,extra={}) {
  const child=spawn(process.execPath,[file],{cwd:resolve(sourceRoot,'services/api'),env:{...env,...extra},stdio:['ignore','pipe','pipe','ipc']});
  child.stdout.on('data',()=>{});child.stderr.on('data',()=>{});return child;
 }
 async function message(child,predicate,timeout=20000){return new Promise((done,reject)=>{
  const timer=setTimeout(()=>{cleanup();reject(new Error('Owned child IPC timeout'));},timeout);
  const receive=m=>{if(predicate(m)){cleanup();done(m);}};
  const exited=()=>{cleanup();reject(new Error('Owned child exited before requested barrier'));};
  function cleanup(){clearTimeout(timer);child.off('message',receive);child.off('exit',exited);}
  child.on('message',receive);child.once('exit',exited);
 });}
 async function until(predicate,timeout=15000){const end=Date.now()+timeout;while(Date.now()<end){if(await predicate())return;await delay(50);}throw new Error('Owned convergence timeout');}
 async function stop(child,signal='SIGTERM'){if(child.exitCode!==null||child.signalCode!==null)return;const wait=once(child,'exit');child.kill(signal);return await wait;}
 try {
  server=launch('dist/prelaunch/server.js',{PRELAUNCH_API_PORT:'0'});
  const ready=await message(server,m=>m?.type==='PRELAUNCH_READY');const base=registerOwnedApi(scratch,server,ready),api='/api/prelaunch/v11';
  async function request(path,method='GET',body,token,expected=200){
   const response=await fetch(base+api+path,{method,headers:{'x-fanju-contract':'prelaunch-v11-1',...(body?{'content-type':'application/json'}:{}),...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});
   const payload=await response.json();assert.equal(response.status,expected,JSON.stringify(payload));return payload;
  }
  assert.equal((await fetch(base+'/health/ready')).status,200,'Owned live HTTP readiness');
  const login=async actor=>(await request('/auth/login','POST',{actorId:actor.id,password})).token;
  const userToken=await login(userActor),opsToken=await login(ops);
  const frozen=await request('/policy/current');assert.equal(frozen.activation,'NOT_ACTIVATABLE');
  const policy=await request('/ops/simulation-policy','POST',{sourcePolicyId:frozen.policyId},opsToken);assert.equal(policy.scope,'TEST_ONLY');
  await request('/profile','PUT',{gender:'MALE',timePreferences:[],adultDeclaration:true,serviceCompatible:true},userToken);
  const documents=Object.fromEntries(policy.documents.map(d=>[d.documentId,d.fullHash])),publicHashes=Object.fromEntries(policy.documents.map(d=>[d.documentId,d.publicHash]));
  const consent=await request('/consents','POST',{policyId:policy.policyId,documentHashes:documents,publicHashes,confirm:true},userToken);
  const restaurant=await request('/ops/restaurants','POST',{name:'合成旅程餐厅',district:'上海',businessArea:'测试区',address:'合成测试地址',capacity:8,budgetCents:3000},opsToken);
  await request(`/ops/actors/${restaurantActor.id}/restaurant`,'POST',{restaurantId:restaurant.id},opsToken);const restaurantToken=await login(restaurantActor);assert.equal((await db.v11Actor.findUniqueOrThrow({where:{id:restaurantActor.id}})).restaurantId,restaurant.id,'Restaurant association comes only from authorized HTTP binding');
  const now=Date.now(),activity=await request('/ops/activities','POST',{restaurantId:restaurant.id,title:'合成餐饮旅程',startsAt:new Date(now+30*3600_000).toISOString(),endsAt:new Date(now+32*3600_000).toISOString(),registrationEndsAt:new Date(now+28*3600_000).toISOString()},opsToken);
  const supply=await request('/ops/supplies','POST',{activityId:activity.id,policyId:policy.policyId,min:4,target:6,max:8,maxTables:1,capacity:8,F:1000,D:2000,WAITLIST_MAX:2,strategy:'FILL_TO_TARGET',estimatedMealMinCents:3000,estimatedMealMaxCents:5000,fixedFees:[]},opsToken);
  await request(`/restaurant/supplies/${supply.id}/confirm`,'POST',{},restaurantToken);
  await request(`/ops/supplies/${supply.id}/approve`,'POST',{D_MIN:0,D_MAX:5000,simulationBatchHour:10},opsToken);
  await request(`/ops/activities/${activity.id}/publish`,'POST',{},opsToken);
  const reg=await request('/registrations','POST',{activityId:activity.id,supplyId:supply.id,policyId:policy.policyId,consentId:consent.consentId,membership:'FORMAL',businessKey:id+'_register'},userToken);
  const registrationId=reg.id??reg.registration?.id;assert.ok(registrationId,'HTTP registration must expose owned ID');
  const payment=await request(`/registrations/${registrationId}/pay`,'POST',{},userToken,202);
  const intent=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:payment.payment.id}});
  async function killAtChannelSuccess(kind,targetId){
   const runId=id+'_'+kind;
   worker=launch('dist/prelaunch/worker.js',{PRELAUNCH_FAULT_POINT:'CHANNEL_SUCCEEDED_BEFORE_LOCAL_ACK',PRELAUNCH_FAULT_RUN_ID:runId});
   const barrier=await message(worker,m=>{
    if(m?.type!=='PRELAUNCH_FAULT_BARRIER')return false;
    assert.equal(m.task_id,TASK_ID);assert.equal(m.owner_id,main.runtime.owner_id);assert.equal(m.pid,worker.pid);assert.equal(m.runId,runId);
    if(m.kind===kind&&m.intentId===targetId)return true;
    // Allow unrelated synthetic jobs to continue; never claim their barriers as this test.
    worker.send({type:'PRELAUNCH_FAULT_CONTINUE',runId});return false;
   });
   assert.equal(barrier.point,'CHANNEL_SUCCEEDED_BEFORE_LOCAL_ACK');
   await stop(worker,'SIGKILL');worker=null;
   // TEST_ONLY: force this owned job's expired lease so recovery does not wait 30 s.
   await db.durableJob.updateMany({where:{refId:targetId,state:'RUNNING'},data:{leaseUntil:new Date(0)}});
  }
  await killAtChannelSuccess('PAYMENT',intent.id);
  const channelPayment=await channel.mockChannelTransaction.findUniqueOrThrow({where:{businessKey:'PAYMENT:'+intent.merchantOrderNo}});assert.equal(channelPayment.amountCents,3000);assert.equal(channelPayment.status,'SUCCEEDED');
  assert.equal(await db.v11ReceiptBinding.count({where:{intentId:intent.id}}),0,'Killed worker must not have acknowledged receipt');
  worker=launch('dist/prelaunch/worker.js');
  await until(async()=>(await db.v11Registration.findUniqueOrThrow({where:{id:registrationId}})).eligibilityState==='FORMAL');
  await stop(worker);worker=null;
  assert.equal(await db.v11ReceiptBinding.count({where:{intentId:intent.id}}),1);
  assert.equal(await channel.mockChannelTransaction.count({where:{businessKey:'PAYMENT:'+intent.merchantOrderNo}}),1);
  await request(`/ops/activities/${activity.id}/cancel`,'POST',{businessKey:id+'_cancel',reason:'SIMULATION_ONLY platform cancellation'},opsToken,202);
  const refund=await db.v11RefundInstruction.findFirstOrThrow({where:{registrationId}});assert.equal(refund.totalCents,3000);assert.equal(refund.originalTradeNo,channelPayment.channelNo);
  await killAtChannelSuccess('REFUND',refund.id);
  const channelRefund=await channel.mockChannelTransaction.findUniqueOrThrow({where:{businessKey:'REFUND:'+refund.merchantRefundNo}});assert.equal(channelRefund.amountCents,3000);
  assert.notEqual((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}})).state,'CONFIRMED');
  worker=launch('dist/prelaunch/worker.js');await until(async()=>(await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}})).state==='CONFIRMED');await stop(worker);worker=null;
  assert.equal(await channel.mockChannelTransaction.count({where:{businessKey:'REFUND:'+refund.merchantRefundNo}}),1);
  assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:registrationId}})).active,false);
  const amount=(await channel.mockChannelTransaction.aggregate({where:{kind:'REFUND',originalTradeNo:channelPayment.channelNo},_sum:{amountCents:true}}))._sum.amountCents;assert.equal(amount,3000);
  assert.equal((await db.v11ReceiptBinding.findFirstOrThrow({where:{registrationId}})).classification,'PRIMARY');
  // PRE042: same independently verified fresh-empty generation, second full business scenario.
  // Existing first scenario has established only HTTP-created supply/registration and recovered refunds.
  // Bootstrap below is synthetic identities/roles only; all business facts are HTTP/worker produced.
  const fundingBefore=await request('/ops/funding-summary','GET',undefined,opsToken);
  const crew=[];
  for(let n=0;n<4;n++){
   const member=await db.user.create({data:{id:id+'_crew_user_'+n,wechatOpenid:'mock_'+id+'_crew_'+n,phone:'synthetic-local'}});
   const actor=await seedActor('crew_actor_'+n,'USER',member.id);const token=await login(actor);
   await request('/profile','PUT',{gender:n%2?'FEMALE':'MALE',timePreferences:[],adultDeclaration:true,serviceCompatible:true},token);
   const agreed=await request('/consents','POST',{policyId:policy.policyId,documentHashes:documents,publicHashes,confirm:true},token);
   crew.push({actor,token,consentId:agreed.consentId});
  }
  const reviewerA=await seedActor('first_review','REVIEWER'),reviewerB=await seedActor('final_review','REVIEWER');
  assert.notEqual(reviewerA.personId,reviewerB.personId);const firstReviewToken=await login(reviewerA),finalReviewToken=await login(reviewerB);
  const crewActivity=await request('/ops/activities','POST',{restaurantId:restaurant.id,title:'合成多人履约全旅程',startsAt:new Date(Date.now()+30*3600_000).toISOString(),endsAt:new Date(Date.now()+32*3600_000).toISOString(),registrationEndsAt:new Date(Date.now()+28*3600_000).toISOString()},opsToken);
  const crewSupply=await request('/ops/supplies','POST',{activityId:crewActivity.id,policyId:policy.policyId,min:4,target:4,max:4,maxTables:1,capacity:4,F:1000,D:2000,WAITLIST_MAX:2,strategy:'FILL_TO_TARGET',estimatedMealMinCents:3000,estimatedMealMaxCents:5000,fixedFees:[]},opsToken);
  await request(`/restaurant/supplies/${crewSupply.id}/confirm`,'POST',{},restaurantToken);
  await request(`/ops/supplies/${crewSupply.id}/approve`,'POST',{D_MIN:0,D_MAX:5000,simulationBatchHour:10},opsToken);
  await request(`/ops/activities/${crewActivity.id}/publish`,'POST',{},opsToken);
  for(let n=0;n<crew.length;n++){
   const member=crew[n];const joined=await request('/registrations','POST',{activityId:crewActivity.id,supplyId:crewSupply.id,policyId:policy.policyId,consentId:member.consentId,membership:'FORMAL',businessKey:id+'_crew_register_'+n},member.token);
   member.registrationId=joined.id??joined.registration?.id;assert.ok(member.registrationId);
   const paid=await request(`/registrations/${member.registrationId}/pay`,'POST',{},member.token,202);member.paymentId=paid.payment.id;
  }
  worker=launch('dist/prelaunch/worker.js');
  await until(async()=>await db.v11Registration.count({where:{id:{in:crew.map(m=>m.registrationId)},eligibilityState:'FORMAL'}})===4);
  await stop(worker);worker=null;
  const grouped=await db.v11Table.findMany({where:{activityId:crewActivity.id}});
  assert.equal(grouped.length,1);assert.equal(grouped[0].state,'FORMED');assert.equal(await db.v11Membership.count({where:{tableId:grouped[0].id,active:true}}),4);
  for(const member of crew){const view=await request(`/registrations/${member.registrationId}`,'GET',undefined,member.token);assert.equal(view.registration.state,'FORMAL');assert.equal(view.registration.table.state,'FORMED');assert.equal(view.registration.F,1000);assert.equal(view.registration.D,2000);}
  const code=await request(`/restaurant/activities/${crewActivity.id}/checkin-code`,'POST',{},restaurantToken,202);
  for(const member of crew)await request(`/registrations/${member.registrationId}/checkin`,'POST',{qrToken:code.qrToken},member.token,202);
  // Only synthetic clock coordinates are accelerated; no eligibility/table/payment/dispute state is injected.
  // This implements the approved local clock fixture without waiting thirty-two real hours.
  const clock=new Date();await db.activity.update({where:{id:crewActivity.id},data:{startsAt:new Date(clock.getTime()-3*3600_000),endsAt:new Date(clock.getTime()-1000),registrationEndsAt:new Date(clock.getTime()-4*3600_000)}});
  for(const member of crew.slice(0,3)){const normal=await request(`/restaurant/registrations/${member.registrationId}/fulfillment`,'POST',{result:'NORMAL'},restaurantToken,202);assert.equal(normal.channelConfirmed,false);const details=await request(`/registrations/${member.registrationId}`,'GET',undefined,member.token);assert.ok(details.registration.refunds.some(r=>r.state==='WAITING_BATCH'&&r.F===0&&r.D===2000));}
  const disputed=crew[3];await request(`/restaurant/registrations/${disputed.registrationId}/fulfillment`,'POST',{result:'ABNORMAL'},restaurantToken,202);
  const ownRequests=await request('/requests','GET',undefined,disputed.token),dispute=ownRequests.requests.find(r=>r.kind==='DISPUTE');assert.ok(dispute);
  const abnormal=(await request('/notices','GET',undefined,disputed.token)).notices.find(n=>n.kind==='ABNORMAL_NOTICE');assert.ok(abnormal);
  await request(`/notices/${abnormal.id}/receive`,'POST',{},disputed.token,202);
  await request(`/requests/${dispute.id}/explanation`,'POST',{businessKey:id+'_crew_explanation',statement:'仅合成事实说明'},disputed.token,202);
  await request(`/ops/requests/${dispute.id}/decision`,'POST',{decision:'BREACH',reason:'合成初次审核结论'},firstReviewToken,202);
  const firstResult=(await request('/notices','GET',undefined,disputed.token)).notices.find(n=>n.kind==='FIRST_RESULT');assert.ok(firstResult);
  await request(`/notices/${firstResult.id}/receive`,'POST',{},disputed.token,202);
  await request(`/requests/${dispute.id}/review`,'POST',{businessKey:id+'_crew_final',statement:'仅合成最终复核申请'},disputed.token,202);
  const blockedSame=await request(`/ops/requests/${dispute.id}/decision`,'POST',{decision:'REFUND_D',reason:'合成同人复核拒绝证明'},firstReviewToken,409);assert.equal(blockedSame.error.code,'DISTINCT_REVIEWER_PERSON_REQUIRED');
  await request(`/ops/requests/${dispute.id}/decision`,'POST',{decision:'REFUND_D',reason:'合成异人最终复核正常退D'},finalReviewToken,202);
  const decisions=await db.v11Decision.findMany({where:{requestId:dispute.id},orderBy:{createdAt:'asc'}});assert.deepEqual(decisions.map(d=>d.kind),['FIRST','FINAL']);assert.notEqual(decisions[0].personId,decisions[1].personId);
  const crewRefunds=await db.v11RefundInstruction.findMany({where:{registrationId:{in:crew.map(m=>m.registrationId)}}});assert.equal(crewRefunds.length,4);assert.ok(crewRefunds.every(r=>r.state==='WAITING_BATCH'&&r.serviceFeeCents===0&&r.depositCents===2000));
  const schedules=await db.durableJob.findMany({where:{kind:'V11_REFUND',refId:{in:crewRefunds.map(r=>r.id)}}});assert.equal(schedules.length,4);assert.ok(schedules.every(j=>j.runAt>clock),'API schedules refunds in their future explicit test batch, not immediately');
  // Approved disposable clock acceleration only: due coordinates change, instruction/business states stay intact.
  await db.durableJob.updateMany({where:{id:{in:schedules.map(j=>j.id)},state:'READY'},data:{runAt:new Date(0)}});
  worker=launch('dist/prelaunch/worker.js');await until(async()=>await db.v11RefundInstruction.count({where:{id:{in:crewRefunds.map(r=>r.id)},state:'CONFIRMED'}})===4);await stop(worker);worker=null;
  for(const member of crew){const detail=await request(`/registrations/${member.registrationId}`,'GET',undefined,member.token);assert.ok(detail.registration.refunds.some(r=>r.state==='CONFIRMED'&&r.F===0&&r.D===2000));assert.equal(await db.v11ReceiptBinding.count({where:{intentId:member.paymentId}}),1);}
  for(const refund of crewRefunds){const fact=await channel.mockChannelTransaction.findUniqueOrThrow({where:{businessKey:'REFUND:'+refund.merchantRefundNo}});assert.equal(fact.status,'SUCCEEDED');assert.equal(fact.amountCents,2000);assert.equal(fact.originalTradeNo,refund.originalTradeNo);}
  const reconciled=await request('/ops/reconciliation','POST',{},opsToken);assert.equal(reconciled.componentBudgetConflicts,0);assert.equal(reconciled.businessWithoutChannel,0);
  // Owned channel DB is shared by independent synthetic tests, so orphan stats are reported rather than blanket zero asserted.
  const finalFunding=await request('/ops/funding-summary','GET',undefined,opsToken);assert.equal(finalFunding.accountingRecognition,false);
  assert.equal(finalFunding.components.F.original-fundingBefore.components.F.original,4000);assert.equal(finalFunding.components.D.original-fundingBefore.components.D.original,8000);assert.equal(finalFunding.components.D.refunded-fundingBefore.components.D.refunded,8000);assert.equal(finalFunding.components.F.refunded-fundingBefore.components.F.refunded,0);
  for(const buckets of Object.values(finalFunding.components)){assert.ok(Object.values(buckets).every(v=>Number.isSafeInteger(v)&&v>=0));assert.equal(buckets.refunded+buckets.refundReserved+buckets.restaurantPaid+buckets.restaurantReserved+buckets.platformRetained+buckets.undisposed,buckets.original);}

  // Simulate only this app's unavailable DB read; do not stop the container or affect another owned DB.
  const {buildPrelaunchApp}=await import(pathToFileURL(resolve(sourceRoot,'services/api/dist/prelaunch/routes.js')));
  let unavailable=false;
  const scopedDb=new Proxy(db,{get(target,key){if(key==='$queryRaw'&&unavailable)return async()=>{throw Error('synthetic_readiness_db_unavailable');};const value=Reflect.get(target,key,target);return typeof value==='function'?value.bind(target):value;}});
  const readinessApp=await buildPrelaunchApp(scopedDb,env,sourceRoot,channel);
  try{assert.equal((await readinessApp.inject({method:'GET',url:'/health/ready'})).statusCode,200);unavailable=true;const failed=await readinessApp.inject({method:'GET',url:'/health/ready'});assert.equal(failed.statusCode,503);assert.deepEqual(failed.json(),{status:'not_ready'});assert.ok(!failed.body.includes('synthetic_readiness_db_unavailable'));}finally{unavailable=false;await readinessApp.close();}
  // A future persisted job is a durable stop marker; API shutdown must not consume or lose it.
  const shutdownJob=await db.durableJob.create({data:{kind:'V11_COMPAT_SHUTDOWN',businessKey:id+'_shutdown',refId:id,runAt:new Date(Date.now()+3600_000)}});
  const beforeStop=await db.durableJob.findUniqueOrThrow({where:{id:shutdownJob.id}});
  const began=Date.now(),[exitCode]=await stop(server);assert.equal(exitCode,0);assert.ok(Date.now()-began<15000,'SIGTERM must drain within bounded15s');
  const afterStop=await db.durableJob.findUniqueOrThrow({where:{id:shutdownJob.id}});assert.equal(afterStop.state,beforeStop.state);assert.equal(afterStop.generation,beforeStop.generation);assert.equal(afterStop.attempts,beforeStop.attempts);assert.equal(afterStop.businessKey,beforeStop.businessKey);
  unregisterOwnedApi(scratch,server.pid);server=null;

 } finally {
  if(worker)await stop(worker,'SIGKILL');if(server){await stop(server);unregisterOwnedApi(scratch,server.pid);}
  await Promise.all([db.$disconnect(),channel.$disconnect()]);
 }
});
