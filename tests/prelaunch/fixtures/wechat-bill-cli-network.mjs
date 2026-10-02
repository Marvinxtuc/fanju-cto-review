// Owned synthetic CLI subprocess only. No sockets or genuine channel material.
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash,createSign,X509Certificate} from 'node:crypto';
const config=JSON.parse(readFileSync(process.env.FANJU_BILL_CLI_FIXTURE,'utf8'));
// The owned network guard initializes under its required mock-only process env.
// Switch only this synthetic request fixture after guard installation; all
// real socket APIs stay guarded and the fake fetch rejects other destinations.
Object.assign(process.env,config.env);
const key=readFileSync(config.directory+'/key.pem','utf8'),cert=readFileSync(config.directory+'/cert.pem','utf8'),raw=readFileSync(config.directory+'/persisted-bill.csv');
globalThis.fetch=async input=>{
 const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
 if(url.origin!=='https://api.mch.weixin.qq.com')throw Error('Unexpected synthetic CLI destination');
 const counter=config.directory+'/cli-fetch-count';writeFileSync(counter,String(Number(readFileSync(counter,'utf8'))+1),{mode:0o600});
 if(url.pathname==='/v3/bill/tradebill'&&url.searchParams.get('bill_date')==='2026-09-30'&&url.searchParams.get('bill_type')==='ALL'){
  const body=JSON.stringify({hash_type:'SHA1',hash_value:createHash('sha1').update(raw).digest('hex'),download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture-bill'}),timestamp=String(Math.floor(Date.now()/1000)),nonce='synthetic-cli-nonce';const signer=createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${body}\n`);signer.end();
  return new Response(body,{headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':new X509Certificate(cert).serialNumber,'wechatpay-signature':signer.sign(key,'base64')}});
 }
 if(url.pathname==='/v3/billdownload/file'&&url.searchParams.get('token')==='fixture-bill')return new Response(raw);
 throw Error('Unexpected synthetic CLI request');
};
