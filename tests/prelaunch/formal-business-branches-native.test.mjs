import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {root} from '../../scripts/prelaunch-owned-env.mjs';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT??root;
const load=name=>import(pathToFileURL(repo+'/services/api/dist/'+name));
const {runOne}=await load('jobs/queue.js'),{formalLifecycleHandler,scheduleFormalLifecycleBatch}=await load('prelaunch/formal-lifecycle.js'),{formalRefundService}=await load('prelaunch/formal-refund-service.js'),{followupFormalRefundBatch}=await load('prelaunch/formal-refund-followup.js');
for(const clock of ['REGISTRATION_ACCEPTED','TRUSTED_PAYMENT_CONFIRMED'])test('formal waitlist ordering and durable exit promotion: '+clock,async()=>{
 const x=await formalBusinessTestFixture({fifoClock:clock,waitlistConcurrency:'SERIAL_TRANSACTION_RESERVED_EXPOSURE'});try{
  const a=await x.user(),b=await x.user();await x.succeed(a);await x.succeed(b);const c=await x.user(),d=await x.user();await x.succeed(c);await x.succeed(d);const first=await x.user('WAITLIST'),second=await x.user('WAITLIST');await x.succeed(second);await x.succeed(first);
  const f=await x.db.v11Registration.findUniqueOrThrow({where:{id:first.registration.id}}),s=await x.db.v11Registration.findUniqueOrThrow({where:{id:second.registration.id}});assert.ok(f.queueOrdinal<s.queueOrdinal);assert.ok(f.paidEffectiveAt>s.paidEffectiveAt);
  const intake=await x.request('POST','/api/v11/formal/registrations/'+a.registration.id+'/refund-requests',a.headers,{businessKey:x.prefix+'_cancel'});await x.request('POST','/api/v11/ops/formal/refund-requests/'+intake.requestId+'/decide',x.opsHeaders,{});
  const handlers={V11_FORMAL_LIFECYCLE:formalLifecycleHandler(x.db,async()=>x.f.authority(),x.f.context)};assert.equal(await runOne(x.db,x.prefix+'_lifecycle',x.ops.id,handlers,['V11_FORMAL_LIFECYCLE'],x.f.context),true);
  const winner=clock==='REGISTRATION_ACCEPTED'?first:second,loser=clock==='REGISTRATION_ACCEPTED'?second:first;
  assert.equal((await x.db.v11Registration.findUniqueOrThrow({where:{id:winner.registration.id}})).eligibilityState,'FORMAL');assert.equal((await x.db.v11Registration.findUniqueOrThrow({where:{id:loser.registration.id}})).eligibilityState,'WAITLIST');assert.equal(await x.db.v11Membership.count({where:{table:{activityId:x.activity.id},active:true}}),4);
  const before=await x.db.durableJob.count({where:{kind:'V11_FORMAL_LIFECYCLE',businessKey:{startsWith:'v11:formal-boundary:'}}});await scheduleFormalLifecycleBatch(x.db,x.f.context);await scheduleFormalLifecycleBatch(x.db,x.f.context);const after=await x.db.durableJob.count({where:{kind:'V11_FORMAL_LIFECYCLE',businessKey:{startsWith:'v11:formal-boundary:'}}});assert.equal(after-before,12);
 }finally{await x.close();}
});
test('extra original-channel receipt refunds only the extra money and preserves valid membership',async()=>{
 const x=await formalBusinessTestFixture({memberRemovalEvent:null,automaticObligationDecision:true});try{
  const u=await x.user();await x.succeed(u);const extra=await x.succeed(u,'extra');assert.equal(extra.qualification.state,'REFUND_DUE');const request=await x.db.v11Request.findFirstOrThrow({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}});
  const refunds=formalRefundService(x.db,async()=>x.f.authority(),x.channel,x.ops.id);await followupFormalRefundBatch(x.db,async()=>x.f.authority(),x.f.context,refunds,x.ops.id);
  const decided=await x.db.v11Decision.findFirstOrThrow({where:{requestId:request.id}});assert.equal(decided.payload.instructionIds.length,1);const instruction=await x.db.v11RefundInstruction.findUniqueOrThrow({where:{id:decided.payload.instructionIds[0]}});assert.equal(instruction.receiptId,extra.receiptId);assert.equal(instruction.totalCents,300);
  assert.equal((await x.db.v11Registration.findUniqueOrThrow({where:{id:u.registration.id}})).eligibilityState,'FORMAL');assert.equal((await x.db.v11Membership.findUniqueOrThrow({where:{registrationId:u.registration.id}})).active,true);
  const binding=await x.db.v11ReceiptBinding.findFirstOrThrow({where:{registrationId:u.registration.id,classification:'PRIMARY'}});assert.equal(await x.db.v11RefundInstruction.count({where:{receiptId:binding.receiptId}}),0);
 }finally{await x.close();}
});
test('policy-review replay preserves the original pending rights instead of forced full refund',async()=>{
 const x=await formalBusinessTestFixture();try{
  const u=await x.user();await x.db.v11Registration.update({where:{id:u.registration.id},data:{eligibilityState:'PAYMENT_REVIEW',active:false}});const query=await x.succeed(u);assert.equal(query.qualification.state,'BLOCKED_POLICY');assert.equal(await x.db.v11Request.count({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}}),0);assert.equal(await x.db.channelReceipt.count({where:{merchantScope:x.f.context.merchantScope}}),1);
 }finally{await x.close();}
});
for(const automaticObligationDecision of [null,false])test('mandatory refund retains obligation when auto-decision is '+automaticObligationDecision,async()=>{
 const x=await formalBusinessTestFixture({automaticObligationDecision});try{
  const u=await x.user();await x.succeed(u);await x.succeed(u,'extra');
  const request=await x.db.v11Request.findFirstOrThrow({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}});
  await followupFormalRefundBatch(x.db,async()=>x.f.authority(),x.f.context,formalRefundService(x.db,async()=>x.f.authority(),x.channel,x.ops.id),x.ops.id);
  const retained=await x.db.v11Request.findUniqueOrThrow({where:{id:request.id}});
  assert.equal(retained.state,automaticObligationDecision===null?'BLOCKED_PARAMETERS':'AWAITING_MANUAL_DECISION');assert.equal(retained.acceptedAt.toISOString(),request.acceptedAt.toISOString());
  assert.equal(await x.db.v11Decision.count({where:{requestId:request.id}}),0);assert.equal(await x.db.channelReceipt.count({where:{merchantScope:x.f.context.merchantScope}}),2);
 }finally{await x.close();}
});
test('revoked historical authority preserves receipts and keeps followup sweep alive',async()=>{
 const x=await formalBusinessTestFixture({automaticObligationDecision:true});try{
  const u=await x.user();await x.succeed(u);await x.succeed(u,'extra');
  const request=await x.db.v11Request.findFirstOrThrow({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}}),unavailable=async()=>{throw Error('Synthetic revoked authority');};
  const result=await followupFormalRefundBatch(x.db,unavailable,x.f.context,formalRefundService(x.db,unavailable,x.channel,x.ops.id),x.ops.id);
  assert.equal(result.blocked,1);assert.equal((await x.db.v11Request.findUniqueOrThrow({where:{id:request.id}})).state,'AWAITING_ACTION_AUTHORITY');assert.equal(await x.db.channelReceipt.count({where:{merchantScope:x.f.context.merchantScope}}),2);
 }finally{await x.close();}
});
test('restarted formal lifecycle reconstructs T24 from historical membership and preserves append-only authority audit',async()=>{
 const x=await formalBusinessTestFixture();try{
  const users=[];for(let i=0;i<4;i++){const u=await x.user();await x.succeed(u);users.push(u);}
  const start=new Date(Date.now()+23*3600000),cutoff=new Date(start.getTime()-24*3600000);
  await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:start}});
  // Synthetic historical setup: one member left after T24 while worker was down.
  await x.db.v11Membership.updateMany({where:{registration:{activityId:x.activity.id}},data:{joinedAt:new Date(cutoff.getTime()-1000)}});
  await x.db.v11Membership.update({where:{registrationId:users[0].registration.id},data:{active:false,leftAt:new Date(cutoff.getTime()+1000)}});
  await scheduleFormalLifecycleBatch(x.db,x.f.context);
  const handlers={V11_FORMAL_LIFECYCLE:formalLifecycleHandler(x.db,async()=>x.f.authority(),x.f.context)};
  assert.equal(await runOne(x.db,x.prefix+'_restart',x.ops.id,handlers,['V11_FORMAL_LIFECYCLE'],x.f.context),true);
  const table=await x.db.v11Table.findFirstOrThrow({where:{activityId:x.activity.id}}),snapshot=await x.db.v11TableEvent.findUniqueOrThrow({where:{businessKey:'formal-t24:'+table.id}});
  assert.equal(snapshot.kind,'T24_FORMED_SNAPSHOT');assert.equal(snapshot.snapshot.count,4);assert.equal(snapshot.acceptedAt.toISOString(),cutoff.toISOString());
  assert.equal((await x.db.v11Table.findUniqueOrThrow({where:{id:table.id}})).t24FormedAt.toISOString(),cutoff.toISOString());
  const audit=await x.db.auditLog.findFirstOrThrow({where:{action:'policy.v11-runtime-assembled',targetId:x.policy.policyId}});
  await assert.rejects(x.db.auditLog.update({where:{id:audit.id},data:{metadata:{forged:true}}}));await assert.rejects(x.db.auditLog.delete({where:{id:audit.id}}));
  assert.deepEqual((await x.db.auditLog.findUniqueOrThrow({where:{id:audit.id}})).metadata,audit.metadata);
 }finally{await x.close();}
});
test('REQUEST_ACCEPTED removal occurs before OPS decision and preserves original refund application',async()=>{
 const x=await formalBusinessTestFixture({memberRemovalEvent:'REQUEST_ACCEPTED'});try{
  const u=await x.user();await x.succeed(u);
  const intake=await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/refund-requests',u.headers,{businessKey:x.prefix+'_request_exit'});
  const member=await x.db.v11Membership.findUniqueOrThrow({where:{registrationId:u.registration.id}});
  assert.equal(member.active,false);assert.equal(member.leftAt.toISOString(),intake.acceptedAt);assert.equal(await x.db.v11Decision.count({where:{requestId:intake.requestId}}),0);
  assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:u.registration.id}}),0);
  const repeated=await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/refund-requests',u.headers,{businessKey:x.prefix+'_request_exit'});assert.equal(repeated.acceptedAt,intake.acceptedAt);
  const decision=await x.request('POST','/api/v11/ops/formal/refund-requests/'+intake.requestId+'/decide',x.opsHeaders,{});assert.equal(decision.acceptedAt,intake.acceptedAt);
 }finally{await x.close();}
});
test('formal T8 restarted worker keeps low-person branch explicit without fabricated approval or receipt loss',async()=>{
 const x=await formalBusinessTestFixture();try{
  const u=await x.user();await x.succeed(u);
  const start=new Date(Date.now()+7*3600000);await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:start}});
  const table=await x.db.v11Table.findFirstOrThrow({where:{activityId:x.activity.id}});
  await x.db.v11Table.update({where:{id:table.id},data:{everFormed:true,t24FormedAt:new Date(start.getTime()-24*3600000),state:'FORMED'}});
  await scheduleFormalLifecycleBatch(x.db,x.f.context);
  const handlers={V11_FORMAL_LIFECYCLE:formalLifecycleHandler(x.db,async()=>x.f.authority(),x.f.context)};
  await runOne(x.db,x.prefix+'_t8_restart',x.ops.id,handlers,['V11_FORMAL_LIFECYCLE'],x.f.context);
  const unresolved=await x.db.v11Request.findFirstOrThrow({where:{kind:'LOW_PERSON_DECISION',businessKey:{startsWith:'formal-table-blocker:'+table.id}}});
  assert.ok(unresolved.blockerIds.length>0);assert.equal(await x.db.channelReceipt.count({where:{merchantScope:x.f.context.merchantScope}}),1);
  assert.equal(await x.db.v11Decision.count({where:{requestId:unresolved.id}}),0);
 }finally{await x.close();}
});
