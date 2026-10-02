import { createHash } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
// Only frozen starting dirty is protected. Authorized task implementation files are
// intentionally not compared against their baseline bytes.
export function assertProtectedStart(directory, baseline) {
 const actual=realpathSync(directory);
 if(actual!==realpathSync(baseline.root))throw Error('PRELAUNCH_WORKTREE_MISMATCH');
 if(typeof baseline.status!=='string'||!baseline.hashes||typeof baseline.hashes!=='object')throw Error('PRELAUNCH_BASELINE_INVALID');
 const protectedPaths=baseline.status.split('\n').filter(Boolean).map(line=>line.slice(3));
 for(const path of protectedPaths){if(!path||path.startsWith('/')||path.split('/').some(part=>part==='..'||part===''))throw Error('PRELAUNCH_PROTECTED_PATH_INVALID');const expected=baseline.hashes[path];if(typeof expected!=='string'||!/^[a-f0-9]{64}$/.test(expected))throw Error('PRELAUNCH_PROTECTED_HASH_MISSING');let bytes;try{bytes=readFileSync(resolve(actual,path));}catch{throw Error('PRELAUNCH_STARTING_DIRTY_CHANGED');}if(createHash('sha256').update(bytes).digest('hex')!==expected)throw Error('PRELAUNCH_STARTING_DIRTY_CHANGED');}
 return { root:actual,protectedStartingDirty:protectedPaths.length,scope:'READ_ONLY_GUARD' };
}
