import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readdirSync} from 'node:fs';
import {captureCandidate} from './prelaunch-candidate-hash.mjs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {root,createOwnedDatabase,childEnvironment,redact} from './prelaunch-owned-env.mjs';
const [scratch]=process.argv.slice(2);
if(!scratch)throw Error('Owned scratch required; no default database target');
const candidate=captureCandidate(root);
const {runtime,evidence}=await createOwnedDatabase(scratch,'empty',{fresh:true});
const dir=resolve(root,'docs/prelaunch/launch-readiness/evidence/migration-'+new Date().toISOString().replaceAll(/[:.]/g,'-'));mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,'ENVIRONMENT.json'),JSON.stringify({candidate_id:candidate.candidate_id,...evidence},null,2)+'\n');
for(const [name,args] of [['deploy',['exec','prisma','migrate','deploy']],['status',['exec','prisma','migrate','status']],['diff',['exec','prisma','migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code']]]){
 const result=spawnSync('pnpm',args,{cwd:root,env:childEnvironment(runtime),encoding:'utf8',timeout:60000,maxBuffer:2*1024*1024});
 writeFileSync(resolve(dir,name+'.log'),redact((result.stdout??'')+'\n'+(result.stderr??''),runtime));
 console.log(JSON.stringify({step:name,exit_code:result.status}));if(result.status!==0)process.exit(result.status??1);
}
const require=createRequire(resolve(root,'services/api/package.json'));const {Pool}=require('pg');const pool=new Pool({connectionString:runtime.database_url});
try{
 const result=await pool.query('SELECT migration_name, finished_at IS NOT NULL AS finished, rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY migration_name');
 writeFileSync(resolve(dir,'MIGRATIONS.json'),JSON.stringify(result.rows,null,2)+'\n');
 const expected=readdirSync(resolve(root,'prisma/migrations')).filter(n=>/^\d+_/.test(n)).sort();
 const complete=JSON.stringify(result.rows.map(r=>r.migration_name))===JSON.stringify(expected)&&result.rows.every(r=>r.finished&&!r.rolled_back);
 if(!complete||captureCandidate(root).candidate_id!==candidate.candidate_id)throw Error('Migration completeness or candidate drift');
 console.log(JSON.stringify({candidate_id:candidate.candidate_id,applied:result.rows.length,complete,evidence:dir}));
}finally{await pool.end();}
