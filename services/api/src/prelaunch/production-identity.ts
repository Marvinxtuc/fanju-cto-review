import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requireUser } from '../auth.js';
import { reject, type LocalPrincipal } from './contracts.js';
import { resolveVerifiedIdentity } from './principal.js';

// Mounted only by a formal app that has registered the existing production JWT verifier.
// Provisioning is separate: missing/ambiguous bindings fail without creating accounts.
export function createProductionUserPrincipal(db: PrismaClient) {
  return async (request: FastifyRequest): Promise<LocalPrincipal> => {
    const session = await requireUser(request).catch((error: unknown) => {
      const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      if (status === 401 || status === 403) reject(status, status === 401 ? 'SESSION_EXPIRED' : 'FORBIDDEN');
      throw error;
    });
    const actors = await db.v11Actor.findMany({ where: { userId: session.sub, role: 'USER' }, take: 2 });
    if (actors.length !== 1) reject(403, 'IDENTITY_BINDING_UNAVAILABLE');
    const actor = actors[0]!;
    return resolveVerifiedIdentity({ actorId: actor.id, personId: actor.personId, role: 'USER',
      actorVersion: actor.version, userId: session.sub, restaurantId: null },
      id => db.v11Actor.findUnique({ where: { id } }));
  };
}
