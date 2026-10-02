import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,verifyOwnedEnvironment,childEnvironment} from '../../scripts/prelaunch-owned-env.mjs';
import {formalRuntimeFixture} from './formal-runtime-fixture.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT??root;const require=createRequire(resolve(repo,'services/api/package.json'));
const {PrismaPg}=require('@prisma/adapter-pg');const {PrismaClient}=await import(pathToFileURL(resolve(repo,'services/api/dist/generated/prisma/client.js')));
const {createFormalPolicyArchive}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/formal-policy-archive.js')));
const {assembleFormalRuntimePolicy}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/formal-runtime-policy.js')));
const {buildApp}=await import(pathToFileURL(resolve(repo,'services/api/dist/app.js')));
const {signSession}=await import(pathToFileURL(resolve(repo,'services/api/dist/auth.js')));
const {formalRefundService}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/formal-refund-service.js')));
const {runOne}=await import(pathToFileURL(resolve(repo,'services/api/dist/jobs/queue.js')));
test('main application formal restaurant proposal and platform price approval',async t=>{
 const {runtime}=await verifyOwnedEnvironment(dirname(process.env.PRELAUNCH_ENV_FILE??''),'empty');
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:runtime.database_url})});const prefix='supply_'+randomUUID().replaceAll('-','');
 const clock=new Date();const batchMinute=(clock.getUTCHours()*60+clock.getUTCMinutes()+1)%1440;
 const f=formalRuntimeFixture(prefix,clock,{memberRemovalEvent:'DECISION_ACCEPTED',refundBatchUtcMinutes:[batchMinute]});const restaurant=await db.restaurant.create({data:{id:prefix+'_restaurant',name:'合成餐厅',district:'合成区',businessArea:'合成商圈',address:'合成地址',contactName:'合成联系人',contactPhone:'synthetic-restaurant-phone',budgetCents:10000,cuisineTags:[],capacity:8}});
 let paymentState='NOT_FOUND',sends=0,lastMerchantNo,paidAt,refundSends=0,refundState='NOT_FOUND';
 const paymentParams={appId:'synthetic-formal-app',timeStamp:'1790860000',nonceStr:'synthetic-nonce',package:'prepay_id=synthetic-prepay',signType:'RSA',paySign:'synthetic-signature'};
 const channel={assertBinding(input){assert.equal(input.channel,'wechat');assert.equal(input.merchantScope,f.context.merchantScope);assert.equal(input.providerConfigId,f.context.providerConfigId);},
  async queryPayment(input){this.assertBinding(input);return paymentState==='NOT_FOUND'?{status:'NOT_FOUND',merchantOrderNo:input.merchantOrderNo}:{status:paymentState,merchantOrderNo:input.merchantOrderNo,amountCents:input.totalCents,currency:'CNY',...(paymentState==='SUCCEEDED'?{channelTradeNo:prefix+'_trade',paidAt}:{})};},
  async preparePayment(input,openid,beforeSend){this.assertBinding(input);assert.ok(openid);await beforeSend();sends++;lastMerchantNo=input.merchantOrderNo;paymentState='PENDING';return {kind:'PREPARED',prepayId:'synthetic-prepay',paymentParams};},
  resumePayment(input){this.assertBinding(input);assert.equal(input.merchantOrderNo,lastMerchantNo);return {kind:'PREPARED',prepayId:'synthetic-prepay',paymentParams};},
  async submitRefund(input,beforeSend){this.assertBinding(input);await beforeSend();refundSends++;refundState='SUCCEEDED';return {channel:'wechat',channelRefundNo:prefix+'_refund'};},
  async queryRefund(input){this.assertBinding(input);return refundState==='NOT_FOUND'?{status:'NOT_FOUND',merchantRefundNo:input.merchantRefundNo}:{status:'SUCCEEDED',merchantRefundNo:input.merchantRefundNo,originalTradeNo:input.originalTradeNo,amountCents:input.totalCents,currency:'CNY',channelRefundNo:prefix+'_refund',refundedAt:new Date().toISOString()};},async closePayment(){throw Error('Unexpected closure');}};
 const activity=await db.activity.create({data:{id:prefix+'_activity',restaurantId:restaurant.id,title:'合成菜单体验',theme:'合成主题',description:'隔离测试资料',district:'合成区',businessArea:'合成商圈',startsAt:new Date(Date.now()+48*3600000),endsAt:new Date(Date.now()+50*3600000),registrationEndsAt:new Date(Date.now()+40*3600000),serviceFeeCents:0,mealFeePolicyText:'餐费到店直接支付',capacity:8}});
 const opsRow=await db.v11Actor.create({data:{id:prefix+'_ops',personId:prefix+'_ops_person',role:'OPS',passwordHash:'EXTERNAL_SESSION_ONLY'}});
 const restRow=await db.v11Actor.create({data:{id:prefix+'_rest',personId:prefix+'_rest_person',role:'RESTAURANT',restaurantId:restaurant.id,passwordHash:'EXTERNAL_SESSION_ONLY'}});
 const ops={id:opsRow.id,personId:opsRow.personId,role:'OPS',version:opsRow.version,userId:null,restaurantId:null};
 let app;
 try{
  const archived=await createFormalPolicyArchive(db).archive(f.materialRaw,{sha256:f.context.materialSha256,releaseVersion:f.context.releaseVersion,inheritedBaselineHash:f.material.inheritedBaselineHash},f.trust.evidence,ops);
  const policy=await assembleFormalRuntimePolicy(db,ops,archived.archiveId,f.parameterRaw,f.authority());
  const password='synthetic-controlled-test-password';const accounts=[opsRow,restRow].map(row=>{const salt=randomBytes(16).toString('hex');return {accountId:row.id,username:row.id,accountVersion:'synthetic-v1',enabled:true,passwordHash:'scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex'),actorId:row.id,personId:row.personId,actorVersion:row.version,role:row.role,restaurantId:row.restaurantId};});
  app=await buildApp({prisma:db,providerEnv:{...childEnvironment(runtime),AUTH_PROVIDER:'wechat',PHONE_PROVIDER:'wechat',WECHAT_MINIAPP_APP_ID:'synthetic-formal-app',WECHAT_MINIAPP_APP_SECRET:'wx_test_secret',FEATURE_V11_IDENTITY:'true',FEATURE_V11_FORMAL_BUSINESS:'true',FEATURE_V11_FORMAL_PAYMENT:'true',V11_FORMAL_CASE_OWNER:opsRow.id,V11_CONTROLLED_ACCOUNTS_JSON:JSON.stringify(accounts)},formalRuntimeAuthoritySource:async()=>f.authority(),formalChannel:channel,providerHttpClient:async()=>{throw Error('No real channel call in supply test');}});
  const login=async row=>{const r=await app.inject({method:'POST',url:'/api/v11/ops/login',payload:{username:row.id,password}});assert.equal(r.statusCode,200);return {authorization:'Bearer '+r.json().token};};
  const opsHeaders=await login(opsRow),restHeaders=await login(restRow);
  const proposal={policyId:policy.policyId,businessKey:prefix+'_proposal',min:4,target:6,max:8,maxTables:1,strategy:'FILL_TO_TARGET',depositCents:500,waitlistMax:4};
  const proposalUrl='/api/v11/restaurant/activities/'+activity.id+'/supply-proposals';let accepted,approved;
  await t.test('ordinary user token and wrong controlled role cannot propose',async()=>{
   const user=await db.user.create({data:{wechatOpenid:'mock_'+prefix}});
   await db.v11Actor.create({data:{role:'USER',userId:user.id,personId:prefix+'_user',passwordHash:'EXTERNAL_SESSION_ONLY'}});
   assert.equal((await app.inject({method:'POST',url:proposalUrl,headers:{authorization:'Bearer '+signSession(app,{sub:user.id,role:'USER'})},payload:proposal})).statusCode,401);
   assert.equal((await app.inject({method:'POST',url:proposalUrl,headers:opsHeaders,payload:proposal})).statusCode,403);
  });
  await t.test('restaurant cannot submit approval or platform fee fields',async()=>{
   assert.equal((await app.inject({method:'POST',url:proposalUrl,headers:restHeaders,payload:{...proposal,approved:true}})).statusCode,400);
   assert.equal((await app.inject({method:'POST',url:proposalUrl,headers:restHeaders,payload:{...proposal,serviceFeeCents:999}})).statusCode,400);
  });
  await t.test('authenticated proposal preserves original time and no supply is approved yet',async()=>{
   const r=await app.inject({method:'POST',url:proposalUrl,headers:restHeaders,payload:proposal});assert.equal(r.statusCode,200,r.body);accepted=r.json();
   assert.equal(accepted.state,'PENDING_PLATFORM_APPROVAL');assert.equal(await db.v11SupplyRevision.count({where:{activityId:activity.id}}),0);
   const replay=await app.inject({method:'POST',url:proposalUrl,headers:restHeaders,payload:proposal});assert.deepEqual(replay.json(),accepted);
  });
  await t.test('changed proposal with same business key conflicts',async()=>{
   assert.equal((await app.inject({method:'POST',url:proposalUrl,headers:restHeaders,payload:{...proposal,depositCents:600}})).statusCode,409);
  });
  await t.test('restaurant cannot platform-approve its proposal',async()=>{
   assert.equal((await app.inject({method:'POST',url:'/api/v11/ops/supply-proposals/'+accepted.proposalId+'/approve',headers:restHeaders,payload:{activityFeeCents:null}})).statusCode,403);
  });
  await t.test('platform approval binds exact policy, parameter and F/D revision',async()=>{
   const url='/api/v11/ops/supply-proposals/'+accepted.proposalId+'/approve';const r=await app.inject({method:'POST',url,headers:opsHeaders,payload:{activityFeeCents:null}});
   assert.equal(r.statusCode,200,r.body);approved=r.json();assert.equal(approved.state,'FORMAL_APPROVED');
   assert.equal(approved.quote.F,100);assert.equal(approved.quote.D,500);assert.equal(approved.quote.total,600);assert.equal(approved.quote.supplyRevisionId,approved.supplyId);
   const row=await db.v11SupplyRevision.findUniqueOrThrow({where:{id:approved.supplyId}});assert.equal(row.status,'FORMAL_APPROVED');assert.equal(row.snapshot.scope,'FORMAL_SUPPLY');assert.equal(row.snapshot.environment,'ISOLATED_TEST');
   const replay=await app.inject({method:'POST',url,headers:opsHeaders,payload:{activityFeeCents:null}});assert.deepEqual(replay.json(),approved);
   assert.equal((await app.inject({method:'POST',url,headers:opsHeaders,payload:{activityFeeCents:200}})).statusCode,409);
   assert.equal(await db.v11SupplyRevision.count({where:{activityId:activity.id}}),1);
  });
  await t.test('approved revision cannot be edited',async()=>{await assert.rejects(db.v11SupplyRevision.update({where:{id:approved.supplyId},data:{serviceFeeCents:200}}));});
  await t.test('main formal publication profile consent registration and owned read chain',async()=>{
   const url='/api/v11/ops/formal/activities/'+activity.id+'/publish';
   assert.equal((await app.inject({method:'POST',url,headers:restHeaders,payload:{supplyId:approved.supplyId}})).statusCode,403);
   const publish=await app.inject({method:'POST',url,headers:opsHeaders,payload:{supplyId:approved.supplyId}});assert.equal(publish.statusCode,200,publish.body);
   const u=await db.user.create({data:{wechatOpenid:'mock_'+prefix+'_registrant',phone:'synthetic-authorized-phone'}});
   await db.v11Actor.create({data:{role:'USER',userId:u.id,personId:prefix+'_registrant_person',passwordHash:'EXTERNAL_SESSION_ONLY'}});
   const headers={authorization:'Bearer '+signSession(app,{sub:u.id,role:'USER'})};
   const delivery=await app.inject({url:'/api/v11/policies/'+policy.policyId+'/delivery',headers});assert.equal(delivery.statusCode,200,delivery.body);
   const d=delivery.json();const consent=await app.inject({method:'POST',url:'/api/v11/policies/'+policy.policyId+'/consents',headers,
    payload:{deliveryId:d.deliveryId,fullHashes:d.fullHashes,publicHashes:d.publicHashes}});assert.equal(consent.statusCode,200,consent.body);
   const body={activityId:activity.id,supplyId:approved.supplyId,policyId:policy.policyId,consentId:consent.json().consentId,membership:'FORMAL',businessKey:prefix+'_signup'};
   const signup=payload=>app.inject({method:'POST',url:'/api/v11/formal/registrations',headers,payload});
   assert.equal((await signup(body)).statusCode,409);
   const profile=await app.inject({method:'PUT',url:'/api/v11/formal/profile',headers,payload:{policyId:policy.policyId,gender:'MALE',adultDeclaration:true,serviceCompatible:true}});assert.equal(profile.statusCode,200,profile.body);
   const responses=await Promise.all([signup(body),signup(body)]);for(const r of responses)assert.equal(r.statusCode,200,r.body);
   const reg=responses[0].json().registration;assert.equal(responses[1].json().registration.id,reg.id);
   assert.equal(reg.F,100);assert.equal(reg.D,500);assert.equal(reg.total,600);assert.equal(reg.state,'PENDING_PAYMENT');
   assert.equal(Date.parse(reg.holdExpiresAt)-Date.parse(reg.acceptedAt),600000);
   const intent=await db.v11PaymentIntent.findFirstOrThrow({where:{registrationId:reg.id}});assert.equal(intent.channel,'wechat');assert.equal(intent.totalCents,600);assert.equal(intent.preparationState,'NOT_STARTED');assert.equal(intent.merchantScope,f.context.merchantScope);
   assert.equal(await db.v11PaymentIntent.count({where:{registrationId:reg.id}}),1);
   assert.equal((await signup({...body,membership:'WAITLIST'})).statusCode,409);
   const blocked=await signup({...body,membership:'WAITLIST',businessKey:prefix+'_waitlist'});assert.equal(blocked.statusCode,202,blocked.body);assert.deepEqual(blocked.json().blockerIds,['OP-05']);
   const repeated=await signup({...body,membership:'WAITLIST',businessKey:prefix+'_waitlist'});assert.deepEqual(repeated.json(),blocked.json());
   const prepUrl='/api/v11/formal/registrations/'+reg.id+'/payment/prepare';
   const prepare=await app.inject({method:'POST',url:prepUrl,headers,payload:{}});assert.equal(prepare.statusCode,200,prepare.body);assert.equal(prepare.json().state,'PREPARED');
   assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:reg.id}})).eligibilityState,'PENDING_PAYMENT');assert.equal(await db.channelReceipt.count({where:{merchantOrderNo:intent.merchantOrderNo}}),0);
   assert.equal((await app.inject({method:'POST',url:prepUrl,headers,payload:{}})).statusCode,200);assert.equal(sends,1);assert.equal(lastMerchantNo,intent.merchantOrderNo);
   paymentState='SUCCEEDED';paidAt=new Date().toISOString();
   const query=await app.inject({method:'POST',url:'/api/v11/formal/registrations/'+reg.id+'/payment/query',headers,payload:{}});assert.equal(query.statusCode,200,query.body);assert.equal(query.json().qualification.state,'FORMAL');
   assert.equal(await db.v11Membership.count({where:{registrationId:reg.id,active:true}}),1);
   assert.equal((await db.v11SeatHold.findUniqueOrThrow({where:{registrationId:reg.id}})).state,'RELEASED');
   assert.equal(await db.channelReceipt.count({where:{merchantOrderNo:intent.merchantOrderNo}}),1);
   assert.equal(await db.v11DeliveryProof.count({where:{registrationId:reg.id,proofType:'SIMULATED'}}),0);
   const replayQuery=await app.inject({method:'POST',url:'/api/v11/formal/registrations/'+reg.id+'/payment/query',headers,payload:{}});assert.equal(replayQuery.statusCode,200,replayQuery.body);assert.equal(await db.v11Membership.count({where:{registrationId:reg.id}}),1);
   const request=await app.inject({method:'POST',url:'/api/v11/formal/registrations/'+reg.id+'/refund-requests',headers,payload:{businessKey:prefix+'_refund_request'}});assert.equal(request.statusCode,200,request.body);assert.equal(request.json().state,'ACCEPTED');
   const decide=await app.inject({method:'POST',url:'/api/v11/ops/formal/refund-requests/'+request.json().requestId+'/decide',headers:opsHeaders,payload:{}});assert.equal(decide.statusCode,200,decide.body);
   const decision=decide.json();assert.equal(decision.ruleCode,'UNFORMED_FULL_REFUND');assert.equal(decision.entitlement.refundF,100);assert.equal(decision.entitlement.refundD,500);assert.equal(decision.acceptedAt,request.json().acceptedAt);assert.equal(refundSends,0);
   assert.equal((await db.v11Membership.findUniqueOrThrow({where:{registrationId:reg.id}})).active,false);
   const refunds=formalRefundService(db,async()=>f.authority(),channel,opsRow.id);
   assert.equal(await runOne(db,prefix+'_worker',opsRow.id,refunds.handlers,['V11_WECHAT_REFUND'],f.context),false);
   const delay=Date.parse(decision.batchAt)-Date.now()+30;assert.ok(delay>=0&&delay<65000,'synthetic batch must be imminent');
   await new Promise(resolve=>setTimeout(resolve,delay));
   // Queue eligibility uses PostgreSQL clock_timestamp, not this process clock.
   // Bound the polling without moving runAt or bypassing the batch gate.
   let claimed=false;const claimDeadline=Date.now()+3000;
   while(!claimed&&Date.now()<claimDeadline){claimed=await runOne(db,prefix+'_worker',opsRow.id,refunds.handlers,['V11_WECHAT_REFUND'],f.context);if(!claimed)await new Promise(resolve=>setTimeout(resolve,50));}
   assert.equal(claimed,true,'refund job must become due on the database clock');assert.equal(refundSends,1);
   assert.equal(await runOne(db,prefix+'_worker',opsRow.id,refunds.handlers,['V11_WECHAT_REFUND'],f.context),false);
   const refundQuery=await app.inject({method:'POST',url:'/api/v11/formal/registrations/'+reg.id+'/refunds/query',headers,payload:{}});assert.equal(refundQuery.statusCode,200,refundQuery.body);assert.equal(refundQuery.json().results[0].kind,'CONFIRMED');
   assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:decision.instructionIds[0]}})).state,'CONFIRMED');
   const other=await db.user.create({data:{wechatOpenid:'mock_'+prefix+'_foreign'}});await db.v11Actor.create({data:{role:'USER',userId:other.id,personId:prefix+'_foreign_person',passwordHash:'EXTERNAL_SESSION_ONLY'}});
   const foreign=await app.inject({url:'/api/v11/formal/registrations/'+reg.id,headers:{authorization:'Bearer '+signSession(app,{sub:other.id,role:'USER'})}});assert.ok([403,404].includes(foreign.statusCode));
   f.trust.revokedIds.add(f.grant.id);assert.equal((await signup({...body,businessKey:prefix+'_revoked'})).statusCode,503);f.trust.revokedIds.clear();
  });
  await t.test('authority revocation blocks another approval without deleting proposal',async()=>{
   const r=await app.inject({method:'POST',url:proposalUrl,headers:restHeaders,payload:{...proposal,businessKey:prefix+'_second'}});assert.equal(r.statusCode,200,r.body);
   const id=r.json().proposalId;f.trust.revokedIds.add(f.grant.id);const response=await app.inject({method:'POST',url:'/api/v11/ops/supply-proposals/'+id+'/approve',headers:opsHeaders,payload:{activityFeeCents:null}});
   assert.equal(response.statusCode,503);assert.equal(response.json().error.code,'FORMAL_ACTION_AUTHORITY_UNAVAILABLE');assert.equal((await db.v11Request.findUniqueOrThrow({where:{id}})).state,'PENDING_PLATFORM_APPROVAL');f.trust.revokedIds.clear();
  });
 }finally{if(app)await app.close();await db.$disconnect();}
});
