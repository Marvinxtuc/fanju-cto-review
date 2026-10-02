import {createHash} from 'node:crypto';
import type {V11RefundInstruction,ChannelReceipt} from '../generated/prisma/client.js';
import type {ChannelRefundResult} from '../providers.js';
import {dbNow,type Tx} from './domain.js';
import {openCase} from '../jobs/queue.js';
import {parseChannelPaymentTime} from '../wechat-response.js';

// Internal verified-query seam; separate from the immutable monetary event so
// adding missing time does not turn an already confirmed refund into a conflict.
export async function recordVerifiedRefundTime(tx:Tx,instruction:V11RefundInstruction,receipt:ChannelReceipt,fact:ChannelRefundResult,owner:string){
 return recordTime(tx,instruction,receipt,fact,owner,'wechat-refund-time-query-v11');
}
export async function recordVerifiedRefundNotificationTime(tx:Tx,instruction:V11RefundInstruction,receipt:ChannelReceipt,fact:ChannelRefundResult,owner:string,notification:{eventId:string;verificationMaterialId:string}){
 if(!notification.eventId||!notification.verificationMaterialId)throw Error('Verified refund notification reference required');
 return recordTime(tx,instruction,receipt,fact,owner,'wechat-refund-time-notify-v11',notification);
}
async function recordTime(tx:Tx,instruction:V11RefundInstruction,receipt:ChannelReceipt,fact:ChannelRefundResult,owner:string,source:string,notification?:{eventId:string;verificationMaterialId:string}){
 if(fact.status!=='SUCCEEDED')throw Error('Successful verified refund query required');
 if(!fact.refundedAt)return {status:'UNAVAILABLE' as const};
 const refundedAt=parseChannelPaymentTime(fact.refundedAt);
 if(instruction.channel!=='wechat'||receipt.channel!=='wechat'||instruction.receiptId!==receipt.id||instruction.merchantScope!==receipt.merchantScope
  ||fact.merchantRefundNo!==instruction.merchantRefundNo||fact.originalTradeNo!==instruction.originalTradeNo||receipt.channelTradeNo!==fact.originalTradeNo
  ||fact.amountCents!==instruction.totalCents||fact.currency!=='CNY'||!fact.channelRefundNo||!owner.trim())throw Error('Refund time binding conflict');
 const now=await dbNow(tx),at=Date.parse(refundedAt);
 const payload={kind:'REFUND_COMPLETION_TIME',sourceId:instruction.id,receiptId:receipt.id,merchantRefundNo:fact.merchantRefundNo,
  channelRefundNo:fact.channelRefundNo,originalTradeNo:fact.originalTradeNo,amountCents:fact.amountCents,currency:'CNY',refundedAt};
 const payloadHash=createHash('sha256').update(JSON.stringify(payload)).digest('hex');
 const key={source,merchantScope:instruction.merchantScope,eventKey:'REFUND_TIME:'+fact.channelRefundNo};
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-refund-completion-time:${key.merchantScope}:${key.eventKey}`},0))`;
 const prior=await tx.receivedEvent.findUnique({where:{source_merchantScope_eventKey:key}});
 const invalid=!receipt.paidAt||at<receipt.paidAt.getTime()||at>now.getTime()+300000;
 const changed=!!prior&&prior.payloadHash!==payloadHash;
 const observation={...key,eventKey:changed?key.eventKey+':conflict:'+payloadHash:key.eventKey};
 const previous=changed?await tx.receivedEvent.findUnique({where:{source_merchantScope_eventKey:observation}}):prior;
 const unresolved=await tx.receivedEvent.count({where:{source:key.source,merchantScope:key.merchantScope,eventKey:{startsWith:key.eventKey+':conflict:'},state:'MANUAL'}});
 const otherSource=source==='wechat-refund-time-query-v11'?'wechat-refund-time-notify-v11':'wechat-refund-time-query-v11';
 const corroboration=await tx.receivedEvent.findMany({where:{source:otherSource,merchantScope:key.merchantScope,OR:[{eventKey:key.eventKey},{eventKey:{startsWith:key.eventKey+':conflict:'}}]}});
 const crossConflict=corroboration.some(x=>x.payloadHash!==payloadHash||x.state!=='APPLIED'||x.eventKey!==key.eventKey);
 const conflict=invalid||changed||prior?.state==='MANUAL'||unresolved>0||crossConflict;
 const event=await tx.receivedEvent.upsert({where:{source_merchantScope_eventKey:observation},update:conflict?{state:'MANUAL'}:{},create:{...observation,payloadHash,normalizedPayload:payload,verificationMaterialId:instruction.providerConfigId,verifiedAt:now,state:conflict?'MANUAL':'APPLIED'}});
 if(!previous||previous.state!==event.state)await tx.auditLog.create({data:{action:'funding.v11-refund-time-observed',targetType:'ReceivedEvent',targetId:event.id,metadata:{scope:'VERIFIED_REFUND_TIME_ONLY',instructionId:instruction.id,conflict,...(notification?{notificationEventId:notification.eventId,notificationVerificationMaterialId:notification.verificationMaterialId}:{})}}});
 if(conflict)await openCase(tx,'V11_REFUND_COMPLETION_TIME_CONFLICT',event.id,owner);
 return {status:conflict?'CONFLICT' as const:'RECORDED' as const,eventId:event.id};
}
