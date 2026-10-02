import { scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { denied, sessionContext, signSession } from "./auth.js";

const derive = promisify(scrypt);
const accountSchema = z.object({
  username: z.string().min(2).max(80),
  role: z.enum(["OPS", "SUPER_ADMIN"]),
  passwordHash: z.string().regex(/^scrypt:[a-f0-9]{32}:[a-f0-9]{128}$/),
  version: z.string().min(1).max(80),
  enabled: z.boolean(),
}).strict();
export type AdminAccount = z.infer<typeof accountSchema>;

export function parseAdminAccounts(value: string | undefined): AdminAccount[] {
  if (!value) return [];
  try {
    const accounts = z.array(accountSchema).max(100).parse(JSON.parse(value));
    if (new Set(accounts.map(account => account.username)).size !== accounts.length) throw new Error();
    return accounts;
  } catch { throw new Error("Invalid controlled admin account configuration"); }
}

export function registerAdminLogin(app: FastifyInstance): void {
  const context = sessionContext(app);
  if (context.demo || !context.accounts.length) return;
  const windows = new Map<string, { attempts: number; until: number }>();
  let pending = 0;
  function rateLimit(key: string): void {
    const now = Date.now();
    for (const [key, window] of windows) if (window.until <= now) windows.delete(key);
    const window = windows.get(key) ?? { attempts: 0, until: now + 15 * 60_000 };
    if (windows.size >= 10000 && !windows.has(key)) throw denied(429, "Login temporarily unavailable");
    window.attempts++;
    windows.set(key, window);
    if (window.attempts > 10) throw denied(429, "Too many login attempts");
  }
  app.post("/api/ops/login", async (request) => {
    // No forwarded-IP trust: ingress must also enforce a shared limit for multiple API replicas.
    rateLimit(`ip:${request.ip}`);
    const parsed = z.object({ username: z.string().min(2).max(80), password: z.string().min(1).max(256) }).strict().safeParse(request.body);
    if (!parsed.success) throw denied(400, "Invalid login request");
    const body = parsed.data;
    rateLimit(`account:${body.username}`);
    if (pending >= 4) throw denied(429, "Login temporarily unavailable");
    pending++;
    const account = context.accounts.find(account => account.username === body.username);
    try {
      const [, salt, digest] = (account?.passwordHash ?? `scrypt:${"0".repeat(32)}:${"0".repeat(128)}`).split(":");
      const actual = await derive(body.password, salt!, 64) as Buffer;
      const valid = timingSafeEqual(actual, Buffer.from(digest!, "hex"));
      if (!valid || !account?.enabled) throw denied(401, "Invalid credentials");
      const admin = await context.db.$transaction(async tx => {
        const result = await tx.adminUser.upsert({ where: { username: account.username }, update: { role: account.role }, create: { username: account.username, role: account.role } });
        await tx.auditLog.create({ data: { actorId: result.id, actorRole: result.role, action: "admin.login", targetType: "AdminUser", targetId: result.id } });
        return result;
      });
      return { token: signSession(app, { sub: admin.id, role: admin.role, adminRevision: admin.updatedAt.toISOString(), accountVersion: account.version }), admin: { id: admin.id, username: admin.username, role: admin.role } };
    } finally { pending--; }
  });
}
