import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {randomUUID,randomBytes,scryptSync} from 'node:crypto';
import {formalRuntimeFixture} from '../prelaunch/formal-runtime-fixture.mjs';
import {verifyOwnedEnvironment,childEnvironment} from '../../scripts/prelaunch-owned-env.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT,scratch=process.env.PRELAUNCH_FORMAL_SCRATCH;
if(!repo||!scratch||process.env.APP_ENV!=='ci'||process.env.NODE_ENV!=='test'||!process.connected)throw Error('Isolated formal HTTP child required');
const {runtime}=await verifyOwnedEnvironment(scratch,'empty'),env=childEnvironment(runtime),prefix='formal_dom_'+randomUUID().replaceAll('-','');
const require=createRequire(repo+'/services/api/package.json'),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(repo+'/services/api/dist/generated/prisma/client.js'));
const {buildApp}=await import(pathToFileURL(repo+'/services/api/dist/app.js'));
const {signSession}=await import(pathToFileURL(repo+'/services/api/dist/auth.js'));
const {createFormalPolicyArchive}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/formal-policy-archive.js'));
const {assembleFormalRuntimePolicy}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/formal-runtime-policy.js'));
const {formalRefundService}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/formal-refund-service.js'));
const {runOne}=await import(pathToFileURL(repo+'/services/api/dist/jobs/queue.js'));
const db=new PrismaClient({adapter:new PrismaPg({connectionString:runtime.database_url})});
const restaurant=await db.restaurant.create({data:{id:prefix+'_restaurant',name:'合成菜单餐厅',district:'合成区',businessArea:'合成商圈',address:'合成受限地址',contactName:'合成联系人',contactPhone:'synthetic-phone',budgetCents:1000,cuisineTags:[],capacity:8}});
const activity=await db.activity.create({data:{id:prefix+'_activity',restaurantId:restaurant.id,title:'合成正式菜单体验 '+prefix+'_activity',theme:'菜单体验',description:'隔离合成材料',district:'合成区',businessArea:'合成商圈',startsAt:new Date(Date.now()+72*3600000),endsAt:new Date(Date.now()+74*3600000),registrationEndsAt:new Date(Date.now()+64*3600000),serviceFeeCents:0,mealFeePolicyText:'餐费到店直接支付',capacity:8}});
const rows=[];for(const role of ['OPS','RESTAURANT'])rows.push(await db.v11Actor.create({data:{id:prefix+'_'+role,personId:prefix+'_'+role+'_person',role,restaurantId:role==='RESTAURANT'?restaurant.id:null,passwordHash:'EXTERNAL_SESSION_ONLY'}}));
const user=await db.user.create({data:{wechatOpenid:prefix+'_synthetic_openid',phone:'synthetic-authorized-phone'}});
await db.v11Actor.create({data:{role:'USER',personId:prefix+'_user_person',userId:user.id,passwordHash:'EXTERNAL_SESSION_ONLY'}});
const legacyActivity=await db.activity.create({data:{...activity,id:prefix+'_legacy_activity',title:'合成旧订单菜单体验'}});
const legacyOrder=await db.order.create({data:{id:prefix+'_legacy_order',userId:user.id,activityId:legacyActivity.id,amountCents:1234,status:'REFUNDING',agreementVersion:'SYNTHETIC_LEGACY_VERSION'}});
const legacyRefund=await db.refund.create({data:{id:prefix+'_legacy_refund',orderId:legacyOrder.id,amountCents:234,status:'REFUNDING',reason:'合成历史退款',requestedBy:user.id}});
const foreignUser=await db.user.create({data:{wechatOpenid:prefix+'_foreign_synthetic'}});
const foreignOrder=await db.order.create({data:{id:prefix+'_foreign_order',userId:foreignUser.id,activityId:legacyActivity.id,amountCents:9876,status:'PENDING_PAYMENT',agreementVersion:'SYNTHETIC_LEGACY_VERSION'}});
const now=new Date(),f=formalRuntimeFixture(prefix,now,{memberRemovalEvent:'DECISION_ACCEPTED',refundBatchUtcMinutes:[(now.getUTCHours()*60+now.getUTCMinutes()+1)%1440]});
const ops={...rows[0],role:'OPS'};
const archive=await createFormalPolicyArchive(db).archive(f.materialRaw,{sha256:f.context.materialSha256,releaseVersion:f.context.releaseVersion,inheritedBaselineHash:f.material.inheritedBaselineHash},f.trust.evidence,ops);
const policy=await assembleFormalRuntimePolicy(db,ops,archive.archiveId,f.parameterRaw,f.authority());
const password=randomBytes(24).toString('hex'),accounts=rows.map(row=>{const salt=randomBytes(16).toString('hex');return {accountId:row.id,username:row.id,accountVersion:'synthetic-v1',enabled:true,passwordHash:'scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex'),actorId:row.id,personId:row.personId,actorVersion:row.version,role:row.role,restaurantId:row.restaurantId};});
const payments=new Map(),refunds=new Map();let paymentSends=0,refundSends=0;
const channel={assertBinding(x){if(x.channel!=='wechat'||x.merchantScope!==f.context.merchantScope||x.providerConfigId!==f.context.providerConfigId)throw Error('Synthetic transport binding conflict');},
 async queryPayment(x){this.assertBinding(x);return payments.get(x.merchantOrderNo)??{status:'NOT_FOUND',merchantOrderNo:x.merchantOrderNo};},
 async preparePayment(x,openid,beforeSend){this.assertBinding(x);if(!openid)throw Error('Missing synthetic user');await beforeSend();paymentSends++;payments.set(x.merchantOrderNo,{status:'SUCCEEDED',merchantOrderNo:x.merchantOrderNo,channelTradeNo:prefix+'_trade',amountCents:x.totalCents,currency:'CNY',paidAt:new Date().toISOString()});return {kind:'PREPARED',prepayId:'synthetic-prepay',paymentParams:{appId:'synthetic-app',timeStamp:'1790860000',nonceStr:'synthetic-nonce',package:'prepay_id=synthetic-prepay',signType:'RSA',paySign:'synthetic-signature'}};},
 resumePayment(){throw Error('Unexpected synthetic resume');},async closePayment(){throw Error('Unexpected synthetic closure');},
 async queryRefund(x){this.assertBinding(x);return refunds.get(x.merchantRefundNo)??{status:'NOT_FOUND',merchantRefundNo:x.merchantRefundNo};},
 async submitRefund(x,beforeSend){this.assertBinding(x);await beforeSend();refundSends++;refunds.set(x.merchantRefundNo,{status:'SUCCEEDED',merchantRefundNo:x.merchantRefundNo,channelRefundNo:prefix+'_refund',originalTradeNo:x.originalTradeNo,amountCents:x.totalCents,currency:'CNY',refundedAt:new Date().toISOString()});return {channel:'wechat',channelRefundNo:prefix+'_refund'};}};
