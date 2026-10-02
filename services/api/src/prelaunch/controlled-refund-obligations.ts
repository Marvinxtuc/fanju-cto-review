import type {PrismaClient,FinancialCase} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {requireRole,type LocalPrincipal} from './contracts.js';
import {object} from './domain.js';
import {resolveVerifiedIdentity} from './principal.js';
import {recordedRefundObligationView} from './refund-obligation-view.js';
// Controlled observation only; no dispatch approval, budget reservation or writes.
export async function controlledRefundObligations(db:PrismaClient,actor:LocalPrincipal,binding:ChannelBinding,cursor?:string){
 requireRole(actor,'OPS','REVIEWER');
 if(binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(binding.merchantScope)||!binding.providerConfigId.trim())throw Error('Explicit controlled funds scope required');
 return db.$transaction(async tx=>{
  await resolveVerifiedIdentity({actorId:actor.id,personId:actor.personId,role:actor.role,actorVersion:actor.version,userId:actor.userId,restaurantId:actor.restaurantId},id=>tx.v11Actor.findUnique({where:{id}}));
  const cases=await tx.$queryRaw<FinancialCase[]>`SELECT c.* FROM "FinancialCase" c
    JOIN "ReceivedEvent" e ON e.id=c."sourceRef"
    WHERE c.category='V11_LATE_PAYMENT_FULL_REFUND_DUE' AND e."merchantScope"=${binding.merchantScope}
      AND e."verificationMaterialId"=${binding.providerConfigId}
      AND (${cursor??null}::text IS NULL OR c.id>${cursor??null}) ORDER BY c.id LIMIT 50`;

  const items=[];
  for(const row of cases){
   const event=await tx.receivedEvent.findUnique({where:{id:row.sourceRef}});
   // Missing source has no trustworthy merchant attribution. Report separately,
   // never expose an unrelated merchant's case as an attributed obligation.
   if(!event||event.merchantScope!==binding.merchantScope||event.verificationMaterialId!==binding.providerConfigId)continue;
   const payload=object(event.normalizedPayload);
   const receipt=typeof payload.receiptId==='string'?await tx.channelReceipt.findUnique({where:{id:payload.receiptId}}):null;
   const intent=typeof payload.intentId==='string'?await tx.v11PaymentIntent.findUnique({where:{id:payload.intentId}}):null;
   const reg=typeof payload.registrationId==='string'?await tx.v11Registration.findUnique({where:{id:payload.registrationId}}):null;
   const allocation=receipt?await tx.v11ReceiptBinding.findUnique({where:{receiptId:receipt.id}}):null;
   const components=receipt?await tx.v11FundComponent.findMany({where:{receiptId:receipt.id}}):[];
   const refunds=receipt?await tx.v11RefundInstruction.findMany({where:{receiptId:receipt.id}}):[];
   const refundConflict=refunds.some(x=>x.channel!==binding.channel||x.merchantScope!==binding.merchantScope||x.providerConfigId!==binding.providerConfigId||x.originalTradeNo!==receipt?.channelTradeNo||!Number.isSafeInteger(x.totalCents)||x.totalCents<=0||x.serviceFeeCents<0||x.depositCents<0||x.totalCents!==x.serviceFeeCents+x.depositCents||!['NEW','SUBMITTING','UNKNOWN','CONFIRMED'].includes(x.state)||(x.state==='CONFIRMED'&&!x.channelRefundNo));
   const view=reg&&receipt&&intent&&refunds.reduce((sum,x)=>sum+x.totalCents,0)<=receipt.amountCents&&['PRIMARY','EXTRA'].includes(allocation?.classification??'')&&intent.providerConfigId===binding.providerConfigId&&allocation?.registrationId===reg.id&&allocation.intentId===intent.id&&!refundConflict
    ?recordedRefundObligationView(event,reg.id,receipt,intent,components,refunds):null;
   items.push({caseId:row.id,caseState:row.state,ownerAssigned:!!row.owner,engineeringEscalationAt:row.deadline.toISOString(),evidenceConflict:!view,obligation:view,dispatchAuthorized:false});
  }
  return {version:'v11-controlled-obligations-1',scope:'BOUND_RECORDED_OBLIGATIONS_ONLY',coverage:'RECORDED_ONLY',items,nextCursor:cases.length===50?cases[49]!.id:null,releaseAuthorized:false};
 },{isolationLevel:'RepeatableRead',timeout:15000});
}
