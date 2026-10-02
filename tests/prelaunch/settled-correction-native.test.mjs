import {syntheticConsentDocuments,syntheticConsentHashes} from './fixtures/synthetic-consent.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;
if(!repo)throw Error('Explicit owned source root required');
const require=createRequire(`${repo}/services/api/package.json`);
const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const domain=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/domain.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {PersistentMockChannel}=await import(pathToFileURL(`${repo}/services/api/dist/funding/mock-channel.js`));
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const channelDb=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.PRELAUNCH_CHANNEL_DATABASE_URL})});
await verifyOwnedDatabase(db,process.env);await verifyOwnedDatabase(channelDb,{...process.env,PRELAUNCH_DATABASE_NAME:process.env.PRELAUNCH_CHANNEL_DATABASE_NAME});
const channel=new PersistentMockChannel(channelDb);
const prefix=`money-${randomUUID()}`;
let sequence=0;
async function fixture(){
 const restaurant=await db.restaurant.create({data:{name:'合成测试餐厅',district:'上海测试区域',businessArea:'TEST_ONLY',address:'合成地址',contactName:'TEST_ONLY',contactPhone:'synthetic-local',budgetCents:1,cuisineTags:[],capacity:4}});
 const now=await db.$transaction(domain.dbNow);
 const activity=await db.activity.create({data:{restaurantId:restaurant.id,title:'合成兴趣体验',theme:'TEST_ONLY',description:'TEST_ONLY',district:'上海测试区域',businessArea:'TEST_ONLY',startsAt:new Date(now.getTime()+72*3600_000),endsAt:new Date(now.getTime()+74*3600_000),registrationEndsAt:new Date(now.getTime()+64*3600_000),serviceFeeCents:0,mealFeePolicyText:'餐费到店自理',capacity:4,status:'PUBLISHED'}});
 const policy=await db.v11PolicySnapshot.create({data:{bundleVersion:'SIMULATION_ONLY:'+prefix, bundleDigest:prefix+sequence++,baselineHash:'synthetic-only',status:'LOCAL_DRAFT',docsJson:{scope:'TEST_ONLY',documents:syntheticConsentDocuments()},blockersJson:['OP-05']}});
 const supply=await db.v11SupplyRevision.create({data:{activityId:activity.id,restaurantId:restaurant.id,policyId:policy.id,revision:1,minSize:4,targetSize:4,maxSize:4,maxTables:1,capacity:4,serviceFeeCents:100,depositCents:200,waitlistMax:4,strategy:'FILL_TO_MAX',snapshot:{scope:'TEST_ONLY',explicitSyntheticAmounts:true},digest:prefix+sequence++,status:'SIMULATION_APPROVED'}});
 return {activity,supply,policy};
}
async function actor(f){const user=await db.user.create({data:{wechatOpenid:prefix+sequence++,phone:'synthetic-authorized'}});await db.v11Profile.create({data:{userId:user.id,gender:'MALE',adultConfirmed:true,adaptationConfirmed:true}});const consent=await db.v11BundleConsent.create({data:{userId:user.id,policyId:f.policy.id,...syntheticConsentHashes(),acceptedAt:await db.$transaction(domain.dbNow)}});return{actor:{id:prefix+sequence++,personId:prefix+sequence++,role:'USER',userId:user.id,restaurantId:null,version:0},consent};}
async function registration(f,membership){const a=await actor(f);const reg=await domain.createRegistration(db,a.actor,{activityId:f.activity.id,supplyId:f.supply.id,policyId:f.policy.id,consentId:a.consent.id,membership,businessKey:prefix+sequence++});assert.ok('eligibilityState'in reg);return{reg,actor:a.actor};}
async function pay(r){const intent=await domain.startPayment(db,r.actor,r.reg.id);const fact=await channel.pay(intent.merchantOrderNo,intent.totalCents);await domain.persistMockEvent(db,{kind:'PAYMENT',sourceId:intent.id,channelNo:fact.channelNo,amountCents:fact.amountCents});return{intent,fact};}
test.after(async()=>{await Promise.all([db.$disconnect(),channelDb.$disconnect()]);});
const {enqueue,claimJob}=await import(pathToFileURL(`${repo}/services/api/dist/jobs/queue.js`));
async function ownClaim(job){const rows=await db.$queryRaw`UPDATE "DurableJob" SET "state"='RUNNING',"leaseOwner"=${prefix},"leaseUntil"=clock_timestamp()+interval '30 seconds',"generation"="generation"+1,"attempts"="attempts"+1,"updatedAt"=clock_timestamp() WHERE id=${job.id} AND ("state" IN ('READY','RETRY') OR ("state"='RUNNING' AND "leaseUntil"<=clock_timestamp())) RETURNING *`;assert.equal(rows.length,1);return rows[0];}
async function leaseJob(kind,refId){const job=await db.$transaction(tx=>enqueue(tx,kind,`${prefix}:job:${sequence++}`,refId));return ownClaim(job);}

