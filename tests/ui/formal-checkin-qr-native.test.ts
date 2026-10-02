import {test,expect} from 'vitest';
import {createHash} from 'node:crypto';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {createFormalCheckinQr} from '../../apps/ops/src/formal-checkin-qr.js';
import {loadFormalCheckinSigning} from '../../services/api/src/prelaunch/formal-checkin-signing.js';
import {syntheticCheckinConfiguration} from '../prelaunch/formal-checkin-test-config.mjs';
test('actual encoder emits a local GIF without exposing its signed payload',()=>{
 const signing=loadFormalCheckinSigning({...syntheticCheckinConfiguration(),NODE_ENV:'test',APP_ENV:'ci'},process.cwd()),now=Date.now();
 const token=signing.sign({scope:'FORMAL_CHECKIN',audience:'fanju-formal-attendance',environment:'ISOLATED_TEST',keyId:signing.keyId,activityId:'synthetic-activity',restaurantId:'synthetic-restaurant',supplyId:'synthetic-supply',policyId:'synthetic-policy',policyDigest:'a'.repeat(64),professionalApprovalId:'synthetic-professional',professionalApprovalDigest:'b'.repeat(64),rulesDigest:'c'.repeat(64),issuerActorId:'synthetic-issuer',issuerPersonId:'synthetic-person',issuerActorVersion:0,authorityId:'synthetic-approval',nonce:signing.nonce(),issuedAt:now,expiresAt:now+60000});
 const gif=createFormalCheckinQr(token);expect(gif.startsWith('data:image/gif;base64,')).toBe(true);
 const dir=mkdtempSync('/private/tmp/fanju-checkin-qr-'),path=join(dir,'synthetic.gif');writeFileSync(path,Buffer.from(gif.split(',')[1],'base64'),{mode:0o600});
 const hash=createHash('sha256').update(token).digest('hex');writeFileSync('docs/prelaunch/run-to-production-20261002/formal-checkin/QR_NATIVE_INPUT.json',JSON.stringify({path,payloadsha256:hash,encoding:'ACTUAL_OPS_LOCAL_ENCODER_SYNTHETIC_SIGNED_TOKEN',realWechatCameraVerified:false},null,2)+'\n');
 expect(()=>createFormalCheckinQr('https://invalid.example/')).toThrow();
});
