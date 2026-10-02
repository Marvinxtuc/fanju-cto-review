// Run locally in a terminal. Only the salted hash is printed; never pass passwords as CLI arguments.
import { scrypt, randomBytes } from 'node:crypto';
import { promisify } from 'node:util';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';
if (!process.stdin.isTTY) throw new Error('Use an interactive terminal; password arguments/stdin pipes are not accepted');
const muted = new Writable({ write(_chunk, _encoding, done) { done(); } });
const input = createInterface({ input: process.stdin, output: muted, terminal: true });
try {
  process.stderr.write('Admin password (minimum 12 characters, hidden): ');
  const password = await input.question('');
  process.stderr.write('\nConfirm password (hidden): ');
  const confirmation = await input.question('');
  process.stderr.write('\n');
  if (password.length < 12 || password.length > 256 || password !== confirmation) throw new Error('Password length or confirmation invalid');
  const salt = randomBytes(16).toString('hex');
  const hash = await promisify(scrypt)(password, salt, 64);
  process.stdout.write(`scrypt:${salt}:${hash.toString('hex')}\n`);
} finally { input.close(); }
