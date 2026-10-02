import { createHash } from "node:crypto";
import { z } from "zod";
import type { PrismaClient } from "../generated/prisma/client.js";
import { enqueue, openCase } from "../jobs/queue.js";
import { recordRefund } from "../funding/refunds.js";
import { paymentEvidenceSchema, recordPayment } from "../funding/receipts.js";

export const refundEvidenceSchema = z.object({
  kind: z.literal("REFUND_SUCCEEDED"), channel: z.enum(["mock", "wechat"]),
  merchantScope: z.string().min(1).max(160), merchantRefundNo: z.string().min(1).max(160),
  channelRefundNo: z.string().min(1).max(160), originalTradeNo: z.string().min(1).max(160),
  amountCents: z.number().int().positive().max(2_147_483_647), currency: z.literal("CNY"),
  evidenceHash: z.string().min(1).max(256),
}).strict();
const evidenceSchema = z.discriminatedUnion("kind", [paymentEvidenceSchema, refundEvidenceSchema]);
const trustedEventSchema = z.object({
  source: z.string().min(1).max(120), eventKey: z.string().min(1).max(160),
  verificationMaterialId: z.string().min(1).max(160),
  evidence: evidenceSchema,
}).strict();
export type TrustedEvent = z.infer<typeof trustedEventSchema>;

// Only invoke after protocol verification. Commit is the acknowledgement boundary.
export async function persistTrustedEvent(db: PrismaClient, input: TrustedEvent, owner: string) {
  const data = trustedEventSchema.parse(input);
  const payloadHash = createHash("sha256").update(JSON.stringify(data.evidence)).digest("hex");
  return db.$transaction(async tx => {
    const unique = { source: data.source, merchantScope: data.evidence.merchantScope, eventKey: data.eventKey };
    const key = JSON.stringify(unique);
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))::text`;
    const prior = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: unique } });
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        await openCase(tx, "EVENT_PAYLOAD_CONFLICT", prior.id, owner);
        return { event: prior, duplicate: true, conflict: true };
      }
      return { event: prior, duplicate: true, conflict: false };
    }
    const event = await tx.receivedEvent.create({ data: {
      ...unique, payloadHash, normalizedPayload: data.evidence,
      verificationMaterialId: data.verificationMaterialId, verifiedAt: new Date(),
    } });
    await enqueue(tx, "APPLY_EVENT", `event:${event.id}`, event.id);
    return { event, duplicate: false, conflict: false };
  });
}
export async function applyEvent(db: PrismaClient, eventId: string, owner: string) {
  await db.$transaction(async tx => {
    // Event processing always locks event then activity/order; no business path locks an event.
    await tx.$queryRaw`SELECT id FROM "ReceivedEvent" WHERE id = ${eventId} FOR UPDATE`;
    const event = await tx.receivedEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (event.state !== "RECEIVED") return;
    const evidence = evidenceSchema.safeParse(event.normalizedPayload);
    if (!evidence.success) {
      await openCase(tx, "EVENT_UNSUPPORTED", event.id, owner);
      await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "MANUAL" } });
      return;
    }
    if (evidence.data.kind === "REFUND_SUCCEEDED") {
      const applied = await recordRefund(tx, evidence.data, owner);
      await tx.receivedEvent.update({ where: { id: event.id }, data: { state: applied ? "APPLIED" : "MANUAL" } });
      return;
    }
    const result = await recordPayment(tx, evidence.data, owner);
    await tx.receivedEvent.update({ where: { id: event.id }, data: { state: result.outcome === "conflict" || result.outcome === "manual" ? "MANUAL" : "APPLIED" } });
  });
}
