import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import {writeFile} from 'node:fs/promises';
import pg from '/tmp/fanju-freeze-2e7e012-20260930/services/api/node_modules/pg/lib/index.js';
import {PrismaClient} from '/tmp/fanju-freeze-api-release-2e7e012/dist/generated/prisma/client.js';
import {PrismaPg} from '/tmp/fanju-freeze-2e7e012-20260930/services/api/node_modules/@prisma/adapter-pg/dist/index.mjs';
import {persistTrustedEvent} from '/tmp/fanju-freeze-api-release-2e7e012/dist/events/inbox.js';
const databaseUrl='postgresql://stage2@127.0.0.1:32771/fanju_freeze_2e7e012_20260930',prefix='freeze_2e7e012_reinstall';
const env={...process.env,DATABASE_URL:databaseUrl,APP_ENV:'local',NODE_ENV:'test',LOCAL_DEMO_ENABLED:'true',AUTH_PROVIDER:'mock',PHONE_PROVIDER:'mock',PAYMENT_PROVIDER:'mock',REFUND_PROVIDER:'mock',SESSION_SECRET:'local-freeze-reinstall-signing-material-32-bytes',API_HOST:'127.0.0.1',API_PORT:'0'};
const pool=new pg.Pool({connectionString:databaseUrl}),db=new PrismaClient({adapter:new PrismaPg({connectionString:databaseUrl})});let child;
async function start(){child=spawn(process.execPath,['dist/server.js'],{cwd:'/tmp/fanju-freeze-api-release-2e7e012',env,stdio:['ignore','pipe','pipe']});child.stderr.resume();return new Promise((resolve,reject)=>{let text='';const timer=setTimeout(()=>reject(new Error('API startup timeout')),10000);child.stdout.on('data',x=>{text+=x;const m=text.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);if(m){clearTimeout(timer);resolve(m[1]);}});child.once('exit',code=>{clearTimeout(timer);reject(new Error('Early API exit '+code));});});}
async function stop(){const ended=once(child,'exit');child.kill('SIGTERM');const [code]=await ended;if(code!==0)throw new Error('API stop failed '+code);child=null;}
async function request(origin,path,token,body){const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{'content-type':'application/json',...(token?{authorization:'Bearer '+token}:{})},...(body?{body:JSON.stringify(body)}:{})});if(!response.ok)throw new Error(path+' '+response.status);return response.json();}
try{
let origin=await start();const login=await request(origin,'/api/mock/wechat-login',null,{code:prefix});const uid=login.user.id,token=login.token;
await pool.query('INSERT INTO "Restaurant" (id,name,district,"businessArea",address,"contactName","contactPhone","budgetCents","cuisineTags",capacity,"updatedAt") VALUES ($1,$1,$1,$1,$1,$1,$2,9900,ARRAY[]::text[],6,now())',[prefix+'_restaurant','000']);
await pool.query('INSERT INTO "Activity" (id,"restaurantId",title,theme,description,district,"businessArea","startsAt","endsAt","registrationEndsAt","serviceFeeCents","mealFeePolicyText",capacity,"updatedAt") VALUES ($1,$2,$1,$1,$1,$1,$1,now()+interval $$2 day$$,now()+interval $$3 day$$,now()+interval $$1 day$$,9900,$1,6,now())',[prefix+'_activity',prefix+'_restaurant']);
await pool.query('INSERT INTO "Order" (id,"userId","activityId","amountCents",status,"agreementVersion","registrationActive","capacityHeld","updatedAt") VALUES ($1,$3,$4,9900,$$CLOSED$$,$$fixture$$,false,false,now()),($2,$3,$4,9900,$$PENDING_PAYMENT$$,$$fixture$$,true,true,now())',[prefix+'_old',prefix+'_active',uid,prefix+'_activity']);
const before=await request(origin,'/api/orders',token);if(before.orders.length!==2)throw new Error('Multiple historical order read failed');
const event=await persistTrustedEvent(db,{source:'local-reinstall-fixture',eventKey:prefix,verificationMaterialId:'synthetic-approved-test',evidence:{kind:'PAYMENT_SUCCEEDED',channel:'mock',merchantScope:'local-fixture',merchantOrderNo:prefix+'_unknown',channelTradeNo:prefix+'_trade',amountCents:9900,currency:'CNY',paidAt:new Date().toISOString(),evidenceHash:prefix}},'local-reinstall-review');
await stop();
const worker=spawnSync(process.execPath,['dist/worker.js','--once'],{cwd:'/tmp/fanju-freeze-api-release-2e7e012',env:{...env,WORKER_MODE:'events-only',FINANCIAL_CASE_OWNER:'local-reinstall-review'},encoding:'utf8',timeout:15000});if(worker.status!==0)throw new Error('Worker failed '+worker.stderr);
origin=await start();const after=await request(origin,'/api/orders',token);const receipt=await db.channelReceipt.findFirstOrThrow({where:{channelTradeNo:prefix+'_trade'}}),job=await db.durableJob.findFirstOrThrow({where:{refId:event.event.id}});
if(after.orders.length!==2||job.state!=='DONE')throw new Error('Restore lost persisted evidence');
await stop();
const evidence={sha:'2e7e012e1f58e093f5913cdaeaa400b4bb7e30a7',database:'fanju_freeze_2e7e012_20260930',migrationCount:(await pool.query('SELECT count(*)::int n FROM "_prisma_migrations" WHERE finished_at IS NOT NULL')).rows[0].n,operation:'Stop and reinstall exact frozen compatible API baseline; independent packaged worker consumes persisted event during downtime',crossVersionRollback:false,ordersBefore:before.orders.length,ordersAfter:after.orders.length,orderIds:after.orders.map(x=>x.id).sort(),receiptId:receipt.id,receiptCount:1,jobState:job.state,workerExit:worker.status,APIStops:'SIGTERM exit 0 twice',externalRequests:0};await writeFile('/tmp/fanju-freeze-reinstall-evidence.json',JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence));
}finally{if(child)await stop();await db.$disconnect();await pool.end();}
