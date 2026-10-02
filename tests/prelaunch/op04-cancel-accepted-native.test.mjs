import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {root} from '../../scripts/prelaunch-owned-env.mjs';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
const {acceptOwnRefundRequest}=await import(pathToFileURL((process.env.PRELAUNCH_SOURCE_ROOT??root)+'/services/api/dist/prelaunch/refund-request-intake.js'));
const {formalRefundService}=await import(pathToFileURL((process.env.PRELAUNCH_SOURCE_ROOT??root)+'/services/api/dist/prelaunch/formal-refund-service.js'));
const url=u=>'/api/v11/formal/registrations/'+u.registration.id+'/refund-requests';
const cancel=(x,u,key)=>x.request('POST',url(u),u.headers,{businessKey:x.prefix+'_'+key,requestCategory:'ORDINARY_CANCEL'});
test('CA01-04: immediate exit preserves formed rights, later invalidated rights, and original event',async()=>{
 const x=await formalBusinessTestFixture();try{
  const users=[];for(let i=0;i<4;i++){const u=await x.user();await x.succeed(u);users.push(u);}
  const table=await x.db.v11Table.findFirstOrThrow({where:{activityId:x.activity.id}});assert.equal(table.state,'FORMED');
  const a=await cancel(x,users[0],'first');assert.equal(a.cancellationAccepted,true);assert.equal(a.refundApproved,false);
  assert.equal(await x.db.v11Membership.count({where:{tableId:table.id,active:true}}),3);assert.equal((await x.db.v11Table.findUniqueOrThrow({where:{id:table.id}})).state,'INVALIDATED');
  const rights=await x.db.auditLog.findFirstOrThrow({where:{action:'refund.v11-formal-acceptance-rights',targetId:a.requestId}});assert.equal(rights.metadata.tableState,'FORMED');assert.equal(rights.metadata.F,100);assert.equal(rights.metadata.D,200);
  const retry=await cancel(x,users[0],'different_retry');assert.equal(retry.requestId,a.requestId);assert.equal(retry.acceptedAt,a.acceptedAt);
  const b=await cancel(x,users[1],'second');const nextRights=await x.db.auditLog.findFirstOrThrow({where:{action:'refund.v11-formal-acceptance-rights',targetId:b.requestId}});assert.equal(nextRights.metadata.tableState,'INVALIDATED');
  for(const [r,F,D] of [[a,0,0],[b,100,200]]){const decision=await x.request('POST','/api/v11/ops/formal/refund-requests/'+r.requestId+'/decide',x.opsHeaders,{});assert.equal(decision.entitlement.refundF,F);assert.equal(decision.entitlement.refundD,D);}
 }finally{await x.close();}
});
test('CA06-07-09: fund authority/channel unavailable still exits; consultation and ownership stay separate',async()=>{
 const x=await formalBusinessTestFixture();try{
  const u=await x.user();await x.succeed(u);const other=await x.user();
  for(const category of ['CONSULTATION','EVIDENCE','DISPUTE','APPEAL']){const r=await x.request('POST',url(u),u.headers,{businessKey:x.prefix+'_'+category,requestCategory:category});assert.equal(r.cancellationAccepted,false);assert.equal((await x.db.financialCase.findFirstOrThrow({where:{category:'V11_FORMAL_INQUIRY_REVIEW',sourceRef:r.requestId}})).owner,x.ops.id);assert.equal((await x.db.auditLog.findFirstOrThrow({where:{action:'refund.v11-review-owner-assigned',targetId:r.requestId}})).metadata.contractualSlaConfirmed,false);assert.equal((await x.db.v11Membership.findUniqueOrThrow({where:{registrationId:u.registration.id}})).active,true);}
  for(const [headers,body] of [[undefined,{businessKey:x.prefix+'_anonymous'}],[other.headers,{businessKey:x.prefix+'_other'}],[u.headers,{businessKey:x.prefix+'_invalid',requestCategory:'WRONG'}]]){const r=await x.app.inject({method:'POST',url:url(u),headers,payload:body});assert.ok(r.statusCode>=400);}
  const actor=await x.db.v11Actor.findFirstOrThrow({where:{userId:u.user.id}}),service=formalRefundService(x.db,async()=>{throw Error('fund authority unavailable');},{...x.channel,assertBinding(){throw Error('channel unavailable');}},x.ops.id);
  const r=await service.accept(actor,u.registration.id,x.prefix+'_no_funds');assert.equal(r.cancellationAccepted,true);assert.equal((await x.db.v11Membership.findUniqueOrThrow({where:{registrationId:u.registration.id}})).active,false);assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:u.registration.id}}),0);
  await assert.rejects(service.decide(x.ops,r.requestId));
 }finally{await x.close();}
});
test('CA05: interrupted member mutation rolls back acceptance, snapshot and exit atomically',async()=>{
 const x=await formalBusinessTestFixture();try{
  const u=await x.user();await x.succeed(u);const actor=await x.db.v11Actor.findFirstOrThrow({where:{userId:u.user.id}});
  const db={ $transaction:fn=>x.db.$transaction(tx=>fn(new Proxy(tx,{get(target,key){if(key==='v11Membership')return new Proxy(target[key],{get(delegate,method){if(method==='update')return async()=>{throw Error('injected exit failure');};return delegate[method];}});return target[key];}}))) };
  await assert.rejects(formalRefundService(db,async()=>x.f.authority(),x.channel,x.ops.id).accept(actor,u.registration.id,x.prefix+'_rollback'),/injected exit failure/);
  assert.equal(await x.db.v11Request.count({where:{registrationId:u.registration.id,kind:'FORMAL_REFUND_APPLICATION'}}),0);assert.equal((await x.db.v11Membership.findUniqueOrThrow({where:{registrationId:u.registration.id}})).active,true);assert.equal((await x.db.v11Registration.findUniqueOrThrow({where:{id:u.registration.id}})).active,true);
 }finally{await x.close();}
});
test('CA08-10: late exit and concurrent repeated/another cancellations retain one event each and no oversale',async()=>{
 const x=await formalBusinessTestFixture();try{
  const a=await x.user(),b=await x.user();await x.succeed(a);await x.succeed(b);await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(Date.now()+7*3600000)}});
  const [first,retry,second]=await Promise.all([cancel(x,a,'race_a'),cancel(x,a,'race_retry'),cancel(x,b,'race_b')]);assert.equal(first.requestId,retry.requestId);assert.notEqual(first.requestId,second.requestId);
  assert.equal(await x.db.v11Membership.count({where:{table:{activityId:x.activity.id},active:true}}),0);assert.equal(await x.db.v11Request.count({where:{registrationId:a.registration.id,kind:'FORMAL_REFUND_APPLICATION'}}),1);
  await assert.rejects(x.user(),/FORMAL_REGISTRATION_WINDOW_CLOSED|REGISTRATION_CLOSED|400|409/);
 }finally{await x.close();}
});

