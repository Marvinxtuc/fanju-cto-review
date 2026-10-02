import type { PrismaClient } from '../generated/prisma/client.js';
import { reject, requireRole, type LocalPrincipal } from './contracts.js';
import {recordedRefundObligationView} from './refund-obligation-view.js';

// Existing monetary facts only. No policy activation, eligibility, refund grant,
// raw channel identifier, questionnaire, address or prepayment parameter is exposed.
export async function ownFinancialRecords(db: PrismaClient, actor: LocalPrincipal, registrationId: string) {
  requireRole(actor,'USER');if(!actor.userId)reject(403,'FORBIDDEN');
  return db.$transaction(async tx=>{
    const registration=await tx.v11Registration.findFirst({where:{id:registrationId,userId:actor.userId!},select:{id:true}});
    if(!registration)reject(404,'RESOURCE_NOT_FOUND');
    const intents=await tx.v11PaymentIntent.findMany({where:{registrationId,channel:'wechat'}});
    const recorded=await tx.channelReceipt.findMany({where:{channel:'wechat',merchantOrderNo:{in:intents.map(x=>x.merchantOrderNo)}},include:{v11ReceiptBinding_receiptId:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
    const refunds=await tx.v11RefundInstruction.findMany({where:{registrationId,channel:'wechat'},include:{receipt:true},orderBy:[{createdAt:'asc'},{id:'asc'}]});
    const receipts=recorded.map(receipt=>({receipt,receiptId:receipt.id,intent:intents.find(x=>x.merchantOrderNo===receipt.merchantOrderNo),
      binding:receipt.v11ReceiptBinding_receiptId,classification:receipt.v11ReceiptBinding_receiptId?.classification??'UNALLOCATED'}));
    const conflict=():never=>reject(503,'FUNDS_DATA_CONFLICT');
    for(const row of receipts){
      const {receipt,intent}=row;
      if(!intent||intent.registrationId!==registrationId||intent.channel!=='wechat'||intent.merchantScope!==receipt.merchantScope
        ||intent.merchantOrderNo!==receipt.merchantOrderNo||intent.totalCents!==receipt.amountCents||receipt.currency!=='CNY'
        ||!receipt.paidAt||receipt.amountCents<=0||receipt.paymentId||receipt.orderId||!['PRIMARY','EXTRA','UNALLOCATED'].includes(row.classification)
        ||(row.binding&&(row.binding.intentId!==intent.id||row.binding.registrationId!==registrationId)))conflict();
    }
    const receiptIds=new Set(receipts.map(x=>x.receiptId));
    for(const row of refunds){
      if(!receiptIds.has(row.receiptId)||row.merchantScope!==row.receipt.merchantScope||row.originalTradeNo!==row.receipt.channelTradeNo
        ||row.totalCents!==row.serviceFeeCents+row.depositCents||row.totalCents<=0||row.totalCents>row.receipt.amountCents
        ||row.serviceFeeCents<0||row.depositCents<0||!['NEW','SUBMITTING','UNKNOWN','CONFIRMED'].includes(row.state)
        ||(row.state==='CONFIRMED'&&!row.channelRefundNo))conflict();
    }
    for(const row of receipts){
      if(refunds.filter(x=>x.receiptId===row.receiptId).reduce((sum,x)=>sum+x.totalCents,0)>row.receipt.amountCents)conflict();
    }
    const paidCents=receipts.reduce((sum,x)=>sum+x.receipt.amountCents,0);
    const confirmedRefundCents=refunds.filter(x=>x.state==='CONFIRMED').reduce((sum,x)=>sum+x.totalCents,0);
    if(!Number.isSafeInteger(paidCents)||!Number.isSafeInteger(confirmedRefundCents))conflict();
    const events=await tx.receivedEvent.findMany({where:{source:'wechat-late-refund-obligation-v11',eventKey:{in:receipts.map(x=>'LATE_REFUND:'+x.receiptId)},merchantScope:{in:intents.map(x=>x.merchantScope)}},orderBy:[{verifiedAt:'asc'},{id:'asc'}]});
    const components=await tx.v11FundComponent.findMany({where:{receiptId:{in:[...receiptIds]}}});
    const refundObligations=[];let obligationEvidenceConflicts=0;
    for(const event of events){const row=receipts.find(x=>'LATE_REFUND:'+x.receiptId===event.eventKey);
      const view=row?.intent&&row.binding?recordedRefundObligationView(event,registrationId,row.receipt,row.intent,components.filter(x=>x.receiptId===row.receiptId),refunds):null;
      if(view)refundObligations.push(view);else obligationEvidenceConflicts++;
    }
    return {version:'v11-funds-1',scope:'MONETARY_RECORDS_ONLY',observation:'RECORDED_ONLY',registrationId,
      policyActivation:'NOT_ASSESSED',eligibilityGranted:false,
      paidCents,confirmedRefundCents,unallocatedReceiptCount:receipts.filter(x=>!x.binding).length,
      receipts:receipts.map(x=>({receiptId:x.receiptId,amountCents:x.receipt.amountCents,paidAt:x.receipt.paidAt,classification:x.classification})),
      refunds:refunds.map(x=>({refundId:x.id,amountCents:x.totalCents,state:x.state})),
      refundObligations,obligationEvidenceConflicts,refundObligationCoverage:'RECORDED_ONLY',
    };
  },{isolationLevel:'RepeatableRead'});
}
