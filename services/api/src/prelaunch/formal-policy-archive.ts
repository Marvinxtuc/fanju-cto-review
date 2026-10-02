import type { PrismaClient, Prisma } from '../generated/prisma/client.js';
import { inspectFormalPolicyMaterial } from './formal-policy-material.js';
import { requireRole, type LocalPrincipal } from './contracts.js';
import { resolveVerifiedIdentity } from './principal.js';

type Pin = Parameters<typeof inspectFormalPolicyMaterial>[1];
async function principal(tx: Prisma.TransactionClient, actor: LocalPrincipal) {
  requireRole(actor,'OPS','REVIEWER');
  await tx.$queryRaw`SELECT id FROM "V11Actor" WHERE id=${actor.id} FOR SHARE`;
  await resolveVerifiedIdentity({actorId:actor.id,personId:actor.personId,role:actor.role,actorVersion:actor.version,
    userId:actor.userId,restaurantId:actor.restaurantId},id=>tx.v11Actor.findUnique({where:{id}}));
}

// Internal archive seam only; caller authenticates a formal session. No upload
// endpoint, runtime policy, consent or financial authority is mounted here.
export function createFormalPolicyArchive(db: PrismaClient) {
  return {
    async archive(raw: string, pin: Pin, attachments: ReadonlyMap<string,string>, actor: LocalPrincipal) {
      const material=inspectFormalPolicyMaterial(raw,pin,attachments);
      return db.$transaction(async tx=>{
        await principal(tx,actor);
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-policy-archive:${pin.sha256}`},0))`;
        const prior=await tx.v11PolicyMaterialArchive.findUnique({where:{materialSha256:pin.sha256}});
        if(prior){
          if(prior.rawMaterial!==raw||prior.bundleId!==material.bundleId||prior.version!==material.version
            ||prior.releaseVersion!==pin.releaseVersion||prior.inheritedBaselineHash!==pin.inheritedBaselineHash||prior.scope!=='MATERIAL_ONLY')
            throw Error('Stored policy material integrity invalid');
          return {archiveId:prior.id,materialSha256:prior.materialSha256,activation:'NOT_ASSESSED' as const,releaseAuthorized:false as const};
        }
        const row=await tx.v11PolicyMaterialArchive.create({data:{materialSha256:pin.sha256,bundleId:material.bundleId,version:material.version,
          releaseVersion:pin.releaseVersion,inheritedBaselineHash:pin.inheritedBaselineHash,rawMaterial:raw,submittedBy:actor.id}});
        await tx.auditLog.create({data:{action:'policy.v11-material-archived',targetType:'V11PolicyMaterialArchive',targetId:row.id,
          metadata:{scope:'MATERIAL_ONLY',materialSha256:pin.sha256,actorId:actor.id,actorVersion:actor.version,actorRole:actor.role}}});
        return {archiveId:row.id,materialSha256:row.materialSha256,activation:'NOT_ASSESSED' as const,releaseAuthorized:false as const};
      });
    },
    async read(archiveId: string, pin: Pin, attachments: ReadonlyMap<string,string>, actor: LocalPrincipal){
      return db.$transaction(async tx=>{
        await principal(tx,actor);
        const row=await tx.v11PolicyMaterialArchive.findUniqueOrThrow({where:{id:archiveId}});
        if(row.scope!=='MATERIAL_ONLY'||row.materialSha256!==pin.sha256||row.releaseVersion!==pin.releaseVersion
          ||row.inheritedBaselineHash!==pin.inheritedBaselineHash)throw Error('Stored policy material integrity invalid');
        const material=inspectFormalPolicyMaterial(row.rawMaterial,pin,attachments);
        if(material.bundleId!==row.bundleId||material.version!==row.version)throw Error('Stored policy material integrity invalid');
        return {archiveId:row.id,...material};
      });
    },
  };
}
