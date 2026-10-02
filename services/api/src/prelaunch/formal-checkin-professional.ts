import {createHash,createPublicKey,verify} from 'node:crypto';
import {lstatSync,readFileSync,realpathSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import {z} from 'zod';
import {formalCanonicalJson} from './formal-json.js';
import {reject} from './contracts.js';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),digest=z.string().regex(/^[a-f0-9]{64}$/);
export const checkinProfessionalRules={scope:'FORMAL_CHECKIN_RULES',firstArrivalFactOnly:true,fulfillmentIndependent:true,businessWindowDefined:false,lateOrPenaltyRuleDefined:false} as const;
const hash=(s:string|Buffer)=>createHash('sha256').update(s).digest('hex');
export const checkinProfessionalRulesDigest=hash(formalCanonicalJson(checkinProfessionalRules));
const schema=z.object({scope:z.literal('FORMAL_CHECKIN_PROFESSIONAL_APPROVAL'),id,professionalId:id,environment:z.enum(['PRODUCTION','ISOLATED_TEST']),
 activityId:id,restaurantId:id,supplyId:id,supplyDigest:digest,policyId:id,policyDigest:digest,rulesDigest:digest,signingKeyId:id,technicalTtlSeconds:z.number().int().min(30).max(600),
 issuedAt:z.string().datetime(),notBefore:z.string().datetime(),expiresAt:z.string().datetime(),professionalConclusion:z.literal('APPROVED_FOR_SPECIFIED_CHECKIN_RULES')}).strict();
export type CheckinProfessionalApproval=z.infer<typeof schema>;
export function loadCheckinProfessionalApproval(env:Record<string,string|undefined>,repoRoot:string){
 function external(name:string,max:number){const path=env[name];if(!path||!isAbsolute(path))throw Error('External professional checkin approval required');const real=realpathSync(path),rel=relative(realpathSync(repoRoot),real),stat=lstatSync(path);
  if(real!==resolve(path)||rel===''||(!rel.startsWith('..')&&!isAbsolute(rel))||!stat.isFile()||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||stat.size>max)throw Error('Invalid external professional checkin evidence');return readFileSync(path,'utf8');}
 return (context:Pick<CheckinProfessionalApproval,'environment'|'activityId'|'restaurantId'|'supplyId'|'supplyDigest'|'policyId'|'policyDigest'|'signingKeyId'|'technicalTtlSeconds'>,now:Date,tokenPublicKeySha256:string)=>{
  try{
   const publicRaw=external('V11_CHECKIN_PROFESSIONAL_PUBLIC_KEY_PATH',16384),key=createPublicKey(publicRaw);
   if(!digest.safeParse(env.V11_CHECKIN_PROFESSIONAL_PUBLIC_KEY_SHA256).success||hash(publicRaw)!==env.V11_CHECKIN_PROFESSIONAL_PUBLIC_KEY_SHA256||key.asymmetricKeyType!=='ed25519'||hash(key.export({format:'der',type:'spki'}))===tokenPublicKeySha256)throw Error('Independent professional trust required');
   const envelope=z.object({raw:z.string().max(65536),signature:z.string().regex(/^[A-Za-z0-9+/]{86}==$/)}).strict().parse(JSON.parse(external('V11_CHECKIN_PROFESSIONAL_APPROVAL_PATH',131072)));
   if(!verify(null,Buffer.from(envelope.raw),key,Buffer.from(envelope.signature,'base64')))throw Error('Professional signature invalid');
   const approval=schema.parse(JSON.parse(envelope.raw));
   if(approval.professionalId!==env.V11_CHECKIN_PROFESSIONAL_ID||approval.rulesDigest!==checkinProfessionalRulesDigest)throw Error('Professional scope invalid');
   for(const k of Object.keys(context) as (keyof typeof context)[])if(approval[k]!==context[k])throw Error('Professional binding invalid');
   const revoked=z.array(id).parse(JSON.parse(external('V11_CHECKIN_PROFESSIONAL_REVOCATIONS_PATH',65536)));
   const start=Date.parse(approval.notBefore),end=Date.parse(approval.expiresAt),issued=Date.parse(approval.issuedAt);
   if(revoked.includes(approval.id)||issued>start||start>=end||issued>now.getTime()||now.getTime()<start||now.getTime()>=end)throw Error('Professional approval unavailable');
   return {approval,digest:hash(envelope.raw)};
  }catch{reject(503,'FORMAL_CHECKIN_PROFESSIONAL_APPROVAL_UNAVAILABLE');}
 };
}
