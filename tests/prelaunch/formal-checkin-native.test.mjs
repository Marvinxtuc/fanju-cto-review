import test from 'node:test';import assert from 'node:assert/strict';
import {formalBusinessTestFixture} from './formal-business-test-fixture.mjs';
import {syntheticCheckinConfiguration} from './formal-checkin-test-config.mjs';
async function setup(actions=true){return formalBusinessTestFixture({}, {checkinActions:actions,checkinEnv:syntheticCheckinConfiguration()});}
async function prepared(x){const u=await x.user();await x.succeed(u);return u;}
async function issue(x){const reg=await x.db.v11SupplyRevision.findFirstOrThrow({where:{activityId:x.activity.id,status:'FORMAL_APPROVED'}});return x.request('POST','/api/v11/restaurant/formal/activities/'+x.activity.id+'/checkin-token',x.restHeaders,{supplyId:reg.id});}
async function scan(x,u,token,expected=200){const response=await x.app.inject({method:'POST',url:'/api/v11/formal/registrations/'+u.registration.id+'/checkin',headers:u.headers,payload:{token}});assert.equal(response.statusCode,expected,response.body);return response.json();}
test('formal checkin preserves the first attendance fact and does not imply fulfillment or create refunds',async()=>{
 const x=await setup();try{
  const u=await prepared(x),token=await issue(x);assert.equal(token.scope,'FORMAL_CHECKIN');assert.equal(token.qrEncoding,'LOCAL_CLIENT_GIF');assert.equal(token.businessWindowDetermined,false);
  const [first,second]=await Promise.all([scan(x,u,token.token),scan(x,u,token.token)]);assert.equal(first.checkinAt,second.checkinAt);assert.equal([first.idempotent,second.idempotent].filter(Boolean).length,1);
  const attendance=await x.db.v11Attendance.findUniqueOrThrow({where:{registrationId:u.registration.id}});assert.equal(attendance.restaurantResult,null);assert.equal(attendance.confirmedAt,null);assert.equal(attendance.restaurantActorId,null);
  assert.equal(await x.db.auditLog.count({where:{action:'checkin.v11-formal-recorded',targetId:attendance.id}}),1);
  assert.equal(await x.db.v11Request.count({where:{registrationId:u.registration.id,kind:'FORMAL_MANDATORY_REFUND'}}),0);
  assert.equal(await x.db.v11RefundInstruction.count({where:{registrationId:u.registration.id}}),0);
 }finally{await x.close();}
});
test('formal checkin rejects tampering, wrong supply/activity and revoked issuer without dirty attendance',async()=>{
 const x=await setup();try{
  const u=await prepared(x),token=await issue(x);await scan(x,u,token.token.slice(0,-1)+(token.token.endsWith('a')?'b':'a'),400);
  const parts=token.token.split('.'),claims=JSON.parse(Buffer.from(parts[1],'base64url'));claims.activityId='other';parts[1]=Buffer.from(JSON.stringify(claims)).toString('base64url');await scan(x,u,parts.join('.'),400);
  const revoked=await x.db.v11Actor.update({where:{id:x.rest.id},data:{enabled:false,version:{increment:1}}});assert.equal(revoked.enabled,false);await scan(x,u,token.token,409);
  assert.equal(await x.db.v11Attendance.count({where:{registrationId:u.registration.id}}),0);
 }finally{await x.close();}
});
test('formal checkin old financial grants and revoked checkin grants do not acquire attendance authority',async()=>{
 const old=await setup(false);try{
  await prepared(old);const supply=await old.db.v11SupplyRevision.findFirstOrThrow({where:{activityId:old.activity.id,status:'FORMAL_APPROVED'}});
  const response=await old.app.inject({method:'POST',url:'/api/v11/restaurant/formal/activities/'+old.activity.id+'/checkin-token',headers:old.restHeaders,payload:{supplyId:supply.id}});assert.equal(response.statusCode,503);
 }finally{await old.close();}
 const x=await setup();try{const u=await prepared(x),token=await issue(x);x.f.trust.revokedIds.add(x.f.grant.id);await scan(x,u,token.token,503);assert.equal(await x.db.v11Attendance.count({where:{registrationId:u.registration.id}}),0);}finally{await x.close();}
});
test('formal checkin only records the authenticated owner and current active formal membership',async()=>{
 const x=await setup();try{
  const u=await prepared(x),other=await x.user(),token=await issue(x);
  const denied=await x.app.inject({method:'POST',url:'/api/v11/formal/registrations/'+u.registration.id+'/checkin',headers:other.headers,payload:{token:token.token}});assert.equal(denied.statusCode,404);
  await scan(x,other,token.token,409);
  const cancelled=await x.request('POST','/api/v11/formal/registrations/'+u.registration.id+'/refund-requests',u.headers,{businessKey:x.prefix+'_exit'});assert.equal(cancelled.cancellationAccepted,true);await scan(x,u,token.token,409);
  assert.equal(await x.db.v11Attendance.count({where:{registrationId:{in:[u.registration.id,other.registration.id]}}}),0);
 }finally{await x.close();}
});
test('generic CHECKIN authority does not replace dedicated professional evidence and scope/revocation is reread',async()=>{
 const x=await setup();try{
  const {readFileSync,writeFileSync}=await import('node:fs'),path=x.checkinEnv.V11_CHECKIN_PROFESSIONAL_APPROVAL_PATH,original=readFileSync(path,'utf8');
  const u=await prepared(x),supply=await x.db.v11SupplyRevision.findFirstOrThrow({where:{activityId:x.activity.id,status:'FORMAL_APPROVED'}});
  writeFileSync(path,'{}');const denied=await x.app.inject({method:'POST',url:'/api/v11/restaurant/formal/activities/'+x.activity.id+'/checkin-token',headers:x.restHeaders,payload:{supplyId:supply.id}});assert.equal(denied.statusCode,503);assert.equal(await x.db.auditLog.count({where:{action:'checkin.v11-formal-token-issued',targetId:x.activity.id}}),0);
  writeFileSync(path,original);const token=await issue(x);
  writeFileSync(x.checkinEnv.V11_CHECKIN_PROFESSIONAL_REVOCATIONS_PATH,JSON.stringify(['synthetic-professional-approval']));await scan(x,u,token.token,503);assert.equal(await x.db.v11Attendance.count({where:{registrationId:u.registration.id}}),0);
  writeFileSync(x.checkinEnv.V11_CHECKIN_PROFESSIONAL_REVOCATIONS_PATH,'[]');
  const {writeSyntheticCheckinApproval}=await import('./formal-checkin-test-config.mjs'),claims=JSON.parse(Buffer.from(token.token.split('.')[1],'base64url'));
  const context={activityId:claims.activityId,restaurantId:claims.restaurantId,supplyId:claims.supplyId,supplyDigest:supply.digest,policyId:claims.policyId,policyDigest:claims.policyDigest};
  for(const override of [{supplyId:'different-supply'},{policyDigest:'f'.repeat(64)},{rulesDigest:'e'.repeat(64)},{environment:'PRODUCTION'},{professionalConclusion:'NOT_APPROVED'}]){
   writeSyntheticCheckinApproval(x.checkinEnv,context,override);await scan(x,u,token.token,503);
  }
  assert.equal(await x.db.v11Attendance.count({where:{registrationId:u.registration.id}}),0);
 }finally{await x.close();}
});
test('production context rejects test professional approval and token issuer cannot sign its own professional approval',async()=>{
 const x=await setup();try{
  const {loadCheckinProfessionalApproval}=await import('../../services/api/dist/prelaunch/formal-checkin-professional.js'),{loadFormalCheckinSigning}=await import('../../services/api/dist/prelaunch/formal-checkin-signing.js');
  const {readFileSync,writeFileSync}=await import('node:fs'),{createPrivateKey,createPublicKey,createHash,sign}=await import('node:crypto');
  const signer=loadFormalCheckinSigning({...x.checkinEnv,APP_ENV:'ci',NODE_ENV:'test'},process.cwd()),envelope=JSON.parse(readFileSync(x.checkinEnv.V11_CHECKIN_PROFESSIONAL_APPROVAL_PATH,'utf8')),approval=JSON.parse(envelope.raw),context={environment:'PRODUCTION',activityId:approval.activityId,restaurantId:approval.restaurantId,supplyId:approval.supplyId,supplyDigest:approval.supplyDigest,policyId:approval.policyId,policyDigest:approval.policyDigest,signingKeyId:approval.signingKeyId,technicalTtlSeconds:approval.technicalTtlSeconds};
  assert.throws(()=>loadCheckinProfessionalApproval(x.checkinEnv,process.cwd())(context,new Date(),signer.publicKeySha256));
  const key=createPrivateKey(readFileSync(x.checkinEnv.V11_CHECKIN_PRIVATE_KEY_PATH)),publicRaw=createPublicKey(key).export({type:'spki',format:'pem'}).toString();writeFileSync(x.checkinEnv.V11_CHECKIN_PROFESSIONAL_PUBLIC_KEY_PATH,publicRaw);
  const env={...x.checkinEnv,V11_CHECKIN_PROFESSIONAL_PUBLIC_KEY_SHA256:createHash('sha256').update(publicRaw).digest('hex')};
  writeFileSync(env.V11_CHECKIN_PROFESSIONAL_APPROVAL_PATH,JSON.stringify({...envelope,signature:sign(null,Buffer.from(envelope.raw),key).toString('base64')}));
  assert.throws(()=>loadCheckinProfessionalApproval(env,process.cwd())({...context,environment:'ISOLATED_TEST'},new Date(),signer.publicKeySha256));
 }finally{await x.close();}
});
