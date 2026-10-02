import type {FastifyInstance,FastifyRequest} from 'fastify';
import type {PrismaClient} from '../generated/prisma/client.js';
import {z} from 'zod';
import {createProductionUserPrincipal} from './production-identity.js';
import {verifyFormalActor} from './formal-supply.js';
import {dbNow,json,object,sha256} from './domain.js';
import {requireRole,reject,type LocalPrincipal} from './contracts.js';
import {openCase} from '../jobs/queue.js';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/),kind=z.enum(['ACCESS','EXPORT','CORRECTION','CLOSURE','WITHDRAWAL']);
const source='FORMAL_USER_RIGHTS';
const projection=(row:{id:string;kind:string;acceptedAt:Date;state:string;payload:unknown})=>({id:row.id,kind:row.kind.replace('FORMAL_RIGHT_',''),acceptedAt:row.acceptedAt,state:row.state,referenceRequestId:object(row.payload).referenceRequestId??null,scope:'REQUEST_INTAKE_ONLY',actionsApplied:false});
export async function registerFormalRightsRoutes(app:FastifyInstance,db:PrismaClient,controlled:{authenticate:(request:FastifyRequest)=>Promise<LocalPrincipal>},owner:string){
 if(!owner.trim())throw Error('Formal rights case owner required');const user=createProductionUserPrincipal(db);
 app.post('/api/v11/formal/rights',async req=>{
  const actor=await user(req);z.object({}).strict().parse(req.query);const body=z.object({kind,businessKey:id,referenceRequestId:id.optional()}).strict().parse(req.body);
  return db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId!} FOR UPDATE`;await verifyFormalActor(tx,actor);
   if(body.referenceRequestId&&!await tx.v11Request.findFirst({where:{id:body.referenceRequestId,userId:actor.userId!}}))reject(404,'RESOURCE_NOT_FOUND');
   const businessKey='formal-right:'+sha256(JSON.stringify([actor.userId,body.businessKey])),payload={scope:'FORMAL_USER_RIGHTS_INTAKE',kind:body.kind,referenceRequestId:body.referenceRequestId??null,actionsApplied:false};
   let row=await tx.v11Request.findUnique({where:{businessKey}});
   if(row&&(row.userId!==actor.userId||row.source!==source||row.kind!=='FORMAL_RIGHT_'+body.kind||object(row.payload).referenceRequestId!==payload.referenceRequestId))reject(409,'REQUEST_IDEMPOTENCY_CONFLICT');
   if(!row)row=await tx.v11Request.create({data:{businessKey,userId:actor.userId!,kind:'FORMAL_RIGHT_'+body.kind,source,acceptedAt:await dbNow(tx),state:'AWAITING_MANUAL_PROCESSING',blockerIds:['OP-15','RV-05'],payload:json(payload)}});
   const review=await openCase(tx,'V11_FORMAL_RIGHTS_REVIEW',row.id,owner);
   await tx.auditLog.upsert({where:{id:'v11_right_'+sha256(row.id).slice(0,40)},update:{},create:{id:'v11_right_'+sha256(row.id).slice(0,40),action:'rights.v11-formal-intake',targetType:'V11Request',targetId:row.id,metadata:{userId:actor.userId,actorId:actor.id,actorVersion:actor.version,kind:body.kind,referenceRequestId:payload.referenceRequestId,caseId:review.id,owner,actionsApplied:false,deadlineScope:'INTERNAL_REVIEW_QUEUE_DEFAULT',contractualSlaConfirmed:false}}});
   return {request:projection(row)};
  });
 });
 app.get('/api/v11/formal/rights',async req=>{
  const actor=await user(req),q=z.object({cursor:id.optional()}).strict().parse(req.query);const rows=await db.v11Request.findMany({where:{source,userId:actor.userId!,kind:{startsWith:'FORMAL_RIGHT_'},...(q.cursor?{id:{gt:q.cursor}}:{})},orderBy:{id:'asc'},take:21});
  return {requests:rows.slice(0,20).map(projection),nextCursor:rows.length>20?rows[19]!.id:null};
 });
 app.get('/api/v11/formal/rights/:id',async req=>{
  const actor=await user(req),params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);const row=await db.v11Request.findFirst({where:{id:params.id,source,userId:actor.userId!}});if(!row)reject(404,'RESOURCE_NOT_FOUND');return{request:projection(row)};
 });
 app.get('/api/v11/ops/formal/rights',async req=>{
  const actor=await controlled.authenticate(req);requireRole(actor,'OPS','REVIEWER');const q=z.object({cursor:id.optional()}).strict().parse(req.query);const rows=await db.v11Request.findMany({where:{source,kind:{startsWith:'FORMAL_RIGHT_'},...(q.cursor?{id:{gt:q.cursor}}:{})},orderBy:{id:'asc'},take:21});const cases=await db.financialCase.findMany({where:{category:'V11_FORMAL_RIGHTS_REVIEW',sourceRef:{in:rows.slice(0,20).map(r=>r.id)}}});return{requests:rows.slice(0,20).map(r=>({...projection(r),caseOwner:cases.find(c=>c.sourceRef===r.id)?.owner??null})),nextCursor:rows.length>20?rows[19]!.id:null};
 });
}
