import { createHash } from "node:crypto";
import { evaluateTableFormation } from "@timeleft-shanghai/shared";
import type { Prisma, Activity } from "../generated/prisma/client.js";
import { enqueue, openCase } from "../jobs/queue.js";
import { reserveRefund } from "../funding/refunds.js";
import { z } from "zod";

type Tx = Prisma.TransactionClient;
type Actor = { sub: string; role: "OPS" | "SUPER_ADMIN" };

// Every writer changing candidate state first locks the Activity row.
export async function currentCandidates(tx: Tx, activityId: string) {
  const orders = await tx.order.findMany({
    where: { activityId, status: "PAID_PENDING_GROUP", registrationActive: true, capacityHeld: true },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }],
    select: { id: true, userId: true, version: true, amountCents: true, profileSnapshot: true,
      receipts: { select: { id: true, amountCents: true, currency: true,
        payment: { select: { status: true, resolutionState: true } } } } },
  });
  return orders.filter(order => order.receipts.some(receipt => receipt.amountCents === order.amountCents
    && receipt.currency === "CNY" && receipt.payment?.status === "SUCCEEDED"
    && receipt.payment.resolutionState === "CONFIRMED"));
}

const decisionProfile = z.object({
  ruleVersion: z.literal("l3-v1"),
  acceptableTableSizes: z.array(z.number().int().min(4).max(8)).min(1),
  dietaryRestrictions: z.array(z.string().trim().min(1)).min(1),
});

function formationBlock(candidates: Awaited<ReturnType<typeof currentCandidates>>, tables: string[][]) {
  const sizes = new Map(tables.flatMap(table => table.map(id => [id, table.length] as const)));
  for (const candidate of candidates) {
    const parsed = decisionProfile.safeParse(candidate.profileSnapshot);
    if (!parsed.success) return "PROFILE_SNAPSHOT_MISSING" as const;
    if (parsed.data.dietaryRestrictions.some(value => value.trim() !== "无")) return "DIETARY_CAPABILITY_UNVERIFIED" as const;
    if (!parsed.data.acceptableTableSizes.includes(sizes.get(candidate.id) ?? 0)) return "TABLE_SIZE_CONFLICT" as const;
  }
  return null;
}

export function candidateDigest(candidates: Array<{ id: string; version: number }>) {
  return createHash("sha256").update(JSON.stringify(candidates.map(({ id, version }) => [id, version]))).digest("hex");
}

function sameMembers(groups: Array<{ members: Array<{ orderId: string }> }>, candidateIds: string[]) {
  const memberIds = groups.flatMap(group => group.members.map(member => member.orderId));
  return memberIds.length === candidateIds.length
    && new Set(memberIds).size === candidateIds.length
    && candidateIds.every(id => memberIds.includes(id));
}

async function existingGroups(tx: Tx, activityId: string) {
  return tx.tableGroup.findMany({ where: { activityId }, orderBy: [{ generation: "desc" }, { ordinal: "asc" }, { createdAt: "asc" }],
    include: { members: { orderBy: { createdAt: "asc" } } } });
}

async function requireFormationPolicyReview(tx: Tx, activityId: string, actor: Actor, reason: string) {
  const issue = await openCase(tx, "FORMATION_POLICY_REVIEW", activityId, actor.sub);
  const changed = await tx.financialCase.updateMany({ where: { id: issue.id, state: "RESOLVED" },
    data: { state: "OPEN", owner: actor.sub, deadline: new Date(Date.now() + 24 * 60 * 60 * 1000),
      resolution: null, reviewedBy: null, reviewedAt: null } });
  if (changed.count) await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.role,
    action: "formation.policy.review.reopened", targetType: "FinancialCase", targetId: issue.id,
    metadata: { activityId, reason } } });
}

