import {trustedRefundCompletionTime} from './refund-period-evidence.js';
import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {PrismaClient,Prisma,ChannelReceipt} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {bindingFor} from '../funding/intents.js';
import type {ProviderEnv} from '../providers.js';
import {enqueue} from '../jobs/queue.js';
import {assertDownloadedTradeBill,type downloadWechatTradeBill} from './wechat-trade-bill.js';
import {parseWechatAllBill} from './wechat-bill-csv.js';
type Downloaded=Awaited<ReturnType<typeof downloadWechatTradeBill>>;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
function receiptProjection(row:ChannelReceipt & {v11ReceiptBinding_receiptId?:{intentId:string|null;registrationId:string|null}|null}){
 return {id:row.id,channel:row.channel,merchantScope:row.merchantScope,channelTradeNo:row.channelTradeNo,merchantOrderNo:row.merchantOrderNo,paymentId:row.paymentId,orderId:row.orderId,amountCents:row.amountCents,currency:row.currency,paidAt:row.paidAt,v11ReceiptBinding_receiptId:row.v11ReceiptBinding_receiptId?{intentId:row.v11ReceiptBinding_receiptId.intentId,registrationId:row.v11ReceiptBinding_receiptId.registrationId}:null};
}
const factBindings=new WeakMap<object,{binding:string;plan:object}>();
// Called inside the caller's consistent transaction. Never exports these facts
// to logs or audit metadata. Persistence uses the dedicated snapshot table.
export async function readBillComparisonFacts(tx:Prisma.TransactionClient,binding:ChannelBinding,plan:ReturnType<typeof createBillComparisonPlan>){
 if(planBindings.get(plan)!==JSON.stringify(binding)||binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(binding.merchantScope)||!binding.providerConfigId?.trim())throw Error('Explicit bill fact binding required');
  const intents=await tx.v11PaymentIntent.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope}});
  const receipts=await tx.channelReceipt.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope},include:{v11ReceiptBinding_receiptId:true}});
  const refunds=await tx.v11RefundInstruction.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope},include:{receipt:true}});
  const timeEvents=await tx.receivedEvent.findMany({where:{source:{in:['wechat-refund-time-query-v11','wechat-refund-time-notify-v11']},merchantScope:binding.merchantScope}});
  const refundTimes=new Map(refunds.filter(x=>x.state==='CONFIRMED').map(x=>[x.id,trustedRefundCompletionTime(x,x.receipt,timeEvents)]));
  const knownPayments=new Set(intents.map(x=>x.merchantOrderNo)),knownRefunds=new Set(refunds.map(x=>x.merchantRefundNo));
  const paymentKeys=[...new Set(plan.observations.filter(x=>x.inApplicationScope&&x.kind==='PAYMENT'&&!knownPayments.has(x.merchantOrderNo)).map(x=>x.merchantOrderNo))];
  const refundKeys=[...new Set(plan.observations.filter(x=>x.inApplicationScope&&x.kind==='REFUND'&&!knownRefunds.has(x.merchantRefundNo!)).map(x=>x.merchantRefundNo!))];
  const legacyPayments:Array<{merchantOrderNo:string}>=[],legacyRefunds:Array<{merchantRefundNo:string}>=[];
  // Bound each SQL parameter list; do not scan all merchant legacy history.
  for(let start=0;start<paymentKeys.length;start+=500)legacyPayments.push(...await tx.payment.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope,merchantOrderNo:{in:paymentKeys.slice(start,start+500)}},select:{merchantOrderNo:true},orderBy:{merchantOrderNo:'asc'}}));
  for(let start=0;start<refundKeys.length;start+=500)legacyRefunds.push(...await tx.refund.findMany({where:{channel:'wechat',merchantScope:binding.merchantScope,merchantRefundNo:{in:refundKeys.slice(start,start+500)}},select:{merchantRefundNo:true},orderBy:{merchantRefundNo:'asc'}}));
  const facts={intents:intents.map(row=>({id:row.id,registrationId:row.registrationId,channel:row.channel,merchantScope:row.merchantScope,merchantOrderNo:row.merchantOrderNo,providerConfigId:row.providerConfigId,totalCents:row.totalCents})),receipts:receipts.map(receiptProjection),refunds:refunds.map(row=>({id:row.id,channel:row.channel,merchantScope:row.merchantScope,merchantRefundNo:row.merchantRefundNo,providerConfigId:row.providerConfigId,totalCents:row.totalCents,serviceFeeCents:row.serviceFeeCents,depositCents:row.depositCents,originalTradeNo:row.originalTradeNo,state:row.state,channelRefundNo:row.channelRefundNo,receipt:receiptProjection(row.receipt)})),refundTimes,legacyPayments,legacyRefunds};factBindings.set(facts,{binding:JSON.stringify(binding),plan});return facts;
}

