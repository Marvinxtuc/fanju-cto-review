import { z } from "zod";

export const API_VERSION = "prelaunch-v11-1" as const;
export const SIMULATION_SCOPE = "SIMULATION_ONLY" as const;
export const cents = z.number().int().min(0).max(2_147_483_647);
export const identifier = z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
export const businessKey = z.string().min(1).max(200).regex(/^[A-Za-z0-9_.:-]+$/);
export const pageQuery = z.object({ limit: z.coerce.number().int().min(1).max(50).default(20), cursor: identifier.optional() }).strict();
export const profileInput = z.object({ gender: z.enum(["MALE", "FEMALE"]), timePreferences: z.array(z.string().max(60)).max(20).default([]), adultDeclaration: z.literal(true), serviceCompatible: z.literal(true) }).strict();
export type LocalPrincipal = { id: string; personId: string; role: "USER" | "OPS" | "REVIEWER" | "RESTAURANT"; userId: string | null; restaurantId: string | null; version: number };

export class PrelaunchError extends Error {
  constructor(readonly statusCode: number, readonly code: string, readonly blockerIds: readonly string[] = []) { super(code); }
}
export function reject(statusCode: number, code: string, blockerIds: readonly string[] = []): never { throw new PrelaunchError(statusCode, code, blockerIds); }
export function parse<T extends z.ZodType>(schema: T, value: unknown): z.infer<T> {
  const result = schema.safeParse(value);
  if (!result.success) reject(400, "INVALID_INPUT");
  return result.data;
}
export function errorResponse(error: unknown) {
  if (error instanceof PrelaunchError) return { statusCode: error.statusCode, body: { version: API_VERSION, error: { code: error.code, blockerIds: error.blockerIds } } };
  const code = typeof error === "object" && error !== null && "code" in error ? String(error.code) : "";
  const known: Record<string,number> = { FST_ERR_CTP_INVALID_JSON_BODY:400,FST_ERR_CTP_EMPTY_JSON_BODY:400,FST_ERR_CTP_BODY_TOO_LARGE:413,FST_ERR_CTP_INVALID_MEDIA_TYPE:415,FST_ERR_CTP_INVALID_CONTENT_LENGTH:400 };
  if (known[code]) return { statusCode:known[code]!,body:{version:API_VERSION,error:{code:code==='FST_ERR_CTP_BODY_TOO_LARGE'?'PAYLOAD_TOO_LARGE':code==='FST_ERR_CTP_INVALID_MEDIA_TYPE'?'UNSUPPORTED_MEDIA_TYPE':'INVALID_INPUT',blockerIds:[]}} };
  return { statusCode: 500, body: { version: API_VERSION, error: { code: "INTERNAL_ERROR", blockerIds: [] } } };
}
export function requireRole(actor: LocalPrincipal, ...roles: LocalPrincipal["role"][]) { if (!roles.includes(actor.role)) reject(403, "FORBIDDEN"); }
export function requireOwner(actor: LocalPrincipal, userId: string) { if (actor.role !== "USER" || actor.userId !== userId) reject(404, "RESOURCE_NOT_FOUND"); }
export function assertSimulationEnvironment(env: Record<string, string | undefined>) {
  if (!['local', 'ci'].includes(env.APP_ENV ?? '') || !['development', 'test'].includes(env.NODE_ENV ?? '') || env.PRELAUNCH_MODE !== SIMULATION_SCOPE
    || ['AUTH_PROVIDER', 'PHONE_PROVIDER', 'PAYMENT_PROVIDER', 'REFUND_PROVIDER'].some(key => env[key] !== 'mock')) reject(503, "ISOLATED_MOCK_ENVIRONMENT_REQUIRED");
  if (!env.PRELAUNCH_OWNER_MARKER || !/^[A-Za-z0-9_-]{8,160}$/.test(env.PRELAUNCH_OWNER_MARKER)) reject(503, "OWNERSHIP_MARKER_REQUIRED");
  if (!env.PRELAUNCH_DATABASE_NAME || !/^fanju_prelaunch_[A-Za-z0-9_]+$/.test(env.PRELAUNCH_DATABASE_NAME)) reject(503, "OWNED_DATABASE_REQUIRED");
  if (!env.PRELAUNCH_SESSION_SECRET || env.PRELAUNCH_SESSION_SECRET.length < 32) reject(503, "LOCAL_SESSION_CONFIGURATION_REQUIRED");
}

// This is an engineering test schedule. It never supplies an actual approved batch time.
export function simulationNextDay(at: Date, hour: number) {
  if (!Number.isInteger(hour) || hour < 0 || hour > 23) reject(400, "INVALID_SIMULATION_SCHEDULE");
  const shanghai = new Date(at.getTime() + 8 * 3_600_000);
  return new Date(Date.UTC(shanghai.getUTCFullYear(), shanghai.getUTCMonth(), shanghai.getUTCDate() + 1, hour - 8));
}
