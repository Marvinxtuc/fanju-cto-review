import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyFormalActionAuthority, type AuthorityContext, type FormalAuthority } from './formal-action-authority.js';
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
function fixture() {
  const keys = generateKeyPairSync('ed25519');
  const context: AuthorityContext = { environment:'ISOLATED_TEST',releaseVersion:'synthetic-release',
    materialSha256:hash('material'),policyDigest:hash('policy'),parameterDigest:hash('parameters'),
    channel:'wechat',merchantScope:'synthetic-merchant',providerConfigId:'synthetic-config' };
  const attachment = 'Synthetic authority evidence; not a real professional conclusion.';
  const grant: FormalAuthority = { ...context,scope:'FORMAL_ACTION_AUTHORITY',id:'synthetic-grant',issuerId:'synthetic-issuer',
    issuedAt:'2026-10-01T00:00:00Z',notBefore:'2026-10-01T00:00:00Z',expiresAt:'2026-10-02T00:00:00Z',
    actions:['RECOVER_FUNDS'], evidence:[{referenceId:'synthetic-evidence',sha256:hash(attachment),responsibility:'funds-recovery'}] };
  const raw = () => JSON.stringify(grant);
  const trust = { publicKey:keys.publicKey.export({type:'spki',format:'pem'}).toString(),issuerId:grant.issuerId,
    authoritySha256:hash(raw()),revokedIds:new Set<string>(),evidence:new Map([['synthetic-evidence',attachment]]) };
  const check = (ctx=context,now=new Date('2026-10-01T12:00:00Z')) => {
    const body=raw();trust.authoritySha256=hash(body);
    return verifyFormalActionAuthority(body,sign(null,Buffer.from(body),keys.privateKey).toString('base64'),trust,ctx,'RECOVER_FUNDS',now);
  };
  return {grant,context,trust,check,raw,keys};
}
describe('formal action authority provenance and scope',()=>{
  it('permits recovery without implicitly granting new charging or release',()=>{
    const f=fixture();expect(f.check().actions).toEqual(['RECOVER_FUNDS']);
    expect(f.check()).not.toHaveProperty('releaseAuthorized');
    const raw=f.raw();expect(()=>verifyFormalActionAuthority(raw,sign(null,Buffer.from(raw),f.keys.privateKey).toString('base64'),f.trust,f.context,'PREPARE_PAYMENT',new Date('2026-10-01T12:00:00Z'))).toThrow();
  });
  it.each(['CHECKIN_ISSUE','CHECKIN_RECORD'] as const)('does not turn an old financial grant into %s',action=>{
    const f=fixture(),raw=f.raw();expect(()=>verifyFormalActionAuthority(raw,sign(null,Buffer.from(raw),f.keys.privateKey).toString('base64'),f.trust,f.context,action,new Date('2026-10-01T12:00:00Z'))).toThrow();
  });
  it.each(['environment','releaseVersion','materialSha256','policyDigest','parameterDigest','merchantScope','providerConfigId'] as const)('rejects mismatched %s',key=>{
    const f=fixture();expect(()=>f.check({...f.context,[key]:key==='environment'?'PRODUCTION':'other'})).toThrow();
  });
  it('revocation is checked on every invocation',()=>{const f=fixture();f.check();f.trust.revokedIds.add(f.grant.id);expect(()=>f.check()).toThrow();});
  it.each(['2026-09-30T23:59:59Z','2026-10-02T00:00:00Z'])('rejects outside exact validity interval %s',now=>{const f=fixture();expect(()=>f.check(f.context,new Date(now))).toThrow();});
  it('rejects changed attachment and removed evidence',()=>{const f=fixture();f.trust.evidence.set('synthetic-evidence','changed');expect(()=>f.check()).toThrow();f.trust.evidence.clear();expect(()=>f.check()).toThrow();});
  it('rejects forged signatures even with a matching raw hash',()=>{
    const f=fixture();expect(()=>verifyFormalActionAuthority(f.raw(),Buffer.alloc(64).toString('base64'),f.trust,f.context,'RECOVER_FUNDS',new Date('2026-10-01T12:00:00Z'))).toThrow();
  });
  it('rejects blanket approved fields, repeated actions and empty evidence',()=>{
    const f=fixture();Object.assign(f.grant,{approved:true});expect(()=>f.check()).toThrow();
    delete (f.grant as unknown as Record<string,unknown>).approved;
    f.grant.actions.push('RECOVER_FUNDS');expect(()=>f.check()).toThrow();f.grant.actions.pop();f.grant.evidence=[];expect(()=>f.check()).toThrow();
  });
});
