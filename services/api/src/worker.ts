import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { runOne } from "./jobs/queue.js";
import { applyEvent } from "./events/inbox.js";
import { prepareObligation } from "./funding/refunds.js";
import { PersistentMockChannel, LOCAL_MOCK_BINDING } from "./funding/mock-channel.js";
import { recoveryHandlers } from "./funding/recovery.js";
import { expireOrder } from "./orders/inventory.js";
import { deliverInbox } from "./orders/formation.js";
import { recordWorkerPoll } from "./jobs/heartbeat.js";

// Event-only consumption applies already-verified inbox facts and has no channel I/O handlers.
const eventsOnly = process.env.WORKER_MODE === "events-only";
const inboxOnly = process.env.WORKER_MODE === "inbox-only";
if (process.env.WORKER_MODE && !["events-only", "inbox-only", "local-recovery"].includes(process.env.WORKER_MODE)) throw new Error("Unknown worker mode");
if (!process.env.DATABASE_URL) throw new Error("Worker requires explicit DATABASE_URL");
if (eventsOnly) {
  if (!process.env.FINANCIAL_CASE_OWNER?.trim()) throw new Error("Event worker requires a responsible case owner");
} else if (!inboxOnly && (!["local", "ci"].includes(process.env.APP_ENV ?? "") || !["test", "development"].includes(process.env.NODE_ENV ?? "")
  || process.env.PAYMENT_PROVIDER !== "mock" || process.env.REFUND_PROVIDER !== "mock")) {
  throw new Error("Local recovery worker requires explicit isolated environment and mock channels");
}
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const owner = randomUUID();
const mode = eventsOnly ? "events-only" : inboxOnly ? "inbox-only" : "local-recovery";
const caseOwner = process.env.FINANCIAL_CASE_OWNER?.trim() || "local-review-required";
const recovery = !eventsOnly && !inboxOnly ? recoveryHandlers(db, new PersistentMockChannel(db), caseOwner) : null;
const mockChannel = !eventsOnly && !inboxOnly ? new PersistentMockChannel(db) : null;
let stopping = false;
let shutdownTimer: ReturnType<typeof setTimeout> | undefined;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => {
  stopping = true;
  // A killed worker leaves the durable lease for the next process to reclaim.
  shutdownTimer = setTimeout(() => process.exit(1), 15_000);
  shutdownTimer.unref();
});
try {
  console.log(eventsOnly ? "Event recovery worker ready" : inboxOnly ? "Inbox worker ready" : "Local recovery worker ready");
  do {
    const worked = await runOne(db, owner, caseOwner, eventsOnly ? {
      APPLY_EVENT: lease => applyEvent(db, lease.refId, caseOwner),
    } : inboxOnly ? {
      DELIVER_INBOX: async lease => { await db.$transaction(tx => deliverInbox(tx, lease.refId)); },
    } : {
      ...recovery!,
      APPLY_EVENT: lease => applyEvent(db, lease.refId, caseOwner),
      REFUND_OBLIGATION: async lease => { await prepareObligation(db, lease.refId, caseOwner); },
      EXPIRE_ORDER: async lease => {
        const result = await expireOrder(db, lease.refId, mockChannel!, caseOwner);
        if (result.kind === "early" || result.kind === "unknown") throw new Error("Inventory expiry still requires recovery");
      },
      DELIVER_INBOX: async lease => { await db.$transaction(tx => deliverInbox(tx, lease.refId)); },
    }, eventsOnly ? ["APPLY_EVENT"] : inboxOnly ? ["DELIVER_INBOX"] : [
      // A legacy worker must not consume newer domain jobs or burn their retry budget.
      ...Object.keys(recovery!), "APPLY_EVENT", "REFUND_OBLIGATION", "EXPIRE_ORDER", "DELIVER_INBOX",
    ], recovery ? { ...LOCAL_MOCK_BINDING, scopedKinds: ["RECOVER_PAYMENT", "RECOVER_REFUND"] } : undefined);
    await recordWorkerPoll(db, mode, owner, process.env.RELEASE_VERSION?.trim() || "local-unversioned");
    if (process.argv.includes("--once")) break;
    if (!worked && !stopping) await delay(250);
  } while (!stopping);
} finally {
  if (shutdownTimer) clearTimeout(shutdownTimer);
  await db.$disconnect();
}
