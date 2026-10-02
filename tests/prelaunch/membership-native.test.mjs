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
test('R4: individual core-change rejection invalidates remaining table hides address and lawful new payment restores formation',async()=>{
 const {aftersalesRoute}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/aftersales.js`));const f=await fixture();const members=[];for(let i=0;i<4;i++){const r=await registration(f,'FORMAL');members.push(r);await pay(r);}const initial=await domain.registrationDetail(db,members[1].actor,members[1].reg.id);assert.equal(initial.tableState,'FORMED');assert.ok(initial.address);const ops={id:prefix+sequence++,personId:prefix+sequence++,role:'OPS',userId:null,restaurantId:null,version:0};const change=await aftersalesRoute(db,ops,'createChange',{body:{activityId:f.activity.id,supplyId:f.supply.id,kind:'RESTAURANT',businessKey:prefix+sequence++,proposedSnapshot:{restaurantName:'合成替换餐厅'}}});await aftersalesRoute(db,members[0].actor,'respondChange',{id:change.change.id,body:{choice:'REJECT'}});const remaining=await domain.registrationDetail(db,members[1].actor,members[1].reg.id);assert.equal(remaining.tableState,'INVALIDATED');assert.ok(remaining.restaurantName);assert.equal(remaining.address,null);assert.equal((await db.v11RefundInstruction.findFirstOrThrow({where:{registrationId:members[0].reg.id}})).totalCents,300);assert.equal(await db.v11Membership.count({where:{active:true,registration:{activityId:f.activity.id}}}),3);const replacement=await registration(f,'FORMAL');await pay(replacement);const restored=await domain.registrationDetail(db,members[1].actor,members[1].reg.id);assert.equal(restored.tableState,'FORMED');assert.ok(restored.address);assert.equal(await db.v11Membership.count({where:{active:true,registration:{activityId:f.activity.id}}}),4);
});
test('R4: delayed T24 materialization reconstructs historical formation and never fails an already formed cutoff table',async()=>{
 const f=await fixture();const members=[];for(let i=0;i<4;i++){const r=await registration(f,'FORMAL');members.push(r);await pay(r);}const table=await db.v11Table.findFirstOrThrow({where:{activityId:f.activity.id}});const now=await db.$transaction(domain.dbNow);const cutoff=new Date(now.getTime()-3600_000);await db.activity.update({where:{id:f.activity.id},data:{startsAt:new Date(cutoff.getTime()+24*3600_000)}});await db.v11Membership.updateMany({where:{tableId:table.id},data:{joinedAt:new Date(cutoff.getTime()-3600_000)}});await db.$transaction(async tx=>{await domain.activityLock(tx,f.activity.id);await domain.refreshTable(tx,table.id,now)});assert.equal((await db.v11Table.findUniqueOrThrow({where:{id:table.id}})).state,'FORMED');assert.equal(await db.v11RefundInstruction.count({where:{registration:{activityId:f.activity.id}}}),0);assert.equal(await db.v11Membership.count({where:{tableId:table.id,active:true}}),4);
});
