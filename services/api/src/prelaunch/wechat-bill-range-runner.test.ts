import {describe,it,expect} from 'vitest';
import {billDayRunId,runWechatBillRange,billRangeRunLimit,billRangeRunExitCode} from './wechat-bill-range-runner.js';
const id='11111111-1111-4111-a111-111111111111';
describe('recoverable sequential bill range',()=>{
 it('uses stable distinct daily run identities',()=>{expect(billDayRunId(id,'2026-09-29')).toBe(billDayRunId(id,'2026-09-29'));expect(billDayRunId(id,'2026-09-29')).not.toBe(billDayRunId(id,'2026-09-30'));expect(()=>billDayRunId('invalid','2026-09-29')).toThrow();});
 it('retains a failed date and continues; restart only compares uncommitted dates',async()=>{
  const committed=new Set<string>(),calls:string[]=[];let fail=true;
  const operations={resume:async(_:string,run:string)=>committed.has(run),compare:async(date:string,run:string)=>{calls.push(date);if(date==='2026-09-29'&&fail)throw Error('sensitive channel response');committed.add(run);}};
  const first=await runWechatBillRange('2026-09-28','2026-09-30',id,operations);
  expect(first.days.map(x=>x.status)).toEqual(['OBSERVED','FAILED','OBSERVED']);expect(JSON.stringify(first)).not.toContain('sensitive');
  fail=false;calls.length=0;
  const second=await runWechatBillRange('2026-09-28','2026-09-30',id,operations);
  expect(calls).toEqual(['2026-09-29']);expect(second.days.map(x=>x.status)).toEqual(['RESUMED','OBSERVED','RESUMED']);expect(second.coverageState).toBe('INCOMPLETE');expect(second.releaseAuthorized).toBe(false);
 });
 it('does not download after a recovery identity conflict',async()=>{let calls=0;const result=await runWechatBillRange('2026-09-30','2026-09-30',id,{resume:async()=>{throw Error('conflict');},compare:async()=>{calls++;}});expect(result.failedDays).toBe(1);expect(calls).toBe(0);});
 it('records failure before continuing and stops if the failure journal cannot commit',async()=>{
  const recorded:string[]=[];const operations={resume:async()=>false,compare:async()=>{throw Error('channel');},recordFailure:async(date:string)=>{recorded.push(date);}};
  const result=await runWechatBillRange('2026-09-29','2026-09-30',id,operations);expect(recorded).toEqual(['2026-09-29','2026-09-30']);expect(result.failedDays).toBe(2);
  let comparisons=0;await expect(runWechatBillRange('2026-09-29','2026-09-30',id,{...operations,compare:async()=>{comparisons++;throw Error('channel');},recordFailure:async()=>{throw Error('database');}})).rejects.toThrow('database');expect(comparisons).toBe(1);
 });
 it('caps new work, resumes committed prefix without spending the next budget, and finishes the same range',async()=>{
  const committed=new Set<string>(),calls:string[]=[];
  const ops={resume:async(_:string,run:string)=>committed.has(run),compare:async(date:string,run:string)=>{calls.push(date);committed.add(run);}};
  const first=await runWechatBillRange('2026-09-28','2026-09-30',id,ops,{maxNewDays:1});
  expect(first.pendingDays).toBe(2);expect(first.nextDate).toBe('2026-09-29');expect(first.stopReason).toBe('PER_RUN_LIMIT');expect(billRangeRunExitCode(first)).toBe(3);
  const second=await runWechatBillRange('2026-09-28','2026-09-30',id,ops,{maxNewDays:2});
  expect(second.days.map(x=>x.status)).toEqual(['RESUMED','OBSERVED','OBSERVED']);expect(second.pendingDays).toBe(0);expect(second.executionState).toBe('RANGE_PROCESSED');expect(billRangeRunExitCode(second)).toBe(0);expect(calls).toEqual(['2026-09-28','2026-09-29','2026-09-30']);
 });
 it('drains started work and checks cancellation again after asynchronous recovery',async()=>{
  const controller=new AbortController(),calls:string[]=[];
  const result=await runWechatBillRange('2026-09-29','2026-09-30',id,{resume:async()=>false,compare:async date=>{calls.push(date);controller.abort();await Promise.resolve();}},{signal:controller.signal});
  expect(calls).toEqual(['2026-09-29']);expect(result.days[0]!.status).toBe('OBSERVED');expect(result.pendingDays).toBe(1);expect(result.stopReason).toBe('SIGNAL');
  const next=new AbortController();let sends=0;
  const before=await runWechatBillRange('2026-09-30','2026-09-30',id,{resume:async()=>{next.abort();return false;},compare:async()=>{sends++;}},{signal:next.signal});expect(sends).toBe(0);expect(before.pendingDays).toBe(1);expect(before.days).toEqual([]);
 });
 it('counts failure against budget, commits its journal, and never hides failure behind a pause',async()=>{
  const recorded:string[]=[];
  const result=await runWechatBillRange('2026-09-29','2026-09-30',id,{resume:async()=>false,compare:async()=>{throw Error('channel');},recordFailure:async date=>{recorded.push(date);}},{maxNewDays:1});
  expect(recorded).toEqual(['2026-09-29']);expect(result.pendingDays).toBe(1);expect(result.failedDays).toBe(1);expect(billRangeRunExitCode(result)).toBe(2);
 });
 it('rejects malformed invocation limits before performing recovery or channel work',async()=>{
  for(const value of ['', '0','01','367','-1','1.5','1e2',' 1'])expect(()=>billRangeRunLimit(value)).toThrow();
  expect(billRangeRunLimit(undefined)).toBe(366);
  let calls=0;for(const maxNewDays of [0,367,NaN,1.5])await expect(runWechatBillRange('2026-09-30','2026-09-30',id,{resume:async()=>{calls++;return false;},compare:async()=>{}},{maxNewDays})).rejects.toThrow();expect(calls).toBe(0);
 });

});
