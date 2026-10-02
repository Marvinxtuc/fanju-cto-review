import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, realpathSync, cpSync } from 'node:fs';
import { resolve } from 'node:path';
import { root, childEnvironment, redact, verifyOwnedEnvironment } from './prelaunch-owned-env.mjs';
import { captureCandidate } from './prelaunch-candidate-hash.mjs';

const [mode, scratch, runRootInput, databaseKey = 'main'] = process.argv.slice(2);
if (!['guard-selfcheck', 'baseline', 'migration', 'worker-compat'].includes(mode) || !scratch) {
  throw new Error('Usage: node scripts/prelaunch-verify.mjs guard-selfcheck|baseline|migration|worker-compat <owned-scratch> [baseline-run-root]');
}
const { runtime, evidence: environment } = await verifyOwnedEnvironment(scratch, databaseKey);
const env = childEnvironment(runtime);
const runRoot = realpathSync(runRootInput || root);
if (runRoot !== root && !runRoot.startsWith(runtime.scratch + '/')) throw new Error('Baseline run copy must belong to this owned scratch');
const baseline = JSON.parse(readFileSync(resolve(root, 'docs/prelaunch/baseline/BASELINE_SNAPSHOT.json'), 'utf8'));
const baselineId = createHash('sha256').update(JSON.stringify(baseline.hashes)).digest('hex');
if (runRoot !== root) {
  for (const [path, expected] of Object.entries(baseline.hashes)) {
    if (createHash('sha256').update(readFileSync(resolve(runRoot, path))).digest('hex') !== expected) {
      throw new Error('Baseline run copy does not match frozen starting bytes');
    }
  }
}
const runId = `${mode}-${new Date().toISOString().replaceAll(/[:.]/g, '-')}`;
const directory = resolve(root, 'docs/prelaunch/evidence', runId);
mkdirSync(directory, { recursive: true });
const runs = [];

async function run(id, command, args, cwd, timeoutMs = 120_000) {
  await verifyOwnedEnvironment(scratch, databaseKey);
  const started = new Date().toISOString();
  const candidate = runRoot === root ? captureCandidate(root) : null;
  let stdout = '', stderr = '';
  const result = await new Promise((resolveExit, reject) => {
    const child = spawn(command, args, { cwd: resolve(runRoot, cwd), env, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    const timeout = setTimeout(() => {
      try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); }
    }, timeoutMs);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('close', (code, signal) => { clearTimeout(timeout); resolveExit({ code, signal }); });
  });
  stdout = redact(stdout, runtime); stderr = redact(stderr, runtime);
  const stdoutPath = resolve(directory, `${id}.stdout.log`), stderrPath = resolve(directory, `${id}.stderr.log`);
  writeFileSync(stdoutPath, stdout); writeFileSync(stderrPath, stderr);
  const entry = {
    run_id: `${runId}-${id}`, category: candidate ? 'ENGINEERING_PROGRESS_NOT_FINAL' : 'BASELINE_NOT_FINAL_CANDIDATE', native_or_adapter: 'NATIVE',
    candidate_id: candidate?.candidate_id ?? `BASELINE_STARTING_272:${baselineId}`, baseline_source_count: Object.keys(baseline.hashes).length,
    command: [command, ...args], cwd: resolve(runRoot, cwd), started, finished: new Date().toISOString(),
    exit_code: result.code, signal: result.signal, status: result.code === 0 ? 'PASS' : 'FAIL',
    stdout: stdoutPath.replace(root + '/', ''), stderr: stderrPath.replace(root + '/', ''),
    stdout_sha256: createHash('sha256').update(stdout).digest('hex'),
    stderr_sha256: createHash('sha256').update(stderr).digest('hex'),
    passed: null, failed: null, skipped: null, todo: null,
    synthetic_only: true, production_authorized: false,
  };
  if (candidate) {
    entry.source_snapshot_after = captureCandidate(root).candidate_id;
    entry.source_drift_during_run = entry.source_snapshot_after !== candidate.candidate_id;
    writeFileSync(resolve(directory, `${id}.source.json`), JSON.stringify(candidate, null, 2) + '\n');
  }
  const summary = stdout.match(/Tests\s+.*?([\d]+) passed.*?\(([\d]+)\)/);
  if (summary) entry.passed = Number(summary[1]);
  if (args.includes('--test')) {
    for (const [key, name] of [['passed', 'pass'], ['failed', 'fail'], ['skipped', 'skipped'], ['todo', 'todo']]) {
      const count = stdout.match(new RegExp(`# ${name} (\\d+)`));
      if (count) entry[key] = Number(count[1]);
    }
    if (entry.failed !== 0 || entry.skipped !== 0 || entry.todo !== 0 || !(entry.passed > 0)) entry.status = 'FAIL';
  }
  const jsonFile = args.find(arg => arg.startsWith('--outputFile='));
  if (jsonFile) {
    try {
      const report = JSON.parse(readFileSync(jsonFile.slice('--outputFile='.length), 'utf8'));
      entry.passed = report.numPassedTests; entry.failed = report.numFailedTests;
      entry.skipped = report.numPendingTests; entry.todo = report.numTodoTests;
      entry.test_report = jsonFile.slice('--outputFile='.length).replace(root + '/', '');
      if (!report.success || report.numTotalTests === 0 || report.numPendingTests > 0 || report.numTodoTests > 0) entry.status = 'FAIL';
    } catch { entry.status = 'FAIL'; entry.report_error = 'NATIVE_REPORT_UNAVAILABLE'; }
  }
  runs.push(entry);
  writeFileSync(resolve(directory, 'RUNS.json'), JSON.stringify({ run_id: runId, environment, runs }, null, 2) + '\n');
  console.log(`${id}: ${entry.status}; exit=${entry.exit_code}; passed=${entry.passed ?? 'N/A'} failed=${entry.failed ?? 'N/A'} skipped=${entry.skipped ?? 'N/A'}`);
  return entry;
}

