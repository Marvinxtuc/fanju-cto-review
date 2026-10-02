import {channelWorkerMode} from './channel-worker-mode.js';
import { bindingFor } from '../funding/intents.js';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { createWechatProviders } from '../providers.js';
import { createWechatChannel } from './wechat-channel.js';
import { wechatQueryHandlers } from './wechat-query-handlers.js';
import { runOne } from '../jobs/queue.js';
import { recordWorkerPoll } from '../jobs/heartbeat.js';

// Explicit, query-only worker. It cannot consume prepayment/refund/qualification jobs.
if (process.env.FEATURE_V11_QUERY_RECOVERY !== 'true' || !process.env.DATABASE_URL
  || !process.env.FINANCIAL_CASE_OWNER?.trim() || !process.env.RELEASE_VERSION?.trim()
  || process.env.PAYMENT_PROVIDER !== 'wechat' || process.env.REFUND_PROVIDER !== 'wechat')
  throw Error('Explicit real query worker configuration required');
const providers = createWechatProviders(process.env);
const channel = createWechatChannel(process.env, providers.payment, providers.refund);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const handlers = wechatQueryHandlers(db, channel, process.env.FINANCIAL_CASE_OWNER);
const owner = randomUUID(); let stopping = false; let timer: ReturnType<typeof setTimeout> | undefined;
for (const signal of ['SIGINT','SIGTERM'] as const) process.once(signal, () => {
  stopping = true; timer = setTimeout(() => process.exit(1), 15000); timer.unref();
});
try {
  do {
    const worked = await runOne(db, owner, process.env.FINANCIAL_CASE_OWNER, handlers, ['V11_QUERY_PAYMENT','V11_QUERY_REFUND'], bindingFor(process.env,'wechat'));
    await recordWorkerPoll(db, 'v11-wechat-query', owner, process.env.RELEASE_VERSION);
  await recordWorkerPoll(db,channelWorkerMode('v11-wechat-query',bindingFor(process.env,'wechat')),owner,process.env.RELEASE_VERSION);
    if (process.argv.includes('--once')) break;
    if (!worked && !stopping) await delay(250);
  } while (!stopping);
} finally { if (timer) clearTimeout(timer); await db.$disconnect(); }
