import {describe,it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {configuredRuntimeAuthoritySource} from './formal-authority-source.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
describe('external historical authority registry',()=>{
 it('loads independent historical grants, rereads revocation, and rejects their use for new sales',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'fanju-authority-source-'));try{
   const repo=join(dir,'repo');await mkdir(repo);const policy=hash('synthetic old policy'),raw=JSON.stringify({environment:'PRODUCTION',releaseVersion:'old-synthetic-release',materialSha256:hash('material'),policyDigest:policy,parameterDigest:hash('parameters'),channel:'wechat',merchantScope:hash('synthetic-merchant:synthetic-app'),providerConfigId:'synthetic-config'});
   const entry={V11_FORMAL_AUTHORITY_PATH:join(dir,'grant.json'),V11_FORMAL_AUTHORITY_SHA256:hash(raw),V11_FORMAL_AUTHORITY_SIGNATURE:'synthetic-signature',V11_FORMAL_AUTHORITY_PUBLIC_KEY_PATH:join(dir,'key.pem'),V11_FORMAL_AUTHORITY_ISSUER_ID:'synthetic-issuer',V11_FORMAL_AUTHORITY_EVIDENCE_PATH:join(dir,'evidence.json'),V11_FORMAL_AUTHORITY_REVOCATIONS_PATH:join(dir,'revocations.json')};
   await writeFile(entry.V11_FORMAL_AUTHORITY_PATH,raw);await writeFile(entry.V11_FORMAL_AUTHORITY_PUBLIC_KEY_PATH,'SYNTHETIC public key loader fixture');await writeFile(entry.V11_FORMAL_AUTHORITY_EVIDENCE_PATH,'{}');await writeFile(entry.V11_FORMAL_AUTHORITY_REVOCATIONS_PATH,'[]');
   const registry=JSON.stringify({scope:'FORMAL_AUTHORITY_REGISTRY',policies:{[policy]:entry}}),path=join(dir,'registry.json');await writeFile(path,registry);
   const source=configuredRuntimeAuthoritySource({RELEASE_VERSION:'current-synthetic-release',WECHAT_PAY_MCH_ID:'synthetic-merchant',WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_PAY_CONFIG_VERSION:'synthetic-config',V11_FORMAL_AUTHORITY_REGISTRY_PATH:path,V11_FORMAL_AUTHORITY_REGISTRY_SHA256:hash(registry)},repo);
   expect((await source(policy,'RECOVER_FUNDS')).context.releaseVersion).toBe('old-synthetic-release');await expect(source(policy,'NEW_REGISTRATION')).rejects.toThrow('Deployment authority binding');
   await writeFile(entry.V11_FORMAL_AUTHORITY_REVOCATIONS_PATH,'["synthetic-revoked"]');expect((await source(policy,'EXECUTE_REFUND')).trust.revokedIds.has('synthetic-revoked')).toBe(true);
   await expect(source(hash('unknown policy'),'RECOVER_FUNDS')).rejects.toThrow('Historical policy');await writeFile(path,registry+' ');await expect(source(policy,'RECOVER_FUNDS')).rejects.toThrow('registry integrity');
  }finally{await rm(dir,{recursive:true,force:true});}
 });
});
