import type {PrismaClient} from '../generated/prisma/client.js';
import type {ChannelBinding} from '../funding/mock-channel.js';
import {validBillPageFinalEvidence,verifyBillPageFinalStorage} from './wechat-bill-page-evidence.js';
const version='v11-bill-snapshot-3';
function day(value:string){if(!/^\d{4}-\d{2}-\d{2}$/.test(value))throw Error('Invalid bill range date');const at=Date.parse(value+'T00:00:00Z');if(!Number.isFinite(at)||new Date(at).toISOString().slice(0,10)!==value)throw Error('Invalid bill range date');return at;}
export function billRangeDays(start:string,end:string){const first=day(start),last=day(end);if(last<first||last-first>365*86400000)throw Error('Bill range must contain 1 to 366 days');const dates:string[]=[];for(let at=first;at<=last;at+=86400000)dates.push(new Date(at).toISOString().slice(0,10));return dates;}
const object=(value:unknown):Record<string,unknown>=>value&&typeof value==='object'&&!Array.isArray(value)?value as Record<string,unknown>:{};
// Keep only ordering evidence and the latest row per requested day. Invalid
// ordinals remain blocking even when another page has a valid newer snapshot.
function rangeAccumulator(binding:ChannelBinding,releaseVersion:string,start:string,end:string){
 if(binding.channel!=='wechat'||!/^[a-f0-9]{64}$/.test(binding.merchantScope)||!binding.providerConfigId||!releaseVersion.trim())throw Error('Explicit bill range binding required');
 const expected=billRangeDays(start,end);
 const states=new Map(expected.map(date=>[date,{latest:null as Record<string,unknown>|null,ordinal:0n,ambiguous:false,unsupported:false}]));
 function add(value:unknown){
  const row=object(value),identity=object(row.identity);
  if(object(identity.binding).merchantScope!==binding.merchantScope||typeof identity.billDate!=='string')return;
  const state=states.get(identity.billDate);if(!state)return;
  if(typeof row.decisionOrdinal!=='string'||!/^[1-9]\d{0,18}$/.test(row.decisionOrdinal)){state.unsupported=true;return;}
  const ordinal=BigInt(row.decisionOrdinal);
  if(ordinal>state.ordinal){state.latest=row;state.ordinal=ordinal;state.ambiguous=false;}
  else if(ordinal===state.ordinal)state.ambiguous=true;
 }
 function result(){
  const reports=expected.map(date=>{
   const state=states.get(date)!;
   if(state.unsupported)return {date,status:'UNSUPPORTED_ORDERING',differences:null};
   if(!state.latest)return {date,status:'MISSING',differences:null};
   if(state.ambiguous)return {date,status:'AMBIGUOUS_ORDERING',differences:null};
   const latest=state.latest,identity=object(latest.identity),originalBinding=object(identity.binding),result=object(latest.result);
   if(identity.releaseVersion!==releaseVersion||![version,'v11-bill-snapshot-4'].includes(String(identity.comparisonVersion))||originalBinding.channel!==binding.channel||originalBinding.providerConfigId!==binding.providerConfigId)return {date,status:'VERSION_MISMATCH',differences:null};
   if(identity.comparisonVersion==='v11-bill-snapshot-4'&&!validBillPageFinalEvidence(latest))return {date,status:'INVALID_EVIDENCE',differences:null};
   if(result.billDate!==date||result.scope!=='BILL_AND_RECORDED_FUNDS_SNAPSHOT'||result.coverageState!=='INCOMPLETE'||result.releaseAuthorized!==false||!Number.isSafeInteger(result.differences)||Number(result.differences)<0)return {date,status:'INVALID_EVIDENCE',differences:null};
   return {date,status:'INCOMPLETE',differences:Number(result.differences)};
  });
  return {scope:'REQUESTED_BILL_RANGE_ONLY',start,end,expectedDays:expected.length,missingDays:reports.filter(x=>x.status==='MISSING').length,
   observedDays:reports.filter(x=>x.status==='INCOMPLETE').length,days:reports,coverageState:'INCOMPLETE',releaseAuthorized:false};
 }
 return {add,result};
}
// No runtime policy or release authority; all-present ranges remain incomplete.
export function summarizeWechatBillRange(binding:ChannelBinding,releaseVersion:string,start:string,end:string,metadata:unknown[]){
 const accumulator=rangeAccumulator(binding,releaseVersion,start,end);
 for(const row of metadata)accumulator.add(row);
 return accumulator.result();
}
export async function inspectWechatBillRange(db:PrismaClient,binding:ChannelBinding,releaseVersion:string,start:string,end:string){
 const accumulator=rangeAccumulator(binding,releaseVersion,start,end),dates=billRangeDays(start,end);
 return db.$transaction(async tx=>{
  let cursor:string|undefined;
  while(true){
   const rows=await tx.auditLog.findMany({where:{action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',
    AND:[{metadata:{path:['identity','binding','merchantScope'],equals:binding.merchantScope}},
     {OR:dates.map(date=>({metadata:{path:['identity','billDate'],equals:date}}))}],...(cursor?{id:{gt:cursor}}:{})},
    orderBy:{id:'asc'},take:250,select:{id:true,targetId:true,metadata:true}});
   for(const row of rows){
    if(object(object(row.metadata).identity).comparisonVersion==='v11-bill-snapshot-4'){
     try{await verifyBillPageFinalStorage(tx,row.targetId,row.metadata);}catch{accumulator.add({...object(row.metadata),pageCoverage:null});continue;}
    }
    accumulator.add(row.metadata);
   }
   if(rows.length<250)break;
   cursor=rows[rows.length-1]!.id;
  }
  return accumulator.result();
 },{isolationLevel:'RepeatableRead',timeout:30000});
}
