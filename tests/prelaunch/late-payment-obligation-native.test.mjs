import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {createPaymentQueryIntake}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/payment-query-intake.js`));
const {createPaymentReceiptLedger}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/payment-receipt-ledger.js`));
const {createReceiptAllocator}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/receipt-allocation.js`));
const {createLatePaymentRefundObligation}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/late-payment-refund-obligation.js`));
test('known late full-refund obligation survives without policy activation or refund submission',async t=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);const prefix='late_due_'+randomUUID(),owner=prefix+'_owner';
 try{
  const sample=await db.v11Registration.findFirstOrThrow(),consent=await db.v11BundleConsent.findUniqueOrThrow({where:{id:sample.consentId}}),scope=createHash('sha256').update(prefix).digest('hex');
  const user=await db.user.create({data:{wechatOpenid:'mock_'+prefix}}),newConsent=await db.v11BundleConsent.create({data:{...consent,id:prefix+'_consent',userId:user.id}});
  const now=(await db.$queryRaw`SELECT clock_timestamp() AS now`)[0].now.getTime(),acceptedAt=new Date(now-1200000),expiresAt=new Date(acceptedAt.getTime()+600000);
  async function setup(suffix,paidAt,expired=true){
   const reg=await db.v11Registration.create({data:{...sample,id:prefix+suffix,userId:user.id,consentId:newConsent.id,category:'ORDINARY',serviceFeeCents:40,depositCents:60,acceptedAt,active:!expired,eligibilityState:expired?'EXPIRED':'PENDING_PAYMENT',paidEffectiveAt:null}});
   await db.v11SeatHold.create({data:{registrationId:reg.id,expiresAt,state:expired?'EXPIRED':'HELD',releasedAt:expired?expiresAt:null}});
   const intent=await db.v11PaymentIntent.create({data:{registrationId:reg.id,channel:'wechat',merchantScope:scope,providerConfigId:'synthetic-late',merchantOrderNo:prefix+suffix,totalCents:100,active:false,state:'CLOSED'}});
   const channel={assertBinding:()=>{},queryPayment:async()=>({status:'SUCCEEDED',merchantOrderNo:intent.merchantOrderNo,channelTradeNo:prefix+suffix+'_trade',amountCents:100,currency:'CNY',paidAt:paidAt.toISOString()})};
   const fact=await createPaymentQueryIntake(db,channel)(intent.id),recorded=await createPaymentReceiptLedger(db,channel)(fact.eventId);await createReceiptAllocator(db,channel)(recorded.receiptId,intent.id);
   return {reg,intent,receiptId:recorded.receiptId,record:createLatePaymentRefundObligation(db,channel,owner)};
  }
  const late=await setup('_late',expiresAt);
  await t.test('exact ten-minute boundary records full F+D idempotently without changing qualification or budgets',async()=>{
   const outcomes=await Promise.all([late.record(late.receiptId,late.intent.id),late.record(late.receiptId,late.intent.id)]);assert.deepEqual(outcomes[0],outcomes[1]);assert.equal(outcomes[0].kind,'OBLIGATION_RECORDED');
   const event=await db.receivedEvent.findUniqueOrThrow({where:{id:outcomes[0].eventId}});assert.equal(event.normalizedPayload.F,40);assert.equal(event.normalizedPayload.D,60);assert.equal(event.normalizedPayload.totalCents,100);assert.equal(event.normalizedPayload.execution,'PENDING_FORMAL_DISPATCH_AUTHORITY');
   assert.equal(await db.auditLog.count({where:{action:'funding.v11-late-full-refund-obligation',targetId:event.id}}),1);assert.equal(await db.financialCase.count({where:{category:'V11_LATE_PAYMENT_FULL_REFUND_DUE',sourceRef:event.id}}),1);
   assert.equal(await db.v11RefundInstruction.count({where:{registrationId:late.reg.id}}),0);assert.equal(await db.v11Disposition.count({where:{component:{receiptId:late.receiptId}}}),0);assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:late.reg.id}})).eligibilityState,'EXPIRED');
  });
  await t.test('timely paidAt cannot undo previously expired UNKNOWN hold and subsequent confirmation',async()=>{const timely=await setup('_timely-late-confirm',new Date(expiresAt.getTime()-1));assert.equal((await timely.record(timely.receiptId,timely.intent.id)).kind,'OBLIGATION_RECORDED');});
  await t.test('timely payment without released-expired qualification does not create a refund obligation',async()=>{const timely=await setup('_timely',new Date(expiresAt.getTime()-1),false);assert.equal((await timely.record(timely.receiptId,timely.intent.id)).kind,'NOT_LATE');});
  await t.test('manual receipt evidence fails before obligation evidence is written',async()=>{const other=await setup('_corrupt',expiresAt),receipt=await db.channelReceipt.findUniqueOrThrow({where:{id:other.receiptId}});await db.receivedEvent.updateMany({where:{source:'wechat-query-v11',payloadHash:receipt.evidenceHash},data:{state:'MANUAL'}});await assert.rejects(()=>other.record(other.receiptId,other.intent.id),/evidence unavailable/);assert.equal(await db.receivedEvent.count({where:{source:'wechat-late-refund-obligation-v11',eventKey:'LATE_REFUND:'+other.receiptId}}),0);});
 }finally{await db.$disconnect();}
});
