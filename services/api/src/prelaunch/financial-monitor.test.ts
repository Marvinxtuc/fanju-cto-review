import {describe,it,expect} from 'vitest';
import {summarizeFinancialMonitor,validateMonitorLimits} from './financial-monitor.js';
const limits={dueJobs:5,manualJobs:1,expiredLeases:1,overdueCases:1,oldestDueSeconds:60,heartbeatSeconds:30};
const normal={dueJobs:0,manualJobs:0,expiredLeases:0,overdueCases:0,oldestDueSeconds:0,freshQueryWorkers:1};
describe('financial aggregate monitoring',()=>{
 it('alerts at exact thresholds and includes missing query workers',()=>{const result=summarizeFinancialMonitor(new Date('2026-10-01'),{dueJobs:5,manualJobs:1,expiredLeases:1,overdueCases:1,oldestDueSeconds:60,freshQueryWorkers:0},limits);expect(result.alerts).toEqual(['DUEJOBS','MANUALJOBS','EXPIREDLEASES','OVERDUECASES','OLDESTDUESECONDS','QUERY_WORKER_UNAVAILABLE']);expect(result.releaseAuthorized).toBe(false);});
 it('a quiet observation grants no release authority',()=>{const result=summarizeFinancialMonitor(new Date(),normal,limits);expect(result.status).toBe('NO_THRESHOLD_BREACH');expect(result.releaseAuthorized).toBe(false);});
 it('requires explicit valid thresholds, counters and clock',()=>{for(const value of [0,-1,1.5,NaN,86401])expect(()=>validateMonitorLimits({...limits,dueJobs:value})).toThrow();expect(()=>validateMonitorLimits({...limits,heartbeatSeconds:31})).toThrow();expect(()=>summarizeFinancialMonitor(new Date(NaN),normal,limits)).toThrow();expect(()=>summarizeFinancialMonitor(new Date(),{...normal,manualJobs:-1},limits)).toThrow();});
});
