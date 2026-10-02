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

const {reconcileMockChannel}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/reconciliation.js`));
test('PRE035: native unavailable channel bill and per-fact query reject without successful zero-discrepancy completion',async()=>{
 const ops={id:prefix+sequence++,personId:prefix+sequence++,role:'OPS',userId:null,restaurantId:null,version:0};
 for(const method of ['findMany','findUnique']){
  if(method==='findUnique'){const f=await fixture();await pay(await registration(f,'FORMAL'));}
  let attempts=0;let completed=false;
  const unavailable=new Proxy(channelDb,{get(target,key){if(key==='mockChannelTransaction')return new Proxy(target.mockChannelTransaction,{get(delegate,m){if(m===method)return async()=>{attempts++;throw Error(`synthetic-channel-${method}-unavailable`)};const v=Reflect.get(delegate,m);return typeof v==='function'?v.bind(delegate):v}});const v=Reflect.get(target,key);return typeof v==='function'?v.bind(target):v}});
  await assert.rejects(async()=>{await reconcileMockChannel(db,unavailable,ops);completed=true},new RegExp(`synthetic-channel-${method}-unavailable`));assert.ok(attempts>0);assert.equal(completed,false);
 }
});
test('BR59: native new policy and HTTP supply revision preserve old registration consent price and policy snapshots',async()=>{
 const f=await fixture();const r=await registration(f,'FORMAL');const paid=await pay(r);
 const oldReg=await db.v11Registration.findUniqueOrThrow({where:{id:r.reg.id}});
 const oldConsent=await db.v11BundleConsent.findUniqueOrThrow({where:{id:oldReg.consentId}});
 const oldSupply=await db.v11SupplyRevision.findUniqueOrThrow({where:{id:f.supply.id}});
 const oldPolicy=await db.v11PolicySnapshot.findUniqueOrThrow({where:{id:f.policy.id}});
 const oldIntent=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:paid.intent.id}});
 const {buildPrelaunchApp}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/routes.js`));const {scryptSync,randomBytes}=await import('node:crypto');const password=`synthetic-${randomUUID()}`;const salt=randomBytes(16);const passwordHash=`scrypt:${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`;
 const ops=await db.v11Actor.create({data:{personId:prefix+sequence++,role:'OPS',passwordHash}});const app=await buildPrelaunchApp(db,process.env,repo,channelDb);
 try{
  const login=await app.inject({method:'POST',url:'/api/prelaunch/v11/auth/login',headers:{'x-fanju-contract':'prelaunch-v11-1'},payload:{actorId:ops.id,password}});assert.equal(login.statusCode,200);
  const revision=await app.inject({method:'POST',url:`/api/prelaunch/v11/ops/supplies/${f.supply.id}/revision`,headers:{'x-fanju-contract':'prelaunch-v11-1',authorization:`Bearer ${login.json().token}`},payload:{min:4,target:4,max:4,maxTables:1,capacity:4,F:101,D:201,WAITLIST_MAX:4,strategy:'FILL_TO_MAX',estimatedMealMinCents:1000,estimatedMealMaxCents:2000,fixedFees:[]}});assert.equal(revision.statusCode,200);assert.equal(revision.json().existingOrdersChanged,false);assert.notEqual(revision.json().supply.id,oldSupply.id);assert.equal(revision.json().supply.serviceFeeCents,101);
  const newer=await db.v11PolicySnapshot.create({data:{bundleVersion:'SIMULATION_ONLY:new:'+prefix,bundleDigest:prefix+sequence++,baselineHash:'synthetic-only-new',status:'LOCAL_DRAFT',docsJson:{scope:'TEST_ONLY',revision:2},blockersJson:['OP-05']}});assert.notEqual(newer.id,oldPolicy.id);
  assert.deepEqual(await db.v11Registration.findUniqueOrThrow({where:{id:r.reg.id}}),oldReg);
  assert.deepEqual(await db.v11BundleConsent.findUniqueOrThrow({where:{id:oldReg.consentId}}),oldConsent);
  assert.deepEqual(await db.v11SupplyRevision.findUniqueOrThrow({where:{id:oldSupply.id}}),oldSupply);
  assert.deepEqual(await db.v11PolicySnapshot.findUniqueOrThrow({where:{id:oldPolicy.id}}),oldPolicy);
  assert.deepEqual(await db.v11PaymentIntent.findUniqueOrThrow({where:{id:paid.intent.id}}),oldIntent);
 }finally{await app.close();}
});
