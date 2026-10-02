import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,verifyOwnedEnvironment} from '../../scripts/prelaunch-owned-env.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT??root;
const require=createRequire(resolve(repo,'services/api/package.json'));
const {PrismaPg}=require('@prisma/adapter-pg');const Fastify=require('fastify');
const {PrismaClient}=await import(pathToFileURL(resolve(repo,'services/api/dist/generated/prisma/client.js')));
const {registerAuth,signSession}=await import(pathToFileURL(resolve(repo,'services/api/dist/auth.js')));
const {createProductionUserProvisioner}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/user-identity-provisioning.js')));
const {createProductionUserPrincipal}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/production-identity.js')));
const {errorResponse}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/contracts.js')));
test('formal identity onboarding uses verified sessions and serializes real PostgreSQL bindings',async t=>{
 const {runtime}=await verifyOwnedEnvironment('/tmp/fanju-prelaunch-20261001-b48140fda0c1');const db=new PrismaClient({adapter:new PrismaPg({connectionString:runtime.database_url})});
 const prefix='identity_native_'+randomUUID().replaceAll('-','');const user=await db.user.create({data:{id:prefix+'_user',wechatOpenid:'mock_'+prefix,status:'BLACKLISTED'}});
 const app=Fastify();await registerAuth(app,db,{APP_ENV:'test',SESSION_SECRET:'synthetic-owned-native-session-secret-32-characters'});
 app.setErrorHandler((e,_q,r)=>{const x=errorResponse(e);r.code(x.statusCode).send(x.body);});app.post('/provision',createProductionUserProvisioner(db));app.get('/identity',createProductionUserPrincipal(db));const headers={authorization:'Bearer '+signSession(app,{sub:user.id,role:'USER'})};let actor;
 try{
 await t.test('unauthenticated onboarding creates no binding',async()=>{assert.equal((await app.inject({method:'POST',url:'/provision'})).statusCode,401);assert.equal(await db.v11Actor.count({where:{userId:user.id}}),0);});
 await t.test('20 authenticated attempts produce one actor and one audit without privileged request hints',async()=>{const responses=await Promise.all(Array.from({length:20},()=>app.inject({method:'POST',url:'/provision',headers,payload:{role:'OPS',actorId:'other',personId:'forged'}})));assert.ok(responses.every(r=>r.statusCode===200));const actors=await db.v11Actor.findMany({where:{userId:user.id}});assert.equal(actors.length,1);actor=actors[0];assert.equal(actor.role,'USER');assert.equal(actor.personId,'user:'+user.id);assert.equal(actor.passwordHash,'EXTERNAL_SESSION_ONLY');assert.equal(await db.auditLog.count({where:{action:'identity.v11-user-provisioned',targetId:actor.id}}),1);for(const response of responses){assert.equal(response.json().id,actor.id);assert.equal('passwordHash'in response.json(),false);}assert.equal(await db.adminUser.count({where:{id:actor.id}}),0);});
 await t.test('blacklisted user retains authenticated identity access',async()=>{const response=await app.inject({url:'/identity',headers});assert.equal(response.statusCode,200);assert.equal(response.json().userId,user.id);});
 await t.test('disabled actor is not re-enabled by onboarding and does not receive a new binding',async()=>{await db.v11Actor.update({where:{id:actor.id},data:{enabled:false}});assert.equal((await app.inject({method:'POST',url:'/provision',headers})).statusCode,401);assert.equal(await db.v11Actor.count({where:{userId:user.id}}),1);assert.equal((await db.v11Actor.findUnique({where:{id:actor.id}})).enabled,false);});
 await t.test('ambiguous historical mappings reject rather than merge or choose an arbitrary actor',async()=>{await db.v11Actor.create({data:{userId:user.id,role:'USER',personId:'other-person',passwordHash:'EXTERNAL_SESSION_ONLY'}});assert.equal((await app.inject({method:'POST',url:'/provision',headers})).statusCode,409);assert.equal((await app.inject({url:'/identity',headers})).statusCode,403);assert.equal(await db.v11Actor.count({where:{userId:user.id}}),2);});
 }finally{await app.close();await db.$disconnect();}
});
