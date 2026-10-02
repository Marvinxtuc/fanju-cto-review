import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { extractPolicyPublicBody, verifyPrelaunchPolicyBundle, type PrelaunchDocumentKind } from "@timeleft-shanghai/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { json, object, sha256 } from "./domain.js";
import { reject } from "./contracts.js";

function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`; if (value !== null && typeof value === "object") return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`).join(',')}}`; return JSON.stringify(value); }
export async function importFrozenPolicy(db: PrismaClient, projectRoot: string) {
  const manifest = JSON.parse(await readFile(resolve(projectRoot, 'docs/policy/POLICY_V1_1_BUNDLE_MANIFEST.json'), 'utf8'));
  const index = JSON.parse(await readFile(resolve(projectRoot, 'docs/policy/TRACEABILITY_INDEX.json'), 'utf8'));
  const payload = manifest.bundle_payload;
  for (const entry of payload.documents) {
    if (typeof entry.path !== 'string' || !/^docs\/policy\/(?:[A-Za-z0-9_][A-Za-z0-9_-]*\.(?:md|json|txt)|sources\/[A-Za-z0-9_][A-Za-z0-9_-]*\.(?:md|json|txt))$/.test(entry.path)) reject(409, 'POLICY_SOURCE_INVALID');
    if (sha256(await readFile(resolve(projectRoot, entry.path), 'utf8')) !== entry.sha256) reject(409, 'POLICY_SOURCE_INVALID');
  }
  const documents = await Promise.all((['USER_AGREEMENT', 'PRIVACY_NOTICE', 'REFUND_POLICY'] as const).map(async kind => {
    const entry = payload.documents.find((row: { path: string }) => row.path === `docs/policy/${kind}.md`);
    const sourceText = await readFile(resolve(projectRoot, entry.path), 'utf8');
    const body = extractPolicyPublicBody(sourceText); if (!body.valid) reject(409, 'POLICY_PUBLIC_BODY_INVALID');
    return { kind: kind as PrelaunchDocumentKind, documentId: entry.document_id as string, version: 'V1.1', bundleId: payload.bundle_id as string, sourceText, sourceSha256: entry.sha256 as string, publicBodySha256: sha256(body.text), publicText: body.text };
  }));
  const baseline = index.baseline;
  const check = verifyPrelaunchPolicyBundle({ bundleId: payload.bundle_id, version: payload.bundle_version, status: payload.document_status, manifestPayload: canonical(payload),
    baseline: { documentId: baseline.document_id, text: await readFile(resolve(projectRoot, 'docs/policy/BUSINESS_RULES_BASELINE.md'), 'utf8'), sha256: baseline.sha256 },
    documents: documents.map(({ publicText: _text, ...doc }) => doc), ruleIds: index.rules.map((row: { id: string }) => row.id), openDecisions: index.open_decisions.map((row: { id: string; status: string }) => ({ id: row.id, status: row.status })), specialReviews: index.special_reviews.map((row: { id: string; status: string }) => ({ id: row.id, status: row.status })) }, sha256);
  if (check.integrity !== 'VALID') reject(409, 'POLICY_INTEGRITY_INVALID');
  const stored = await db.v11PolicySnapshot.upsert({ where: { bundleDigest: sha256(canonical(payload)) }, update: {}, create: { bundleVersion: payload.bundle_id, bundleDigest: sha256(canonical(payload)), baselineHash: baseline.sha256, status: 'LOCAL_DRAFT',
    docsJson: json({ scope: 'FROZEN_DRAFT', documents: documents.map(doc => ({ kind: doc.kind, documentId: doc.documentId, version: doc.version, fullText: doc.sourceText, fullHash: doc.sourceSha256, publicHash: doc.publicBodySha256, publicText: doc.publicText })) }),
    blockersJson: json([...index.open_decisions.filter((row: { status: string }) => row.status !== 'CLOSED').map((row: { id: string }) => row.id), ...index.special_reviews.map((row: { id: string }) => row.id)]) } });
  const expectedDocuments = documents.map(doc => ({ kind: doc.kind, documentId: doc.documentId, version: doc.version, fullText: doc.sourceText, fullHash: doc.sourceSha256, publicHash: doc.publicBodySha256, publicText: doc.publicText }));
  if (stored.bundleVersion !== payload.bundle_id || stored.baselineHash !== baseline.sha256 || stored.status !== 'LOCAL_DRAFT'
      || canonical(stored.docsJson) !== canonical({scope:'FROZEN_DRAFT',documents:expectedDocuments})) reject(409,'STORED_POLICY_INTEGRITY_INVALID');
  return stored;
}
export function publicPolicy(row: { id: string; bundleVersion: string; status: string; docsJson: unknown }) {
  const docs = object(row.docsJson).documents;
  if (!Array.isArray(docs) || docs.length !== 3) reject(409,'STORED_POLICY_INTEGRITY_INVALID');
  for (const raw of docs) { const doc = object(raw); if (typeof doc.fullText !== 'string' || typeof doc.publicText !== 'string') reject(409,'STORED_POLICY_INTEGRITY_INVALID'); const body=extractPolicyPublicBody(doc.fullText); if(!body.valid||sha256(doc.fullText)!==doc.fullHash||sha256(doc.publicText)!==doc.publicHash||body.text!==doc.publicText) reject(409,'STORED_POLICY_INTEGRITY_INVALID'); }
  return { policyId: row.id, bundleVersion: row.bundleVersion, status: row.status, activation: 'NOT_ACTIVATABLE', scope: object(row.docsJson).scope,
    documents: Array.isArray(docs) ? docs.map(raw => { const doc = object(raw); return { kind: doc.kind, documentId: doc.documentId, version: doc.version, fullHash: doc.fullHash, publicHash: doc.publicHash, publicText: doc.publicText }; }) : [] };
}
