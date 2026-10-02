import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { sha256TokenRanges, phoneMatchInsideSha256 } from '../../scripts/secret-scan-digest.mjs';
import { root, verifyOwnedEnvironment, childEnvironment } from '../../scripts/prelaunch-owned-env.mjs';
const phone = '139' + '999' + '99999'; // Invented synthetic scanner input, not user data.
const phonePattern=/(?<!\d)(1[3-9]\d{9})(?!\d)/g;
const retained=text=>[...text.matchAll(phonePattern)].filter(m=>!phoneMatchInsideSha256(m,sha256TokenRanges(text))).length;
const digest='a'.repeat(20)+phone+'b'.repeat(33);
test('scanner exempts only a complete 64-hex token and retains adjacent/punctuated phone matches',()=>{
 assert.equal(digest.length,64);assert.equal(retained('sha256: '+digest),0);
 assert.equal(retained('sha256: '+digest.toUpperCase()),0);
 assert.equal(retained(`"${phone}"`),1);assert.equal(retained(`phone=${phone};`),1);
 assert.equal(retained(`abc${phone}xyz`),1,'Ordinary alphanumeric adjacency is not a digest exemption');
 assert.equal(retained(`(${digest}),${phone}.`),1,'An adjacent phone outside the exact digest remains visible');
 assert.equal(retained(digest.slice(0,-1)),1,'63-hex partial token remains detectable');
 assert.equal(retained('f'+digest),1,'65-hex token must not supply a 64-hex substring exemption');
 assert.equal(retained('g'+digest),1,'Adjacent nonhex alphanumeric invalidates token');
 assert.equal(retained(digest+'_'),1,'Underscore-adjacent token is not independently delimited');
 assert.equal(retained('a'.repeat(20)+phone+'z'.repeat(33)),1,'64 characters with nonhex letters is not SHA-256');
});
test('actual scanner CLI accepts embedded numeric hash but rejects a standalone synthetic phone',async()=>{
 const {runtime}=await verifyOwnedEnvironment(dirname(process.env.PRELAUNCH_ENV_FILE??''));
 const dir=mkdtempSync(resolve(runtime.scratch,'scanner-fixture-'));
 const args=['--import',resolve(root,'node_modules/tsx/dist/loader.mjs'),resolve(root,'scripts/check-secrets.ts')];
 writeFileSync(resolve(dir,'fixture.txt'),'sha256: '+digest+'\n');
 const good=spawnSync(process.execPath,args,{cwd:dir,env:childEnvironment(runtime),encoding:'utf8'});assert.equal(good.status,0,good.stderr);
 writeFileSync(resolve(dir,'fixture.txt'),'sha256: '+digest+'\nphone: '+phone+'\n');
 const bad=spawnSync(process.execPath,args,{cwd:dir,env:childEnvironment(runtime),encoding:'utf8'});assert.equal(bad.status,1);assert.match(bad.stderr,/fixture.txt matched phone/);assert.ok(!bad.stderr.includes(phone),'Scanner must not echo the complete sensitive match');
});
