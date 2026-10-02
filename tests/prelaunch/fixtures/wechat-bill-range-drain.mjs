import {pathToFileURL} from 'node:url';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo||!process.send)throw Error('Owned process QA required');
const {runWechatBillRange,billRangeRunExitCode,installBillRangeDrainSignals}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-runner.js`));
const controller=new AbortController(),remove=installBillRangeDrainSignals(controller);
// Synthetic operations only; shared production orchestration and signal handler.
const result=await runWechatBillRange('2026-09-29','2026-09-30','11111111-1111-4111-a111-111111111111',{
 resume:async()=>false,
 compare:async date=>{const released=new Promise(resolve=>process.once('message',resolve));process.send({stage:'STARTED',date});await released;process.send({stage:'COMMITTED',date});}
},{signal:controller.signal});
remove();process.send({stage:'RESULT',result},()=>{process.exitCode=billRangeRunExitCode(result);process.disconnect();});
