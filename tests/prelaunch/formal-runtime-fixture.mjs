import {createHash,generateKeyPairSync,sign} from 'node:crypto';
export const hash=(s)=>createHash('sha256').update(s).digest('hex');
export function formalRuntimeFixture(prefix,at=new Date(),parameterOverrides={}){
 const gateIds=['OP-03','OP-04','OP-05','OP-07','OP-08','OP-09','OP-10','OP-11','OP-12','OP-13','OP-14','OP-15',
  'RV-01','RV-02','RV-03','RV-04','RV-05','RV-06','RV-07'];
 const evidence=new Map();const material={scope:'FORMAL_POLICY_RELEASE_MATERIAL',bundleId:prefix,version:prefix+'_v1',
  releaseVersion:prefix+'_release',inheritedBaselineHash:hash('synthetic frozen baseline'),
  documents:['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY'].map(kind=>{
   const publicText='SYNTHETIC isolated formal-route test document '+kind;
   const fullText='synthetic internal metadata<!-- PUBLIC_POLICY_START -->'+publicText+'<!-- PUBLIC_POLICY_END -->';
   return {kind,documentId:prefix+'_'+kind,version:prefix+'_v1',fullText,fullHash:hash(fullText),publicText,publicHash:hash(publicText)};
  }),evidence:gateIds.map(gateId=>{const referenceId=prefix+'_'+gateId,text='SYNTHETIC conclusion fixture '+gateId;evidence.set(referenceId,text);
   return {gateId,referenceId,sha256:hash(text),kind:gateId.startsWith('OP-')?'BUSINESS_DECISION':'SPECIALIST_CONCLUSION'};})};
 const materialRaw=JSON.stringify(material);const parameterRaw=JSON.stringify({scope:'FORMAL_BUSINESS_PARAMETERS',version:prefix+'_parameters',
  defaultServiceFeeCents:100,depositMinCents:100,depositMaxCents:5000,waitlistMax:4,waitlistExposureCents:50000,
  memberRemovalEvent:null,fifoClock:null,fifoTieBreak:null,refundBatchUtcMinutes:[60],refundDispatchSlaSeconds:300,...parameterOverrides});
 const context={environment:'ISOLATED_TEST',releaseVersion:material.releaseVersion,materialSha256:hash(materialRaw),parameterDigest:hash(parameterRaw),
  policyDigest:hash(JSON.stringify({scope:'FORMAL_RUNTIME_POLICY',materialSha256:hash(materialRaw),parameterDigest:hash(parameterRaw),environment:'ISOLATED_TEST'})),
  channel:'wechat',merchantScope:hash(prefix+'_merchant'),providerConfigId:prefix+'_config'};
 const keys=generateKeyPairSync('ed25519');
 const trust={publicKey:keys.publicKey.export({format:'pem',type:'spki'}).toString(),issuerId:prefix+'_issuer',authoritySha256:'',revokedIds:new Set(),evidence};
 const grant={...context,scope:'FORMAL_ACTION_AUTHORITY',id:prefix+'_grant',issuerId:trust.issuerId,
  issuedAt:new Date(at.getTime()-60000).toISOString(),notBefore:new Date(at.getTime()-60000).toISOString(),expiresAt:new Date(at.getTime()+3600000).toISOString(),
  actions:['POLICY_RUNTIME','SUPPLY_APPROVE','ACTIVITY_PUBLISH','NEW_REGISTRATION','PREPARE_PAYMENT','RECORD_PAYMENT','DECIDE_REFUND','EXECUTE_REFUND','RECOVER_FUNDS','CLOSE_DIFFERENCE'],
  evidence:material.evidence.map(e=>({referenceId:e.referenceId,sha256:e.sha256,responsibility:e.gateId}))};
 const authority=()=>{const raw=JSON.stringify(grant);trust.authoritySha256=hash(raw);return {raw,signature:sign(null,Buffer.from(raw),keys.privateKey).toString('base64'),trust,context};};
 return {material,materialRaw,parameterRaw,context,trust,grant,authority};
}
