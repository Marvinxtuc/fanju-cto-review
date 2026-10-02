// Dedicated test harness: only the owned simulated notice-list read is faulted.
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Owned source required');
const require=createRequire(`${repo}/services/api/package.json`);const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {buildPrelaunchApp}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/routes.js`));
const {TASK_ID}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});const channel=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.PRELAUNCH_CHANNEL_DATABASE_URL})});
const model=new Proxy(db.v11DeliveryProof,{get(target,key){if(key==='findMany')return args=>{if(args?.where?.registration?.userId===process.env.PRELAUNCH_HTTP_DOM_USER_ID)throw Error('synthetic notice list unavailable');return target.findMany(args);};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
const guarded=new Proxy(db,{get(target,key){if(key==='v11DeliveryProof')return model;const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
const app=await buildPrelaunchApp(guarded,process.env,repo,channel);await app.listen({host:'127.0.0.1',port:0});
process.send?.({type:'PRELAUNCH_READY',task_id:TASK_ID,owner_id:process.env.PRELAUNCH_OWNER_MARKER,port:app.server.address().port,pid:process.pid});
let stopping=false;process.once('SIGTERM',async()=>{if(stopping)return;stopping=true;await app.close();await Promise.all([db.$disconnect(),channel.$disconnect()]);process.disconnect?.();});
