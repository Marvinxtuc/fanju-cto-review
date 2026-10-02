import {createHash} from 'node:crypto';
import {billRangeDays,summarizeWechatBillRange} from './wechat-bill-range.js';
import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {verifyBillPageFinalStorage} from './wechat-bill-page-evidence.js';
export async function hasCommittedBillDay(db:PrismaClient,binding:ChannelBinding,owner:string,release:string,date:string,runId:string){
 return db.$transaction(async tx=>{
 const rows=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:runId},select:{metadata:true}});
 if(!rows.length)return false;
 if(rows.length!==1)throw Error('Ambiguous recovery evidence');
 const metadata=rows[0]!.metadata as unknown as {identity:{owner:string;sourceSha256:string};result:{runId:string}};
 if(metadata?.identity?.owner!==owner||! /^[a-f0-9]{64}$/.test(metadata.identity.sourceSha256)||metadata.result?.runId!==runId||summarizeWechatBillRange(binding,release,date,date,[metadata]).observedDays!==1)throw Error('Recovery identity conflict');
 if((metadata.identity as unknown as {comparisonVersion:string}).comparisonVersion==='v11-bill-snapshot-4')await verifyBillPageFinalStorage(tx,runId,metadata);
 return true;
 },{isolationLevel:'RepeatableRead',timeout:30000});
}
export function billDayRunId(rangeId:string,date:string){
 if(!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(rangeId))throw Error('Explicit range UUID required');
 billRangeDays(date,date);
 const h=createHash('sha256').update(JSON.stringify(['v11-bill-range-1',rangeId,date])).digest('hex');
 return `${h.slice(0,8)}-${h.slice(8,12)}-5${h.slice(13,16)}-a${h.slice(17,20)}-${h.slice(20,32)}`;
}
// Committed audit evidence is the recovery checkpoint. A failed day is never
// interpreted as an empty bill. Errors are deliberately excluded from output.
export async function runWechatBillRange(start:string,end:string,rangeId:string,operations:{resume:(date:string,runId:string)=>Promise<boolean>;compare:(date:string,runId:string)=>Promise<void>;recordFailure?:(date:string,runId:string)=>Promise<void>},options:{maxNewDays?:number;signal?:AbortSignal}={}){
 const max=options.maxNewDays??366;if(!Number.isSafeInteger(max)||max<1||max>366)throw Error('Bill range run limit must be 1 to 366 days');
 const dates=billRangeDays(start,end),runs=dates.map(date=>({date,runId:billDayRunId(rangeId,date)}));
 const days:Array<{date:string;status:'RESUMED'|'OBSERVED'|'FAILED'}>=[];
 let attemptedDays=0,stopReason:'SIGNAL'|'PER_RUN_LIMIT'|null=null;
 for(const {date,runId} of runs){
  if(options.signal?.aborted){stopReason='SIGNAL';break;}
  if(attemptedDays>=max){stopReason='PER_RUN_LIMIT';break;}
  let attempted=false;
  try{
   if(await operations.resume(date,runId))days.push({date,status:'RESUMED'});
   else{
    // Drain the entire started date. Never interrupt comparison/journal commit
    // after channel acquisition; the next date is the cancellation boundary.
    if(options.signal?.aborted){stopReason='SIGNAL';break;}
    attempted=true;attemptedDays++;await operations.compare(date,runId);days.push({date,status:'OBSERVED'});
   }
  }catch{
   if(!attempted)attemptedDays++;
   if(operations.recordFailure)await operations.recordFailure(date,runId);
   days.push({date,status:'FAILED'});
  }
 }
 return {start,end,days,failedDays:days.filter(x=>x.status==='FAILED').length,attemptedDays,
  pendingDays:runs.length-days.length,nextDate:runs[days.length]?.date??null,
  executionState:days.length===runs.length?'RANGE_PROCESSED':'PAUSED',stopReason,
  coverageState:'INCOMPLETE',releaseAuthorized:false};
}

// Budget controls invocation size, never the immutable task range or identity.
export function billRangeRunLimit(value:string|undefined){
 if(value===undefined)return 366;
 if(!/^[1-9]\d{0,2}$/.test(value)||Number(value)>366)throw Error('Invalid bill range run limit');
 return Number(value);
}
export function billRangeRunExitCode(result:{failedDays:number;pendingDays:number}){
 return result.failedDays?2:result.pendingDays?3:0;
}
// Shared by production CLI and process QA. Signals request a day-boundary drain.
export function installBillRangeDrainSignals(controller:AbortController){
 const stop=()=>controller.abort();process.on('SIGTERM',stop);process.on('SIGINT',stop);
 return ()=>{process.off('SIGTERM',stop);process.off('SIGINT',stop);};
}
