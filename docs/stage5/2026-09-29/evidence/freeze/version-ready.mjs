import {spawnSync} from 'node:child_process';
import {writeFile} from 'node:fs/promises';
import {PrismaClient} from '/tmp/fanju-freeze-api-release-2e7e012/dist/generated/prisma/client.js';
import {PrismaPg} from '/tmp/fanju-freeze-2e7e012-20260930/services/api/node_modules/@prisma/adapter-pg/dist/index.mjs';
import {buildApp} from '/tmp/fanju-freeze-api-release-2e7e012/dist/app.js';
const sha='2e7e012e1f58e093f5913cdaeaa400b4bb7e30a7',url='postgresql://stage2@127.0.0.1:32771/fanju_freeze_2e7e012_20260930';
const db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});let app;
try{
for(const mode of ['events-only','inbox-only']){const r=spawnSync(process.execPath,['dist/worker.js','--once'],{cwd:'/tmp/fanju-freeze-api-release-2e7e012',env:{...process.env,DATABASE_URL:url,WORKER_MODE:mode,RELEASE_VERSION:sha,FINANCIAL_CASE_OWNER:'local-freeze-review'},encoding:'utf8',timeout:15000});if(r.status!==0)throw new Error(mode+' failed');}
app=await buildApp({prisma:db,providerEnv:{APP_ENV:'local',NODE_ENV:'test',LOCAL_DEMO_ENABLED:'false',SESSION_SECRET:'local-freeze-readiness-signing-material-32-bytes',AUTH_PROVIDER:'mock',PHONE_PROVIDER:'mock',PAYMENT_PROVIDER:'mock',REFUND_PROVIDER:'mock',NEW_PAYMENTS_ENABLED:'false',RELEASE_VERSION:sha,REQUIRED_WORKER_MODES:'events-only,inbox-only'}});
const address=await app.listen({host:'127.0.0.1',port:0});const response=await fetch(address+'/ready');const result=await response.json();
const heartbeats=await db.workerHeartbeat.findMany({where:{version:sha,lastPolledAt:{gte:new Date(Date.now()-30000)}},select:{mode:true,version:true}});
if(response.status!==200||!['events-only','inbox-only'].every(m=>heartbeats.some(x=>x.mode===m)))throw new Error('Version heartbeat missing');
const evidence={sha,APIReadyStatus:response.status,result,heartbeats,versionBinding:'Worker versions checked separately in DB; /ready checks mode and freshness, does not itself enforce version equality',externalRequests:0};await writeFile('/tmp/fanju-freeze-version-ready-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{if(app)await app.close();await db.$disconnect();}
