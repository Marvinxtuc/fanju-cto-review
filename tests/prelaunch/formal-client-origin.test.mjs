import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');
const {validateFormalClientOrigin}=await import(pathToFileURL(`${repo}/scripts/formal-client-artifacts.mjs`));
test('formal client origin requires canonical HTTPS without credentials, path or local endpoints',()=>{
 assert.equal(validateFormalClientOrigin('https://api.synthetic-fanju.cn'),'https://api.synthetic-fanju.cn');
 for(const raw of ['http://api.synthetic-fanju.cn','https://127.0.0.1','https://192.168.1.1','https://[::1]','https://localhost','https://api.localhost','https://api.local','https://api.invalid','https://api.test','https://api.synthetic-fanju.cn/path','https://api.synthetic-fanju.cn/','https://api.synthetic-fanju.cn:8443','https://api.synthetic-fanju.cn?secret=synthetic','https://api.synthetic-fanju.cn#fragment','https://synthetic-user:synthetic-password@api.synthetic-fanju.cn'])assert.throws(()=>validateFormalClientOrigin(raw));
});
