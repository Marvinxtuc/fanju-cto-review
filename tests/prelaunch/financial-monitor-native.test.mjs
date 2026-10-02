import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {inspectFinancialMonitor}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/financial-monitor.js`));
const {recordWorkerPoll}=await import(pathToFileURL(`${repo}/services/api/dist/jobs/heartbeat.js`));
test('read-only monitor observes aggregate queue, cases and exact-release heartbeat',async()=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);
 const prefix='monitor_'+randomUUID(),release=prefix+'_release',limits={dueJobs:1,manualJobs:1,expiredLeases:1,overdueCases:1,oldestDueSeconds:60,heartbeatSeconds:30};
 try{
  const baseline=await inspectFinancialMonitor(db,release,limits);assert.equal(baseline.counts.freshQueryWorkers,0);assert.ok(baseline.alerts.includes('QUERY_WORKER_UNAVAILABLE'));
  const clock=await db.$queryRaw`SELECT clock_timestamp() AS now`;const now=clock[0].now.getTime(),old=new Date(now-120000),future=new Date(now+86400000);
  const job=(suffix,state,runAt=old,leaseUntil=null,kind='V11_MONITOR_TEST')=>db.durableJob.create({data:{businessKey:prefix+suffix,refId:prefix+suffix,kind,state,runAt,leaseUntil,leaseOwner:state==='RUNNING'?prefix:null}});
  await job('_due','READY');await job('_retry','RETRY');const manual=await job('_manual','MANUAL');await job('_expired','RUNNING',old,old);await job('_future','READY',future);await job('_legacy','READY',old,null,'LEGACY_MONITOR_TEST');await job('_lookalike','READY',old,null,'V11X_MONITOR_TEST');
  await db.financialCase.createMany({data:[{caseKey:prefix+'_case',category:'V11_MONITOR_TEST',sourceRef:prefix,owner:prefix,deadline:old},{caseKey:prefix+'_jobcase',category:'JOB_REQUIRES_REVIEW',sourceRef:manual.id,owner:prefix,deadline:old},{caseKey:prefix+'_closed',category:'V11_MONITOR_TEST',sourceRef:prefix,owner:prefix,deadline:old,state:'RESOLVED',resolution:'synthetic',reviewedBy:prefix,reviewedAt:old},{caseKey:prefix+'_later',category:'V11_MONITOR_TEST',sourceRef:prefix,owner:prefix,deadline:future}]});
  await recordWorkerPoll(db,'v11-wechat-query',prefix,release+'old');assert.equal((await inspectFinancialMonitor(db,release,limits)).counts.freshQueryWorkers,0);
  await recordWorkerPoll(db,'v11-wechat-query',prefix,release);
  const before=await db.auditLog.count(),states=await db.durableJob.findMany({where:{businessKey:{startsWith:prefix}},orderBy:{id:'asc'}});
  const report=await inspectFinancialMonitor(db,release,limits);
  assert.equal(report.counts.dueJobs,baseline.counts.dueJobs+2);assert.equal(report.counts.manualJobs,baseline.counts.manualJobs+1);assert.equal(report.counts.expiredLeases,baseline.counts.expiredLeases+1);assert.equal(report.counts.overdueCases,baseline.counts.overdueCases+2);assert.ok(report.counts.oldestDueSeconds>=120);assert.equal(report.counts.freshQueryWorkers,1);assert.equal(report.releaseAuthorized,false);
  assert.equal(await db.auditLog.count(),before);assert.deepEqual(await db.durableJob.findMany({where:{businessKey:{startsWith:prefix}},orderBy:{id:'asc'}}),states);assert.ok(!JSON.stringify(report).includes(prefix));
  await db.workerHeartbeat.updateMany({where:{instanceId:prefix},data:{lastPolledAt:old}});assert.ok((await inspectFinancialMonitor(db,release,limits)).alerts.includes('QUERY_WORKER_UNAVAILABLE'));
 }finally{await db.$disconnect();}
});
