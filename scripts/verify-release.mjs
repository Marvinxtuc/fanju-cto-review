import { readFile, readdir, stat, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createHash } from 'node:crypto';

const release = process.argv[2];
if (!release || !process.env.DATABASE_URL) throw new Error('Usage: DATABASE_URL=<disposable DB> node scripts/verify-release.mjs <api-bundle>');
for (const path of ['apps/ops/dist/index.html', 'apps/miniapp/dist/app.js', 'apps/miniapp/dist/app.json', 'apps/miniapp/dist/app.wxss', 'services/api/dist/server.js', 'services/api/dist/worker.js', 'services/api/dist/inbox-audit-cli.js', 'services/api/dist/reconciliation-cli.js']) {
  if ((await stat(path)).size === 0) throw new Error(`Empty artifact: ${path}`);
}
const opsHtml = await readFile('apps/ops/dist/index.html', 'utf8');
const scripts = [...opsHtml.matchAll(/<script[^>]+src="([^"]+)"/g)].map(match => match[1]);
if (!scripts.length) throw new Error('Ops page has no JS entry');
for (const script of scripts) {
  const content = await readFile(join('apps/ops/dist', script), 'utf8');
  if (!process.env.VITE_API_BASE_URL && content.includes('http://localhost:3000')) {
    throw new Error('Default production ops bundle must use same-origin API');
  }
}
const mini = JSON.parse(await readFile('apps/miniapp/dist/app.json', 'utf8'));
if (mini.pages.length < 5) throw new Error('Missing miniapp pages');
for (const page of mini.pages) {
  for (const extension of ['js', 'json', 'wxml']) await stat(`apps/miniapp/dist/${page}.${extension}`);
}
// Production packaging must work without application TypeScript sources or tsx.
try { await stat(join(release, 'src')); throw new Error('API source leaked into release package'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const child = spawn(process.execPath, ['dist/server.js'], {
  cwd: resolve(release),
  env: { ...process.env, API_HOST: '127.0.0.1', API_PORT: '0', LOCAL_DEMO_ENABLED: 'false' },
  stdio: ['ignore', 'pipe', 'pipe'],
});
const exited = once(child, 'exit');
try {
  const origin = await new Promise((resolveOrigin, reject) => {
    const timer = setTimeout(() => reject(new Error('Release API startup timed out')), 15000);
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Release API exited before ready')); });
    let output = '';
    child.stdout.on('data', chunk => {
      output += chunk.toString();
      const match = output.match(/Server listening at (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timer); resolveOrigin(match[1]); }
    });
    // Drain stderr without writing arbitrary runtime configuration to CI artifacts.
    child.stderr.resume();
  });
  for (const path of ['/health', '/api/activities']) {
    const response = await fetch(origin + path, { signal: AbortSignal.timeout(5000) });
    if (response.status !== 200) throw new Error(`${path}: ${response.status}`);
  }
  const response = await fetch(origin + '/api/mock/admin-login', { method: 'POST', signal: AbortSignal.timeout(5000), headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'release-probe', role: 'SUPER_ADMIN' }) });
  if (response.status !== 404) throw new Error('Release demo endpoint must be absent');
} finally {
  child.kill('SIGTERM');
  await exited;
}
const manifest = [];
// Both production-compatible consumers run from packaged JS without channel handlers.
for (const mode of ['events-only', 'inbox-only']) {
  const worker = spawn(process.execPath, ['dist/worker.js', '--once'], {
    cwd: resolve(release),
    env: { ...process.env, WORKER_MODE: mode, FINANCIAL_CASE_OWNER: 'release-smoke-review' },
    stdio: ['ignore', 'ignore', 'ignore'],
  });
  const workerTimeout = setTimeout(() => worker.kill('SIGKILL'), 15000);
  try {
    const [code] = await once(worker, 'exit');
    if (code !== 0) throw new Error(`Packaged ${mode} worker failed startup or one-cycle processing`);
  } finally { clearTimeout(workerTimeout); }
}
async function collect(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) await collect(path);
    else if (entry.isFile()) manifest.push({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') });
  }
}
for (const path of ['apps/ops/dist', 'apps/miniapp/dist', 'services/api/dist', 'packages/shared/dist']) await collect(path);
await mkdir('artifacts', { recursive: true });
await writeFile('artifacts/release-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
console.log(`Release smoke passed; ${manifest.length} artifact hashes recorded. Weapp IDE import and real-provider QA remain separate gates.`);