const app=await buildApp({prisma:db,providerEnv:{...env,AUTH_PROVIDER:'wechat',PHONE_PROVIDER:'wechat',WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_MINIAPP_APP_SECRET:'synthetic-test-secret',FEATURE_V11_IDENTITY:'true',FEATURE_V11_FORMAL_BUSINESS:'true',FEATURE_V11_FORMAL_PAYMENT:'true',V11_FORMAL_CASE_OWNER:rows[0].id,V11_CONTROLLED_ACCOUNTS_JSON:JSON.stringify(accounts)},formalRuntimeAuthoritySource:async()=>f.authority(),formalChannel:channel,providerHttpClient:async()=>{throw Error('External channel forbidden');}});

// A second, owned synthetic activity exercises formal restaurant fulfillment UI.
const fulfillmentActivity=await db.activity.create({data:{...activity,id:prefix+'_fulfillment_activity',title:'合成履约菜单体验 '+prefix+'_fulfillment_activity'}});
const call=async(method,url,headers,payload)=>{const response=await app.inject({method,url,headers,...(payload===undefined?{}:{payload})});if(response.statusCode<200||response.statusCode>=300)throw Error('Synthetic fulfillment setup rejected');return response.json();};
const headersFor=async row=>({authorization:'Bearer '+(await call('POST','/api/v11/ops/login',undefined,{username:row.id,password})).token});
const restHeaders=await headersFor(rows[1]),opsHeaders=await headersFor(rows[0]),userHeaders={authorization:'Bearer '+signSession(app,{sub:user.id,role:'USER'})};
const proposal=await call('POST','/api/v11/restaurant/activities/'+fulfillmentActivity.id+'/supply-proposals',restHeaders,{policyId:policy.policyId,businessKey:prefix+'_fulfillment_supply',min:4,target:4,max:4,maxTables:1,strategy:'FILL_TO_TARGET',depositCents:200,waitlistMax:4});
const approved=await call('POST','/api/v11/ops/supply-proposals/'+proposal.proposalId+'/approve',opsHeaders,{activityFeeCents:null});await call('POST','/api/v11/ops/formal/activities/'+fulfillmentActivity.id+'/publish',opsHeaders,{supplyId:approved.supplyId});
const delivery=await call('GET','/api/v11/policies/'+policy.policyId+'/delivery',userHeaders);await call('PUT','/api/v11/formal/profile',userHeaders,{policyId:policy.policyId,gender:'MALE',adultDeclaration:true,serviceCompatible:true});const consent=await call('POST','/api/v11/policies/'+policy.policyId+'/consents',userHeaders,{deliveryId:delivery.deliveryId,fullHashes:delivery.fullHashes,publicHashes:delivery.publicHashes});
const signup=await call('POST','/api/v11/formal/registrations',userHeaders,{activityId:fulfillmentActivity.id,supplyId:approved.supplyId,policyId:policy.policyId,consentId:consent.consentId,membership:'FORMAL',businessKey:prefix+'_fulfillment_signup'});
const fulfillmentIntent=await db.v11PaymentIntent.findFirstOrThrow({where:{registrationId:signup.registration.id}});payments.set(fulfillmentIntent.merchantOrderNo,{status:'SUCCEEDED',merchantOrderNo:fulfillmentIntent.merchantOrderNo,channelTradeNo:prefix+'_fulfillment_trade',amountCents:fulfillmentIntent.totalCents,currency:'CNY',paidAt:new Date().toISOString()});await call('POST','/api/v11/formal/registrations/'+signup.registration.id+'/payment/query',userHeaders,{});
await db.activity.update({where:{id:fulfillmentActivity.id},data:{startsAt:new Date(Date.now()-3*3600000),endsAt:new Date(Date.now()-3600000)}});

