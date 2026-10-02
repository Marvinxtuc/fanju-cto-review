import { randomUUID } from "node:crypto";
import { Prisma, type PrismaClient, type DurableJob } from "../generated/prisma/client.js";

export type Transaction = Prisma.TransactionClient;
export type Lease = DurableJob & { leaseOwner: string; leaseUntil: Date };
export type ChannelJobScope = { channel: string; merchantScope: string; providerConfigId: string; refIds?: string[]; scopedKinds?: string[] };
const LEASE_MS = 30_000;
const MAX_ATTEMPTS = 8;

export async function enqueue(tx: Transaction, kind: string, businessKey: string, refId: string, runAt?: Date) {
  await tx.$executeRaw`
    INSERT INTO "DurableJob" ("id", "kind", "businessKey", "refId", "runAt", "updatedAt")
    VALUES (${randomUUID()}, ${kind}, ${businessKey}, ${refId}, COALESCE(${runAt ?? null}::timestamp, clock_timestamp()), clock_timestamp())
    ON CONFLICT ("businessKey") DO NOTHING`;
  const job = await tx.durableJob.findUniqueOrThrow({ where: { businessKey } });
  if (job.kind !== kind || job.refId !== refId) throw new Error("Job business identity conflict");
  return job;
}

export async function openCase(tx: Transaction, category: string, sourceRef: string, owner: string) {
  return tx.financialCase.upsert({
    where: { caseKey: `${category}:${sourceRef}` }, update: {},
    create: { caseKey: `${category}:${sourceRef}`, category, sourceRef, owner,
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000) },
  });
}

// Claiming and fencing use the database clock; a worker's local clock never extends a lease.
export async function claimJob(db: PrismaClient, owner: string, kinds?: string[], channelScope?: ChannelJobScope): Promise<Lease | null> {
  if (!owner.trim()) throw new Error("Worker owner required");
  if (channelScope && (!((channelScope.channel === 'wechat' && /^[a-f0-9]{64}$/.test(channelScope.merchantScope))
      || (channelScope.channel === 'mock' && channelScope.merchantScope === 'mock-local' && channelScope.providerConfigId === 'mock-v1'))
    || !channelScope.providerConfigId.trim() || channelScope.providerConfigId.length > 160 || !kinds?.length
    || (channelScope.scopedKinds ?? kinds).some(kind => !['V11_CLOSE_EXPIRED_PAYMENT','V11_QUERY_PAYMENT','V11_QUERY_REFUND','V11_WECHAT_REFUND','V11_FORMAL_LIFECYCLE','RECOVER_PAYMENT','RECOVER_REFUND'].includes(kind))
    || (channelScope.scopedKinds && (!channelScope.scopedKinds.length || channelScope.scopedKinds.some(kind => !kinds.includes(kind))))
    || (channelScope.refIds && (!channelScope.refIds.length || channelScope.refIds.some(id => !id.trim())))))
    throw new Error('Explicit channel job scope and compatible kinds required');
  const scopeFilter = channelScope ? Prisma.sql`AND (NOT ("DurableJob".kind=ANY(${channelScope.scopedKinds ?? kinds!}::text[])) OR (EXISTS (
          SELECT 1 FROM "Payment" p WHERE p.id = "DurableJob"."refId" AND "DurableJob".kind='RECOVER_PAYMENT'
            AND p.channel=${channelScope.channel} AND p."merchantScope"=${channelScope.merchantScope} AND p."providerConfigId"=${channelScope.providerConfigId}
          UNION ALL
          SELECT 1 FROM "Refund" r WHERE r.id = "DurableJob"."refId" AND "DurableJob".kind='RECOVER_REFUND'
            AND r.channel=${channelScope.channel} AND r."merchantScope"=${channelScope.merchantScope} AND r."providerConfigId"=${channelScope.providerConfigId}
          UNION ALL
          SELECT 1 FROM "V11PaymentIntent" p WHERE p.id = "DurableJob"."refId"
            AND "DurableJob".kind IN ('V11_CLOSE_EXPIRED_PAYMENT','V11_QUERY_PAYMENT')
            AND p.channel = ${channelScope?.channel ?? null}
            AND p."merchantScope" = ${channelScope?.merchantScope ?? null}
            AND p."providerConfigId" = ${channelScope?.providerConfigId ?? null}
          UNION ALL
          SELECT 1 FROM "V11RefundInstruction" r WHERE r.id = "DurableJob"."refId"
            AND "DurableJob".kind IN ('V11_QUERY_REFUND','V11_WECHAT_REFUND')
            AND r.channel = ${channelScope?.channel ?? null}
            AND r."merchantScope" = ${channelScope?.merchantScope ?? null}
            AND r."providerConfigId" = ${channelScope?.providerConfigId ?? null}
          UNION ALL
          SELECT 1 FROM "V11PaymentIntent" p WHERE p."registrationId" = "DurableJob"."refId"
            AND "DurableJob".kind = 'V11_FORMAL_LIFECYCLE'
            AND p.channel = ${channelScope?.channel ?? null}
            AND p."merchantScope" = ${channelScope?.merchantScope ?? null}
            AND p."providerConfigId" = ${channelScope?.providerConfigId ?? null}
        ) AND (${channelScope.refIds ?? null}::text[] IS NULL OR "DurableJob"."refId"=ANY(${channelScope.refIds ?? null}::text[]))))` : Prisma.empty;
  const rows = await db.$queryRaw<Lease[]>`
    WITH next AS (
      SELECT "id" FROM "DurableJob"
      WHERE (("state" IN ('READY', 'RETRY') AND "runAt" <= clock_timestamp())
         OR ("state" = 'RUNNING' AND "leaseUntil" <= clock_timestamp()))
        AND (${kinds ?? null}::text[] IS NULL OR "kind" = ANY(${kinds ?? null}::text[]))
        ${scopeFilter}
      ORDER BY "runAt", "id" FOR UPDATE SKIP LOCKED LIMIT 1
    )
    UPDATE "DurableJob" AS j SET "state" = 'RUNNING', "leaseOwner" = ${owner},
      "leaseUntil" = clock_timestamp() + ${LEASE_MS} * interval '1 millisecond',
      "generation" = j."generation" + 1, "attempts" = j."attempts" + 1, "updatedAt" = clock_timestamp()
    FROM next WHERE j."id" = next."id" RETURNING j.*`;
  return rows[0] ?? null;
}

