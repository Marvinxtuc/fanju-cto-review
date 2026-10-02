/** V1.1 draft integrity only. No IO, clock, runtime configuration or activation authority.
 * SHA-256 is supplied by the trusted server adapter; Node crypto is not browser-exported.
 * Full source bytes and the exact public-body slice are different digest domains. */
export const PRELAUNCH_POLICY_ID = "FJ-POLICY-V1.1-20261001-REBASE-01";
export const PRELAUNCH_POLICY_VERSION = "V1.1";
export const PRELAUNCH_POLICY_SOURCE_SHA256 = "1fcd70ea51b9776f819c9c9ada9e1611408a57b79ced56325226f8d5ae58f1a0";
const BASELINE_SHA256 = "38f06f87684d2aee70dd8853391085af22da399cbdd5e2771b26ba54925376ec";
const BASELINE_ID = "FJ-BUSINESS-BASELINE-20261001-V1.1";
export type PrelaunchDocumentKind = "USER_AGREEMENT" | "PRIVACY_NOTICE" | "REFUND_POLICY";
export type Sha256Text = (text: string) => string;
export interface PrelaunchPolicySourceDocument {
  readonly kind: PrelaunchDocumentKind;
  readonly documentId: string;
  readonly version: string;
  readonly bundleId: string;
  readonly sourceText: string;
  readonly sourceSha256: string;
  readonly publicBodySha256: string;
}
export interface PrelaunchPolicyInput {
  readonly bundleId: string;
  readonly version: string;
  readonly status: string;
  /** Exact canonical JSON bytes from bundle_payload, as defined by the frozen manifest. */
  readonly manifestPayload: string;
  readonly baseline: { readonly documentId: string; readonly text: string; readonly sha256: string };
  readonly documents: readonly PrelaunchPolicySourceDocument[];
  readonly ruleIds: readonly string[];
  readonly openDecisions: readonly { readonly id: string; readonly status: string }[];
  readonly specialReviews: readonly { readonly id: string; readonly status: string }[];
}
export interface PrelaunchPolicyCheck {
  readonly integrity: "VALID" | "INVALID";
  readonly activation: "NOT_ACTIVATABLE";
  /** Fixed codes only; never include candidate IDs, text, digest, exceptions or user data. */
  readonly issues: readonly string[];
}
const RULE_IDS: readonly string[] = ["BAS-01", "BAS-02", "BAS-03", "USR-01", "USR-02", "USR-03", "USR-04", "USR-05", "USR-06", "USR-07", "USR-08", "USR-09", "USR-10", "FEE-01", "FEE-02", "FEE-03", "FEE-04", "VEN-01", "VEN-02", "VEN-03", "VEN-04", "VEN-05", "VEN-06", "VEN-07", "VEN-08", "FORM-01", "FORM-02", "FORM-03", "FORM-04", "FORM-05", "FORM-06", "FORM-07", "FORM-08", "FORM-09", "FORM-10", "FORM-11", "FORM-12", "FORM-13", "FORM-14", "FORM-15", "FORM-16", "WL-01", "WL-02", "WL-03", "WL-04", "WL-05", "WL-06", "WL-07", "WL-08", "WL-09", "WL-10", "INFO-01", "INFO-02", "INFO-03", "REF-01", "REF-02", "REF-03", "REF-04", "REF-05", "REF-06", "REF-07", "REF-08", "FUL-01", "FUL-02", "FUL-03", "FUL-04", "FUL-05", "FUL-06", "FUL-07", "FUL-08", "FUL-09", "DISP-01", "DISP-02", "DISP-03", "DISP-04", "DISP-05", "DISP-06", "DISP-07", "DISP-08", "DISP-09", "DISP-10", "DISP-11", "DISP-12", "DISP-13", "DISP-14", "DISP-15", "EXC-01", "EXC-02", "EXC-03", "EXC-04", "CHG-01", "CHG-02", "CHG-03", "CHG-04", "CHG-05", "CHG-06", "CHG-07", "OPS-01", "OPS-02", "OPS-03", "PRI-01", "PRI-02", "PRI-03", "PRI-04"];
const OP_STATUS: Readonly<Record<string, string>> = {"OP-01": "CLOSED", "OP-02": "CLOSED", "OP-03": "PARTIALLY_CLOSED", "OP-04": "PARTIALLY_CLOSED", "OP-05": "PARTIALLY_CLOSED", "OP-06": "CLOSED", "OP-07": "OPEN", "OP-08": "PARTIALLY_CLOSED", "OP-09": "OPEN", "OP-10": "OPEN", "OP-11": "OPEN", "OP-12": "OPEN", "OP-13": "OPEN", "OP-14": "OPEN", "OP-15": "OPEN"};
const DOCUMENTS: Readonly<Record<PrelaunchDocumentKind, { documentId: string; sourceSha256: string; publicBodySha256: string }>> = {"USER_AGREEMENT": {"documentId": "FJ-UA-V1.1-20261001-REBASE-01", "sourceSha256": "68c4823f2650ccd6afb7ad722c9235043c89d965aeadcd8f8218c04e451ddbc2", "publicBodySha256": "ee2e2d1919af59955411b9236e704afa2e15fb6210e21a1f1d046e9230f14f3c"}, "PRIVACY_NOTICE": {"documentId": "FJ-PN-V1.1-20261001-REBASE-01", "sourceSha256": "2d7a4b00404a07fed3b27f2526718224b58c3ec5e4027146ee4e8e8847ec7b40", "publicBodySha256": "165d955b50487fcbe313f25dd4502d021ff8712283bd2c877af3f52f285b2e4a"}, "REFUND_POLICY": {"documentId": "FJ-RF-V1.1-20261001-REBASE-01", "sourceSha256": "c5b1207fde76a3d853df4eaac56b58ca8bdad5e2f20cb3f0d539071b7c4003d7", "publicBodySha256": "846410f75d23dc830583457e0cdbe53e1d4071bcf8791c3e7e353ef595a8b96d"}};

