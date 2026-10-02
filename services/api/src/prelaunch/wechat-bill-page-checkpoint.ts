import {createHash} from 'node:crypto';
import {z} from 'zod';
import type {PrismaClient,Prisma,V11BillComparisonPage} from '../generated/prisma/client.js';
import type {ProviderEnv} from '../providers.js';
import type {downloadWechatTradeBill} from './wechat-trade-bill.js';
import {ensureBillComparisonSnapshot,loadBillComparisonSnapshot,executeBillComparisonCore,type BillComparisonRange} from './wechat-bill-comparison-core.js';
type Bill=Awaited<ReturnType<typeof downloadWechatTradeBill>>;
type Loaded=Awaited<ReturnType<typeof loadBillComparisonSnapshot>>;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
const count=z.number().int().nonnegative().max(1000000);
function retryableTransaction(error:unknown){
 if(!error||typeof error!=='object'||!('code'in error))return false;
 if(['P2034','P2002'].includes(String(error.code)))return true;
 if(error.code!=='P2010'||!('meta'in error)||!error.meta||typeof error.meta!=='object')return false;
 if('code'in error.meta&&['40001','40P01'].includes(String(error.meta.code)))return true;
 if(!('driverAdapterError'in error.meta))return false;
 const adapter=error.meta.driverAdapterError;
 if(!adapter||typeof adapter!=='object'||!('cause'in adapter))return false;
 const cause=adapter.cause;
 return !!cause&&typeof cause==='object'&&'originalCode'in cause&&['40001','40P01'].includes(String(cause.originalCode));
}
const resultSchema=z.object({runId:z.string(),billDate:z.string(),totalBillRows:count,outsideApplicationRows:count,applicationPaymentRows:count,applicationRefundRows:count,legacyRows:count,differences:count,paymentQueriesQueued:count,refundQueriesQueued:count,recordedPaymentRowsInPeriod:count,confirmedRefundsWithoutTrustedPeriod:count,confirmedRefundsInPeriod:count,refundTimeConflicts:count,scope:z.literal('BILL_AND_RECORDED_FUNDS_SNAPSHOT'),coverageState:z.literal('INCOMPLETE'),refundPeriodCoverage:z.enum(['UNRESOLVED','OBSERVED']),releaseAuthorized:z.literal(false)}).strict();
function validateRange(bill:Bill,loaded:Loaded,range:BillComparisonRange){
 const at=Date.parse(bill.billDate+'T00:00:00+08:00'),until=at+86400000;
 const length=range.phase==='FORWARD'?loaded.plan.observations.length:range.phase==='REVERSE_RECEIPTS'?loaded.facts.receipts.filter(x=>x.paidAt&&x.paidAt.getTime()>=at&&x.paidAt.getTime()<until).length:range.phase==='REVERSE_REFUNDS'?loaded.facts.refunds.filter(x=>x.state==='CONFIRMED').length:-1;
 if(!Number.isSafeInteger(range.start)||!Number.isSafeInteger(range.end)||range.start<0||range.start%500!==0||range.start>=length||range.end!==Math.min(range.start+500,length))throw Error('Invalid fixed comparison page');
}
function expectedRanges(bill:Bill,loaded:Loaded){
 const at=Date.parse(bill.billDate+'T00:00:00+08:00'),until=at+86400000;
 const lengths={FORWARD:loaded.plan.observations.length,REVERSE_RECEIPTS:loaded.facts.receipts.filter(x=>x.paidAt&&x.paidAt.getTime()>=at&&x.paidAt.getTime()<until).length,REVERSE_REFUNDS:loaded.facts.refunds.filter(x=>x.state==='CONFIRMED').length};
 const ranges:BillComparisonRange[]=[];
 for(const phase of ['FORWARD','REVERSE_RECEIPTS','REVERSE_REFUNDS'] as const)for(let start=0;start<lengths[phase];start+=500)ranges.push({phase,start,end:Math.min(start+500,lengths[phase])});
 return {lengths,ranges};
}
function content(row:{snapshotHash:string;phase:string;start:number;end:number;result:unknown;caseIds:string[];paymentQueryRefs:string[];refundQueryRefs:string[]}){return {version:'v11-bill-page-1',snapshotHash:row.snapshotHash,phase:row.phase,start:row.start,end:row.end,result:row.result,caseIds:row.caseIds,paymentQueryRefs:row.paymentQueryRefs,refundQueryRefs:row.refundQueryRefs};}
async function checkPage(tx:Prisma.TransactionClient,bill:Bill,loaded:Loaded,runId:string,range:BillComparisonRange,row:V11BillComparisonPage){
 const result=resultSchema.parse(row.result);
 if(row.snapshotId!==runId||row.phase!==range.phase||row.start!==range.start||row.end!==range.end||row.snapshotHash!==loaded.snapshotHash||row.contentHash!==hash(content(row))||result.runId!==runId||result.billDate!==bill.billDate||result.totalBillRows!==loaded.plan.totalRows||result.outsideApplicationRows!==loaded.plan.outsideApplicationRows||new Set(row.caseIds).size!==row.caseIds.length||row.caseIds.length>result.differences)throw Error('Comparison checkpoint integrity conflict');
 if(row.caseIds.length>2000||row.paymentQueryRefs.length>500||row.refundQueryRefs.length>500||[...row.caseIds,...row.paymentQueryRefs,...row.refundQueryRefs].some(x=>!x||x.length>160)||result.differences>(range.end-range.start)*4||result.recordedPaymentRowsInPeriod>range.end-range.start||result.confirmedRefundsInPeriod>range.end-range.start||result.legacyRows>result.applicationPaymentRows+result.applicationRefundRows)throw Error('Comparison checkpoint bounds conflict');
 const times=[...loaded.facts.refundTimes.values()];
 if(result.confirmedRefundsWithoutTrustedPeriod!==times.filter(x=>x.status!=='TRUSTED').length||result.refundTimeConflicts!==times.filter(x=>x.status==='CONFLICT').length||result.refundPeriodCoverage!==(times.some(x=>x.status!=='TRUSTED')?'UNRESOLVED':'OBSERVED'))throw Error('Comparison checkpoint coverage conflict');
 const observations=range.phase==='FORWARD'?loaded.plan.observations.slice(range.start,range.end).map((observation,index)=>({observation,index:range.start+index})).filter(x=>x.observation.inApplicationScope):[];
 if(result.applicationPaymentRows!==observations.filter(x=>x.observation.kind==='PAYMENT').length||result.applicationRefundRows!==observations.filter(x=>x.observation.kind==='REFUND').length||(range.phase!=='REVERSE_RECEIPTS'&&result.recordedPaymentRowsInPeriod!==0)||(range.phase!=='REVERSE_REFUNDS'&&result.confirmedRefundsInPeriod!==0))throw Error('Comparison checkpoint phase conflict');
 if(row.caseIds.length){
  const cases=await tx.financialCase.findMany({where:{id:{in:row.caseIds}},select:{id:true,category:true,sourceRef:true,caseKey:true}});
  if(cases.length!==row.caseIds.length||cases.some(x=>!x.category.startsWith('V11_BILL_')||x.caseKey!==x.category+':'+hash([runId,x.sourceRef])))throw Error('Comparison checkpoint case evidence missing');
 }
 if(new Set(row.paymentQueryRefs).size!==row.paymentQueryRefs.length||new Set(row.refundQueryRefs).size!==row.refundQueryRefs.length||result.paymentQueriesQueued!==row.paymentQueryRefs.length||result.refundQueriesQueued!==row.refundQueryRefs.length)throw Error('Comparison checkpoint query count conflict');
 const expectedQueries=[...row.paymentQueryRefs.map(refId=>({refId,kind:'V11_QUERY_PAYMENT',businessKey:`v11:bill-query:${runId}:payment:${refId}`})),...row.refundQueryRefs.map(refId=>({refId,kind:'V11_QUERY_REFUND',businessKey:`v11:bill-query:${runId}:refund:${refId}`}))];
 if(expectedQueries.length){const jobs=await tx.durableJob.findMany({where:{businessKey:{in:expectedQueries.map(x=>x.businessKey)}},select:{refId:true,kind:true,businessKey:true}});if(jobs.length!==expectedQueries.length||expectedQueries.some(x=>!jobs.some(j=>j.businessKey===x.businessKey&&j.refId===x.refId&&j.kind===x.kind)))throw Error('Comparison checkpoint query evidence missing');}
 if(observations.length){
  const expected=new Map(observations.map(({observation,index})=>{const eventKey=`BILL:${bill.sourceSha256}:${index}`;return [eventKey,hash({...observation,scope:'BILL_OBSERVATION_ONLY',billDate:bill.billDate})];}));
  const events=await tx.receivedEvent.findMany({where:{source:'wechat-bill-observation-v11',merchantScope:loaded.binding.merchantScope,eventKey:{in:[...expected.keys()]}},select:{eventKey:true,payloadHash:true,normalizedPayload:true,state:true,verificationMaterialId:true}});
  if(events.length!==expected.size||events.some(x=>x.state!=='MANUAL'||x.verificationMaterialId!==loaded.binding.providerConfigId||x.payloadHash!==expected.get(x.eventKey)||hash(x.normalizedPayload)!==x.payloadHash))throw Error('Comparison checkpoint observation evidence missing');
 }
 return result;
}
// Internal privileged DB orchestration only. No new HTTP endpoint or funds I/O.
// Fixed 500-row pages; writes and checkpoint share one Serializable transaction.
export async function commitBillComparisonPage(db:PrismaClient,env:ProviderEnv,bill:Bill,owner:string,releaseVersion:string,runId:string,range:BillComparisonRange){
 for(let attempt=0;attempt<3;attempt++)try{
  return await db.$transaction(async tx=>{
   await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-run:${runId}`},0))`;
   const loaded=await loadBillComparisonSnapshot(tx,env,bill,owner,releaseVersion,runId);validateRange(bill,loaded,range);
   const key={snapshotId:runId,phase:range.phase,start:range.start};
   const existing=await tx.v11BillComparisonPage.findUnique({where:{snapshotId_phase_start:key}});
   if(existing){await checkPage(tx,bill,loaded,runId,range,existing);return {status:'RESUMED',phase:range.phase,start:range.start,end:range.end,releaseAuthorized:false};}
   const output=await executeBillComparisonCore(tx,bill,owner,runId,loaded.binding,loaded.plan,loaded.facts,range);
   const body={snapshotHash:loaded.snapshotHash,phase:range.phase,start:range.start,end:range.end,result:output.stats,caseIds:output.caseIds,paymentQueryRefs:output.queryRefs.payment,refundQueryRefs:output.queryRefs.refund};
   const row=await tx.v11BillComparisonPage.create({data:{snapshotId:runId,...body,contentHash:hash(content(body))}});
   await checkPage(tx,bill,loaded,runId,range,row);
   return {status:'COMMITTED',phase:range.phase,start:range.start,end:range.end,releaseAuthorized:false};
  },{isolationLevel:'Serializable',timeout:30000});
 }catch(error){if(attempt===2||!retryableTransaction(error))throw error;}
 throw Error('Comparison page unavailable');
}

