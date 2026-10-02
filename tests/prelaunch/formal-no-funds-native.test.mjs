import test from 'node:test';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
import {root} from '../../scripts/prelaunch-owned-env.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT??root,load=name=>import(pathToFileURL(repo+'/services/api/dist/'+name));
const {createFormalHoldExpirer}=await load('prelaunch/formal-hold-expiry.js'),{formalRefundService}=await load('prelaunch/formal-refund-service.js'),{followupFormalRefundBatch}=await load('prelaunch/formal-refund-followup.js');
test('formal unpaid waitlist application reaches trusted no-funds closure without erasing accepted history',async()=>{
 const x=await formalBusinessTestFixture();try{
  for(let i=0;i<4;i++){const u=await x.user();await x.succeed(u);}const u=await x.user('WAITLIST');
  const intake=await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/refund-requests',u.headers,{businessKey:x.prefix+'_unpaid'});
  const decision=await x.request('POST','/api/v11/ops/formal/refund-requests/'+intake.requestId+'/decide',x.opsHeaders,{});assert.equal(decision.state,'AWAITING_TRUSTED_RECEIPT');
  const accepted=new Date(Date.now()-20*60000),expires=new Date(accepted.getTime()+600000);
  await x.db.v11Registration.update({where:{id:u.registration.id},data:{acceptedAt:accepted}});await x.db.v11SeatHold.update({where:{registrationId:u.registration.id},data:{expiresAt:expires}});
  await createFormalHoldExpirer(x.db,x.f.context,x.ops.id)(u.registration.id);
  x.channel.queryPayment=async intent=>({status:'CLOSED',merchantOrderNo:intent.merchantOrderNo,amountCents:intent.totalCents,currency:'CNY'});
  await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/payment/query',u.headers,{});
  await followupFormalRefundBatch(x.db,async()=>x.f.authority(),x.f.context,formalRefundService(x.db,async()=>x.f.authority(),x.channel,x.ops.id),x.ops.id);
  const closed=await x.db.v11Request.findUniqueOrThrow({where:{id:intake.requestId}});assert.equal(closed.state,'NO_FUNDS_CHANNEL_CLOSED');assert.equal(closed.acceptedAt.toISOString(),intake.acceptedAt);
  assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:u.registration.id}}),0);
  assert.equal(await x.db.financialCase.count({where:{sourceRef:intake.requestId,state:'OPEN'}}),0);
 }finally{await x.close();}
});
