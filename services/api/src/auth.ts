import type { FastifyInstance, FastifyRequest } from "fastify";
import fastifyJwt from "@fastify/jwt";
import type { ProviderEnv } from "./providers.js";
import type { PrismaClient } from "./generated/prisma/client.js";
import { parseAdminAccounts, type AdminAccount } from "./admin-auth.js";

export interface AuthTokenPayload {
  sub: string;
  role: "USER" | "OPS" | "SUPER_ADMIN";
  exp: number;
  iat: number;
  aud: string;
  iss: string;
  sessionVersion: string;
  adminRevision?: string;
  accountVersion?: string;
}
interface AuthContext {
  db: PrismaClient;
  demo: boolean;
  issuer: string;
  version: string;
  revoked: Set<string>;
  accounts: AdminAccount[];
}
const contexts = new WeakMap<FastifyInstance, AuthContext>();

export async function registerAuth(app: FastifyInstance, db: PrismaClient, env: ProviderEnv, demo = false): Promise<void> {
  const secret = env.SESSION_SECRET || (demo ? "local-dev-session-secret" : "");
  if (!demo && (secret.trim().length < 32 || /local-dev|change.?me|placeholder/i.test(secret))) {
    throw new Error("Non-demo sessions require an explicit SESSION_SECRET of at least 32 characters");
  }
  const context: AuthContext = {
    db, demo, issuer: `fanju:${env.APP_ENV ?? env.NODE_ENV ?? "local"}`,
    version: env.SESSION_VERSION ?? "1",
    revoked: new Set((env.SESSION_REVOKED_SUBJECTS ?? "").split(",").map(value => value.trim()).filter(Boolean)),
    accounts: parseAdminAccounts(env.OPS_ACCOUNTS_JSON),
  };
  if (demo && context.accounts.length) throw new Error("Demo mode cannot enable controlled admin accounts");
  contexts.set(app, context);
  await app.register(fastifyJwt, { secret, verify: { algorithms: ["HS256"] } });
}

export function sessionContext(app: FastifyInstance): AuthContext {
  const context = contexts.get(app);
  if (!context) throw new Error("Auth not initialized");
  return context;
}

export function signSession(app: FastifyInstance, subject: { sub: string; role: AuthTokenPayload["role"]; adminRevision?: string; accountVersion?: string }): string {
  const context = sessionContext(app);
  return app.jwt.sign({ ...subject, iss: context.issuer, aud: subject.role === "USER" ? "fanju-user" : "fanju-ops", sessionVersion: context.version }, { expiresIn: subject.role === "USER" ? 3600 : 900 });
}

async function verifySession(request: FastifyRequest, audience: string): Promise<AuthTokenPayload> {
  const context = sessionContext(request.server);
  const payload = await request.jwtVerify<AuthTokenPayload>();
  const now = Math.floor(Date.now() / 1000);
  const maxAge = payload.aud === "fanju-user" ? 3600 : 900;
  if (typeof payload.sub !== "string" || !payload.sub || !["fanju-user", "fanju-ops"].includes(payload.aud) || payload.iss !== context.issuer ||
      payload.sessionVersion !== context.version || !Number.isInteger(payload.exp) || !Number.isInteger(payload.iat) ||
      payload.exp <= now || payload.iat > now + 30 || payload.exp - payload.iat > maxAge ||
      context.revoked.has(payload.sub)) throw denied(401, "Session expired or revoked");
  if (payload.aud !== audience) throw denied(403, "Session is not authorized for this endpoint");
  return payload;
}

export async function requireUser(request: FastifyRequest): Promise<AuthTokenPayload> {
  const payload = await verifySession(request, "fanju-user");
  if (payload.role !== "USER") throw denied(403, "User token required");
  const user = await sessionContext(request.server).db.user.findUnique({ where: { id: payload.sub }, select: { id: true, status: true } });
  if (!user) throw denied(401, "Account unavailable");
  // Blacklisting restricts new registration in the order service; it must not hide existing refund rights.
  return payload;
}

export async function requireOps(request: FastifyRequest): Promise<AuthTokenPayload> {
  const context = sessionContext(request.server);
  if (!context.demo && !context.accounts.some(account => account.enabled)) throw denied(403, "Operations authentication unavailable");
  const payload = await verifySession(request, "fanju-ops");
  if (payload.role !== "OPS" && payload.role !== "SUPER_ADMIN") throw denied(403, "Ops token required");
  const admin = await context.db.adminUser.findUnique({ where: { id: payload.sub } });
  if (!admin || admin.role !== payload.role || payload.adminRevision !== admin.updatedAt.toISOString()) throw denied(401, "Admin session revoked");
  if (!context.demo) {
    const account = context.accounts.find(account => account.username === admin.username && account.enabled);
    if (!account || account.role !== admin.role || payload.accountVersion !== account.version) throw denied(401, "Admin account unavailable");
  }
  return payload;
}

export async function requireSuperAdmin(request: FastifyRequest): Promise<AuthTokenPayload> {
  const payload = await requireOps(request);
  if (payload.role !== "SUPER_ADMIN") throw denied(403, "Super admin token required");
  return payload;
}

export function denied(statusCode: number, message: string): Error & { statusCode: number } {
  return Object.assign(new Error(message), { statusCode });
}
