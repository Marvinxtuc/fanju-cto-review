import { spawn } from 'node:child_process';
import { copyFileSync, cpSync, mkdirSync, symlinkSync, existsSync, readdirSync, lstatSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { createHash } from 'node:crypto';
import { root, verifyOwnedEnvironment, childEnvironment, safeBaseEnv, redact } from './prelaunch-owned-env.mjs';
import { assertAcceptanceArtifacts } from './prelaunch-artifact-visibility.mjs';
import { captureCandidate } from './prelaunch-candidate-hash.mjs';
import {validateFormalClientOrigin,assertFormalClientArtifacts} from './formal-client-artifacts.mjs';
const rawArgs=process.argv.slice(2);const freshInstall=rawArgs.includes('--fresh-install');const [scratch,formalOrigin,...extra]=rawArgs.filter(value=>value!=='--fresh-install');if(!scratch||extra.length)throw Error('Owned scratch required');
if(formalOrigin)validateFormalClientOrigin(formalOrigin);
const {runtime,evidence}=await verifyOwnedEnvironment(scratch);
const candidate=captureCandidate(root),runId=`clean-build-${new Date().toISOString().replaceAll(/[:.]/g,'-')}`;
const buildRoot=resolve(runtime.scratch,runId),logs=resolve(root,'docs/prelaunch/evidence',runId);
mkdirSync(buildRoot);mkdirSync(logs,{recursive:true});
writeFileSync(resolve(logs,'SOURCE_SNAPSHOT.json'),JSON.stringify(candidate,null,2)+'\n');
writeFileSync(resolve(logs,'BUILD_CONTEXT.json'),JSON.stringify({candidate_id:candidate.candidate_id,platform:process.platform,arch:process.arch,node:process.version,fresh_install:freshInstall,formal_origin:formalOrigin??null,target_environment_verified:false},null,2)+'\n');
for(const entry of candidate.files){const source=resolve(root,entry.path);if(createHash('sha256').update(readFileSync(source)).digest('hex')!==entry.sha256)throw Error('Copy source drift');const dest=resolve(buildRoot,entry.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(source,dest);}
// A fresh install never links the calling workspace dependencies or its store.
const runs=[];
if(freshInstall){
 const installEnv={...safeBaseEnv(),CI:'true',NODE_ENV:'development',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/build_only'};
 let stdout='',stderr='';const started_at=new Date().toISOString();
 const result=await new Promise(done=>{const child=spawn('pnpm',['install','--frozen-lockfile','--store-dir',resolve(buildRoot,'.fresh-pnpm-store')],{cwd:buildRoot,env:installEnv,stdio:['ignore','pipe','pipe'],detached:true});const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}},900_000);child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',()=>{});child.once('close',(code,signal)=>{clearTimeout(timer);done({code,signal});});});
 const out=`docs/prelaunch/evidence/${runId}/install.stdout.log`,err=`docs/prelaunch/evidence/${runId}/install.stderr.log`;
 writeFileSync(resolve(root,out),redact(stdout,runtime));writeFileSync(resolve(root,err),redact(stderr,runtime));
 runs.push({id:`${runId}-install`,category:'FRESH_INSTALL',candidate_id:candidate.candidate_id,command:'pnpm install --frozen-lockfile --store-dir <new-empty-store>',started_at,finished_at:new Date().toISOString(),exit_code:result.code??-1,signal:result.signal,artifact_paths:[out,err],status:result.code===0?'PASS':'FAIL'});
 writeFileSync(resolve(logs,'RUNS.json'),JSON.stringify({candidate_id:candidate.candidate_id,environment:evidence,fresh_install:true,runs},null,2)+'\n');
 console.log(`Fresh install: ${runs[0].status}`);if(result.code!==0)throw Error('Fresh frozen install failed; evidence retained');
}else{
 symlinkSync(resolve(root,'node_modules'),resolve(buildRoot,'node_modules'),'dir');
 for(const dir of ['packages/shared','services/api','apps/ops','apps/miniapp'])if(existsSync(resolve(root,dir,'node_modules')))cpSync(resolve(root,dir,'node_modules'),resolve(buildRoot,dir,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true});
}
const env={...childEnvironment(runtime),TARO_APP_PRELAUNCH_ENABLED:formalOrigin?'false':'true',VITE_FANJU_PRELAUNCH_ENABLED:formalOrigin?'false':'true',TARO_APP_DEMO_MODE:'false',VITE_DEMO_MODE:'false',TARO_APP_API_BASE_URL:formalOrigin??'http://127.0.0.1:3000',VITE_API_BASE_URL:formalOrigin??'http://127.0.0.1:3000'};
for(const [name,cwd,args]of [['generate','.',['exec','prisma','generate']],['shared','packages/shared',['build']],['api','services/api',['build']],['ops','apps/ops',['build']],['weapp','apps/miniapp',['build']]]){
 await verifyOwnedEnvironment(scratch);let stdout='',stderr='';const started_at=new Date().toISOString();
 const result=await new Promise(done=>{const child=spawn('pnpm',args,{cwd:resolve(buildRoot,cwd),env,stdio:['ignore','pipe','pipe'],detached:true});const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}},360_000);child.stdout.on('data',d=>stdout+=d);child.stderr.on('data',d=>stderr+=d);child.once('error',()=>{});child.once('close',(code,signal)=>{clearTimeout(timer);done({code,signal});});});
 stdout=redact(stdout,runtime);stderr=redact(stderr,runtime);
 const out=`docs/prelaunch/evidence/${runId}/${name}.stdout.log`,err=`docs/prelaunch/evidence/${runId}/${name}.stderr.log`;writeFileSync(resolve(root,out),stdout);writeFileSync(resolve(root,err),stderr);
 const row={id:`${runId}-${name}`,category:'CLEAN_BUILD',candidate_id:candidate.candidate_id,runner:'native',command:JSON.stringify(['pnpm',...args]),cwd:resolve(buildRoot,cwd),started_at,finished_at:new Date().toISOString(),exit_code:result.code??-1,signal:result.signal,toolchain:{node:process.version},artifact_paths:[out,err],status:result.code===0?'PASS':'FAIL'};runs.push(row);
 writeFileSync(resolve(logs,'RUNS.json'),JSON.stringify({candidate_id:candidate.candidate_id,environment:evidence,runs},null,2)+'\n');console.log(`${name} clean build: ${row.status}`);if(row.status!=='PASS')throw Error(`Clean build failed: ${name}`);
}
const visibility=formalOrigin?await assertFormalClientArtifacts(buildRoot,formalOrigin):await assertAcceptanceArtifacts(buildRoot);
writeFileSync(resolve(logs,'ARTIFACT_VISIBILITY.json'),JSON.stringify({candidate_id:candidate.candidate_id,...visibility},null,2)+'\n');
const afterCandidate=captureCandidate(root).candidate_id;
const integrity={id:`${runId}-source-integrity`,category:'BUILD_INTEGRITY',candidate_id:candidate.candidate_id,current_candidate_id:afterCandidate,status:afterCandidate===candidate.candidate_id?'PASS':'FAIL',source_drift_during_run:afterCandidate!==candidate.candidate_id};runs.push(integrity);
writeFileSync(resolve(logs,'RUNS.json'),JSON.stringify({candidate_id:candidate.candidate_id,environment:evidence,runs},null,2)+'\n');
if(integrity.status!=='PASS')throw Error('Source drift during clean build; install/build evidence retained, not current candidate acceptance');
const files=[];
function visit(dir,relative){for(const name of readdirSync(dir)){const path=resolve(dir,name),stat=lstatSync(path),rel=relative+'/'+name;if(stat.isSymbolicLink())throw Error('Build artifact symlink rejected');if(stat.isDirectory())visit(path,rel);else if(stat.isFile())files.push({path:rel,build_path:path,sha256:createHash('sha256').update(readFileSync(path)).digest('hex'),bytes:stat.size});}}
for(const [name,dir]of [['shared','packages/shared/dist'],['api','services/api/dist'],['ops','apps/ops/dist'],['weapp','apps/miniapp/dist']]){if(!existsSync(resolve(buildRoot,dir)))throw Error('Expected native build output missing');visit(resolve(buildRoot,dir),'artifacts/'+name);}
if(!files.some(f=>f.path==='artifacts/weapp/app.json')||!files.some(f=>f.path==='artifacts/ops/index.html')||!files.some(f=>f.path==='artifacts/api/prelaunch/server.js')||!files.some(f=>f.path==='artifacts/api/prelaunch/worker.js'))throw Error('Build entrypoints missing');
if(formalOrigin){for(const entry of ['artifacts/api/server.js','artifacts/api/worker.js','artifacts/api/prelaunch/formal-business-worker.js','artifacts/api/prelaunch/formal-hold-expiry-worker.js','artifacts/api/prelaunch/formal-payment-close-worker.js','artifacts/api/funding/original-recovery-worker.js'])if(!files.some(f=>f.path===entry&&f.bytes>0))throw Error('Formal main/worker artifact missing: '+entry);}
writeFileSync(resolve(root,formalOrigin?'docs/prelaunch/FORMAL_CLIENT_BUILD_MANIFEST.json':'docs/prelaunch/BUILD_ARTIFACT_MANIFEST.json'),JSON.stringify({candidate_id:candidate.candidate_id,build_root:buildRoot,artifact_visibility:visibility,dependency_provenance:freshInstall?'Fresh frozen-lockfile install into an empty dependency store; no workspace dependencies or build caches copied.':'Locked existing dependencies linked; no install executed. Source/dist caches were not copied.',files},null,2)+'\n');
console.log(`Clean build root: ${buildRoot}`);
