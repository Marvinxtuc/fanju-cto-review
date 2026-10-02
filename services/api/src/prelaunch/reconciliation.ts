import type { PrismaClient } from "../generated/prisma/client.js";
import { requireRole, reject, type LocalPrincipal } from "./contracts.js";
import { TASK_ID } from "./ownership.js";
import { persistMockEvent, audit, object, json } from "./domain.js";
import { openCase } from "../jobs/queue.js";

async function taskIdentity(db: PrismaClient) {
  const rows = await db.$queryRaw<{ name: string; task_id: string; owner_id: string; purpose: string }[]>`SELECT current_database() AS name, task_id, owner_id, purpose FROM prelaunch_control.owner`;
  if (rows.length !== 1 || rows[0]!.task_id !== TASK_ID || rows[0]!.purpose !== "synthetic-local-prelaunch" || !/^fanju_prelaunch_[a-f0-9]{12}(?:_(?:channel|restore|empty))?$/.test(rows[0]!.name)) reject(503, "DATABASE_OWNER_MISMATCH");
  return rows[0]!;
}
// Complete bidirectional enumeration, never just a count or a last-event watermark.
// Recover trustworthy channel facts through the same receipt budget/state-machine path.
export async function reconcileMockChannel(db: PrismaClient, channelDb: PrismaClient, actor: LocalPrincipal) {
  requireRole(actor, "OPS");
  const [business, channel] = await Promise.all([taskIdentity(db), taskIdentity(channelDb)]);
  if (business.owner_id !== channel.owner_id || business.name === channel.name || !channel.name.endsWith("_channel")) reject(503, "OWNED_CHANNEL_DATABASE_REQUIRED");
  const stats = { paymentFacts: 0, refundFacts: 0, recovered: 0, conflicts: 0, businessWithoutChannel: 0, componentBudgetConflicts: 0, scope: "SIMULATION_ONLY" };
  const report = async (category: string, id: string) => { stats.conflicts++; await db.$transaction(tx => openCase(tx, category, id, actor.id)); };
  const facts = await channelDb.mockChannelTransaction.findMany({ orderBy: { id: "asc" } });
  for (const fact of facts) {
    if (fact.status !== "SUCCEEDED") continue;
    if (fact.kind === "PAYMENT") {
      stats.paymentFacts++;
      const merchantNo = fact.businessKey.startsWith("PAYMENT:") ? fact.businessKey.slice(8) : "";
      const intent = await db.v11PaymentIntent.findUnique({ where: { merchantOrderNo: merchantNo } });
      if (!intent) { await report("V11_CHANNEL_PAYMENT_WITHOUT_INTENT", fact.id); continue; }
      if (intent.channel !== "mock" || intent.merchantScope !== "mock-local" || intent.providerConfigId !== "mock-v1") { await report("V11_CHANNEL_PAYMENT_BINDING_CONFLICT", intent.id); continue; }
      const receipt = await db.channelReceipt.findUnique({ where: { channel_merchantScope_channelTradeNo: { channel: "mock", merchantScope: "mock-local", channelTradeNo: fact.channelNo } } });
      if (receipt && (receipt.amountCents !== fact.amountCents || receipt.merchantOrderNo !== merchantNo)) { await report("V11_CHANNEL_PAYMENT_RECEIPT_CONFLICT", receipt.id); continue; }
      if (!receipt || !(await db.v11ReceiptBinding.findUnique({ where: { receiptId: receipt.id } }))) { await persistMockEvent(db, { kind: "PAYMENT", sourceId: intent.id, channelNo: fact.channelNo, amountCents: fact.amountCents }); const persisted = await db.channelReceipt.findUnique({ where: { channel_merchantScope_channelTradeNo: { channel: "mock", merchantScope: "mock-local", channelTradeNo: fact.channelNo } } }); const binding = persisted && await db.v11ReceiptBinding.findUnique({ where: { receiptId: persisted.id } }); if (!binding) await report("V11_CHANNEL_PAYMENT_RECOVERY_INCOMPLETE", intent.id); else { stats.recovered++; if (binding.classification === "AMOUNT_CONFLICT") await report("V11_CHANNEL_PAYMENT_AMOUNT_CONFLICT", persisted.id); } }
    } else if (fact.kind === "REFUND") {
      stats.refundFacts++;
      const merchantNo = fact.businessKey.startsWith("REFUND:") ? fact.businessKey.slice(7) : "";
      const instruction = await db.v11RefundInstruction.findUnique({ where: { merchantRefundNo: merchantNo } });
      if (!instruction) { await report("V11_CHANNEL_REFUND_WITHOUT_INSTRUCTION", fact.id); continue; }
      if (instruction.channel !== "mock" || instruction.merchantScope !== "mock-local" || instruction.providerConfigId !== "mock-v1" || instruction.totalCents !== fact.amountCents || instruction.originalTradeNo !== fact.originalTradeNo) { await report("V11_CHANNEL_REFUND_BINDING_CONFLICT", instruction.id); continue; }
      if (instruction.state !== "CONFIRMED") { await persistMockEvent(db, { kind: "REFUND", sourceId: instruction.id, channelNo: fact.channelNo, amountCents: fact.amountCents, originalTradeNo: fact.originalTradeNo! }); const current = await db.v11RefundInstruction.findUniqueOrThrow({ where: { id: instruction.id } }); if (current.state !== "CONFIRMED" || current.channelRefundNo !== fact.channelNo) await report("V11_CHANNEL_REFUND_RECOVERY_INCOMPLETE", instruction.id); else stats.recovered++; }
    } else await report("V11_CHANNEL_UNKNOWN_FACT_KIND", fact.id);
  }
  const receipts = await db.v11ReceiptBinding.findMany({ include: { receipt: true } });
  for (const binding of receipts) {
    const receipt = binding.receipt;
    const fact = await channelDb.mockChannelTransaction.findUnique({ where: { channelNo: receipt.channelTradeNo } });
    if (!fact || fact.kind !== "PAYMENT" || fact.status !== "SUCCEEDED" || fact.amountCents !== receipt.amountCents || fact.businessKey !== `PAYMENT:${receipt.merchantOrderNo}`) { stats.businessWithoutChannel++; await report("V11_BUSINESS_RECEIPT_CHANNEL_MISMATCH", receipt.id); }
  }
  for (const instruction of await db.v11RefundInstruction.findMany({ where: { state: "CONFIRMED" } })) {
    const fact = await channelDb.mockChannelTransaction.findUnique({ where: { businessKey: `REFUND:${instruction.merchantRefundNo}` } });
    if (!fact || fact.status !== "SUCCEEDED" || fact.amountCents !== instruction.totalCents || fact.originalTradeNo !== instruction.originalTradeNo || fact.channelNo !== instruction.channelRefundNo) { stats.businessWithoutChannel++; await report("V11_BUSINESS_REFUND_CHANNEL_MISMATCH", instruction.id); }
  }
  for (const component of await db.v11FundComponent.findMany({ include: { v11Disposition_componentId: true } })) {
    const total = component.v11Disposition_componentId.filter(row => row.state !== "RELEASED").reduce((sum, row) => sum + row.amountCents, 0);
    if (total > component.originalCents || total < 0) { stats.componentBudgetConflicts++; await report("V11_COMPONENT_BUDGET_CONFLICT", component.id); }
  }
  await db.$transaction(tx => audit(tx, "reconciliation.completed", "PrelaunchEnvironment", business.name, actor));
  return stats;
}

