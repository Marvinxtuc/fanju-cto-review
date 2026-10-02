import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { PrismaClient } from '../generated/prisma/client.js';
import { z } from 'zod';
import { requireRole, type LocalPrincipal } from './contracts.js';
import type { RuntimeAuthoritySource } from './formal-runtime-policy.js';
import { formalResponsibilityCancellation } from './formal-responsibility-cancellation.js';
import { object } from './domain.js';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
export async function registerFormalResponsibilityCancellationRoutes(app:FastifyInstance,db:PrismaClient,source:RuntimeAuthoritySource,
 controlled:{authenticate:(request:FastifyRequest)=>Promise<LocalPrincipal>},owner:string){
 const service=formalResponsibilityCancellation(db,source,owner);
 app.get('/api/v11/formal/responsibility-cancellations',async req=>{
  const actor=await controlled.authenticate(req);requireRole(actor,'OPS','RESTAURANT','REVIEWER');const query=z.object({cursor:id.optional()}).strict().parse(req.query);
  const rows=await db.v11Request.findMany({where:{kind:{in:['FORMAL_RESPONSIBILITY_CANCELLATION_PROPOSAL','FORMAL_RESPONSIBILITY_CANCELLATION']},
   ...(actor.role==='RESTAURANT'?{payload:{path:['restaurantId'],equals:actor.restaurantId!}}:{}),...(query.cursor?{id:{gt:query.cursor}}:{})},orderBy:{id:'asc'},take:101});
  return {requests:rows.slice(0,100).map(row=>({id:row.id,kind:row.kind,state:row.state,acceptedAt:row.acceptedAt,activityId:object(row.payload).activityId,
   reason:object(row.payload).reason??'RESTAURANT_CANCEL',reviewRequired:object(row.payload).reviewRequired===true,reviewOwner:object(row.payload).reviewOwner??null,originalRequestAcceptedAt:object(row.payload).originalRequestAcceptedAt??row.acceptedAt.toISOString(),cancellationAccepted:object(row.payload).cancellationAccepted===true,membershipEnded:object(row.payload).membershipEnded===true,compensationRequired:object(row.payload).compensationRequired??false,compensationAmount:null,newMoneySubmitted:false})),nextCursor:rows.length>100?rows[99]!.id:null};
 });
 app.post('/api/v11/restaurant/formal/activities/:id/responsibility-cancellations',async req=>{
  const actor=await controlled.authenticate(req),params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({businessKey:id}).strict().parse(req.body);return service.propose(actor,params.id,body.businessKey);
 });
 app.post('/api/v11/ops/formal/activities/:id/responsibility-cancellations',async req=>{
  const actor=await controlled.authenticate(req),params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({businessKey:id,reason:z.enum(['PLATFORM_CANCEL','RESTAURANT_CANCEL']),proposalId:id.optional()}).strict().parse(req.body);
  return service.accept(actor,params.id,body);
 });
}
