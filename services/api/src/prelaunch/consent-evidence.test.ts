import { expect, it } from 'vitest';
import { matchesConsentDocuments } from './consent-evidence.js';
const documents=['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY'].map((kind,i)=>({kind,documentId:'doc-'+i,fullHash:String(i+1).repeat(64),publicHash:String(i+4).repeat(64)}));
const full=Object.fromEntries(documents.map(x=>[x.documentId,x.fullHash]));
const visible=Object.fromEntries(documents.map(x=>[x.documentId,x.publicHash]));
it('requires the exact full/public document set without confusing digest domains',()=>{
 expect(matchesConsentDocuments(documents,full,visible)).toBe(true);
 expect(matchesConsentDocuments([...documents].reverse(),full,visible)).toBe(true);
 for(const [a,b,c] of [[documents,visible,full],[documents,{...full,extra:'a'.repeat(64)},visible],[documents,full,{...visible,extra:'b'.repeat(64)}],[documents.slice(1),full,visible],[[documents[0],documents[0],documents[2]],full,visible],[documents,{},visible],[documents,full,null]])
  expect(matchesConsentDocuments(a,b,c)).toBe(false);
 expect(matchesConsentDocuments(documents.map(x=>({...x,fullHash:'invalid'})),full,visible)).toBe(false);
 const inherited=Object.create(full);expect(matchesConsentDocuments(documents,inherited,visible)).toBe(false);
});
