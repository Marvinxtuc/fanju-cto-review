import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {PrismaPg} from '@prisma/adapter-pg';
import {PrismaClient} from '../generated/prisma/client.js';
import {createWechatProviders} from '../providers.js';
import {bindingFor} from '../funding/intents.js';
import {createWechatChannel} from './wechat-channel.js';
import {configuredRuntimeAuthoritySource} from './formal-authority-source.js';
import {formalRefundService} from './formal-refund-service.js';
import {formalQualifier} from './formal-qualification.js';
import {wechatQueryHandlers} from './wechat-query-handlers.js';
import {followupFormalRefundBatch} from './formal-refund-followup.js';
import {formalLifecycleHandler,scheduleFormalLifecycleBatch} from './formal-lifecycle.js';
import {runOne} from '../jobs/queue.js';
import {recordWorkerPoll} from '../jobs/heartbeat.js';
import {channelWorkerMode} from './channel-worker-mode.js';
if(process.env.FEATURE_V11_FORMAL_BUSINESS!=='true'||process.env.FEATURE_V11_FORMAL_PAYMENT!=='true'
 ||!process.env.DATABASE_URL||!process.env.V11_FORMAL_CASE_OWNER?.trim()||!process.env.RELEASE_VERSION?.trim()
 ||process.env.PAYMENT_PROVIDER!=='wechat'||process.env.REFUND_PROVIDER!=='wechat')throw Error('Explicit formal business worker configuration required');
const providers=createWechatProviders(process.env),channel=createWechatChannel(process.env,providers.payment,providers.refund);
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const source=configuredRuntimeAuthoritySource(process.env),owner=randomUUID(),caseOwner=process.env.V11_FORMAL_CASE_OWNER;
const refunds=formalRefundService(db,source,channel,caseOwner);
const handlers={...wechatQueryHandlers(db,channel,caseOwner,formalQualifier(db,source,channel)),...refunds.handlers,V11_FORMAL_LIFECYCLE:formalLifecycleHandler(db,source,bindingFor(process.env,'wechat'))};
let lifecycleCursor:string|undefined,refundCursor:string|undefined;let sweepAt=0;let stopping=false;const stop=()=>{stopping=true;};for(const signal of ['SIGINT','SIGTERM'] as const)process.once(signal,stop);
try{do{
 if(Date.now()>=sweepAt){const followup=await followupFormalRefundBatch(db,source,bindingFor(process.env,'wechat'),refunds,caseOwner,refundCursor);refundCursor=followup.nextCursor??undefined;sweepAt=Date.now()+1000;}
 const scheduled=await scheduleFormalLifecycleBatch(db,bindingFor(process.env,'wechat'),lifecycleCursor);lifecycleCursor=scheduled.nextCursor??undefined;
 const worked=await runOne(db,owner,caseOwner,handlers,['V11_QUERY_PAYMENT','V11_WECHAT_REFUND','V11_QUERY_REFUND','V11_FORMAL_LIFECYCLE'],bindingFor(process.env,'wechat'));
 await recordWorkerPoll(db,channelWorkerMode('v11-formal-business',bindingFor(process.env,'wechat')),owner,process.env.RELEASE_VERSION);
 if(process.argv.includes('--once'))break;if(!worked&&!stopping)await delay(250);
}while(!stopping);}finally{for(const signal of ['SIGINT','SIGTERM'] as const)process.off(signal,stop);await db.$disconnect();}
