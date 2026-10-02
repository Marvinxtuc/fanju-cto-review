import pg from '/tmp/fanju-freeze-2e7e012-20260930/services/api/node_modules/pg/lib/index.js';
import {readFile,readdir,writeFile} from 'node:fs/promises';
import {buildApp} from '/tmp/fanju-freeze-api-release-2e7e012/dist/app.js';
import {PrismaClient} from '/tmp/fanju-freeze-api-release-2e7e012/dist/generated/prisma/client.js';
import {PrismaPg} from '/tmp/fanju-freeze-2e7e012-20260930/services/api/node_modules/@prisma/adapter-pg/dist/index.mjs';
const url='postgresql://stage2@127.0.0.1:32771/fanju_freeze_legacy4_20260930',pool=new pg.Pool({connectionString:url}),db=new PrismaClient({adapter:new PrismaPg({connectionString:url})});
let app;
try{
const dirs=(await readdir('/tmp/fanju-freeze-2e7e012-20260930/prisma/migrations')).filter(x=>/^\d/.test(x)).sort();
for(const dir of dirs.slice(0,4))await pool.query(await readFile('/tmp/fanju-freeze-2e7e012-20260930/prisma/migrations/'+dir+'/migration.sql','utf8'));
app=await buildApp({prisma:db,providerEnv:{APP_ENV:'local',NODE_ENV:'test',LOCAL_DEMO_ENABLED:'false',SESSION_SECRET:'local-legacy-schema-fixture-signing-32-bytes',AUTH_PROVIDER:'mock',PHONE_PROVIDER:'mock',PAYMENT_PROVIDER:'mock',REFUND_PROVIDER:'mock',NEW_PAYMENTS_ENABLED:'false'}});
const origin=await app.listen({host:'127.0.0.1',port:0});const live=await fetch(origin+'/health'),ready=await fetch(origin+'/ready');
if(live.status!==200||ready.status!==503)throw new Error('Old schema readiness must reject');
const evidence={sha:'2e7e012e1f58e093f5913cdaeaa400b4bb7e30a7',schema:'baseline four migrations without expanded schema or migration evidence',liveness:live.status,readiness:ready.status,allowed:false,interpretation:'Process can start but must not receive business traffic; production deployment must honor readiness',externalRequests:0};await writeFile('/tmp/fanju-freeze-legacy-schema-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{if(app)await app.close();await db.$disconnect();await pool.end();}