const plans=new WeakSet<object>();
const planBindings=new WeakMap<object,string>();
export function createBillComparisonPlan(bill:Downloaded,env:ProviderEnv){
 assertDownloadedTradeBill(bill);
 if(JSON.stringify(bindingFor(env,'wechat'))!==JSON.stringify(bill.binding))throw Error('Bill plan binding conflict');
 const parsed=parseWechatAllBill(bill.rawBill,{billDate:bill.billDate,merchantId:env.WECHAT_PAY_MCH_ID!,appId:env.WECHAT_MINIAPP_APP_ID!});
 for(const observation of parsed.observations)Object.freeze(observation);
 Object.freeze(parsed.observations);Object.freeze(parsed);plans.add(parsed);planBindings.set(parsed,JSON.stringify(bill.binding));return parsed;
}
export type BillComparisonRange={phase:'FORWARD'|'REVERSE_RECEIPTS'|'REVERSE_REFUNDS';start:number;end:number};
// Writes observation/case/query-only results. Does not write money, final
// snapshots or checkpoints. The caller must commit the page's progress atomically.
export async function executeBillComparisonCore(tx:Prisma.TransactionClient,bill:Downloaded,owner:string,runId:string,binding:ChannelBinding,parsed:ReturnType<typeof createBillComparisonPlan>,facts:Awaited<ReturnType<typeof readBillComparisonFacts>>,range?:BillComparisonRange){
 assertDownloadedTradeBill(bill);
 if(!plans.has(parsed)||factBindings.get(facts)?.binding!==JSON.stringify(binding)||factBindings.get(facts)?.plan!==parsed||JSON.stringify(binding)!==JSON.stringify(bill.binding)||!owner.trim()||owner.length>160||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw Error('Trusted bill comparison context required');
 const at=new Date(bill.billDate+'T00:00:00+08:00'),until=new Date(at.getTime()+86400000);
 const {intents,receipts,refunds,refundTimes,legacyPayments,legacyRefunds}=facts;
 if(range){
  const length=range.phase==='FORWARD'?parsed.observations.length:range.phase==='REVERSE_RECEIPTS'?receipts.filter(x=>x.paidAt&&x.paidAt>=at&&x.paidAt<until).length:range.phase==='REVERSE_REFUNDS'?refunds.filter(x=>x.state==='CONFIRMED').length:-1;
  if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.end<=range.start||range.end>length)throw Error('Invalid bill comparison page');
 }
 const legacyPaymentKeys=new Set(legacyPayments.map(x=>x.merchantOrderNo)),legacyRefundKeys=new Set(legacyRefunds.map(x=>x.merchantRefundNo));
  const intentByOrder=new Map(intents.map(row=>[row.merchantOrderNo,row]));
  const refundByMerchantNo=new Map(refunds.map(row=>[row.merchantRefundNo,row]));
  const receiptByTrade=new Map(receipts.map(row=>[row.channelTradeNo,row]));
  const receiptsByOrder=new Map<string,typeof receipts>();for(const row of receipts)receiptsByOrder.set(row.merchantOrderNo,[...(receiptsByOrder.get(row.merchantOrderNo)??[]),row]);
  const caseIds=new Set<string>();
  const stats={runId,billDate:bill.billDate,totalBillRows:parsed.totalRows,outsideApplicationRows:parsed.outsideApplicationRows,
   applicationPaymentRows:0,applicationRefundRows:0,legacyRows:0,differences:0,paymentQueriesQueued:0,refundQueriesQueued:0,
   recordedPaymentRowsInPeriod:0,confirmedRefundsWithoutTrustedPeriod:[...refundTimes.values()].filter(x=>x.status!=='TRUSTED').length,
   confirmedRefundsInPeriod:0,refundTimeConflicts:[...refundTimes.values()].filter(x=>x.status==='CONFLICT').length,
   scope:'BILL_AND_RECORDED_FUNDS_SNAPSHOT',coverageState:'INCOMPLETE',refundPeriodCoverage:[...refundTimes.values()].some(x=>x.status!=='TRUSTED')?'UNRESOLVED':'OBSERVED',releaseAuthorized:false};
  const paymentJobs=new Set<string>(),refundJobs=new Set<string>();
  const difference=async(category:string,reference:string)=>{stats.differences++;const row=await tx.financialCase.upsert({where:{caseKey:category+':'+hash([runId,reference])},update:{},create:{caseKey:category+':'+hash([runId,reference]),category,sourceRef:reference,owner,deadline:new Date(Date.now()+24*60*60*1000)}});caseIds.add(row.id);};
  const queuePayment=async(intent:typeof intents[number])=>{if(intent.providerConfigId!==binding.providerConfigId){await difference('V11_BILL_PROVIDER_BINDING_CONFLICT',intent.id);return;}if(paymentJobs.has(intent.id))return;paymentJobs.add(intent.id);await enqueue(tx,'V11_QUERY_PAYMENT',`v11:bill-query:${runId}:payment:${intent.id}`,intent.id);};
  const queueRefund=async(refund:typeof refunds[number])=>{if(refund.providerConfigId!==binding.providerConfigId){await difference('V11_BILL_PROVIDER_BINDING_CONFLICT',refund.id);return;}if(refundJobs.has(refund.id))return;refundJobs.add(refund.id);await enqueue(tx,'V11_QUERY_REFUND',`v11:bill-query:${runId}:refund:${refund.id}`,refund.id);};
  const scoped=parsed.observations.filter(x=>x.inApplicationScope);
  for(const [index,observation] of parsed.observations.entries()){
   if(!observation.inApplicationScope||(range&&(range.phase!=='FORWARD'||index<range.start||index>=range.end)))continue;
   const eventKey=`BILL:${bill.sourceSha256}:${index}`;
   const payload={...observation,scope:'BILL_OBSERVATION_ONLY',billDate:bill.billDate};
   const payloadHash=hash(payload);
   const event=await tx.receivedEvent.upsert({where:{source_merchantScope_eventKey:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey}},update:{},create:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey,payloadHash,normalizedPayload:payload,verificationMaterialId:binding.providerConfigId,verifiedAt:new Date(bill.verifiedAt),state:'MANUAL'}});
   if(event.payloadHash!==payloadHash||event.state!=='MANUAL')throw Error('Bill observation identity conflict');
   if(observation.kind==='PAYMENT'){
    stats.applicationPaymentRows++;
    const intent=intentByOrder.get(observation.merchantOrderNo);
    if(!intent){const legacy=legacyPaymentKeys.has(observation.merchantOrderNo);if(legacy)stats.legacyRows++;else await difference('V11_BILL_PAYMENT_WITHOUT_INTENT',event.id);continue;}
    await queuePayment(intent);
    if(intent.totalCents!==observation.amountCents)await difference('V11_BILL_PAYMENT_AMOUNT_CONFLICT',intent.id);
    const byTrade=receiptByTrade.get(observation.channelTradeNo);const matched=[...new Map([...(receiptsByOrder.get(observation.merchantOrderNo)??[]),...(byTrade?[byTrade]:[])].map(x=>[x.id,x])).values()];
    if(!matched.length)await difference('V11_BILL_PAYMENT_RECEIPT_MISSING',intent.id);
    else if(matched.length!==1||matched.some(x=>x.channelTradeNo!==observation.channelTradeNo||x.merchantOrderNo!==observation.merchantOrderNo
     ||x.amountCents!==observation.amountCents||x.currency!=='CNY'||x.paidAt?.getTime()!==Date.parse(observation.observedAt)||x.paymentId||x.orderId
     ||(x.v11ReceiptBinding_receiptId&&(x.v11ReceiptBinding_receiptId.intentId!==intent.id||x.v11ReceiptBinding_receiptId.registrationId!==intent.registrationId))))await difference('V11_BILL_PAYMENT_RECEIPT_CONFLICT',intent.id);
   }else{
    stats.applicationRefundRows++;
    const refund=refundByMerchantNo.get(observation.merchantRefundNo!);
    if(!refund){const legacy=legacyRefundKeys.has(observation.merchantRefundNo!);if(legacy)stats.legacyRows++;else await difference('V11_BILL_REFUND_WITHOUT_INSTRUCTION',event.id);continue;}
    await queueRefund(refund);
    if(refund.totalCents!==observation.amountCents||refund.originalTradeNo!==observation.channelTradeNo||refund.receipt.channelTradeNo!==observation.channelTradeNo
     ||refund.receipt.merchantOrderNo!==observation.merchantOrderNo||refund.receipt.merchantScope!==binding.merchantScope||refund.receipt.channel!=='wechat'
     ||(refund.channelRefundNo&&refund.channelRefundNo!==observation.channelRefundNo)||refund.totalCents!==refund.serviceFeeCents+refund.depositCents)
     await difference('V11_BILL_REFUND_FACT_CONFLICT',refund.id);
    else if(refund.state!=='CONFIRMED'||!refund.channelRefundNo)await difference('V11_BILL_REFUND_LOCAL_UNCONFIRMED',refund.id);
    const time=refundTimes.get(refund.id);if(time?.status==='TRUSTED'&&time.refundedAt!==observation.observedAt)await difference('V11_BILL_REFUND_TIME_CONFLICT',refund.id);
   }
  }
  const billPaymentKeys=new Set(scoped.filter(x=>x.kind==='PAYMENT').map(x=>JSON.stringify([x.channelTradeNo,x.merchantOrderNo])));
  for(const [index,receipt] of receipts.filter(x=>x.paidAt&&x.paidAt>=at&&x.paidAt<until).entries()){
   if(range&&(range.phase!=='REVERSE_RECEIPTS'||index<range.start||index>=range.end))continue;
   const intent=intentByOrder.get(receipt.merchantOrderNo);
   if(!intent){if(receipt.v11ReceiptBinding_receiptId)await difference('V11_BILL_LOCAL_RECEIPT_WITHOUT_INTENT',receipt.id);continue;}
   stats.recordedPaymentRowsInPeriod++;
   if(!billPaymentKeys.has(JSON.stringify([receipt.channelTradeNo,receipt.merchantOrderNo]))){
    await difference('V11_BILL_LOCAL_PAYMENT_ABSENT',receipt.id);await queuePayment(intent);
   }
  }
  const billRefunds=new Map(scoped.filter(x=>x.kind==='REFUND').map(x=>[x.merchantRefundNo,x]));
  for(const [index,refund] of refunds.filter(x=>x.state==='CONFIRMED').entries()){
   if(range&&(range.phase!=='REVERSE_REFUNDS'||index<range.start||index>=range.end))continue;
   const time=refundTimes.get(refund.id)!;
   if(time.status!=='TRUSTED'){
    await difference(time.status==='MISSING'?'V11_BILL_REFUND_PERIOD_UNKNOWN':'V11_BILL_REFUND_PERIOD_CONFLICT',refund.id);await queueRefund(refund);continue;
   }
   const completedAt=new Date(time.refundedAt);
   if(completedAt<at||completedAt>=until)continue;
   stats.confirmedRefundsInPeriod++;
   const row=billRefunds.get(refund.merchantRefundNo);
   if(!row||row.channelRefundNo!==refund.channelRefundNo||row.channelTradeNo!==refund.originalTradeNo||row.amountCents!==refund.totalCents||row.observedAt!==time.refundedAt){
    await difference('V11_BILL_LOCAL_REFUND_ABSENT_OR_CONFLICT',refund.id);await queueRefund(refund);
   }
  }
  stats.paymentQueriesQueued=paymentJobs.size;stats.refundQueriesQueued=refundJobs.size;
  return {stats,caseIds:[...caseIds],queryRefs:{payment:[...paymentJobs],refund:[...refundJobs]}};
}

