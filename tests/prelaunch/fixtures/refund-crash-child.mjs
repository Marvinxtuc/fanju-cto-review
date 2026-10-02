import {createRequire} from 'node:module';
import {resolve,dirname} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,verifyOwnedEnvironment} from '../../../scripts/prelaunch-owned-env.mjs';
const [instructionId,jobId]=process.argv.slice(2);
if(process.env.PRELAUNCH_MODE!=='SIMULATION_ONLY'||!process.send)throw Error('Owned synthetic IPC child required');
const {runtime}=await verifyOwnedEnvironment(dirname(process.env.PRELAUNCH_ENV_FILE));
const source=process.env.PRELAUNCH_SOURCE_ROOT??root;const require=createRequire(resolve(source,'services/api/package.json'));
const {PrismaPg}=require('@prisma/adapter-pg');const {PrismaClient}=await import(pathToFileURL(resolve(source,'services/api/dist/generated/prisma/client.js')));
const {createRefundDispatcher}=await import(pathToFileURL(resolve(source,'services/api/dist/prelaunch/refund-dispatch.js')));
const db=new PrismaClient({adapter:new PrismaPg({connectionString:runtime.database_url})});
try{
 const instruction=await db.v11RefundInstruction.findUniqueOrThrow({where:{id:instructionId}});
 if(!instruction.registrationId?.startsWith('preparation_native_')||instruction.providerConfigId!=='synthetic-v1'||instruction.merchantScope!=='a'.repeat(64))throw Error('Synthetic crash fixture required');
 const lease=await db.durableJob.findUniqueOrThrow({where:{id:jobId}});
 const dispatch=createRefundDispatcher(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:instruction.merchantRefundNo,status:'NOT_FOUND'};},async submitRefund(_input,guard){
  await guard();process.send({kind:'SYNTHETIC_SEND_ENTERED'});setInterval(()=>{},1000);await new Promise(()=>{});
 }},async()=>{}); // Explicit synthetic authorizer, never production assembly.
 await dispatch(instructionId,lease);
}finally{await db.$disconnect();}
