import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { paymentEvidenceSchema } from "../funding/receipts.js";
import { refundEvidenceSchema, persistTrustedEvent } from "../events/inbox.js";
import { openCase, enqueue } from "../jobs/queue.js";

const statementSchema = z.object({
  merchantScope: z.string().min(1).max(160), period: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  coverageState: z.enum(["COMPLETE", "INCOMPLETE", "UNAVAILABLE"]),
  records: z.array(z.discriminatedUnion("kind", [paymentEvidenceSchema, refundEvidenceSchema])).max(100_000),
}).strict();

// Controlled import: caller supplies the separately checked export digest, never an arbitrary URL.
export async function importStatement(db: PrismaClient, raw: string, expectedSha256: string, owner: string) {
  if (Buffer.byteLength(raw) > 32 * 1024 * 1024) throw new Error("Statement exceeds import size limit");
  const sourceHash = createHash("sha256").update(raw).digest("hex");
  if (sourceHash !== expectedSha256) throw new Error("Statement digest mismatch");
  const statement = statementSchema.parse(JSON.parse(raw));
  if (statement.records.some(row => row.merchantScope !== statement.merchantScope)) throw new Error("Statement merchant scope mismatch");
  if (statement.coverageState === "UNAVAILABLE" && statement.records.length) throw new Error("Unavailable statement cannot contain transactions");
  // Persist incomplete first. A process crash midway through importing must never appear fully reconciled.
  const batch = await db.$transaction(async tx => {
    const row = await tx.reconciliationBatch.upsert({
      where: { merchantScope_period_sourceHash: { merchantScope: statement.merchantScope, period: statement.period, sourceHash } },
      create: { merchantScope: statement.merchantScope, period: statement.period, sourceHash, coverageState: "INCOMPLETE" },
      update: { coverageState: "INCOMPLETE" },
    });
    await tx.$executeRaw`UPDATE "ReconciliationBatch" SET "decisionOrdinal" = nextval('"ReconciliationBatch_decisionOrdinal_seq"') WHERE "id" = ${row.id}`;
    return row;
  });
  for (const [index, row] of statement.records.entries()) {
    await persistTrustedEvent(db, { source: "controlled-statement", eventKey: `${sourceHash}:${index}`,
      verificationMaterialId: `statement:${sourceHash}`, evidence: row }, owner);
  }
  await db.$transaction(async tx => {
    // Serialize final decisions for this scope and period before assigning the ordinal.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${statement.merchantScope}), hashtext(${statement.period}))::text`;
    await tx.reconciliationBatch.update({ where: { id: batch.id }, data: { coverageState: statement.coverageState } });
    await tx.$executeRaw`UPDATE "ReconciliationBatch" SET "decisionOrdinal" = nextval('"ReconciliationBatch_decisionOrdinal_seq"') WHERE "id" = ${batch.id}`;
    if (statement.coverageState !== "COMPLETE") await openCase(tx, "STATEMENT_UNAVAILABLE_OR_INCOMPLETE", batch.id, owner);
  });
  return { batchId: batch.id, coverageState: statement.coverageState, imported: statement.records.length };
}

export interface QueryEvidence { status: "SUCCEEDED" | "PENDING" | "CLOSED" | "FAILED"; channelNo: string; amountCents: number; originalTradeNo?: string | null; paidAt?: string }
export type ChannelQuery = (binding: { channel: string; merchantScope: string; providerConfigId: string }, kind: "PAYMENT" | "REFUND", merchantNo: string) => Promise<QueryEvidence | null>;

