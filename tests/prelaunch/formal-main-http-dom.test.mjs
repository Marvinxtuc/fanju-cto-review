import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {once} from 'node:events';
import {dirname,resolve} from 'node:path';
import {mkdirSync,writeFileSync,readFileSync,existsSync} from 'node:fs';
import {verifyOwnedEnvironment,childEnvironment,registerOwnedApi,unregisterOwnedApi,redact,root} from '../../scripts/prelaunch-owned-env.mjs';
import {captureCandidate} from '../../scripts/prelaunch-candidate-hash.mjs';
test('formal main HTTP + React DOM end-to-end with guarded synthetic transport',{timeout:140000},async()=>{
 const scratch=dirname(process.env.PRELAUNCH_ENV_FILE??''),{runtime}=await verifyOwnedEnvironment(scratch,'empty'),candidate=captureCandidate(root);
 const env={...childEnvironment(runtime),PRELAUNCH_SOURCE_ROOT:process.env.PRELAUNCH_SOURCE_ROOT??root,PRELAUNCH_FORMAL_SCRATCH:scratch};
 let diagnostic='',workerFailure=false;const server=spawn(process.execPath,[resolve(root,'tests/ui/formal-main-http-server.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});server.stdout.on('data',()=>{});server.stderr.on('data',d=>diagnostic+=d);server.on('message',m=>{if(m?.type==='WORKER_FAILURE')workerFailure=true;});
 const dir=resolve(root,'docs/prelaunch/cto-review-20261001/evidence','formal-dom-'+new Date().toISOString().replaceAll(':','-'));mkdirSync(dir,{recursive:true});
 try{
  const ready=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Formal test child ready timeout')),20000);server.once('error',reject);server.once('exit',()=>{clearTimeout(timer);reject(Error('Formal test child exited: '+redact(diagnostic,runtime)));});server.on('message',m=>{if(m?.type==='PRELAUNCH_READY'){clearTimeout(timer);done(m);}});});
  const origin=registerOwnedApi(scratch,server,ready),report=resolve(dir,'vitest.json');let output='';
  const startedAt=new Date().toISOString();const command=['exec','vitest','run','--config','tests/ui/vitest.formal-http-dom.config.mts','--configLoader','native','--no-cache','--reporter=default','--reporter=json','--outputFile='+report];
  const code=await new Promise((done,reject)=>{const child=spawn('pnpm',command,{cwd:root,env:{...env,FORMAL_ORIGIN:origin,FORMAL_ACTIVITY_ID:ready.activityId,FORMAL_FULFILLMENT_REGISTRATION_ID:ready.fulfillmentRegistrationId,FORMAL_FULFILLMENT_ACTIVITY_ID:ready.fulfillmentActivityId,FORMAL_LEGACY_ORDER_ID:ready.legacyOrderId,FORMAL_FOREIGN_ORDER_ID:ready.foreignOrderId,FORMAL_POLICY_ID:ready.policyId,FORMAL_USER_TOKEN:ready.userToken,FORMAL_PASSWORD:ready.password,FORMAL_OPS_USERNAME:ready.opsUsername,FORMAL_RESTAURANT_USERNAME:ready.restaurantUsername},stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>child.kill('SIGKILL'),110000);child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.once('error',reject);child.once('exit',c=>{clearTimeout(timer);done(c);});});
  const clean=s=>redact(s,runtime).replaceAll(ready.password,'[SYNTHETIC_PASSWORD]').replaceAll(ready.userToken,'[SYNTHETIC_SESSION]');writeFileSync(resolve(dir,'native.log'),clean(output+diagnostic));if(existsSync(report))writeFileSync(report,clean(readFileSync(report,'utf8')));
  const after=captureCandidate(root),result=existsSync(report)?JSON.parse(readFileSync(report,'utf8')):null;
  writeFileSync(resolve(dir,'RUN.json'),JSON.stringify({candidateId:candidate.candidate_id,afterCandidateId:after.candidate_id,startedAt,finishedAt:new Date().toISOString(),command:['pnpm',...command],exitCode:code,workerFailure,nativePassed:result?.numPassedTests??0,scope:'ACTUAL_MAIN_COMPONENTS_AND_FORMAL_HTTP_WITH_ISOLATED_SYNTHETIC_TRANSPORT',realPlatformVerified:false},null,2));
  assert.equal(code,0,'Formal main DOM failed: '+resolve(dir,'native.log'));assert.equal(result?.success,true);assert.equal(workerFailure,false);assert.equal(candidate.candidate_id,after.candidate_id);
  const counts=await new Promise(done=>{server.on('message',m=>{if(m?.type==='COUNTS')done(m);});server.send({type:'COUNTS'});});assert.equal(counts.registrations,1);assert.equal(counts.paymentSends,1);assert.equal(counts.refundSends,1);assert.equal(counts.legacyOrderVersion,0);assert.equal(counts.legacyRefundState,'REFUNDING');console.log(JSON.stringify({evidence:dir,counts:{registrations:counts.registrations,paymentSends:counts.paymentSends,refundSends:counts.refundSends}}));
 }finally{if(server.exitCode===null&&server.signalCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}unregisterOwnedApi(scratch,server.pid);}
});
