import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  validatePolicyBundle,
  type PolicyBundleInput,
  type PolicyBundleValidation,
  type PolicyDocumentKind,
  type PolicyIssueCode,
} from "./policyBundle.js";

// Pinned V1.0 historical test data, separate from current policies and runtime configuration.
// No environment, DB or real materials are read; historical OP/RV states grant no activation.
const policyRoot = new URL("./__fixtures__/policy-v1.0/", import.meta.url);
const readPolicy = (name: string) => readFileSync(new URL(name, policyRoot), "utf8");
const digest = (text: string) => createHash("sha256").update(text, "utf8").digest("hex");
const index = JSON.parse(readPolicy("TRACEABILITY_INDEX.json")) as {
  bundle_id: string;
  document_status: string;
  baseline: { document_id: string; sha256: string };
  rules: Array<{ id: string }>;
  open_decisions: Array<{ id: string; status: string }>;
  special_reviews: Array<{ id: string; status: string }>;
};

function control(text: string, key: string): string {
  const value = text.split("\n").find(line => line.startsWith(`| ${key} |`))?.split("|")[2]?.trim();
  if (!value) throw new Error("Policy fixture control field missing");
  return value;
}

const files: PolicyDocumentKind[] = ["USER_AGREEMENT", "PRIVACY_NOTICE", "REFUND_POLICY"];
const fixture: PolicyBundleInput = {
  bundleId: index.bundle_id,
  bundleVersion: "V1.0",
  documentStatus: index.document_status,
  baseline: {
    documentId: index.baseline.document_id,
    sha256: index.baseline.sha256,
    text: readPolicy("BUSINESS_RULES_BASELINE.md"),
  },
  ruleIds: index.rules.map(r => r.id),
  documents: files.map(kind => {
    const text = readPolicy(`${kind}.md`);
    const documentId = control(text, "文档 ID");
    return {
      kind, documentId,
      version: documentId.split("-")[2] ?? "",
      bundleId: control(text, "统一修订包"),
      bundleVersion: "V1.0",
      documentStatus: control(text, "文本状态").replaceAll("**", "").split("：")[0] ?? "",
      sha256: digest(text), text,
    };
  }),
  openDecisions: index.open_decisions.map(({ id, status }) => ({ id, status })),
  specialReviews: index.special_reviews.map(({ id, status }) => ({ id, status })),
};

// Tests mutate cloned DTOs, never historical fixture files or current policy documents.
const candidate = () => structuredClone(fixture);
function rejects(input: unknown, code: PolicyIssueCode): PolicyBundleValidation {
  const result = validatePolicyBundle(input);
  expect(result.integrity).toBe("INVALID");
  expect(result.activation).toBe("NOT_ACTIVATABLE");
  expect(result.issues.some(issue => issue.code === code)).toBe(true);
  return result;
}
function deepFreeze(value: unknown): void {
  if (value === null || typeof value !== "object") return;
  for (const child of Object.values(value)) deepFreeze(child);
  Object.freeze(value);
}

