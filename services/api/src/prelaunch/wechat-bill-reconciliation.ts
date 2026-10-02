import {createHash} from 'node:crypto';
import type {PrismaClient} from '../generated/prisma/client.js';
import {bindingFor} from '../funding/intents.js';
import type {ProviderEnv} from '../providers.js';
import {assertDownloadedTradeBill,type downloadWechatTradeBill} from './wechat-trade-bill.js';
import {createBillComparisonPlan,readBillComparisonFacts,executeBillComparisonCore} from './wechat-bill-comparison-core.js';

type Downloaded=Awaited<ReturnType<typeof downloadWechatTradeBill>>;
function canonical(value:unknown):unknown{if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));return value;}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))??'null').digest('hex');
// Internal trusted acquisition only. Never accepts uploaded JSON/CSV as verified.
// CSV discrepancies schedule trusted queries; they do not create money or eligibility.
export async function reconcileDownloadedWechatBill(db:PrismaClient,env:ProviderEnv,bill:Downloaded,owner:string,releaseVersion:string,runId:string){
 assertDownloadedTradeBill(bill);
 const binding=bindingFor(env,'wechat');
 if(JSON.stringify(binding)!==JSON.stringify(bill.binding)||!owner.trim()||owner.length>160||!releaseVersion.trim()||releaseVersion.length>160
  ||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(runId))throw Error('Explicit verified bill reconciliation identity required');
 const parsed=createBillComparisonPlan(bill,env);
 const identity={comparisonVersion:'v11-bill-snapshot-3',binding:{...binding},owner,releaseVersion,sourceSha256:bill.sourceSha256,billDate:bill.billDate};
 for(let attempt=0;attempt<3;attempt++)try{return await db.$transaction(async tx=>{
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='15000ms'");
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-run:${runId}`},0))`;
  if(await tx.v11BillComparisonSnapshot.findUnique({where:{id:runId},select:{id:true}}))throw Error('Persistent bill task cannot use legacy full comparison');
  const prior=await tx.auditLog.findFirst({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId}});
  if(prior){const metadata=prior.metadata as unknown as {identity:typeof identity;result:Record<string,unknown>};if(hash(metadata?.identity)!==hash(identity)||metadata.result?.coverageState!=='INCOMPLETE'||metadata.result?.runId!==runId||metadata.result?.releaseAuthorized!==false)throw Error('Bill reconciliation replay identity conflict');return metadata.result;}
  const facts=await readBillComparisonFacts(tx,binding,parsed);
  const {stats,caseIds}=await executeBillComparisonCore(tx,bill,owner,runId,binding,parsed,facts);
  const batch=await tx.reconciliationBatch.upsert({where:{merchantScope_period_sourceHash:{merchantScope:binding.merchantScope,period:bill.billDate,sourceHash:'v11:'+bill.sourceSha256}},create:{merchantScope:binding.merchantScope,period:bill.billDate,sourceHash:'v11:'+bill.sourceSha256,coverageState:'INCOMPLETE'},update:{coverageState:'INCOMPLETE'}});
  await tx.$executeRaw`UPDATE "ReconciliationBatch" SET "decisionOrdinal"=nextval('"ReconciliationBatch_decisionOrdinal_seq"') WHERE id=${batch.id}`;
  const orderedBatch=await tx.reconciliationBatch.findUniqueOrThrow({where:{id:batch.id},select:{decisionOrdinal:true}});
  await tx.auditLog.create({data:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId,
   metadata:{identity,result:stats,decisionOrdinal:orderedBatch.decisionOrdinal.toString(),caseIds:[...caseIds],batchId:batch.id,verifiedMetadataSha256:bill.metadataSha256,scope:'VERIFIED_BILL_COMPARISON_NO_FINANCIAL_WRITE'}}});
  return stats;
 },{isolationLevel:'Serializable',timeout:30000});}
 catch(error){if(attempt===2||!(error&&typeof error==='object'&&'code'in error&&['P2034','P2002'].includes(String(error.code))))throw error;}
 throw Error('Bill snapshot unavailable');
}
