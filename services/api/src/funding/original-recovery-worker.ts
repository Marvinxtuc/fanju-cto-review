import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { createWechatProviders } from "../providers.js";
import { runOne } from "../jobs/queue.js";
import { recordWorkerPoll } from "../jobs/heartbeat.js";
import { OriginalChannelRegistry } from "./original-channel.js";
import { originalRecoveryHandlers } from "./original-recovery.js";
import { loadOriginalRecoveryAuthority } from "./original-recovery-authority.js";
import { assertOriginalRecoveryTargetAddress, assertOriginalRecoveryTargetIdentity } from "./original-recovery-target.js";

if (process.env.LEGACY_REAL_RECOVERY_ENABLED !== "true" || process.env.NODE_ENV !== "production" || process.env.APP_ENV !== "production"
  || !process.env.DATABASE_URL || !process.env.RELEASE_VERSION?.trim()) throw Error("Explicit production legacy recovery enablement and target required");
const repoRoot = fileURLToPath(new URL("../../../../", import.meta.url));
const authority = loadOriginalRecoveryAuthority(process.env, repoRoot);
assertOriginalRecoveryTargetAddress(process.env.DATABASE_URL, authority.manifest.target);
const providers = createWechatProviders({ ...authority.config, AUTH_PROVIDER: "mock", PHONE_PROVIDER: "mock", PAYMENT_PROVIDER: "wechat", REFUND_PROVIDER: "wechat",
  NODE_ENV: "production", APP_ENV: "production", NEW_PAYMENTS_ENABLED: "false" }, { readFile: authority.readCredential });
const registry = new OriginalChannelRegistry();
registry.registerWechat(authority.config, providers.payment, providers.refund);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const owner = randomUUID(); let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => { stopping = true; });
try {
  await assertOriginalRecoveryTargetIdentity(db, authority.manifest.target);
  const handlers = originalRecoveryHandlers(db, registry, authority.manifest.owner, authority.authorize);
  do {
    const worked = await runOne(db, owner, authority.manifest.owner, handlers, ["RECOVER_PAYMENT", "RECOVER_REFUND"],
      { ...authority.binding, refIds: authority.manifest.grants.map(g => g.id) });
    await recordWorkerPoll(db, "legacy-original-recovery", owner, process.env.RELEASE_VERSION);
    if (process.argv.includes("--once")) break;
    if (!worked && !stopping) await delay(250);
  } while (!stopping);
} finally { await db.$disconnect(); }
