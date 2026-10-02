import {createHash,createPrivateKey,createPublicKey,sign,verify,randomBytes} from 'node:crypto';
import {readFileSync,realpathSync,lstatSync} from 'node:fs';
import {isAbsolute,relative,resolve} from 'node:path';
import {z} from 'zod';
import {formalCanonicalJson} from './formal-json.js';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const digest=z.string().regex(/^[a-f0-9]{64}$/);
export const formalCheckinClaims=z.object({scope:z.literal('FORMAL_CHECKIN'),audience:z.literal('fanju-formal-attendance'),
 environment:z.enum(['PRODUCTION','ISOLATED_TEST']),keyId:id,activityId:id,restaurantId:id,supplyId:id,policyId:id,policyDigest:digest,
 professionalApprovalId:id,professionalApprovalDigest:digest,rulesDigest:digest,issuerActorId:id,issuerPersonId:id,issuerActorVersion:z.number().int().nonnegative(),authorityId:id,
 nonce:z.string().regex(/^[a-f0-9]{32}$/),issuedAt:z.number().int().nonnegative(),expiresAt:z.number().int().positive()}).strict();
export type FormalCheckinClaims=z.infer<typeof formalCheckinClaims>;
export function loadFormalCheckinSigning(env:Record<string,string|undefined>,repoRoot:string){
 const production=env.APP_ENV==='production'&&env.NODE_ENV==='production',isolated=env.APP_ENV==='ci'&&env.NODE_ENV==='test';
 if(!production&&!isolated)throw Error('Explicit formal checkin signing environment required');
 const environment:'PRODUCTION'|'ISOLATED_TEST'=production?'PRODUCTION':'ISOLATED_TEST';
 const keyId=id.parse(env.V11_CHECKIN_SIGNING_KEY_ID);
 const ttl=Number(env.V11_CHECKIN_TOKEN_TTL_SECONDS);
 if(!Number.isSafeInteger(ttl)||ttl<30||ttl>600)throw Error('Explicit checkin technical TTL required (30-600 seconds)');
 function key(){
  const path=env.V11_CHECKIN_PRIVATE_KEY_PATH;
  if(!path||!isAbsolute(path))throw Error('External dedicated checkin signing key required');
  const real=realpathSync(path),rel=relative(realpathSync(repoRoot),real),stat=lstatSync(path);
  if(real!==resolve(path)||rel===''||(!rel.startsWith('..')&&!isAbsolute(rel))||!stat.isFile()||stat.isSymbolicLink()
   ||stat.uid!==process.getuid?.()||(stat.mode&0o077)!==0||stat.size>16384)throw Error('Checkin signing key path/permissions invalid');
  const raw=readFileSync(path);
  if(!digest.safeParse(env.V11_CHECKIN_PRIVATE_KEY_SHA256).success||createHash('sha256').update(raw).digest('hex')!==env.V11_CHECKIN_PRIVATE_KEY_SHA256)
   throw Error('Pinned checkin signing key integrity invalid');
  const parsed=createPrivateKey(raw);if(parsed.asymmetricKeyType!=='ed25519')throw Error('Dedicated Ed25519 checkin signing key required');
  return parsed;
 }
 key(); // Startup fails before exposing an enabled route with unusable signing configuration.
 return {environment,keyId,publicKeySha256:createHash('sha256').update(createPublicKey(key().export({format:'pem',type:'pkcs8'})).export({format:'der',type:'spki'})).digest('hex'),technicalTtlSeconds:ttl,nonce:()=>randomBytes(16).toString('hex'),
  sign(input:FormalCheckinClaims){const claims=formalCheckinClaims.parse(input);
   if(claims.environment!==environment||claims.keyId!==keyId||claims.expiresAt-claims.issuedAt!==ttl*1000)throw Error('Checkin signing claim scope invalid');
   const body=Buffer.from(formalCanonicalJson(claims)).toString('base64url');return `FJCI1.${body}.${sign(null,Buffer.from(body),key()).toString('base64url')}`;
  },
  verify(token:string,now:number){
   if(token.length>5000)throw Error('Invalid formal checkin token');
   const parts=token.split('.');if(parts.length!==3||parts[0]!=='FJCI1'||!parts[1]||!/^[-_A-Za-z0-9]+$/.test(parts[1])||!/^[-_A-Za-z0-9]{86}$/.test(parts[2]!))throw Error('Invalid formal checkin token');
   if(!verify(null,Buffer.from(parts[1]),createPublicKey(key().export({format:'pem',type:'pkcs8'})),Buffer.from(parts[2]!,'base64url')))throw Error('Invalid formal checkin signature');
   const claims=formalCheckinClaims.parse(JSON.parse(Buffer.from(parts[1],'base64url').toString('utf8')));
   if(claims.environment!==environment||claims.keyId!==keyId||claims.issuedAt>now||claims.expiresAt<=now||claims.expiresAt-claims.issuedAt!==ttl*1000)
    throw Error('Formal checkin token scope or technical lifetime invalid');
   return claims;
  }
 };
}
