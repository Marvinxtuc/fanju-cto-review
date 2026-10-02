import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

if (process.env.RUN_DB_TESTS !== '1' || !process.env.DATABASE_URL) {
  throw new Error('CI requires RUN_DB_TESTS=1 and an explicit disposable DATABASE_URL');
}
mkdirSync('artifacts', { recursive: true });
let total = 0;
for (const project of ['packages/shared', 'services/api', 'apps/ops', 'apps/miniapp']) {
  const report = resolve('artifacts', project.replaceAll('/', '-') + '.json');
  const result = spawnSync('pnpm', ['exec', 'vitest', 'run', '--reporter=default', '--reporter=json', `--outputFile=${report}`], {
    cwd: project, stdio: 'inherit', env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
  const data = JSON.parse(readFileSync(report, 'utf8'));
  if (!data.success || data.numTotalTests === 0 || data.numPendingTests !== 0 || data.numTodoTests > 0) {
    throw new Error(`${project}: empty, skipped or unsuccessful tests`);
  }
  if (project === 'services/api') {
    const db = data.testResults.find(suite => suite.name.endsWith('/app.test.ts'));
    if (!db || db.assertionResults.length < 27 || db.assertionResults.some(test => test.status !== 'passed')) {
      throw new Error('DB regression suite must execute all baseline assertions');
    }
  }
  total += data.numTotalTests;
}
console.log(`CI: ${total} tests passed; zero skipped/todo; DB baseline present.`);
