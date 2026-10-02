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
test('PRE008: twenty concurrent startPayment calls across two Prisma clients preserve one merchant intent',async()=>{
 const db2=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
 try{await verifyOwnedDatabase(db2,process.env);const f=await fixture();const r=await registration(f,'FORMAL');const results=await Promise.all(Array.from({length:20},(_,i)=>domain.startPayment(i%2?db2:db,r.actor,r.reg.id)));assert.equal(new Set(results.map(x=>x.id)).size,1);assert.equal(new Set(results.map(x=>x.merchantOrderNo)).size,1);assert.equal(await db.v11PaymentIntent.count({where:{registrationId:r.reg.id}}),1);assert.equal(await db.durableJob.count({where:{kind:'V11_PAY',refId:results[0].id}}),1);}finally{await db2.$disconnect();}
});
test('PRE016: twenty concurrent formal registrations across two Prisma clients contest exactly one final seat',async()=>{
 const db2=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
 try{await verifyOwnedDatabase(db2,process.env);const f=await fixture();for(let i=0;i<3;i++)await pay(await registration(f,'FORMAL'));const applicants=await Promise.all(Array.from({length:20},()=>actor(f)));const results=await Promise.allSettled(applicants.map((a,i)=>domain.createRegistration(i%2?db2:db,a.actor,{activityId:f.activity.id,supplyId:f.supply.id,policyId:f.policy.id,consentId:a.consent.id,membership:'FORMAL',businessKey:`${prefix}:last-seat:${i}`})));const wins=results.filter(x=>x.status==='fulfilled');const losses=results.filter(x=>x.status==='rejected');assert.equal(wins.length,1);assert.equal(losses.length,19);for(const x of losses)assert.equal(x.reason.statusCode,409);assert.equal(wins[0].value.eligibilityState,'PENDING_PAYMENT');assert.equal(await db.v11Registration.count({where:{activityId:f.activity.id,category:'WAITLIST'}}),0);assert.equal(await db.v11SeatHold.count({where:{registration:{activityId:f.activity.id},state:'HELD'}}),1);assert.equal(await db.v11Membership.count({where:{active:true,registration:{activityId:f.activity.id}}}),3);}finally{await db2.$disconnect();}
});
