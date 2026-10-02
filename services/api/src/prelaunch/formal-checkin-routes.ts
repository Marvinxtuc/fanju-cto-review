import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PrismaClient} from '../generated/prisma/client.js';
import {z} from 'zod';
import type {LocalPrincipal} from './contracts.js';
import type {RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {formalCheckinService,formalCheckinDetail} from './formal-checkin-service.js';
import {loadCheckinProfessionalApproval} from './formal-checkin-professional.js';
import {loadFormalCheckinSigning} from './formal-checkin-signing.js';
import {fileURLToPath} from 'node:url';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
export async function registerFormalCheckinRoutes(app:FastifyInstance,db:PrismaClient,source:RuntimeAuthoritySource,
 controlled:{authenticate:(req:FastifyRequest)=>Promise<LocalPrincipal>},user:(req:FastifyRequest)=>Promise<LocalPrincipal>,env:Record<string,string|undefined>){
 const flag=env.FEATURE_V11_FORMAL_CHECKIN;if(flag!==undefined&&!['true','false'].includes(flag))throw Error('Invalid formal checkin flag');
 app.get('/api/v11/formal/registrations/:id/checkin',async req=>{
  const actor=await user(req),params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  return {...await formalCheckinDetail(db,actor,params.id),enabled:flag==='true'};
 });
 if(flag!=='true')return;
 const signing=loadFormalCheckinSigning(env,fileURLToPath(new URL('../../../../',import.meta.url))),service=formalCheckinService(db,source,signing,loadCheckinProfessionalApproval(env,fileURLToPath(new URL('../../../../',import.meta.url))));
 app.post('/api/v11/restaurant/formal/activities/:id/checkin-token',async req=>{
  const actor=await controlled.authenticate(req),params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({supplyId:id}).strict().parse(req.body);return service.issue(actor,params.id,body.supplyId);
 });
 app.post('/api/v11/formal/registrations/:id/checkin',async req=>{
  const actor=await user(req),params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({token:z.string().min(1).max(5000)}).strict().parse(req.body);return service.record(actor,params.id,body.token);
 });
}
