import { createHash } from 'node:crypto';
const hash=text=>createHash('sha256').update(text).digest('hex');
// Fixed synthetic documents, never a production policy or an approval fixture.
export function syntheticConsentDocuments(){
 return ['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY'].map(kind=>{
  const publicText='\nSynthetic test document '+kind+'\n';
  const fullText='TEST_ONLY\n<!-- PUBLIC_DRAFT_START -->'+publicText+'<!-- PUBLIC_DRAFT_END -->';
  return {kind,documentId:'synthetic-'+kind,version:'synthetic-v1',fullText,publicText,fullHash:hash(fullText),publicHash:hash(publicText)};
 });
}
export function syntheticConsentHashes(){
 const docs=syntheticConsentDocuments();
 return {documentHashesJson:Object.fromEntries(docs.map(d=>[d.documentId,d.fullHash])),publicHashesJson:Object.fromEntries(docs.map(d=>[d.documentId,d.publicHash]))};
}
