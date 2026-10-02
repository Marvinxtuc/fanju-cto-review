import {createHash} from 'node:crypto';
import {describe,it,expect} from 'vitest';
import {inspectFormalBusinessParameters,formalParameterDependencies} from './formal-business-parameters.js';
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const unresolved=()=>({scope:'FORMAL_BUSINESS_PARAMETERS',version:'synthetic-v1',defaultServiceFeeCents:null,depositMinCents:null,depositMaxCents:null,
 waitlistMax:null,waitlistExposureCents:null,memberRemovalEvent:null,fifoClock:null,fifoTieBreak:null,refundBatchUtcMinutes:null,refundDispatchSlaSeconds:null});
const parse=(value:unknown)=>{const raw=JSON.stringify(value);return inspectFormalBusinessParameters(raw,hash(raw));};
describe('formal parameters preserve missing decisions',()=>{
 it('retains unresolved values without inventing defaults',()=>{expect(parse(unresolved()).defaultServiceFeeCents).toBeNull();});
 it('maps dependencies to each action instead of one global freeze',()=>{
  const p=parse(unresolved());expect(formalParameterDependencies(p,'FORMAL_QUOTE')).toEqual(['OP-03']);
  expect(formalParameterDependencies(p,'WAITLIST_QUOTE')).toEqual(['OP-03','OP-08','OP-05']);
  expect(formalParameterDependencies(p,'REMOVE_MEMBER')).toEqual(['OP-04']);expect(formalParameterDependencies(p,'REFUND_BATCH')).toEqual(['OP-11']);
 });
 it('does not tie refunds to new-charge pricing',()=>{const p=parse({...unresolved(),refundBatchUtcMinutes:[60],refundDispatchSlaSeconds:300});
  expect(formalParameterDependencies(p,'REFUND_BATCH')).toEqual([]);expect(formalParameterDependencies(p,'FORMAL_QUOTE')).toEqual(['OP-03']);});
 it.each([{defaultServiceFeeCents:-1},{depositMinCents:200,depositMaxCents:100},{refundBatchUtcMinutes:[60,60]},
  {fifoClock:'CLIENT_PAID_AT'},{approved:true},{waitlistExposureCents:2147483648}])('rejects invalid or blanket configuration %j',bad=>{expect(()=>parse({...unresolved(),...bad})).toThrow();});
 it('rejects tampered raw bytes despite valid schema',()=>{const raw=JSON.stringify(unresolved());expect(()=>inspectFormalBusinessParameters(raw+' ',hash(raw))).toThrow();});
});
