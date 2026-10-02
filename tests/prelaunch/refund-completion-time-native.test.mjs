import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {createRefundQueryConfirmation}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/refund-query-confirmation.js`));
test('refund time evidence enriches monetary confirmation without rewriting old facts',async t=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);const prefix='refund_time_'+randomUUID().replaceAll('-','');
 try{
  const scope=createHash('sha256').update(prefix).digest('hex'),paidAt=new Date(Date.now()-172800000),time=new Date(Date.now()-86400000).toISOString();
  const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:scope,merchantOrderNo:prefix+'_order',channelTradeNo:prefix+'_trade',amountCents:100,evidenceHash:'synthetic-time-only',verifiedAt:new Date(),paidAt}});
  const component=await db.v11FundComponent.create({data:{receiptId:receipt.id,kind:'F',originalCents:100}});
  const instruction=await db.v11RefundInstruction.create({data:{channel:'wechat',merchantScope:scope,providerConfigId:'synthetic-time-v1',receiptId:receipt.id,businessKey:prefix+'_refund',merchantRefundNo:prefix+'_refund',originalTradeNo:receipt.channelTradeNo,totalCents:40,serviceFeeCents:40,depositCents:0,state:'UNKNOWN'}});
  await db.v11Disposition.create({data:{componentId:component.id,businessKey:prefix+'_budget',kind:'REFUND',amountCents:40,state:'RESERVED',sourceRef:instruction.id}});
  let refundedAt;const channel={assertBinding:()=>{},queryRefund:async()=>({status:'SUCCEEDED',merchantRefundNo:instruction.merchantRefundNo,originalTradeNo:receipt.channelTradeNo,amountCents:40,currency:'CNY',channelRefundNo:prefix+'_channel',...(refundedAt?{refundedAt}:{})})};
  const confirm=createRefundQueryConfirmation(db,channel,prefix+'_owner');let originalMoneyHash;
  await t.test('missing completion time confirms money without inventing time',async()=>{
   assert.deepEqual(await confirm(instruction.id),{kind:'CONFIRMED'});assert.equal(await db.receivedEvent.count({where:{source:'wechat-refund-time-query-v11',merchantScope:scope}}),0);originalMoneyHash=(await db.receivedEvent.findFirstOrThrow({where:{source:'wechat-refund-query-v11',merchantScope:scope}})).payloadHash;
  });
  await t.test('adding time is independent evidence and concurrent repeats are idempotent',async()=>{
   refundedAt=time;for(const result of await Promise.all([confirm(instruction.id),confirm(instruction.id)]))assert.deepEqual(result,{kind:'CONFIRMED'});
   const row=await db.receivedEvent.findFirstOrThrow({where:{source:'wechat-refund-time-query-v11',merchantScope:scope}});assert.equal(row.state,'APPLIED');assert.equal(row.normalizedPayload.refundedAt,time);assert.equal(await db.auditLog.count({where:{action:'funding.v11-refund-time-observed',targetId:row.id}}),1);
   assert.equal((await db.receivedEvent.findFirstOrThrow({where:{source:'wechat-refund-query-v11',merchantScope:scope}})).payloadHash,originalMoneyHash);assert.equal(await db.receivedEvent.count({where:{source:'wechat-refund-query-v11',merchantScope:scope}}),1);
  });
  await t.test('changed time preserves original evidence, creates a conflict and never rolls back money',async()=>{
   refundedAt=new Date(Date.parse(time)+1000).toISOString();await confirm(instruction.id);const events=await db.receivedEvent.findMany({where:{source:'wechat-refund-time-query-v11',merchantScope:scope}});assert.equal(events.length,2);assert.ok(events.some(x=>x.normalizedPayload.refundedAt===time));assert.ok(events.some(x=>x.state==='MANUAL'));assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:instruction.id}})).state,'CONFIRMED');assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:instruction.id}})).state,'COMPLETED');
  });
  await t.test('returning to original time cannot clear unresolved conflicts',async()=>{refundedAt=time;await confirm(instruction.id);assert.ok((await db.receivedEvent.findMany({where:{source:'wechat-refund-time-query-v11',merchantScope:scope}})).every(x=>x.state==='MANUAL'));});
  await t.test('a time before the original payment remains manual evidence',async()=>{refundedAt=new Date(paidAt.getTime()-1000).toISOString();await confirm(instruction.id);const event=await db.receivedEvent.findFirstOrThrow({where:{source:'wechat-refund-time-query-v11',merchantScope:scope,normalizedPayload:{path:['refundedAt'],equals:refundedAt}}});assert.equal(event.state,'MANUAL');assert.equal((await db.channelReceipt.findUniqueOrThrow({where:{id:receipt.id}})).paidAt.toISOString(),paidAt.toISOString());});
  await t.test('verified notification supplies missing time without completing money and query can corroborate it',async()=>{
   const {createRefundNotificationTrigger}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/refund-notification-trigger.js`));
   const {trustedRefundCompletionTime}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/refund-period-evidence.js`));
   const binding={channel:'wechat',merchantScope:scope,providerConfigId:instruction.providerConfigId};
   const extra=await db.v11RefundInstruction.create({data:{...binding,receiptId:receipt.id,businessKey:prefix+'_notify',merchantRefundNo:prefix+'_notify',originalTradeNo:receipt.channelTradeNo,totalCents:20,serviceFeeCents:20,depositCents:0,state:'UNKNOWN'}});
   const callback={merchantRefundNo:extra.merchantRefundNo,channelRefundNo:prefix+'_notify-channel',originalTradeNo:extra.originalTradeNo,amountCents:20,eventId:prefix+'_notify-event',callbackNonce:'synthetic',refundedAt:time};
   const trigger=createRefundNotificationTrigger(db,binding,prefix+'_owner');await trigger(callback,'synthetic-cert');await trigger(callback,'synthetic-cert');
   assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:extra.id}})).state,'UNKNOWN');
   let events=await db.receivedEvent.findMany({where:{source:{in:['wechat-refund-time-query-v11','wechat-refund-time-notify-v11']},merchantScope:scope,eventKey:'REFUND_TIME:'+callback.channelRefundNo}});assert.equal(events.length,1);assert.equal(events[0].state,'APPLIED');
   const confirmed=await db.v11RefundInstruction.update({where:{id:extra.id},data:{state:'CONFIRMED',channelRefundNo:callback.channelRefundNo}});
   assert.equal(trustedRefundCompletionTime(confirmed,receipt,events).status,'TRUSTED');
   const {recordVerifiedRefundTime}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/refund-completion-time.js`));
   const fact={status:'SUCCEEDED',...callback,currency:'CNY'};await db.$transaction(tx=>recordVerifiedRefundTime(tx,confirmed,receipt,fact,prefix+'_owner'));
   events=await db.receivedEvent.findMany({where:{source:{in:['wechat-refund-time-query-v11','wechat-refund-time-notify-v11']},merchantScope:scope,eventKey:'REFUND_TIME:'+callback.channelRefundNo}});assert.equal(events.length,2);assert.equal(trustedRefundCompletionTime(confirmed,receipt,events).status,'TRUSTED');
   await trigger({...callback,refundedAt:new Date(Date.parse(time)+1000).toISOString()},'synthetic-cert');
   events=await db.receivedEvent.findMany({where:{source:{in:['wechat-refund-time-query-v11','wechat-refund-time-notify-v11']},merchantScope:scope,eventKey:{startsWith:'REFUND_TIME:'+callback.channelRefundNo}}});assert.equal(trustedRefundCompletionTime(confirmed,receipt,events).status,'CONFLICT');assert.ok(events.some(x=>x.state==='MANUAL'));
   assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:extra.id}})).state,'CONFIRMED');
  });
 }finally{await db.$disconnect();}
});
