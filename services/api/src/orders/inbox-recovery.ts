import type { PrismaClient } from "../generated/prisma/client.js";
import { enqueue } from "../jobs/queue.js";

export interface InboxAudit {
  pendingWithoutJob: string[];
  sentWithOpenJob: string[];
  invalidLink: string[];
}

export async function auditInbox(db: PrismaClient): Promise<InboxAudit> {
  const rows = await db.notification.findMany({ where: { status: { in: ["PENDING", "SENT"] } },
    select: { id: true, businessKey: true, type: true, status: true, userId: true, orderId: true, activityId: true,
      order: { select: { userId: true, activityId: true } } } });
  const jobs = await db.durableJob.findMany({ where: { kind: "DELIVER_INBOX", refId: { in: rows.map(row => row.id) } },
    select: { refId: true, state: true, businessKey: true } });
  const byRef = new Map(jobs.map(job => [job.refId, job]));
  const result: InboxAudit = { pendingWithoutJob: [], sentWithOpenJob: [], invalidLink: [] };
  for (const row of rows) {
    const valid = validInboxLink(row);
    if (!valid) result.invalidLink.push(row.id);
    const job = byRef.get(row.id);
    if (row.status === "PENDING" && (!job || job.businessKey !== `inbox:${row.businessKey}`)) result.pendingWithoutJob.push(row.id);
    if (row.status === "SENT" && job && job.state !== "DONE") result.sentWithOpenJob.push(row.id);
  }
  return result;
}

export async function repairMissingInboxJobs(db: PrismaClient): Promise<{ repaired: string[]; skipped: string[] }> {
  const audit = await auditInbox(db);
  const repaired: string[] = [];
  const skipped: string[] = [];
  for (const id of audit.pendingWithoutJob) {
    if (audit.invalidLink.includes(id)) { skipped.push(id); continue; }
    try {
      const changed = await db.$transaction(async tx => {
        const row = await tx.notification.findUniqueOrThrow({ where: { id }, select: { id: true, businessKey: true, status: true } });
        if (row.status !== "PENDING" || !row.businessKey) return false;
        await enqueue(tx, "DELIVER_INBOX", `inbox:${row.businessKey}`, row.id);
        return true;
      });
      if (changed) repaired.push(id); else skipped.push(id);
    } catch { skipped.push(id); }
  }
  return { repaired, skipped };
}

function validInboxLink(row: { businessKey: string | null; type: string; userId: string; orderId: string | null;
  activityId: string | null; order: { userId: string; activityId: string } | null }): boolean {
  if (!row.businessKey || !row.order || !row.orderId || !row.activityId
    || row.userId !== row.order.userId || row.activityId !== row.order.activityId) return false;
  if (row.type === "GROUP_CONFIRMED") return /^group:[^:]+:\d+:[^:]+$/.test(row.businessKey)
    && row.businessKey.startsWith(`group:${row.activityId}:`)
    && row.businessKey.endsWith(`:${row.orderId}`);
  return ["GROUP_FAILED", "ACTIVITY_CANCELED"].includes(row.type)
    && row.businessKey === `${row.type}:${row.activityId}:${row.orderId}`;
}
