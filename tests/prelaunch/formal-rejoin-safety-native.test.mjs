import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';import {root} from '../../scripts/prelaunch-owned-env.mjs';
const load=name=>import(pathToFileURL((process.env.PRELAUNCH_SOURCE_ROOT??root)+'/services/api/dist/'+name));
const {formalRefundService}=await load('prelaunch/formal-refund-service.js'),{followupFormalRefundBatch}=await load('prelaunch/formal-refund-followup.js');
const attempt=async(x,u,key)=>{const r=await x.db.v11Registration.findUniqueOrThrow({where:{id:u.registration.id}});return x.request('POST','/api/v11/formal/registrations',u.headers,{activityId:r.activityId,supplyId:r.supplyId,policyId:r.policyId,consentId:r.consentId,membership:'FORMAL',businessKey:key});};
test('collected ordinary cancellation blocks a new charge before amount decision and after confirmed refund; original signup replay is preserved',async()=>{
 const x=await formalBusinessTestFixture();try{const u=await x.user();await x.succeed(u);const cancel=await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/refund-requests',u.headers,{businessKey:x.prefix+'_cancel',requestCategory:'ORDINARY_CANCEL'});
  const retry=await attempt(x,u,x.prefix+'_signup_'+u.user.id);assert.equal(retry.registration.id,u.registration.id);
  for(const phase of ['before_decision','after_confirmed']){if(phase==='after_confirmed'){const d=await x.request('POST','/api/v11/ops/formal/refund-requests/'+cancel.requestId+'/decide',x.opsHeaders,{});assert.equal(d.entitlement.refundF,100);await x.db.v11RefundInstruction.updateMany({where:{registrationId:u.registration.id},data:{state:'CONFIRMED'}});}
   const response=await attempt(x,u,x.prefix+'_new_'+phase);assert.equal(response.registration,undefined);assert.ok(response.blockerIds.includes('OP-08'));assert.equal(await x.db.v11PaymentIntent.count({where:{registrationId:u.registration.id}}),1);const detail=await x.request('GET','/api/v11/formal/registrations/'+u.registration.id,u.headers);assert.equal(detail.registration.rejoinSafety.state,'BLOCKED_POLICY');}
 }finally{await x.close();}
});
test('NEW/UNKNOWN and an unsupported CLOSED field cannot prove zero money; trusted closure allows only no-money restart',async()=>{
 const x=await formalBusinessTestFixture();try{const u=await x.user();const cancel=await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/refund-requests',u.headers,{businessKey:x.prefix+'_cancel'});const intent=await x.db.v11PaymentIntent.findFirstOrThrow({where:{registrationId:u.registration.id}});
  for(const state of ['NEW','UNKNOWN','CLOSED']){await x.db.v11PaymentIntent.update({where:{id:intent.id},data:{state,active:state!=='CLOSED'}});const r=await attempt(x,u,x.prefix+'_blocked_'+state);assert.equal(r.registration,undefined);assert.ok(r.blockerIds.includes('OP-08'));}
  await x.db.v11PaymentIntent.update({where:{id:intent.id},data:{state:'NEW',active:false}});
  await x.request('POST','/api/v11/ops/formal/refund-requests/'+cancel.requestId+'/decide',x.opsHeaders,{});
  const {createFormalPaymentCloser}=await load('prelaunch/formal-payment-close.js');
  const now=(await x.db.$queryRaw`SELECT clock_timestamp() AS at`)[0].at;
  const lease=await x.db.durableJob.update({where:{businessKey:'v11:formal-cancel-close:'+intent.id},data:{state:'RUNNING',leaseOwner:x.prefix+'_closer',leaseUntil:new Date(now.getTime()+60000),generation:{increment:1},attempts:{increment:1}}});
  let called=0;x.channel.closePayment=async(i,guard)=>{await guard();assert.ok(await x.db.durableJob.count({where:{refId:intent.id,kind:'V11_QUERY_PAYMENT'}})>0);called++;return {status:'CLOSED',merchantOrderNo:i.merchantOrderNo,amountCents:i.totalCents,currency:'CNY'};};
  await createFormalPaymentCloser(x.db,x.channel)(lease);assert.equal(called,1);assert.equal((await x.db.v11PaymentIntent.findUniqueOrThrow({where:{id:intent.id}})).state,'NEW','transport observation alone must not fabricate local channel closure');
  x.channel.queryPayment=async i=>({status:'CLOSED',merchantOrderNo:i.merchantOrderNo,amountCents:i.totalCents,currency:'CNY'});
  await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/payment/query',u.headers,{});
  await followupFormalRefundBatch(x.db,async()=>x.f.authority(),x.f.context,formalRefundService(x.db,async()=>x.f.authority(),x.channel,x.ops.id),x.ops.id);
  const detail=await x.request('GET','/api/v11/formal/registrations/'+u.registration.id,u.headers);assert.equal(detail.registration.rejoinSafety.state,'NO_MONEY_CHANNEL_CLOSED');assert.ok(detail.registration.rejoinSafety.eventIds.length);assert.equal(detail.registration.rejoinSafety.proofKind,'VERIFIED_ORIGINAL_CHANNEL_CLOSURE');
  const allowed=await attempt(x,u,x.prefix+'_no_money_restart');assert.ok(allowed.registration);assert.notEqual(allowed.registration.id,u.registration.id);
 }finally{await x.close();}
});

