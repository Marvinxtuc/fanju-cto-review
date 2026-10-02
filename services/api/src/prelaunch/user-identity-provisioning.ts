import type { FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { requireUser } from '../auth.js';
import { reject, type LocalPrincipal } from './contracts.js';
import { resolveVerifiedIdentity } from './principal.js';

// Explicit onboarding operation, not an implicit GET side effect. No new user or privilege.
export function createProductionUserProvisioner(db: PrismaClient) {
  return async (request: FastifyRequest): Promise<LocalPrincipal> => {
    const session = await requireUser(request).catch((error: unknown) => {
      const status = error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
      if (status === 401 || status === 403) reject(status, status === 401 ? 'SESSION_EXPIRED' : 'FORBIDDEN');
      throw error;
    });
    return db.$transaction(async tx => {
      // All provisioning writers must use this shared transaction lock. Duplicate historical
      // bindings are rejected, not silently merged or re-enabled.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${'v11:user-identity:' + session.sub}))`;
      if (!await tx.user.findUnique({ where: { id: session.sub }, select: { id: true } })) reject(401, 'SESSION_EXPIRED');
      const actors = await tx.v11Actor.findMany({ where: { userId: session.sub, role: 'USER' }, take: 2 });
      if (actors.length > 1) reject(409, 'IDENTITY_BINDING_AMBIGUOUS');
      let actor = actors[0];
      if (!actor) {
        actor = await tx.v11Actor.create({ data: { userId: session.sub, role: 'USER', personId: 'user:' + session.sub,
          restaurantId: null, passwordHash: 'EXTERNAL_SESSION_ONLY' } });
        await tx.auditLog.create({ data: { action: 'identity.v11-user-provisioned', targetType: 'V11Actor', targetId: actor.id,
          metadata: { authentication: 'VERIFIED_USER_SESSION', grants: ['USER'] } } });
      }
      return resolveVerifiedIdentity({ actorId: actor.id, personId: actor.personId, actorVersion: actor.version,
        role: 'USER', userId: session.sub, restaurantId: null }, id => tx.v11Actor.findUnique({ where: { id } }));
    });
  };
}
