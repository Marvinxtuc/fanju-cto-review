import type { PrismaClient } from '../generated/prisma/client.js';
import type { ChannelBinding } from '../funding/mock-channel.js';

export interface QuerySweepResult {
  runId: string; paymentsQueued: number; refundsQueued: number;
  scope: 'LOCAL_TO_CHANNEL_QUERY'; coverageState: 'INCOMPLETE';
  releaseVersion: string;
}

// Enumerate inactive/closed obligations too. A sweep schedules existing trusted
// query handlers; it never submits payment/refund or claims full bill coverage.
export async function scheduleWechatQuerySweep(db: PrismaClient, binding: ChannelBinding,
  owner: string, releaseVersion: string, runId: string): Promise<QuerySweepResult> {
  if (binding.channel !== 'wechat' || !/^[a-f0-9]{64}$/.test(binding.merchantScope)
    || !/^[A-Za-z0-9_.:-]{1,160}$/.test(binding.providerConfigId)
    || !owner.trim() || owner.length > 160 || !releaseVersion.trim() || releaseVersion.length > 160
    || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))
    throw Error('Explicit real query sweep configuration required');
  return db.$transaction(async tx => {
    await tx.$executeRawUnsafe("SET LOCAL statement_timeout = '15000ms'");
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-query-sweep:${runId}`},0))`;
    const prior = await tx.auditLog.findFirst({ where: { action: 'funding.v11-query-sweep', targetType: 'V11QuerySweep', targetId: runId } });
    if (prior) {
      const metadata = prior.metadata as unknown as { binding: ChannelBinding; owner: string; result: QuerySweepResult };
      if (!metadata || metadata.binding?.channel !== binding.channel || metadata.binding?.merchantScope !== binding.merchantScope
        || metadata.binding?.providerConfigId !== binding.providerConfigId || metadata.owner !== owner
        || metadata.result?.releaseVersion !== releaseVersion || metadata.result?.runId !== runId
        || metadata.result?.scope !== 'LOCAL_TO_CHANNEL_QUERY' || metadata.result?.coverageState !== 'INCOMPLETE'
        || !Number.isSafeInteger(metadata.result?.paymentsQueued) || metadata.result.paymentsQueued < 0
        || !Number.isSafeInteger(metadata.result?.refundsQueued) || metadata.result.refundsQueued < 0)
        throw Error('Query sweep replay identity conflict');
      return metadata.result;
    }
    // Both tables are enumerated in one statement snapshot. Job writes and the
    // audit commit together; process death before commit leaves neither behind.
    const rows = await tx.$queryRaw<Array<{ kind: string; count: bigint }>>`
      WITH obligations AS (
        SELECT 'V11_QUERY_PAYMENT' AS kind, id FROM "V11PaymentIntent"
          WHERE channel=${binding.channel} AND "merchantScope"=${binding.merchantScope} AND "providerConfigId"=${binding.providerConfigId}
        UNION ALL
        SELECT 'V11_QUERY_REFUND' AS kind, id FROM "V11RefundInstruction"
          WHERE channel=${binding.channel} AND "merchantScope"=${binding.merchantScope} AND "providerConfigId"=${binding.providerConfigId}
      ), queued AS (
        INSERT INTO "DurableJob" (id, kind, "businessKey", "refId", "runAt", "updatedAt")
        SELECT gen_random_uuid()::text, kind, 'v11:recon-query:' || ${runId} || ':' || kind || ':' || id,
          id, clock_timestamp(), clock_timestamp() FROM obligations
        RETURNING kind
      ) SELECT kind, count(*) FROM queued GROUP BY kind`;
    const result: QuerySweepResult = { runId, paymentsQueued: Number(rows.find(row => row.kind === 'V11_QUERY_PAYMENT')?.count ?? 0n),
      refundsQueued: Number(rows.find(row => row.kind === 'V11_QUERY_REFUND')?.count ?? 0n),
      scope: 'LOCAL_TO_CHANNEL_QUERY', coverageState: 'INCOMPLETE', releaseVersion };
    await tx.auditLog.create({ data: { action: 'funding.v11-query-sweep', targetType: 'V11QuerySweep', targetId: runId,
      metadata: { binding: { ...binding }, owner, result: { ...result } } } });
    return result;
  }, { timeout: 30_000 });
}
