import { scryptSync } from "node:crypto";
import Fastify from "fastify";
import { describe, expect, it, vi } from "vitest";
import { registerAuth, requireUser, requireOps, requireSuperAdmin, signSession } from "./auth.js";
import { parseAdminAccounts, registerAdminLogin } from "./admin-auth.js";
import type { PrismaClient } from "./generated/prisma/client.js";

const secret = "test-session-signing-material-32-bytes";
const salt = "a".repeat(32);
const password = "synthetic-test-password";
const account = { username: "controlled-ops", role: "OPS" as const, version: "v1", enabled: true, passwordHash: `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}` };
async function fixture(overrides: Record<string, string> = {}) {
  const admin = { id: "admin-1", username: account.username, role: "OPS", updatedAt: new Date() };
  const db = { user: { findUnique: vi.fn().mockResolvedValue({ id: "user-1", status: "NORMAL" }) }, adminUser: { findUnique: vi.fn().mockResolvedValue(admin), upsert: vi.fn().mockResolvedValue(admin) }, auditLog: { create: vi.fn() }, $transaction: vi.fn() };
  db.$transaction.mockImplementation((fn) => fn(db));
  const app = Fastify();
  await registerAuth(app, db as unknown as PrismaClient, { APP_ENV: "test", SESSION_SECRET: secret, OPS_ACCOUNTS_JSON: JSON.stringify([account]), ...overrides });
  registerAdminLogin(app);
  app.get("/user", async request => requireUser(request));
  app.get("/ops", async request => requireOps(request));
  app.get("/super", async request => requireSuperAdmin(request));
  return { app, db, admin };
}
const auth = (token: string) => ({ authorization: `Bearer ${token}` });
describe("session and controlled admin authentication", () => {
  it("rejects missing, development and placeholder keys outside demos", async () => {
    for (const key of ["", "local-dev-session-secret", "change-me-".repeat(5)]) {
      const app = Fastify();
      await expect(registerAuth(app, {} as PrismaClient, { SESSION_SECRET: key })).rejects.toThrow("SESSION_SECRET");
      await app.close();
    }
    expect(() => parseAdminAccounts("not-json")).toThrow("configuration");
    expect(() => parseAdminAccounts(JSON.stringify([account, account]))).toThrow("configuration");
  });
  it("rejects old unlimited tokens, expiry, wrong audience and revoked users", async () => {
    const { app } = await fixture({ SESSION_REVOKED_SUBJECTS: "revoked-user" });
    try {
      const now = Math.floor(Date.now() / 1000);
      const tokens = [
        app.jwt.sign({ sub: "user-1", role: "USER" }),
        app.jwt.sign({ sub: "user-1", role: "USER", aud: "fanju-user", iss: "fanju:test", sessionVersion: "1", iat: now - 100, exp: now - 1 }),
        signSession(app, { sub: "revoked-user", role: "USER" }),
        app.jwt.sign({ sub: "user-1", role: "USER", aud: "another-service", iss: "fanju:test", sessionVersion: "1", iat: now, exp: now + 60 }),
      ];
      for (const token of tokens) expect((await app.inject({ url: "/user", headers: auth(token) })).statusCode).toBe(401);
      expect((await app.inject({ url: "/user", headers: auth(signSession(app, { sub: "user-1", role: "USER" })) })).statusCode).toBe(200);
    } finally { await app.close(); }
  });
  it("takes role only from server config and rechecks role, account version and account existence", async () => {
    const { app, db, admin } = await fixture();
    try {
      expect((await app.inject({ method: "POST", url: "/api/ops/login", payload: { username: account.username, password, role: "SUPER_ADMIN" } })).statusCode).toBe(400);
      expect(db.adminUser.upsert).not.toHaveBeenCalled();
      const response = await app.inject({ method: "POST", url: "/api/ops/login", payload: { username: account.username, password } });
      expect(response.statusCode).toBe(200);
      expect(response.json().admin.role).toBe("OPS");
      const headers = auth(response.json().token);
      expect((await app.inject({ url: "/ops", headers })).statusCode).toBe(200);
      expect((await app.inject({ url: "/super", headers })).statusCode).toBe(403);
      admin.role = "SUPER_ADMIN";
      expect((await app.inject({ url: "/ops", headers })).statusCode).toBe(401);
      admin.role = "OPS";
      const old = signSession(app, { sub: admin.id, role: "OPS", adminRevision: admin.updatedAt.toISOString(), accountVersion: "old" });
      expect((await app.inject({ url: "/ops", headers: auth(old) })).statusCode).toBe(401);
      db.adminUser.findUnique.mockResolvedValue(null);
      expect((await app.inject({ url: "/ops", headers })).statusCode).toBe(401);
      expect(db.auditLog.create).toHaveBeenCalledOnce();
    } finally { await app.close(); }
  });
  it("rejects disabled accounts and limits repeated credential attempts", async () => {
    const { app, db } = await fixture({ OPS_ACCOUNTS_JSON: JSON.stringify([{ ...account, enabled: false }]) });
    try {
      const request = { method: "POST" as const, url: "/api/ops/login", payload: { username: account.username, password } };
      for (let i = 0; i < 10; i++) expect((await app.inject(request)).statusCode).toBe(401);
      expect((await app.inject(request)).statusCode).toBe(429);
      expect(db.adminUser.upsert).not.toHaveBeenCalled();
    } finally { await app.close(); }
  });
});
