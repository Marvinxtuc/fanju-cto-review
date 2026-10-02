import type {PrismaClient} from '../generated/prisma/client.js';
import type {ProviderEnv} from '../providers.js';
import {assertDownloadedTradeBill,type downloadWechatTradeBill} from './wechat-trade-bill.js';
import {reconcileDownloadedWechatBill} from './wechat-bill-reconciliation.js';
import {reconcileDownloadedWechatBillPaged} from './wechat-bill-page-checkpoint.js';

// New runs always use durable pages. Only an already committed v3 audit may
// replay the legacy reader; failures never fall back to a single transaction.
export async function reconcileDownloadedWechatBillResumable(db:PrismaClient,env:ProviderEnv,bill:Awaited<ReturnType<typeof downloadWechatTradeBill>>,owner:string,releaseVersion:string,runId:string){
 assertDownloadedTradeBill(bill);
 const route=await db.$transaction(async tx=>{
  const rows=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId},select:{metadata:true}});
  if(rows.length>1)throw Error('Ambiguous bill replay evidence');
  if(!rows.length)return 'PAGED';
  const metadata=rows[0]!.metadata as unknown as {identity?:{comparisonVersion?:string}};
  if(metadata.identity?.comparisonVersion==='v11-bill-snapshot-4')return 'PAGED';
  if(metadata.identity?.comparisonVersion!=='v11-bill-snapshot-3'||await tx.v11BillComparisonSnapshot.findUnique({where:{id:runId},select:{id:true}}))throw Error('Unsupported bill replay evidence');
  return 'LEGACY';
 },{isolationLevel:'RepeatableRead',timeout:30000});
 return route==='LEGACY'?reconcileDownloadedWechatBill(db,env,bill,owner,releaseVersion,runId):reconcileDownloadedWechatBillPaged(db,env,bill,owner,releaseVersion,runId);
}
