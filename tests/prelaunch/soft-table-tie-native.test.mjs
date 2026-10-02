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
async function genderReg(f,gender,membership='FORMAL'){const who=await actor(f);await db.v11Profile.update({where:{userId:who.actor.userId},data:{gender}});return{reg:await domain.createRegistration(db,who.actor,{activityId:f.activity.id,supplyId:f.supply.id,policyId:f.policy.id,consentId:who.consent.id,membership,businessKey:prefix+sequence++}),actor:who.actor};}
async function twoTables(){const f=await fixture();await db.restaurant.update({where:{id:f.activity.restaurantId},data:{capacity:12}});f.supply=await db.v11SupplyRevision.update({where:{id:f.supply.id},data:{targetSize:4,maxSize:6,maxTables:2,capacity:12,strategy:'FILL_TO_TARGET'}});for(const gender of ['MALE','FEMALE'])for(let i=0;i<4;i++)await pay(await genderReg(f,gender));return f;}
test('USR08 native internal soft preference breaks only equal-fill legal table ties without splitting committed members or public ratio promises',async()=>{
 const f=await twoTables();const before=await db.v11Membership.findMany({where:{registration:{activityId:f.activity.id}}});const tables=await db.v11Table.findMany({where:{activityId:f.activity.id},orderBy:{ordinal:'asc'}});const incoming=await genderReg(f,'MALE');await pay(incoming);assert.equal((await db.v11Membership.findUniqueOrThrow({where:{registrationId:incoming.reg.id}})).tableId,tables[1].id);assert.equal(await db.v11Membership.count({where:{tableId:tables[0].id,active:true}}),4);assert.equal(await db.v11Membership.count({where:{tableId:tables[1].id,active:true}}),5);for(const m of before){const current=await db.v11Membership.findUniqueOrThrow({where:{id:m.id}});assert.equal(current.tableId,m.tableId);assert.equal(current.active,true);}const detail=await domain.registrationDetail(db,incoming.actor,incoming.reg.id);assert.ok(!JSON.stringify(detail).includes('genderRatio'));assert.ok(!JSON.stringify(detail).includes('internal-soft'));assert.ok(await db.auditLog.findFirst({where:{action:'prelaunch.table.internal-soft-tiebreak',targetId:tables[1].id}}));
});
test('USR08 native paid FIFO head retains priority over a better-balanced later person and maximum capacity stays hard',async()=>{
 const f=await twoTables();const held=[];for(let i=0;i<4;i++)held.push(await genderReg(f,'MALE'));const first=await genderReg(f,'MALE','WAITLIST');await pay(first);const second=await genderReg(f,'FEMALE','WAITLIST');await pay(second);await domain.acceptCancellation(db,held[0].actor,held[0].reg.id,prefix+sequence++);assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:first.reg.id}})).eligibilityState,'FORMAL');assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:second.reg.id}})).eligibilityState,'WAITLIST');assert.equal(await db.v11Membership.count({where:{registration:{activityId:f.activity.id},active:true}}),9);const tables=await db.v11Table.findMany({where:{activityId:f.activity.id}});for(const table of tables)assert.ok(await db.v11Membership.count({where:{tableId:table.id,active:true}})<=6);
});
test('USR08 native unknown historical gender falls back to ordinal and different fill priority is never overridden',async()=>{
 const f=await twoTables();const tables=await db.v11Table.findMany({where:{activityId:f.activity.id},orderBy:{ordinal:'asc'}});const first=await db.v11Membership.findFirstOrThrow({where:{tableId:tables[0].id,active:true}});await db.v11Registration.update({where:{id:first.registrationId},data:{snapshot:{scope:'SYNTHETIC_HISTORICAL_UNKNOWN'}}});const incoming=await genderReg(f,'MALE');await pay(incoming);assert.equal((await db.v11Membership.findUniqueOrThrow({where:{registrationId:incoming.reg.id}})).tableId,tables[0].id);
 const f2=await twoTables();const t2=await db.v11Table.findMany({where:{activityId:f2.activity.id},orderBy:{ordinal:'asc'}});const one=await genderReg(f2,'MALE');await pay(one);assert.equal((await db.v11Membership.findUniqueOrThrow({where:{registrationId:one.reg.id}})).tableId,t2[1].id);const next=await genderReg(f2,'MALE');await pay(next);assert.equal((await db.v11Membership.findUniqueOrThrow({where:{registrationId:next.reg.id}})).tableId,t2[0].id,'Different fill counts preserve the original standard strategy priority');
});