function atClock(dbClient,at){return new Proxy(dbClient,{get(target,key){if(key==='$transaction')return callback=>target.$transaction(tx=>callback(new Proxy(tx,{get(inner,field){if(field==='$queryRaw')return(...args)=>Array.isArray(args[0])&&args[0].join(' ').trim()==='SELECT clock_timestamp() AS at'?Promise.resolve([{at}]):inner.$queryRaw(...args);const v=Reflect.get(inner,field);return typeof v==='function'?v.bind(inner):v}})));const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}});}

const {aftersalesRoute,aftersalesHandlers}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/aftersales.js`));
async function roleActor(role,restaurantId=null){return db.v11Actor.create({data:{personId:prefix+sequence++,role,restaurantId,passwordHash:'synthetic-unused-direct-test'}});}
async function approvedBatch(f){f.supply=await db.v11SupplyRevision.update({where:{id:f.supply.id},data:{snapshot:{scope:'TEST_ONLY',approval:{scope:'TEST_ONLY',simulationBatchHour:10}}}});return f;}

test('PRE034 settled D approved overturn retains original payment and records blocked correction source and recovery obligation',async()=>{
 const f=await approvedBatch(await fixture()),r=await registration(f,'FORMAL');const paid=await pay(r);const bind=await db.v11ReceiptBinding.findFirstOrThrow({where:{registrationId:r.reg.id}});const component=await db.v11FundComponent.findFirstOrThrow({where:{receiptId:bind.receiptId,kind:'D'}});const settled=await db.v11Disposition.create({data:{componentId:component.id,businessKey:prefix+sequence++,kind:'RESTAURANT',amountCents:200,state:'COMPLETED',sourceRef:prefix+sequence++}});const request=await aftersalesRoute(db,r.actor,'specialRefund',{id:r.reg.id,body:{businessKey:prefix+sequence++,reasonCode:'OTHER_EXCEPTION'}});const ops=await roleActor('OPS');const result=await aftersalesRoute(db,ops,'decision',{id:request.request.id,body:{decision:'REFUND_D',reason:'合成已结算翻案'}});assert.equal(result.request.state,'CORRECTION_BLOCKED_POLICY');const obligation=await db.v11Request.findFirstOrThrow({where:{registrationId:r.reg.id,kind:'SETTLED_DEPOSIT_CORRECTION'}});assert.equal(obligation.state,'BLOCKED_POLICY');assert.deepEqual(obligation.blockerIds,['OP-14','RV-06']);assert.equal(obligation.payload.userRefundObligationCents,200);assert.equal(obligation.payload.correctionFundingSource,'UNRESOLVED');assert.equal(obligation.payload.recoveryResponsibility,'UNRESOLVED');assert.equal(obligation.payload.originalDepositReusable,false);assert.equal(obligation.payload.originalDispositions[0].id,settled.id);assert.deepEqual(await db.v11Disposition.findUniqueOrThrow({where:{id:settled.id}}),settled);await aftersalesRoute(db,ops,'decision',{id:request.request.id,body:{decision:'REFUND_D',reason:'同结论重试'}});assert.equal(await db.v11Request.count({where:{registrationId:r.reg.id,kind:'SETTLED_DEPOSIT_CORRECTION'}}),1);assert.equal(await db.v11RefundInstruction.count({where:{registrationId:r.reg.id}}),0);assert.equal(await channelDb.mockChannelTransaction.count({where:{kind:'REFUND',originalTradeNo:paid.fact.channelNo}}),0);
});