// Each attempted destination is rejected by the preload before any socket is created.
const guardSource = `
import assert from 'node:assert/strict';
import net from 'node:net';
import https from 'node:https';
import tls from 'node:tls';
await assert.rejects(fetch('https://api.weixin.qq.com/'), /PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(() => net.connect({ host: '127.0.0.1', port: 5432 }), /PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(() => net.connect({ host: 'example.com', port: 443 }), /PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(() => https.request('https://api.mch.weixin.qq.com/'), /PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
assert.throws(() => tls.connect({ host: 'example.com', port: 443 }), /PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN/);
console.log('Five external/old-DB transports rejected before socket creation.');
`;
const guard = await run('network-guard', process.execPath, ['--input-type=module', '-e', guardSource], '.', 15_000);
if (guard.status !== 'PASS') throw new Error('Prelaunch network guard selfcheck failed; no baseline command allowed');
if (mode === 'guard-selfcheck') process.exit(0);

if (mode === 'migration') {
  for (const [id, args] of [
    ['schema-validate', ['exec', 'prisma', 'validate']],
    ['migrate-deploy', ['exec', 'prisma', 'migrate', 'deploy']],
    ['prisma-generate', ['exec', 'prisma', 'generate']],
    ['migrate-status', ['exec', 'prisma', 'migrate', 'status']],
    ['schema-diff', ['exec', 'prisma', 'migrate', 'diff', '--from-config-datasource', '--to-schema', 'prisma/schema.prisma', '--script', '--exit-code']],
  ]) {
    const result = await run(id, 'pnpm', args, '.');
    if (result.status !== 'PASS') throw new Error(`Owned migration verification failed: ${id}; logs preserved`);
  }
  console.log(`Migration evidence: ${directory}`);
  process.exit(0);
}

