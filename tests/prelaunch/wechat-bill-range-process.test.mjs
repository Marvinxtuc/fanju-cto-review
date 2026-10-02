import test from 'node:test';
import assert from 'node:assert/strict';
import {fork} from 'node:child_process';
import {once} from 'node:events';
import {join} from 'node:path';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');
for(const signal of ['SIGTERM','SIGINT'])test(`bill range ${signal} drains active date before exiting with resumable remaining range`,{timeout:10000},async()=>{
 const child=fork(join(repo,'tests/prelaunch/fixtures/wechat-bill-range-drain.mjs'),[],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
 let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);
 const events=[];child.on('message',event=>events.push(event));const closed=once(child,'exit');
 try{
  const [started]=await once(child,'message');assert.equal(started.stage,'STARTED');assert.equal(started.date,'2026-09-29');
  assert.equal(child.kill(signal),true);await new Promise(r=>setTimeout(r,100));assert.equal(child.exitCode,null);assert.equal(child.signalCode,null);
  child.send('release');const [code,stoppedBy]=await closed;assert.equal(code,3);assert.equal(stoppedBy,null);
  assert.deepEqual(events.map(x=>x.stage),['STARTED','COMMITTED','RESULT']);
  const result=events.at(-1).result;assert.equal(result.days.length,1);assert.equal(result.days[0].status,'OBSERVED');assert.equal(result.pendingDays,1);assert.equal(result.nextDate,'2026-09-30');assert.equal(result.stopReason,'SIGNAL');assert.equal(result.releaseAuthorized,false);assert.equal(output,'');assert.equal(error,'');
 }finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
});
