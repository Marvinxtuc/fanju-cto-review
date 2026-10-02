import {hasFormalUnpaidCloseAuthority} from './formal-close-authority.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {createWechatChannel} from './wechat-channel.js';
import type {Lease} from '../jobs/queue.js';
import {enqueue} from '../jobs/queue.js';
import {registrationLock,assertLease} from './domain.js';

// Committed absolute-expiry or OP04 ordinary unpaid-exit evidence authorizes closure.
// Query recovery is committed before any network I/O; no local money state changes.
export function createFormalPaymentCloser(db:PrismaClient,channel:ReturnType<typeof createWechatChannel>){
 return async(lease:Lease)=>{
  if(lease.kind!=='V11_CLOSE_EXPIRED_PAYMENT'||lease.payloadVersion!==1)throw Error('Closure reference mismatch');
  const initial=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:lease.refId}});
  const check=async(record=false)=>db.$transaction(async tx=>{
   const reg=await registrationLock(tx,initial.registrationId);await assertLease(tx,lease);
   const intent=await tx.v11PaymentIntent.findUniqueOrThrow({where:{id:initial.id}});channel.assertBinding(intent);
   if(intent.registrationId!==initial.registrationId||intent.merchantOrderNo!==initial.merchantOrderNo||intent.totalCents!==initial.totalCents||intent.merchantScope!==initial.merchantScope||intent.providerConfigId!==initial.providerConfigId
    ||!await hasFormalUnpaidCloseAuthority(tx,reg,intent))throw Error('Closure authority unavailable');
   if(record){
    await enqueue(tx,'V11_QUERY_PAYMENT',`v11:close-recovery:${lease.id}:${lease.generation}`,intent.id);
    await tx.auditLog.create({data:{action:'funding.v11-expired-close-attempt',targetType:'DurableJob',targetId:lease.id,metadata:{scope:'FORMAL_EXPIRED_CLOSE_ATTEMPT_ONLY',intentId:intent.id,generation:lease.generation,channelClosed:false}}});
   }
  },{timeout:15000});
  await check(true);
  const fact=await channel.closePayment(initial,()=>check());
  // Persist another query after the channel call; the pre-I/O query may already
  // have run. SUCCEEDED is processed by existing receipt/allocation handlers.
  await db.$transaction(async tx=>{await registrationLock(tx,initial.registrationId);await assertLease(tx,lease);
   await enqueue(tx,'V11_QUERY_PAYMENT',`v11:close-result:${lease.id}:${lease.generation}`,initial.id);
   await tx.auditLog.create({data:{action:'funding.v11-expired-close-observed',targetType:'DurableJob',targetId:lease.id,metadata:{scope:'TRUSTED_CLOSE_QUERY_ONLY',intentId:initial.id,generation:lease.generation,status:fact.status}}});
  });
 };
}
