import { createHmac, scryptSync, timingSafeEqual } from 'node:crypto';
import type { LocalPrincipal } from './contracts.js';
import { reject } from './contracts.js';

export type ActorRecord = Omit<LocalPrincipal, 'role'> & { role: string; enabled: boolean; passwordHash: string };
export type ActorLookup = (id: string) => Promise<ActorRecord | null>;
const roles = new Set(['USER', 'OPS', 'REVIEWER', 'RESTAURANT']);

// Explicit projection prevents credential-bearing DB records from crossing the boundary.
function project(actor: ActorRecord): LocalPrincipal {
  return { id: actor.id, personId: actor.personId, role: actor.role as LocalPrincipal['role'], userId: actor.userId,
    restaurantId: actor.restaurantId, version: actor.version };
}
function active(actor: ActorRecord | null): asserts actor is ActorRecord {
  if (!actor || !actor.enabled || !roles.has(actor.role)) reject(401, 'SESSION_EXPIRED');
}
export function createSimulationIdentity(secret: string, lookup: ActorLookup, now = Date.now) {
  if (secret.length < 32) reject(503, 'LOCAL_SESSION_CONFIGURATION_REQUIRED');
  const sign = (body: string) => createHmac('sha256', secret).update(body).digest('base64url');
  return {
    async login(actorId: string, password: string) {
      const actor = await lookup(actorId); active(actor);
      const parts = actor.passwordHash.split(':');
      if (parts.length !== 3 || parts[0] !== 'scrypt' || !/^[0-9a-f]{32}$/.test(parts[1]!)
          || !/^[0-9a-f]{128}$/.test(parts[2]!)) reject(401, 'SESSION_EXPIRED');
      const digest = scryptSync(password, Buffer.from(parts[1]!, 'hex'), 64);
      if (!timingSafeEqual(digest, Buffer.from(parts[2]!, 'hex'))) reject(401, 'SESSION_EXPIRED');
      const body = Buffer.from(JSON.stringify({ id: actor.id, version: actor.version, exp: now() + 3600_000 })).toString('base64url');
      return { token: body + '.' + sign(body), actor: { id: actor.id, role: actor.role } };
    },
    async authenticate(authorization: string | undefined): Promise<LocalPrincipal> {
      if (!authorization?.startsWith('Bearer ')) reject(401, 'SESSION_EXPIRED');
      const [body, signature, ...extra] = authorization.slice(7).split('.');
      if (!body || !signature || extra.length) reject(401, 'SESSION_EXPIRED');
      const expected = Buffer.from(sign(body)); const actual = Buffer.from(signature);
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) reject(401, 'SESSION_EXPIRED');
      let data: Record<string, unknown>;
      try { const parsed: unknown = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) reject(401, 'SESSION_EXPIRED');
        data = parsed as Record<string, unknown>;
      } catch { reject(401, 'SESSION_EXPIRED'); }
      if (typeof data.exp !== 'number' || !Number.isFinite(data.exp) || data.exp <= now() || typeof data.id !== 'string') reject(401, 'SESSION_EXPIRED');
      const actor = await lookup(data.id); active(actor);
      if (actor.version !== data.version) reject(401, 'SESSION_EXPIRED');
      return project(actor);
    },
  };
}

// Internal adapter input only: callers must verify issuer/audience/expiry/revocation first.
// This resolver never accepts a request body, creates an actor or elevates an OPS session.
export type VerifiedIdentityBinding = {
  actorId: string; personId: string; role: LocalPrincipal['role']; actorVersion: number;
  userId: string | null; restaurantId: string | null;
};
export async function resolveVerifiedIdentity(binding: VerifiedIdentityBinding, lookup: ActorLookup): Promise<LocalPrincipal> {
  const actor = await lookup(binding.actorId); active(actor);
  if (!binding.personId || actor.personId !== binding.personId || actor.role !== binding.role
      || actor.version !== binding.actorVersion || actor.userId !== binding.userId || actor.restaurantId !== binding.restaurantId
      || (actor.role === 'USER' && !actor.userId) || (actor.role === 'RESTAURANT' && !actor.restaurantId)) reject(403, 'IDENTITY_BINDING_MISMATCH');
  return project(actor);
}
