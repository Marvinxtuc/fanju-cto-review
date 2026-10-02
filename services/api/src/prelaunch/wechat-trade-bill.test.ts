import {createHash,createSign,createVerify,X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,realpathSync,readdirSync,statSync,writeFileSync,chmodSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterAll,describe,it,expect,vi} from 'vitest';
import {downloadWechatTradeBill} from './wechat-trade-bill.js';
const dir=mkdtempSync(join(tmpdir(),'fanju-synthetic-bill-'));
execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=fanju-synthetic-bill'],{stdio:'ignore'});
const privateKey=readFileSync(join(dir,'key.pem'),'utf8'),certificate=readFileSync(join(dir,'cert.pem'),'utf8'),serial=new X509Certificate(certificate).serialNumber;
afterAll(()=>rmSync(dir,{recursive:true,force:true}));
const env={WECHAT_PAY_ENABLED:'true',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat',WECHAT_PAY_MCH_ID:'synthetic-merchant',WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_PAY_PRIVATE_KEY_PATH:'synthetic-private',WECHAT_PAY_PLATFORM_CERT_PATH:'synthetic-platform',WECHAT_PAY_CERT_SERIAL_NO:'synthetic-serial',WECHAT_PAY_CONFIG_VERSION:'synthetic-bill-v1'};
const billDate=new Date(Date.now()+8*3600000-86400000).toISOString().slice(0,10);
const bill=Buffer.from('synthetic non-csv exact bytes\r\n');
const metadata={hash_type:'SHA1',hash_value:createHash('sha1').update(bill).digest('hex'),download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture-bill'};
function signed(raw:string,seconds=Math.floor(Date.now()/1000)){
 const signer=createSign('RSA-SHA256');signer.update(`${seconds}\nsynthetic-nonce\n${raw}\n`);signer.end();
 return new Headers({'wechatpay-timestamp':String(seconds),'wechatpay-nonce':'synthetic-nonce','wechatpay-serial':serial,'wechatpay-signature':signer.sign(privateKey,'base64')});
}
function setup(meta:unknown=metadata,file:Uint8Array=bill){const raw=JSON.stringify(meta);const http=vi.fn().mockResolvedValueOnce(new Response(raw,{headers:signed(raw)})).mockResolvedValueOnce(new Response(file));return{http,options:{fetch:http as typeof fetch,readFile:(path:string)=>path==='synthetic-private'?privateKey:certificate}};}
describe('verified bounded merchant ALL trade-bill byte acquisition',()=>{
 it('verifies signed metadata and exact file digest while keeping coverage incomplete',async()=>{
  const {http,options}=setup();const result=await downloadWechatTradeBill(env,billDate,options);
  expect(result.rawBill.equals(bill)).toBe(true);expect(result.sourceSha256).toBe(createHash('sha256').update(bill).digest('hex'));expect(result.coverageState).toBe('INCOMPLETE');expect(result.scope).toBe('VERIFIED_BILL_BYTES_ONLY');
  expect(JSON.stringify({...result,rawBill:undefined})).not.toContain('fixture-bill');
  expect(new URL(http.mock.calls[0]![0]).searchParams.get('bill_type')).toBe('ALL');
  for(const [url,init] of http.mock.calls){expect(init.redirect).toBe('error');expect(init.method).toBe('GET');const parsed=new URL(url);const auth=init.headers.authorization;const timestamp=/timestamp="([^"]+)"/.exec(auth)![1],nonce=/nonce_str="([^"]+)"/.exec(auth)![1],signature=/signature="([^"]+)"/.exec(auth)![1];const verifier=createVerify('RSA-SHA256');verifier.update(`GET\n${parsed.pathname+parsed.search}\n${timestamp}\n${nonce}\n\n`);verifier.end();expect(verifier.verify(certificate,signature,'base64')).toBe(true);}
 });
 it('rejects unsigned metadata and altered signed bytes before downloading',async()=>{
  for(const response of [new Response(JSON.stringify(metadata)),new Response(JSON.stringify(metadata)+' ',{headers:signed(JSON.stringify(metadata))})]){const {http,options}=setup();http.mockReset().mockResolvedValueOnce(response);await expect(downloadWechatTradeBill(env,billDate,options)).rejects.toThrow();expect(http).toHaveBeenCalledOnce();}
 });
 it('rejects stale metadata and an unknown platform serial',async()=>{
  for(const headers of [signed(JSON.stringify(metadata),Math.floor(Date.now()/1000)-600),new Headers({...Object.fromEntries(signed(JSON.stringify(metadata))),'wechatpay-serial':'wrong'})]){const {http,options}=setup();http.mockReset().mockResolvedValueOnce(new Response(JSON.stringify(metadata),{headers}));await expect(downloadWechatTradeBill(env,billDate,options)).rejects.toThrow();expect(http).toHaveBeenCalledOnce();}
 });
 it('never follows metadata URLs to another host, path, userinfo or query shape',async()=>{
  for(const download_url of ['https://example.invalid/v3/billdownload/file?token=x','http://api.mch.weixin.qq.com/v3/billdownload/file?token=x','https://user@api.mch.weixin.qq.com/v3/billdownload/file?token=x','https://api.mch.weixin.qq.com/v3/other?token=x','https://api.mch.weixin.qq.com/v3/billdownload/file?token=x&token=y','https://api.mch.weixin.qq.com/v3/billdownload/file?token=x#fragment']){const {http,options}=setup({...metadata,download_url});await expect(downloadWechatTradeBill(env,billDate,options)).rejects.toThrow();expect(http).toHaveBeenCalledOnce();}
 });
 it('rejects digest tampering, truncation, empty files and unsupported hashes',async()=>{
  for(const file of [Buffer.from('altered'),bill.subarray(0,3),Buffer.alloc(0)]){const {options}=setup(metadata,file);await expect(downloadWechatTradeBill(env,billDate,options)).rejects.toThrow();}
  const {http,options}=setup({...metadata,hash_type:'MD5'});await expect(downloadWechatTradeBill(env,billDate,options)).rejects.toThrow();expect(http).toHaveBeenCalledOnce();
 });
 it('bounds both metadata and streaming file size',async()=>{
  const large=setup();large.http.mockReset().mockResolvedValueOnce(new Response('x'.repeat(262145)));await expect(downloadWechatTradeBill(env,billDate,large.options)).rejects.toThrow();expect(large.http).toHaveBeenCalledOnce();
  const huge=setup();const raw=JSON.stringify(metadata);huge.http.mockReset().mockResolvedValueOnce(new Response(raw,{headers:signed(raw)})).mockResolvedValueOnce(new Response(new Uint8Array(32*1024*1024+1)));await expect(downloadWechatTradeBill(env,billDate,huge.options)).rejects.toThrow();
 });
 it('rejects unavailable bills and never turns absence into zero coverage',async()=>{
  for(const status of [404,500]){const {http,options}=setup();http.mockReset().mockResolvedValueOnce(new Response('{}',{status}));await expect(downloadWechatTradeBill(env,billDate,options)).rejects.toThrow();expect(http).toHaveBeenCalledOnce();}
 });
 it('refuses invalid/future periods and disabled or mock config without HTTP',async()=>{
  const {http,options}=setup();for(const day of ['2026-02-30','2026-9-01','9999-01-01'])await expect(downloadWechatTradeBill(env,day,options)).rejects.toThrow();
  await expect(downloadWechatTradeBill({...env,PAYMENT_PROVIDER:'mock'},billDate,options)).rejects.toThrow();await expect(downloadWechatTradeBill({...env,WECHAT_PAY_ENABLED:'false'},billDate,options)).rejects.toThrow();expect(http).not.toHaveBeenCalled();
 });
 it('recovers complete private bytes only after fresh signed metadata without a second file download',async()=>{
  const cacheDirectory=realpathSync(mkdtempSync(join(tmpdir(),'fanju-bill-cache-')));
  try{
   const first=setup();await downloadWechatTradeBill(env,billDate,{...first.options,cacheDirectory});expect(first.http).toHaveBeenCalledTimes(2);
   const names=readdirSync(cacheDirectory);expect(names).toHaveLength(1);expect(names[0]).toMatch(/^[a-f0-9]{64}\.bill$/);expect(statSync(join(cacheDirectory,names[0]!)).mode&0o777).toBe(0o600);expect(readFileSync(join(cacheDirectory,names[0]!)).equals(bill)).toBe(true);
   const next=setup();const recovered=await downloadWechatTradeBill(env,billDate,{...next.options,cacheDirectory});expect(next.http).toHaveBeenCalledOnce();expect(recovered.rawBill.equals(bill)).toBe(true);
   const unsigned=setup();unsigned.http.mockReset().mockResolvedValueOnce(new Response(JSON.stringify(metadata)));await expect(downloadWechatTradeBill(env,billDate,{...unsigned.options,cacheDirectory})).rejects.toThrow();expect(unsigned.http).toHaveBeenCalledOnce();
  }finally{rmSync(cacheDirectory,{recursive:true,force:true});}
 });
 it('rejects cached tampering or relaxed permissions without falling back to download',async()=>{
  const cacheDirectory=realpathSync(mkdtempSync(join(tmpdir(),'fanju-bill-cache-')));
  try{
   await downloadWechatTradeBill(env,billDate,{...setup().options,cacheDirectory});const path=join(cacheDirectory,readdirSync(cacheDirectory)[0]!);
   for(const mutate of [()=>writeFileSync(path,'altered'),()=>{writeFileSync(path,bill);chmodSync(path,0o644);},()=>{rmSync(path);symlinkSync(join(dir,'key.pem'),path);}]){
    mutate();const next=setup();await expect(downloadWechatTradeBill(env,billDate,{...next.options,cacheDirectory})).rejects.toThrow();expect(next.http).toHaveBeenCalledOnce();
   }
  }finally{rmSync(cacheDirectory,{recursive:true,force:true});}
 });
 it('leaves no complete cache after a truncated or interrupted acquisition',async()=>{
  const cacheDirectory=realpathSync(mkdtempSync(join(tmpdir(),'fanju-bill-cache-')));
  try{
   const truncated=setup(metadata,bill.subarray(0,3));await expect(downloadWechatTradeBill(env,billDate,{...truncated.options,cacheDirectory})).rejects.toThrow();expect(readdirSync(cacheDirectory)).toEqual([]);
   const raw=JSON.stringify(metadata),broken=setup();broken.http.mockReset().mockResolvedValueOnce(new Response(raw,{headers:signed(raw)})).mockResolvedValueOnce(new Response(new ReadableStream({start(c){c.error(Error('synthetic interrupted stream'));}})));
   await expect(downloadWechatTradeBill(env,billDate,{...broken.options,cacheDirectory})).rejects.toThrow();expect(readdirSync(cacheDirectory)).toEqual([]);
  }finally{rmSync(cacheDirectory,{recursive:true,force:true});}
 });
 it('rejects non-private or relative cache directories before HTTP',async()=>{
  const cacheDirectory=realpathSync(mkdtempSync(join(tmpdir(),'fanju-bill-cache-')));
  try{chmodSync(cacheDirectory,0o755);const next=setup();for(const path of [cacheDirectory,'relative-cache'])await expect(downloadWechatTradeBill(env,billDate,{...next.options,cacheDirectory:path})).rejects.toThrow();expect(next.http).not.toHaveBeenCalled();}
  finally{rmSync(cacheDirectory,{recursive:true,force:true});}
 });

});
