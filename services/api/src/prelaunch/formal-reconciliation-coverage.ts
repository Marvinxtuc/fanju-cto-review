import {z} from 'zod';
import type {PrismaClient} from '../generated/prisma/client.js';
import {object,sha256,json,dbNow,type Tx} from './domain.js';
import {formalCanonicalJson} from './formal-json.js';
import {authorizeHistoricalPolicy,type RuntimeAuthoritySource} from './formal-runtime-policy.js';
import {verifyBillPageFinalStorage} from './wechat-bill-page-evidence.js';
import {billRangeDays} from './wechat-bill-range.js';
import {channelWorkerMode} from './channel-worker-mode.js';
import {verifyFormalActor} from './formal-supply.js';
import {requireRole,reject,type LocalPrincipal} from './contracts.js';
const digest=z.string().regex(/^[a-f0-9]{64}$/),day=z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const scopeSchema=z.object({scope:z.literal('FORMAL_RECONCILIATION_SCOPE'),version:z.string().min(1).max(160),
 environment:z.enum(['PRODUCTION','ISOLATED_TEST']),merchantScope:digest,providerConfigId:z.string().min(1).max(160),
 start:day,end:day,applicationScope:z.literal('EXACT_MINIAPP_ALL_TRANSACTIONS'),outsideApplication:z.literal('EXPLICITLY_EXCLUDED'),
 legacyCoverage:z.literal('REQUIRE_SEPARATE_VERIFIED_COVERAGE'),workerReleaseVersion:z.string().min(1).max(160)}).strict();
