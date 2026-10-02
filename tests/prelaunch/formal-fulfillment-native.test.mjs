import test from 'node:test';
import assert from 'node:assert/strict';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
test('formal restaurant normal fulfillment records D-only next-Shanghai-day obligation without treating abnormal or missing as breach',{timeout:60000},async()=>{
 const x=await formalBusinessTestFixture();try{
  const users=[];for(let n=0;n<4;n++){const u=await x.user();await x.succeed(u);users.push(u);}
  const url=u=>'/api/v11/restaurant/formal/registrations/'+u.registration.id+'/fulfillment';
  const before=await x.app.inject({method:'POST',url:url(users[0]),headers:x.restHeaders,payload:{result:'NORMAL'}});assert.equal(before.statusCode,409);
  const ops=await x.app.inject({method:'POST',url:url(users[0]),headers:x.opsHeaders,payload:{result:'NORMAL'}});assert.equal(ops.statusCode,403);
  const user=await x.app.inject({method:'POST',url:url(users[0]),headers:users[0].headers,payload:{result:'NORMAL'}});assert.ok([401,403].includes(user.statusCode));
  // Activity ended in the fixture's owned database only. No financial call is made.
  const ended=new Date(Date.now()-3600000);await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(ended.getTime()-2*3600000),endsAt:ended}});
  const beforeList=await x.request('GET','/api/v11/formal/fulfillment-registrations',x.restHeaders);assert.equal(beforeList.registrations.filter(r=>r.activityId===x.activity.id).length,4);
  const a=await x.request('POST',url(users[0]),x.restHeaders,{result:'NORMAL'}),repeat=await x.request('POST',url(users[0]),x.restHeaders,{result:'NORMAL'});assert.equal(a.requestId,repeat.requestId);assert.equal(a.refundConfirmed,false);
  const due=await x.db.v11Request.findUniqueOrThrow({where:{id:a.requestId}});assert.equal(due.payload.F,0);assert.equal(due.payload.D,200);assert.equal(due.payload.reason,'NORMAL_FULFILLMENT');assert.ok(due.payload.fulfillmentId);
  const shifted=new Date(ended.getTime()+8*3600000);const nextDate=new Date(Date.UTC(shifted.getUTCFullYear(),shifted.getUTCMonth(),shifted.getUTCDate()+1)).toISOString().slice(0,10);assert.equal(due.payload.notBefore,new Date(nextDate+'T00:00:00+08:00').toISOString());
  assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:users[0].registration.id}}),0);
  const decision=await x.request('POST','/api/v11/ops/formal/refund-requests/'+a.requestId+'/decide',x.opsHeaders,{});assert.equal(decision.state,'WAITING_BATCH');assert.ok(Date.parse(decision.batchAt)>=Date.parse(due.payload.notBefore));const instruction=await x.db.v11RefundInstruction.findFirstOrThrow({where:{registrationId:users[0].registration.id}});assert.equal(instruction.serviceFeeCents,0);assert.equal(instruction.depositCents,200);
  const abnormal=await x.request('POST',url(users[1]),x.restHeaders,{result:'ABNORMAL'});assert.equal(abnormal.automaticBreach,false);assert.equal(abnormal.state,'AWAITING_MANUAL_DECISION');assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:users[1].registration.id}}),0);
  const missing=await x.request('GET','/api/v11/formal/registrations/'+users[2].registration.id,users[2].headers);assert.equal(missing.registration.fulfillment,null);assert.equal(await x.db.v11Request.count({where:{registrationId:users[2].registration.id,kind:'FORMAL_MANDATORY_REFUND'}}),0);
  const conflict=await x.app.inject({method:'POST',url:url(users[1]),headers:x.restHeaders,payload:{result:'NORMAL'}});assert.equal(conflict.statusCode,409);
  const fakeDate=await x.app.inject({method:'POST',url:url(users[3]),headers:x.restHeaders,payload:{result:'NORMAL',notBefore:'2020-01-01T00:00:00Z'}});assert.equal(fakeDate.statusCode,400);
  const otherRestaurant=await x.db.v11Actor.findUniqueOrThrow({where:{id:x.prefix+'_restaurant_actor'}});await x.db.v11Actor.update({where:{id:otherRestaurant.id},data:{restaurantId:null}});const wrong=await x.app.inject({method:'POST',url:url(users[3]),headers:x.restHeaders,payload:{result:'NORMAL'}});assert.ok([401,403,404].includes(wrong.statusCode));
 }finally{await x.close();}
});

test('normal formal fulfillment retains D obligation when official batch parameters are absent',{timeout:60000},async()=>{
 const x=await formalBusinessTestFixture({refundBatchUtcMinutes:null,refundDispatchSlaSeconds:null});try{
  const u=await x.user();await x.succeed(u);await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(Date.now()-3*3600000),endsAt:new Date(Date.now()-3600000)}});
  const accepted=await x.request('POST','/api/v11/restaurant/formal/registrations/'+u.registration.id+'/fulfillment',x.restHeaders,{result:'NORMAL'});const result=await x.request('POST','/api/v11/ops/formal/refund-requests/'+accepted.requestId+'/decide',x.opsHeaders,{});assert.equal(result.state,'BLOCKED_PARAMETERS');assert.ok(result.blockerIds.includes('OP-11'));assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:u.registration.id}}),0);const obligation=await x.db.v11Request.findUniqueOrThrow({where:{id:accepted.requestId}});assert.equal(obligation.payload.D,200);assert.equal(obligation.payload.F,0);assert.ok(obligation.payload.notBefore);
 }finally{await x.close();}
});
