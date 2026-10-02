import {createHash} from 'node:crypto';
import type {V11RefundInstruction,ChannelReceipt,ReceivedEvent} from '../generated/prisma/client.js';
import {parseChannelPaymentTime} from '../wechat-response.js';

// Local completion period derives only from separately verified query evidence.
// createdAt/updatedAt/notification arrival/CSV alone never substitute for it.
export function trustedRefundCompletionTime(refund:V11RefundInstruction,receipt:ChannelReceipt,events:ReceivedEvent[]){
 if(!refund.channelRefundNo)return {status:'MISSING' as const};
 const key='REFUND_TIME:'+refund.channelRefundNo;
 const relevant=events.filter(x=>['wechat-refund-time-query-v11','wechat-refund-time-notify-v11'].includes(x.source)&&x.merchantScope===refund.merchantScope&&(x.eventKey===key||x.eventKey.startsWith(key+':conflict:')));
 if(!relevant.length)return {status:'MISSING' as const};
 const primary=relevant.filter(x=>x.eventKey===key);
 if(primary.length<1||primary.length>2||new Set(primary.map(x=>x.source)).size!==primary.length||relevant.length!==primary.length||primary.some(x=>x.state!=='APPLIED')||primary.some(x=>x.payloadHash!==primary[0]!.payloadHash))return {status:'CONFLICT' as const};
 if(primary.some(x=>x.verificationMaterialId!==refund.providerConfigId||!Number.isFinite(x.verifiedAt.getTime())))return {status:'CONFLICT' as const};
 const event=primary[0]!,value=event.normalizedPayload;
 if(!value||typeof value!=='object'||Array.isArray(value))return {status:'CONFLICT' as const};
 const body=value as Record<string,unknown>;let refundedAt:string;
 try{refundedAt=parseChannelPaymentTime(body.refundedAt);}catch{return {status:'CONFLICT' as const};}
 const payload={kind:'REFUND_COMPLETION_TIME',sourceId:refund.id,receiptId:receipt.id,merchantRefundNo:refund.merchantRefundNo,
  channelRefundNo:refund.channelRefundNo,originalTradeNo:refund.originalTradeNo,amountCents:refund.totalCents,currency:'CNY',refundedAt};
 if(primary.some(x=>{const value=x.normalizedPayload;if(!value||typeof value!=='object'||Array.isArray(value))return true;const p=value as Record<string,unknown>;return Object.keys(p).sort().join('|')!==Object.keys(payload).sort().join('|')||Object.entries(payload).some(([key,item])=>p[key]!==item)||Date.parse(refundedAt)>x.verifiedAt.getTime()+300000;}))return {status:'CONFLICT' as const};
 if(Object.keys(body).sort().join('|')!==Object.keys(payload).sort().join('|')||Object.entries(payload).some(([key,item])=>body[key]!==item)
  ||event.payloadHash!==createHash('sha256').update(JSON.stringify(payload)).digest('hex')||event.verificationMaterialId!==refund.providerConfigId
  ||refund.channel!=='wechat'||receipt.channel!=='wechat'||receipt.merchantScope!==refund.merchantScope||refund.receiptId!==receipt.id
  ||receipt.channelTradeNo!==refund.originalTradeNo||receipt.currency!=='CNY'||refund.state!=='CONFIRMED'
  ||refund.totalCents!==refund.serviceFeeCents+refund.depositCents||refund.totalCents<=0||refund.totalCents>receipt.amountCents||!receipt.paidAt
  ||Date.parse(refundedAt)<receipt.paidAt.getTime()||Date.parse(refundedAt)>event.verifiedAt.getTime()+300000)
  return {status:'CONFLICT' as const};
 return {status:'TRUSTED' as const,refundedAt,eventId:event.id};
}