// Restore application is explicit and idempotent. No retention rules or account deletion are invented.
// Source request carries the synthetic correction snapshot; the restore copy never revives old fields.
export async function privacyReplay(sourceDb: PrismaClient, restoreDb: PrismaClient, actor: LocalPrincipal) {
  requireRole(actor, "OPS"); const [source, target] = await Promise.all([taskIdentity(sourceDb), taskIdentity(restoreDb)]);
  if (source.owner_id !== target.owner_id || source.name === target.name || !target.name.endsWith("_restore")) reject(503, "OWNED_RESTORE_DATABASE_REQUIRED");
  const dispositions = await sourceDb.v11PrivacyDisposition.findMany({ where: { state: "APPLIED_SIMULATION" }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], include: { request: true } });
  let replayed = 0, blocked = 0;
  for (const disposition of dispositions) {
    const applied = await restoreDb.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${disposition.userId} FOR UPDATE`;
      if (!(await tx.user.findUnique({ where: { id: disposition.userId } }))) { await openCase(tx, "V11_PRIVACY_REPLAY_USER_MISSING", disposition.id, actor.id); return false; }
      if (await tx.v11PrivacyDisposition.findUnique({ where: { businessKey: disposition.businessKey } })) return null;
      if (disposition.request.kind === "RIGHT_CORRECTION") {
        const correction = object(object(disposition.request.payload).correction);
        if (!["MALE", "FEMALE"].includes(String(correction.gender)) || !Array.isArray(correction.timePreferences) || correction.timePreferences.some(item => typeof item !== "string" || item.length > 60)) { await openCase(tx, "V11_PRIVACY_REPLAY_SNAPSHOT_INVALID", disposition.id, actor.id); return false; }
        await tx.v11Profile.upsert({ where: { userId: disposition.userId }, create: { userId: disposition.userId, gender: String(correction.gender), availableTimes: correction.timePreferences as string[] }, update: { gender: String(correction.gender), availableTimes: correction.timePreferences as string[], version: { increment: 1 } } });
      } else if (!disposition.fields.every(field => field === "OWN_SYNTHETIC_EXPORT")) { await openCase(tx, "V11_PRIVACY_REPLAY_POLICY_UNRESOLVED", disposition.id, actor.id); return false; }
      const request = disposition.request;
      const prior = await tx.v11Request.findUnique({ where: { businessKey: request.businessKey } });
      if (prior && (prior.userId !== request.userId || prior.kind !== request.kind)) reject(409, "PRIVACY_REPLAY_IDENTITY_CONFLICT");
      const targetRequest = prior ?? await tx.v11Request.create({ data: { id: request.id, businessKey: request.businessKey, userId: disposition.userId, kind: request.kind, acceptedAt: request.acceptedAt, source: "SIMULATION_ONLY", state: request.state, payload: json(request.payload), blockerIds: json(request.blockerIds) } });
      await tx.v11PrivacyDisposition.create({ data: { id: disposition.id, requestId: targetRequest.id, userId: disposition.userId, businessKey: disposition.businessKey, fields: disposition.fields, state: disposition.state, appliedAt: disposition.appliedAt, createdAt: disposition.createdAt } });
      await audit(tx, "privacy.restore-replayed", "V11PrivacyDisposition", disposition.id, actor); return true;
    });
    if (applied === true) replayed++; if (applied === false) blocked++;
  }
  return { replayed, blocked, dispositionsConsidered: dispositions.length, preserveMoneyFacts: true, scope: "SIMULATION_ONLY" };
}
