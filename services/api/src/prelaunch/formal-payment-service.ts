import {canStartRealPayment} from '../config.js';
import {hasFormalReconciliationCoverage} from './formal-reconciliation-coverage.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {createWechatChannel} from './wechat-channel.js';
import {registrationLock,dbNow} from './domain.js';
import {authorizeRuntimePolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {verifyFormalActor} from './formal-supply.js';
import {requireOwner,reject,type LocalPrincipal} from './contracts.js';
import {createPaymentPreparationStore} from './payment-preparation.js';
import {createPaymentPreparationRunner} from './payment-preparation-runner.js';
import {createPaymentPreparationResumer} from './payment-preparation-resume.js';
import {createPaymentQueryIntake} from './payment-query-intake.js';
import {createPaymentReceiptLedger} from './payment-receipt-ledger.js';
import {createReceiptAllocator} from './receipt-allocation.js';
import {createLatePaymentRefundObligation} from './late-payment-refund-obligation.js';
import {formalQualifier} from './formal-qualification.js';
type Channel=ReturnType<typeof createWechatChannel>;
export function formalPaymentService(db:PrismaClient,source:RuntimeAuthoritySource,channel:Channel,caseOwner:string,env:Record<string,string|undefined>={}){
 if(!caseOwner.trim())throw Error('Formal payment case owner required');
 const intake=createPaymentQueryIntake(db,channel),ledger=createPaymentReceiptLedger(db,channel),allocate=createReceiptAllocator(db,channel);
 const late=createLatePaymentRefundObligation(db,channel,caseOwner);
 const qualify=formalQualifier(db,source,channel);
 async function own(actor:LocalPrincipal,registrationId:string){
  return db.$transaction(async tx=>{const reg=await registrationLock(tx,registrationId);await verifyFormalActor(tx,actor);requireOwner(actor,reg.userId);
   const intent=await tx.v11PaymentIntent.findFirst({where:{registrationId,channel:'wechat'},orderBy:{createdAt:'asc'}});
   if(!intent)reject(409,'FORMAL_PAYMENT_INTENT_REQUIRED');channel.assertBinding(intent);return {reg,intent};});
 }
 return {
  async prepare(actor:LocalPrincipal,registrationId:string){
   const {intent}=await own(actor,registrationId);
   const store=createPaymentPreparationStore(db,async(tx,id)=>{
    const reg=await registrationLock(tx,id);await verifyFormalActor(tx,actor);requireOwner(actor,reg.userId);
    const runtime=await authorizeRuntimePolicy(tx,reg.policyId,'PREPARE_PAYMENT',source);channel.assertBinding(runtime.binding);
    if(runtime.binding.environment==='PRODUCTION'){
     if(!canStartRealPayment(env,reg.userId,reg.serviceFeeCents+reg.depositCents)||env.REQUIRED_BILL_SCOPE!==runtime.binding.merchantScope)reject(403,'FORMAL_NEW_MONEY_SCOPE_UNAUTHORIZED');
     if(!await hasFormalReconciliationCoverage(tx,runtime,env.REQUIRED_BILL_PERIOD))reject(503,'FORMAL_REQUIRED_BILL_COVERAGE_INCOMPLETE');
    }
    if(reg.supply.status!=='FORMAL_APPROVED'||reg.cancelAcceptedAt||!['PUBLISHED','REGISTRATION_OPEN'].includes(reg.activity.status)
     ||reg.activity.registrationEndsAt<=await dbNow(tx))reject(409,'FORMAL_PAYMENT_REGISTRATION_CLOSED');
   });
   const user=await db.user.findUniqueOrThrow({where:{id:actor.userId!}});
   let result;
   if(intent.preparationState==='PREPARED')result=await createPaymentPreparationResumer(store,channel)(intent);
   else if(intent.preparationState==='NOT_STARTED')result=await createPaymentPreparationRunner(store,channel)(intent,user.wechatOpenid);
   else return {intentId:intent.id,state:'QUERY_REQUIRED',paymentParams:null};
   // Channel preparation acknowledgement never grants qualification.
   if(result.kind==='PREPARED'){
    const current=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:intent.id}});await store.readPrepared(current);
    return {intentId:intent.id,state:'PREPARED',paymentParams:result.paymentParams};
   }
   return {intentId:intent.id,state:'QUERY_REQUIRED',paymentParams:null};
  },
  async query(actor:LocalPrincipal,registrationId:string){
   const {intent}=await own(actor,registrationId);
   const fact=await intake(intent.id);
   if(fact.kind!=='RECEIVED')return {intentId:intent.id,state:fact.kind,receiptRecorded:false};
   // Preserve trusted money before any policy action; revocation cannot erase it.
   const receipt=await ledger(fact.eventId);await allocate(receipt.receiptId,intent.id);
   const obligation=await late(receipt.receiptId,intent.id);
   const qualification=await qualify(receipt.receiptId);
   return {intentId:intent.id,state:'RECEIPT_RECORDED',receiptRecorded:true,receiptId:receipt.receiptId,obligation:obligation.kind,
    qualification};
  },
 };
}
