import {syntheticConsentDocuments,syntheticConsentHashes} from './fixtures/synthetic-consent.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, scryptSync } from 'node:crypto';
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

const {buildPrelaunchApp}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/routes.js`));const app=await buildPrelaunchApp(db,process.env,repo,channelDb);test.after(()=>app.close());
async function auth(a){const password=randomBytes(24).toString('hex'),salt=randomBytes(16);const row=await db.v11Actor.create({data:{personId:prefix+sequence++,role:a.role,userId:a.userId??null,passwordHash:`scrypt:${salt.toString('hex')}:${scryptSync(password,salt,64).toString('hex')}`}});const response=await app.inject({method:'POST',url:'/api/prelaunch/v11/auth/login',headers:{'x-fanju-contract':'prelaunch-v11-1'},payload:{actorId:row.id,password}});assert.equal(response.statusCode,200);return{'x-fanju-contract':'prelaunch-v11-1',authorization:'Bearer '+response.json().token};}
async function enter(f,a){return domain.createRegistration(db,a.actor,{activityId:f.activity.id,supplyId:f.supply.id,policyId:f.policy.id,consentId:a.consent.id,membership:'FORMAL',businessKey:prefix+sequence++});}
test('BR02 BR03 BR08 admission requires phone valid gender and adaptation before registration or charging while browsing stays available',async()=>{
 const browse=await app.inject({method:'GET',url:'/api/prelaunch/v11/activities'});assert.equal(browse.statusCode,200);
 for(const kind of ['NO_PHONE','NO_GENDER','INVALID_GENDER','ADAPTATION']){const f=await fixture(),a=await actor(f);if(kind==='NO_PHONE')await db.user.update({where:{id:a.actor.userId},data:{phone:null}});else if(kind==='NO_GENDER')await db.v11Profile.delete({where:{userId:a.actor.userId}});else await db.v11Profile.update({where:{userId:a.actor.userId},data:kind==='INVALID_GENDER'?{gender:'UNKNOWN'}:{adaptationConfirmed:false}});await assert.rejects(enter(f,a),e=>e.statusCode===409||e.status===409);assert.equal(await db.v11Registration.count({where:{activityId:f.activity.id}}),0);assert.equal(await db.v11PaymentIntent.count({where:{registration:{activityId:f.activity.id}}}),0);}
});
test('BR04 BR05 RB07 empty and mismatched optional time preferences do not block native registration or full payment and legacy fields survive',async()=>{
 for(const preferences of [[],['UNMATCHED_TEST_TIME']]){const f=await fixture(),a=await actor(f);await db.v11Profile.update({where:{userId:a.actor.userId},data:{availableTimes:preferences}});const before=await db.user.findUniqueOrThrow({where:{id:a.actor.userId}});const reg=await enter(f,a);await pay({reg,actor:a.actor});assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:reg.id}})).eligibilityState,'FORMAL');const after=await db.user.findUniqueOrThrow({where:{id:a.actor.userId}});assert.deepEqual(after,before);assert.deepEqual((await db.v11Profile.findUniqueOrThrow({where:{userId:a.actor.userId}})).availableTimes,preferences);}
});
test('RB09 full and public consent hash mismatches refuse HTTP acceptance with no registration or payment',async()=>{
 const f=await fixture(),a=await actor(f),headers=await auth(a.actor);const docs=syntheticConsentDocuments();await db.v11PolicySnapshot.update({where:{id:f.policy.id},data:{docsJson:{scope:'TEST_ONLY',documents:docs}}});for(const field of ['documentHashes','publicHashes']){const payload={policyId:f.policy.id,confirm:true,documentHashes:Object.fromEntries(docs.map(d=>[d.documentId,d.fullHash])),publicHashes:Object.fromEntries(docs.map(d=>[d.documentId,d.publicHash]))};payload[field][docs[1].documentId]='CORRUPTED_SYNTHETIC';const before=await db.v11BundleConsent.count({where:{userId:a.actor.userId}});const response=await app.inject({method:'POST',url:'/api/prelaunch/v11/consents',headers,payload});assert.equal(response.statusCode,409);assert.equal(response.json().error.code,'POLICY_HASH_MISMATCH');assert.equal(await db.v11BundleConsent.count({where:{userId:a.actor.userId}}),before);}assert.equal(await db.v11Registration.count({where:{activityId:f.activity.id}}),0);assert.equal(await db.v11PaymentIntent.count({where:{registration:{activityId:f.activity.id}}}),0);
});
test('DR08 absent approved D_MIN or D_MAX refuses HTTP approval without new revision or payment',async()=>{
 const f=await fixture(),headers=await auth({role:'OPS'});await db.v11SupplyRevision.update({where:{id:f.supply.id},data:{status:'SIMULATION_SIGNED',personId:prefix+sequence++}});for(const payload of [{D_MIN:100,simulationBatchHour:10},{D_MAX:300,simulationBatchHour:10}]){const response=await app.inject({method:'POST',url:`/api/prelaunch/v11/ops/supplies/${f.supply.id}/approve`,headers,payload});assert.equal(response.statusCode,400);assert.equal(response.json().error.code,'INVALID_INPUT');assert.equal((await db.v11SupplyRevision.findUniqueOrThrow({where:{id:f.supply.id}})).status,'SIMULATION_SIGNED');}assert.equal(await db.v11SupplyRevision.count({where:{activityId:f.activity.id}}),1);assert.equal(await db.v11PaymentIntent.count({where:{registration:{activityId:f.activity.id}}}),0);
});
test('consent captures only intact exact documents and admission rechecks source and hashes',async()=>{
 const f=await fixture(),a=await actor(f),headers=await auth(a.actor),docs=syntheticConsentDocuments();
 const payload={policyId:f.policy.id,confirm:true,documentHashes:Object.fromEntries(docs.map(d=>[d.documentId,d.fullHash])),publicHashes:Object.fromEntries(docs.map(d=>[d.documentId,d.publicHash]))};
 const accepted=await app.inject({method:'POST',url:'/api/prelaunch/v11/consents',headers,payload});assert.equal(accepted.statusCode,200);
 const agreed=await db.v11BundleConsent.findUniqueOrThrow({where:{id:accepted.json().consentId}});assert.equal(agreed.source,'SIMULATION_ONLY');
 const before=await db.v11BundleConsent.count({where:{userId:a.actor.userId}});
 for(const field of ['documentHashes','publicHashes']){
  const bad={...payload,[field]:{...payload[field],extra:'a'.repeat(64)}};
  assert.equal((await app.inject({method:'POST',url:'/api/prelaunch/v11/consents',headers,payload:bad})).statusCode,409);
 }
 const altered=docs.map((d,i)=>i===0?{...d,fullText:d.fullText+'tampered'}:d);
 await db.v11PolicySnapshot.update({where:{id:f.policy.id},data:{docsJson:{scope:'TEST_ONLY',documents:altered}}});
 assert.equal((await app.inject({method:'POST',url:'/api/prelaunch/v11/consents',headers,payload})).statusCode,409);
 assert.equal(await db.v11BundleConsent.count({where:{userId:a.actor.userId}}),before);
 await assert.rejects(enter(f,a),e=>e.code==='CONSENT_EVIDENCE_INVALID');
 await db.v11PolicySnapshot.update({where:{id:f.policy.id},data:{docsJson:{scope:'TEST_ONLY',documents:docs}}});
 await db.v11BundleConsent.update({where:{id:a.consent.id},data:{source:'FORGED_FORMAL'}});
 await assert.rejects(enter(f,a),e=>e.code==='CONSENT_EVIDENCE_INVALID');
 await db.v11BundleConsent.update({where:{id:a.consent.id},data:{source:'SIMULATION_ONLY',publicHashesJson:{}}});
 await assert.rejects(enter(f,a),e=>e.code==='CONSENT_EVIDENCE_INVALID');
 assert.equal(await db.v11Registration.count({where:{activityId:f.activity.id}}),0);assert.equal(await db.v11PaymentIntent.count({where:{registration:{activityId:f.activity.id}}}),0);
});
test('RB06 cross activity QR rejects and never records attendance for paid formal user',async()=>{
 const f=await fixture(),other=await fixture(),r=await registration(f,'FORMAL');await pay(r);const code=await aftersalesRoute(db,await roleActor('RESTAURANT',other.activity.restaurantId),'checkinCode',{id:other.activity.id});await assert.rejects(aftersalesRoute(db,r.actor,'checkin',{body:{registrationId:r.reg.id,qrToken:code.qrToken}}),e=>e.code==='CHECKIN_CODE_EXPIRED_OR_SCOPE_MISMATCH');assert.equal(await db.v11Attendance.count({where:{registrationId:r.reg.id}}),0);
});
