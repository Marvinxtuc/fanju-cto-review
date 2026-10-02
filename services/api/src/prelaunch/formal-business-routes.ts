import type {FastifyInstance} from 'fastify';
import type {PrismaClient} from '../generated/prisma/client.js';
import {z} from 'zod';
import {createProductionUserPrincipal} from './production-identity.js';
import {deliverFormalPolicy,acceptFormalPolicyConsent} from './formal-policy-consent.js';
import type {RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {configuredRuntimeAuthoritySource} from './formal-authority-source.js';
import {createProductionControlledIdentity} from './controlled-identity.js';
import {proposeFormalSupply,approveFormalSupply,publishFormalActivity,formalSupplyProposalSchema} from './formal-supply.js';
import {saveFormalProfile,createFormalRegistration} from './formal-registration.js';
import {registrationDetail,publicRequest,object,sha256} from './domain.js';
import {formalCanonicalJson} from './formal-json.js';
import {authorizeRuntimePolicy} from './formal-runtime-policy.js';
import {reject,requireRole,PrelaunchError} from './contracts.js';
import {createWechatChannel} from './wechat-channel.js';
import {formalPaymentService} from './formal-payment-service.js';
import type {createWechatProviders} from '../providers.js';
import {registerFormalCheckinRoutes} from './formal-checkin-routes.js';
import {registerFormalCoreChangeRoutes} from './formal-core-change-routes.js';
import {registerFormalRightsRoutes} from './formal-rights-routes.js';
import {registerFormalResponsibilityCancellationRoutes} from './formal-responsibility-cancellation-routes.js';
import {formalFulfillmentService} from './formal-fulfillment-service.js';
import {formalRefundService} from './formal-refund-service.js';
import {acceptOwnRefundRequest} from './refund-request-intake.js';
import {assessFormalReconciliation,closeFormalBillDifference} from './formal-reconciliation-coverage.js';
const id=z.string().min(1).max(160).regex(/^[A-Za-z0-9_.:-]+$/);
export async function registerFormalBusinessRoutes(app:FastifyInstance,db:PrismaClient,env:Record<string,string|undefined>,
 modes:ReturnType<typeof createWechatProviders>,demo:boolean,injectedSource?:RuntimeAuthoritySource,injectedChannel?:ReturnType<typeof createWechatChannel>){
 const flag=env.FEATURE_V11_FORMAL_BUSINESS;
 if(flag!==undefined&&!['true','false'].includes(flag))throw Error('Invalid formal business flag');
 if(injectedSource&&(env.APP_ENV!=='ci'||env.NODE_ENV!=='test'))throw Error('Test authority injection forbidden outside isolated CI');
 if(injectedChannel&&(!injectedSource||env.APP_ENV!=='ci'||env.NODE_ENV!=='test'))throw Error('Test channel injection requires isolated authority ownership');
 if(flag!=='true')return;
 if(env.FEATURE_V11_IDENTITY!=='true'||modes.auth.mode!=='wechat'||modes.phone.mode!=='wechat'||demo)throw Error('Formal business requires formal identity');
 if(injectedSource){
  const names=await db.$queryRaw<Array<{name:string}>>`SELECT current_database() AS name`;
  const owners=await db.$queryRaw<Array<{task_id:string;owner_id:string;purpose:string}>>`SELECT task_id,owner_id,purpose FROM prelaunch_control.owner`;
  if(names.length!==1||names[0]?.name!==env.PRELAUNCH_DATABASE_NAME||owners.length!==1||owners[0]?.task_id!=='FJ-PRELAUNCH-MASTER-V1.1-20261001-01'
   ||owners[0]?.owner_id!==env.PRELAUNCH_OWNER_MARKER||owners[0]?.purpose!=='synthetic-local-prelaunch')throw Error('Isolated authority database ownership required');
 }
 const baseSource=injectedSource??configuredRuntimeAuthoritySource(env);
 const source:RuntimeAuthoritySource=async(digest,action)=>{
  const result=await baseSource(digest,action);
  if(result.context.environment!==(injectedSource?'ISOLATED_TEST':'PRODUCTION'))throw Error('Formal authority environment conflict');
  return result;
 };
 const user=createProductionUserPrincipal(db);
 const controlled=createProductionControlledIdentity(db,env.V11_CONTROLLED_ACCOUNTS_JSON);
 await registerFormalCheckinRoutes(app,db,source,controlled,user,env);
 if(env.V11_FORMAL_CASE_OWNER?.trim())await registerFormalResponsibilityCancellationRoutes(app,db,source,controlled,env.V11_FORMAL_CASE_OWNER);
 if(env.V11_FORMAL_CASE_OWNER?.trim())await registerFormalRightsRoutes(app,db,controlled,env.V11_FORMAL_CASE_OWNER);
 if(env.V11_FORMAL_CASE_OWNER?.trim())await registerFormalCoreChangeRoutes(app,db,source,controlled,env.V11_FORMAL_CASE_OWNER);
 const fulfillment=formalFulfillmentService(db,source);
 app.post('/api/v11/restaurant/formal/registrations/:id/fulfillment',async req=>{
  const actor=await controlled.authenticate(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({result:z.enum(['NORMAL','ABNORMAL'])}).strict().parse(req.body);return fulfillment.confirm(actor,params.id,body.result);
 });
 app.get('/api/v11/formal/fulfillment-registrations',async req=>{
  const actor=await controlled.authenticate(req);requireRole(actor,'RESTAURANT','OPS','REVIEWER');const q=z.object({cursor:id.optional()}).strict().parse(req.query);
  const rows=await db.v11Registration.findMany({where:{policy:{status:'FORMAL_RUNTIME'},...(actor.role==='RESTAURANT'?{activity:{restaurantId:actor.restaurantId!}}:{}),...(q.cursor?{id:{gt:q.cursor}}:{})},include:{activity:true,v11Attendance_registrationId:true},orderBy:{id:'asc'},take:21});
  return {registrations:rows.slice(0,20).map(r=>({id:r.id,title:r.activity.title,activityId:r.activityId,state:r.eligibilityState,active:r.active,endsAt:r.activity.endsAt,D:r.depositCents,restaurantResult:r.v11Attendance_registrationId?.restaurantResult??null,confirmedAt:r.v11Attendance_registrationId?.confirmedAt??null})),nextCursor:rows.length>20?rows[19]!.id:null};
 });
 app.post('/api/v11/ops/formal/reconciliation/assess',async req=>{
  const actor=await controlled.authenticate(req);z.object({}).strict().parse(req.query);
  const body=z.object({policyId:id,scopeRaw:z.string().min(1).max(65536),scopeDigest:z.string().regex(/^[a-f0-9]{64}$/),runIds:z.array(z.string().uuid()).min(1).max(366)}).strict().parse(req.body);
  return assessFormalReconciliation(db,actor,body.policyId,body,source);
 });
 app.post('/api/v11/ops/formal/reconciliation/differences/:id/close',async req=>{
  const actor=await controlled.authenticate(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({policyId:id,originalRunId:z.string().uuid(),verifiedRunId:z.string().uuid()}).strict().parse(req.body);
  return closeFormalBillDifference(db,actor,body.policyId,{caseId:params.id,...body},source);
 });
 app.get('/api/v11/ops/formal/refund-requests',async req=>{
  const actor=await controlled.authenticate(req);requireRole(actor,'OPS','REVIEWER');const q=z.object({cursor:id.optional()}).strict().parse(req.query);
  const rows=await db.v11Request.findMany({where:{kind:{in:['FORMAL_REFUND_APPLICATION','FORMAL_MANDATORY_REFUND','FORMAL_REFUND_INQUIRY']},source:{in:['FORMAL_USER_INTAKE','FORMAL_BUSINESS_ROUTE']},registration:{policy:{status:'FORMAL_RUNTIME'}},...(q.cursor?{id:{gt:q.cursor}}:{})},include:{registration:{select:{activity:{select:{title:true}},serviceFeeCents:true,depositCents:true}}},orderBy:{id:'asc'},take:21});
  const cases=await db.financialCase.findMany({where:{sourceRef:{in:rows.slice(0,20).map(r=>r.id)},category:'V11_FORMAL_INQUIRY_REVIEW'}});
  return {requests:rows.slice(0,20).map(r=>({id:r.id,kind:r.kind,...(publicRequest(r).requestCategory?{requestCategory:publicRequest(r).requestCategory}:{}),parentRequestId:publicRequest(r).parentRequestId,originalRequestId:publicRequest(r).originalRequestId,originalAcceptedAt:publicRequest(r).originalAcceptedAt,linkageState:publicRequest(r).linkageState,caseOwner:cases.find(c=>c.sourceRef===r.id)?.owner??null,registrationId:r.registrationId,title:r.registration?.activity.title,F:r.registration?.serviceFeeCents,D:r.registration?.depositCents,
   acceptedAt:r.acceptedAt,state:r.state,blockerIds:r.blockerIds})),nextCursor:rows.length>20?rows[19]!.id:null};
 });
 app.get('/api/v11/formal/supply-proposals',async req=>{
  const actor=await controlled.authenticate(req);requireRole(actor,'OPS','REVIEWER','RESTAURANT');const q=z.object({cursor:id.optional()}).strict().parse(req.query);
  const rows=await db.v11Request.findMany({where:{kind:'FORMAL_SUPPLY_PROPOSAL',source:'FORMAL_RESTAURANT',...(actor.role==='RESTAURANT'?{payload:{path:['body','restaurantId'],equals:actor.restaurantId!}}:{}),...(q.cursor?{id:{gt:q.cursor}}:{})},orderBy:{id:'asc'},take:21});
  return {proposals:rows.slice(0,20).map(r=>({id:r.id,acceptedAt:r.acceptedAt,state:r.state,activityId:object(object(r.payload).body).activityId,proposal:object(object(r.payload).body).proposal,supplyId:object(r.payload).supplyId??null})),nextCursor:rows.length>20?rows[19]!.id:null};
 });
 const offer=async(activityId:string)=>db.$transaction(async tx=>{
  const activity=await tx.activity.findUnique({where:{id:activityId}});
  if(!activity||!['PUBLISHED','REGISTRATION_OPEN'].includes(activity.status))reject(404,'RESOURCE_NOT_FOUND');
  const publication=await tx.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetType:'Activity',targetId:activityId},orderBy:{createdAt:'desc'}});
  const supplyId=object(publication?.metadata).supplyId;if(typeof supplyId!=='string')reject(409,'FORMAL_PUBLICATION_REQUIRED');
  const supply=await tx.v11SupplyRevision.findUniqueOrThrow({where:{id:supplyId}});
  const runtime=await authorizeRuntimePolicy(tx,supply.policyId,'NEW_REGISTRATION',source);
  const snapshot=object(supply.snapshot);
  if(supply.status!=='FORMAL_APPROVED'||supply.activityId!==activityId||supply.digest!==sha256(formalCanonicalJson(supply.snapshot))
   ||snapshot.policyDigest!==runtime.policy.bundleDigest||snapshot.parameterDigest!==runtime.binding.parameterDigest)reject(409,'FORMAL_SUPPLY_EVIDENCE_INVALID');
  return {id:activity.id,title:activity.title,theme:activity.theme,district:activity.district,businessArea:activity.businessArea,
   startsAt:activity.startsAt,status:activity.status,serviceFeeCents:supply.serviceFeeCents,depositCents:supply.depositCents,
   totalCents:supply.serviceFeeCents+supply.depositCents,supplyId:supply.id,policyId:supply.policyId,waitlistMax:supply.waitlistMax,
   mealCollection:'DIRECT_TO_RESTAURANT',registrationEndsAt:activity.registrationEndsAt};
 });
 app.get('/api/v11/formal/activities/:id',async req=>{const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);return {activity:await offer(params.id)};});
 app.get('/api/v11/formal/activities',async req=>{
  const query=z.object({cursor:id.optional()}).strict().parse(req.query);
  const rows=await db.activity.findMany({where:{status:{in:['PUBLISHED','REGISTRATION_OPEN']},...(query.cursor?{id:{gt:query.cursor}}:{})},orderBy:{id:'asc'},take:21});
  let unavailableCount=0;const activities=[];for(const row of rows.slice(0,20)){
   const publication=await db.auditLog.findFirst({where:{action:'activity.v11-formal-published',targetType:'Activity',targetId:row.id}});
   if(publication){try{activities.push(await offer(row.id));}catch(error){if(error instanceof PrelaunchError&&error.code==='FORMAL_ACTION_AUTHORITY_UNAVAILABLE')unavailableCount++;else throw error;}}
  }
  return {activities,unavailableCount,nextCursor:rows.length>20?rows[19]!.id:null};
 });
 const paymentFlag=env.FEATURE_V11_FORMAL_PAYMENT;
 if(paymentFlag!==undefined&&!['true','false'].includes(paymentFlag))throw Error('Invalid formal payment flag');
 if(paymentFlag==='true'){
  const owner=env.V11_FORMAL_CASE_OWNER?.trim();if(!owner)throw Error('Explicit formal payment case owner required');
  const channel=injectedChannel??createWechatChannel(env,modes.payment,modes.refund);
  const payments=formalPaymentService(db,source,channel,owner,env);
  const refunds=formalRefundService(db,source,channel,owner);
  app.post('/api/v11/formal/registrations/:id/refunds/query',async req=>{
   const actor=await user(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);z.object({}).strict().parse(req.body??{});
   return refunds.query(actor,params.id);
  });
  app.post('/api/v11/formal/registrations/:id/refund-requests',async req=>{
   const actor=await user(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
   const body=z.object({businessKey:id,requestCategory:z.enum(['ORDINARY_CANCEL','CONSULTATION','EVIDENCE','DISPUTE','APPEAL','SPECIAL_REFUND']).optional(),parentRequestId:id.optional()}).strict().parse(req.body);
   const result=await refunds.accept(actor,params.id,body.businessKey,body.requestCategory,body.parentRequestId);
   return result;
  });
  app.post('/api/v11/ops/formal/refund-requests/:id/decide',async req=>{
   const actor=await controlled.authenticate(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);z.object({}).strict().parse(req.body??{});
   return refunds.decide(actor,params.id);
  });
  for(const action of ['prepare','query'] as const)app.post('/api/v11/formal/registrations/:id/payment/'+action,async req=>{
   const actor=await user(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);z.object({}).strict().parse(req.body??{});
   return payments[action](actor,params.id);
  });
 }
 app.post('/api/v11/ops/formal/activities/:id/publish',async req=>{
  const actor=await controlled.authenticate(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({supplyId:id}).strict().parse(req.body);
  return publishFormalActivity(db,actor,params.id,body.supplyId,source);
 });
 app.put('/api/v11/formal/profile',async req=>{
  const actor=await user(req);z.object({}).strict().parse(req.query);
  const body=z.object({policyId:id,gender:z.enum(['MALE','FEMALE']),adultDeclaration:z.literal(true),serviceCompatible:z.literal(true)}).strict().parse(req.body);
  return saveFormalProfile(db,actor,body.policyId,body,source);
 });
 app.post('/api/v11/formal/registrations',async(req,reply)=>{
  const actor=await user(req);z.object({}).strict().parse(req.query);
  const body=z.object({activityId:id,supplyId:id,policyId:id,consentId:id,membership:z.enum(['FORMAL','WAITLIST']),businessKey:id}).strict().parse(req.body);
  // No implicit owner: expiry/recovery cases must have an explicitly configured destination.
  const owner=env.V11_FORMAL_CASE_OWNER?.trim();
  if(!owner){reply.code(503);return {error:{code:'FORMAL_CASE_OWNER_UNAVAILABLE'}};}
  const row=await createFormalRegistration(db,actor,body,source,owner);
  if('eligibilityState' in row)return {registration:await registrationDetail(db,actor,row.id)};
  reply.code(202);return {request:publicRequest(row),state:row.state,blockerIds:row.blockerIds};
 });
 app.get('/api/v11/formal/registrations/:id',async req=>{
  const actor=await user(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  return {registration:await registrationDetail(db,actor,params.id)};
 });
 app.get('/api/v11/formal/registrations',async req=>{
  const actor=await user(req);const query=z.object({cursor:id.optional()}).strict().parse(req.query);
  const rows=await db.v11Registration.findMany({where:{userId:actor.userId!,policy:{status:'FORMAL_RUNTIME'},...(query.cursor?{id:{gt:query.cursor}}:{})},orderBy:{id:'asc'},take:21});
  return {registrations:await Promise.all(rows.slice(0,20).map(row=>registrationDetail(db,actor,row.id))),nextCursor:rows.length>20?rows[19]!.id:null};
 });
 app.get('/api/v11/policies/:id/delivery',async req=>{
  const actor=await user(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  return deliverFormalPolicy(db,actor,params.id,source);
 });
 app.post('/api/v11/policies/:id/consents',async req=>{
  const actor=await user(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({deliveryId:id,fullHashes:z.record(id,z.string().regex(/^[a-f0-9]{64}$/)),publicHashes:z.record(id,z.string().regex(/^[a-f0-9]{64}$/))}).strict().parse(req.body);
  return acceptFormalPolicyConsent(db,actor,{policyId:params.id,...body},source);
 });
 app.post('/api/v11/restaurant/activities/:id/supply-proposals',async req=>{
  const actor=await controlled.authenticate(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  return proposeFormalSupply(db,actor,params.id,formalSupplyProposalSchema.parse(req.body),source);
 });
 app.post('/api/v11/ops/supply-proposals/:id/approve',async req=>{
  const actor=await controlled.authenticate(req);const params=z.object({id}).strict().parse(req.params);z.object({}).strict().parse(req.query);
  const body=z.object({activityFeeCents:z.number().int().min(0).max(2_147_483_647).nullable()}).strict().parse(req.body);
  return approveFormalSupply(db,actor,params.id,body.activityFeeCents,source);
 });
}
