import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, lstatSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const excludedParts = new Set(['.git', 'node_modules', 'dist', 'coverage', '.turbo', 'generated', 'artifacts', '.swc', '.cache']);

export function captureCandidate(directory = defaultRoot) {
  const root = resolve(directory);
  const result = spawnSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '-z'], {
    cwd: root, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error('Candidate source inventory requires the actual repository');
  const paths = [...new Set(result.stdout.split('\0').filter(Boolean))].filter(path => {
    if (path.startsWith('docs/prelaunch/')) return false; // Evidence must not make its own candidate circular.
    const parts = path.split('/');
    if (parts.some(part => excludedParts.has(part) || part === '.DS_Store')) return false;
    if (parts.some(part => part.startsWith('.env') && part !== '.env.example')) return false;
    return true;
  }).sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
  const entries = [];
  for (const path of paths) {
    let stat;
    try { stat = lstatSync(resolve(root, path)); }
    catch (error) { if (error.code === 'ENOENT') continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error('Source candidate cannot follow external symlinks');
    entries.push({ path, sha256: createHash('sha256').update(readFileSync(resolve(root, path))).digest('hex') });
  }
  // The Python handoff checker sorts object keys. path then sha256 is that same order.
  const canonical = JSON.stringify(entries);
  const digest = createHash('sha256').update(canonical, 'utf8').digest('hex');
  return {
    candidate_id: digest, source_snapshot_sha256: digest,
    algorithm: 'SHA256 of UTF-8 compact sort_keys JSON list of {path,sha256}, relative source paths sorted by UTF-8; no trailing newline',
    excluded: ['docs/prelaunch/**', '.git', 'node_modules', 'dist', 'coverage', '.turbo', 'generated', 'artifacts', '.swc', '.cache', 'non-example .env files'],
    source_file_count: entries.length, files: entries,
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length && (args[0] !== '--root' || args.length !== 2)) throw new Error('Usage: node scripts/prelaunch-candidate-hash.mjs [--root <repository>]');
  console.log(JSON.stringify(captureCandidate(args[1] || defaultRoot), null, 2));
}
