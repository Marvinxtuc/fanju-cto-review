import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {readFile,lstat,realpath} from 'node:fs/promises';
import {isAbsolute,resolve,sep} from 'node:path';
import {z} from 'zod';
import {bindingFor} from '../funding/intents.js';
import type {RuntimeAuthoritySource} from './formal-runtime-policy.js';
import type {AuthorityContext} from './formal-action-authority.js';
const contextSchema=z.object({environment:z.literal('PRODUCTION'),releaseVersion:z.string(),materialSha256:z.string(),
 policyDigest:z.string(),parameterDigest:z.string(),channel:z.literal('wechat'),merchantScope:z.string(),providerConfigId:z.string()});
const evidenceSchema=z.record(z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/),z.string().min(1).max(4*1024*1024));
async function externalFile(path:string|undefined,root:string,limit:number){
 if(!path||!isAbsolute(path))throw Error('Explicit external authority file required');
 const actual=await realpath(path),repo=await realpath(root),stat=await lstat(path);
 if(stat.isSymbolicLink()||!stat.isFile()||stat.size>limit||actual===repo||actual.startsWith(repo+sep))throw Error('Authority file boundary invalid');
 return readFile(actual,'utf8');
}
/** Production source is explicitly pinned and reread, including revocations.
 * No signing key is read or produced; this loads a grant from an independent issuer.
 * Isolated tests inject their source only through the guarded application seam. */
export function configuredRuntimeAuthoritySource(env:Record<string,string|undefined>,root=fileURLToPath(new URL('../../../../',import.meta.url))):RuntimeAuthoritySource{
 if(!env.RELEASE_VERSION?.trim())throw Error('Formal authority configuration incomplete');
 const keys=['V11_FORMAL_AUTHORITY_PATH','V11_FORMAL_AUTHORITY_SHA256','V11_FORMAL_AUTHORITY_SIGNATURE',
  'V11_FORMAL_AUTHORITY_PUBLIC_KEY_PATH','V11_FORMAL_AUTHORITY_ISSUER_ID','V11_FORMAL_AUTHORITY_EVIDENCE_PATH','V11_FORMAL_AUTHORITY_REVOCATIONS_PATH'] as const;
 const descriptor=z.object(Object.fromEntries(keys.map(key=>[key,z.string().min(1)]))).strict();
 if(!env.V11_FORMAL_AUTHORITY_REGISTRY_PATH)for(const key of keys)if(!env[key]?.trim())throw Error('Formal authority configuration incomplete');
 return async(policyDigest,action)=>{
  let selected=env;
  if(env.V11_FORMAL_AUTHORITY_REGISTRY_PATH){
   const raw=await externalFile(env.V11_FORMAL_AUTHORITY_REGISTRY_PATH,root,256*1024);
   if(!/^[a-f0-9]{64}$/.test(env.V11_FORMAL_AUTHORITY_REGISTRY_SHA256??'')||createHash('sha256').update(raw).digest('hex')!==env.V11_FORMAL_AUTHORITY_REGISTRY_SHA256)throw Error('Authority registry integrity invalid');
   const registry=z.object({scope:z.literal('FORMAL_AUTHORITY_REGISTRY'),policies:z.record(z.string().regex(/^[a-f0-9]{64}$/),descriptor)}).strict().parse(JSON.parse(raw));
   const entry=registry.policies[policyDigest];if(!entry)throw Error('Historical policy action grant unavailable');
   selected={...env,...entry};
  }
  const raw=await externalFile(selected.V11_FORMAL_AUTHORITY_PATH,root,256*1024);
  let grant:unknown;try{grant=JSON.parse(raw);}catch{throw Error('Formal authority configuration invalid');}
  const parsed=contextSchema.safeParse(grant);if(!parsed.success)throw Error('Production authority context invalid');
  const context:AuthorityContext=parsed.data;const binding=bindingFor(env,'wechat');
  if(context.policyDigest!==policyDigest||(!['DECIDE_REFUND','EXECUTE_REFUND','RECOVER_FUNDS','CLOSE_DIFFERENCE'].includes(action)&&context.releaseVersion!==env.RELEASE_VERSION)
   ||context.channel!==binding.channel||context.merchantScope!==binding.merchantScope||context.providerConfigId!==binding.providerConfigId)
   throw Error('Deployment authority binding invalid');
  const evidenceRaw=await externalFile(selected.V11_FORMAL_AUTHORITY_EVIDENCE_PATH,root,16*1024*1024);
  const revokedRaw=await externalFile(selected.V11_FORMAL_AUTHORITY_REVOCATIONS_PATH,root,64*1024);
  let evidence:unknown,revoked:unknown;try{evidence=JSON.parse(evidenceRaw);revoked=JSON.parse(revokedRaw);}catch{throw Error('Formal authority configuration invalid');}
  const refs=evidenceSchema.parse(evidence),ids=z.array(z.string().regex(/^[A-Za-z0-9_.:-]{1,160}$/)).max(1000).parse(revoked);
  return {raw,signature:selected.V11_FORMAL_AUTHORITY_SIGNATURE!,context,trust:{
   publicKey:await externalFile(selected.V11_FORMAL_AUTHORITY_PUBLIC_KEY_PATH,root,8192),issuerId:selected.V11_FORMAL_AUTHORITY_ISSUER_ID!,
   authoritySha256:selected.V11_FORMAL_AUTHORITY_SHA256!,revokedIds:new Set(ids),evidence:new Map(Object.entries(refs))}};
 };
}
