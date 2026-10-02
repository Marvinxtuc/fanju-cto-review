import test from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync,spawn} from 'node:child_process';
import {mkdtempSync,mkdirSync,realpathSync,readdirSync,readFileSync,writeFileSync,rmSync,statSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {once} from 'node:events';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');
test('fresh process recovers completed bill through new signed metadata and rejects tampered cache',{timeout:15000},async()=>{
 const root=realpathSync(mkdtempSync(join(tmpdir(),'fanju-cache-process-')));mkdirSync(join(root,'cache'),{mode:0o700});
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(root,'key.pem'),'-out',join(root,'cert.pem'),'-days','1','-subj','/CN=fanju-synthetic-cache'],{stdio:'ignore'});
  async function run(recovery){
   const child=spawn(process.execPath,[join(repo,'tests/prelaunch/fixtures/wechat-bill-cache-process.mjs')],{env:{...process.env,BILL_CACHE_QA_ROOT:root,BILL_CACHE_QA_RECOVERY:String(recovery)},stdio:['ignore','pipe','pipe']});
   let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);const [code,signal]=await once(child,'exit');assert.equal(signal,null);assert.equal(errors,'');assert.ok(!output.includes('fixture-bill'));return {code,...JSON.parse(output)};
  }
  const first=await run(false);assert.equal(first.code,0);assert.equal(first.calls,2);
  const filenames=readdirSync(join(root,'cache'));assert.equal(filenames.length,1);const path=join(root,'cache',filenames[0]);assert.equal(statSync(path).mode&0o777,0o600);assert.ok(!readFileSync(path,'utf8').includes('fixture-bill'));
  const second=await run(true);assert.equal(second.code,0);assert.equal(second.calls,1);assert.equal(second.sourceSha256,first.sourceSha256);assert.equal(second.coverageState,'INCOMPLETE');
  writeFileSync(path,'tampered');const third=await run(true);assert.equal(third.code,1);assert.equal(third.calls,1);assert.equal(third.status,'REJECTED');
 }finally{rmSync(root,{recursive:true,force:true});}
});
