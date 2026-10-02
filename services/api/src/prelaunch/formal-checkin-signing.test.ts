import {createHash,generateKeyPairSync} from 'node:crypto';
import {mkdtempSync,writeFileSync,symlinkSync,chmodSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {describe,it,expect} from 'vitest';
import {loadFormalCheckinSigning,type FormalCheckinClaims} from './formal-checkin-signing.js';
function fixture(){
 const dir=mkdtempSync('/private/tmp/fanju-synthetic-formal-checkin-'),path=join(dir,'key.pem'),keys=generateKeyPairSync('ed25519');
 const raw=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();writeFileSync(path,raw,{mode:0o600});
 const env={NODE_ENV:'test',APP_ENV:'ci',V11_CHECKIN_PRIVATE_KEY_PATH:path,V11_CHECKIN_PRIVATE_KEY_SHA256:createHash('sha256').update(raw).digest('hex'),V11_CHECKIN_SIGNING_KEY_ID:'synthetic-key-v1',V11_CHECKIN_TOKEN_TTL_SECONDS:'60'};
 const signer=loadFormalCheckinSigning(env,resolve('../..')),now=Date.now();
 const claims:FormalCheckinClaims={scope:'FORMAL_CHECKIN',audience:'fanju-formal-attendance',environment:'ISOLATED_TEST',keyId:signer.keyId,
  activityId:'synthetic-activity',restaurantId:'synthetic-restaurant',supplyId:'synthetic-supply',policyId:'synthetic-policy',policyDigest:'a'.repeat(64),
  professionalApprovalId:'synthetic-professional',professionalApprovalDigest:'b'.repeat(64),rulesDigest:'c'.repeat(64),issuerActorId:'synthetic-issuer',issuerPersonId:'synthetic-person',issuerActorVersion:0,authorityId:'synthetic-approval',nonce:signer.nonce(),issuedAt:now,expiresAt:now+60000};
 return {env,signer,now,claims,dir,path};
}
describe('dedicated formal checkin token signing',()=>{
 it('signs exact scope and technical TTL, rejecting tampering and extra fields',()=>{
  const f=fixture(),token=f.signer.sign(f.claims);expect(f.signer.verify(token,f.now)).toEqual(f.claims);
  const parts=token.split('.');parts[1]=Buffer.from(JSON.stringify({...f.claims,activityId:'other'})).toString('base64url');expect(()=>f.signer.verify(parts.join('.'),f.now)).toThrow('signature');
  expect(()=>f.signer.sign({...f.claims,expiresAt:f.now+60001})).toThrow('scope');
  expect(()=>f.signer.sign({...f.claims,unexpected:true} as FormalCheckinClaims)).toThrow();
 });
 it('rejects expired/future tokens, wrong key or production use of isolated tokens',()=>{
  const f=fixture(),token=f.signer.sign(f.claims);expect(()=>f.signer.verify(token,f.now+60000)).toThrow('lifetime');expect(()=>f.signer.verify(token,f.now-1)).toThrow('lifetime');
  const other=fixture();expect(()=>other.signer.verify(token,f.now)).toThrow('signature');
  const prod=loadFormalCheckinSigning({...f.env,NODE_ENV:'production',APP_ENV:'production'},resolve('../..'));expect(()=>prod.verify(token,f.now)).toThrow('scope');
 });
 it('does not substitute a session secret and requires fixed key and explicit engineering TTL',()=>{
  const f=fixture();expect(()=>loadFormalCheckinSigning({...f.env,V11_CHECKIN_PRIVATE_KEY_PATH:undefined,PRELAUNCH_SESSION_SECRET:'synthetic-local-session-secret'},resolve('../..'))).toThrow('dedicated');
  expect(()=>loadFormalCheckinSigning({...f.env,V11_CHECKIN_PRIVATE_KEY_SHA256:undefined},resolve('../..'))).toThrow('integrity');
  expect(()=>loadFormalCheckinSigning({...f.env,V11_CHECKIN_TOKEN_TTL_SECONDS:undefined},resolve('../..'))).toThrow('TTL');
 });
 it('rereads fixed key integrity and rejects symlink/broad permissions/oversized key',()=>{
  const f=fixture(),token=f.signer.sign(f.claims);writeFileSync(f.path,'modified');expect(()=>f.signer.verify(token,f.now)).toThrow('integrity');
  const g=fixture();chmodSync(g.path,0o644);expect(()=>loadFormalCheckinSigning(g.env,resolve('../..'))).toThrow('permissions');
  const h=fixture(),link=join(h.dir,'link.pem');symlinkSync(h.path,link);expect(()=>loadFormalCheckinSigning({...h.env,V11_CHECKIN_PRIVATE_KEY_PATH:link},resolve('../..'))).toThrow('path');
  writeFileSync(h.path,'x'.repeat(16385));expect(()=>loadFormalCheckinSigning(h.env,resolve('../..'))).toThrow('permissions');
 });
});
