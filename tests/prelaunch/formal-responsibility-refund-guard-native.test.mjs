import test from 'node:test';
import assert from 'node:assert/strict';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
test('a historical accepted responsibility duty cannot silently overwrite NORMAL fulfillment or retained F',async()=>{
 const x=await formalBusinessTestFixture();try{
  const u=await x.user();await x.succeed(u);
  await x.request('POST','/api/v11/ops/formal/activities/'+x.activity.id+'/responsibility-cancellations',x.opsHeaders,{businessKey:x.prefix+'_accepted',reason:'PLATFORM_CANCEL'});
  const due=await x.db.v11Request.findFirstOrThrow({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}});
  // Reconstruct the previously accepted overlapping history; the repaired
  // intake cannot create this intersection in new traffic.
  await x.db.v11Attendance.create({data:{registrationId:u.registration.id,restaurantActorId:x.rest.id,restaurantResult:'NORMAL',confirmedAt:new Date(due.acceptedAt.getTime()-1)}});
  const binding=await x.db.v11ReceiptBinding.findFirstOrThrow({where:{registrationId:u.registration.id}});
  const component=await x.db.v11FundComponent.findFirstOrThrow({where:{kind:'F',receiptId:binding.receiptId}});
  await x.db.v11Disposition.create({data:{componentId:component.id,businessKey:x.prefix+'_old_retained',kind:'RETAINED',amountCents:component.originalCents,state:'RECOGNITION_BLOCKED',sourceRef:x.prefix+'_historical_normal'}});
  const before=await x.db.v11Disposition.findMany({where:{componentId:component.id},orderBy:{id:'asc'}});
  const result=await x.app.inject({method:'POST',url:'/api/v11/ops/formal/refund-requests/'+due.id+'/decide',headers:x.opsHeaders,payload:{}});
  assert.equal(result.statusCode,409);assert.ok(result.body.includes('FORMAL_RESPONSIBILITY_AFTER_NORMAL_REVIEW_REQUIRED'));
  assert.deepEqual(await x.db.v11Disposition.findMany({where:{componentId:component.id},orderBy:{id:'asc'}}),before);
  assert.equal(await x.db.v11Decision.count({where:{requestId:due.id}}),0);
  assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:u.registration.id}}),0);
  assert.equal((await x.db.v11Request.findUniqueOrThrow({where:{id:due.id}})).state,'ACCEPTED');
 }finally{await x.close();}
});