// Complete coverage of the pinned comparison input is distinct from reconciled
// funds or release authority. Final evidence always remains INCOMPLETE.
export async function finalizeBillComparisonPages(db:PrismaClient,env:ProviderEnv,bill:Bill,owner:string,releaseVersion:string,runId:string){
 for(let attempt=0;attempt<3;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-run:${runId}`},0))`;
  const loaded=await loadBillComparisonSnapshot(tx,env,bill,owner,releaseVersion,runId),{lengths,ranges}=expectedRanges(bill,loaded);
  const pages=await tx.v11BillComparisonPage.findMany({where:{snapshotId:runId}});
  if(pages.length!==ranges.length)throw Error('Bill comparison pages incomplete');
  const times=[...loaded.facts.refundTimes.values()];
  const result={runId,billDate:bill.billDate,totalBillRows:loaded.plan.totalRows,outsideApplicationRows:loaded.plan.outsideApplicationRows,applicationPaymentRows:0,applicationRefundRows:0,legacyRows:0,differences:0,paymentQueriesQueued:0,refundQueriesQueued:0,recordedPaymentRowsInPeriod:0,confirmedRefundsWithoutTrustedPeriod:times.filter(x=>x.status!=='TRUSTED').length,confirmedRefundsInPeriod:0,refundTimeConflicts:times.filter(x=>x.status==='CONFLICT').length,scope:'BILL_AND_RECORDED_FUNDS_SNAPSHOT',coverageState:'INCOMPLETE',refundPeriodCoverage:times.some(x=>x.status!=='TRUSTED')?'UNRESOLVED':'OBSERVED',releaseAuthorized:false};
  const cases=new Set<string>(),payment=new Set<string>(),refund=new Set<string>(),manifest:Array<{phase:string;start:number;end:number;contentHash:string}>=[];
  const sumKeys=['applicationPaymentRows','applicationRefundRows','legacyRows','differences','recordedPaymentRowsInPeriod','confirmedRefundsInPeriod'] as const;
  for(const range of ranges){
   const page=pages.find(x=>x.phase===range.phase&&x.start===range.start);if(!page)throw Error('Bill comparison page gap');
   const value=await checkPage(tx,bill,loaded,runId,range,page);
   for(const key of sumKeys)result[key]+=value[key];
   for(const id of page.caseIds)cases.add(id);for(const id of page.paymentQueryRefs)payment.add(id);for(const id of page.refundQueryRefs)refund.add(id);
   manifest.push({phase:page.phase,start:page.start,end:page.end,contentHash:page.contentHash});
  }
  result.paymentQueriesQueued=payment.size;result.refundQueriesQueued=refund.size;resultSchema.parse(result);
  if(result.applicationPaymentRows+result.applicationRefundRows+result.outsideApplicationRows!==result.totalBillRows)throw Error('Bill comparison conservation conflict');
  const identity={comparisonVersion:'v11-bill-snapshot-4',binding:{...loaded.binding},owner,releaseVersion,sourceSha256:bill.sourceSha256,billDate:bill.billDate};
  const coverage={version:'v11-bill-pages-1',snapshotHash:loaded.snapshotHash,lengths,pageSize:500,pageCount:manifest.length,manifestHash:hash(manifest)};
  const body={identity,result,caseIds:[...cases].sort(),paymentQueryRefs:[...payment].sort(),refundQueryRefs:[...refund].sort(),pageCoverage:coverage};
  const finalHash=hash(body),prior=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId}});
  if(prior.length){
   const metadata=prior[0]!.metadata as unknown as Record<string,unknown>;
   if(prior.length!==1||metadata.finalHash!==finalHash||hash(Object.fromEntries(Object.keys(body).map(key=>[key,metadata[key]])))!==finalHash||typeof metadata.decisionOrdinal!=='string'||!/^[1-9]\d{0,18}$/.test(metadata.decisionOrdinal))throw Error('Bill page final evidence conflict');
   return result;
  }
  const batch=await tx.reconciliationBatch.upsert({where:{merchantScope_period_sourceHash:{merchantScope:loaded.binding.merchantScope,period:bill.billDate,sourceHash:'v11:'+bill.sourceSha256}},create:{merchantScope:loaded.binding.merchantScope,period:bill.billDate,sourceHash:'v11:'+bill.sourceSha256,coverageState:'INCOMPLETE'},update:{coverageState:'INCOMPLETE'}});
  await tx.$executeRaw`UPDATE "ReconciliationBatch" SET "decisionOrdinal"=nextval('"ReconciliationBatch_decisionOrdinal_seq"') WHERE id=${batch.id}`;
  const ordered=await tx.reconciliationBatch.findUniqueOrThrow({where:{id:batch.id},select:{decisionOrdinal:true}});
  await tx.auditLog.create({data:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId,metadata:{...body,finalHash,decisionOrdinal:ordered.decisionOrdinal.toString(),batchId:batch.id,verifiedMetadataSha256:bill.metadataSha256,scope:'VERIFIED_BILL_COMPARISON_NO_FINANCIAL_WRITE'}}});
  return result;
 },{isolationLevel:'Serializable',timeout:30000});}catch(error){if(attempt===2||!retryableTransaction(error))throw error;}
 throw Error('Bill page finalization unavailable');
}

export async function reconcileDownloadedWechatBillPaged(db:PrismaClient,env:ProviderEnv,bill:Bill,owner:string,releaseVersion:string,runId:string){
 await ensureBillComparisonSnapshot(db,env,bill,owner,releaseVersion,runId);
 const {ranges}=await db.$transaction(async tx=>expectedRanges(bill,await loadBillComparisonSnapshot(tx,env,bill,owner,releaseVersion,runId)),{isolationLevel:'RepeatableRead',timeout:30000});
 for(const range of ranges)await commitBillComparisonPage(db,env,bill,owner,releaseVersion,runId,range);
 return finalizeBillComparisonPages(db,env,bill,owner,releaseVersion,runId);
}
