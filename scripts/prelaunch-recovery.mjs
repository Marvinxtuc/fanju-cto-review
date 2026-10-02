// Synthetic backup/restore foundation. No drop, reset, truncate, or user .env reads.
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { root, verifyOwnedEnvironment, createOwnedDatabase, safeBaseEnv, redact } from './prelaunch-owned-env.mjs';
import { captureCandidate } from './prelaunch-candidate-hash.mjs';
const [scratch]=process.argv.slice(2);
if (!scratch) throw new Error('Usage: node scripts/prelaunch-recovery.mjs <owned-scratch>');
const {runtime:source,evidence:sourceOwner}=await verifyOwnedEnvironment(scratch);
const candidate=captureCandidate(root),started_at=new Date().toISOString();
const runId=`restore-${started_at.replaceAll(/[:.]/g,'-')}`;
const directory=resolve(root,'docs/prelaunch/evidence',runId);mkdirSync(directory,{recursive:true});
const { Pool }=createRequire(resolve(root,'services/api/package.json'))('pg');
function docker(args,input) {
  const result=spawnSync('docker',['--context','colima',...args],{cwd:root,env:safeBaseEnv(),input,maxBuffer:128*1024*1024,timeout:120_000});
  if(result.status!==0) throw new Error(`Owned backup operation failed: ${redact(result.stderr.toString(),source)}`);
  return result.stdout;
}
async function inventory(runtime) {
  const pool=new Pool({connectionString:runtime.database_url,max:1});
  try {
    const tables=(await pool.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows.map(row=>row.tablename);
    const rows=[];
    for(const table of tables) {
      // Identifier comes only from PostgreSQL catalog; quote exact identifier.
      const name='"'+table.replaceAll('"','""')+'"';
      const values=(await pool.query(`SELECT row_to_json(t)::text AS row FROM public.${name} t ORDER BY row_to_json(t)::text`)).rows;
      const digest=createHash('sha256');for(const value of values) digest.update(value.row).update('\n');
      rows.push({table,count:values.length,sha256:digest.digest('hex')});
    }
    return rows;
  } finally {await pool.end();}
}
const before=await inventory(source);
const {runtime:restore,evidence:restoreOwner}=await createOwnedDatabase(scratch,'restore',{fresh:true});
if((await inventory(restore)).length!==0) throw new Error('Restore target is already populated: refuse destructive overwrite; use a newly owned recovery environment');
await verifyOwnedEnvironment(scratch);await verifyOwnedEnvironment(scratch,'restore');
const backup=docker(['exec',source.container,'pg_dump','-U',source.user,'-d',source.database,'--format=custom','--schema=public','--no-owner','--no-privileges']);
const backupPath=resolve(source.scratch,`${runId}.dump`);writeFileSync(backupPath,backup,{mode:0o600});
// The private synthetic dump stays outside delivery. Hash/count evidence is public.
const list=docker(['exec','-i',restore.container,'pg_restore','--list'],backup).toString('utf8');
const tocLines=list.split('\n');
const publicSchema=/^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+public\s+\S+\s*$/;
const matching=tocLines.filter(line=>publicSchema.test(line));
if(matching.length!==1)throw new Error('Expected exactly one CREATE SCHEMA public archive entry; refuse broad restore filtering');
const filtered=tocLines.map(line=>publicSchema.test(line)?'; '+line+' -- pre-existing empty public schema preserved':line).join('\n');
const tocPath=resolve(source.scratch,`${runId}.toc`);writeFileSync(tocPath,filtered,{mode:0o600});
const containerToc=`/tmp/${runId}.toc`;
await verifyOwnedEnvironment(scratch,'restore');
docker(['cp',tocPath,`${restore.container}:${containerToc}`]);
// Ignore only the already-existing default public schema. All tables/data/constraints
// remain selected, and --exit-on-error still rejects every other restore failure.
docker(['exec','-i',restore.container,'pg_restore','-U',restore.user,'-d',restore.database,'--use-list',containerToc,'--exit-on-error','--no-owner','--no-privileges'],backup);
writeFileSync(resolve(directory,'restore-toc.list'),filtered);

await verifyOwnedEnvironment(scratch,'restore');
const after=await inventory(restore);
const drift=captureCandidate(root).candidate_id!==candidate.candidate_id;
const equal=JSON.stringify(before)===JSON.stringify(after);
const evidence={id:runId,category:'BACKUP_RESTORE_FOUNDATION',candidate_id:candidate.candidate_id,runner:'native',
 command:'node scripts/prelaunch-recovery.mjs <owned-scratch>',cwd:root,started_at,finished_at:new Date().toISOString(),
 exit_code:equal&&!drift?0:1,toolchain:{node:process.version,postgres:sourceOwner.postgres_version},
 source_environment:sourceOwner,restore_environment:restoreOwner,backup_sha256:createHash('sha256').update(backup).digest('hex'),
 backup_bytes:backup.length,backup_location:'PRIVATE_OWNED_SCRATCH_NOT_DELIVERED',before,after,
 source_drift_during_run:drift,content_restored_exactly:equal,
 qualification:'This verifies synthetic public-schema backup restoration. Channel-loss reconciliation and privacy replay require separate business tests; they are not PASS here.',
 artifact_paths:[`docs/prelaunch/evidence/${runId}/RESTORE.json`,`docs/prelaunch/evidence/${runId}/restore-toc.list`]};
writeFileSync(resolve(directory,'RESTORE.json'),JSON.stringify(evidence,null,2)+'\n');
console.log(`Synthetic restoration ${equal&&!drift?'PASS':'FAIL'}: ${before.length} tables; evidence ${directory}`);
if(!equal||drift)process.exitCode=1;
