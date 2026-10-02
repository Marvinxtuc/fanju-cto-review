import { PrismaClient } from '../generated/prisma/client.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { buildPrelaunchApp } from './routes.js';
import { TASK_ID } from './ownership.js';
const env=process.env;
if(!process.env.PRELAUNCH_CHANNEL_DATABASE_URL||!process.env.PRELAUNCH_CHANNEL_DATABASE_NAME)throw Error('Owned channel database required');
const channelDb=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.PRELAUNCH_CHANNEL_DATABASE_URL})});
const db=new PrismaClient({adapter:new PrismaPg({connectionString:env.DATABASE_URL})});
const root=resolve(fileURLToPath(new URL('../../../..',import.meta.url)));
const app=await buildPrelaunchApp(db,env,root,channelDb);
let stopping=false;
for(const signal of ['SIGINT','SIGTERM']as const)process.once(signal,()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>process.exit(1),15_000);timer.unref();void app.close().then(()=>Promise.all([db.$disconnect(),channelDb.$disconnect()])).then(()=>{clearTimeout(timer);},()=>{clearTimeout(timer);process.exitCode=1;});});
const port=Number(env.PRELAUNCH_API_PORT??0);
if(!Number.isInteger(port)||port<0||port>65535)throw Error('Invalid local port');
try{await app.listen({host:'127.0.0.1',port});const address=app.server.address();if(!address||typeof address==='string')throw Error('Local listener missing');process.send?.({type:'PRELAUNCH_READY',task_id:TASK_ID,owner_id:env.PRELAUNCH_OWNER_MARKER,port:address.port,pid:process.pid});console.log(JSON.stringify({kind:'PRELAUNCH_READY',scope:'SIMULATION_ONLY',port:address.port,pid:process.pid}));}catch{await Promise.all([db.$disconnect(),channelDb.$disconnect()]);process.exitCode=1;}
