import test from 'node:test';import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';import {once} from 'node:events';import {dirname,resolve} from 'node:path';import {mkdirSync,writeFileSync} from 'node:fs';
import {root,verifyOwnedEnvironment,childEnvironment,registerOwnedApi,unregisterOwnedApi,redact} from '../../scripts/prelaunch-owned-env.mjs';
test('formal checkin actual main workspace and mocked camera HTTP/DOM',{timeout:120000},async()=>{
 const scratch=dirname(process.env.PRELAUNCH_ENV_FILE??''),{runtime}=await verifyOwnedEnvironment(scratch);
 const env={...childEnvironment(runtime),PRELAUNCH_SOURCE_ROOT:process.env.PRELAUNCH_SOURCE_ROOT??root};
 const server=spawn(process.execPath,[resolve(root,'tests/ui/formal-checkin-http-server.mjs')],{cwd:root,env,stdio:['ignore','pipe','pipe','ipc']});let diagnostic='';server.stdout.on('data',()=>{});server.stderr.on('data',d=>diagnostic+=d);
 try{
  const ready=await new Promise((done,reject)=>{const timer=setTimeout(()=>reject(Error('Checkin child ready timeout: '+redact(diagnostic,runtime))),30000);server.once('error',reject);server.once('exit',()=>reject(Error('Checkin child exited before ready')));server.on('message',m=>{if(m?.type==='PRELAUNCH_READY'){clearTimeout(timer);done(m);}});});
  const origin=registerOwnedApi(scratch,server,ready),dir=resolve(root,'docs/prelaunch/run-to-production-20261002/checkin-cancellation');mkdirSync(dir,{recursive:true});
  const command=['exec','vitest','run','--config','tests/ui/vitest.formal-checkin-dom.config.mts','--configLoader','native','--no-cache'];let output='';
  const code=await new Promise((done,reject)=>{const child=spawn('pnpm',command,{cwd:root,env:{...env,CHECKIN_ORIGIN:origin,CHECKIN_ACTIVITY_ID:ready.activityId,CHECKIN_PASSWORD:ready.password,CHECKIN_SUPPLY_ID:ready.supplyId,CHECKIN_REGISTRATION_ID:ready.registrationId,CHECKIN_USER_AUTHORIZATION:ready.userAuthorization,CHECKIN_RESTAURANT_USERNAME:ready.restaurantUsername},stdio:['ignore','pipe','pipe']});const timer=setTimeout(()=>child.kill('SIGKILL'),70000);child.stdout.on('data',d=>output+=d);child.stderr.on('data',d=>output+=d);child.once('error',reject);child.once('exit',c=>{clearTimeout(timer);done(c);});});
  writeFileSync(resolve(dir,'http-dom.log'),redact(output+diagnostic,runtime).replaceAll(ready.password,'[SYNTHETIC_PASSWORD]').replaceAll(ready.userAuthorization,'[SYNTHETIC_AUTHORIZATION]'));assert.equal(code,0,'Checkin HTTP DOM failed: '+resolve(dir,'http-dom.log'));
  const counts=await new Promise(done=>{server.on('message',m=>{if(m?.type==='COUNTS')done(m);});server.send({type:'COUNTS'});});
  assert.equal(counts.attendanceFacts,1);assert.ok(counts.checkinAt);assert.equal(counts.restaurantResult,null);assert.equal(counts.confirmedAt,null);assert.equal(counts.refundInstructions,0);assert.equal(counts.mandatoryRefunds,0);
  writeFileSync(resolve(dir,'HTTP_DOM_RUN.json'),JSON.stringify({command:['pnpm',...command],exit_code:code,counts,scope:'ACTUAL_OPS_MAIN_AND_MINIAPP_ORDER_DETAIL_WITH_MOCKED_CAMERA_AND_LOOPBACK_HTTP',realCameraVerified:false,realPlatformVerified:false,newMoneySubmitted:false},null,2)+'\n');
 }finally{if(server.exitCode===null&&server.signalCode===null){const stopped=once(server,'exit');server.kill('SIGTERM');await stopped;}unregisterOwnedApi(scratch,server.pid);}
});
