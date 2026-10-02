import {describe,it,expect} from 'vitest';
import {billRangeDays,summarizeWechatBillRange} from './wechat-bill-range.js';
const binding={channel:'wechat',merchantScope:'a'.repeat(64),providerConfigId:'synthetic-v1'},release='synthetic-release';
function evidence(date:string,ordinal:string){return{decisionOrdinal:ordinal,identity:{billDate:date,binding,releaseVersion:release,comparisonVersion:'v11-bill-snapshot-3'},result:{billDate:date,scope:'BILL_AND_RECORDED_FUNDS_SNAPSHOT',coverageState:'INCOMPLETE',releaseAuthorized:false,differences:0}};}
describe('explicit contiguous bill coverage inspection',()=>{
 it('enumerates leap days and rejects impossible, reversed or oversized ranges',()=>{expect(billRangeDays('2024-02-28','2024-03-01')).toEqual(['2024-02-28','2024-02-29','2024-03-01']);for(const [a,b] of [['2026-02-30','2026-03-01'],['2026-03-01','2026-02-28'],['2024-01-01','2026-01-01']])expect(()=>billRangeDays(a!,b!)).toThrow();});
 it('reports missing intermediate days and never turns presence into completion',()=>{const result=summarizeWechatBillRange(binding,release,'2026-09-28','2026-09-30',[evidence('2026-09-28','1'),evidence('2026-09-30','2')]);expect(result.expectedDays).toBe(3);expect(result.missingDays).toBe(1);expect(result.days[1]!.status).toBe('MISSING');expect(result.coverageState).toBe('INCOMPLETE');expect(result.releaseAuthorized).toBe(false);});
 it('latest ordinal blocks stale releases instead of falling back to older matching evidence',()=>{const latest=evidence('2026-09-30','2');latest.identity.releaseVersion='other-release';expect(summarizeWechatBillRange(binding,release,'2026-09-30','2026-09-30',[evidence('2026-09-30','1'),latest]).days[0]!.status).toBe('VERSION_MISMATCH');});
 it('rejects unknown ordinal ordering, equal ordinals and claimed completion',()=>{const first=evidence('2026-09-30','1');for(const rows of [[{...first,decisionOrdinal:undefined}],[first,first],[{...first,result:{...first.result,coverageState:'COMPLETE'}}]])expect(summarizeWechatBillRange(binding,release,'2026-09-30','2026-09-30',rows).days[0]!.status).not.toBe('INCOMPLETE');});
 it('isolates merchant scope and rejects incompatible provider config',()=>{const row=evidence('2026-09-30','1');expect(summarizeWechatBillRange({...binding,merchantScope:'b'.repeat(64)},release,'2026-09-30','2026-09-30',[row]).days[0]!.status).toBe('MISSING');expect(summarizeWechatBillRange({...binding,providerConfigId:'other'},release,'2026-09-30','2026-09-30',[row]).days[0]!.status).toBe('VERSION_MISMATCH');});
 it('folds high-volume unordered history without losing cross-page conflicts',()=>{
  const rows=Array.from({length:600},(_,i)=>evidence('2026-09-30',String(i+1)));
  rows.reverse();expect(summarizeWechatBillRange(binding,release,'2026-09-30','2026-09-30',rows).observedDays).toBe(1);
  expect(summarizeWechatBillRange(binding,release,'2026-09-30','2026-09-30',[...rows,evidence('2026-09-30','600')]).days[0]!.status).toBe('AMBIGUOUS_ORDERING');
  expect(summarizeWechatBillRange(binding,release,'2026-09-30','2026-09-30',[...rows,{...evidence('2026-09-30','1'),decisionOrdinal:null}]).days[0]!.status).toBe('UNSUPPORTED_ORDERING');
  // A duplicate older ordinal does not supersede the unique latest observation.
  expect(summarizeWechatBillRange(binding,release,'2026-09-30','2026-09-30',[...rows,evidence('2026-09-30','1')]).observedDays).toBe(1);
 });

});
