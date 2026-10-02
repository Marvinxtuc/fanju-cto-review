import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {registrationLock} from './domain.js';
import {enqueue,openCase} from '../jobs/queue.js';
import {hasFormalUnpaidCloseAuthority} from './formal-close-authority.js';
// One bounded atomic page. Existing DONE/MANUAL tasks are never reset.
export async function scheduleFormalCloseBatch(db:PrismaClient,binding:ChannelBinding,owner:string,afterId?:string){
 if(binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(binding.merchantScope)||!binding.providerConfigId.trim()||!owner.trim()||(afterId!==undefined&&(!afterId||afterId.length>160)))throw Error('Explicit closure sweep scope required');
 return db.$transaction(async tx=>{
  const rows=await tx.v11PaymentIntent.findMany({where:{channel:binding.channel,merchantScope:binding.merchantScope,providerConfigId:binding.providerConfigId,active:false,state:{in:['NEW','SUBMITTING','UNKNOWN']},registration:{active:false,eligibilityState:{in:['EXPIRED','ENDED']}},...(afterId?{id:{gt:afterId}}:{})},orderBy:{id:'asc'},take:50});
  const counts={scheduled:0,retained:0,review:0};
  for(const row of rows){
   const reg=await registrationLock(tx,row.registrationId),intent=await tx.v11PaymentIntent.findUniqueOrThrow({where:{id:row.id}});
   if(intent.channel!==binding.channel||intent.merchantScope!==binding.merchantScope||intent.providerConfigId!==binding.providerConfigId||!await hasFormalUnpaidCloseAuthority(tx,reg,intent)){
    await openCase(tx,'V11_FORMAL_CLOSE_SWEEP_REVIEW',row.id,owner);counts.review++;continue;
   }
   const key=`v11:formal-expire-close:${intent.id}`,prior=await tx.durableJob.findUnique({where:{businessKey:key}});
   await enqueue(tx,'V11_CLOSE_EXPIRED_PAYMENT',key,intent.id);
   if(prior)counts.retained++;else counts.scheduled++;
  }
  const nextCursor=rows.length===50?rows[49]!.id:null;
  await tx.auditLog.create({data:{action:'funding.v11-formal-close-sweep',targetType:'V11CloseSweepPage',targetId:binding.providerConfigId,metadata:{scope:'BOUND_EXPIRED_CLOSE_TASKS_ONLY',merchantScope:binding.merchantScope,providerConfigId:binding.providerConfigId,owner,afterId:afterId??null,nextCursor,counts}}});
  return {counts,nextCursor,channelCalled:false as const};
 },{timeout:30000});
}
