/// <reference types="node" />
import { createHash } from "node:crypto";

/** Local, synchronous validation of the pinned WP10-A draft. No activation authority. */
export interface PolicyBundleInput {
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly documentStatus: string;
  readonly baseline: {
    readonly documentId: string;
    readonly sha256: string;
    readonly text: string;
  };
  readonly ruleIds: readonly string[];
  readonly documents: readonly PolicyBundleDocument[];
  readonly openDecisions: readonly PolicyDecisionRecord[];
  readonly specialReviews: readonly PolicyDecisionRecord[];
}

export type PolicyDocumentKind =
  | "USER_AGREEMENT"
  | "PRIVACY_NOTICE"
  | "REFUND_POLICY";

export interface PolicyBundleDocument {
  readonly kind: PolicyDocumentKind;
  readonly documentId: string;
  readonly version: string;
  readonly bundleId: string;
  readonly bundleVersion: string;
  readonly documentStatus: string;
  /** SHA-256 of the entire imported Markdown, including its control section. */
  readonly sha256: string;
  /** Exact UTF-8 text; do not trim or normalize line endings. */
  readonly text: string;
}

export interface PolicyDecisionRecord {
  readonly id: string;
  readonly status: string;
}

export type PolicyIssueCode =
  | "INVALID_INPUT"
  | "UNEXPECTED_FIELD"
  | "UNTRUSTED_APPROVAL"
  | "LEGACY_EVIDENCE_NOT_APPLICABLE"
  | "BUNDLE_ID_MISMATCH"
  | "BUNDLE_VERSION_MISMATCH"
  | "DOCUMENT_STATUS_MISMATCH"
  | "BASELINE_ID_MISMATCH"
  | "BASELINE_HASH_MISMATCH"
  | "CONTENT_HASH_MISMATCH"
  | "DOCUMENT_MISSING"
  | "DOCUMENT_DUPLICATE"
  | "DOCUMENT_UNKNOWN"
  | "DOCUMENT_ID_MISMATCH"
  | "DOCUMENT_VERSION_MISMATCH"
  | "DOCUMENT_HASH_MISMATCH"
  | "RULE_MISSING"
  | "RULE_DUPLICATE"
  | "RULE_UNKNOWN"
  | "OP_MISSING"
  | "OP_DUPLICATE"
  | "OP_UNKNOWN"
  | "OP_STATUS_MISMATCH"
  | "RV_MISSING"
  | "RV_DUPLICATE"
  | "RV_UNKNOWN"
  | "RV_STATUS_MISMATCH";

export type PolicyIssueField =
  | "bundle"
  | "baseline"
  | "ruleIds"
  | "documents"
  | "openDecisions"
  | "specialReviews";

export interface PolicyBundleIssue {
  readonly code: PolicyIssueCode;
  readonly field: PolicyIssueField;
  /** Array index only; never an untrusted ID, body, hash or approval payload. */
  readonly index?: number;
  /** Present only for a missing ID from the module's pinned allowlist. */
  readonly expectedId?: string;
}

export interface PolicyBundleValidation {
  readonly integrity: "VALID" | "INVALID";
  readonly activation: "NOT_ACTIVATABLE";
  readonly issues: readonly PolicyBundleIssue[];
  readonly activationBlockers: readonly [
    "WP10_A_HAS_NO_ACTIVATION_AUTHORITY",
    "PINNED_BUNDLE_IS_REBASED_DRAFT",
    "OPEN_DECISIONS_REMAIN",
    "SPECIAL_REVIEWS_REQUIRED",
  ];
}

// These are approved analysis inputs, not approval to publish or activate policies.
// Private constants prevent candidates from supplying their own trusted manifest.
const BUNDLE_ID = "FJ-POLICY-V1.0-20260930-REBASE-01";
const VERSION = "V1.0";
const STATUS = "REBASED_DRAFT";
const BASELINE_ID = "FJ-BUSINESS-BASELINE-20260930-V1.0";
const BASELINE_HASH = "48357a92e9d84e816f84948149363834746c3cfd9d1936df228c7ae280f0c187";

const DOCUMENTS = Object.freeze([
  Object.freeze({
    kind: "USER_AGREEMENT",
    id: "FJ-UA-V1.0-20260930-REBASE-01",
    hash: "daa90ce2e21e5b421c7b1a5303fe5a2a0b7e0245e131d0d748ac990b9b935599",
  }),
  Object.freeze({
    kind: "PRIVACY_NOTICE",
    id: "FJ-PN-V1.0-20260930-REBASE-01",
    hash: "ecf1a9ffbe7a54b71c9291cacb36d12e0d6b47657cf6b9386789c9b1cb5fe912",
  }),
  Object.freeze({
    kind: "REFUND_POLICY",
    id: "FJ-RF-V1.0-20260930-REBASE-01",
    hash: "4fddec3eb1a3a74f1de94d49385ef8d1c5f1ea16c7f14293b5526fa1daf8e93e",
  }),
] as const);