describe("WP10-A pinned local policy bundle validator", () => {
  it("accepts the complete imported bundle as valid integrity, with all 104 rules, 15 OP and 7 RV", () => {
    expect(fixture.ruleIds).toHaveLength(104);
    expect(fixture.openDecisions).toHaveLength(15);
    expect(fixture.specialReviews).toHaveLength(7);
    expect(validatePolicyBundle(candidate())).toEqual({
      integrity: "VALID",
      activation: "NOT_ACTIVATABLE",
      issues: [],
      activationBlockers: [
        "WP10_A_HAS_NO_ACTIVATION_AUTHORITY",
        "PINNED_BUNDLE_IS_REBASED_DRAFT",
        "OPEN_DECISIONS_REMAIN",
        "SPECIAL_REVIEWS_REQUIRED",
      ],
    });
  });

  it.each(files)("rejects a missing user body: %s", kind => {
    const input = candidate();
    rejects({ ...input, documents: input.documents.filter(d => d.kind !== kind) }, "DOCUMENT_MISSING");
  });

  it("rejects a declared body hash inconsistent with its full text", () => {
    const input = candidate();
    const documents = input.documents.map((d, i) => i === 0 ? { ...d, sha256: "0".repeat(64) } : d);
    rejects({ ...input, documents }, "DOCUMENT_HASH_MISMATCH");
    rejects({ ...input, documents }, "CONTENT_HASH_MISMATCH");
  });

  it("rejects changed full text even when the original declared hash is retained", () => {
    const input = candidate();
    const documents = input.documents.map((d, i) => i === 0 ? { ...d, text: d.text + "\nchanged" } : d);
    rejects({ ...input, documents }, "CONTENT_HASH_MISMATCH");
  });

  it("rejects edited text with a newly recomputed candidate hash instead of trusting candidate expectations", () => {
    const input = candidate();
    const documents = input.documents.map((d, i) => {
      if (i !== 0) return d;
      const text = d.text.replace("REBASED_DRAFT", "APPROVED");
      return { ...d, text, sha256: digest(text) };
    });
    rejects({ ...input, documents }, "DOCUMENT_HASH_MISMATCH");
  });

  it("does not normalize full text or line endings before hashing", () => {
    const input = candidate();
    const documents = input.documents.map((d, i) => i === 0 ? { ...d, text: d.text.replaceAll("\n", "\r\n") } : d);
    rejects({ ...input, documents }, "CONTENT_HASH_MISMATCH");
  });

  it("rejects a baseline hash inconsistent with the pinned approved input", () => {
    const input = candidate();
    rejects({ ...input, baseline: { ...input.baseline, sha256: "0".repeat(64) } }, "BASELINE_HASH_MISMATCH");
  });

  it("rejects edited baseline bytes with a candidate-supplied matching hash", () => {
    const input = candidate();
    const text = input.baseline.text + "\nchanged";
    rejects({ ...input, baseline: { ...input.baseline, text, sha256: digest(text) } }, "BASELINE_HASH_MISMATCH");
  });

  it("rejects a mismatched baseline document ID", () => {
    const input = candidate();
    rejects({ ...input, baseline: { ...input.baseline, documentId: "legacy-baseline" } }, "BASELINE_ID_MISMATCH");
  });

  it("rejects a missing Rule ID", () => {
    const input = candidate();
    rejects({ ...input, ruleIds: input.ruleIds.slice(1) }, "RULE_MISSING");
  });

  it("rejects duplicate Rule IDs even with exactly 104 entries", () => {
    const input = candidate();
    rejects({ ...input, ruleIds: [...input.ruleIds.slice(0, -1), "BAS-01"] }, "RULE_DUPLICATE");
    rejects({ ...input, ruleIds: [...input.ruleIds.slice(0, -1), "BAS-01"] }, "RULE_MISSING");
  });

  it("rejects unknown Rule IDs even with exactly 104 entries", () => {
    const input = candidate();
    rejects({ ...input, ruleIds: [...input.ruleIds.slice(0, -1), "UNKNOWN-01"] }, "RULE_UNKNOWN");
  });

  it("accepts reordered complete identities without sorting or changing input", () => {
    const input = candidate();
    expect(validatePolicyBundle({
      ...input,
      ruleIds: [...input.ruleIds].reverse(),
      documents: [...input.documents].reverse(),
      openDecisions: [...input.openDecisions].reverse(),
      specialReviews: [...input.specialReviews].reverse(),
    }).integrity).toBe("VALID");
  });

  it("rejects a missing OP", () => {
    const input = candidate();
    rejects({ ...input, openDecisions: input.openDecisions.slice(1) }, "OP_MISSING");
  });

  it("rejects a missing RV", () => {
    const input = candidate();
    rejects({ ...input, specialReviews: input.specialReviews.slice(1) }, "RV_MISSING");
  });

  it("rejects an OP forged as Approved", () => {
    const input = candidate();
    rejects({ ...input, openDecisions: input.openDecisions.map((d, i) => i === 0 ? { ...d, status: "Approved" } : d) }, "OP_STATUS_MISMATCH");
  });

  it("rejects an RV forged as Approved", () => {
    const input = candidate();
    rejects({ ...input, specialReviews: input.specialReviews.map((d, i) => i === 0 ? { ...d, status: "Approved" } : d) }, "RV_STATUS_MISMATCH");
  });

  it.each(["OP", "RV"] as const)("rejects duplicated and unknown %s identities", domain => {
    const input = candidate();
    if (domain === "OP") {
      rejects({ ...input, openDecisions: [...input.openDecisions, { id: "OP-01", status: "OPEN" }] }, "OP_DUPLICATE");
      rejects({ ...input, openDecisions: [...input.openDecisions.slice(1), { id: "OP-99", status: "OPEN" }] }, "OP_UNKNOWN");
    } else {
      rejects({ ...input, specialReviews: [...input.specialReviews, { id: "RV-01", status: "REVIEW_REQUIRED" }] }, "RV_DUPLICATE");
      rejects({ ...input, specialReviews: [...input.specialReviews.slice(1), { id: "RV-99", status: "REVIEW_REQUIRED" }] }, "RV_UNKNOWN");
    }
  });

  it("rejects a mixed top-level bundle version", () => {
    rejects({ ...candidate(), bundleVersion: "V2.0" }, "BUNDLE_VERSION_MISMATCH");
  });

  it("rejects a mixed top-level bundle ID", () => {
    rejects({ ...candidate(), bundleId: "FJ-POLICY-LEGACY" }, "BUNDLE_ID_MISMATCH");
  });

  it("rejects a user body from a different bundle", () => {
    const input = candidate();
    rejects({ ...input, documents: input.documents.map((d, i) => i === 0 ? { ...d, bundleId: "FJ-POLICY-LEGACY" } : d) }, "BUNDLE_ID_MISMATCH");
  });

  it("rejects a mixed user-body bundle version", () => {
    const input = candidate();
    rejects({ ...input, documents: input.documents.map((d, i) => i === 0 ? { ...d, bundleVersion: "V2.0" } : d) }, "BUNDLE_VERSION_MISMATCH");
  });

  it("rejects a mixed document version", () => {
    const input = candidate();
    rejects({ ...input, documents: input.documents.map((d, i) => i === 0 ? { ...d, version: "V0.9" } : d) }, "DOCUMENT_VERSION_MISMATCH");
  });

  it("rejects a mixed document ID despite correct body bytes", () => {
    const input = candidate();
    rejects({ ...input, documents: input.documents.map((d, i) => i === 0 ? { ...d, documentId: "FJ-UA-20260930-DRAFT-01" } : d) }, "DOCUMENT_ID_MISMATCH");
  });

  it("rejects duplicate and unknown user-body identities", () => {
    const input = candidate();
    rejects({ ...input, documents: [...input.documents, input.documents[0]] }, "DOCUMENT_DUPLICATE");
    rejects({ ...input, documents: [...input.documents, { ...input.documents[0], kind: "SECRET_BODY" }] }, "DOCUMENT_UNKNOWN");
  });

  it("keeps REBASED_DRAFT not activatable even when every text/hash is correct", () => {
    const result = validatePolicyBundle(candidate());
    expect(result.integrity).toBe("VALID");
    expect(result.activation).toBe("NOT_ACTIVATABLE");
    expect(result.activationBlockers).toContain("PINNED_BUNDLE_IS_REBASED_DRAFT");
  });

  it("rejects a forged non-draft bundle status", () => {
    rejects({ ...candidate(), documentStatus: "APPROVED" }, "DOCUMENT_STATUS_MISMATCH");
  });

  it("rejects a forged non-draft body status", () => {
    const input = candidate();
    rejects({ ...input, documents: input.documents.map((d, i) => i === 0 ? { ...d, documentStatus: "APPROVED" } : d) }, "DOCUMENT_STATUS_MISMATCH");
  });

  it("cannot forge approval by passing approved=true or approvalEvidence", () => {
    rejects({ ...candidate(), approved: true }, "UNTRUSTED_APPROVAL");
    rejects({ ...candidate(), approvalEvidence: { status: "PASS", approved: true } }, "UNTRUSTED_APPROVAL");
  });

  it("rejects nested approval claims instead of accepting a new trust source", () => {
    const input = candidate();
    rejects({ ...input, documents: input.documents.map((d, i) => i === 0 ? { ...d, approved: true } : d) }, "UNTRUSTED_APPROVAL");
  });

  it("does not inherit a legacy Gate PASS", () => {
    rejects({ ...candidate(), legacyGate: { status: "PASS" } }, "LEGACY_EVIDENCE_NOT_APPLICABLE");
  });

  it("does not inherit a legacy single AgreementPolicy", () => {
    rejects({ ...candidate(), agreementPolicy: { active: true, textHash: fixture.documents[0]?.sha256 } }, "LEGACY_EVIDENCE_NOT_APPLICABLE");
    rejects({ agreementPolicy: { active: true }, legacyGate: "PASS" }, "LEGACY_EVIDENCE_NOT_APPLICABLE");
  });

  it("does not let candidates supply their own trusted manifest", () => {
    rejects({ ...candidate(), expectedHash: "0".repeat(64), trustedManifest: { approved: true } }, "UNEXPECTED_FIELD");
  });

  it("returns only fixed codes, fields, indexes and pinned missing IDs, never secret or user data", () => {
    const input = candidate();
    const privateValue = "synthetic-private-value-should-never-be-returned";
    const result = validatePolicyBundle({
      ...input, [privateValue]: privateValue,
      ruleIds: [...input.ruleIds.slice(1), privateValue],
      documents: input.documents.map((d, i) => i === 0 ? {
        ...d, documentId: privateValue, sha256: privateValue, text: privateValue,
      } : d),
      approved: privateValue, legacyGate: { status: "PASS", secret: privateValue },
    });
    expect(result.integrity).toBe("INVALID");
    expect(JSON.stringify(result)).not.toContain(privateValue);
    expect(result.issues.every(i => Object.keys(i).every(k => ["code", "field", "index", "expectedId"].includes(k)))).toBe(true);
  });

  it("is deterministic and does not mutate deeply frozen valid input", () => {
    const input = candidate();
    const before = JSON.stringify(input);
    deepFreeze(input);
    expect(validatePolicyBundle(input)).toEqual(validatePolicyBundle(input));
    expect(JSON.stringify(input)).toBe(before);
  });

  it("does not mutate deeply frozen invalid input", () => {
    const input = { ...candidate(), approved: true, ruleIds: ["BAS-01"] };
    const before = JSON.stringify(input);
    deepFreeze(input);
    rejects(input, "RULE_MISSING");
    expect(JSON.stringify(input)).toBe(before);
  });

  it.each([null, undefined, "invalid", 1, [], new Date(0)])("rejects malformed top-level input #%#", input => {
    rejects(input, "INVALID_INPUT");
  });

  it("rejects malformed or oversized collections and invalid text types", () => {
    const input = candidate();
    rejects({ ...input, ruleIds: null, documents: "wrong", openDecisions: [null], specialReviews: [42] }, "INVALID_INPUT");
    rejects({ ...input, ruleIds: Array.from({ length: 209 }, () => "BAS-01") }, "INVALID_INPUT");
    rejects({ ...input, baseline: { ...input.baseline, text: 42 } }, "INVALID_INPUT");
    rejects({ ...input, baseline: { ...input.baseline, text: "x".repeat(1_048_577) } }, "INVALID_INPUT");
  });

  it("rejects candidate getters without invoking them", () => {
    let readCount = 0;
    const input = Object.defineProperty({}, "approved", { enumerable: true, get() { readCount++; return true; } });
    rejects(input, "INVALID_INPUT");
    expect(readCount).toBe(0);
  });

  it.each(["ruleIds", "documents", "openDecisions", "specialReviews"] as const)("rejects %s array index getters without invoking them", field => {
    const input = candidate();
    const values = [...input[field]];
    let readCount = 0;
    Object.defineProperty(values, "0", { enumerable: true, get() { readCount++; return values[1]; } });
    rejects({ ...input, [field]: values }, "INVALID_INPUT");
    expect(readCount).toBe(0);
  });

  it("rejects sparse arrays and non-JSON array properties", () => {
    const input = candidate();
    const sparse = [...input.ruleIds];
    delete sparse[0];
    rejects({ ...input, ruleIds: sparse }, "INVALID_INPUT");
    rejects({ ...input, ruleIds: Object.assign([...input.ruleIds], { approved: true }) }, "INVALID_INPUT");
  });

});
