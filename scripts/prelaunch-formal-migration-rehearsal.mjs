import {spawnSync} from 'node:child_process';
import {mkdirSync,writeFileSync,readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {createRequire} from 'node:module';
import {root,createOwnedDatabase,childEnvironment,redact} from './prelaunch-owned-env.mjs';
import {captureCandidate} from './prelaunch-candidate-hash.mjs';
const scratch=process.argv[2];if(!scratch)throw Error('Explicit disposable owned environment required');
const candidate=captureCandidate(root),{runtime,evidence}=await createOwnedDatabase(scratch,'restore',{fresh:true}),dir=resolve(root,'docs/prelaunch/cto-review-20261001/evidence/migration-roundtrip-'+new Date().toISOString().replaceAll(':','-'));mkdirSync(dir,{recursive:true});
writeFileSync(resolve(dir,'ENVIRONMENT.json'),JSON.stringify({candidateId:candidate.candidate_id,...evidence},null,2));
const runs=[];
function command(name,args){const result=spawnSync('pnpm',args,{cwd:root,env:childEnvironment(runtime),encoding:'utf8',timeout:60000});writeFileSync(resolve(dir,name+'.log'),redact((result.stdout??'')+'\n'+(result.stderr??''),runtime));runs.push({name,command:['pnpm',...args],exitCode:result.status});if(result.status!==0)throw Error('Migration roundtrip failed: '+name);}
const require=createRequire(root+'/services/api/package.json'),{Pool}=require('pg'),pool=new Pool({connectionString:runtime.database_url});
try{
 command('up',['exec','prisma','migrate','deploy']);command('up-diff',['exec','prisma','migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code']);
 await pool.query(readFileSync(resolve(root,'docs/prelaunch/cto-review-20261001/migrations/rollback-unused-formal-assembly.sql'),'utf8'));runs.push({name:'guarded-empty-down',exitCode:0});
 const count=await pool.query('SELECT count(*)::int n FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[])',[['20261001090000_v11_runtime_policy_binding','20261001100000_v11_formal_supply_consent_provenance','20261001110000_v11_formal_history_guards','20261001120000_v11_formal_audit_history']]);if(count.rows[0].n!==4)throw Error('Unexpected migration rehearsal baseline');
 // Bookkeeping reset is exclusively for the freshly created disposable database.
 // Never apply this step to a retained environment or production migration history.
 await pool.query('DELETE FROM "_prisma_migrations" WHERE migration_name = ANY($1::text[])',[['20261001090000_v11_runtime_policy_binding','20261001100000_v11_formal_supply_consent_provenance','20261001110000_v11_formal_history_guards','20261001120000_v11_formal_audit_history']]);
 command('rebuild',['exec','prisma','migrate','deploy']);command('rebuild-diff',['exec','prisma','migrate','diff','--from-config-datasource','--to-schema','prisma/schema.prisma','--exit-code']);command('status',['exec','prisma','migrate','status']);
 const applied=await pool.query('SELECT migration_name,finished_at IS NOT NULL AS finished,rolled_back_at IS NOT NULL AS rolled_back FROM "_prisma_migrations" ORDER BY migration_name');writeFileSync(resolve(dir,'MIGRATIONS.json'),JSON.stringify(applied.rows,null,2));
 if(captureCandidate(root).candidate_id!==candidate.candidate_id)throw Error('Source drift during migration roundtrip');
 writeFileSync(resolve(dir,'RUNS.json'),JSON.stringify({candidateId:candidate.candidate_id,scope:'DISPOSABLE_OWNED_UP_EMPTY_DOWN_REBUILD',retainedHistoryRollbackAllowed:false,runs},null,2));console.log(JSON.stringify({evidence:dir,migrations:applied.rows.length}));
}finally{await pool.end();}