export function inspectFormalReconciliationScope(raw:string,expectedDigest:string){
 if(Buffer.byteLength(raw)>65536||sha256(raw)!==expectedDigest)throw Error('Reconciliation scope integrity invalid');
 const scope=scopeSchema.parse(JSON.parse(raw));billRangeDays(scope.start,scope.end);return scope;
}
async function finalEvidence(tx:Tx,runId:string){
 const rows=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId}});
 if(rows.length!==1)reject(409,'FORMAL_COMPARISON_EVIDENCE_UNAVAILABLE');
 await verifyBillPageFinalStorage(tx,runId,rows[0]!.metadata);
 return object(rows[0]!.metadata);
}
async function isCurrentFinancialSnapshot(tx:Tx,runId:string,merchantScope:string){
 const snapshot=await tx.v11BillComparisonSnapshot.findUniqueOrThrow({where:{id:runId}}),facts=object(snapshot.snapshot);
 const receipts=await tx.channelReceipt.findMany({where:{channel:'wechat',merchantScope},include:{v11ReceiptBinding_receiptId:true}});
 const captured=Array.isArray(facts.receipts)?facts.receipts.map(object):[];
 if(receipts.length!==captured.length||receipts.some(x=>!captured.some(c=>c.id===x.id&&c.channel===x.channel&&c.merchantScope===x.merchantScope&&c.channelTradeNo===x.channelTradeNo&&c.merchantOrderNo===x.merchantOrderNo&&c.paymentId===x.paymentId&&c.orderId===x.orderId&&c.amountCents===x.amountCents&&c.currency===x.currency&&c.paidAt===(x.paidAt?.toISOString()??null)&&formalCanonicalJson(c.v11ReceiptBinding_receiptId)===formalCanonicalJson(x.v11ReceiptBinding_receiptId?{intentId:x.v11ReceiptBinding_receiptId.intentId,registrationId:x.v11ReceiptBinding_receiptId.registrationId}:null))))return false;
 const refunds=await tx.v11RefundInstruction.findMany({where:{channel:'wechat',merchantScope}}),old=Array.isArray(facts.refunds)?facts.refunds.map(object):[];
 if(refunds.length!==old.length||refunds.some(x=>!old.some(c=>c.id===x.id&&c.state===x.state&&c.channelRefundNo===x.channelRefundNo&&c.merchantRefundNo===x.merchantRefundNo&&c.originalTradeNo===x.originalTradeNo&&c.providerConfigId===x.providerConfigId&&c.totalCents===x.totalCents&&c.serviceFeeCents===x.serviceFeeCents&&c.depositCents===x.depositCents)))return false;
 const newerTime=await tx.receivedEvent.count({where:{source:'wechat-refund-query-v11',merchantScope,verifiedAt:{gt:snapshot.capturedAt}}});
 return newerTime===0;
}
// Independent evaluator. Original comparison records retain INCOMPLETE; this
// publishes a narrowly scoped, revocable engineering assessment with its proof.
export async function assessFormalReconciliation(db:PrismaClient,actor:LocalPrincipal,policyId:string,
 input:{scopeRaw:string;scopeDigest:string;runIds:string[]},source:RuntimeAuthoritySource){
 requireRole(actor,'OPS','REVIEWER');
 const scope=inspectFormalReconciliationScope(input.scopeRaw,input.scopeDigest);
 return db.$transaction(async tx=>{
  await verifyFormalActor(tx,actor);const runtime=await authorizeHistoricalPolicy(tx,policyId,'CLOSE_DIFFERENCE',source);
  const authority=runtime.authority;
  const scopeRef=runtime.grant.evidence.find(e=>e.responsibility==='RECONCILIATION_SCOPE'&&e.sha256===input.scopeDigest);
  if(!scopeRef||authority.trust.evidence.get(scopeRef.referenceId)!==input.scopeRaw
   ||scope.environment!==runtime.binding.environment||scope.merchantScope!==runtime.binding.merchantScope||scope.providerConfigId!==runtime.binding.providerConfigId)
   reject(409,'FORMAL_RECONCILIATION_SCOPE_UNAUTHORIZED');
  const dates=billRangeDays(scope.start,scope.end),blockers=new Set<string>();
  const days:Array<{date:string;runId:string;finalHash:unknown;snapshotHash:string;sourceSha256:unknown}>=[];
  if(input.runIds.length!==dates.length||new Set(input.runIds).size!==input.runIds.length)reject(400,'FORMAL_RECONCILIATION_RANGE_INVALID');
  for(const runId of input.runIds){
   const evidence=await finalEvidence(tx,runId),identity=object(evidence.identity),binding=object(identity.binding),result=object(evidence.result);
   const date=identity.billDate;if(typeof date!=='string'||!dates.includes(date)||days.some(d=>d.date===date)
    ||binding.channel!=='wechat'||binding.merchantScope!==scope.merchantScope||binding.providerConfigId!==scope.providerConfigId)reject(409,'FORMAL_RECONCILIATION_RANGE_INVALID');
   if(identity.releaseVersion!==scope.workerReleaseVersion)blockers.add('COMPARISON_RELEASE_VERSION_MISMATCH');
   if(result.differences!==0)blockers.add('UNRESOLVED_COMPARISON_DIFFERENCES');
   if(result.legacyRows!==0)blockers.add('LEGACY_COVERAGE_REQUIRED');
   if(result.confirmedRefundsWithoutTrustedPeriod!==0||result.refundTimeConflicts!==0)blockers.add('TRUSTED_REFUND_PERIOD_REQUIRED');
   const queries=await tx.durableJob.findMany({where:{businessKey:{startsWith:`v11:bill-query:${runId}:`}}});
   if(queries.some(j=>j.state!=='DONE'))blockers.add('RECOVERY_QUERIES_UNRESOLVED');
   const openCases=await tx.financialCase.count({where:{id:{in:evidence.caseIds as string[]},state:{not:'RESOLVED'}}});if(openCases)blockers.add('UNRESOLVED_COMPARISON_CASES');
   const snapshot=await tx.v11BillComparisonSnapshot.findUniqueOrThrow({where:{id:runId}}),facts=object(snapshot.snapshot);
   // Added receipts or changed refunds after capture invalidate that candidate.
   const currentReceipts=await tx.channelReceipt.findMany({where:{channel:'wechat',merchantScope:scope.merchantScope},include:{v11ReceiptBinding_receiptId:true}});
   const periodStart=new Date(scope.start+'T00:00:00+08:00'),periodEnd=new Date(scope.end+'T00:00:00+08:00');periodEnd.setTime(periodEnd.getTime()+86400000);
   if(currentReceipts.some(r=>!r.v11ReceiptBinding_receiptId&&(!r.paidAt||(r.paidAt>=periodStart&&r.paidAt<periodEnd))))blockers.add('LEGACY_COVERAGE_REQUIRED');
   if(!await isCurrentFinancialSnapshot(tx,runId,scope.merchantScope))blockers.add('FINANCIAL_SNAPSHOT_STALE');
   days.push({date,runId,finalHash:evidence.finalHash,snapshotHash:snapshot.snapshotHash,sourceSha256:identity.sourceSha256});
   const history=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',AND:[
    {metadata:{path:['identity','binding','merchantScope'],equals:scope.merchantScope}},{metadata:{path:['identity','billDate'],equals:date}}]},take:1001});
   if(history.some(h=>BigInt(String(object(h.metadata).decisionOrdinal))>BigInt(String(evidence.decisionOrdinal))))blockers.add('COMPARISON_CANDIDATE_SUPERSEDED');
   if(history.length>1000)blockers.add('CASE_HISTORY_REQUIRES_BOUNDED_REVIEW');
   const historicalCases=history.flatMap(h=>{const ids=object(h.metadata).caseIds;return Array.isArray(ids)?ids.filter((id):id is string=>typeof id==='string'):[];});
   if(historicalCases.length>5000)blockers.add('CASE_HISTORY_REQUIRES_BOUNDED_REVIEW');
   else if(historicalCases.length){
    const issues=await tx.financialCase.findMany({where:{id:{in:historicalCases}}});
    for(const issue of issues){
     if(issue.state!=='RESOLVED'){blockers.add('UNRESOLVED_HISTORICAL_DIFFERENCES');continue;}
     const closure=await tx.auditLog.findFirst({where:{action:'funding.v11-formal-bill-difference-closed',targetType:'FinancialCase',targetId:issue.id}});
     if(!closure||issue.resolution!==sha256(formalCanonicalJson(closure.metadata)))blockers.add('HISTORICAL_DIFFERENCE_CLOSURE_EVIDENCE_INVALID');
    }
   }
  }
  const until=new Date(scope.end+'T00:00:00+08:00');until.setTime(until.getTime()+86400000);
  const unresolved=await tx.v11PaymentIntent.count({where:{channel:'wechat',merchantScope:scope.merchantScope,createdAt:{lt:until},state:{in:['NEW','SUBMITTING','UNKNOWN']},preparationState:{not:'NOT_STARTED'}}});
  if(unresolved)blockers.add('PAYMENT_RECOVERY_UNRESOLVED');
  const at=await dbNow(tx),modes=['v11-formal-business','v11-formal-payment-close','v11-formal-hold-expiry'].map(m=>channelWorkerMode(m,runtime.binding));
  const live=await tx.workerHeartbeat.findMany({where:{mode:{in:modes},version:scope.workerReleaseVersion,lastPolledAt:{gte:new Date(at.getTime()-30000),lte:at}}});
  if(modes.some(m=>!live.some(h=>h.mode===m)))blockers.add('BOUND_RECOVERY_WORKERS_UNHEALTHY');
  const result={scope:'FORMAL_RECONCILIATION_ASSESSMENT',scopeDigest:input.scopeDigest,start:scope.start,end:scope.end,
   state:blockers.size?'BLOCKED':'COMPLETE_WITHIN_DECLARED_SCOPE',blockerIds:[...blockers],days:days.sort((a,b)=>a.date.localeCompare(b.date)),
   policyDigest:runtime.policy.bundleDigest,merchantScope:runtime.binding.merchantScope,providerConfigId:runtime.binding.providerConfigId,workerReleaseVersion:scope.workerReleaseVersion,
   assessedAt:at.toISOString(),expiresAt:new Date(at.getTime()+30000).toISOString(),authorityId:runtime.grant.id,environment:runtime.binding.environment,releaseAuthorized:false};
  const hash=sha256(formalCanonicalJson(result));
  const row=await tx.auditLog.create({data:{action:'funding.v11-formal-coverage-assessed',targetType:'FormalReconciliationAssessment',targetId:hash,metadata:json(result)}});
  return {assessmentId:row.id,...result};
 },{isolationLevel:'Serializable',timeout:30000});
}
// A whole repeat comparison of the identical trusted bill must have converged.
// A free-text conclusion, resolved flag or newer different statement is insufficient.
export async function closeFormalBillDifference(db:PrismaClient,actor:LocalPrincipal,policyId:string,
 input:{caseId:string;originalRunId:string;verifiedRunId:string},source:RuntimeAuthoritySource){
 requireRole(actor,'OPS');if(input.originalRunId===input.verifiedRunId)reject(409,'INDEPENDENT_RECOMPARISON_REQUIRED');
 return db.$transaction(async tx=>{
  await verifyFormalActor(tx,actor);const runtime=await authorizeHistoricalPolicy(tx,policyId,'CLOSE_DIFFERENCE',source);
  const original=await finalEvidence(tx,input.originalRunId),verified=await finalEvidence(tx,input.verifiedRunId);
  const snapshots=await tx.v11BillComparisonSnapshot.findMany({where:{id:{in:[input.originalRunId,input.verifiedRunId]}}});
  if(snapshots.find(x=>x.id===input.verifiedRunId)!.capturedAt<=snapshots.find(x=>x.id===input.originalRunId)!.capturedAt
   ||BigInt(String(verified.decisionOrdinal))<=BigInt(String(original.decisionOrdinal)))reject(409,'NEWER_RECOMPARISON_REQUIRED');
  const a=object(original.identity),b=object(verified.identity),binding=object(b.binding);
  if(binding.channel!=='wechat'||binding.merchantScope!==runtime.binding.merchantScope||binding.providerConfigId!==runtime.binding.providerConfigId
   ||a.sourceSha256!==b.sourceSha256||a.billDate!==b.billDate||formalCanonicalJson(a.binding)!==formalCanonicalJson(b.binding)
   ||!(original.caseIds as string[]).includes(input.caseId)||object(verified.result).differences!==0||object(verified.result).legacyRows!==0
   ||object(verified.result).confirmedRefundsWithoutTrustedPeriod!==0)reject(409,'FORMAL_DIFFERENCE_RECOMPARISON_UNRESOLVED');
  if(!await isCurrentFinancialSnapshot(tx,input.verifiedRunId,runtime.binding.merchantScope))reject(409,'FORMAL_DIFFERENCE_FINANCIAL_SNAPSHOT_STALE');
  const newer=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',AND:[{metadata:{path:['identity','binding','merchantScope'],equals:runtime.binding.merchantScope}},{metadata:{path:['identity','billDate'],equals:String(b.billDate)}}]},take:1001});
  if(newer.length>1000||newer.some(h=>BigInt(String(object(h.metadata).decisionOrdinal))>BigInt(String(verified.decisionOrdinal))))reject(409,'FORMAL_DIFFERENCE_CANDIDATE_SUPERSEDED');
  const pending=await tx.durableJob.count({where:{businessKey:{startsWith:`v11:bill-query:${input.verifiedRunId}:`},state:{not:'DONE'}}});
  if(pending)reject(409,'FORMAL_DIFFERENCE_RECOVERY_UNRESOLVED');
  await tx.$queryRaw`SELECT id FROM "FinancialCase" WHERE id=${input.caseId} FOR UPDATE`;
  const issue=await tx.financialCase.findUniqueOrThrow({where:{id:input.caseId}});
  if(!issue.category.startsWith('V11_BILL_')||issue.owner!==actor.id)reject(403,'FORMAL_DIFFERENCE_OWNER_REQUIRED');
  const proof={scope:'FORMAL_BILL_DIFFERENCE_CLOSURE',originalRunId:input.originalRunId,verifiedRunId:input.verifiedRunId,
   originalFinalHash:original.finalHash,verifiedFinalHash:verified.finalHash,authorityId:runtime.grant.id,actorId:actor.id};
  const digest=sha256(formalCanonicalJson(proof));
  if(issue.state==='RESOLVED'){if(issue.resolution!==digest)reject(409,'FORMAL_DIFFERENCE_CLOSURE_CONFLICT');return {caseId:issue.id,state:'RESOLVED',proofDigest:digest};}
  await tx.financialCase.update({where:{id:issue.id},data:{state:'RESOLVED',resolution:digest,reviewedBy:runtime.grant.issuerId,reviewedAt:await dbNow(tx)}});
  await tx.auditLog.create({data:{action:'funding.v11-formal-bill-difference-closed',targetType:'FinancialCase',targetId:issue.id,metadata:json(proof)}});
  return {caseId:issue.id,state:'RESOLVED',proofDigest:digest};
 },{isolationLevel:'Serializable',timeout:30000});
}

