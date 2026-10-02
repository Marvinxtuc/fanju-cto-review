import test from 'node:test';
import assert from 'node:assert/strict';
import {normalizeRequestTiming} from '../../scripts/prelaunch-log-metrics.mjs';
test('request metric precision is bounded while secret/phone fields remain visible to scanner',()=>{
 const input={level:30,msg:'request completed',reqId:'synthetic-request',responseTime:89+(13812*10**6+345678)/10**11,phone:'13800138000',token:'synthetic-field'};
 const out=JSON.parse(normalizeRequestTiming(JSON.stringify(input)));
 assert.equal(out.responseTime,89.138);assert.equal(out.phone,input.phone);assert.equal(out.token,input.token);
 for(const value of ['malformed line',JSON.stringify({...input,msg:'other'}),JSON.stringify({...input,responseTime:'13800138000'})])assert.equal(normalizeRequestTiming(value),value);
});