test('legacy blocked intake retries preserve time and distinguish recoverable rights from missing rights',async()=>{
 const x=await formalBusinessTestFixture();try{
  for(const sufficient of [false,true]){
   const u=await x.user();await x.succeed(u);const actor=await x.db.v11Actor.findFirstOrThrow({where:{userId:u.user.id}}),key=x.prefix+'_legacy_'+sufficient;
   const prior=await acceptOwnRefundRequest(x.db,actor,u.registration.id,key,true);
   if(sufficient){const reg=await x.db.v11Registration.findUniqueOrThrow({where:{id:u.registration.id},include:{activity:true,policy:true}});await x.db.auditLog.create({data:{action:'refund.v11-formal-acceptance-rights',targetType:'V11Request',targetId:prior.requestId,metadata:{registrationId:reg.id,acceptedAt:prior.acceptedAt.toISOString(),policyDigest:reg.policy.bundleDigest,category:reg.category,tableState:'WAITING',startsAt:reg.activity.startsAt.toISOString(),F:reg.serviceFeeCents,D:reg.depositCents}}});}
   const replay=await cancel(x,u,'legacy_'+sufficient);assert.equal(replay.acceptedAt,new Date(prior.acceptedAt).toISOString());assert.equal(replay.cancellationAccepted,sufficient);assert.equal(replay.pendingReview,!sufficient);assert.equal((await x.db.v11Membership.findUniqueOrThrow({where:{registrationId:u.registration.id}})).active,!sufficient);
  }
 }finally{await x.close();}
});
test('CA10: cancellation, waitlist promotion job and T24 boundary compete under the activity lock',async()=>{
 const x=await formalBusinessTestFixture({fifoClock:'REGISTRATION_ACCEPTED',waitlistConcurrency:'SERIAL_TRANSACTION_RESERVED_EXPOSURE'});try{
  const users=[];for(let i=0;i<4;i++){const u=await x.user();await x.succeed(u);users.push(u);}const waiting=await x.user('WAITLIST');await x.succeed(waiting);
  const {formalLifecycleHandler,scheduleFormalLifecycleBatch}=await import(pathToFileURL((process.env.PRELAUNCH_SOURCE_ROOT??root)+'/services/api/dist/prelaunch/formal-lifecycle.js'));
  const {runOne}=await import(pathToFileURL((process.env.PRELAUNCH_SOURCE_ROOT??root)+'/services/api/dist/jobs/queue.js'));
  // A durable promotion exists at the cutoff as a recovered worker would see it.
  const boundary=(await x.db.$queryRaw`SELECT clock_timestamp() AS at`)[0].at,start=new Date(boundary.getTime()+24*3600000);
  await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:start}});
  const {enqueue}=await import(pathToFileURL((process.env.PRELAUNCH_SOURCE_ROOT??root)+'/services/api/dist/jobs/queue.js'));await x.db.$transaction(tx=>enqueue(tx,'V11_FORMAL_LIFECYCLE','v11:formal-race:'+x.prefix,users[0].registration.id,new Date(boundary.getTime()-1)));
  await scheduleFormalLifecycleBatch(x.db,x.f.context);
  const handlers={V11_FORMAL_LIFECYCLE:formalLifecycleHandler(x.db,async()=>x.f.authority(),x.f.context)};
  const [accepted]=await Promise.all([cancel(x,users[0],'cutoff_race'),runOne(x.db,x.prefix+'_race_worker',x.ops.id,handlers,['V11_FORMAL_LIFECYCLE'],x.f.context),runOne(x.db,x.prefix+'_cutoff_worker',x.ops.id,handlers,['V11_FORMAL_LIFECYCLE'],x.f.context)]);
  assert.equal((await x.db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:formal-race:'+x.prefix}})).state,'DONE');
  assert.equal(accepted.cancellationAccepted,true);assert.ok(await x.db.v11Membership.count({where:{table:{activityId:x.activity.id},active:true}})<=4);
  assert.notEqual((await x.db.v11Registration.findUniqueOrThrow({where:{id:waiting.registration.id}})).eligibilityState,'FORMAL');
  const rights=await x.db.auditLog.findFirstOrThrow({where:{action:'refund.v11-formal-acceptance-rights',targetId:accepted.requestId}});assert.equal(rights.metadata.acceptedAt,accepted.acceptedAt);
 }finally{await x.close();}
});

test('post-start, fulfillment and unresolved-category applications remain pending verification without exit',async()=>{
 const x=await formalBusinessTestFixture();try{
  for(const branch of ['POST_START','FULFILLED','UNRESOLVED']){
   const u=await x.user();await x.succeed(u);
   if(branch==='FULFILLED')await x.db.v11Attendance.create({data:{registrationId:u.registration.id,restaurantResult:'NORMAL',confirmedAt:new Date()}});
   if(branch==='UNRESOLVED')await x.db.v11Registration.update({where:{id:u.registration.id},data:{category:'UNRESOLVED'}});
   if(branch==='POST_START')await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(Date.now()-1000)}});
   const response=await cancel(x,u,'pending_'+branch);assert.equal(response.cancellationAccepted,false);assert.equal(response.pendingReview,true);assert.equal((await x.db.financialCase.findFirstOrThrow({where:{category:'V11_FORMAL_INQUIRY_REVIEW',sourceRef:response.requestId}})).owner,x.ops.id);assert.equal((await x.db.v11Membership.findUniqueOrThrow({where:{registrationId:u.registration.id}})).active,true);
   if(branch==='POST_START')await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(Date.now()+72*3600000)}});
  }
 }finally{await x.close();}
});
