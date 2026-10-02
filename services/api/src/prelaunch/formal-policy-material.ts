import { createHash } from 'node:crypto';
import { z } from 'zod';

const hash = z.string().regex(/^[a-f0-9]{64}$/);
const id = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
const gates = ['OP-03','OP-04','OP-05','OP-07','OP-08','OP-09','OP-10','OP-11','OP-12','OP-13','OP-14','OP-15',
  'RV-01','RV-02','RV-03','RV-04','RV-05','RV-06','RV-07'] as const;
const documentSchema = z.object({ kind: z.enum(['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY']),
  documentId: id, version: id, fullText: z.string().min(1).max(2_000_000), fullHash: hash,
  publicText: z.string().min(1).max(2_000_000), publicHash: hash }).strict();
const materialSchema = z.object({ scope: z.literal('FORMAL_POLICY_RELEASE_MATERIAL'),
  bundleId: id, version: id, releaseVersion: id, inheritedBaselineHash: hash,
  documents: z.array(documentSchema).length(3),
  evidence: z.array(z.object({ gateId: z.enum(gates), referenceId: id, sha256: hash,
    kind: z.enum(['BUSINESS_DECISION','SPECIALIST_CONCLUSION']) }).strict()).length(19),
}).strict();
const digest = (text: string) => createHash('sha256').update(text).digest('hex');

// Material integrity only. No DB writes, policy activation, professional verdict,
// consent grant or financial authority can be obtained from this result.
export function inspectFormalPolicyMaterial(raw: string,
  pin: { sha256: string; releaseVersion: string; inheritedBaselineHash: string },
  attachments: ReadonlyMap<string, string>) {
  const fail = (): never => { throw Error('Formal policy material integrity invalid'); };
  if (typeof raw !== 'string' || Buffer.byteLength(raw) > 4 * 1024 * 1024
    || !hash.safeParse(pin?.sha256).success || !hash.safeParse(pin?.inheritedBaselineHash).success
    || !id.safeParse(pin?.releaseVersion).success || digest(raw) !== pin.sha256) fail();
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { fail(); }
  const checked = materialSchema.safeParse(parsed); if (!checked.success) fail();
  const material = checked.data!;
  if (material.releaseVersion !== pin.releaseVersion || material.inheritedBaselineHash !== pin.inheritedBaselineHash) fail();
  const kinds = new Set<string>(); const documentIds = new Set<string>();
  const start = '<!-- PUBLIC_POLICY_START -->'; const end = '<!-- PUBLIC_POLICY_END -->';
  for (const doc of material.documents) {
    if (kinds.has(doc.kind) || documentIds.has(doc.documentId) || doc.version !== material.version
      || digest(doc.fullText) !== doc.fullHash || digest(doc.publicText) !== doc.publicHash) fail();
    const from = doc.fullText.indexOf(start); const to = doc.fullText.indexOf(end);
    if (from < 0 || to < from + start.length || doc.fullText.indexOf(start, from + start.length) >= 0
      || doc.fullText.indexOf(end, to + end.length) >= 0 || doc.fullText.slice(from + start.length, to) !== doc.publicText
      || !doc.publicText.trim() || doc.publicText.includes('<!--') || doc.fullText.includes('PUBLIC_DRAFT_START')) fail();
    kinds.add(doc.kind); documentIds.add(doc.documentId);
  }
  const seen = new Set<string>();
  for (const evidence of material.evidence) {
    if (seen.has(evidence.gateId) || evidence.kind !== (evidence.gateId.startsWith('OP-') ? 'BUSINESS_DECISION' : 'SPECIALIST_CONCLUSION')) fail();
    const text = attachments.get(evidence.referenceId);
    if (typeof text !== 'string' || !text.trim() || Buffer.byteLength(text) > 4 * 1024 * 1024 || digest(text) !== evidence.sha256) fail();
    seen.add(evidence.gateId);
  }
  return { integrity: 'VALID' as const, activation: 'NOT_ASSESSED' as const, releaseAuthorized: false as const,
    materialSha256: pin.sha256, bundleId: material.bundleId, version: material.version,
    releaseVersion: material.releaseVersion, evidenceCount: seen.size,
    documents: material.documents.map(({ kind, documentId, version, fullHash, publicHash, publicText }) =>
      ({ kind, documentId, version, fullHash, publicHash, publicText })) };
}
