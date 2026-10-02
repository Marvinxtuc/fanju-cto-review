import { createHash } from 'node:crypto';
import { z } from 'zod';
const cents = z.number().int().min(0).max(2_147_483_647);
const schema = z.object({
  scope:z.literal('FORMAL_BUSINESS_PARAMETERS'), version:z.string().min(1).max(160),
  defaultServiceFeeCents:cents.nullable(), depositMinCents:cents.nullable(), depositMaxCents:cents.nullable(),
  waitlistMax:z.number().int().min(0).max(100_000).nullable(),
  waitlistExposureCents:cents.nullable(),
  memberRemovalEvent:z.enum(['REQUEST_ACCEPTED','DECISION_ACCEPTED']).nullable(),
  fifoClock:z.enum(['TRUSTED_PAYMENT_CONFIRMED','REGISTRATION_ACCEPTED']).nullable(),
  fifoTieBreak:z.literal('ACCEPTED_TRANSACTION_ORDINAL').nullable(),
  refundBatchUtcMinutes:z.array(z.number().int().min(0).max(1439)).min(1).max(24).nullable(),
  refundDispatchSlaSeconds:z.number().int().min(1).max(604800).nullable(),
  waitlistConcurrency:z.literal('SERIAL_TRANSACTION_RESERVED_EXPOSURE').nullable().optional().default(null),
  automaticObligationDecision:z.boolean().nullable().optional().default(null),
}).strict();
export type FormalBusinessParameters = z.infer<typeof schema>;
export function inspectFormalBusinessParameters(raw:string,expectedDigest:string){
  if(typeof raw!=='string'||Buffer.byteLength(raw)>64*1024||!/^[a-f0-9]{64}$/.test(expectedDigest)
    ||createHash('sha256').update(raw).digest('hex')!==expectedDigest)throw Error('Formal parameters integrity invalid');
  let parsed:unknown;try{parsed=JSON.parse(raw);}catch{throw Error('Formal parameters integrity invalid');}
  const result=schema.safeParse(parsed);if(!result.success)throw Error('Formal parameters integrity invalid');
  const p=result.data;
  if(p.depositMinCents!==null&&p.depositMaxCents!==null&&p.depositMinCents>p.depositMaxCents
    ||p.refundBatchUtcMinutes!==null&&new Set(p.refundBatchUtcMinutes).size!==p.refundBatchUtcMinutes.length)
    throw Error('Formal parameters integrity invalid');
  return p;
}
/** Missing commercial parameters block only dependent actions. Existing receipts,
 * recovery and accepted refund applications must remain accessible. */
export function formalParameterDependencies(p:FormalBusinessParameters,action:'FORMAL_QUOTE'|'WAITLIST_QUOTE'|'REMOVE_MEMBER'|'REFUND_BATCH'){
  const blockers=new Set<string>();
  if(action==='FORMAL_QUOTE'||action==='WAITLIST_QUOTE'){
    if(p.defaultServiceFeeCents===null||p.depositMinCents===null||p.depositMaxCents===null)blockers.add('OP-03');
  }
  if(action==='WAITLIST_QUOTE'){
    if(p.waitlistMax===null||p.waitlistExposureCents===null)blockers.add('OP-08');
    if(p.fifoClock===null||p.fifoTieBreak===null)blockers.add('OP-05');
  }
  if(action==='REMOVE_MEMBER'&&p.memberRemovalEvent===null)blockers.add('OP-04');
  if(action==='REFUND_BATCH'&&(p.refundBatchUtcMinutes===null||p.refundDispatchSlaSeconds===null))blockers.add('OP-11');
  return [...blockers];
}