/** New-money preflight consumes the independent assessment and rechecks current
 * storage/queries/cases/workers. A cached zero-difference result is insufficient. */
export async function hasFormalReconciliationCoverage(tx:Tx,runtime:Awaited<ReturnType<typeof authorizeHistoricalPolicy>>,period:string|undefined){
 if(!period||!/^\d{4}-\d{2}-\d{2}$/.test(period))return false;
 const refs=runtime.grant.evidence.filter(e=>e.responsibility==='RECONCILIATION_SCOPE');
 for(const ref of refs){
  const raw=runtime.authority.trust.evidence.get(ref.referenceId);if(!raw)continue;
  const scope=inspectFormalReconciliationScope(raw,ref.sha256);
  if(scope.merchantScope!==runtime.binding.merchantScope||scope.providerConfigId!==runtime.binding.providerConfigId||scope.environment!==runtime.binding.environment||scope.workerReleaseVersion!==runtime.binding.releaseVersion||period<scope.start||period>scope.end)continue;
  const row=await tx.auditLog.findFirst({where:{action:'funding.v11-formal-coverage-assessed',targetType:'FormalReconciliationAssessment',metadata:{path:['scopeDigest'],equals:ref.sha256}},orderBy:[{createdAt:'desc'},{id:'desc'}]});
  const proof=object(row?.metadata),at=await dbNow(tx);
  if(!row||row.targetId!==sha256(formalCanonicalJson(proof))||proof.state!=='COMPLETE_WITHIN_DECLARED_SCOPE'||proof.policyDigest!==runtime.policy.bundleDigest||proof.merchantScope!==runtime.binding.merchantScope||proof.providerConfigId!==runtime.binding.providerConfigId||proof.environment!==runtime.binding.environment||proof.workerReleaseVersion!==scope.workerReleaseVersion||typeof proof.expiresAt!=='string'||Date.parse(proof.expiresAt)<=at.getTime()||!Array.isArray(proof.days))return false;
  for(const item of proof.days){const day=object(item);if(typeof day.runId!=='string'||!await isCurrentFinancialSnapshot(tx,day.runId,runtime.binding.merchantScope))return false;
   const evidence=await finalEvidence(tx,day.runId),identity=object(evidence.identity);
   if(day.finalHash!==evidence.finalHash||day.date!==identity.billDate||object(evidence.result).differences!==0)return false;
   const pending=await tx.durableJob.count({where:{businessKey:{startsWith:'v11:bill-query:'+day.runId+':'},state:{not:'DONE'}}});if(pending)return false;
   const history=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',AND:[{metadata:{path:['identity','binding','merchantScope'],equals:runtime.binding.merchantScope}},{metadata:{path:['identity','billDate'],equals:String(day.date)}}]},take:1001});
   if(history.length>1000||history.some(h=>BigInt(String(object(h.metadata).decisionOrdinal))>BigInt(String(evidence.decisionOrdinal))))return false;
   const cases=history.flatMap(h=>Array.isArray(object(h.metadata).caseIds)?object(h.metadata).caseIds as string[]:[]);if(cases.length>5000)return false;
   const issues=await tx.financialCase.findMany({where:{id:{in:cases}}});for(const issue of issues){if(issue.state!=='RESOLVED')return false;const closure=await tx.auditLog.findFirst({where:{action:'funding.v11-formal-bill-difference-closed',targetType:'FinancialCase',targetId:issue.id}});if(!closure||issue.resolution!==sha256(formalCanonicalJson(closure.metadata)))return false;}
  }
  const modes=['v11-formal-business','v11-formal-payment-close','v11-formal-hold-expiry'].map(m=>channelWorkerMode(m,runtime.binding)),live=await tx.workerHeartbeat.findMany({where:{mode:{in:modes},version:scope.workerReleaseVersion,lastPolledAt:{gte:new Date(at.getTime()-30000),lte:at}}});
  return modes.every(mode=>live.some(row=>row.mode===mode));
 }
 return false;
}
