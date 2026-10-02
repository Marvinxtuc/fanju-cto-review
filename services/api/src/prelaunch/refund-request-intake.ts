import { createHash, randomUUID } from 'node:crypto';
import type { PrismaClient } from '../generated/prisma/client.js';
import { reject, requireRole, type LocalPrincipal } from './contracts.js';
import { dbNow, registrationLock, object, type Tx } from './domain.js';

const source='FORMAL_USER_INTAKE';
const kind='FORMAL_REFUND_APPLICATION';
export type FormalRequestCategory='ORDINARY_CANCEL'|'CONSULTATION'|'EVIDENCE'|'DISPUTE'|'APPEAL'|'SPECIAL_REFUND';
const projection=(row:{id:string;registrationId:string|null;acceptedAt:Date;state:string;payload?:unknown})=>{
 const p=object(row.payload);
 return {requestId:row.id,registrationId:row.registrationId,acceptedAt:row.acceptedAt,state:row.state,
  scope:'REQUEST_INTAKE_ONLY',refundApproved:false,policyActivation:'NOT_ASSESSED',
  parentRequestId:typeof p.parentRequestId==='string'?p.parentRequestId:null,originalRequestId:typeof p.originalRequestId==='string'?p.originalRequestId:null,
  originalAcceptedAt:typeof p.originalAcceptedAt==='string'?p.originalAcceptedAt:null,linkageState:typeof p.linkageState==='string'?p.linkageState:'UNLINKED'};
};
// Intake never approves funds; the formal ordinary-cancellation callback owns exit.
export async function acceptOwnRefundRequest(db:PrismaClient,actor:LocalPrincipal,registrationId:string,key:string,formalProcessing=false,onAccepted?:(tx:Tx,request:{id:string;registrationId:string|null;acceptedAt:Date})=>Promise<void>,requestCategory:FormalRequestCategory='ORDINARY_CANCEL',onReview?:(tx:Tx,request:{id:string;registrationId:string|null;acceptedAt:Date})=>Promise<void>,parentRequestId?:string){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 const requestKind=requestCategory==='ORDINARY_CANCEL'?kind:'FORMAL_REFUND_INQUIRY';
 const businessKey='formal-refund:'+createHash('sha256').update(JSON.stringify([actor.userId,registrationId,key])).digest('hex');
 return db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM "V11Actor" WHERE id=${actor.id} FOR SHARE`;
  const current=await tx.v11Actor.findUnique({where:{id:actor.id}});
  if(!current||!current.enabled||current.version!==actor.version||current.role!=='USER'||current.userId!==actor.userId||current.personId!==actor.personId)reject(401,'SESSION_EXPIRED');
  const reg=await tx.v11Registration.findFirst({where:{id:registrationId,userId:actor.userId!},select:{id:true,policy:{select:{status:true}}}});
  if(!reg)reject(404,'RESOURCE_NOT_FOUND');
  if(formalProcessing&&reg.policy.status!=='FORMAL_RUNTIME')reject(409,'FORMAL_RUNTIME_POLICY_REQUIRED');
  if(formalProcessing)await registrationLock(tx,registrationId);
  else await tx.$queryRaw`SELECT id FROM "V11Registration" WHERE id=${registrationId} FOR UPDATE`;
  if(requestCategory==='ORDINARY_CANCEL'&&parentRequestId)reject(400,'ORDINARY_CANCELLATION_PARENT_NOT_ALLOWED');
  let root:{id:string;acceptedAt:Date;kind:string;source:string}|null=null;
  if(parentRequestId){
   const parent=await tx.v11Request.findFirst({where:{id:parentRequestId,registrationId,userId:actor.userId,source:{in:['FORMAL_USER_INTAKE','FORMAL_BUSINESS_ROUTE']},kind:{in:[kind,'FORMAL_REFUND_INQUIRY','FORMAL_MANDATORY_REFUND',...(formalProcessing?['CORE_CHANGE_REJECTION_REVIEW']:[])]}}});
   if(!parent||parent.kind==='CORE_CHANGE_REJECTION_REVIEW'&&parent.source!=='FORMAL_USER_INTAKE')reject(404,'PARENT_REQUEST_NOT_FOUND');
   if(['EVIDENCE','APPEAL'].includes(String(object(parent.payload).requestCategory))&&typeof object(parent.payload).originalRequestId!=='string')reject(409,'PARENT_REQUEST_UNLINKED');
   const original=object(parent.payload).originalRequestId;
   root=typeof original==='string'?await tx.v11Request.findFirst({where:{id:original,registrationId,userId:actor.userId,source:{in:['FORMAL_USER_INTAKE','FORMAL_BUSINESS_ROUTE']},kind:{in:[kind,'FORMAL_REFUND_INQUIRY','FORMAL_MANDATORY_REFUND',...(formalProcessing?['CORE_CHANGE_REJECTION_REVIEW']:[])]}}}):parent;
   if(!root||root.kind==='CORE_CHANGE_REJECTION_REVIEW'&&root.source!=='FORMAL_USER_INTAKE'||typeof object(parent.payload).originalAcceptedAt==='string'&&object(parent.payload).originalAcceptedAt!==root.acceptedAt.toISOString())reject(409,'PARENT_REQUEST_HISTORY_INVALID');
  }
  const prior=await tx.v11Request.findUnique({where:{businessKey}});
  async function replay(row:typeof prior & {}){
   if(formalProcessing&&requestCategory==='ORDINARY_CANCEL'&&onAccepted){
    const rights=await tx.auditLog.findFirst({where:{action:'refund.v11-formal-acceptance-rights',targetId:row.id}});
    const exit=await tx.auditLog.findFirst({where:{action:'refund.v11-formal-member-exit-at-intake',targetId:row.id}});
    // Legacy intake without pre-exit rights cannot be retroactively presented as cancelled.
    const snapshot=rights?.metadata as Record<string,unknown>|undefined;
    if(snapshot&&snapshot.registrationId===registrationId&&snapshot.acceptedAt===row.acceptedAt.toISOString()&&typeof snapshot.policyDigest==='string'&&typeof snapshot.startsAt==='string'&&Number.isSafeInteger(snapshot.F)&&Number.isSafeInteger(snapshot.D)&&!exit)await onAccepted(tx,row);
    else if(!exit)await tx.v11Request.update({where:{id:row.id},data:{state:'AWAITING_CANCELLATION_REVIEW',blockerIds:['PRE_EXIT_RIGHTS_UNAVAILABLE'],version:{increment:1}}});
   }
   if(onReview&&!await tx.auditLog.findFirst({where:{action:'refund.v11-formal-member-exit-at-intake',targetId:row.id}}))await onReview(tx,row);
   return projection(await tx.v11Request.findUniqueOrThrow({where:{id:row.id}}));
  }
  if(prior){if(prior.source!==source||prior.kind!==requestKind||prior.userId!==actor.userId||prior.registrationId!==registrationId||(object(prior.payload).parentRequestId??null)!==(parentRequestId??null)||(requestCategory!=='ORDINARY_CANCEL'&&(prior.payload as Record<string,unknown>).requestCategory!==requestCategory))reject(409,'REQUEST_IDEMPOTENCY_CONFLICT');return replay(prior);}
  if(formalProcessing&&requestCategory==='ORDINARY_CANCEL'){
   const first=await tx.v11Request.findFirst({where:{registrationId,userId:actor.userId,source,kind},orderBy:[{acceptedAt:'asc'},{id:'asc'}]});
   if(first)return replay(first);
  }
  const requestId=randomUUID(),acceptedAt=await dbNow(tx),unlinked=!parentRequestId&&['EVIDENCE','APPEAL'].includes(requestCategory);
  const request=await tx.v11Request.create({data:{id:requestId,businessKey,registrationId,userId:actor.userId,kind:requestKind,source,
   acceptedAt,state:unlinked?'UNLINKED_AWAITING_REVIEW':formalProcessing?'ACCEPTED':'BLOCKED_POLICY',blockerIds:formalProcessing?[]:['OP-04','OP-10','OP-11','RV-02'],payload:{scope:'REQUEST_INTAKE_ONLY',refundApproved:false,requestCategory,
    parentRequestId:parentRequestId??null,originalRequestId:unlinked?null:root?.id??requestId,originalAcceptedAt:unlinked?null:(root?.acceptedAt??acceptedAt).toISOString(),linkageState:unlinked?'UNLINKED':parentRequestId?'LINKED':'ROOT'}}});
  await tx.auditLog.create({data:{action:'v11.formal_refund_request_accepted',targetType:'V11Request',targetId:request.id,
   metadata:{scope:'REQUEST_INTAKE_ONLY',actorId:actor.id,personId:actor.personId}}});
  if(onAccepted&&requestCategory==='ORDINARY_CANCEL')await onAccepted(tx,request);
  if(onReview&&!await tx.auditLog.findFirst({where:{action:'refund.v11-formal-member-exit-at-intake',targetId:request.id}}))await onReview(tx,request);
  return projection(await tx.v11Request.findUniqueOrThrow({where:{id:request.id}}));
 });
}
export async function ownRefundRequest(db:PrismaClient,actor:LocalPrincipal,id:string){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 const row=await db.v11Request.findFirst({where:{id,userId:actor.userId,source,kind:{in:[kind,'FORMAL_REFUND_INQUIRY']}}});
 if(!row)reject(404,'RESOURCE_NOT_FOUND');return projection(row);
}

export async function ownMoneyRegistrations(db:PrismaClient,actor:LocalPrincipal,cursor?:string){
 requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
 return db.$transaction(async tx=>{
  const rows=await tx.v11Registration.findMany({where:{userId:actor.userId!,...(cursor?{id:{gt:cursor}}:{})},select:{id:true,activity:{select:{title:true,startsAt:true}}},orderBy:{id:'asc'},take:21});
  const page=rows.slice(0,20);
  const registrations=[];
  for(const row of page){
   const latest=await tx.v11Request.findFirst({where:{userId:actor.userId,source,kind:{in:[kind,'FORMAL_REFUND_INQUIRY']},registrationId:row.id},orderBy:[{acceptedAt:'desc'},{id:'desc'}]});
   registrations.push({registrationId:row.id,activityTitle:row.activity.title,startsAt:row.activity.startsAt,refundRequests:latest?[projection(latest)]:[]});
  }
  return {registrations,nextCursor:rows.length>20?page.at(-1)!.id:null};
 },{isolationLevel:'RepeatableRead'});
}
