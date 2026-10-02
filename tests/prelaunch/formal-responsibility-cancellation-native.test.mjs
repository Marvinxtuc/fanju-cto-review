import test from 'node:test';
import assert from 'node:assert/strict';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
for(const reason of ['PLATFORM_CANCEL','RESTAURANT_CANCEL'])test('formal responsibility cancellation preserves original F+D and independent compensation: '+reason,async()=>{
 const x=await formalBusinessTestFixture();try{
  const users=[];for(let i=0;i<4;i++){const u=await x.user();await x.succeed(u);users.push(u);}
  const before=await x.db.v11Membership.findMany({where:{registrationId:{in:users.map(u=>u.registration.id)}}});assert.equal(before.length,4);
  assert.equal((await x.db.v11Table.findUniqueOrThrow({where:{id:before[0].tableId}})).state,'FORMED');
  const failed=await x.app.inject({method:'POST',url:'/api/v11/ops/formal/activities/'+x.activity.id+'/responsibility-cancellations',headers:users[0].headers,payload:{businessKey:x.prefix+'_denied',reason}});assert.ok([401,403].includes(failed.statusCode));
  let proposalId;
  if(reason==='RESTAURANT_CANCEL'){
   const p=await x.request('POST','/api/v11/restaurant/formal/activities/'+x.activity.id+'/responsibility-cancellations',x.restHeaders,{businessKey:x.prefix+'_proposal_cancel'});proposalId=p.requestId;
   assert.equal(p.membershipEnded,false);assert.equal(await x.db.v11Membership.count({where:{tableId:before[0].tableId,active:true}}),4);
  }
  const body={businessKey:x.prefix+'_accept_responsibility',reason,...(proposalId?{proposalId}:{})};
  const accepted=await x.request('POST','/api/v11/ops/formal/activities/'+x.activity.id+'/responsibility-cancellations',x.opsHeaders,body);
  assert.equal(accepted.membershipEnded,true);assert.equal(accepted.compensationAmount,null);assert.equal(accepted.newMoneySubmitted,false);
  const repeated=await x.request('POST','/api/v11/ops/formal/activities/'+x.activity.id+'/responsibility-cancellations',x.opsHeaders,body);assert.equal(repeated.requestId,accepted.requestId);
  assert.equal((await x.db.activity.findUniqueOrThrow({where:{id:x.activity.id}})).status,'CANCELED');
  assert.equal(await x.db.v11Membership.count({where:{tableId:before[0].tableId,active:true}}),0);
  assert.equal(await x.db.v11Registration.count({where:{id:{in:users.map(u=>u.registration.id)},active:true}}),0);
  assert.equal(await x.db.financialCase.count({where:{sourceRef:accepted.requestId,category:'V11_RESPONSIBILITY_COMPENSATION_REVIEW'}}),1);
  const dues=await x.db.v11Request.findMany({where:{registrationId:{in:users.map(u=>u.registration.id)},kind:'FORMAL_MANDATORY_REFUND'}});assert.equal(dues.length,4);
  for(const due of dues){
   const rights=await x.db.auditLog.findFirstOrThrow({where:{action:'refund.v11-responsibility-rights',targetId:due.id}});
   assert.equal(rights.metadata.tableState,'FORMED');assert.equal(rights.metadata.activeMember,true);assert.equal(rights.metadata.reason,reason);
   const reg=await x.db.v11Registration.findUniqueOrThrow({where:{id:due.registrationId}});
   const decision=await x.request('POST','/api/v11/ops/formal/refund-requests/'+due.id+'/decide',x.opsHeaders,{});
   assert.equal(decision.ruleCode,'RESPONSIBILITY_FULL_REFUND');assert.equal(decision.entitlement.refundF,reg.serviceFeeCents);assert.equal(decision.entitlement.refundD,reg.depositCents);
   assert.equal(decision.entitlement.compensationRequired,true);assert.equal(decision.state,'WAITING_BATCH');
   const again=await x.request('POST','/api/v11/ops/formal/refund-requests/'+due.id+'/decide',x.opsHeaders,{});assert.equal(again.decisionId,decision.decisionId);
   const rows=await x.db.v11RefundInstruction.findMany({where:{registrationId:reg.id}});assert.equal(rows.length,1);assert.equal(rows[0].state,'WAITING_BATCH');assert.equal(rows[0].totalCents,reg.serviceFeeCents+reg.depositCents);
   assert.equal(rows[0].merchantScope,x.f.context.merchantScope);assert.equal(rows[0].providerConfigId,x.f.context.providerConfigId);
  }
  assert.equal(await x.db.v11SettlementObligation.count({where:{registrationId:{in:users.map(u=>u.registration.id)}}}),0);
  assert.equal(await x.db.v11Registration.count({where:{activityId:x.activity.id,active:true}}),0);
 }finally{await x.close();}
});
test('responsibility cancellation retains mandatory duty without receipts and avoids a duplicate late-receipt duty',async()=>{
 const x=await formalBusinessTestFixture();try{
  const u=await x.user();
  const accepted=await x.request('POST','/api/v11/ops/formal/activities/'+x.activity.id+'/responsibility-cancellations',x.opsHeaders,{businessKey:x.prefix+'_no_receipt',reason:'PLATFORM_CANCEL'});
  const due=await x.db.v11Request.findFirstOrThrow({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}});
  const pending=await x.request('POST','/api/v11/ops/formal/refund-requests/'+due.id+'/decide',x.opsHeaders,{});assert.equal(pending.state,'AWAITING_TRUSTED_RECEIPT');
  assert.equal(await x.db.v11SeatHold.count({where:{registrationId:u.registration.id,state:'HELD'}}),0);
  await x.succeed(u);
  assert.equal(await x.db.v11Request.count({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}}),1);
  const decision=await x.request('POST','/api/v11/ops/formal/refund-requests/'+due.id+'/decide',x.opsHeaders,{});assert.equal(decision.ruleCode,'RESPONSIBILITY_FULL_REFUND');
  assert.equal(await x.db.v11Membership.count({where:{registrationId:u.registration.id,active:true}}),0);
  assert.equal(accepted.newMoneySubmitted,false);
 }finally{await x.close();}
});
test('empty published formal activity can stop registration with zero refund duties; historical activity cannot borrow this route',async()=>{
 const x=await formalBusinessTestFixture();try{
  const empty=await x.request('POST','/api/v11/ops/formal/activities/'+x.activity.id+'/responsibility-cancellations',x.opsHeaders,{businessKey:x.prefix+'_empty',reason:'PLATFORM_CANCEL'});
  assert.deepEqual(empty.refundRequestIds,[]);assert.equal((await x.db.activity.findUniqueOrThrow({where:{id:x.activity.id}})).status,'CANCELED');
  assert.equal(await x.db.v11RefundInstruction.count({where:{registration:{activityId:x.activity.id}}}),0);
  const historical=await x.db.activity.create({data:{restaurantId:x.activity.restaurantId,title:'合成历史活动',theme:'菜单体验',description:'合成历史活动',district:'合成区',businessArea:'合成商圈',startsAt:new Date(Date.now()+3600000),endsAt:new Date(Date.now()+7200000),registrationEndsAt:new Date(Date.now()+1800000),serviceFeeCents:0,mealFeePolicyText:'现场结算',capacity:4,status:'PUBLISHED'}});
  const denied=await x.app.inject({method:'POST',url:'/api/v11/ops/formal/activities/'+historical.id+'/responsibility-cancellations',headers:x.opsHeaders,payload:{businessKey:x.prefix+'_historical',reason:'PLATFORM_CANCEL'}});assert.equal(denied.statusCode,409);assert.ok(denied.body.includes('FORMAL_RESPONSIBILITY_ACTIVITY_PROVENANCE_REQUIRED'));
  assert.equal((await x.db.activity.findUniqueOrThrow({where:{id:historical.id}})).status,'PUBLISHED');
 }finally{await x.close();}
});
for(const reason of ['PLATFORM_CANCEL','RESTAURANT_CANCEL'])test('responsibility cancellation NORMAL intersection retains entire activity and original budget for independent review: '+reason,async()=>{
 const x=await formalBusinessTestFixture();try{
  const users=[];for(let i=0;i<4;i++){const u=await x.user();await x.succeed(u);users.push(u);}const ids=users.map(u=>u.registration.id);
  await x.db.activity.update({where:{id:x.activity.id},data:{startsAt:new Date(Date.now()-3*3600000),endsAt:new Date(Date.now()-3600000)}});
  await x.db.v11Registration.updateMany({where:{id:{in:ids}},data:{acceptedAt:new Date(Date.now()-29*3600000)}});await x.db.v11Membership.updateMany({where:{registrationId:{in:ids}},data:{joinedAt:new Date(Date.now()-29*3600000)}});
  const normal=await x.request('POST','/api/v11/restaurant/formal/registrations/'+ids[0]+'/fulfillment',x.restHeaders,{result:'NORMAL'});await x.request('POST','/api/v11/ops/formal/refund-requests/'+normal.requestId+'/decide',x.opsHeaders,{});
  const read=async()=>({activity:await x.db.activity.findUnique({where:{id:x.activity.id}}),regs:await x.db.v11Registration.findMany({where:{id:{in:ids}},orderBy:{id:'asc'}}),members:await x.db.v11Membership.findMany({where:{registrationId:{in:ids}},orderBy:{id:'asc'}}),seats:await x.db.v11SeatHold.findMany({where:{registrationId:{in:ids}},orderBy:{id:'asc'}}),tables:await x.db.v11Table.findMany({where:{activityId:x.activity.id},orderBy:{id:'asc'}}),dispositions:await x.db.v11Disposition.findMany({where:{sourceRef:normal.requestId},orderBy:{id:'asc'}}),instructions:await x.db.v11RefundInstruction.findMany({where:{registrationId:{in:ids}},orderBy:{id:'asc'}})});
  const before=await read();assert.ok(before.dispositions.some(d=>d.kind==='RETAINED'&&d.amountCents===100));
  let proposalId,proposalAcceptedAt;if(reason==='RESTAURANT_CANCEL'){const p=await x.request('POST','/api/v11/restaurant/formal/activities/'+x.activity.id+'/responsibility-cancellations',x.restHeaders,{businessKey:x.prefix+'_normal_proposal'});proposalId=p.requestId;proposalAcceptedAt=(await x.db.v11Request.findUniqueOrThrow({where:{id:proposalId}})).acceptedAt.toISOString();}
  const body={businessKey:x.prefix+'_normal_cancel',reason,...(proposalId?{proposalId}:{})},url='/api/v11/ops/formal/activities/'+x.activity.id+'/responsibility-cancellations';
  const review=await x.request('POST',url,x.opsHeaders,body),retry=await x.request('POST',url,x.opsHeaders,body);
  assert.equal(review.state,'AWAITING_FULFILLMENT_RIGHTS_REVIEW');assert.equal(review.cancellationAccepted,false);assert.equal(review.membershipEnded,false);assert.equal(review.reviewRequired,true);assert.deepEqual(review.refundRequestIds,[]);assert.equal(retry.requestId,review.requestId);assert.equal(retry.originalRequestAcceptedAt,review.originalRequestAcceptedAt);if(proposalId)assert.equal(review.originalProposalAcceptedAt,proposalAcceptedAt);
  assert.deepEqual(await read(),before);assert.equal(await x.db.auditLog.count({where:{action:'cancellation.v11-responsibility-accepted',targetId:review.requestId}}),0);assert.equal(await x.db.v11Request.count({where:{registrationId:{in:ids},kind:'FORMAL_MANDATORY_REFUND'}}),1);
  const ownerCase=await x.db.financialCase.findFirstOrThrow({where:{category:'V11_RESPONSIBILITY_FULFILLMENT_RIGHTS_REVIEW',sourceRef:review.requestId}});assert.equal(ownerCase.owner,x.ops.id);
  const own=await x.request('GET','/api/v11/formal/registrations/'+ids[1],users[1].headers);assert.ok(own.registration.responsibilityReviews.some(r=>r.id===review.requestId&&!r.membershipEnded&&!r.cancellationAccepted&&r.reviewOwner===x.ops.id&&r.originalRequestAcceptedAt===review.originalRequestAcceptedAt));assert.ok(!JSON.stringify(own.registration.responsibilityReviews).includes(ids[0]));const cross=await x.app.inject({method:'GET',url:'/api/v11/formal/registrations/'+ids[0],headers:users[1].headers});assert.equal(cross.statusCode,404);const consult=await x.request('POST','/api/v11/formal/registrations/'+ids[1]+'/refund-requests',users[1].headers,{businessKey:x.prefix+'_consult',requestCategory:'CONSULTATION'});assert.equal(consult.membershipEnded,false);
  const list=await x.request('GET','/api/v11/formal/responsibility-cancellations',x.opsHeaders);assert.ok(list.requests.some(r=>r.id===review.requestId&&r.reviewRequired&&!r.cancellationAccepted&&!r.membershipEnded));
 }finally{await x.close();}
});
