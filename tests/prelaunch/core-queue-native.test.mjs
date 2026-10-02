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
test('R4: lawful core-change rejection promotes paid queue head before any new formal admission without aggregate-cancel refill',async()=>{
 const {aftersalesRoute}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/aftersales.js`));const f=await fixture();const members=[];for(let i=0;i<4;i++){const r=await registration(f,'FORMAL');members.push(r);await pay(r);}const first=await registration(f,'WAITLIST');await pay(first);const second=await registration(f,'WAITLIST');await pay(second);const before=await db.v11Membership.findMany({where:{active:true,registration:{activityId:f.activity.id}}});const ops={id:prefix+sequence++,personId:prefix+sequence++,role:'OPS',userId:null,restaurantId:null,version:0};const change=await aftersalesRoute(db,ops,'createChange',{body:{activityId:f.activity.id,supplyId:f.supply.id,kind:'RESTAURANT',businessKey:prefix+sequence++,proposedSnapshot:{restaurantName:'合成替换餐厅'}}});await aftersalesRoute(db,members[0].actor,'respondChange',{id:change.change.id,body:{choice:'REJECT'}});assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:first.reg.id}})).eligibilityState,'FORMAL');assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:second.reg.id}})).eligibilityState,'WAITLIST');assert.equal(await db.v11Membership.count({where:{active:true,registration:{activityId:f.activity.id}}}),4);assert.equal(await db.v11Membership.count({where:{registrationId:first.reg.id}}),1);assert.ok(await db.v11DeliveryProof.findFirst({where:{registrationId:first.reg.id,kind:'WAITLIST_PROMOTED'}}));for(const member of before.filter(x=>x.registrationId!==members[0].reg.id)){const current=await db.v11Membership.findUniqueOrThrow({where:{id:member.id}});assert.equal(current.active,true);assert.equal(current.tableId,member.tableId);}await assert.rejects(registration(f,'FORMAL'),e=>e.code==='WAITLIST_HAS_PRIORITY');const detail=await domain.registrationDetail(db,members[1].actor,members[1].reg.id);assert.equal(detail.tableState,'FORMED');assert.ok(detail.address);
 const f2=await fixture();const originals=[];for(let i=0;i<4;i++){const r=await registration(f2,'FORMAL');originals.push(r);await pay(r);}const queued=await registration(f2,'WAITLIST');await pay(queued);await db.$transaction(async tx=>{await domain.activityLock(tx,f2.activity.id);const at=await domain.dbNow(tx);for(const r of originals)await domain.terminateAndRefund(tx,await domain.registrationLock(tx,r.reg.id),prefix+sequence++,'PLATFORM_CANCEL',at)});assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:queued.reg.id}})).eligibilityState,'WAITLIST');assert.equal(await db.v11Membership.count({where:{active:true,registration:{activityId:f2.activity.id}}}),0);
});
