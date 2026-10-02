import { createHash } from 'node:crypto';
import { extractPolicyPublicBody } from '@timeleft-shanghai/shared';

// Exact document-set comparison. This validates captured text identity only;
// it provides neither policy activation nor eligibility/financial authority.
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}
export function matchesConsentDocuments(documents: unknown, fullHashes: unknown, publicHashes: unknown): boolean {
  const full = object(fullHashes); const visible = object(publicHashes);
  if (!Array.isArray(documents) || documents.length !== 3 || !full || !visible
    || Object.keys(full).length !== 3 || Object.keys(visible).length !== 3) return false;
  const ids = new Set<string>(); const kinds = new Set<string>();
  for (const value of documents) {
    const doc = object(value);
    if (!doc || typeof doc.documentId !== 'string' || !doc.documentId || ids.has(doc.documentId)
      || typeof doc.kind !== 'string' || !['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY'].includes(doc.kind) || kinds.has(doc.kind)
      || typeof doc.fullHash !== 'string' || !/^[a-f0-9]{64}$/.test(doc.fullHash)
      || typeof doc.publicHash !== 'string' || !/^[a-f0-9]{64}$/.test(doc.publicHash)
      || !Object.hasOwn(full,doc.documentId) || !Object.hasOwn(visible,doc.documentId)
      || full[doc.documentId] !== doc.fullHash || visible[doc.documentId] !== doc.publicHash) return false;
    ids.add(doc.documentId); kinds.add(doc.kind);
  }
  return true;
}
export function intactDraftConsentDocuments(documents: unknown): boolean {
  if (!Array.isArray(documents) || documents.length !== 3) return false;
  const digest = (text: string) => createHash('sha256').update(text).digest('hex');
  return documents.every(value => {
    const doc = object(value);
    if (!doc || typeof doc.fullText !== 'string' || typeof doc.publicText !== 'string') return false;
    const body = extractPolicyPublicBody(doc.fullText);
    return body.valid && body.text === doc.publicText && digest(doc.fullText) === doc.fullHash && digest(doc.publicText) === doc.publicHash;
  });
}
