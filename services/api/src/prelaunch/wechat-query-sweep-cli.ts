import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../generated/prisma/client.js';
import { bindingFor } from '../funding/intents.js';
import { createWechatProviders } from '../providers.js';
import { createWechatChannel } from './wechat-channel.js';
import { scheduleWechatQuerySweep } from './wechat-query-sweep.js';

// Explicit invocation only. Supply the same UUID on retry after a lost response.
const [runId, ...extra] = process.argv.slice(2);
if (extra.length || !runId || !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId) || process.env.FEATURE_V11_RECONCILIATION_QUERY !== 'true'
  || process.env.FEATURE_V11_QUERY_RECOVERY !== 'true' || !process.env.DATABASE_URL
  || !process.env.FINANCIAL_CASE_OWNER?.trim() || !process.env.RELEASE_VERSION?.trim()
  || process.env.PAYMENT_PROVIDER !== 'wechat' || process.env.REFUND_PROVIDER !== 'wechat')
  throw Error('Explicit real query sweep configuration and run UUID required');
const providers = createWechatProviders(process.env);
createWechatChannel(process.env, providers.payment, providers.refund);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  console.log(JSON.stringify(await scheduleWechatQuerySweep(db, bindingFor(process.env, 'wechat'),
    process.env.FINANCIAL_CASE_OWNER, process.env.RELEASE_VERSION, runId)));
} finally { await db.$disconnect(); }
