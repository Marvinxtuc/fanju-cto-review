import {createHash} from 'node:crypto';
import type {PrismaClient,Prisma} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {billRangeDays} from './wechat-bill-range.js';
import {billDayRunId} from './wechat-bill-range-runner.js';

type Task={rangeId:string;start:string;end:string;binding:ChannelBinding;owner:string;releaseVersion:string};
function canonical(value:unknown):unknown{
 if(Array.isArray(value))return value.map(canonical);
 if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>[key,canonical(item)]));
 return value;
}
const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
function identity(task:Task){
 billRangeDays(task.start,task.end);billDayRunId(task.rangeId,task.start);
 if(task.binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(task.binding.merchantScope)||!task.binding.providerConfigId?.trim()
  ||!task.owner.trim()||task.owner.length>160||!task.releaseVersion.trim()||task.releaseVersion.length>160)throw Error('Explicit range task identity required');
 return {scope:'V11_BILL_RANGE_TASK',version:'v11-bill-range-task-1',comparisonVersion:'v11-bill-snapshot-3',rangeId:task.rangeId,
  start:task.start,end:task.end,binding:{channel:task.binding.channel,merchantScope:task.binding.merchantScope,providerConfigId:task.binding.providerConfigId},owner:task.owner,releaseVersion:task.releaseVersion};
}
async function assertTask(tx:Prisma.TransactionClient,task:Task,expected:ReturnType<typeof identity>){
 await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-range-task:${task.rangeId}`},0))`;
 const rows=await tx.auditLog.findMany({where:{action:'funding.v11-bill-range-task',targetType:'V11BillRangeTask',targetId:task.rangeId},select:{metadata:true}});
 if(rows.length!==1||hash(rows[0]!.metadata)!==hash(expected))throw Error('Range task identity conflict');
}
// Task and failure history persist independently of daily comparison success.
// No channel payload, URL, credentials or exception details enter this journal.
export async function ensureWechatBillRangeTask(db:PrismaClient,task:Task){
 const expected=identity(task);
 return db.$transaction(async tx=>{
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11-bill-range-task:${task.rangeId}`},0))`;
  const rows=await tx.auditLog.findMany({where:{action:'funding.v11-bill-range-task',targetType:'V11BillRangeTask',targetId:task.rangeId},select:{metadata:true}});
  if(rows.length){if(rows.length!==1||hash(rows[0]!.metadata)!==hash(expected))throw Error('Range task identity conflict');return;}
  await tx.auditLog.create({data:{action:'funding.v11-bill-range-task',targetType:'V11BillRangeTask',targetId:task.rangeId,metadata:expected}});
 });
}
export async function recordWechatBillRangeFailure(db:PrismaClient,task:Task,date:string,runId:string){
 const expected=identity(task);
 if(date<task.start||date>task.end||billDayRunId(task.rangeId,date)!==runId)throw Error('Range failure day identity conflict');
 await db.$transaction(async tx=>{
  await assertTask(tx,task,expected);
  await tx.auditLog.create({data:{action:'funding.v11-bill-range-day-failed',targetType:'V11BillRangeTask',targetId:task.rangeId,
   metadata:{taskIdentitySha256:hash(expected),date,runId,status:'FAILED',coverageState:'INCOMPLETE',releaseAuthorized:false}}});
 });
}
