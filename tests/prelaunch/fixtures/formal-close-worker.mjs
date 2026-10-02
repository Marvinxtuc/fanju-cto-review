import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT,id=process.env.PRELAUNCH_TEST_CLOSE_ID;if(!repo||!id||!process.send)throw Error('Owned IPC close fixture required');
const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const load=p=>import(pathToFileURL(`${repo}/services/api/dist/${p}.js`));
const {PrismaClient}=await load('generated/prisma/client'),{verifyOwnedDatabase}=await load('prelaunch/ownership'),{createWechatChannel}=await load('prelaunch/wechat-channel'),{runFormalPaymentCloseWorker}=await load('prelaunch/formal-payment-close-runtime');
const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});
const pause=()=>new Promise(resolve=>process.once('message',()=>resolve()));
try{
 await verifyOwnedDatabase(db,process.env);const intent=await db.v11PaymentIntent.findUniqueOrThrow({where:{id}}),source='owned-test-close-channel';
 const env={WECHAT_PAY_MCH_ID:process.env.PRELAUNCH_TEST_CLOSE_MCH,WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_PAY_CONFIG_VERSION:intent.providerConfigId};
 const payment={mode:'wechat',queryPayment:async order=>{
  if(order!==intent.merchantOrderNo)throw Error('Fixture scope mismatch');
  const event=await db.receivedEvent.findUnique({where:{source_merchantScope_eventKey:{source,merchantScope:intent.merchantScope,eventKey:id}}});
  process.send({stage:event?'RECOVERED':'QUERIED'});
  if(process.env.PRELAUNCH_TEST_CLOSE_MODE==='before'&&!event)await pause();
  return {merchantOrderNo:order,status:event?'CLOSED':'PENDING',amountCents:intent.totalCents,currency:'CNY'};
 },closePayment:async(_order,guard)=>{
  await guard();await db.receivedEvent.create({data:{source,merchantScope:intent.merchantScope,eventKey:id,payloadHash:'synthetic',normalizedPayload:{syntheticClosed:true},verificationMaterialId:'owned-fixture',verifiedAt:new Date()}});
  process.send({stage:'SENT'});if(process.env.PRELAUNCH_TEST_CLOSE_MODE==='after'||process.env.PRELAUNCH_TEST_CLOSE_MODE==='drain')await pause();
 }};
 const channel=createWechatChannel(env,payment,{mode:'wechat',queryRefund:async()=>{throw Error('Forbidden fixture refund');}});
 await runFormalPaymentCloseWorker(db,channel,{channel:intent.channel,merchantScope:intent.merchantScope,providerConfigId:intent.providerConfigId},'owned-close-worker','owned-close-case','owned-close-release',process.env.PRELAUNCH_TEST_CLOSE_MODE!=='drain');
}finally{await db.$disconnect();process.disconnect();}
