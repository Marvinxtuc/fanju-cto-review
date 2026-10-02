import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { verifyOwnedDatabase, TASK_ID } from './ownership.js';
import { recoveryHandlers } from './domain.js';
import { PersistentMockChannel } from '../funding/mock-channel.js';
import { aftersalesHandlers } from './aftersales.js';
import { runOne } from '../jobs/queue.js';
if(!process.env.PRELAUNCH_CHANNEL_DATABASE_URL||!process.env.PRELAUNCH_CHANNEL_DATABASE_NAME)throw Error('Owned channel database required');
const channelDb=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.PRELAUNCH_CHANNEL_DATABASE_URL})});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
await verifyOwnedDatabase(db,process.env);
await verifyOwnedDatabase(channelDb,{...process.env,PRELAUNCH_DATABASE_NAME:process.env.PRELAUNCH_CHANNEL_DATABASE_NAME});
async function channelSuccessHook(kind: "PAYMENT"|"REFUND", intentId:string) {
 if(process.env.PRELAUNCH_FAULT_POINT!=="CHANNEL_SUCCEEDED_BEFORE_LOCAL_ACK")return;
 if(!process.send||process.env.PRELAUNCH_FAULT_RUN_ID===undefined)throw Error("Fault harness IPC required");
 const runId=process.env.PRELAUNCH_FAULT_RUN_ID;
 process.send({type:"PRELAUNCH_FAULT_BARRIER",point:"CHANNEL_SUCCEEDED_BEFORE_LOCAL_ACK",task_id:TASK_ID,owner_id:process.env.PRELAUNCH_OWNER_MARKER,pid:process.pid,runId,kind,intentId});
 await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>{process.off("message",listener);reject(Error("Fault harness timeout"));},30_000);function listener(message:unknown){if(message!==null&&typeof message==="object"&&(message as {type?:string}).type==="PRELAUNCH_FAULT_CONTINUE"&&(message as {runId?:string}).runId===runId){clearTimeout(timer);process.off("message",listener);resolve();}}process.on("message",listener);});
}
const handlers={...recoveryHandlers(db,new PersistentMockChannel(channelDb),channelSuccessHook),...aftersalesHandlers(db)};
const owner=randomUUID();let stopping=false;let timer:ReturnType<typeof setTimeout>|undefined;
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{stopping=true;timer=setTimeout(()=>process.exit(1),15_000);timer.unref();});
process.send?.({type:'PRELAUNCH_WORKER_READY',task_id:TASK_ID,owner_id:process.env.PRELAUNCH_OWNER_MARKER,pid:process.pid});
try{do{const worked=await runOne(db,owner,'local-simulation-ops',handlers,Object.keys(handlers));if(process.argv.includes('--once'))break;if(!worked&&!stopping)await delay(100);}while(!stopping);}finally{if(timer)clearTimeout(timer);await Promise.all([db.$disconnect(),channelDb.$disconnect()]);}
