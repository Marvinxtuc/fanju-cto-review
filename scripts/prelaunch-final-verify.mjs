// Run only from the confirmed worktree after platform approval. No ambient .env.
import { spawn } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, verifyOwnedEnvironment, childEnvironment, redact, createOwnedDatabase } from './prelaunch-owned-env.mjs';
import { captureCandidate } from './prelaunch-candidate-hash.mjs';
import { assertProtectedStart } from './prelaunch-start-guard.mjs';
const [scratch] = process.argv.slice(2);
if (!scratch) throw new Error('Usage: node scripts/prelaunch-final-verify.mjs <owned-scratch>');
assertProtectedStart(root, JSON.parse(readFileSync(resolve(root, 'docs/prelaunch/baseline/BASELINE_SNAPSHOT.json'), 'utf8')));
// Fresh verified synthetic generations prevent earlier fault fixtures from contaminating this run.
// All prior databases/registry entries are retained; no cleanup/drop is performed.
await createOwnedDatabase(scratch, 'main', {fresh:true});
await createOwnedDatabase(scratch, 'channel', {fresh:true});
await createOwnedDatabase(scratch, 'empty', {fresh:true});
const { runtime, evidence: owned } = await verifyOwnedEnvironment(scratch);
const env = childEnvironment(runtime);
const candidate = captureCandidate(root);
const id = `final-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
const dir = resolve(root, 'docs/prelaunch/evidence', id); mkdirSync(dir, { recursive: true });
const runs = [];
let runSourceRoot = root;
const toolchain = { node: process.version, packageManager: JSON.parse(readFileSync(resolve(root, 'package.json'))).packageManager };
const digest = value => createHash('sha256').update(value).digest('hex');
function save() { writeFileSync(resolve(dir,'RUNS.json'), JSON.stringify({ candidate_id:candidate.candidate_id, environment:owned, runs },null,2)+'\n'); }
async function run(name, command, args, cwd='.', { timeout=240_000, report, nodeTest=false, databaseKey='main' }={}) {
  const verified = await verifyOwnedEnvironment(scratch, databaseKey);
  const commandEnv = { ...childEnvironment(verified.runtime), PRELAUNCH_SOURCE_ROOT: runSourceRoot };
  if (captureCandidate(root).candidate_id !== candidate.candidate_id) throw new Error('Candidate changed before command; restart final verification');
  let stdout='',stderr=''; const started_at=new Date().toISOString();
  const result=await new Promise(done => {
    const child=spawn(command,args,{ cwd:resolve(root,cwd),env:commandEnv,stdio:['ignore','pipe','pipe'],detached:true });
    let spawnError;
    const timer=setTimeout(()=>{try {process.kill(-child.pid,'SIGKILL');} catch {child.kill('SIGKILL');}},timeout);
    child.stdout?.on('data',d=>stdout+=d); child.stderr?.on('data',d=>stderr+=d);
    child.once('error',e=>{spawnError=e.code;});
    child.once('close',(code,signal)=>{clearTimeout(timer);done({code,signal,spawnError});});
  });
  stdout=redact(stdout,runtime); stderr=redact(stderr,runtime);
  const out=`docs/prelaunch/evidence/${id}/${name}.stdout.log`,err=`docs/prelaunch/evidence/${id}/${name}.stderr.log`;
  writeFileSync(resolve(root,out),stdout);writeFileSync(resolve(root,err),stderr);
  const after=captureCandidate(root).candidate_id;
  const record={id:`${id}-${name}`,category:'FINAL_CANDIDATE',candidate_id:candidate.candidate_id,runner:'native',
    command:JSON.stringify([command,...args]),cwd:resolve(root,cwd),started_at,finished_at:new Date().toISOString(),
    exit_code:Number.isInteger(result.code)?result.code:-1,signal:result.signal,spawn_error:result.spawnError,
    toolchain,artifact_paths:[out,err],stdout_sha256:digest(stdout),stderr_sha256:digest(stderr),
    status:result.code===0 && after===candidate.candidate_id?'PASS':'FAIL',source_drift_during_run:after!==candidate.candidate_id,
    passed:null,failed:null,skipped:null,todo:null};
  if (report) {
    try {
      const native=JSON.parse(readFileSync(report,'utf8'));
      Object.assign(record,{passed:native.numPassedTests,failed:native.numFailedTests,skipped:native.numPendingTests,todo:native.numTodoTests});
      record.artifact_paths.push(report.replace(root+'/',''));
      if (!native.success || native.numTotalTests===0 || native.numPendingTests || native.numTodoTests || native.numFailedTests) record.status='FAIL';
    } catch {record.status='FAIL';record.report_error='NATIVE_REPORT_UNAVAILABLE';}
  }
  if (nodeTest) {
    for(const [key,label] of [['passed','pass'],['failed','fail'],['skipped','skipped'],['todo','todo']]) record[key]=Number(stdout.match(new RegExp(`# ${label} (\\d+)`))?.[1]??-1);
    if (!(record.passed>0) || record.failed!==0 || record.skipped!==0 || record.todo!==0) record.status='FAIL';
  }
  runs.push(record);save();console.log(`${name}: ${record.status}; exit=${record.exit_code}; tests=${record.passed??'N/A'}`);
  if(record.source_drift_during_run) throw new Error('Candidate drift: output preserved, rerun after integration freeze');
  return record;
}
const guardCode=`import assert from 'node:assert/strict';import net from 'node:net';import https from 'node:https';import tls from 'node:tls';
await assert.rejects(fetch('https://api.weixin.qq.com/'),/PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(()=>net.connect({host:'127.0.0.1',port:5432}),/PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(()=>net.connect({host:'127.0.0.1',port:1}),/PRELAUNCH_UNOWNED_LOOPBACK_FORBIDDEN/);
assert.throws(()=>net.connect({host:'localhost',port:3000}),/PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(()=>https.request('https://api.mch.weixin.qq.com/'),/PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(()=>tls.connect({host:'example.com',port:443}),/PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
console.log('Six explicit unowned destinations rejected before socket creation');`;
if((await run('network-guard',process.execPath,['--input-type=module','-e',guardCode])).status!=='PASS') throw new Error('Guard failed: no further operation allowed');
await run('empty-migrate','pnpm',['exec','prisma','migrate','deploy'],'.',{databaseKey:'empty'});
await run('channel-migrate','pnpm',['exec','prisma','migrate','deploy'],'.',{databaseKey:'channel'});
// These source/version reads do not use user .env or credentials.
await run('tool-versions','pnpm',['--version']);
await run('native-toolchain',process.execPath,['--input-type=module','-e',`import {createRequire} from 'node:module'; const req=createRequire(process.cwd()+'/package.json'); console.log('Node',process.version); for(const name of ['vitest','typescript','prisma'])console.log(name,req(name+'/package.json').version); const mini=createRequire(process.cwd()+'/apps/miniapp/package.json'); console.log('Taro',mini('@tarojs/cli/package.json').version); const ops=createRequire(process.cwd()+'/apps/ops/package.json'); console.log('Vite',ops('vite/package.json').version);`]);
for(const [name,args] of [['schema-validate',['validate']],['migrate-deploy',['migrate','deploy']],['generate',['generate']],['schema-diff',['migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--script','--exit-code']]]) {
  if((await run(name,'pnpm',['exec','prisma',...args])).status!=='PASS') throw new Error(`Preparation failed: ${name}`);
}
if((await run('shared-build','pnpm',['build'],'packages/shared')).status!=='PASS') throw new Error('Shared build failed');
const a1Report=resolve(dir,'a1-tests.json');
await run('a1-frozen-52','pnpm',['exec','vitest','run','src/rules/policyBundle.test.ts','--no-cache','--reporter=verbose','--reporter=json',`--outputFile=${a1Report}`,'--no-file-parallelism'],'packages/shared',{report:a1Report});
for(const [name,cwd] of [['shared','packages/shared'],['api','services/api'],['miniapp','apps/miniapp'],['ops','apps/ops']]) {
  const report=resolve(dir,`${name}-tests.json`);
  await run(`${name}-tests`,'pnpm',['exec','vitest','run','--no-cache','--reporter=verbose','--reporter=json',`--outputFile=${report}`,'--no-file-parallelism'],cwd,{report});
  await run(`${name}-typecheck`,'pnpm',['typecheck'],cwd);
}
for(const [name,cwd] of [['api','services/api'],['ops','apps/ops'],['weapp','apps/miniapp']]) await run(`${name}-build`,'pnpm',['build'],cwd,{timeout:360_000});
for(const [name,path] of [['check-copy','scripts/check-visible-copy.ts'],['check-secrets','scripts/check-secrets.ts']]) await run(name,process.execPath,['--import','tsx',path]);
const uiReport=resolve(dir,'miniapp-dom-tests.json');
await run('miniapp-dom-native','pnpm',['exec','vitest','run','--config','vitest.prelaunch.config.ts','--no-cache','--reporter=verbose','--reporter=json',`--outputFile=${uiReport}`,'--no-file-parallelism'],'apps/ops',{report:uiReport});
const cancellationUiReport=resolve(dir,'formal-cancel-dom-tests.json');
await run('formal-cancel-dom','pnpm',['exec','vitest','run','--config','tests/ui/vitest.formal-cancel-dom.config.mts','--no-cache','--reporter=verbose','--reporter=json',`--outputFile=${cancellationUiReport}`],'.',{report:cancellationUiReport});
const clean=await run('clean-source-build',process.execPath,['scripts/prelaunch-clean-build.mjs',scratch],'.',{timeout:1_500_000});
if(clean.status!=='PASS') throw new Error('Clean native build failed; process tests may not consume stale dist');
const buildManifest=JSON.parse(readFileSync(resolve(root,'docs/prelaunch/BUILD_ARTIFACT_MANIFEST.json'),'utf8'));
if(buildManifest.candidate_id!==candidate.candidate_id) throw new Error('Clean artifacts belong to another source candidate');
runSourceRoot=buildManifest.build_root;
await run('formal-client-build',process.execPath,['scripts/prelaunch-clean-build.mjs',scratch,'https://api.synthetic-fanju.cn'],'.',{timeout:1_500_000});
await run('legacy-worker-compat-final',process.execPath,['scripts/prelaunch-verify.mjs','worker-compat',scratch],'.',{timeout:360_000});
// The existing journey requires an exclusively empty generation. Run it
// separately before formal fixtures; Node may reorder files internally.
await run('http-journey-native',process.execPath,['--test','tests/prelaunch/http-journey-recovery.test.mjs'],'.',{nodeTest:true,timeout:240_000});
// A missing required test cannot quietly turn into a PASS.
const nodeTests=readdirSync(resolve(root,'tests/prelaunch')).filter(name=>name.endsWith('.test.mjs') && name!=='legacy-worker.test.mjs' && name!=='http-journey-recovery.test.mjs').sort();
if (!nodeTests.length) {runs.push({id:`${id}-prelaunch-process-tests`,status:'NOT_RUN',reason:'No native process tests installed',candidate_id:candidate.candidate_id});save();}
else await run('prelaunch-process-tests',process.execPath,['--test','--test-concurrency=1',...nodeTests.map(name=>`tests/prelaunch/${name}`)],'.',{nodeTest:true,timeout:900_000});
writeFileSync(resolve(dir,'SOURCE_SNAPSHOT.json'),JSON.stringify(candidate,null,2)+'\n');
save();if(runs.some(record=>record.status!=='PASS')) process.exitCode=1;
console.log(`Evidence directory: ${dir}`);
