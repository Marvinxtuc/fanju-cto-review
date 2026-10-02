import Fastify from 'fastify';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '../generated/prisma/client.js';
import { registerAuth, signSession } from '../auth.js';
import { createProductionUserPrincipal } from './production-identity.js';
import { errorResponse } from './contracts.js';
async function fixture() {
  const actor={id:'actor',personId:'person',role:'USER',userId:'user',restaurantId:null,version:1,enabled:true,passwordHash:'synthetic-unused'};
  const db={user:{findUnique:vi.fn().mockResolvedValue({id:'user',status:'NORMAL'})},v11Actor:{findMany:vi.fn().mockResolvedValue([actor]),findUnique:vi.fn().mockResolvedValue(actor)}};
  const app=Fastify();await registerAuth(app,db as unknown as PrismaClient,{APP_ENV:'test',SESSION_SECRET:'synthetic-only-session-secret-32-characters',SESSION_REVOKED_SUBJECTS:'revoked'});
  const principal=createProductionUserPrincipal(db as unknown as PrismaClient);
  app.setErrorHandler((e,_q,r)=>{if('code'in e&&String(e.code).startsWith('FST_JWT'))return r.code(401).send({error:'UNAUTHORIZED'});if('statusCode'in e&&e.statusCode===401)return r.code(401).send({error:'UNAUTHORIZED'});const out=errorResponse(e);r.code(out.statusCode).send(out.body);});
  app.get('/identity',async req=>principal(req));return{app,db,actor,token:()=>signSession(app,{sub:'user',role:'USER'})};
}
describe('formal JWT to V1.1 user identity adapter',()=>{
 it('uses verified session subject and ignores client actor and role hints',async()=>{const f=await fixture();try{const r=await f.app.inject({url:'/identity?actorId=other&role=OPS',headers:{authorization:'Bearer '+f.token()}});expect(r.statusCode).toBe(200);expect(r.json()).toMatchObject({id:'actor',userId:'user',role:'USER'});expect(r.json()).not.toHaveProperty('passwordHash');expect(f.db.v11Actor.findMany).toHaveBeenCalledWith({where:{userId:'user',role:'USER'},take:2});}finally{await f.app.close();}});
 it('rejects missing, forged and revoked JWT before actor lookup',async()=>{const f=await fixture();try{for(const t of ['', 'forged',signSession(f.app,{sub:'revoked',role:'USER'})])expect((await f.app.inject({url:'/identity',headers:t?{authorization:'Bearer '+t}:{}})).statusCode).toBe(401);expect(f.db.v11Actor.findMany).not.toHaveBeenCalled();}finally{await f.app.close();}});
 it('rejects an OPS session at the user boundary',async()=>{const f=await fixture();try{const r=await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+signSession(f.app,{sub:'admin',role:'OPS'})}});expect(r.statusCode).toBe(403);expect(f.db.v11Actor.findMany).not.toHaveBeenCalled();}finally{await f.app.close();}});
 it.each([[[]], [[{id:'one'},{id:'two'}]]])('refuses missing or ambiguous bindings without provisioning',async actors=>{const f=await fixture();try{f.db.v11Actor.findMany.mockResolvedValue(actors as never);expect((await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+f.token()}})).statusCode).toBe(403);expect(f.db.v11Actor.findUnique).not.toHaveBeenCalled();}finally{await f.app.close();}});
 it.each(['disabled','changed-owner','restaurant-bound','changed-role'])('rechecks DB actor: %s',async kind=>{const f=await fixture();try{const current={...f.actor,...(kind==='disabled'?{enabled:false}:kind==='changed-owner'?{userId:'another'}:kind==='restaurant-bound'?{restaurantId:'restaurant'}:{role:'OPS'})};f.db.v11Actor.findUnique.mockResolvedValue(current);const r=await f.app.inject({url:'/identity',headers:{authorization:'Bearer '+f.token()}});expect([401,403]).toContain(r.statusCode);}finally{await f.app.close();}});
});