function numberedIds(prefix: string, count: number): string[] {
  return Array.from({ length: count }, (_, i) => `${prefix}-${String(i + 1).padStart(2, "0")}`);
}

const RULE_IDS = Object.freeze([
  ...numberedIds("BAS", 3), ...numberedIds("USR", 10),
  ...numberedIds("FEE", 4), ...numberedIds("VEN", 8),
  ...numberedIds("FORM", 16), ...numberedIds("WL", 10),
  ...numberedIds("INFO", 3), ...numberedIds("REF", 8),
  ...numberedIds("FUL", 9), ...numberedIds("DISP", 15),
  ...numberedIds("EXC", 4), ...numberedIds("CHG", 7),
  ...numberedIds("OPS", 3), ...numberedIds("PRI", 4),
]);
const OP_IDS = Object.freeze(numberedIds("OP", 15));
const RV_IDS = Object.freeze(numberedIds("RV", 7));

type DataRecord = Record<string, unknown>;

function record(value: unknown): DataRecord | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return undefined;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return undefined;
  // Only passive data records: reading candidate getters could run unrelated code.
  if (Object.values(Object.getOwnPropertyDescriptors(value)).some(d => !("value" in d))) return undefined;
  return value as DataRecord;
}

function dataArray(value: unknown, maxLength: number): readonly unknown[] | undefined {
  if (!Array.isArray(value) || value.length > maxLength) return undefined;
  if (Object.getPrototypeOf(value) !== Array.prototype || Object.getOwnPropertySymbols(value).length) return undefined;
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Object.keys(descriptors).length !== value.length + 1) return undefined;
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!("value" in descriptor)) return undefined;
    if (key !== "length") {
      const index = Number(key);
      if (!Number.isInteger(index) || index < 0 || index >= value.length || String(index) !== key) return undefined;
    }
  }
  return value;
}

/**
 * Accept a passive JSON-shaped DTO, not live objects/Proxies. Hashes are recomputed
 * in memory using Node's built-in crypto; no file, clock, environment or network IO.
 * Valid integrity describes this exact imported draft only. Every result remains
 * NOT_ACTIVATABLE, including fabricated "approved" and legacy Gate PASS claims.
 */
