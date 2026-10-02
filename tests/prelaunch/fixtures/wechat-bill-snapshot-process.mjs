import {readFileSync} from 'node:fs';
import {createHash,createSign,X509Certificate} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {createRequire} from 'node:module';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo||!process.send)throw Error('Explicit owned process required');
const config=await new Promise(resolve=>process.once('message',resolve));
const require=createRequire(repo+'/services/api/package.json'),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(repo+'/services/api/dist/generated/prisma/client.js'));
const {verifyOwnedDatabase}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/ownership.js'));
const {downloadWechatTradeBill}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/wechat-trade-bill.js'));
const {loadBillComparisonSnapshot}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/wechat-bill-comparison-core.js'));
const connection=new URL(process.env.DATABASE_URL);if(config.marker)connection.searchParams.set('application_name',config.marker);
const db=new PrismaClient({adapter:new PrismaPg({connectionString:connection.toString()})});
try{
 await verifyOwnedDatabase(db,process.env);
 const key=readFileSync(config.directory+'/key.pem','utf8'),cert=readFileSync(config.directory+'/cert.pem','utf8'),raw=readFileSync(config.directory+'/persisted-bill.csv');
 const body=JSON.stringify({hash_type:'SHA1',hash_value:createHash('sha1').update(raw).digest('hex'),download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture-bill'}),timestamp=String(Math.floor(Date.now()/1000)),nonce='synthetic-snapshot-process';const signer=createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${body}\n`);signer.end();let calls=0;
 const bill=await downloadWechatTradeBill(config.env,'2026-09-30',{readFile:path=>path==='synthetic-private'?key:cert,fetch:async()=>++calls===1?new Response(body,{headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':new X509Certificate(cert).serialNumber,'wechatpay-signature':signer.sign(key,'base64')}}):new Response(raw)});
 const loaded=await db.$transaction(tx=>loadBillComparisonSnapshot(tx,config.env,bill,config.owner,config.release,config.snapshotId));
 const reply={status:'LOADED',receiptCount:loaded.facts.receipts.length,snapshotHash:loaded.snapshotHash,datesRestored:loaded.facts.receipts.every(x=>x.paidAt===null||x.paidAt instanceof Date)};
 if(config.page){const {commitBillComparisonPage}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/wechat-bill-page-checkpoint.js'));reply.pageStatus=(await commitBillComparisonPage(db,config.env,bill,config.owner,config.release,config.snapshotId,config.page)).status;}
 if(config.finalize){const {reconcileDownloadedWechatBillPaged}=await import(pathToFileURL(repo+'/services/api/dist/prelaunch/wechat-bill-page-checkpoint.js'));reply.finalResult=await reconcileDownloadedWechatBillPaged(db,config.env,bill,config.owner,config.release,config.snapshotId);}
 process.send(reply);
 if(config.pauseAfterPage)await new Promise(()=>{});
}catch{process.send({status:'REJECTED'});process.exitCode=1;}
finally{await db.$disconnect();process.disconnect();}
