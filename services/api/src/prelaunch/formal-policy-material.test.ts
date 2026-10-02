import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { inspectFormalPolicyMaterial } from './formal-policy-material.js';
const hash = (text: string) => createHash('sha256').update(text).digest('hex');
function fixture() {
  const attachments = new Map<string,string>();
  const gateIds = ['OP-03','OP-04','OP-05','OP-07','OP-08','OP-09','OP-10','OP-11','OP-12','OP-13','OP-14','OP-15',
    'RV-01','RV-02','RV-03','RV-04','RV-05','RV-06','RV-07'];
  const material = { scope: 'FORMAL_POLICY_RELEASE_MATERIAL', bundleId:'synthetic-material',version:'synthetic-version',
    releaseVersion:'synthetic-release',inheritedBaselineHash:hash('synthetic-baseline'),
    documents:['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY'].map(kind=>{
      const publicText='synthetic test text '+kind;
      const fullText='internal synthetic metadata\n<!-- PUBLIC_POLICY_START -->'+publicText+'<!-- PUBLIC_POLICY_END -->';
      return {kind,documentId:'synthetic-'+kind,version:'synthetic-version',fullText,fullHash:hash(fullText),publicText,publicHash:hash(publicText)};
    }), evidence:gateIds.map(gateId=>{const text='synthetic attachment '+gateId;attachments.set(gateId,text);
      return {gateId,referenceId:gateId,sha256:hash(text),kind:gateId.startsWith('OP-')?'BUSINESS_DECISION':'SPECIALIST_CONCLUSION'};}) };
  const inspect = () => {const raw=JSON.stringify(material);return inspectFormalPolicyMaterial(raw,
    {sha256:hash(raw),releaseVersion:'synthetic-release',inheritedBaselineHash:hash('synthetic-baseline')},attachments);};
  return {material,attachments,inspect};
}
describe('formal material integrity is separate from activation authority',()=>{
  it('projects exact public text and remains unable to grant release or activation',()=>{
    const f=fixture();const result=f.inspect();expect(result).toMatchObject({integrity:'VALID',activation:'NOT_ASSESSED',releaseAuthorized:false,evidenceCount:19});
    expect(result.documents).toHaveLength(3);expect(result.documents[0]).not.toHaveProperty('fullText');
  });
  it.each(['missing-gate','duplicate-gate','wrong-evidence-kind','missing-attachment','changed-attachment','wrong-document-kind','changed-public-text','changed-full-text','public-region','duplicate-region','draft','wrong-release','wrong-baseline','extra-authority'])('rejects incomplete or inconsistent material: %s',kind=>{
    const f=fixture();const m=f.material;
    if(kind==='missing-gate')m.evidence.pop();
    if(kind==='duplicate-gate')m.evidence[1]=m.evidence[0]!;
    if(kind==='wrong-evidence-kind')m.evidence[0]!.kind='SPECIALIST_CONCLUSION';
    if(kind==='missing-attachment')f.attachments.delete('RV-01');
    if(kind==='changed-attachment')f.attachments.set('RV-01','different');
    if(kind==='wrong-document-kind')m.documents[1]!.kind=m.documents[0]!.kind;
    if(kind==='changed-public-text')m.documents[0]!.publicText='changed';
    if(kind==='changed-full-text')m.documents[0]!.fullText+='changed';
    if(['public-region','duplicate-region','draft'].includes(kind)){
      const doc=m.documents[0]!;doc.fullText=kind==='public-region'?doc.fullText.replace(doc.publicText,'another'):kind==='draft'?doc.fullText+'PUBLIC_DRAFT_START':doc.fullText+'<!-- PUBLIC_POLICY_START -->';doc.fullHash=hash(doc.fullText);
    }
    if(kind==='wrong-release')m.releaseVersion='other';
    if(kind==='wrong-baseline')m.inheritedBaselineHash=hash('other');
    if(kind==='extra-authority')Object.assign(m,{activation:'ACTIVE',approved:true});
    expect(f.inspect).toThrow('Formal policy material integrity invalid');
  });
  it('rejects absent pins and raw-byte tampering with fixed errors',()=>{
    const f=fixture();const raw=JSON.stringify(f.material);const pin={sha256:hash(raw),releaseVersion:'synthetic-release',inheritedBaselineHash:hash('synthetic-baseline')};
    expect(()=>inspectFormalPolicyMaterial(raw+' ',pin,f.attachments)).toThrow('Formal policy material integrity invalid');
    expect(()=>inspectFormalPolicyMaterial(raw,{...pin,sha256:''},f.attachments)).toThrow('Formal policy material integrity invalid');
  });
});
