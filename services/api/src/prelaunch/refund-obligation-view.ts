import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {ReceivedEvent,ChannelReceipt,V11PaymentIntent,V11FundComponent,V11RefundInstruction} from '../generated/prisma/client.js';
const schema=z.object({kind:z.literal('LATE_PAYMENT_FULL_REFUND_OBLIGATION'),registrationId:z.string().min(1),intentId:z.string().min(1),receiptId:z.string().min(1),F:z.number().int().nonnegative(),D:z.number().int().nonnegative(),totalCents:z.number().int().positive(),paidAt:z.string().datetime(),holdExpiresAt:z.string().datetime(),ruleReference:z.literal('DR01-04'),execution:z.literal('PENDING_FORMAL_DISPATCH_AUTHORITY'),membershipEffect:z.literal('NONE')}).strict();
export function recordedRefundObligationView(event:ReceivedEvent,registrationId:string,receipt:ChannelReceipt,intent:V11PaymentIntent,components:V11FundComponent[],refunds:V11RefundInstruction[]){
 const parsed=schema.safeParse(event.normalizedPayload);if(!parsed.success)return null;
 const body=parsed.data;
 if(event.source!=='wechat-late-refund-obligation-v11'||event.state!=='APPLIED'||event.eventKey!=='LATE_REFUND:'+receipt.id||event.merchantScope!==receipt.merchantScope||event.verificationMaterialId!==intent.providerConfigId
  ||body.registrationId!==registrationId||intent.registrationId!==registrationId||body.intentId!==intent.id||body.receiptId!==receipt.id||receipt.channel!=='wechat'||intent.channel!=='wechat'||intent.merchantScope!==receipt.merchantScope
  ||receipt.merchantOrderNo!==intent.merchantOrderNo||receipt.currency!=='CNY'||receipt.amountCents!==body.totalCents||intent.totalCents!==body.totalCents||body.F+body.D!==body.totalCents||receipt.paidAt?.toISOString()!==body.paidAt
  ||components.length!==2||components.some(x=>x.receiptId!==receipt.id)||components.find(x=>x.kind==='F')?.originalCents!==body.F||components.find(x=>x.kind==='D')?.originalCents!==body.D
  ||!Number.isFinite(event.verifiedAt.getTime())||event.payloadHash!==createHash('sha256').update(JSON.stringify(body)).digest('hex'))return null;
 const ownRefunds=refunds.filter(x=>x.receiptId===receipt.id),confirmedCents=ownRefunds.filter(x=>x.state==='CONFIRMED').reduce((sum,x)=>sum+x.totalCents,0);
 if(!Number.isSafeInteger(confirmedCents)||confirmedCents<0||confirmedCents>body.totalCents)return null;
 const remainingCents=body.totalCents-confirmedCents;
 return {receiptId:receipt.id,amountCents:body.totalCents,confirmedCents,remainingCents,recordedAt:event.verifiedAt.toISOString(),
  state:remainingCents===0?'CONFIRMED':ownRefunds.some(x=>x.state!=='CONFIRMED')?'EXECUTION_RECORDED':'AWAITING_EXECUTION'};
}
