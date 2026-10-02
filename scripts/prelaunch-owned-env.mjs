import { spawnSync } from 'node:child_process';
import { normalizeRequestTiming } from './prelaunch-log-metrics.mjs';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, existsSync, realpathSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import http from 'node:http';
import https from 'node:https';

export const TASK_ID = 'FJ-PRELAUNCH-MASTER-V1.1-20261001-01';
export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const purpose = 'synthetic-local-prelaunch';
const context = 'colima';
const runtimeName = 'PRELAUNCH_RUNTIME.json';
const requireApi = createRequire(new URL('../services/api/package.json', import.meta.url));
const providerNames = ['AUTH_PROVIDER', 'PHONE_PROVIDER', 'PAYMENT_PROVIDER', 'REFUND_PROVIDER'];

export function safeBaseEnv() {
  const env = {};
  for (const name of ['PATH', 'HOME', 'TMPDIR', 'LANG', 'LC_ALL', 'TERM']) {
    if (process.env[name]) env[name] = process.env[name];
  }
  return env;
}

function docker(args, input) {
  const result = spawnSync('docker', ['--context', context, ...args], {
    cwd: root, env: safeBaseEnv(), encoding: 'utf8', input, timeout: 30_000,
    maxBuffer: 8 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Owned docker operation failed (${args[0]}): ${result.stderr?.trim() || result.error?.code || result.status}`);
  return result.stdout.trim();
}

function ownerAt(scratch) {
  const directory = realpathSync(scratch);
  if (!/^fanju-prelaunch-20261001-[a-f0-9]{12}$/.test(directory.split('/').at(-1) ?? '')) {
    throw new Error('Invalid prelaunch scratch identity');
  }
  const owner = JSON.parse(readFileSync(resolve(directory, 'OWNER.json'), 'utf8'));
  if (owner.task_id !== TASK_ID || owner.root !== root || owner.random_id !== directory.split('/').at(-1)) {
    throw new Error('Scratch owner identity does not match this task and repository');
  }
  return { directory, owner };
}

export function loadRuntime(scratch, databaseKey = 'main') {
  const { directory, owner } = ownerAt(scratch);
  let runtime = JSON.parse(readFileSync(resolve(directory, runtimeName), 'utf8'));
  if (runtime.task_id !== TASK_ID || runtime.owner_id !== owner.random_id || runtime.root !== root) {
    throw new Error('Runtime ownership mismatch');
  }
  if (databaseKey !== 'main') {
    if (!['empty', 'channel', 'restore'].includes(databaseKey) || !runtime.additional_databases?.[databaseKey]) throw new Error('Unregistered owned database selection');
    runtime = { ...runtime, ...runtime.additional_databases[databaseKey], database_key: databaseKey };
  }
  const url = new URL(runtime.database_url);
  if (url.protocol !== 'postgresql:' || url.hostname !== '127.0.0.1' || url.port === '5432'
      || Number(url.port) !== runtime.host_port || url.pathname !== `/${runtime.database}`
      || decodeURIComponent(url.username) !== runtime.user || decodeURIComponent(url.password) !== runtime.password) {
    throw new Error('Runtime database target is not the recorded owned endpoint');
  }
  return { ...runtime, scratch: directory };
}

function assertLabels(actual, runtime) {
  if (actual?.['fanju.task'] !== TASK_ID || actual?.['fanju.owner'] !== runtime.owner_id
      || actual?.['fanju.purpose'] !== purpose) throw new Error('Docker ownership label mismatch');
}

function assertContainer(runtime) {
  const endpoint = docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
  if (!endpoint.startsWith('unix:///')) throw new Error('Only a local Unix Docker endpoint is allowed');
  const [container] = JSON.parse(docker(['inspect', runtime.container]));
  assertLabels(container.Config.Labels, runtime);
  if (container.Image !== runtime.image_id || !container.State.Running) throw new Error('Owned PostgreSQL container identity/state mismatch');
  const networks = Object.keys(container.NetworkSettings.Networks);
  if (networks.length !== 1 || networks[0] !== runtime.network) throw new Error('Owned container network mismatch');
  const [network] = JSON.parse(docker(['network', 'inspect', runtime.network]));
  assertLabels(network.Labels, runtime);
  if (network.Options?.['com.docker.network.bridge.enable_ip_masquerade'] !== 'false') {
    throw new Error('Owned PostgreSQL bridge must disable outbound masquerading');
  }
  const [volume] = JSON.parse(docker(['volume', 'inspect', runtime.volume]));
  assertLabels(volume.Labels, runtime);
  const mounts = container.Mounts;
  if (mounts.length !== 1 || mounts[0].Type !== 'volume' || mounts[0].Name !== runtime.volume
      || mounts[0].Destination !== '/var/lib/postgresql/data') throw new Error('Owned PostgreSQL volume mismatch');
  const bindings = container.NetworkSettings.Ports['5432/tcp'];
  if (bindings?.length !== 1 || bindings[0].HostIp !== '127.0.0.1'
      || Number(bindings[0].HostPort) !== runtime.host_port || runtime.host_port === 5432) {
    throw new Error('Owned PostgreSQL must use a new loopback port');
  }
  return container;
}

export async function verifyOwnedEnvironment(scratch, databaseKey = 'main') {
  const runtime = loadRuntime(scratch, databaseKey);
  const container = assertContainer(runtime); // No database connection occurs before object ownership checks.
  const { Pool } = requireApi('pg');
  const pool = new Pool({ connectionString: runtime.database_url, connectionTimeoutMillis: 5000, max: 1 });
  try {
    const { rows } = await pool.query('SELECT task_id, owner_id, purpose, current_database() AS database, current_user AS "user", version() AS version FROM prelaunch_control.owner');
    if (rows.length !== 1 || rows[0].task_id !== TASK_ID || rows[0].owner_id !== runtime.owner_id
        || rows[0].purpose !== purpose || rows[0].database !== runtime.database || rows[0].user !== runtime.user) {
      throw new Error('Database owner marker or identity mismatch');
    }
    return { runtime, evidence: {
      task_id: TASK_ID, owner_id: runtime.owner_id, root, context,
      container: runtime.container, container_id: container.Id, image_id: runtime.image_id,
      volume: runtime.volume, network: runtime.network, network_internal: networkInternal(runtime),
      network_outbound_masquerade: false, client_network_allowlist_required: true,
      host: '127.0.0.1', host_port: runtime.host_port, database: runtime.database,
      database_owner: runtime.user, database_marker_verified: true,
      postgres_version: rows[0].version, production_authorized: false,
      existing_database_connected: false, verified_at: new Date().toISOString(),
    } };
  } finally { await pool.end(); }
}

function networkInternal(runtime) {
  return JSON.parse(docker(['network', 'inspect', runtime.network]))[0].Internal;
}

export function childEnvironment(runtime) {
  const env = {
    ...safeBaseEnv(), NODE_ENV: 'test', APP_ENV: 'ci', RUN_DB_TESTS: '1',
    DATABASE_URL: runtime.database_url, SESSION_SECRET: runtime.session_secret,
    PRELAUNCH_MODE: 'SIMULATION_ONLY', PRELAUNCH_OWNER_MARKER: runtime.owner_id,
    PRELAUNCH_DATABASE_NAME: runtime.database, PRELAUNCH_SESSION_SECRET: runtime.session_secret,
    PRELAUNCH_DATABASE_KEY: runtime.database_key ?? 'main',
    ...(runtime.additional_databases?.channel ? {
      PRELAUNCH_CHANNEL_DATABASE_URL: runtime.additional_databases.channel.database_url,
      PRELAUNCH_CHANNEL_DATABASE_NAME: runtime.additional_databases.channel.database,
    } : {}),
    LOCAL_DEMO_ENABLED: 'false', WECHAT_PAY_ENABLED: 'false', FEATURE_REAL_WECHAT_PAY: 'false',
    NEW_PAYMENTS_ENABLED: 'false', FINANCIAL_CASE_OWNER: 'SIMULATION-prelaunch-owner',
    API_HOST: '127.0.0.1', API_PORT: '0', CI: 'true',
    TARO_APP_API_BASE_URL: 'http://127.0.0.1:3000', TARO_APP_PRELAUNCH_ENABLED:'true', VITE_FANJU_PRELAUNCH_ENABLED:'true', VITE_API_BASE_URL: 'http://127.0.0.1:3000',
    PRELAUNCH_ENV_FILE: resolve(runtime.scratch, runtimeName), PRELAUNCH_NETWORK_GUARD: '1',
    NODE_OPTIONS: `--import=${new URL(import.meta.url).href}`,
  };
  for (const name of providerNames) env[name] = 'mock';
  return env;
}

export function redact(text, runtime) {
  let value = normalizeRequestTiming(text ?? '');
  for (const secret of [runtime?.database_url, runtime?.password, runtime?.session_secret, ...Object.values(runtime?.additional_databases ?? {}).map(db => db.database_url)]) {
    if (secret) value = value.replaceAll(secret, '[SYNTHETIC_REDACTED]');
  }
  return value;
}

function installNetworkGuard() {
  const path = process.env.PRELAUNCH_ENV_FILE;
  if (!path || !path.endsWith(`/${runtimeName}`)) throw new Error('Prelaunch network guard requires its owned runtime');
  const runtime = loadRuntime(dirname(path), process.env.PRELAUNCH_DATABASE_KEY ?? 'main');
  if (providerNames.some(name => process.env[name] !== 'mock') || process.env.WECHAT_PAY_ENABLED !== 'false'
      || process.env.FEATURE_REAL_WECHAT_PAY !== 'false' || process.env.NEW_PAYMENTS_ENABLED !== 'false'
      || process.env.DATABASE_URL !== runtime.database_url) throw new Error('Prelaunch requires explicit mock-only runtime configuration');
  const processBound = new Map();
  const originalListen = net.Server.prototype.listen;
  net.Server.prototype.listen = function (...args) {
    // Constrain otherwise-unspecified test listeners to IPv4 loopback.
    if (typeof args[0] === 'number') {
      if (typeof args[1] !== 'string') args.splice(1, 0, '127.0.0.1');
      if (!['127.0.0.1', '::1'].includes(args[1])) throw new Error('PRELAUNCH_UNOWNED_LISTENER_FORBIDDEN');
    } else if (args[0] && typeof args[0] === 'object' && Number.isInteger(args[0].port)) {
      args[0] = { ...args[0], host: args[0].host ?? '127.0.0.1' };
      if (!['127.0.0.1', '::1'].includes(args[0].host)) throw new Error('PRELAUNCH_UNOWNED_LISTENER_FORBIDDEN');
    } else throw new Error('PRELAUNCH_UNOWNED_LISTENER_FORBIDDEN');
    this.prependOnceListener('listening', () => {
      const address = this.address();
      if (address && typeof address === 'object' && ['127.0.0.1', '::1'].includes(address.address)) {
        processBound.set(address.port, address.address);
        this.once('close', () => processBound.delete(address.port));
      }
    });
    return originalListen.apply(this, args);
  };
  const allowed = (host, port) => {
    const bound = processBound.get(Number(port));
    if (bound && ['127.0.0.1', '::1', '[::1]', 'localhost'].includes(String(host))) return;
    // Only the actual owned IPv4 DB binding or a parent-registered live task API.
    if (String(host) !== '127.0.0.1' || !Number.isInteger(Number(port)) || Number(port) === 5432) {
      throw new Error('PRELAUNCH_EXTERNAL_NETWORK_FORBIDDEN');
    }
    if (Number(port) === runtime.host_port) return;
    const current = loadRuntime(runtime.scratch, process.env.PRELAUNCH_DATABASE_KEY ?? 'main');
    const endpoint = (current.owned_endpoints ?? []).find(entry => entry.host === '127.0.0.1'
      && entry.port === Number(port) && entry.kind === 'task_owned_api'
      && entry.task_id === TASK_ID && entry.owner_id === runtime.owner_id);
    if (endpoint && Number.isInteger(endpoint.pid) && endpoint.pid > 0) {
      try { process.kill(endpoint.pid, 0); return; } catch { /* Dead endpoints fail closed. */ }
    }
    throw new Error('PRELAUNCH_UNOWNED_LOOPBACK_FORBIDDEN');
  };
  const destination = (args, defaultPort) => {
    const first = args[0];
    if (first instanceof URL || typeof first === 'string') {
      const url = new URL(first);
      return [url.hostname, Number(url.port || defaultPort)];
    }
    if (typeof first === 'number') return [typeof args[1] === 'string' ? args[1] : 'localhost', first];
    if (!first || typeof first !== 'object' || first.path && !first.port) {
      throw new Error('PRELAUNCH_UNOWNED_SOCKET_FORBIDDEN');
    }
    return [first.hostname ?? first.host ?? 'localhost', first.port ?? defaultPort];
  };
  const originalSocketConnect = net.Socket.prototype.connect;
  net.Socket.prototype.connect = function (...args) {
    // Node's net.connect internally passes its normalized argument array to Socket.connect.
    const normalized = Array.isArray(args[0]) ? args[0] : args;
    const [host, port] = destination(normalized);
    allowed(host, port);
    return originalSocketConnect.apply(this, args);
  };
  for (const [module, defaultPort] of [[http, 80], [https, 443]]) {
    const original = module.request;
    module.request = function (...args) {
      const [host, port] = destination(args, defaultPort); allowed(host, port);
      return original.apply(this, args);
    };
    module.get = function (...args) { const request = module.request(...args); request.end(); return request; };
  }
  const originalTlsConnect = tls.connect;
  tls.connect = function (...args) {
    const [host, port] = destination(args, 443); allowed(host, port);
    return originalTlsConnect.apply(this, args);
  };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function (input, init) {
    const url = new URL(input instanceof Request ? input.url : input);
    try { allowed(url.hostname, Number(url.port || (url.protocol === 'https:' ? 443 : 80))); }
    catch (error) { return Promise.reject(error); }
    return originalFetch(input, init);
  };
  syncBuiltinESMExports();
}

async function createOwnedEnvironment(scratch) {
  const { directory, owner } = ownerAt(scratch);
  const runtimePath = resolve(directory, runtimeName);
  if (existsSync(runtimePath)) {
    const runtime = loadRuntime(directory);
    if (!runtime.owner_marker_initialized) await initializeMarker(runtime);
    return verifyOwnedEnvironment(directory);
  }
  if (!docker(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']).startsWith('unix:///')) {
    throw new Error('Docker endpoint is not local');
  }
  const imageId = docker(['image', 'inspect', 'postgres:16-alpine', '--format', '{{.Id}}']);
  const suffix = randomBytes(6).toString('hex');
  const base = `fj-prelaunch-${suffix}`;
  const runtime = {
    task_id: TASK_ID, owner_id: owner.random_id, root,
    container: `${base}-db`, volume: `${base}-data`, network: `${base}-net`,
    image_id: imageId, database: `fanju_prelaunch_${suffix}`, user: `fj_${suffix}`,
    password: randomBytes(24).toString('hex'), session_secret: randomBytes(48).toString('hex'),
    created_at: new Date().toISOString(), scratch: directory,
  };
  const labels = ['--label', `fanju.task=${TASK_ID}`, '--label', `fanju.owner=${owner.random_id}`, '--label', `fanju.purpose=${purpose}`];
  // Save ownership even if a later resource creation fails; never silently remove unrelated resources.
  writeFileSync(resolve(directory, 'PRELAUNCH_RESOURCE_INTENT.json'), JSON.stringify({
    task_id: TASK_ID, owner_id: runtime.owner_id, container: runtime.container,
    network: runtime.network, volume: runtime.volume, image_id: imageId,
  }, null, 2) + '\n', { mode: 0o600 });
  // Docker 29 does not publish host ports on --internal networks. Use an owned bridge
  // with outbound masquerading disabled; all application clients also use the preload allowlist.
  docker(['network', 'create', '--opt', 'com.docker.network.bridge.enable_ip_masquerade=false', ...labels, runtime.network]);
  docker(['volume', 'create', ...labels, runtime.volume]);
  docker(['run', '-d', '--name', runtime.container, ...labels, '--network', runtime.network,
    '--publish', '127.0.0.1::5432', '--mount', `type=volume,source=${runtime.volume},target=/var/lib/postgresql/data`,
    '--env', `POSTGRES_USER=${runtime.user}`, '--env', `POSTGRES_PASSWORD=${runtime.password}`,
    '--env', `POSTGRES_DB=${runtime.database}`, imageId]);
  const [container] = JSON.parse(docker(['inspect', runtime.container]));
  runtime.host_port = Number(container.NetworkSettings.Ports['5432/tcp'][0].HostPort);
  runtime.database_url = `postgresql://${runtime.user}:${runtime.password}@127.0.0.1:${runtime.host_port}/${runtime.database}`;
  writeFileSync(runtimePath, JSON.stringify(runtime, null, 2) + '\n', { mode: 0o600 });
  await initializeMarker(runtime);
  return verifyOwnedEnvironment(directory);
}

async function initializeMarker(runtime) {
  assertContainer(runtime);
  let ready = false;
  for (let attempt = 0; attempt < 40; attempt++) {
    // The image's temporary initialization server has a Unix socket before POSTGRES_DB exists.
    // TCP acceptance plus an actual query proves final initialization completed.
    const result = spawnSync('docker', ['--context', context, 'exec', runtime.container, 'psql', '-h', '127.0.0.1', '-U', runtime.user, '-d', runtime.database, '-tAc', 'SELECT 1'],
      { cwd: root, env: safeBaseEnv(), encoding: 'utf8', timeout: 5000 });
    if (result.status === 0) { ready = true; break; }
    await new Promise(resolveWait => setTimeout(resolveWait, 250));
  }
  if (!ready) throw new Error('Owned PostgreSQL did not become ready');
  const sql = `CREATE SCHEMA IF NOT EXISTS prelaunch_control; CREATE TABLE IF NOT EXISTS prelaunch_control.owner (task_id text NOT NULL, owner_id text NOT NULL, purpose text NOT NULL); INSERT INTO prelaunch_control.owner SELECT '${TASK_ID}', '${runtime.owner_id}', '${purpose}' WHERE NOT EXISTS (SELECT 1 FROM prelaunch_control.owner);`;
  docker(['exec', '-i', runtime.container, 'psql', '-v', 'ON_ERROR_STOP=1', '-U', runtime.user, '-d', runtime.database], sql);
  if (!runtime.database_key) {
    runtime.owner_marker_initialized = true;
    writeFileSync(resolve(runtime.scratch, runtimeName), JSON.stringify(runtime, null, 2) + '\n', { mode: 0o600 });
  }
}

// Registration is a trusted parent operation, never exposed as an HTTP route.
// The runner accepts READY only over the IPC channel of its own spawned process.
export function registerOwnedApi(scratch, child, message) {
  const runtime = loadRuntime(scratch);
  if (!child?.connected || !Number.isInteger(child.pid) || message?.pid !== child.pid
      || message?.type !== 'PRELAUNCH_READY' || message?.task_id !== TASK_ID
      || message?.owner_id !== runtime.owner_id || !Number.isInteger(message.port)
      || message.port < 1024 || message.port > 65535 || message.port === 5432
      || message.port === runtime.host_port) throw new Error('Owned API IPC identity mismatch');
  process.kill(child.pid, 0);
  const path = resolve(runtime.scratch, runtimeName);
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.owned_endpoints = [...(stored.owned_endpoints ?? []).filter(e => e.pid !== child.pid), {
    kind: 'task_owned_api', task_id: TASK_ID, owner_id: runtime.owner_id,
    host: '127.0.0.1', port: message.port, pid: child.pid,
    registered_at: new Date().toISOString(),
  }];
  writeFileSync(path, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  return `http://127.0.0.1:${message.port}`;
}
export function unregisterOwnedApi(scratch, childPid) {
  const runtime = loadRuntime(scratch);
  const path = resolve(runtime.scratch, runtimeName);
  const stored = JSON.parse(readFileSync(path, 'utf8'));
  stored.owned_endpoints = (stored.owned_endpoints ?? []).filter(e => e.pid !== childPid);
  writeFileSync(path, JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
}

export async function createOwnedDatabase(scratch, key, { fresh = false } = {}) {
  if (!['main', 'empty', 'channel', 'restore'].includes(key)) throw new Error('Unsupported owned database purpose');
  const { runtime: primary } = await verifyOwnedEnvironment(scratch);
  if (key === 'main' && !fresh) return verifyOwnedEnvironment(scratch);
  if (primary.additional_databases?.[key] && !fresh) return verifyOwnedEnvironment(scratch, key);
  // All generations are verified owned synthetic databases; prior databases are preserved.
  if (fresh && !['main','channel','restore','empty'].includes(key)) throw new Error('Only owned disposable generations may be created fresh');
  const database = fresh ? `fanju_prelaunch_${randomBytes(6).toString('hex')}${key === 'main' ? '' : '_'+key}` : `${primary.database}_${key}`;
  if (!/^fanju_prelaunch_[a-f0-9]{12}(?:_(empty|channel|restore))?$/.test(database)) throw new Error('Invalid owned database name');
  const { Pool } = requireApi('pg');
  const pool = new Pool({ connectionString: primary.database_url, connectionTimeoutMillis: 5000, max: 1 });
  try { await pool.query(`CREATE DATABASE "${database}" OWNER "${primary.user}"`); }
  finally { await pool.end(); }
  const url = new URL(primary.database_url); url.pathname = `/${database}`;
  const extra = { database, database_url: url.href, database_key: key };
  await initializeMarker({ ...primary, ...extra });
  const stored = JSON.parse(readFileSync(resolve(primary.scratch, runtimeName), 'utf8'));
  if (key === 'main') {
    stored.retired_databases = [...(stored.retired_databases ?? []), { database: stored.database, database_url: stored.database_url, database_key: 'main', retired_at: new Date().toISOString(), preserved: true }];
    Object.assign(stored, extra);
  } else {
  if (fresh && stored.additional_databases?.[key]) stored.retired_databases = [...(stored.retired_databases ?? []), { ...stored.additional_databases[key], retired_at: new Date().toISOString(), preserved: true }];
  stored.additional_databases = { ...stored.additional_databases, [key]: extra };
  }
  writeFileSync(resolve(primary.scratch, runtimeName), JSON.stringify(stored, null, 2) + '\n', { mode: 0o600 });
  return verifyOwnedEnvironment(scratch, key);
}

if (process.env.PRELAUNCH_NETWORK_GUARD === '1') installNetworkGuard();

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [action, scratch, key = 'main'] = process.argv.slice(2);
  if (!['create', 'verify', 'create-database'].includes(action) || !scratch) throw new Error('Usage: node scripts/prelaunch-owned-env.mjs create|verify|create-database <owned-scratch> [empty|channel|restore]');
  const result = action === 'create' ? await createOwnedEnvironment(scratch) : action === 'create-database' ? await createOwnedDatabase(scratch, key) : await verifyOwnedEnvironment(scratch, key);
  const directory = resolve(root, 'docs/prelaunch/environment');
  mkdirSync(directory, { recursive: true });
  writeFileSync(resolve(directory, key === 'main' ? 'OWNED_ENVIRONMENT.json' : `OWNED_${key.toUpperCase()}_DATABASE.json`), JSON.stringify(result.evidence, null, 2) + '\n');
  console.log(JSON.stringify(result.evidence, null, 2));
}
