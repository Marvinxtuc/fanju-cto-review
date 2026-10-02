import {generateKeyPairSync,createHash,sign} from 'node:crypto';
import {mkdtempSync,writeFileSync} from 'node:fs';
import {checkinProfessionalRulesDigest} from '../../services/api/dist/prelaunch/formal-checkin-professional.js';
import {join} from 'node:path';
const professionalKeys=new Map();
export function syntheticCheckinConfiguration(){
 const directory=mkdtempSync('/private/tmp/fanju-synthetic-checkin-native-'),path=join(directory,'dedicated.pem'),keys=generateKeyPairSync('ed25519');
 const pem=keys.privateKey.export({type:'pkcs8',format:'pem'}).toString();writeFileSync(path,pem,{mode:0o600});
 const professional=generateKeyPairSync('ed25519'),publicRaw=professional.publicKey.export({type:'spki',format:'pem'}).toString(),publicPath=join(directory,'professional.pub'),approvalPath=join(directory,'professional.json'),revocationsPath=join(directory,'revoked.json');
 writeFileSync(publicPath,publicRaw,{mode:0o600});writeFileSync(approvalPath,'{}',{mode:0o600});writeFileSync(revocationsPath,'[]',{mode:0o600});professionalKeys.set(approvalPath,professional.privateKey);
 return {V11_CHECKIN_PROFESSIONAL_PUBLIC_KEY_PATH:publicPath,V11_CHECKIN_PROFESSIONAL_PUBLIC_KEY_SHA256:createHash('sha256').update(publicRaw).digest('hex'),V11_CHECKIN_PROFESSIONAL_APPROVAL_PATH:approvalPath,V11_CHECKIN_PROFESSIONAL_REVOCATIONS_PATH:revocationsPath,V11_CHECKIN_PROFESSIONAL_ID:'synthetic-independent-professional',FEATURE_V11_FORMAL_CHECKIN:'true',V11_CHECKIN_PRIVATE_KEY_PATH:path,V11_CHECKIN_PRIVATE_KEY_SHA256:createHash('sha256').update(pem).digest('hex'),V11_CHECKIN_SIGNING_KEY_ID:'synthetic-checkin-key',V11_CHECKIN_TOKEN_TTL_SECONDS:'60'};
}

export function writeSyntheticCheckinApproval(env,context,overrides={}){const now=Date.now(),raw=JSON.stringify({scope:'FORMAL_CHECKIN_PROFESSIONAL_APPROVAL',id:'synthetic-professional-approval',professionalId:env.V11_CHECKIN_PROFESSIONAL_ID,environment:'ISOLATED_TEST',...context,rulesDigest:checkinProfessionalRulesDigest,signingKeyId:env.V11_CHECKIN_SIGNING_KEY_ID,technicalTtlSeconds:Number(env.V11_CHECKIN_TOKEN_TTL_SECONDS),issuedAt:new Date(now-1000).toISOString(),notBefore:new Date(now-1000).toISOString(),expiresAt:new Date(now+3600000).toISOString(),professionalConclusion:'APPROVED_FOR_SPECIFIED_CHECKIN_RULES',...overrides});writeFileSync(env.V11_CHECKIN_PROFESSIONAL_APPROVAL_PATH,JSON.stringify({raw,signature:sign(null,Buffer.from(raw),professionalKeys.get(env.V11_CHECKIN_PROFESSIONAL_APPROVAL_PATH)).toString('base64')}),{mode:0o600});}