const refSchema=z.string().min(1).max(160);
const centsSchema=z.number().int().nonnegative().max(2147483647);
const receiptSchema=z.object({id:refSchema,channel:refSchema,merchantScope:refSchema,channelTradeNo:refSchema,merchantOrderNo:refSchema,paymentId:refSchema.nullable(),orderId:refSchema.nullable(),amountCents:centsSchema,currency:refSchema,paidAt:z.string().datetime({offset:true}).transform(value=>new Date(value)).nullable(),v11ReceiptBinding_receiptId:z.object({intentId:refSchema.nullable(),registrationId:refSchema.nullable()}).strict().nullable()}).strict();
const intentSchema=z.object({id:refSchema,registrationId:refSchema,channel:refSchema,merchantScope:refSchema,merchantOrderNo:refSchema,providerConfigId:refSchema,totalCents:centsSchema}).strict();
const refundSchema=z.object({id:refSchema,channel:refSchema,merchantScope:refSchema,merchantRefundNo:refSchema,providerConfigId:refSchema,totalCents:centsSchema,serviceFeeCents:centsSchema,depositCents:centsSchema,originalTradeNo:refSchema,state:refSchema,channelRefundNo:refSchema.nullable(),receipt:receiptSchema}).strict();
const timeSchema=z.discriminatedUnion('status',[z.object({status:z.literal('MISSING')}).strict(),z.object({status:z.literal('CONFLICT')}).strict(),z.object({status:z.literal('TRUSTED'),refundedAt:z.string().datetime({offset:true}),eventId:refSchema}).strict()]);
const snapshotSchema=z.object({version:z.literal('v11-bill-facts-1'),intents:z.array(intentSchema).max(100000),receipts:z.array(receiptSchema).max(100000),refunds:z.array(refundSchema).max(100000),refundTimes:z.array(z.tuple([refSchema,timeSchema])).max(100000),legacyPayments:z.array(z.object({merchantOrderNo:refSchema}).strict()).max(100000),legacyRefunds:z.array(z.object({merchantRefundNo:refSchema}).strict()).max(100000)}).strict();
function snapshotPayload(facts:Awaited<ReturnType<typeof readBillComparisonFacts>>){
 const payload=JSON.parse(JSON.stringify({version:'v11-bill-facts-1',...facts,refundTimes:[...facts.refundTimes]})) as Prisma.InputJsonObject;
 if(Buffer.byteLength(JSON.stringify(payload))>32*1024*1024)throw Error('Bill fact snapshot capacity exceeded');
 return payload;
}
function restoreFacts(payload:unknown,binding:ChannelBinding,plan:ReturnType<typeof createBillComparisonPlan>){
 const decoded=snapshotSchema.parse(payload);
 for(const rows of [decoded.intents,decoded.receipts,decoded.refunds]){
  if(new Set(rows.map(x=>x.id)).size!==rows.length||rows.some(x=>x.channel!=='wechat'||x.merchantScope!==binding.merchantScope))throw Error('Bill fact snapshot scope conflict');
 }
 const refundTimes=new Map(decoded.refundTimes);
 const confirmed=decoded.refunds.filter(x=>x.state==='CONFIRMED').map(x=>x.id).sort();
 if(refundTimes.size!==decoded.refundTimes.length||JSON.stringify([...refundTimes.keys()].sort())!==JSON.stringify(confirmed))throw Error('Bill fact snapshot time coverage conflict');
 const facts={intents:decoded.intents,receipts:decoded.receipts,refunds:decoded.refunds,refundTimes,legacyPayments:decoded.legacyPayments,legacyRefunds:decoded.legacyRefunds};
 factBindings.set(facts,{binding:JSON.stringify(binding),plan});return facts;
}
function snapshotIdentity(bill:Downloaded,env:ProviderEnv,owner:string,releaseVersion:string,runId:string){
 const plan=createBillComparisonPlan(bill,env),binding=bindingFor(env,'wechat');
 if(!owner.trim()||owner.length>160||!releaseVersion.trim()||releaseVersion.length>160||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw Error('Explicit bill snapshot identity required');
 const identity={version:'v11-bill-facts-1',merchantScope:binding.merchantScope,providerConfigId:binding.providerConfigId,billDate:bill.billDate,sourceSha256:bill.sourceSha256,owner,releaseVersion,totalRows:plan.totalRows,outsideRows:plan.outsideApplicationRows};
 return {plan,binding,identity,identityHash:hash(identity)};
}
function checkSnapshot(row:Awaited<ReturnType<Prisma.TransactionClient['v11BillComparisonSnapshot']['findUniqueOrThrow']>>,context:ReturnType<typeof snapshotIdentity>){
 const {identity,identityHash,binding}=context;
 if(row.identityHash!==identityHash||Object.entries(identity).some(([key,value])=>key!=='version'&&(row as unknown as Record<string,unknown>)[key]!==value)||row.snapshotHash!==hash(row.snapshot))throw Error('Bill snapshot recovery identity or integrity conflict');
 return restoreFacts(row.snapshot,binding,context.plan);
}
// The table stores minimal financial projections; no raw CSV, prepay identifiers,
// phone/openid, credentials or source time-event bodies enter snapshot/audit logs.
export async function ensureBillComparisonSnapshot(db:PrismaClient,env:ProviderEnv,bill:Downloaded,owner:string,releaseVersion:string,runId:string){
 const context=snapshotIdentity(bill,env,owner,releaseVersion,runId);
 for(let attempt=0;attempt<3;attempt++)try{
  return await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-run:${runId}`},0))`;
   const final=await tx.auditLog.findFirst({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId},select:{metadata:true}});
   const existing=await tx.v11BillComparisonSnapshot.findUnique({where:{id:runId}});
   if(final){const metadata=final.metadata as unknown as {identity?:{comparisonVersion?:string};pageCoverage?:{snapshotHash?:string}};if(!existing||metadata.identity?.comparisonVersion!=='v11-bill-snapshot-4'||metadata.pageCoverage?.snapshotHash!==existing.snapshotHash)throw Error('Legacy bill run cannot become a snapshot task');}
   if(existing){checkSnapshot(existing,context);return {snapshotId:runId,snapshotHash:existing.snapshotHash,capturedAt:existing.capturedAt};}
   const captured=await readBillComparisonFacts(tx,context.binding,context.plan),payload=snapshotPayload(captured);
   restoreFacts(payload,context.binding,context.plan);
   const {version,...identity}=context.identity;
   const row=await tx.v11BillComparisonSnapshot.create({data:{id:runId,...identity,identityHash:context.identityHash,snapshot:payload,snapshotHash:hash(payload)}});
   await tx.auditLog.create({data:{action:'funding.v11-bill-comparison-facts-captured',targetType:'V11BillComparisonSnapshot',targetId:runId,metadata:{version,identityHash:context.identityHash,snapshotHash:row.snapshotHash,totalRows:identity.totalRows,scope:'CAPTURE_ONLY_NO_COMPARISON_OR_RELEASE',releaseAuthorized:false}}});
   return {snapshotId:runId,snapshotHash:row.snapshotHash,capturedAt:row.capturedAt};
  },{isolationLevel:'Serializable',timeout:30000});
 }catch(error){if(attempt===2||!(error&&typeof error==='object'&&'code'in error&&['P2034','P2002'].includes(String(error.code))))throw error;}
 throw Error('Bill fact snapshot unavailable');
}
export async function loadBillComparisonSnapshot(tx:Prisma.TransactionClient,env:ProviderEnv,bill:Downloaded,owner:string,releaseVersion:string,runId:string){
 const context=snapshotIdentity(bill,env,owner,releaseVersion,runId);
 const row=await tx.v11BillComparisonSnapshot.findUniqueOrThrow({where:{id:runId}});
 const facts=checkSnapshot(row,context);
 return {plan:context.plan,binding:context.binding,facts,snapshotHash:row.snapshotHash,capturedAt:row.capturedAt};
}