await app.listen({host:'127.0.0.1',port:0});
process.send({type:'PRELAUNCH_READY',task_id:'FJ-PRELAUNCH-MASTER-V1.1-20261001-01',owner_id:runtime.owner_id,pid:process.pid,port:app.server.address().port,
 activityId:activity.id,fulfillmentRegistrationId:signup.registration.id,fulfillmentActivityId:fulfillmentActivity.id,legacyOrderId:legacyOrder.id,foreignOrderId:foreignOrder.id,policyId:policy.policyId,userToken:signSession(app,{sub:user.id,role:'USER'}),opsUsername:rows[0].id,restaurantUsername:rows[1].id,password});
const handlers=formalRefundService(db,async()=>f.authority(),channel,rows[0].id).handlers;
let stopping=false,working;const timer=setInterval(()=>{if(stopping||working)return;working=runOne(db,prefix+'_worker',rows[0].id,handlers,['V11_WECHAT_REFUND'],f.context).catch(()=>{process.send?.({type:'WORKER_FAILURE',code:'FORMAL_TEST_WORKER_FAILED'});}).finally(()=>{working=undefined;});},250);
process.on('message',async message=>{if(message?.type==='COUNTS')process.send({type:'COUNTS',paymentSends,refundSends,registrations:await db.v11Registration.count({where:{activityId:activity.id}}),legacyOrderVersion:(await db.order.findUniqueOrThrow({where:{id:legacyOrder.id}})).version,legacyRefundState:(await db.refund.findUniqueOrThrow({where:{id:legacyRefund.id}})).status});});
process.once('SIGTERM',async()=>{stopping=true;clearInterval(timer);await working;await app.close();await db.$disconnect();process.disconnect();});
