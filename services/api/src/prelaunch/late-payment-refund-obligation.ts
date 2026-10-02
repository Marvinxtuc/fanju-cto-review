import {createHash} from 'node:crypto';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {createWechatChannel} from './wechat-channel.js';
import type {Lease} from '../jobs/queue.js';
import {assertLease,registrationLock,dbNow} from './domain.js';
import {openCase} from '../jobs/queue.js';
import {parseChannelPaymentTime} from '../wechat-response.js';

// Frozen absolute formal-hold deadline, including timely channel payment only
// confirmed after an expired/released UNKNOWN hold. Records F+D; never submits,
// grants/revokes membership or invents an execution SLA/batch.
export function createLatePaymentRefundObligation(db:PrismaClient,channel:ReturnType<typeof createWechatChannel>,owner:string){
 if(!owner.trim())throw Error('Refund obligation owner required');
 return async(receiptId:string,intentId:string,lease?:Lease)=>db.$transaction(async tx=>{
  const initial=await tx.v11PaymentIntent.findUniqueOrThrow({where:{id:intentId}});
  const reg=await registrationLock(tx,initial.registrationId);
  if(lease){if(lease.kind!=='V11_QUERY_PAYMENT'||lease.refId!==intentId)throw Error('Obligation worker reference mismatch');await assertLease(tx,lease);}
  const intent=await tx.v11PaymentIntent.findUniqueOrThrow({where:{id:intentId}});channel.assertBinding(intent);
  await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${receiptId} FOR UPDATE`;
  const receipt=await tx.channelReceipt.findUniqueOrThrow({where:{id:receiptId}}),allocation=await tx.v11ReceiptBinding.findUniqueOrThrow({where:{receiptId}});
  const hold=await tx.v11SeatHold.findUnique({where:{registrationId:reg.id}});
  if(receipt.channel!=='wechat'||receipt.merchantScope!==intent.merchantScope||receipt.merchantOrderNo!==intent.merchantOrderNo||receipt.currency!=='CNY'||!receipt.paidAt
   ||receipt.amountCents!==intent.totalCents||receipt.amountCents!==reg.serviceFeeCents+reg.depositCents||allocation.intentId!==intent.id||allocation.registrationId!==reg.id
   ||!['PRIMARY','EXTRA'].includes(allocation.classification))throw Error('Late obligation receipt binding conflict');
  if(reg.category==='WAITLIST'||!hold||hold.expiresAt.getTime()!==reg.acceptedAt.getTime()+600000)return {kind:'UNASSESSED' as const};
  const evidence=await tx.receivedEvent.findFirst({where:{source:'wechat-query-v11',merchantScope:intent.merchantScope,payloadHash:receipt.evidenceHash,verificationMaterialId:intent.providerConfigId}});
  const normalized=evidence?.normalizedPayload as Record<string,unknown>|undefined;
  const payload={kind:'PAYMENT',sourceId:intent.id,merchantOrderNo:intent.merchantOrderNo,channelNo:receipt.channelTradeNo,amountCents:receipt.amountCents,currency:'CNY',paidAt:normalized?.paidAt};
  if(!evidence||!['RECEIPT_RECORDED','APPLIED'].includes(evidence.state)||!normalized||Object.keys(normalized).sort().join('|')!==Object.keys(payload).sort().join('|')||Object.entries(payload).some(([key,value])=>normalized[key]!==value)
   ||parseChannelPaymentTime(payload.paidAt)!==receipt.paidAt.toISOString()||createHash('sha256').update(JSON.stringify(payload)).digest('hex')!==receipt.evidenceHash)throw Error('Trusted late receipt evidence unavailable');
  const confirmedAfterRelease=hold.state==='EXPIRED'&&!!hold.releasedAt&&hold.releasedAt>=hold.expiresAt&&evidence.verifiedAt>=hold.expiresAt
   &&reg.eligibilityState==='EXPIRED'&&!reg.active&&!reg.paidEffectiveAt;
  const obligation={kind:'LATE_PAYMENT_FULL_REFUND_OBLIGATION',registrationId:reg.id,intentId:intent.id,receiptId:receipt.id,F:reg.serviceFeeCents,D:reg.depositCents,totalCents:receipt.amountCents,
   paidAt:receipt.paidAt.toISOString(),holdExpiresAt:hold.expiresAt.toISOString(),ruleReference:'DR01-04',execution:'PENDING_FORMAL_DISPATCH_AUTHORITY',membershipEffect:'NONE'};
  const payloadHash=createHash('sha256').update(JSON.stringify(obligation)).digest('hex');
  const key={source:'wechat-late-refund-obligation-v11',merchantScope:intent.merchantScope,eventKey:'LATE_REFUND:'+receipt.id};
  const prior=await tx.receivedEvent.findUnique({where:{source_merchantScope_eventKey:key}});
  if(!prior&&receipt.paidAt<hold.expiresAt&&!confirmedAfterRelease)return {kind:'NOT_LATE' as const};
  if(lease)await assertLease(tx,lease);
  if(prior&&(prior.payloadHash!==payloadHash||prior.verificationMaterialId!==intent.providerConfigId))throw Error('Late refund obligation identity conflict');
  const event=prior??await tx.receivedEvent.create({data:{...key,payloadHash,normalizedPayload:obligation,verificationMaterialId:intent.providerConfigId,verifiedAt:await dbNow(tx),state:'APPLIED'}});
  const financialCase=await openCase(tx,'V11_LATE_PAYMENT_FULL_REFUND_DUE',event.id,owner);
  if(!prior)await tx.auditLog.create({data:{action:'funding.v11-late-full-refund-obligation',targetType:'ReceivedEvent',targetId:event.id,metadata:{scope:'KNOWN_REFUND_OBLIGATION_ONLY',receiptId:receipt.id,caseId:financialCase.id,ruleReference:'DR01-04',executionAuthorized:false}}});
  return {kind:'OBLIGATION_RECORDED' as const,eventId:event.id};
 });
}
