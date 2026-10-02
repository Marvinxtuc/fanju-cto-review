/// <reference types="node" />
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { extractPolicyPublicBody, PRELAUNCH_POLICY_ID, PRELAUNCH_POLICY_VERSION, validatePolicyAcceptance, verifyPrelaunchPolicyBundle, type PrelaunchDocumentKind, type PrelaunchPolicyInput } from "./prelaunchPolicy.js";
const digest = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const read = (name: string) => readFileSync(new URL(`../../../../docs/policy/${name}`, import.meta.url), "utf8");
function canonical(value: unknown): string { if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`; if (value !== null && typeof value === "object") return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, v]) => `${JSON.stringify(key)}:${canonical(v)}`).join(",")}}`; return JSON.stringify(value); }
function candidate(): PrelaunchPolicyInput {
  const trace = JSON.parse(read("TRACEABILITY_INDEX.json"));
  const manifest = JSON.parse(read("POLICY_V1_1_BUNDLE_MANIFEST.json"));
  const documents = (["USER_AGREEMENT", "PRIVACY_NOTICE", "REFUND_POLICY"] as PrelaunchDocumentKind[]).map(kind => {
    const doc = manifest.bundle_payload.documents.find((d: { path: string }) => d.path === `docs/policy/${kind}.md`);
    const sourceText = read(`${kind}.md`); const body = extractPolicyPublicBody(sourceText); if (!body.valid) throw new Error("Fixture public body invalid");
    return { kind, documentId: doc.document_id, version: "V1.1", bundleId: PRELAUNCH_POLICY_ID, sourceText, sourceSha256: digest(sourceText), publicBodySha256: digest(body.text) };
  });
  return { bundleId: PRELAUNCH_POLICY_ID, version: PRELAUNCH_POLICY_VERSION, status: "REBASED_DRAFT", manifestPayload: canonical(manifest.bundle_payload), baseline: { documentId: "FJ-BUSINESS-BASELINE-20261001-V1.1", text: read("BUSINESS_RULES_BASELINE.md"), sha256: digest(read("BUSINESS_RULES_BASELINE.md")) }, ruleIds: trace.rules.map((r: { id: string }) => r.id), documents, openDecisions: trace.open_decisions.map(({ id, status }: { id: string; status: string }) => ({ id, status })), specialReviews: trace.special_reviews.map(({ id, status }: { id: string; status: string }) => ({ id, status })) };
}
function mutate(change: (value: any) => void) { const value = candidate(); change(value); return value; }
function deepFreeze(value: unknown): void { if (value !== null && typeof value === "object") { Object.freeze(value); for (const v of Object.values(value)) deepFreeze(v); } }
describe("V1.1 integrity, separate from business/legal/release authority", () => {
  it("verifies frozen complete source and exact public bodies, always NOT_ACTIVATABLE", () => {
    const c = candidate(); deepFreeze(c); const before = JSON.stringify(c); const check = verifyPrelaunchPolicyBundle(c, digest);
    expect(check).toEqual({ integrity: "VALID", activation: "NOT_ACTIVATABLE", issues: [] }); expect(JSON.stringify(c)).toBe(before);
  });
  it.each([null, "secret-synthetic", 42, []])("rejects malformed outer input without echoing it", input => expect(verifyPrelaunchPolicyBundle(input, digest)).toEqual({ integrity: "INVALID", activation: "NOT_ACTIVATABLE", issues: ["INVALID_INPUT"] }));
  it.each([
    ["missing body", (c: any) => { c.documents.pop(); }],
    ["duplicate body", (c: any) => { c.documents[1] = c.documents[0]; }],
    ["source tamper", (c: any) => { c.documents[0].sourceText += "tamper"; }],
    ["source hash", (c: any) => { c.documents[0].sourceSha256 = "fake"; }],
    ["public hash", (c: any) => { c.documents[0].publicBodySha256 = c.documents[0].sourceSha256; }],
    ["baseline bytes", (c: any) => { c.baseline.text += "tamper"; }],
    ["baseline ID", (c: any) => { c.baseline.documentId = "old"; }],
    ["baseline digest", (c: any) => { c.baseline.sha256 = "fake"; }],
    ["manifest bytes", (c: any) => { c.manifestPayload += "\n"; }],
    ["missing rule", (c: any) => { c.ruleIds.pop(); }],
    ["duplicate rule", (c: any) => { c.ruleIds[1] = c.ruleIds[0]; }],
    ["unknown rule", (c: any) => { c.ruleIds[1] = "ATTACKER"; }],
    ["missing OP", (c: any) => { c.openDecisions.pop(); }],
    ["duplicate OP", (c: any) => { c.openDecisions[1] = c.openDecisions[0]; }],
    ["missing RV", (c: any) => { c.specialReviews.pop(); }],
    ["duplicate RV", (c: any) => { c.specialReviews[1] = c.specialReviews[0]; }],
    ["OP forged approval", (c: any) => { c.openDecisions[3].status = "APPROVED"; }],
    ["RV forged approval", (c: any) => { c.specialReviews[0].status = "APPROVED"; }],
    ["document version mixing", (c: any) => { c.documents[0].version = "V1.0"; }],
    ["document ID mixing", (c: any) => { c.documents[0].documentId = "FJ-UA-V1.0"; }],
    ["document bundle mixing", (c: any) => { c.documents[0].bundleId = "FJ-POLICY-V1.0"; }],
    ["bundle version mixing", (c: any) => { c.version = "V1.0"; }],
    ["approved true", (c: any) => { c.approved = true; }],
    ["old Gate PASS", (c: any) => { c.gate = "PASS"; }],
    ["old AgreementPolicy", (c: any) => { c.agreementPolicy = "ACTIVE"; }],
    ["pretend activated", (c: any) => { c.status = "ACTIVE"; }],
  ])("rejects %s", (_name, fn) => { const check = verifyPrelaunchPolicyBundle(mutate(fn as (v: any) => void), digest); expect(check.integrity).toBe("INVALID"); expect(check.activation).toBe("NOT_ACTIVATABLE"); });
  it("never returns the candidate body, unknown ID, exception text or fake secret", () => {
    const c = mutate(c => { c.ruleIds[0] = "SYNTHETIC_SECRET_VALUE"; c.documents[0].sourceText = "SYNTHETIC_USER_MATERIAL"; });
    const result = JSON.stringify(verifyPrelaunchPolicyBundle(c, () => { throw Error("SYNTHETIC_SECRET_VALUE"); }));
    expect(result).not.toContain("SYNTHETIC_SECRET_VALUE"); expect(result).not.toContain("SYNTHETIC_USER_MATERIAL");
  });
  it("no Node crypto, DB, environment or fetch dependency is browser-exported", () => {
    const source = readFileSync(new URL("./prelaunchPolicy.ts", import.meta.url), "utf8");
    expect(source).not.toMatch(/from ["']node:|process\.|fetch\(|Date\.now\(|Prisma/);
  });
});
describe("public-body extraction and acceptance evidence", () => {
  it("extracts only literal public slice and retains exact newlines", () => expect(extractPolicyPublicBody("internal\n<!-- PUBLIC_DRAFT_START -->\npublic\n<!-- PUBLIC_DRAFT_END -->\nreview")).toEqual({ valid: true, text: "\npublic\n" }));
  it.each(["no region", "<!-- PUBLIC_DRAFT_START -->body", "<!-- PUBLIC_DRAFT_END --><!-- PUBLIC_DRAFT_START -->body", "<!-- PUBLIC_DRAFT_START --><!-- PUBLIC_DRAFT_START -->body<!-- PUBLIC_DRAFT_END -->", "<!-- PUBLIC_DRAFT_START -->body<!-- PUBLIC_DRAFT_END --><!-- PUBLIC_DRAFT_END -->", "<!-- PUBLIC_DRAFT_START --> <!-- INTERNAL_REVIEW -->body<!-- PUBLIC_DRAFT_END -->", "<!-- PUBLIC_DRAFT_START -->  <!-- PUBLIC_DRAFT_END -->"])("rejects malformed/internal region", source => expect(extractPolicyPublicBody(source).valid).toBe(false));
  it("captured three-text explicit confirmation is draft evidence, never approval", () => {
    const c = candidate(); const acceptance = { bundleId: c.bundleId, bundleVersion: c.version, confirmedAt: 1_790_000_000_000, explicitConfirmation: true, documents: c.documents };
    expect(validatePolicyAcceptance(acceptance)).toEqual({ valid: true, code: "DRAFT_CONFIRMATION_ONLY" });
    expect(validatePolicyAcceptance({ ...acceptance, explicitConfirmation: false }).valid).toBe(false);
    expect(validatePolicyAcceptance({ ...acceptance, documents: acceptance.documents.slice(1) }).valid).toBe(false);
    expect(validatePolicyAcceptance({ ...acceptance, documents: acceptance.documents.map((d, i) => i ? d : { ...d, publicBodySha256: d.sourceSha256 }) }).valid).toBe(false);
  });
});