if (mode === 'worker-compat') {
  const consumerRoot = resolve(runtime.scratch, runId + '-consumer');
  for (const [path, expected] of Object.entries(baseline.hashes)) {
    if (createHash('sha256').update(readFileSync(resolve(runtime.scratch, 'baseline-run', path))).digest('hex') !== expected) throw Error('Legacy consumer baseline bytes drifted');
  }
  cpSync(resolve(runtime.scratch, 'baseline-run'), consumerRoot, { recursive: true, dereference: false, verbatimSymlinks: true });
  // The worker's scoped queue API is part of its compatibility boundary.
  // Copy the exact current modules as a unit; keep all other legacy bytes intact.
  const consumerOverlay = ['services/api/src/worker.ts', 'services/api/src/jobs/queue.ts'];
  const overlayHashes = {};
  for (const path of consumerOverlay) {
    const source = readFileSync(resolve(root, path));
    writeFileSync(resolve(consumerRoot, path), source);
    overlayHashes[path] = createHash('sha256').update(source).digest('hex');
  }
  // Fix only the workspace package links so this old consumer loads its own legacy shared build.
  const provenance = {
    consumer: 'STARTING_272_SOURCE_PLUS_CURRENT_LEGACY_WORKER_AND_SCOPED_QUEUE', baseline_id: baselineId,
    worker_source_sha256: overlayHashes['services/api/src/worker.ts'],
    overlay_source_sha256: overlayHashes,
    current_schema: 'ADDITIVE_V11', synthetic_only: true, production_authorized: false,
  };
  writeFileSync(resolve(directory, 'CONSUMER_PROVENANCE.json'), JSON.stringify(provenance, null, 2) + '\n');
  env.PRELAUNCH_COMPAT_WORKER_ROOT = consumerRoot;
  const build = await run('legacy-worker-build', 'pnpm', ['build'], resolve(consumerRoot, 'services/api'));
  if (build.status !== 'PASS') throw new Error('Legacy compatible consumer build failed');
  await run('legacy-worker-process', process.execPath, ['--test', 'tests/prelaunch/legacy-worker.test.mjs'], '.');
  console.log(`Legacy consumer compatibility evidence: ${directory}`);
  if (runs.some(run => run.status !== 'PASS')) process.exitCode = 1;
  process.exit();
}

const versions = await run('tool-versions', process.execPath, ['--input-type=module', '-e', `
import { createRequire } from 'node:module';
const require=createRequire(process.cwd()+'/package.json');
console.log('Node',process.version);
for(const name of ['vitest','typescript','prisma'])console.log(name,require(name+'/package.json').version);
`], '.');
if (versions.status !== 'PASS') throw new Error('Existing tool version discovery failed');

// These commands were read before authorization. All target the explicit owned database.
for (const [id, args, cwd] of [
  ['migrate-deploy', ['exec', 'prisma', 'migrate', 'deploy'], '.'],
  ['prisma-generate', ['exec', 'prisma', 'generate'], '.'],
  ['shared-build', ['build'], 'packages/shared'],
]) {
  const result = await run(id, 'pnpm', args, cwd);
  if (result.status !== 'PASS') throw new Error(`Baseline preparation failed: ${id}; logs preserved`);
}

const a1Report = resolve(directory, 'a1-tests.json');
await run('a1-52-native', 'pnpm', ['exec', 'vitest', 'run', 'src/rules/policyBundle.test.ts', '--no-cache', '--reporter=verbose', '--reporter=json', `--outputFile=${a1Report}`, '--no-file-parallelism'], 'packages/shared');
for (const [id, cwd] of [['shared', 'packages/shared'], ['api', 'services/api'], ['ops', 'apps/ops'], ['miniapp', 'apps/miniapp']]) {
  const report = resolve(directory, `${id}-tests.json`);
  await run(`${id}-native`, 'pnpm', ['exec', 'vitest', 'run', '--no-cache', '--reporter=verbose', '--reporter=json', `--outputFile=${report}`, '--no-file-parallelism'], cwd, 180_000);
  await run(`${id}-typecheck`, 'pnpm', ['typecheck'], cwd);
}
await verifyOwnedEnvironment(scratch);
console.log(`Baseline evidence: ${directory}`);
if (runs.some(run => run.status !== 'PASS')) process.exitCode = 1;