const START = "<!-- PUBLIC_DRAFT_START -->";
const END = "<!-- PUBLIC_DRAFT_END -->";
export function extractPolicyPublicBody(source: string): { valid: true; text: string } | { valid: false; code: "PUBLIC_REGION_INVALID" } {
  const start = source.indexOf(START);
  const end = source.indexOf(END);
  if (start < 0 || end < start + START.length || source.indexOf(START, start + START.length) >= 0 || source.indexOf(END, end + END.length) >= 0) {
    return { valid: false, code: "PUBLIC_REGION_INVALID" };
  }
  const text = source.slice(start + START.length, end);
  // Internal comment regions are never treated as accepted user text.
  if (!text.trim() || text.includes("<!--")) return { valid: false, code: "PUBLIC_REGION_INVALID" };
  return { valid: true, text };
}
function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function hashMatches(text: unknown, expected: string, digest: Sha256Text): boolean {
  if (typeof text !== "string") return false;
  try { return digest(text) === expected; } catch { return false; }
}
function verifyIds(candidate: unknown, expected: readonly string[], status: Readonly<Record<string, string>> | null, code: string, issues: string[]): void {
  if (!Array.isArray(candidate) || candidate.length !== expected.length) { issues.push(code); return; }
  const seen = new Set<string>();
  for (const value of candidate) {
    const id = status ? record(value) ? value.id : null : value;
    if (typeof id !== "string" || !expected.includes(id) || seen.has(id)) { issues.push(code); return; }
    seen.add(id);
    if (status && (!record(value) || value.status !== status[id])) { issues.push(code); return; }
  }
}
export function verifyPrelaunchPolicyBundle(input: unknown, digest: Sha256Text): PrelaunchPolicyCheck {
  const issues: string[] = [];
  if (!record(input)) return { integrity: "INVALID", activation: "NOT_ACTIVATABLE", issues: ["INVALID_INPUT"] };
  const allowed = ["bundleId", "version", "status", "manifestPayload", "baseline", "documents", "ruleIds", "openDecisions", "specialReviews"];
  if (Object.keys(input).some(key => !allowed.includes(key))) issues.push("UNTRUSTED_EXTRA_EVIDENCE");
  if (input.bundleId !== PRELAUNCH_POLICY_ID || input.version !== PRELAUNCH_POLICY_VERSION || input.status !== "REBASED_DRAFT") issues.push("BUNDLE_IDENTITY_INVALID");
  if (!hashMatches(input.manifestPayload, PRELAUNCH_POLICY_SOURCE_SHA256, digest)) issues.push("MANIFEST_HASH_INVALID");
  const baseline = input.baseline;
  if (!record(baseline) || baseline.documentId !== BASELINE_ID || baseline.sha256 !== BASELINE_SHA256 || !hashMatches(baseline.text, BASELINE_SHA256, digest)) issues.push("BASELINE_INVALID");
  verifyIds(input.ruleIds, RULE_IDS, null, "RULE_SET_INVALID", issues);
  verifyIds(input.openDecisions, Object.keys(OP_STATUS), OP_STATUS, "OP_SET_INVALID", issues);
  const reviews = Object.fromEntries(Array.from({ length: 7 }, (_, i) => [`RV-${String(i + 1).padStart(2, "0")}`, "REVIEW_REQUIRED"]));
  verifyIds(input.specialReviews, Object.keys(reviews), reviews, "RV_SET_INVALID", issues);
  const documents = input.documents;
  if (!Array.isArray(documents) || documents.length !== 3) issues.push("DOCUMENT_SET_INVALID");
  else {
    const seen = new Set<string>();
    for (const doc of documents) {
      if (!record(doc) || typeof doc.kind !== "string" || !Object.hasOwn(DOCUMENTS, doc.kind) || seen.has(doc.kind)) { issues.push("DOCUMENT_SET_INVALID"); continue; }
      seen.add(doc.kind);
      const expected = DOCUMENTS[doc.kind as PrelaunchDocumentKind];
      if (doc.documentId !== expected.documentId || doc.version !== PRELAUNCH_POLICY_VERSION || doc.bundleId !== PRELAUNCH_POLICY_ID) issues.push("DOCUMENT_IDENTITY_INVALID");
      if (doc.sourceSha256 !== expected.sourceSha256 || !hashMatches(doc.sourceText, expected.sourceSha256, digest)) issues.push("DOCUMENT_SOURCE_INVALID");
      if (typeof doc.sourceText !== "string") { issues.push("PUBLIC_BODY_INVALID"); continue; }
      const body = extractPolicyPublicBody(doc.sourceText);
      if (!body.valid || doc.publicBodySha256 !== expected.publicBodySha256 || !hashMatches(body.text, expected.publicBodySha256, digest)) issues.push("PUBLIC_BODY_INVALID");
    }
  }
  return { integrity: issues.length ? "INVALID" : "VALID", activation: "NOT_ACTIVATABLE", issues: [...new Set(issues)] };
}
export interface PrelaunchPolicyAcceptance {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly confirmedAt: number;
  readonly explicitConfirmation: boolean;
  readonly documents: readonly { readonly kind: PrelaunchDocumentKind; readonly documentId: string; readonly sourceSha256: string; readonly publicBodySha256: string }[];
}
/** Integrity of a captured confirmation; never a policy activation or identity proof. */
export function validatePolicyAcceptance(input: PrelaunchPolicyAcceptance): { valid: boolean; code: string } {
  if (input.bundleId !== PRELAUNCH_POLICY_ID || input.bundleVersion !== PRELAUNCH_POLICY_VERSION || !Number.isSafeInteger(input.confirmedAt) || input.confirmedAt < 0 || input.explicitConfirmation !== true || input.documents.length !== 3) return { valid: false, code: "ACCEPTANCE_INVALID" };
  const seen = new Set<string>();
  for (const doc of input.documents) {
    const expected = DOCUMENTS[doc.kind];
    if (!expected || seen.has(doc.kind) || doc.documentId !== expected.documentId || doc.sourceSha256 !== expected.sourceSha256 || doc.publicBodySha256 !== expected.publicBodySha256) return { valid: false, code: "ACCEPTANCE_INVALID" };
    seen.add(doc.kind);
  }
  return { valid: true, code: "DRAFT_CONFIRMATION_ONLY" };
}