async function createGeneration(tx: Tx, activity: Activity, candidates: Awaited<ReturnType<typeof currentCandidates>>,
  memberIdsByTable: string[][], actor: Actor, action: string) {
  const old = await existingGroups(tx, activity.id);
  const generation = (old[0]?.generation ?? 0) + 1;
  await tx.tableGroup.updateMany({ where: { activityId: activity.id, status: "PENDING_CONFIRMATION" },
    data: { status: "CANCELED" } });
  const digest = candidateDigest(candidates);
  const tableGroups = [];
  for (const [index, orderIds] of memberIdsByTable.entries()) {
    tableGroups.push(await tx.tableGroup.create({ data: { activityId: activity.id, generation,
      ordinal: index + 1, candidateDigest: digest,
      members: { create: orderIds.map(orderId => ({ orderId })) } },
    include: { members: { orderBy: { createdAt: "asc" } } } }));
  }
  if (activity.status === "REGISTRATION_OPEN") await tx.activity.update({ where: { id: activity.id }, data: { status: "LOCKING" } });
  await tx.financialCase.updateMany({ where: { caseKey: `FORMATION_POLICY_REVIEW:${activity.id}`, state: "OPEN" },
    data: { state: "RESOLVED", resolution: "Valid table plan confirmed against order snapshots",
      reviewedBy: actor.sub, reviewedAt: new Date() } });
  await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.role, action,
    targetType: "Activity", targetId: activity.id,
    metadata: { generation, candidateCount: candidates.length, tableCount: tableGroups.length, supersededCount: old.filter(group => group.status === "PENDING_CONFIRMATION").length } } });
  return tableGroups;
}

export async function draftFormation(tx: Tx, activity: Activity, actor: Actor) {
  if (!["REGISTRATION_OPEN", "LOCKING"].includes(activity.status)) return { kind: "invalid_status" as const };
  const candidates = await currentCandidates(tx, activity.id);
  const digest = candidateDigest(candidates);
  const existing = (await existingGroups(tx, activity.id)).filter(group => group.status === "PENDING_CONFIRMATION");
  if (existing.length && existing.every(group => group.candidateDigest === digest)
    && sameMembers(existing, candidates.map(candidate => candidate.id))) {
    const reason = formationBlock(candidates, existing.map(group => group.members.map(member => member.orderId)));
    if (reason) { await requireFormationPolicyReview(tx, activity.id, actor, reason); return { kind: "needs_review" as const, reason }; }
    return { kind: "existing" as const, tableGroups: existing };
  }
  const decision = evaluateTableFormation(candidates.length, activity);
  if (!decision.canForm) {
    await tx.tableGroup.updateMany({ where: { activityId: activity.id, status: "PENDING_CONFIRMATION" }, data: { status: "CANCELED" } });
    return { kind: "not_enough" as const, decision };
  }
  let offset = 0;
  const tables = decision.tableSizes.map(size => {
    const ids = candidates.slice(offset, offset + size).map(candidate => candidate.id);
    offset += size;
    return ids;
  });
  const reason = formationBlock(candidates, tables);
  if (reason) { await requireFormationPolicyReview(tx, activity.id, actor, reason); return { kind: "needs_review" as const, reason }; }
  const tableGroups = await createGeneration(tx, activity, candidates, tables, actor, "table-groups.drafted");
  return { kind: "created" as const, decision, tableGroups };
}

export async function adjustFormation(tx: Tx, activity: Activity, actor: Actor, tables: string[][]) {
  if (!["REGISTRATION_OPEN", "LOCKING"].includes(activity.status)) return { kind: "invalid_status" as const };
  const candidates = await currentCandidates(tx, activity.id);
  const candidateIds = candidates.map(candidate => candidate.id);
  const submitted = tables.flat();
  if (tables.some(table => table.length < activity.minSize || table.length > activity.maxSize)) return { kind: "invalid_size" as const };
  if (submitted.length !== candidateIds.length || new Set(submitted).size !== submitted.length
    || candidateIds.some(id => !submitted.includes(id))) return { kind: "invalid_members" as const };
  const reason = formationBlock(candidates, tables);
  if (reason) { await requireFormationPolicyReview(tx, activity.id, actor, reason); return { kind: "needs_review" as const, reason }; }
  const tableGroups = await createGeneration(tx, activity, candidates, tables, actor, "table-groups.adjusted");
  return { kind: "adjusted" as const, tableGroups };
}

