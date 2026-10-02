import {createHash,timingSafeEqual} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {z} from 'zod';
import {signedWechatPayRequest,type ProviderEnv} from '../providers.js';
import {readBillCache,writeBillCache,validateBillCacheDirectory} from './wechat-bill-cache.js';
import {bindingFor} from '../funding/intents.js';

const metadataSchema=z.object({hash_type:z.literal('SHA1'),hash_value:z.string().regex(/^[a-fA-F0-9]{40}$/),download_url:z.string().max(4096)}).strict();
const limit=32*1024*1024;
const verified=new WeakMap<object,string>();
export function assertDownloadedTradeBill(bill:Awaited<ReturnType<typeof downloadWechatTradeBill>>){
 const identity=JSON.stringify([bill.binding,bill.billDate,bill.billType,bill.sourceSha256,bill.metadataSha256,bill.channelHashType,bill.channelHashValue,bill.verifiedAt,bill.scope,bill.coverageState]);
 if(verified.get(bill)!==identity||createHash('sha256').update(bill.rawBill).digest('hex')!==bill.sourceSha256)fail();
}
function fail():never{throw Error('Wechat trade bill unavailable or integrity rejected');}
function period(value:string,now:number){
 if(!/^\d{4}-\d{2}-\d{2}$/.test(value))fail();
 const at=Date.parse(value+'T00:00:00+08:00');
 if(!Number.isFinite(at)||new Date(at+8*3600000).toISOString().slice(0,10)!==value)fail();
 const today=new Date(now+8*3600000).toISOString().slice(0,10);
 if(value>=today)fail();
}
async function bytes(response:Response,max:number){
 if(!response.ok||!response.body)fail();
 const length=response.headers.get('content-length');if(length&&(!/^\d+$/.test(length)||Number(length)>max))fail();
 const reader=response.body.getReader();let total=0;const chunks:Uint8Array[]=[];
 try{while(true){const next=await reader.read();if(next.done)break;total+=next.value.byteLength;if(total>max)fail();chunks.push(next.value);}}
 finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
 return Buffer.concat(chunks,total);
}
function downloadPath(value:string){
 let url:URL;try{url=new URL(value);}catch{fail();}
 if(url.origin!=='https://api.mch.weixin.qq.com'||url.username||url.password||url.hash||url.pathname!=='/v3/billdownload/file')fail();
 const keys=[...url.searchParams.keys()];if(keys.length!==1||keys[0]!=='token'||!url.searchParams.get('token'))fail();
 return url.pathname+url.search;
}

// Trusted metadata signature -> fixed HTTPS download endpoint -> exact file SHA1.
// Downloading a complete byte stream does not certify CSV/accounting coverage.
// Returned raw bytes may contain financial/identity data; never log or commit them.
export async function downloadWechatTradeBill(env:ProviderEnv,billDate:string,options:{fetch?:typeof fetch;readFile?:(path:string)=>string;now?:()=>number;cacheDirectory?:string}={}){
 if(options.cacheDirectory!==undefined)validateBillCacheDirectory(options.cacheDirectory);
 const now=options.now??Date.now;period(billDate,now());
 const binding=bindingFor(env,'wechat');
 if(env.WECHAT_PAY_ENABLED!=='true'||env.PAYMENT_PROVIDER!=='wechat'||env.REFUND_PROVIDER!=='wechat')fail();
 const readFile=options.readFile??((path:string)=>readFileSync(path,'utf8'));
 const http=options.fetch??fetch;
 const path='/v3/bill/tradebill?bill_date='+encodeURIComponent(billDate)+'&bill_type=ALL';
 const request=signedWechatPayRequest(env,readFile,path,undefined,'GET');
 const response=await http(request.url,{method:'GET',headers:request.headers!,redirect:'error',signal:AbortSignal.timeout(10000)});
 const metadataBytes=await bytes(response,262144);const raw=metadataBytes.toString('utf8');
 if(!Buffer.from(raw,'utf8').equals(metadataBytes))fail();
 request.verifyResponse!(raw,response.headers);
 let parsed:unknown;try{parsed=JSON.parse(raw);}catch{fail();}
 const metadata=metadataSchema.safeParse(parsed);if(!metadata.success)fail();
 const filePath=downloadPath(metadata.data.download_url);
 // Every recovery starts with freshly verified channel metadata. Neither a
 // local marker nor an old signature grants provenance to cached bytes.
 const cacheKey=createHash('sha256').update(JSON.stringify(['v11-bill-cache-1',binding,billDate,metadata.data.hash_type,metadata.data.hash_value.toLowerCase()])).digest('hex');
 let rawBill=options.cacheDirectory?readBillCache(options.cacheDirectory,cacheKey,limit):undefined;
 const cacheHit=rawBill!==undefined;
 if(!rawBill){
  const fileRequest=signedWechatPayRequest(env,readFile,filePath,undefined,'GET');
  const fileResponse=await http(fileRequest.url,{method:'GET',headers:{...fileRequest.headers,accept:'application/octet-stream'},redirect:'error',signal:AbortSignal.timeout(30000)});
  rawBill=await bytes(fileResponse,limit);
 }
 if(rawBill.length===0)fail();
 const digest=createHash('sha1').update(rawBill).digest();
 if(!timingSafeEqual(digest,Buffer.from(metadata.data.hash_value,'hex')))fail();
 if(options.cacheDirectory&&!cacheHit)writeBillCache(options.cacheDirectory,cacheKey,rawBill);
 const result={binding,billDate,billType:'ALL' as const,rawBill,sourceSha256:createHash('sha256').update(rawBill).digest('hex'),
  metadataSha256:createHash('sha256').update(raw).digest('hex'),channelHashType:'SHA1' as const,channelHashValue:metadata.data.hash_value.toLowerCase(),verifiedAt:new Date(now()).toISOString(),
  scope:'VERIFIED_BILL_BYTES_ONLY' as const,coverageState:'INCOMPLETE' as const};
 Object.freeze(result.binding);Object.freeze(result);
 verified.set(result,JSON.stringify([result.binding,result.billDate,result.billType,result.sourceSha256,result.metadataSha256,result.channelHashType,result.channelHashValue,result.verifiedAt,result.scope,result.coverageState]));
 return result;
}
