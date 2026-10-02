import type {PrismaClient} from '../generated/prisma/client.js';
export type MonitorLimits={dueJobs:number;manualJobs:number;expiredLeases:number;overdueCases:number;oldestDueSeconds:number;heartbeatSeconds:number};
export type MonitorObservation={dueJobs:number;manualJobs:number;expiredLeases:number;overdueCases:number;oldestDueSeconds:number;freshQueryWorkers:number};
export function validateMonitorLimits(limits:MonitorLimits){
 const keys=['dueJobs','manualJobs','expiredLeases','overdueCases','oldestDueSeconds','heartbeatSeconds'];
 if(Object.keys(limits).sort().join('|')!==keys.sort().join('|')||Object.values(limits).some(x=>!Number.isSafeInteger(x)||x<1||x>86400)||limits.heartbeatSeconds>30)throw Error('Explicit bounded monitor thresholds required');
}
export function summarizeFinancialMonitor(observedAt:Date,observation:MonitorObservation,limits:MonitorLimits){
 validateMonitorLimits(limits);
 if(Object.keys(observation).sort().join('|')!==['dueJobs','manualJobs','expiredLeases','overdueCases','oldestDueSeconds','freshQueryWorkers'].sort().join('|')||!Number.isFinite(observedAt.getTime())||Object.values(observation).some(x=>!Number.isSafeInteger(x)||x<0))throw Error('Invalid monitor observation');
 const alerts:string[]=[];
 for(const key of ['dueJobs','manualJobs','expiredLeases','overdueCases','oldestDueSeconds'] as const)if(observation[key]>=limits[key])alerts.push(key.toUpperCase());
 if(!observation.freshQueryWorkers)alerts.push('QUERY_WORKER_UNAVAILABLE');
 return {scope:'DATABASE_GLOBAL_V11_COUNTS',observedAt:observedAt.toISOString(),counts:observation,alerts,status:alerts.length?'ATTENTION_REQUIRED':'NO_THRESHOLD_BREACH',releaseAuthorized:false};
}
// Read-only snapshot, database clock, aggregate counts only. No refs, owners,
// payloads, merchant identifiers, exception messages or credentials leave DB.
export async function inspectFinancialMonitor(db:PrismaClient,releaseVersion:string,limits:MonitorLimits){
 validateMonitorLimits(limits);if(!releaseVersion.trim()||releaseVersion.length>160)throw Error('Explicit monitor release required');
 return db.$transaction(async tx=>{
  await tx.$executeRawUnsafe('SET TRANSACTION READ ONLY');
  await tx.$executeRawUnsafe("SET LOCAL statement_timeout='5000ms'");
  const clock=await tx.$queryRaw<Array<{now:Date}>>`SELECT clock_timestamp() AS now`;
  const now=clock[0]?.now;
  if(!now)throw Error('Database clock unavailable');
  const jobCounts=await tx.$queryRaw<Array<{dueJobs:number;manualJobs:number;expiredLeases:number;oldestDue:Date|null}>>`SELECT
   (count(*) FILTER (WHERE state IN ('READY','RETRY') AND "runAt"<=${now}))::integer AS "dueJobs",
   (count(*) FILTER (WHERE state='MANUAL'))::integer AS "manualJobs",
   (count(*) FILTER (WHERE state='RUNNING' AND ("leaseUntil"<=${now} OR "leaseUntil" IS NULL)))::integer AS "expiredLeases",
   min("runAt") FILTER (WHERE state IN ('READY','RETRY') AND "runAt"<=${now}) AS "oldestDue"
   FROM "DurableJob" WHERE left(kind,4)='V11_'`;
  const jobs=jobCounts[0];if(!jobs)throw Error('Job aggregate unavailable');
  const caseCounts=await tx.$queryRaw<Array<{count:number}>>`SELECT count(*)::integer AS count FROM "FinancialCase" c WHERE c.state='OPEN' AND c.deadline<=${now}
   AND (left(c.category,4)='V11_' OR (c.category='JOB_REQUIRES_REVIEW' AND EXISTS (SELECT 1 FROM "DurableJob" j WHERE j.id=c."sourceRef" AND left(j.kind,4)='V11_' AND j.state='MANUAL')))`;
  const overdueCases=caseCounts[0]?.count;
  if(overdueCases===undefined)throw Error('Case aggregate unavailable');
  const freshQueryWorkers=await tx.workerHeartbeat.count({where:{mode:'v11-wechat-query',version:releaseVersion,lastPolledAt:{gte:new Date(now.getTime()-limits.heartbeatSeconds*1000),lte:now}}});
  return summarizeFinancialMonitor(now,{dueJobs:jobs.dueJobs,manualJobs:jobs.manualJobs,expiredLeases:jobs.expiredLeases,overdueCases,oldestDueSeconds:jobs.oldestDue?Math.floor((now.getTime()-jobs.oldestDue.getTime())/1000):0,freshQueryWorkers},limits);
 },{isolationLevel:'RepeatableRead',timeout:15000});
}
