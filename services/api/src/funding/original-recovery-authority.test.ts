import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { mkdtempSync, writeFileSync, symlinkSync, chmodSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { loadOriginalRecoveryAuthority } from "./original-recovery-authority.js";
import { bindingFor } from "./intents.js";
const hash = (raw: string | Buffer) => createHash("sha256").update(raw).digest("hex");
function fixture() {
  const directory = mkdtempSync("/private/tmp/fanju-synthetic-legacy-authority-");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const key = publicKey.export({ type: "spki", format: "pem" }).toString();
  const config = "WECHAT_PAY_MCH_ID=synthetic-old-merchant\nWECHAT_MINIAPP_APP_ID=synthetic-old-app\nWECHAT_PAY_CONFIG_VERSION=synthetic-old-config\n";
  const envPath = join(directory, "synthetic-config.env"), manifestPath = join(directory, "manifest.json"), keyPath = join(directory, "public.pem"), signaturePath = join(directory, "approval.sig");
  writeFileSync(envPath, config, { mode: 0o600 }); writeFileSync(keyPath, key, { mode: 0o600 });
  const binding = bindingFor({ WECHAT_PAY_MCH_ID: "synthetic-old-merchant", WECHAT_MINIAPP_APP_ID: "synthetic-old-app", WECHAT_PAY_CONFIG_VERSION: "synthetic-old-config" }, "wechat");
  const manifest = { scope: "TEST_ONLY", releaseVersion: "synthetic-release", expiresAt: new Date(Date.now()+3600000).toISOString(),
    target: { reference: "synthetic-target", host: "127.0.0.1", port: 5433, database: "synthetic-db", user: "synthetic-user", systemIdentifier: "123" },
    owner: "synthetic-owner", reviewer: "synthetic-independent", approvalReference: "synthetic-test-approval", configuration: { envPath, envSha256: hash(config),
      merchantScope: binding.merchantScope, providerConfigId: binding.providerConfigId }, grants: [{ kind: "REFUND", id: "synthetic-refund", amountCents: 100, actions: ["QUERY", "SEND"] }] };
  function publish() { const raw = JSON.stringify(manifest); writeFileSync(manifestPath, raw, { mode: 0o600 }); writeFileSync(signaturePath, sign(null, Buffer.from(raw), privateKey), { mode: 0o600 }); return hash(raw); }
  const env = { NODE_ENV: "test", APP_ENV: "ci", RELEASE_VERSION: "synthetic-release", LEGACY_RECOVERY_MANIFEST_PATH: manifestPath, LEGACY_RECOVERY_MANIFEST_SHA256: publish(),
    LEGACY_RECOVERY_APPROVAL_PUBLIC_KEY_PATH: keyPath, LEGACY_RECOVERY_APPROVAL_PUBLIC_KEY_SHA256: hash(key), LEGACY_RECOVERY_SIGNATURE_PATH: signaturePath };
  return { env, manifest, directory, manifestPath, signaturePath, publish, binding, envPath };
}
const root = resolve("../..");
describe("external signed legacy recovery authority", () => {
  it("checks exact amounts/actions/binding and rereads grant revocation", async () => {
    const f = fixture(), authority = loadOriginalRecoveryAuthority(f.env, root);
    const row = { id: "synthetic-refund", amountCents: 100, ...f.binding };
    await expect(authority.authorize("REFUND", row, "SEND")).resolves.toBeUndefined();
    await expect(authority.authorize("REFUND", { ...row, amountCents: 101 }, "SEND")).rejects.toThrow("signed grant");
    await expect(authority.authorize("REFUND", { ...row, providerConfigId: "new-config" }, "SEND")).rejects.toThrow("signed grant");
    writeFileSync(f.manifestPath, JSON.stringify({ ...f.manifest, grants: [] }));
    await expect(authority.authorize("REFUND", row, "SEND")).rejects.toThrow("integrity");
  });
  it("rejects test approval as production even when it has a valid signature", () => {
    const f = fixture();
    expect(() => loadOriginalRecoveryAuthority({ ...f.env, NODE_ENV: "production", APP_ENV: "production" }, root)).toThrow("scope");
  });
  it("rejects changed signature, unfixed manifest hash and wrong approval key", () => {
    const f = fixture(); writeFileSync(f.signaturePath, Buffer.alloc(64));
    expect(() => loadOriginalRecoveryAuthority(f.env, root)).toThrow("signature");
    expect(() => loadOriginalRecoveryAuthority({ ...f.env, LEGACY_RECOVERY_MANIFEST_SHA256: undefined }, root)).toThrow("integrity");
    expect(() => loadOriginalRecoveryAuthority({ ...f.env, LEGACY_RECOVERY_APPROVAL_PUBLIC_KEY_SHA256: "a".repeat(64) }, root)).toThrow("key");
  });
  it("rejects broad permissions, symlinks and excessive files", () => {
    const f = fixture(); chmodSync(f.manifestPath, 0o644);
    expect(() => loadOriginalRecoveryAuthority(f.env, root)).toThrow("permissions");
    chmodSync(f.manifestPath, 0o600); const link = join(f.directory, "link.json"); symlinkSync(f.manifestPath, link);
    expect(() => loadOriginalRecoveryAuthority({ ...f.env, LEGACY_RECOVERY_MANIFEST_PATH: link }, root)).toThrow("symlink");
    writeFileSync(f.envPath, "x".repeat(65537));
    expect(() => loadOriginalRecoveryAuthority(f.env, root)).toThrow("size");
  });
  it("rejects approval author self-review and unsigned configuration mutation", () => {
    const f = fixture(); f.manifest.reviewer = f.manifest.owner; f.env.LEGACY_RECOVERY_MANIFEST_SHA256 = f.publish();
    expect(() => loadOriginalRecoveryAuthority(f.env, root)).toThrow("scope");
    const g = fixture(); writeFileSync(g.envPath, "WECHAT_PAY_MCH_ID=changed\n");
    expect(() => loadOriginalRecoveryAuthority(g.env, root)).toThrow("configuration integrity");
  });
});
