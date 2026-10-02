import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash,randomBytes} from 'node:crypto';
import {mkdtemp,mkdir,readFile,readdir,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {resolve} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit owned source root required');
const infrastructureRoot=fileURLToPath(new URL('../../',import.meta.url));
const {assertProtectedStart}=await import(pathToFileURL(resolve(infrastructureRoot,'scripts/prelaunch-start-guard.mjs')));
const {verifyOwnedEnvironment,TASK_ID,root}=await import(pathToFileURL(resolve(infrastructureRoot,'scripts/prelaunch-owned-env.mjs')));
const sha=b=>createHash('sha256').update(b).digest('hex');
async function inventory(directory){const items=[];for(const name of(await readdir(directory)).sort()){const bytes=await readFile(resolve(directory,name));items.push({path:name,sha256:sha(bytes)});}return items;}
test('PRE001: native wrong worktree and changed starting dirty reject while approved unchanged dirty remains protected with zero writes',async()=>{
 const parent=await mkdtemp(resolve(tmpdir(),'fanju-prelaunch-identity-proof-'));const correct=resolve(parent,'correct'),wrong=resolve(parent,'wrong');await mkdir(correct);await mkdir(wrong);await writeFile(resolve(correct,'protected.txt'),'synthetic original dirty');await writeFile(resolve(wrong,'protected.txt'),'synthetic other project');const baseline={root:correct,status:' M protected.txt\n',hashes:{'protected.txt':sha('synthetic original dirty')}};const before=await inventory(correct),wrongBefore=await inventory(wrong);assert.equal(assertProtectedStart(correct,baseline).protectedStartingDirty,1);assert.deepEqual(await inventory(correct),before);assert.throws(()=>assertProtectedStart(wrong,baseline),/PRELAUNCH_WORKTREE_MISMATCH/);assert.deepEqual(await inventory(wrong),wrongBefore);await writeFile(resolve(correct,'protected.txt'),'synthetic changed after approval');const changedBefore=await inventory(correct);assert.throws(()=>assertProtectedStart(correct,baseline),/PRELAUNCH_STARTING_DIRTY_CHANGED/);assert.deepEqual(await inventory(correct),changedBefore);
});
test('PRE002: native missing and wrong synthetic OWNER reject before runtime read database connection or any writes',async()=>{
 const parent=await mkdtemp(resolve(tmpdir(),'fanju-prelaunch-owner-proof-'));for(const variant of ['MISSING','WRONG_TASK','WRONG_ROOT','WRONG_ID']){const name='fanju-prelaunch-20261001-'+randomBytes(6).toString('hex');const scratch=resolve(parent,name);await mkdir(scratch);if(variant!=='MISSING')await writeFile(resolve(scratch,'OWNER.json'),JSON.stringify({task_id:variant==='WRONG_TASK'?'synthetic-wrong-task':TASK_ID,root:variant==='WRONG_ROOT'?parent:root,random_id:variant==='WRONG_ID'?'synthetic-wrong-id':name}));const before=await inventory(scratch);await assert.rejects(verifyOwnedEnvironment(scratch),e=>variant==='MISSING'?e.code==='ENOENT':e.message==='Scratch owner identity does not match this task and repository');assert.deepEqual(await inventory(scratch),before);assert.equal((await readdir(scratch)).includes('PRELAUNCH_RUNTIME.json'),false,'No runtime file read/created and no DB target supplied');}
});