export function validatePolicyBundle(input: unknown): PolicyBundleValidation {
  const issues: PolicyBundleIssue[] = [];
  const add = (code: PolicyIssueCode, field: PolicyIssueField, index?: number, expectedId?: string) => {
    issues.push({
      code, field,
      ...(index === undefined ? {} : { index }),
      ...(expectedId === undefined ? {} : { expectedId }),
    });
  };
  const finish = (): PolicyBundleValidation => ({
    integrity: issues.length === 0 ? "VALID" : "INVALID",
    activation: "NOT_ACTIVATABLE",
    issues,
    activationBlockers: [
      "WP10_A_HAS_NO_ACTIVATION_AUTHORITY",
      "PINNED_BUNDLE_IS_REBASED_DRAFT",
      "OPEN_DECISIONS_REMAIN",
      "SPECIAL_REVIEWS_REQUIRED",
    ],
  });

  const checkKeys = (value: DataRecord, allowed: readonly string[], field: PolicyIssueField, index?: number) => {
    let unexpected = false;
    for (const key of Object.keys(value)) {
      if (allowed.includes(key)) continue;
      if (key === "approved" || key === "approval" || key === "approvalEvidence") {
        add("UNTRUSTED_APPROVAL", field, index);
      } else if (["legacyGate", "gate", "gateStatus", "oldGate", "agreementPolicy", "AgreementPolicy"].includes(key)) {
        add("LEGACY_EVIDENCE_NOT_APPLICABLE", field, index);
      } else {
        unexpected = true;
      }
    }
    if (unexpected) add("UNEXPECTED_FIELD", field, index);
  };

  const checkText = (value: DataRecord, expectedHash: string, field: PolicyIssueField, index?: number) => {
    if (typeof value.text !== "string") {
      add("INVALID_INPUT", field, index);
      return;
    }
    // Bound untrusted input before hashing; no arbitrary-size material processing.
    if (value.text.length > 1_048_576) {
      add("INVALID_INPUT", field, index);
      return;
    }
    const actual = createHash("sha256").update(value.text, "utf8").digest("hex");
    if (actual !== expectedHash || actual !== value.sha256) add("CONTENT_HASH_MISMATCH", field, index);
  };

  const bundle = record(input);
  if (!bundle) {
    add("INVALID_INPUT", "bundle");
    return finish();
  }
  checkKeys(bundle, ["bundleId", "bundleVersion", "documentStatus", "baseline", "ruleIds", "documents", "openDecisions", "specialReviews"], "bundle");
  if (bundle.bundleId !== BUNDLE_ID) add("BUNDLE_ID_MISMATCH", "bundle");
  if (bundle.bundleVersion !== VERSION) add("BUNDLE_VERSION_MISMATCH", "bundle");
  if (bundle.documentStatus !== STATUS) add("DOCUMENT_STATUS_MISMATCH", "bundle");

  const baseline = record(bundle.baseline);
  if (!baseline) {
    add("INVALID_INPUT", "baseline");
  } else {
    checkKeys(baseline, ["documentId", "sha256", "text"], "baseline");
    if (baseline.documentId !== BASELINE_ID) add("BASELINE_ID_MISMATCH", "baseline");
    if (baseline.sha256 !== BASELINE_HASH) add("BASELINE_HASH_MISMATCH", "baseline");
    checkText(baseline, BASELINE_HASH, "baseline");
  }

  const checkIds = (
    values: unknown,
    expectedIds: readonly string[],
    field: "ruleIds" | "openDecisions" | "specialReviews",
    codes: { missing: PolicyIssueCode; duplicate: PolicyIssueCode; unknown: PolicyIssueCode; status?: PolicyIssueCode },
    expectedStatus?: string,
  ) => {
    const items = dataArray(values, 208);
    if (!items) {
      add("INVALID_INPUT", field);
      return;
    }
    const seen = new Set<string>();
    const expected = new Set(expectedIds);
    for (let index = 0; index < items.length; index++) {
      const entry = expectedStatus === undefined ? undefined : record(items[index]);
      if (expectedStatus !== undefined && !entry) {
        add("INVALID_INPUT", field, index);
        continue;
      }
      if (entry) checkKeys(entry, ["id", "status"], field, index);
      const id: unknown = entry ? entry.id : items[index];
      if (typeof id !== "string" || !expected.has(id)) {
        add(codes.unknown, field, index);
        continue;
      }
      if (seen.has(id)) add(codes.duplicate, field, index);
      seen.add(id);
      if (entry && entry.status !== expectedStatus && codes.status) add(codes.status, field, index);
    }
    for (const id of expectedIds) {
      if (!seen.has(id)) add(codes.missing, field, undefined, id);
    }
  };

  checkIds(bundle.ruleIds, RULE_IDS, "ruleIds",
    { missing: "RULE_MISSING", duplicate: "RULE_DUPLICATE", unknown: "RULE_UNKNOWN" });
  checkIds(bundle.openDecisions, OP_IDS, "openDecisions",
    { missing: "OP_MISSING", duplicate: "OP_DUPLICATE", unknown: "OP_UNKNOWN", status: "OP_STATUS_MISMATCH" }, "OPEN");
  checkIds(bundle.specialReviews, RV_IDS, "specialReviews",
    { missing: "RV_MISSING", duplicate: "RV_DUPLICATE", unknown: "RV_UNKNOWN", status: "RV_STATUS_MISMATCH" }, "REVIEW_REQUIRED");

  const documents = dataArray(bundle.documents, 6);
  if (!documents) {
    add("INVALID_INPUT", "documents");
  } else {
    const seen = new Set<string>();
    for (let index = 0; index < documents.length; index++) {
      const document = record(documents[index]);
      if (!document) {
        add("INVALID_INPUT", "documents", index);
        continue;
      }
      checkKeys(document, ["kind", "documentId", "version", "bundleId", "bundleVersion", "documentStatus", "sha256", "text"], "documents", index);
      const expected = DOCUMENTS.find(d => d.kind === document.kind);
      if (!expected) {
        add("DOCUMENT_UNKNOWN", "documents", index);
        continue;
      }
      if (seen.has(expected.kind)) add("DOCUMENT_DUPLICATE", "documents", index);
      seen.add(expected.kind);
      if (document.documentId !== expected.id) add("DOCUMENT_ID_MISMATCH", "documents", index);
      if (document.version !== VERSION) add("DOCUMENT_VERSION_MISMATCH", "documents", index);
      if (document.bundleId !== BUNDLE_ID) add("BUNDLE_ID_MISMATCH", "documents", index);
      if (document.bundleVersion !== VERSION) add("BUNDLE_VERSION_MISMATCH", "documents", index);
      if (document.documentStatus !== STATUS) add("DOCUMENT_STATUS_MISMATCH", "documents", index);
      if (document.sha256 !== expected.hash) add("DOCUMENT_HASH_MISMATCH", "documents", index);
      checkText(document, expected.hash, "documents", index);
    }
    for (const expected of DOCUMENTS) {
      if (!seen.has(expected.kind)) add("DOCUMENT_MISSING", "documents", undefined, expected.kind);
    }
  }
  return finish();
}
