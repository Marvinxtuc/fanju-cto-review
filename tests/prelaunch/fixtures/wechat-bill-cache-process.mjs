import {readFileSync} from 'node:fs';
import {createHash,createSign,X509Certificate} from 'node:crypto';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit owned source required');
const {downloadWechatTradeBill}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-trade-bill.js`));
const dir=process.env.BILL_CACHE_QA_ROOT;if(!dir)throw Error('Explicit owned cache fixture required');
const key=readFileSync(dir+'/key.pem','utf8'),cert=readFileSync(dir+'/cert.pem','utf8'),rawBill=Buffer.from('synthetic exact bill bytes only');
const metadata=JSON.stringify({hash_type:'SHA1',hash_value:createHash('sha1').update(rawBill).digest('hex'),download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture-bill'});
const timestamp=String(Math.floor(Date.now()/1000)),nonce='synthetic-process-nonce',signer=createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${metadata}\n`);signer.end();
const headers={'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':new X509Certificate(cert).serialNumber,'wechatpay-signature':signer.sign(key,'base64')};
const env={WECHAT_PAY_ENABLED:'true',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat',WECHAT_PAY_MCH_ID:'synthetic-cache-mch',WECHAT_MINIAPP_APP_ID:'synthetic-cache-app',WECHAT_PAY_PRIVATE_KEY_PATH:'synthetic-private',WECHAT_PAY_PLATFORM_CERT_PATH:'synthetic-platform',WECHAT_PAY_CERT_SERIAL_NO:'synthetic-serial',WECHAT_PAY_CONFIG_VERSION:'synthetic-cache-v1'};
let calls=0;
try{
 const bill=await downloadWechatTradeBill(env,'2026-09-30',{cacheDirectory:dir+'/cache',readFile:path=>path==='synthetic-private'?key:cert,fetch:async()=>{calls++;if(calls===1)return new Response(metadata,{headers});if(process.env.BILL_CACHE_QA_RECOVERY==='true')throw Error('Unexpected repeated download');return new Response(rawBill);}});
 console.log(JSON.stringify({status:'VERIFIED',calls,sourceSha256:bill.sourceSha256,coverageState:bill.coverageState}));
}catch{console.log(JSON.stringify({status:'REJECTED',calls}));process.exitCode=1;}
