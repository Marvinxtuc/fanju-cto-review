import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import type {Lease} from '../jobs/queue.js';
import {enqueue} from '../jobs/queue.js';
import {assertLease,registrationLock,dbNow,json,object} from './domain.js';
import {authorizeHistoricalPolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {refreshFormalTable,promoteFormalWaitlist} from './formal-qualification.js';
/** Durable boundary jobs use original table memberships to preserve T-24 rights
 * even if the worker was down. No notification send is equated to delivery. */
export function formalLifecycleHandler(db:PrismaClient,source:RuntimeAuthoritySource,binding:ChannelBinding){
 return async(lease:Lease)=>db.$transaction(async tx=>{
  const reg=await registrationLock(tx,lease.refId);await assertLease(tx,lease);
  const runtime=await authorizeHistoricalPolicy(tx,reg.policyId,'RECOVER_FUNDS',source);
  if(runtime.binding.channel!==binding.channel||runtime.binding.merchantScope!==binding.merchantScope||runtime.binding.providerConfigId!==binding.providerConfigId)throw Error('Formal lifecycle original binding mismatch');
  const at=await dbNow(tx),cutoff=new Date(reg.activity.startsAt.getTime()-24*3600000);
  const tables=await tx.v11Table.findMany({where:{activityId:reg.activityId,supply:{status:'FORMAL_APPROVED'}},orderBy:{id:'asc'}});
  for(const table of tables){
   if(at>=cutoff){
    const key='formal-t24:'+table.id,prior=await tx.v11TableEvent.findUnique({where:{businessKey:key}});
    if(!prior){
     const historical=await tx.v11Membership.findMany({where:{tableId:table.id,joinedAt:{lte:cutoff},OR:[{leftAt:null},{leftAt:{gt:cutoff}}]},select:{id:true}}),supply=await tx.v11SupplyRevision.findUniqueOrThrow({where:{id:table.supplyId}}),formed=historical.length>=supply.minSize;
     await tx.v11TableEvent.create({data:{tableId:table.id,businessKey:key,kind:formed?'T24_FORMED_SNAPSHOT':'T24_FAILED_SNAPSHOT',acceptedAt:cutoff,version:table.version,snapshot:json({scope:'FORMAL_TABLE',count:historical.length,memberIds:historical.map(m=>m.id),supplyId:table.supplyId,formed,state:formed?'FORMED':'WAITING'})}});
     if(formed)await tx.v11Table.update({where:{id:table.id},data:{t24FormedAt:cutoff,everFormed:true,version:{increment:1}}});
    }else if(object(prior.snapshot).scope!=='FORMAL_TABLE')throw Error('Formal T24 history provenance invalid');
   }
   await refreshFormalTable(tx,table.id,at);
  }
  await promoteFormalWaitlist(tx,reg.activityId,at,source);
 },{timeout:30000});
}
export async function scheduleFormalLifecycleBatch(db:PrismaClient,binding:ChannelBinding,afterId?:string){
 const rows=await db.v11Registration.findMany({where:{...(afterId?{id:{gt:afterId}}:{}),policy:{status:'FORMAL_RUNTIME'},v11PaymentIntent_registrationId:{some:{channel:binding.channel,merchantScope:binding.merchantScope,providerConfigId:binding.providerConfigId}}},include:{activity:true},orderBy:{id:'asc'},take:50});
 await db.$transaction(async tx=>{for(const row of rows){for(const hours of [24,8])await enqueue(tx,'V11_FORMAL_LIFECYCLE',`v11:formal-boundary:${row.id}:${hours}`,row.id,new Date(row.activity.startsAt.getTime()-hours*3600000));}});
 return {scheduled:rows.length,nextCursor:rows.length===50?rows[49]!.id:null};
}