test('waitlist exposure releases verified zero-money closure while unknown, conflict and collected money remain reserved',async()=>{
 for(const paid of [false,true]){
  const x=await formalBusinessTestFixture({waitlistExposureCents:300});try{
   for(let i=0;i<4;i++){const member=await x.user();await x.succeed(member);}const waiting=await x.user('WAITLIST');if(paid)await x.succeed(waiting);
   const cancel=await x.request('POST','/api/v11/formal/registrations/'+waiting.registration.id+'/refund-requests',waiting.headers,{businessKey:x.prefix+'_cancel'});
   await assert.rejects(x.user('WAITLIST'),/OP-08/);
   if(!paid){await x.request('POST','/api/v11/ops/formal/refund-requests/'+cancel.requestId+'/decide',x.opsHeaders,{});x.channel.queryPayment=async i=>({status:'CLOSED',merchantOrderNo:i.merchantOrderNo,amountCents:i.totalCents,currency:'CNY'});await x.request('POST','/api/v11/formal/registrations/'+waiting.registration.id+'/payment/query',waiting.headers,{});await followupFormalRefundBatch(x.db,async()=>x.f.authority(),x.f.context,formalRefundService(x.db,async()=>x.f.authority(),x.channel,x.ops.id),x.ops.id);
    const fresh=await x.user('WAITLIST');assert.ok(fresh.registration);
    const freshCancel=await x.request('POST','/api/v11/formal/registrations/'+fresh.registration.id+'/refund-requests',fresh.headers,{businessKey:x.prefix+'_fresh_cancel'});await x.request('POST','/api/v11/ops/formal/refund-requests/'+freshCancel.requestId+'/decide',x.opsHeaders,{});await x.request('POST','/api/v11/formal/registrations/'+fresh.registration.id+'/payment/query',fresh.headers,{});await followupFormalRefundBatch(x.db,async()=>x.f.authority(),x.f.context,formalRefundService(x.db,async()=>x.f.authority(),x.channel,x.ops.id),x.ops.id);

    const intake=await x.db.v11PaymentIntent.findFirstOrThrow({where:{registrationId:waiting.registration.id}}),closed=await x.db.receivedEvent.findUniqueOrThrow({where:{source_merchantScope_eventKey:{source:'wechat-closed-query-v11',merchantScope:intake.merchantScope,eventKey:'PAYMENT_CLOSED:'+intake.id}}});await x.db.receivedEvent.update({where:{id:closed.id},data:{state:'MANUAL'}});await assert.rejects(x.user('WAITLIST'),/OP-08/);
   }
  }finally{await x.close();}
 }
});