export async function finishJob(db: PrismaClient, lease: Lease): Promise<boolean> {
  const changed = await db.$executeRaw`
    UPDATE "DurableJob" SET "state" = 'DONE', "leaseOwner" = NULL, "leaseUntil" = NULL,
      "errorClass" = NULL, "updatedAt" = clock_timestamp()
    WHERE "id" = ${lease.id} AND "state" = 'RUNNING' AND "generation" = ${lease.generation}
      AND "leaseOwner" = ${lease.leaseOwner} AND "leaseUntil" > clock_timestamp()`;
  return changed === 1;
}

// Only a small classification is persisted. Provider messages may contain private fields.
export async function retryJob(db: PrismaClient, lease: Lease, owner: string, errorClass = "RECOVERY_REQUIRED", forceManual = false) {
  const classification = ["RECOVERY_REQUIRED", "UNSUPPORTED_PAYLOAD", "CHANNEL_UNAVAILABLE", "DATA_CONFLICT"].includes(errorClass)
    ? errorClass : "RECOVERY_REQUIRED";
  const manual = forceManual || lease.attempts >= MAX_ATTEMPTS;
  const delay = Math.min(30 * 60 * 1000, 30_000 * 2 ** Math.min(lease.attempts - 1, 16));
  return db.$transaction(async tx => {
    const changed = await tx.$executeRaw`
      UPDATE "DurableJob" SET "state" = ${manual ? "MANUAL" : "RETRY"}, "leaseOwner" = NULL,
        "leaseUntil" = NULL, "errorClass" = ${classification},
        "runAt" = clock_timestamp() + ${delay} * interval '1 millisecond', "updatedAt" = clock_timestamp()
      WHERE "id" = ${lease.id} AND "state" = 'RUNNING' AND "generation" = ${lease.generation}
        AND "leaseOwner" = ${lease.leaseOwner} AND "leaseUntil" > clock_timestamp()`;
    if (changed && manual) {
      await openCase(tx, "JOB_REQUIRES_REVIEW", lease.id, owner);
    }
    return changed === 1;
  });
}

export type JobHandler = (lease: Lease) => Promise<void>;
export async function runOne(db: PrismaClient, owner: string, caseOwner: string, handlers: Record<string, JobHandler>, kinds?: string[], channelScope?: ChannelJobScope) {
  const lease = await claimJob(db, owner, kinds, channelScope);
  if (!lease) return false;
  const handler = handlers[lease.kind];
  // Repeated process deaths still consume the budget. Do not make a ninth channel call.
  if (lease.attempts > MAX_ATTEMPTS || lease.payloadVersion !== 1 || !handler) {
    await retryJob(db, lease, caseOwner, "UNSUPPORTED_PAYLOAD", true);
    return true;
  }
  try {
    await handler(lease);
    await finishJob(db, lease);
  } catch {
    await retryJob(db, lease, caseOwner);
  }
  return true;
}
