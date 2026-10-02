// Source-only reproduction: no Git, no database, no network/install; explicit dependency reuse.
import {assertAcceptanceArtifacts} from './prelaunch-artifact-visibility.mjs';
import {createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync,copyFileSync,cpSync,symlinkSync,lstatSync,readdirSync,existsSync,realpathSync} from 'node:fs';
import {resolve,dirname} from 'node:path';
const [deliveryArg,outputArg,dependencyArg]=process.argv.slice(2);
if(!deliveryArg||!outputArg||!dependencyArg)throw Error('Usage: node source/scripts/prelaunch-source-reproduce.mjs <extracted-delivery> <new-output-directory> <explicit-existing-dependency-root>');
const delivery=realpathSync(deliveryArg),output=resolve(outputArg),dependency=realpathSync(dependencyArg),source=resolve(delivery,'source');
if(existsSync(output))throw Error('Reproduction output must be new; previous evidence is preserved');
if(output===delivery||output.startsWith(delivery+'/')||output===dependency||output.startsWith(dependency+'/'))throw Error('Output must be outside delivered source and dependency root');
const sha=b=>createHash('sha256').update(b).digest('hex');
const manifest=JSON.parse(readFileSync(resolve(delivery,'docs/prelaunch/FILE_MANIFEST.json'))),candidate=JSON.parse(readFileSync(resolve(delivery,'docs/prelaunch/RELEASE_CANDIDATE_MANIFEST.json')));
const entries=manifest.files.filter(e=>e.path.startsWith('source/')).map(e=>({path:e.path.slice(7),sha256:e.sha256})).sort((a,b)=>Buffer.compare(Buffer.from(a.path),Buffer.from(b.path)));
if(!entries.length||sha(JSON.stringify(entries))!==candidate.candidate_id||manifest.candidate_id!==candidate.candidate_id)throw Error('Delivered source candidate identity mismatch');
const seen=[];function walk(dir,prefix=''){for(const name of readdirSync(dir)){const path=resolve(dir,name),rel=prefix+name,stat=lstatSync(path);if(stat.isSymbolicLink())throw Error('Delivered source symlink forbidden');if(stat.isDirectory())walk(path,rel+'/');else if(stat.isFile())seen.push(rel);}}
walk(source);if(JSON.stringify(seen.sort())!==JSON.stringify(entries.map(e=>e.path).sort()))throw Error('Missing or extra delivered source files');
for(const e of entries){if(e.path.split('/').some(p=>p==='..'||p==='.git'||p==='node_modules'||p==='dist'||(p.startsWith('.env')&&p!=='.env.example')))throw Error('Unsafe source inventory');if(sha(readFileSync(resolve(source,e.path)))!==e.sha256)throw Error('Source hash mismatch: '+e.path);}
if(sha(readFileSync(resolve(source,'pnpm-lock.yaml')))!==sha(readFileSync(resolve(dependency,'pnpm-lock.yaml'))))throw Error('Dependency root lockfile differs from delivered lockfile');
mkdirSync(output);const build=resolve(output,'build');mkdirSync(build);
for(const e of entries){const dest=resolve(build,e.path);mkdirSync(dirname(dest),{recursive:true});copyFileSync(resolve(source,e.path),dest);}
symlinkSync(resolve(dependency,'node_modules'),resolve(build,'node_modules'),'dir');
for(const dir of ['packages/shared','services/api','apps/ops','apps/miniapp'])if(existsSync(resolve(dependency,dir,'node_modules')))cpSync(resolve(dependency,dir,'node_modules'),resolve(build,dir,'node_modules'),{recursive:true,dereference:false,verbatimSymlinks:true});
// Deliberately omit ambient secrets. Generation receives an inert URL and all child TCP sockets are blocked.
const guard=resolve(output,'reproduce-no-network.cjs');
writeFileSync(guard,`const net=require('node:net'),tls=require('node:tls'),http=require('node:http'),https=require('node:https'),{syncBuiltinESMExports}=require('node:module');const deny=()=>{throw Error('SOURCE_REPRODUCTION_NETWORK_FORBIDDEN')};net.connect=net.createConnection=deny;net.Socket.prototype.connect=deny;tls.connect=http.request=http.get=https.request=https.get=deny;globalThis.fetch=deny;syncBuiltinESMExports();`);
const env={DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/no_database',NODE_OPTIONS:'--require '+JSON.stringify(guard),PATH:process.env.PATH,HOME:output,TMPDIR:output,TARO_APP_PRELAUNCH_ENABLED:'true',TARO_APP_API_BASE_URL:'http://127.0.0.1:3000',VITE_FANJU_PRELAUNCH_ENABLED:'true',VITE_API_BASE_URL:'http://127.0.0.1:3000',CI:'1'};
const testArgs=name=>['exec','vitest','run','--no-cache','--reporter=verbose','--reporter=json','--outputFile='+resolve(output,name+'.tests.json'),'--no-file-parallelism'];
const runs=[];for(const [name,cwd,args]of [['generate','.',['exec','prisma','generate']],['shared','packages/shared',['build']],['api','services/api',['build']],['ops','apps/ops',['build']],['weapp','apps/miniapp',['build']],['shared-tests','packages/shared',testArgs('shared-tests')],['miniapp-tests','apps/miniapp',testArgs('miniapp-tests')],['ops-tests','apps/ops',testArgs('ops-tests')],['miniapp-dom-native','apps/ops',[...testArgs('miniapp-dom-native'),'--config','vitest.prelaunch.config.ts']]]){
 const start=new Date().toISOString();let stdout='',stderr='';
 const result=await new Promise(done=>{const child=spawn('pnpm',args,{cwd:resolve(build,cwd),env,stdio:['ignore','pipe','pipe'],detached:true});const timer=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},360000);child.stdout?.on('data',d=>stdout+=d);child.stderr?.on('data',d=>stderr+=d);child.once('error',e=>stderr+=String(e));child.once('close',(code,signal)=>{clearTimeout(timer);done({code,signal});});});
 writeFileSync(resolve(output,name+'.stdout.log'),stdout);writeFileSync(resolve(output,name+'.stderr.log'),stderr);
 let tests=null;let testValidationError=null;const reportPath=resolve(output,name+'.tests.json');if(name.endsWith('-tests')||name==='miniapp-dom-native'){try{if(!existsSync(reportPath))throw Error('Missing native test JSON: '+name);const j=JSON.parse(readFileSync(reportPath));const assertions=(j.testResults??[]).flatMap(s=>s.assertionResults??[]);if(!j.success||assertions.length===0||assertions.some(t=>t.status!=='passed')||j.numFailedTests!==0||j.numPendingTests!==0||j.numTodoTests!==0||j.numPassedTests!==assertions.length)throw Error('Native tests skipped failed empty or inconsistent: '+name);tests={passed:j.numPassedTests,failed:j.numFailedTests,skipped:j.numPendingTests,todo:j.numTodoTests,report_path:reportPath,report_sha256:sha(readFileSync(reportPath)),exact_titles:assertions.map(t=>({full_title:t.fullName,title:t.title,status:t.status}))};}catch(error){testValidationError=String(error);}}
 runs.push({name,tests,test_validation_error:testValidationError,toolchain:{node:process.version,package_manager:'Explicit existing pnpm in PATH; identical lockfile dependency reuse'},artifact_paths:[resolve(output,name+'.stdout.log'),resolve(output,name+'.stderr.log'),...(tests?[reportPath]:[])],command:['pnpm',...args],cwd,started_at:start,finished_at:new Date().toISOString(),exit_code:result.code,status:result.code===0&&!testValidationError?'PASS':'FAIL',stdout_sha256:sha(stdout),stderr_sha256:sha(stderr)});
 writeFileSync(resolve(output,'REPRODUCTION.json'),JSON.stringify({candidate_id:candidate.candidate_id,source_verified:true,git_required:false,dependency_provenance:'Explicit existing dependencies reused with identical lockfile; no fresh install or cross-machine verification',fresh_dependency_install_verified:false,database_runtime_reproduced:false,test_scope:'Shared pure tests, miniapp and ops unit tests, React DOM tests; API DB/HTTP/worker behavior is separately proven by final owned candidate',network_guard:'All child TCP/TLS/HTTP/fetch sockets forbidden',runs},null,2)+'\n');
 console.log(name+': '+runs.at(-1).status);if(result.code!==0||testValidationError)throw Error('Reproduction failed; logs preserved: '+(testValidationError??name));
}

const visibility=await assertAcceptanceArtifacts(build);
const report=JSON.parse(readFileSync(resolve(output,'REPRODUCTION.json')));report.artifact_visibility=visibility;
writeFileSync(resolve(output,'ARTIFACT_VISIBILITY.json'),JSON.stringify({candidate_id:candidate.candidate_id,...visibility},null,2)+'\n');
writeFileSync(resolve(output,'REPRODUCTION.json'),JSON.stringify(report,null,2)+'\n');
console.log('Generated ops acceptance workspace render: PASS');