// Local -> channel complements channel statements -> local. Unavailability is never zero difference.
export async function reconcileKnown(db: PrismaClient, merchantScope: string, query: ChannelQuery, owner: string) {
  let checked = 0;
  let unavailable = 0;
  const payments = await db.payment.findMany({ where: { merchantScope } });
  for (const payment of payments) {
    let fact: QueryEvidence | null;
    try { fact = await query(payment, "PAYMENT", payment.merchantOrderNo); }
    catch {
      unavailable++;
      await db.$transaction(tx => openCase(tx, "CHANNEL_QUERY_UNAVAILABLE", payment.id, owner));
      continue;
    }
    checked++;
    if (fact?.status === "SUCCEEDED") {
      if (!["mock", "wechat"].includes(payment.channel)) throw new Error("Unknown original channel");
      const evidenceHash = createHash("sha256").update(JSON.stringify(fact)).digest("hex");
      await persistTrustedEvent(db, { source: "local-channel-query", eventKey: `${payment.id}:${evidenceHash}`,
        verificationMaterialId: payment.providerConfigId,
        evidence: { kind: "PAYMENT_SUCCEEDED", channel: payment.channel as "mock" | "wechat", merchantScope,
          merchantOrderNo: payment.merchantOrderNo, channelTradeNo: fact.channelNo, amountCents: fact.amountCents,
          ...(fact.paidAt ? { paidAt: fact.paidAt } : {}), currency: "CNY", evidenceHash } }, owner);
    }
    await db.$transaction(async tx => {
      if (fact?.status === "SUCCEEDED") {
        if (fact.amountCents !== payment.amountCents || (payment.channelTradeNo && payment.channelTradeNo !== fact.channelNo)) {
          await openCase(tx, "CHANNEL_LOCAL_CONFLICT", payment.id, owner);
        }
        // Restore a missing recovery job as well as wake an existing pending one.
        const job = await enqueue(tx, "RECOVER_PAYMENT", `payment:${payment.id}`, payment.id);
        await tx.durableJob.updateMany({ where: { id: job.id, state: { in: ["READY", "RETRY"] } }, data: { runAt: new Date() } });
      } else if (payment.status === "SUCCEEDED") {
        await openCase(tx, "LOCAL_SUCCESS_CHANNEL_UNCONFIRMED", payment.id, owner);
      }
    });
  }
  const refunds = await db.refund.findMany({ where: { merchantScope, status: { in: ["REFUNDING", "FAILED", "SUCCEEDED"] } }, include: { receipt: true } });
  for (const refund of refunds) {
    let fact: QueryEvidence | null;
    try { fact = await query(refund, "REFUND", refund.merchantRefundNo); }
    catch { unavailable++; await db.$transaction(tx => openCase(tx, "CHANNEL_QUERY_UNAVAILABLE", refund.id, owner)); continue; }
    checked++;
    if (!fact || fact.status !== "SUCCEEDED" || fact.amountCents !== refund.amountCents) {
      await db.$transaction(tx => openCase(tx, "REFUND_NOT_CONVERGED", refund.id, owner));
    } else {
      if (!fact.originalTradeNo || !["mock", "wechat"].includes(refund.channel)
        || fact.originalTradeNo !== refund.receipt?.channelTradeNo
        || (refund.channelRefundNo && fact.channelNo !== refund.channelRefundNo)) {
        await db.$transaction(tx => openCase(tx, "REFUND_FACT_CONFLICT", refund.id, owner));
        continue;
      }
      const evidenceHash = createHash("sha256").update(JSON.stringify(fact)).digest("hex");
      await persistTrustedEvent(db, { source: "local-refund-query", eventKey: `${refund.id}:${evidenceHash}`,
        verificationMaterialId: refund.providerConfigId,
        evidence: { kind: "REFUND_SUCCEEDED", channel: refund.channel as "mock" | "wechat", merchantScope,
          merchantRefundNo: refund.merchantRefundNo, originalTradeNo: fact.originalTradeNo,
          channelRefundNo: fact.channelNo, amountCents: fact.amountCents, currency: "CNY", evidenceHash } }, owner);
    }
  }
  return { checked, unavailable, coverageState: unavailable ? "INCOMPLETE" : "COMPLETE" };
}
