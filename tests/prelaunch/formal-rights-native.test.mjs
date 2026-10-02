import test from 'node:test';
import assert from 'node:assert/strict';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
test('formal user rights intake is own-only, durable and idempotent without applying account/data/funding changes',{timeout:60000},async()=>{
 const x=await formalBusinessTestFixture();try{
  const a=await x.user(),b=await x.user();const profileBefore=await x.db.v11Profile.findUnique({where:{userId:a.user.id}}),registrationBefore=await x.db.v11Registration.findUnique({where:{id:a.registration.id}});const accepted=[];
  for(const kind of ['ACCESS','EXPORT','CORRECTION','CLOSURE','WITHDRAWAL']){
   const key=x.prefix+'_'+kind,payload={kind,businessKey:key,...(accepted.length?{referenceRequestId:accepted[0].id}:{})};const [first,second]=await Promise.all([x.request('POST','/api/v11/formal/rights',a.headers,payload),x.request('POST','/api/v11/formal/rights',a.headers,payload)]);assert.equal(first.request.id,second.request.id);assert.equal(first.request.acceptedAt,second.request.acceptedAt);assert.equal(first.request.actionsApplied,false);assert.equal(first.request.scope,'REQUEST_INTAKE_ONLY');accepted.push(first.request);
   const cases=await x.db.financialCase.findMany({where:{sourceRef:first.request.id,category:'V11_FORMAL_RIGHTS_REVIEW'}});assert.equal(cases.length,1);assert.equal(cases[0].owner,x.ops.id);const audit=await x.db.auditLog.findFirstOrThrow({where:{action:'rights.v11-formal-intake',targetId:first.request.id}});assert.equal(audit.metadata.contractualSlaConfirmed,false);
  }
  const list=await x.request('GET','/api/v11/formal/rights',a.headers);assert.equal(list.requests.length,5);assert.ok(list.requests.every(r=>r.actionsApplied===false));assert.deepEqual((await x.request('GET','/api/v11/formal/rights',b.headers)).requests,[]);
  const foreignRead=await x.app.inject({method:'GET',url:'/api/v11/formal/rights/'+accepted[0].id,headers:b.headers});assert.equal(foreignRead.statusCode,404);
  const foreignReference=await x.app.inject({method:'POST',url:'/api/v11/formal/rights',headers:b.headers,payload:{kind:'WITHDRAWAL',businessKey:x.prefix+'_foreign',referenceRequestId:accepted[0].id}});assert.equal(foreignReference.statusCode,404);
  const differentKind=await x.app.inject({method:'POST',url:'/api/v11/formal/rights',headers:a.headers,payload:{kind:'EXPORT',businessKey:x.prefix+'_ACCESS'}});assert.equal(differentKind.statusCode,409);
  const attachment=await x.app.inject({method:'POST',url:'/api/v11/formal/rights',headers:a.headers,payload:{kind:'CORRECTION',businessKey:x.prefix+'_attachment',attachment:'synthetic'}});assert.equal(attachment.statusCode,400);
  const anonymous=await x.app.inject({method:'POST',url:'/api/v11/formal/rights',payload:{kind:'CLOSURE',businessKey:x.prefix+'_anonymous'}});assert.equal(anonymous.statusCode,401);
  const ops=await x.request('GET','/api/v11/ops/formal/rights',x.opsHeaders);assert.ok(ops.requests.some(r=>r.id===accepted[0].id&&r.caseOwner===x.ops.id));const denied=await x.app.inject({method:'GET',url:'/api/v11/ops/formal/rights',headers:x.restHeaders});assert.equal(denied.statusCode,403);
  assert.deepEqual(await x.db.v11Profile.findUnique({where:{userId:a.user.id}}),profileBefore);assert.deepEqual(await x.db.v11Registration.findUnique({where:{id:a.registration.id}}),registrationBefore);assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:a.registration.id}}),0);
 }finally{await x.close();}
});