export async function confirmFormation(tx: Tx, activity: Activity, actor: Actor) {
  if (activity.status === "GROUPED") return { kind: "already_confirmed" as const };
  if (activity.status !== "LOCKING") return { kind: "invalid_status" as const };
  const groups = (await existingGroups(tx, activity.id)).filter(group => group.status === "PENDING_CONFIRMATION");
  if (!groups.length || groups.some(group => group.candidateDigest === null)) return { kind: "missing_draft" as const };
  const generation = groups[0]!.generation;
  if (groups.some(group => group.generation !== generation)) return { kind: "stale_draft" as const };
  const candidates = await currentCandidates(tx, activity.id);
  const digest = candidateDigest(candidates);
  if (groups.some(group => group.candidateDigest !== digest)
    || !sameMembers(groups, candidates.map(candidate => candidate.id))
    || groups.some(group => group.members.length < activity.minSize || group.members.length > activity.maxSize)) {
    return { kind: "stale_draft" as const };
  }
  const reason = formationBlock(candidates, groups.map(group => group.members.map(member => member.orderId)));
  if (reason) { await requireFormationPolicyReview(tx, activity.id, actor, reason); return { kind: "needs_review" as const, reason }; }
  const ids = candidates.map(candidate => candidate.id);
  const changed = await tx.order.updateMany({ where: { id: { in: ids }, status: "PAID_PENDING_GROUP",
    registrationActive: true, capacityHeld: true }, data: { status: "GROUPED", version: { increment: 1 } } });
  if (changed.count !== ids.length) throw new Error("Candidate order state changed during confirmation");
  await tx.tableGroup.updateMany({ where: { id: { in: groups.map(group => group.id) } }, data: { status: "CONFIRMED" } });
  await tx.activity.update({ where: { id: activity.id }, data: { status: "GROUPED" } });
  for (const candidate of candidates) {
    const businessKey = `group:${activity.id}:${generation}:${candidate.id}`;
    const notification = await tx.notification.upsert({ where: { businessKey }, update: {}, create: {
      businessKey, userId: candidate.userId, orderId: candidate.id, activityId: activity.id,
      type: "GROUP_CONFIRMED", status: "PENDING",
      payload: { title: "饭局已成团", message: `${activity.title} 已确认成团，餐厅信息将按规则逐步展示。` },
    } });
    await enqueue(tx, "DELIVER_INBOX", `inbox:${businessKey}`, notification.id);
  }
  await tx.auditLog.create({ data: { actorId: actor.sub, actorRole: actor.role, action: "table-groups.confirmed",
    targetType: "Activity", targetId: activity.id,
    metadata: { generation, tableCount: groups.length, groupedOrderCount: ids.length } } });
  return { kind: "confirmed" as const, count: ids.length };
}

export async function deliverInbox(tx: Tx, notificationId: string) {
  const notification = await tx.notification.findUniqueOrThrow({ where: { id: notificationId } });
  if (notification.status === "SENT") return;
  if (notification.status !== "PENDING") throw new Error("Inbox notification requires review");
  await tx.notification.update({ where: { id: notificationId }, data: { status: "SENT" } });
}

export async function queueDecisionNotifications(tx: Tx, activity: Activity,
  users: Array<{ id: string; userId: string }>, type: "GROUP_FAILED" | "ACTIVITY_CANCELED") {
  for (const user of users) {
    const businessKey = `${type}:${activity.id}:${user.id}`;
    const notification = await tx.notification.upsert({ where: { businessKey }, update: {}, create: {
      businessKey, userId: user.userId, orderId: user.id, activityId: activity.id, type, status: "PENDING",
      payload: type === "GROUP_FAILED"
        ? { title: "本次饭局未能成团", message: `${activity.title} 未能满足成团人数，退款进度请查看订单。` }
        : { title: "本次饭局已取消", message: `${activity.title} 已取消，退款进度请查看订单。` },
    } });
    await enqueue(tx, "DELIVER_INBOX", `inbox:${businessKey}`, notification.id);
  }
}

// The decision records a duty against each actual receipt, including extra receipts.
export async function createDecisionRefundDuties(tx: Tx, activityId: string, owner: string,
  cause: "GROUP_FAILED" | "OPERATOR_CANCELED" | "REFUND_REJECTED_NO_FULFILLMENT", orderId?: string) {
  const receiptIds = await tx.channelReceipt.findMany({ where: { order: { activityId },
    ...(orderId ? { orderId } : {}) }, orderBy: { id: "asc" }, select: { id: true } });
  let created = 0;
  for (const row of receiptIds) {
    await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id = ${row.id} FOR UPDATE`;
    let receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: row.id },
      include: { payment: true, refunds: true, obligations: { include: { refund: true } } } });
    if (receipt.orderId) {
      const reviewing = await tx.refund.findMany({ where: { orderId: receipt.orderId,
        receiptId: null, status: "REVIEWING", resolutionState: "NEW",
        amountCents: { lte: receipt.amountCents } }, orderBy: { createdAt: "asc" } });
      const historicalManual = await tx.refund.count({ where: { orderId: receipt.orderId,
        receiptId: null, resolutionState: "MANUAL" } });
      const reservedNow = receipt.refunds.filter(refund => refund.status !== "REJECTED")
        .reduce((sum, refund) => sum + refund.amountCents, 0)
        + receipt.obligations.filter(duty => !duty.refund && duty.state !== "SATISFIED")
          .reduce((sum, duty) => sum + duty.amountCents, 0);
      if (!historicalManual && reviewing.length === 1 && receipt.paymentId
        && receipt.channelTradeNo === receipt.payment?.channelTradeNo
        && reviewing[0]!.amountCents <= receipt.amountCents - reservedNow) {
        await reserveRefund(tx, reviewing[0]!.id, receipt.id);
        receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: row.id },
          include: { payment: true, refunds: true, obligations: { include: { refund: true } } } });
      }
    }
    const reserved = receipt.refunds.filter(refund => refund.status !== "REJECTED")
      .reduce((sum, refund) => sum + refund.amountCents, 0);
    const unboundDuties = receipt.obligations.filter(duty => !duty.refund && duty.state !== "SATISFIED")
      .reduce((sum, duty) => sum + duty.amountCents, 0);
    const remaining = receipt.amountCents - reserved - unboundDuties;
    if (remaining < 0) {
      await openCase(tx, "REFUND_BUDGET_CONFLICT", receipt.id, owner);
      continue;
    }
    if (remaining === 0) continue;
    const unboundReview = await tx.refund.count({ where: { orderId: receipt.orderId ?? "", receiptId: null,
      status: { not: "REJECTED" } } });
    if (unboundReview) {
      await openCase(tx, "UNBOUND_REFUND_REVIEW", receipt.id, owner);
      continue;
    }
    const businessKey = `decision:${activityId}:${receipt.id}`;
    const obligation = await tx.refundObligation.upsert({ where: { businessKey }, update: {}, create: {
      receiptId: receipt.id, orderId: receipt.orderId, businessKey, cause, amountCents: remaining,
      owner, deadline: new Date(Date.now() + 86_400_000), policyVersion: "decision-full-v1",
    } });
    await enqueue(tx, "REFUND_OBLIGATION", `obligation:${obligation.id}`, obligation.id);
    created += 1;
  }
  return created;
}
