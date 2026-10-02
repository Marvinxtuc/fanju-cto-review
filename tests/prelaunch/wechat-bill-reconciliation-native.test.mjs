import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,createSign,X509Certificate} from 'node:crypto';
import {execFileSync,fork,spawn} from 'node:child_process';
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {pathToFileURL} from 'node:url';
import {syntheticBill} from './fixtures/synthetic-bill.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');
const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {downloadWechatTradeBill}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-trade-bill.js`));
const {reconcileDownloadedWechatBill}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-reconciliation.js`));
test('verified bill snapshot detects both directions without granting financial state',async t=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);
 const dir=mkdtempSync(join(tmpdir(),'fanju-bill-native-'));const prefix='bill_native_'+randomUUID().replaceAll('-',''),date='2026-09-30',owner=prefix+'_owner',release='synthetic-bill-release';
 try{
  execFileSync('openssl',['req','-x509','-newkey','rsa:2048','-nodes','-keyout',join(dir,'key.pem'),'-out',join(dir,'cert.pem'),'-days','1','-subj','/CN=fanju-synthetic-bill-native'],{stdio:'ignore'});
  const key=readFileSync(join(dir,'key.pem'),'utf8'),cert=readFileSync(join(dir,'cert.pem'),'utf8'),serial=new X509Certificate(cert).serialNumber;
  const env={WECHAT_PAY_ENABLED:'true',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat',WECHAT_PAY_MCH_ID:prefix+'_mch',WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_PAY_PRIVATE_KEY_PATH:'synthetic-private',WECHAT_PAY_PLATFORM_CERT_PATH:'synthetic-platform',WECHAT_PAY_CERT_SERIAL_NO:'synthetic-serial',WECHAT_PAY_CONFIG_VERSION:prefix};
  async function acquire(raw,day=date){
   const metadata=JSON.stringify({hash_type:'SHA1',hash_value:createHash('sha1').update(raw).digest('hex'),download_url:'https://api.mch.weixin.qq.com/v3/billdownload/file?token=fixture-bill'}),timestamp=String(Math.floor(Date.now()/1000)),nonce='synthetic-nonce';const signer=createSign('RSA-SHA256');signer.update(`${timestamp}\n${nonce}\n${metadata}\n`);signer.end();
   let calls=0;return downloadWechatTradeBill(env,day,{readFile:path=>path==='synthetic-private'?key:cert,fetch:async()=>++calls===1?new Response(metadata,{headers:{'wechatpay-timestamp':timestamp,'wechatpay-nonce':nonce,'wechatpay-serial':serial,'wechatpay-signature':signer.sign(key,'base64')}}):new Response(raw)});
  }
  const sample=await db.v11Registration.findFirstOrThrow(),sampleConsent=await db.v11BundleConsent.findUniqueOrThrow({where:{id:sample.consentId}});
  const user=await db.user.create({data:{wechatOpenid:'mock_'+prefix}}),consent=await db.v11BundleConsent.create({data:{...sampleConsent,id:prefix+'_consent',userId:user.id}});
  const reg=await db.v11Registration.create({data:{...sample,id:prefix+'_reg',userId:user.id,consentId:consent.id,active:false}});
  const binding={channel:'wechat',merchantScope:createHash('sha256').update(env.WECHAT_PAY_MCH_ID+':synthetic-app').digest('hex'),providerConfigId:prefix};
  const intent=await db.v11PaymentIntent.create({data:{...binding,registrationId:reg.id,merchantOrderNo:prefix+'_order',totalCents:100,active:false,state:'CLOSED'}});
  const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,merchantOrderNo:intent.merchantOrderNo,channelTradeNo:prefix+'_trade',amountCents:100,evidenceHash:'synthetic-bill',verifiedAt:new Date(),paidAt:new Date(date+'T02:00:00Z')}});
  const refund=await db.v11RefundInstruction.create({data:{...binding,registrationId:reg.id,receiptId:receipt.id,businessKey:prefix+'_refund',merchantRefundNo:prefix+'_refund',originalTradeNo:receipt.channelTradeNo,totalCents:40,serviceFeeCents:40,depositCents:0,state:'UNKNOWN'}});
  const missing=await db.v11PaymentIntent.create({data:{...binding,registrationId:reg.id,merchantOrderNo:prefix+'_local-only',totalCents:100,active:false,state:'CLOSED'}});
  const missingReceipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,merchantOrderNo:missing.merchantOrderNo,channelTradeNo:prefix+'_local-trade',amountCents:100,evidenceHash:'synthetic-bill',verifiedAt:new Date(),paidAt:new Date(date+'T02:00:00Z')}});
  const records=[{kind:'PAYMENT',amountCents:100,orderNo:intent.merchantOrderNo,tradeNo:receipt.channelTradeNo},{kind:'REFUND',amountCents:40,refundCashCents:30,orderNo:intent.merchantOrderNo,tradeNo:receipt.channelTradeNo,merchantRefundNo:refund.merchantRefundNo,refundNo:prefix+'_channel-refund'}, {kind:'PAYMENT',amountCents:500,orderNo:prefix+'_orphan-order',tradeNo:prefix+'_orphan-trade'}, {kind:'REFUND',amountCents:30,orderNo:prefix+'_orphan-order',tradeNo:prefix+'_orphan-trade',merchantRefundNo:prefix+'_orphan-refund',refundNo:prefix+'_orphan-channel-refund'}, {kind:'PAYMENT',amountCents:20,appId:'other-app',orderNo:prefix+'_other-app-order',tradeNo:prefix+'_other-app-trade'}];
  const bill=await acquire(syntheticBill(date,records,env.WECHAT_PAY_MCH_ID)),runId=randomUUID();let result;
  await t.test('forged copied provenance and changed raw bytes fail before database writes',async()=>{
   await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,{...bill},owner,release,runId));const first=bill.rawBill[0];bill.rawBill[0]=0;await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,bill,owner,release,runId));bill.rawBill[0]=first;
   assert.equal(await db.auditLog.count({where:{targetId:runId}}),0);
  });
  await t.test('concurrent replay persists one snapshot, evidence, cases and query-only jobs',async()=>{
   const values=await Promise.all([reconcileDownloadedWechatBill(db,env,bill,owner,release,runId),reconcileDownloadedWechatBill(db,env,bill,owner,release,runId)]);assert.deepEqual(values[0],values[1]);result=values[0];
   assert.equal(result.totalBillRows,5);assert.equal(result.outsideApplicationRows,1);assert.equal(result.applicationPaymentRows,2);assert.equal(result.applicationRefundRows,2);assert.equal(result.differences,4);assert.equal(result.paymentQueriesQueued,2);assert.equal(result.refundQueriesQueued,1);assert.equal(result.coverageState,'INCOMPLETE');assert.equal(result.releaseAuthorized,false);
   assert.equal(await db.auditLog.count({where:{targetId:runId,action:'funding.v11-trade-bill-snapshot'}}),1);assert.equal(await db.financialCase.count({where:{owner}}),4);
   const jobs=await db.durableJob.findMany({where:{businessKey:{startsWith:'v11:bill-query:'+runId}}});assert.equal(jobs.length,3);assert.ok(jobs.every(x=>['V11_QUERY_PAYMENT','V11_QUERY_REFUND'].includes(x.kind)));
   const events=await db.receivedEvent.findMany({where:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:{startsWith:'BILL:'+bill.sourceSha256}}});assert.equal(events.length,4);assert.ok(events.every(x=>x.state==='MANUAL'));assert.ok(!JSON.stringify(events).includes('synthetic-user-not-exported'));
   const unknown=await db.financialCase.findFirstOrThrow({where:{owner,category:'V11_BILL_PAYMENT_WITHOUT_INTENT'}});assert.ok(events.some(x=>x.id===unknown.sourceRef));
   assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}})).state,'UNKNOWN');assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:intent.id}})).state,'CLOSED');assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:reg.id}})).active,false);assert.equal(await db.channelReceipt.count({where:{merchantOrderNo:{startsWith:prefix}}}),2);
  });
  await t.test('a run UUID cannot be reused for a changed owner or release',async()=>{for(const [changedOwner,changedRelease] of [[owner+'x',release],[owner,release+'x']])await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,bill,changedOwner,changedRelease,runId),/replay identity conflict/);});
  await t.test('signed but malformed summary has no partial intake or audit',async()=>{
   const bad=await acquire(Buffer.from(syntheticBill(date,records,env.WECHAT_PAY_MCH_ID).toString().replace('`5,`6.20','`5,`99.00'))),id=randomUUID();await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,bad,owner,release,id),/CSV/);assert.equal(await db.auditLog.count({where:{targetId:id}}),0);assert.equal(await db.receivedEvent.count({where:{eventKey:{startsWith:'BILL:'+bad.sourceSha256}}}),0);
  });
  await t.test('a newer empty bill detects local receipts instead of declaring zero differences',async()=>{
   const empty=await acquire(syntheticBill(date,[],env.WECHAT_PAY_MCH_ID)),id=randomUUID(),report=await reconcileDownloadedWechatBill(db,env,empty,owner,release,id);assert.equal(report.totalBillRows,0);assert.ok(report.differences>=2);assert.equal(report.coverageState,'INCOMPLETE');const batch=await db.reconciliationBatch.findUniqueOrThrow({where:{merchantScope_period_sourceHash:{merchantScope:binding.merchantScope,period:date,sourceHash:'v11:'+empty.sourceSha256}}});assert.equal(batch.coverageState,'INCOMPLETE');
  });
  await t.test('a persisted evidence conflict rolls back all earlier event and job writes',async()=>{
   const conflictBill=await acquire(syntheticBill(date,[records[0],{kind:'PAYMENT',amountCents:25,orderNo:prefix+'_conflict-order',tradeNo:prefix+'_conflict-trade'}],env.WECHAT_PAY_MCH_ID)),id=randomUUID();
   await db.receivedEvent.create({data:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:'BILL:'+conflictBill.sourceSha256+':1',payloadHash:'synthetic-conflicting-hash',normalizedPayload:{scope:'synthetic-corruption-test'},verificationMaterialId:prefix,verifiedAt:new Date(),state:'MANUAL'}});
   await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,conflictBill,owner,release,id),/observation identity conflict/);
   assert.equal(await db.auditLog.count({where:{targetId:id}}),0);assert.equal(await db.durableJob.count({where:{businessKey:{startsWith:'v11:bill-query:'+id}}}),0);
   assert.equal(await db.receivedEvent.count({where:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:'BILL:'+conflictBill.sourceSha256+':0'}}),0);
  });
  await t.test('conflicting gross amounts remain independent evidence without overwriting money',async()=>{
   const conflicting=await acquire(syntheticBill(date,[{...records[0],amountCents:125},{...records[1],amountCents:45}],env.WECHAT_PAY_MCH_ID)),id=randomUUID();
   const report=await reconcileDownloadedWechatBill(db,env,conflicting,owner,release,id);assert.ok(report.differences>=3);
   const audit=await db.auditLog.findFirstOrThrow({where:{targetId:id,action:'funding.v11-trade-bill-snapshot'}}),cases=await db.financialCase.findMany({where:{id:{in:audit.metadata.caseIds}}});
   for(const category of ['V11_BILL_PAYMENT_AMOUNT_CONFLICT','V11_BILL_PAYMENT_RECEIPT_CONFLICT','V11_BILL_REFUND_FACT_CONFLICT'])assert.ok(cases.some(x=>x.category===category));
   assert.equal((await db.channelReceipt.findUniqueOrThrow({where:{id:receipt.id}})).amountCents,100);assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:intent.id}})).totalCents,100);assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}})).totalCents,40);
   await assert.rejects(()=>reconcileDownloadedWechatBill(db,{...env,WECHAT_PAY_CONFIG_VERSION:prefix+'_other'},conflicting,owner,release,randomUUID()),/identity required/);
  });
  await t.test('new snapshot can observe resolution without automatically closing old cases',async()=>{
   await db.v11RefundInstruction.update({where:{id:refund.id},data:{state:'CONFIRMED',channelRefundNo:prefix+'_channel-refund'}});
   const report=await reconcileDownloadedWechatBill(db,env,bill,owner,release,randomUUID());assert.equal(report.differences,4);assert.equal((await db.channelReceipt.findUniqueOrThrow({where:{id:missingReceipt.id}})).paidAt.toISOString(),date+'T02:00:00.000Z');assert.equal(report.confirmedRefundsWithoutTrustedPeriod,1);assert.equal(report.refundPeriodCoverage,'UNRESOLVED');assert.equal(report.coverageState,'INCOMPLETE');assert.ok((await db.financialCase.findMany({where:{owner}})).every(x=>x.state==='OPEN'));
  });
  await t.test('trusted completion time exposes local refunds absent from the selected bill',async()=>{
   const {recordVerifiedRefundTime}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/refund-completion-time.js`));
   const current=await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}});
   await db.$transaction(tx=>recordVerifiedRefundTime(tx,current,receipt,{status:'SUCCEEDED',merchantRefundNo:current.merchantRefundNo,channelRefundNo:current.channelRefundNo,originalTradeNo:current.originalTradeNo,amountCents:40,currency:'CNY',refundedAt:date+'T02:00:00.000Z'},owner));
   const extra=await db.v11RefundInstruction.create({data:{...binding,registrationId:reg.id,receiptId:receipt.id,businessKey:prefix+'_extra-refund',merchantRefundNo:prefix+'_extra-refund',originalTradeNo:receipt.channelTradeNo,totalCents:40,serviceFeeCents:40,depositCents:0,state:'CONFIRMED',channelRefundNo:prefix+'_extra-channel'}});
   await db.$transaction(tx=>recordVerifiedRefundTime(tx,extra,receipt,{status:'SUCCEEDED',merchantRefundNo:extra.merchantRefundNo,channelRefundNo:extra.channelRefundNo,originalTradeNo:extra.originalTradeNo,amountCents:40,currency:'CNY',refundedAt:date+'T03:00:00.000Z'},owner));
   const outside=await db.v11RefundInstruction.create({data:{...binding,registrationId:reg.id,receiptId:receipt.id,businessKey:prefix+'_outside-refund',merchantRefundNo:prefix+'_outside-refund',originalTradeNo:receipt.channelTradeNo,totalCents:20,serviceFeeCents:20,depositCents:0,state:'CONFIRMED',channelRefundNo:prefix+'_outside-channel'}});
   await db.$transaction(tx=>recordVerifiedRefundTime(tx,outside,receipt,{status:'SUCCEEDED',merchantRefundNo:outside.merchantRefundNo,channelRefundNo:outside.channelRefundNo,originalTradeNo:outside.originalTradeNo,amountCents:20,currency:'CNY',refundedAt:date+'T16:00:00.000Z'},owner));
   const id=randomUUID(),report=await reconcileDownloadedWechatBill(db,env,bill,owner,release,id);assert.equal(report.confirmedRefundsWithoutTrustedPeriod,0);assert.equal(report.confirmedRefundsInPeriod,2);assert.equal(report.refundPeriodCoverage,'OBSERVED');assert.equal(report.coverageState,'INCOMPLETE');
   const audit=await db.auditLog.findFirstOrThrow({where:{targetId:id,action:'funding.v11-trade-bill-snapshot'}});assert.ok(await db.financialCase.findFirst({where:{id:{in:audit.metadata.caseIds},category:'V11_BILL_LOCAL_REFUND_ABSENT_OR_CONFLICT',sourceRef:extra.id}}));assert.equal(await db.financialCase.count({where:{id:{in:audit.metadata.caseIds},sourceRef:outside.id}}),0);
   await db.$transaction(tx=>recordVerifiedRefundTime(tx,current,receipt,{status:'SUCCEEDED',merchantRefundNo:current.merchantRefundNo,channelRefundNo:current.channelRefundNo,originalTradeNo:current.originalTradeNo,amountCents:40,currency:'CNY',refundedAt:date+'T03:00:00.000Z'},owner));
   const conflicted=await reconcileDownloadedWechatBill(db,env,bill,owner,release,randomUUID());assert.equal(conflicted.refundPeriodCoverage,'UNRESOLVED');assert.equal(conflicted.refundTimeConflicts,1);assert.equal(conflicted.confirmedRefundsWithoutTrustedPeriod,1);assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:refund.id}})).state,'CONFIRMED');
  });
  await t.test('requested range finds the missing day from actual committed audit ordinals without writes',async()=>{
   const {inspectWechatBillRange}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range.js`));
   const before=await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',metadata:{path:['identity','binding','merchantScope'],equals:binding.merchantScope}}});
   const report=await inspectWechatBillRange(db,binding,release,'2026-09-29',date);assert.equal(report.expectedDays,2);assert.equal(report.missingDays,1);assert.equal(report.days[0].status,'MISSING');assert.equal(report.days[1].status,'INCOMPLETE');assert.equal(report.releaseAuthorized,false);
   assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',metadata:{path:['identity','binding','merchantScope'],equals:binding.merchantScope}}}),before);
  });
  await t.test('range inspection pages actual audit history and keeps late-page conflicts blocking',async()=>{
   const {inspectWechatBillRange}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range.js`));
   const scoped={...binding,merchantScope:createHash('sha256').update(randomUUID()).digest('hex')};
   const prefix='bill-paging-'+randomUUID();
   const evidence=ordinal=>({decisionOrdinal:String(ordinal),identity:{billDate:date,binding:scoped,releaseVersion:release,comparisonVersion:'v11-bill-snapshot-3'},result:{billDate:date,scope:'BILL_AND_RECORDED_FUNDS_SNAPSHOT',coverageState:'INCOMPLETE',releaseAuthorized:false,differences:0}});
   const record=(id,metadata)=>({id:prefix+id,action:'funding.v11-trade-bill-snapshot',targetType:'V11TradeBillRun',targetId:prefix,metadata});
   try{
    await db.auditLog.createMany({data:Array.from({length:501},(_,i)=>record(String(i).padStart(4,'0'),evidence(i+1)))});
    const pageSizes=[];
    const observedDb={$transaction:(callback,options)=>db.$transaction(tx=>callback(new Proxy(tx,{get(target,key){
     if(key!=='auditLog')return Reflect.get(target,key);
     return new Proxy(target.auditLog,{get(delegate,method){if(method!=='findMany')return Reflect.get(delegate,method);return async args=>{assert.equal(args.take,250);assert.deepEqual(args.orderBy,{id:'asc'});const rows=await delegate.findMany(args);pageSizes.push(rows.length);return rows;};}});
    }})),options)};
    assert.equal((await inspectWechatBillRange(observedDb,scoped,release,date,date)).observedDays,1);
    assert.deepEqual(pageSizes,[250,250,1]);
    await db.auditLog.create({data:record('9991',evidence(501))});
    assert.equal((await inspectWechatBillRange(db,scoped,release,date,date)).days[0].status,'AMBIGUOUS_ORDERING');
    await db.auditLog.create({data:record('9992',{...evidence(1),decisionOrdinal:null})});
    assert.equal((await inspectWechatBillRange(db,scoped,release,date,date)).days[0].status,'UNSUPPORTED_ORDERING');
    // Malformed out-of-range evidence cannot poison the requested day.
    assert.equal((await inspectWechatBillRange(db,scoped,release,'2026-09-29','2026-09-29')).missingDays,1);
   }finally{await db.auditLog.deleteMany({where:{targetId:prefix,id:{startsWith:prefix}}});}
  });
  await t.test('daily recovery uses committed audit and rejects changed identity without downloads',async()=>{
   const {hasCommittedBillDay,runWechatBillRange}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-runner.js`));
   assert.equal(await hasCommittedBillDay(db,binding,owner,release,date,runId),true);
   assert.equal(await hasCommittedBillDay(db,binding,owner,release,date,randomUUID()),false);
   for(const [b,o,r,d] of [[binding,owner+'x',release,date],[binding,owner,release+'x',date],[binding,owner,release,'2026-09-29'],[{...binding,providerConfigId:'changed'},owner,release,date]])await assert.rejects(()=>hasCommittedBillDay(db,b,o,r,d,runId),/identity conflict/);
   let calls=0;const report=await runWechatBillRange(date,date,randomUUID(),{resume:()=>hasCommittedBillDay(db,binding,owner,release,date,runId),compare:async()=>{calls++;}});
   assert.equal(calls,0);assert.equal(report.days[0].status,'RESUMED');assert.equal(report.releaseAuthorized,false);
  });
  await t.test('bounded range restart consumes committed daily snapshots without duplicate downloads',async()=>{
   const {hasCommittedBillDay,runWechatBillRange,billRangeRunExitCode}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-runner.js`));
   const {ensureWechatBillRangeTask}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-journal.js`));
   const rangeId=randomUUID(),start='2026-09-27',end='2026-09-28',calls=[];
   await ensureWechatBillRangeTask(db,{rangeId,start,end,binding,owner,releaseVersion:release});
   const ops={resume:(day,id)=>hasCommittedBillDay(db,binding,owner,release,day,id),compare:async(day,id)=>{calls.push(day);const downloaded=await acquire(syntheticBill(day,[],env.WECHAT_PAY_MCH_ID),day);await reconcileDownloadedWechatBill(db,env,downloaded,owner,release,id);}};
   const first=await runWechatBillRange(start,end,rangeId,ops,{maxNewDays:1});assert.equal(billRangeRunExitCode(first),3);assert.equal(first.pendingDays,1);
   const second=await runWechatBillRange(start,end,rangeId,ops,{maxNewDays:1});assert.equal(billRangeRunExitCode(second),0);assert.deepEqual(second.days.map(x=>x.status),['RESUMED','OBSERVED']);assert.deepEqual(calls,[start,end]);assert.equal(second.releaseAuthorized,false);
  });
  await t.test('shared core phases use the entire verified bill for reverse checks and reject forged contexts',async()=>{
   const {createBillComparisonPlan,readBillComparisonFacts,executeBillComparisonCore}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-comparison-core.js`));
   const plan=createBillComparisonPlan(bill,env);
   assert.ok(Object.isFrozen(plan)&&Object.isFrozen(plan.observations)&&plan.observations.every(Object.isFrozen));
   assert.throws(()=>createBillComparisonPlan(bill,{...env,WECHAT_MINIAPP_APP_ID:'other-app'}),/binding conflict/);
   const facts=await db.$transaction(tx=>readBillComparisonFacts(tx,binding,plan),{isolationLevel:'RepeatableRead'});
   const run=randomUUID();
   const first=await db.$transaction(tx=>executeBillComparisonCore(tx,bill,owner,run,binding,plan,facts,{phase:'FORWARD',start:0,end:1}));
   assert.equal(first.stats.applicationPaymentRows,1);assert.equal(first.stats.applicationRefundRows,0);assert.equal(first.stats.recordedPaymentRowsInPeriod,0);assert.equal(first.stats.confirmedRefundsInPeriod,0);
   const second=await db.$transaction(tx=>executeBillComparisonCore(tx,bill,owner,run,binding,plan,facts,{phase:'FORWARD',start:1,end:2}));
   assert.equal(second.stats.applicationPaymentRows,0);assert.equal(second.stats.applicationRefundRows,1);assert.equal(second.stats.recordedPaymentRowsInPeriod,0);
   const periodReceipts=facts.receipts.filter(x=>x.paidAt&&x.paidAt>=new Date(date+'T00:00:00+08:00')&&x.paidAt<new Date('2026-10-01T00:00:00+08:00'));
   const later=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,channelTradeNo:prefix+'_after-core-snapshot',merchantOrderNo:missing.merchantOrderNo,amountCents:100,evidenceHash:'synthetic-core-after-snapshot',verifiedAt:new Date(),paidAt:new Date(date+'T02:00:00Z')}});
   try{
    assert.equal(await db.channelReceipt.count({where:{channel:'wechat',merchantScope:binding.merchantScope,paidAt:{gte:new Date(date+'T00:00:00+08:00'),lt:new Date('2026-10-01T00:00:00+08:00')}}}),periodReceipts.length+1);
    if(periodReceipts.length){const reverse=await db.$transaction(tx=>executeBillComparisonCore(tx,bill,owner,run,binding,plan,facts,{phase:'REVERSE_RECEIPTS',start:0,end:periodReceipts.length}));assert.equal(reverse.stats.applicationPaymentRows,0);assert.equal(reverse.stats.recordedPaymentRowsInPeriod,periodReceipts.length);
     assert.equal(await db.financialCase.count({where:{id:{in:reverse.caseIds},category:'V11_BILL_LOCAL_PAYMENT_ABSENT',sourceRef:receipt.id}}),0);
     assert.equal(await db.financialCase.count({where:{id:{in:reverse.caseIds},sourceRef:later.id}}),0);
    }
   }finally{await db.channelReceipt.deleteMany({where:{id:later.id,merchantScope:binding.merchantScope}});} 
   const before=await db.financialCase.count({where:{owner}});
   for(const [badPlan,badFacts,range] of [[{...plan},facts,{phase:'FORWARD',start:0,end:1}],[plan,{...facts},{phase:'FORWARD',start:0,end:1}],[plan,facts,{phase:'FORWARD',start:-1,end:1}],[plan,facts,{phase:'UNKNOWN',start:0,end:1}],[plan,facts,{phase:'FORWARD',start:0,end:plan.observations.length+1}]])await assert.rejects(()=>db.$transaction(tx=>executeBillComparisonCore(tx,bill,owner,randomUUID(),binding,badPlan,badFacts,range)));
   assert.equal(await db.financialCase.count({where:{owner}}),before);
   assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:run}}),0);
  });
  await t.test('persistent snapshot pins identity and restores original facts after later channel records',async()=>{
   const {ensureBillComparisonSnapshot,loadBillComparisonSnapshot,executeBillComparisonCore}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-comparison-core.js`));
   const snapshotId=randomUUID();
   const saved=await Promise.all([ensureBillComparisonSnapshot(db,env,bill,owner,release,snapshotId),ensureBillComparisonSnapshot(db,env,bill,owner,release,snapshotId)]);
   assert.equal(saved[0].snapshotHash,saved[1].snapshotHash);assert.equal(await db.v11BillComparisonSnapshot.count({where:{id:snapshotId}}),1);
   assert.equal(await db.auditLog.count({where:{action:'funding.v11-bill-comparison-facts-captured',targetId:snapshotId}}),1);
   const row=await db.v11BillComparisonSnapshot.findUniqueOrThrow({where:{id:snapshotId}});const raw=JSON.stringify(row.snapshot);for(const field of ['prepayId','normalizedPayload','wechatOpenid','session_key'])assert.ok(!raw.includes(field));
   const loaded=await db.$transaction(tx=>loadBillComparisonSnapshot(tx,env,bill,owner,release,snapshotId));
   assert.ok(loaded.facts.receipts.every(x=>x.paidAt===null||x.paidAt instanceof Date));
   const later=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,channelTradeNo:prefix+'_after-persisted-snapshot',merchantOrderNo:missing.merchantOrderNo,amountCents:100,evidenceHash:'synthetic-persisted-after',verifiedAt:new Date(),paidAt:new Date(date+'T02:00:00Z')}});
   try{
    const resumed=await ensureBillComparisonSnapshot(db,env,bill,owner,release,snapshotId);assert.equal(resumed.snapshotHash,row.snapshotHash);
    const recovered=await db.$transaction(tx=>loadBillComparisonSnapshot(tx,env,bill,owner,release,snapshotId));assert.equal(recovered.facts.receipts.length,loaded.facts.receipts.length);assert.ok(!recovered.facts.receipts.some(x=>x.id===later.id));
    const page=await db.$transaction(tx=>executeBillComparisonCore(tx,bill,owner,snapshotId,recovered.binding,recovered.plan,recovered.facts,{phase:'FORWARD',start:0,end:1}));assert.equal(page.stats.applicationPaymentRows,1);assert.equal(page.stats.applicationRefundRows,0);
    writeFileSync(join(dir,'persisted-bill.csv'),bill.rawBill,{mode:0o600});
    const child=fork(`${repo}/tests/prelaunch/fixtures/wechat-bill-snapshot-process.mjs`,[],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});
    const closed=once(child,'exit');let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
    try{const observed=once(child,'message');child.send({directory:dir,env,owner,release,snapshotId});const [message]=await observed;const [code,signal]=await closed;assert.equal(code,0);assert.equal(signal,null);assert.deepEqual(message,{status:'LOADED',receiptCount:loaded.facts.receipts.length,snapshotHash:row.snapshotHash,datesRestored:true});assert.equal(output,'');assert.equal(errors,'');}
    finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
    const before=await db.financialCase.count({where:{owner}});
    for(const [e,o,r] of [[env,owner+'x',release],[env,owner,release+'x'],[{...env,WECHAT_PAY_CONFIG_VERSION:prefix+'x'},owner,release],[{...env,WECHAT_MINIAPP_APP_ID:'other-app'},owner,release]])await assert.rejects(()=>ensureBillComparisonSnapshot(db,e,bill,o,r,snapshotId));
    await assert.rejects(()=>db.v11BillComparisonSnapshot.update({where:{id:snapshotId},data:{outsideRows:row.outsideRows}}));
    await assert.rejects(()=>reconcileDownloadedWechatBill(db,env,bill,owner,release,snapshotId));assert.equal(await db.financialCase.count({where:{owner}}),before);
    const badId=randomUUID();await db.v11BillComparisonSnapshot.create({data:{...row,id:badId,snapshot:{...row.snapshot,receipts:[]}}});
    try{await assert.rejects(()=>db.$transaction(tx=>loadBillComparisonSnapshot(tx,env,bill,owner,release,badId)),/integrity conflict/);}finally{await db.v11BillComparisonSnapshot.delete({where:{id:badId}});}
    assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:snapshotId}}),0);
    await assert.rejects(()=>ensureBillComparisonSnapshot(db,env,bill,owner,release,runId),/Legacy bill run/);
   }finally{await db.channelReceipt.deleteMany({where:{id:later.id,merchantScope:binding.merchantScope}});await db.auditLog.deleteMany({where:{action:'funding.v11-bill-comparison-facts-captured',targetId:snapshotId}});await db.v11BillComparisonSnapshot.deleteMany({where:{id:snapshotId,merchantScope:binding.merchantScope}});}
  });
  await t.test('checkpoint commit is idempotent, immutable and verifies case/event/query evidence',async()=>{
   const {ensureBillComparisonSnapshot,loadBillComparisonSnapshot}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-comparison-core.js`));
   const {commitBillComparisonPage}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-page-checkpoint.js`));
   const id=randomUUID(),pageOwner=owner+'_page';await ensureBillComparisonSnapshot(db,env,bill,pageOwner,release,id);
   const range={phase:'FORWARD',start:0,end:records.length};
   try{
    const first=await Promise.all([commitBillComparisonPage(db,env,bill,pageOwner,release,id,range),commitBillComparisonPage(db,env,bill,pageOwner,release,id,range)]);assert.deepEqual(first.map(x=>x.status).sort(),['COMMITTED','RESUMED']);
    const key={snapshotId:id,phase:'FORWARD',start:0},stored=await db.v11BillComparisonPage.findUniqueOrThrow({where:{snapshotId_phase_start:key}});assert.equal(stored.result.applicationPaymentRows,2);assert.equal(stored.result.applicationRefundRows,2);assert.equal(stored.result.releaseAuthorized,false);
    writeFileSync(join(dir,'persisted-bill.csv'),bill.rawBill,{mode:0o600});
    const child=fork(`${repo}/tests/prelaunch/fixtures/wechat-bill-snapshot-process.mjs`,[],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});const closed=once(child,'exit');let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
    try{const observed=once(child,'message');child.send({directory:dir,env,owner:pageOwner,release,snapshotId:id,page:range});const [message]=await observed;const [code,signal]=await closed;assert.equal(code,0);assert.equal(signal,null);assert.equal(message.pageStatus,'RESUMED');assert.equal(output,'');assert.equal(errors,'');}finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
    const before=await db.financialCase.count({where:{owner:pageOwner}});await assert.rejects(()=>db.v11BillComparisonPage.update({where:{snapshotId_phase_start:key},data:{end:stored.end}}));
    for(const bad of [{phase:'FORWARD',start:1,end:records.length},{phase:'FORWARD',start:0,end:1},{phase:'UNKNOWN',start:0,end:1}])await assert.rejects(()=>commitBillComparisonPage(db,env,bill,pageOwner,release,id,bad));
    const loaded=await db.$transaction(tx=>loadBillComparisonSnapshot(tx,env,bill,pageOwner,release,id)),at=new Date(date+'T00:00:00+08:00'),until=new Date('2026-10-01T00:00:00+08:00');
    const length=loaded.facts.receipts.filter(x=>x.paidAt&&x.paidAt>=at&&x.paidAt<until).length;
    const wrong={...stored,phase:'REVERSE_RECEIPTS',end:length};await db.v11BillComparisonPage.create({data:wrong});
    try{await assert.rejects(()=>commitBillComparisonPage(db,env,bill,pageOwner,release,id,{phase:'REVERSE_RECEIPTS',start:0,end:length}),/integrity conflict/);}finally{await db.v11BillComparisonPage.delete({where:{snapshotId_phase_start:{snapshotId:id,phase:'REVERSE_RECEIPTS',start:0}}});}
    const event=await db.receivedEvent.findUniqueOrThrow({where:{source_merchantScope_eventKey:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:`BILL:${bill.sourceSha256}:0`}}});
    await db.receivedEvent.update({where:{id:event.id},data:{normalizedPayload:{...event.normalizedPayload,unexpected:'synthetic-corruption'}}});
    try{await assert.rejects(()=>commitBillComparisonPage(db,env,bill,pageOwner,release,id,range),/observation evidence missing/);}finally{await db.receivedEvent.update({where:{id:event.id},data:{normalizedPayload:event.normalizedPayload}});}
    const job=await db.durableJob.findUniqueOrThrow({where:{businessKey:`v11:bill-query:${id}:payment:${intent.id}`}});await db.durableJob.delete({where:{id:job.id}});
    try{await assert.rejects(()=>commitBillComparisonPage(db,env,bill,pageOwner,release,id,range),/query evidence missing/);}finally{await db.durableJob.create({data:job});}
    assert.equal((await commitBillComparisonPage(db,env,bill,pageOwner,release,id,range)).status,'RESUMED');assert.equal(await db.financialCase.count({where:{owner:pageOwner}}),before);assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}}),0);
   }finally{await db.v11BillComparisonPage.deleteMany({where:{snapshotId:id}});await db.v11BillComparisonSnapshot.deleteMany({where:{id,merchantScope:binding.merchantScope}});await db.auditLog.deleteMany({where:{action:'funding.v11-bill-comparison-facts-captured',targetId:id}});}
  });
  await t.test('paged finalization requires complete ranges and preserves full comparison counts and recovery',async()=>{
   const {ensureBillComparisonSnapshot}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-comparison-core.js`));
   const {commitBillComparisonPage,finalizeBillComparisonPages,reconcileDownloadedWechatBillPaged}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-page-checkpoint.js`));
   const {summarizeWechatBillRange,inspectWechatBillRange}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range.js`));
   const {hasCommittedBillDay}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-runner.js`));
   const many=await acquire(syntheticBill(date,[records[0],...Array.from({length:500},(_,i)=>({kind:'PAYMENT',amountCents:1,orderNo:prefix+'_page_many_'+i,tradeNo:prefix+'_page_trade_'+i}))],env.WECHAT_PAY_MCH_ID));
   const id=randomUUID(),fullId=randomUUID(),pageOwner=owner+'_final';
   const legacy=await reconcileDownloadedWechatBill(db,env,many,pageOwner,release,fullId);
   await ensureBillComparisonSnapshot(db,env,many,pageOwner,release,id);
   try{
    await assert.rejects(()=>finalizeBillComparisonPages(db,env,many,pageOwner,release,id),/pages incomplete/);
    await commitBillComparisonPage(db,env,many,pageOwner,release,id,{phase:'FORWARD',start:0,end:500});
    await assert.rejects(()=>finalizeBillComparisonPages(db,env,many,pageOwner,release,id),/pages incomplete/);
    assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}}),0);
    const report=await reconcileDownloadedWechatBillPaged(db,env,many,pageOwner,release,id);assert.deepEqual({...report,runId:fullId},legacy);
    const audit=await db.auditLog.findFirstOrThrow({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}});assert.equal(audit.metadata.identity.comparisonVersion,'v11-bill-snapshot-4');assert.equal(audit.metadata.pageCoverage.lengths.FORWARD,501);assert.equal(audit.metadata.pageCoverage.pageCount,4);
    const before=await db.durableJob.count({where:{businessKey:{startsWith:`v11:bill-query:${id}:`}}});
    const concurrent=await Promise.all([finalizeBillComparisonPages(db,env,many,pageOwner,release,id),reconcileDownloadedWechatBillPaged(db,env,many,pageOwner,release,id)]);assert.deepEqual(concurrent,[report,report]);assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}}),1);assert.equal(await db.durableJob.count({where:{businessKey:{startsWith:`v11:bill-query:${id}:`}}}),before);
    assert.equal(await hasCommittedBillDay(db,binding,pageOwner,release,date,id),true);
    writeFileSync(join(dir,'persisted-bill.csv'),many.rawBill,{mode:0o600});
    const child=fork(`${repo}/tests/prelaunch/fixtures/wechat-bill-snapshot-process.mjs`,[],{env:process.env,stdio:['ignore','pipe','pipe','ipc']}),closed=once(child,'exit');let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
    try{const received=once(child,'message');child.send({directory:dir,env,owner:pageOwner,release,snapshotId:id,finalize:true});const [message]=await received;const [code,signal]=await closed;assert.equal(code,0);assert.equal(signal,null);assert.deepEqual(message.finalResult,report);assert.equal(output,'');assert.equal(errors,'');}finally{if(child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}}
    for(const mutate of [x=>x.pageCoverage.pageCount++,x=>x.result.differences++,x=>x.paymentQueryRefs.push('synthetic-extra')]){const changed=structuredClone(audit.metadata);mutate(changed);assert.equal(summarizeWechatBillRange(binding,release,date,date,[changed]).days[0].status,'INVALID_EVIDENCE');}
    const page=await db.v11BillComparisonPage.findUniqueOrThrow({where:{snapshotId_phase_start:{snapshotId:id,phase:'FORWARD',start:500}}});await db.v11BillComparisonPage.delete({where:{snapshotId_phase_start:{snapshotId:id,phase:'FORWARD',start:500}}});
    try{await assert.rejects(()=>finalizeBillComparisonPages(db,env,many,pageOwner,release,id),/pages incomplete/);await assert.rejects(()=>hasCommittedBillDay(db,binding,pageOwner,release,date,id),/storage page gap/);assert.equal((await inspectWechatBillRange(db,binding,release,date,date)).days[0].status,'INVALID_EVIDENCE');}finally{await db.v11BillComparisonPage.create({data:page});}
    const damaged=structuredClone(audit.metadata);damaged.result.differences++;await db.auditLog.update({where:{id:audit.id},data:{metadata:damaged}});
    try{await assert.rejects(()=>finalizeBillComparisonPages(db,env,many,pageOwner,release,id),/final evidence conflict/);await assert.rejects(()=>hasCommittedBillDay(db,binding,pageOwner,release,date,id),/Recovery identity conflict/);}finally{await db.auditLog.update({where:{id:audit.id},data:{metadata:audit.metadata}});}
   }finally{await db.v11BillComparisonPage.deleteMany({where:{snapshotId:id}});await db.v11BillComparisonSnapshot.deleteMany({where:{id}});await db.auditLog.deleteMany({where:{targetId:id,action:{in:['funding.v11-trade-bill-snapshot','funding.v11-bill-comparison-facts-captured']}}});}
  });
  await t.test('zero forward rows still compare recorded funds and never treat missing pages as an empty day',async()=>{
   const {finalizeBillComparisonPages,reconcileDownloadedWechatBillPaged}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-page-checkpoint.js`));
   const empty=await acquire(syntheticBill(date,[],env.WECHAT_PAY_MCH_ID)),id=randomUUID(),fullId=randomUUID(),emptyOwner=owner+'_empty_final';
   const legacy=await reconcileDownloadedWechatBill(db,env,empty,emptyOwner,release,fullId);
   try{const report=await reconcileDownloadedWechatBillPaged(db,env,empty,emptyOwner,release,id);assert.deepEqual({...report,runId:fullId},legacy);assert.equal(report.totalBillRows,0);assert.ok(report.differences>0);assert.equal(await db.v11BillComparisonPage.count({where:{snapshotId:id,phase:'FORWARD'}}),0);assert.deepEqual(await finalizeBillComparisonPages(db,env,empty,emptyOwner,release,id),report);}
   finally{await db.v11BillComparisonPage.deleteMany({where:{snapshotId:id}});await db.v11BillComparisonSnapshot.deleteMany({where:{id}});await db.auditLog.deleteMany({where:{targetId:id,action:{in:['funding.v11-trade-bill-snapshot','funding.v11-bill-comparison-facts-captured']}}});}
  });
  await t.test('resumable CLI service creates paged runs and only replays committed legacy evidence',async()=>{
   const {reconcileDownloadedWechatBillResumable}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-resumable.js`));
   assert.deepEqual(await reconcileDownloadedWechatBillResumable(db,env,bill,owner,release,runId),result);assert.equal(await db.v11BillComparisonSnapshot.count({where:{id:runId}}),0);
   const prior=await db.auditLog.findFirstOrThrow({where:{action:'funding.v11-trade-bill-snapshot',targetId:runId}}),unsupported=structuredClone(prior.metadata);unsupported.identity.comparisonVersion='unknown';await db.auditLog.update({where:{id:prior.id},data:{metadata:unsupported}});
   try{await assert.rejects(()=>reconcileDownloadedWechatBillResumable(db,env,bill,owner,release,runId),/Unsupported bill replay/);}finally{await db.auditLog.update({where:{id:prior.id},data:{metadata:prior.metadata}});}
   const id=randomUUID(),routeOwner=owner+'_route';
   try{const observed=await reconcileDownloadedWechatBillResumable(db,env,bill,routeOwner,release,id);assert.equal((await db.auditLog.findFirstOrThrow({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}})).metadata.identity.comparisonVersion,'v11-bill-snapshot-4');assert.deepEqual(await reconcileDownloadedWechatBillResumable(db,env,bill,routeOwner,release,id),observed);}
   finally{await db.v11BillComparisonPage.deleteMany({where:{snapshotId:id}});await db.v11BillComparisonSnapshot.deleteMany({where:{id}});await db.auditLog.deleteMany({where:{targetId:id,action:{in:['funding.v11-trade-bill-snapshot','funding.v11-bill-comparison-facts-captured']}}});}
  });
  await t.test('SIGKILL before and after page commit preserves atomic progress and fresh-process recovery',async()=>{
   const {ensureBillComparisonSnapshot}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-comparison-core.js`));
   const {Client}=require('pg');
   for(const point of ['BEFORE','AFTER']){
    const id=randomUUID(),crashOwner=owner+'_crash_'+point,marker='bill_crash_'+id.replaceAll('-',''),name='test_bill_crash_'+id.replaceAll('-',''),lock=Number.parseInt(id.slice(0,7),16),range={phase:'FORWARD',start:0,end:records.length};
    const changed=await acquire(syntheticBill(date,records.map((x,i)=>i===0?{...x,product:'合成崩溃菜单'+point}:x),env.WECHAT_PAY_MCH_ID));await ensureBillComparisonSnapshot(db,env,changed,crashOwner,release,id);writeFileSync(join(dir,'persisted-bill.csv'),changed.rawBill,{mode:0o600});
    const hold=new Client({connectionString:process.env.DATABASE_URL});await hold.connect();let child,closed;
    try{
     if(point==='BEFORE'){await hold.query('SELECT pg_advisory_lock($1)',[lock]);await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."snapshotId"='${id}'::uuid THEN PERFORM pg_advisory_xact_lock(${lock}); END IF; RETURN NEW; END $$`);await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "V11BillComparisonPage" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);}
     child=fork(`${repo}/tests/prelaunch/fixtures/wechat-bill-snapshot-process.mjs`,[],{env:process.env,stdio:['ignore','pipe','pipe','ipc']});closed=once(child,'exit');let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);
     const message=point==='AFTER'?once(child,'message'):null;child.send({directory:dir,env,owner:crashOwner,release,snapshotId:id,page:range,marker,pauseAfterPage:true});
     if(point==='BEFORE'){let waiting=false;for(let attempt=0;attempt<100;attempt++){const rows=await db.$queryRaw`SELECT 1 FROM pg_stat_activity WHERE application_name=${marker} AND wait_event='advisory'`;if(rows.length){waiting=true;break;}await new Promise(resolve=>setTimeout(resolve,50));}assert.equal(waiting,true,'child reached checkpoint insert in its open transaction');}
     else{const [reply]=await message;assert.equal(reply.pageStatus,'COMMITTED');}
     child.kill('SIGKILL');const [code,signal]=await closed;assert.equal(code,null);assert.equal(signal,'SIGKILL');assert.equal(output,'');assert.equal(errors,'');
     if(point==='BEFORE'){await hold.query('SELECT pg_advisory_unlock($1)',[lock]);await db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "V11BillComparisonPage"`);await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);}
     const pageCount=await db.v11BillComparisonPage.count({where:{snapshotId:id}});assert.equal(pageCount,point==='BEFORE'?0:1);assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}}),0);
     if(point==='BEFORE'){assert.equal(await db.receivedEvent.count({where:{eventKey:{startsWith:`BILL:${changed.sourceSha256}:`}}}),0);assert.equal(await db.financialCase.count({where:{owner:crashOwner}}),0);assert.equal(await db.durableJob.count({where:{businessKey:{startsWith:`v11:bill-query:${id}:`}}}),0);}
     const resumed=fork(`${repo}/tests/prelaunch/fixtures/wechat-bill-snapshot-process.mjs`,[],{env:process.env,stdio:['ignore','pipe','pipe','ipc']}),resumedExit=once(resumed,'exit');let resumedOutput='',resumedErrors='';resumed.stdout.on('data',x=>resumedOutput+=x);resumed.stderr.on('data',x=>resumedErrors+=x);
     try{const received=once(resumed,'message');resumed.send({directory:dir,env,owner:crashOwner,release,snapshotId:id,finalize:true});const [reply]=await received;const [exit,exitSignal]=await resumedExit;assert.equal(exit,0);assert.equal(exitSignal,null);assert.equal(reply.finalResult.runId,id);assert.equal(reply.finalResult.coverageState,'INCOMPLETE');assert.equal(reply.finalResult.releaseAuthorized,false);assert.equal(resumedOutput,'');assert.equal(resumedErrors,'');}finally{if(resumed.exitCode===null&&resumed.signalCode===null){resumed.kill('SIGKILL');await resumedExit;}}
     assert.equal(await db.auditLog.count({where:{action:'funding.v11-trade-bill-snapshot',targetId:id}}),1);assert.equal(await db.receivedEvent.count({where:{eventKey:{startsWith:`BILL:${changed.sourceSha256}:`}}}),4);
    }finally{
     if(child&&child.exitCode===null&&child.signalCode===null){child.kill('SIGKILL');await closed;}
     await hold.end();if(point==='BEFORE'){await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${name}" ON "V11BillComparisonPage"`);await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${name}"()`);}
     await db.v11BillComparisonPage.deleteMany({where:{snapshotId:id}});await db.v11BillComparisonSnapshot.deleteMany({where:{id}});await db.auditLog.deleteMany({where:{targetId:id,action:{in:['funding.v11-trade-bill-snapshot','funding.v11-bill-comparison-facts-captured']}}});
    }
   }
  });
  await t.test('actual daily and range CLI processes use durable pages and resume without channel calls',async()=>{
   const {billDayRunId}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-runner.js`));
   const rangeId=randomUUID(),dayId=billDayRunId(rangeId,date),dailyId=randomUUID(),cliOwner=owner+'_cli';writeFileSync(join(dir,'persisted-bill.csv'),bill.rawBill,{mode:0o600});writeFileSync(join(dir,'cli-config.json'),JSON.stringify({directory:dir,env:{...env,WECHAT_PAY_PRIVATE_KEY_PATH:join(dir,'key.pem'),WECHAT_PAY_PLATFORM_CERT_PATH:join(dir,'cert.pem')}}),{mode:0o600});
   const cliEnv={...process.env,FEATURE_V11_BILL_RECONCILIATION:'true',FEATURE_V11_QUERY_RECOVERY:'true',FEATURE_V11_BILL_RANGE_RUN:'true',FINANCIAL_CASE_OWNER:cliOwner,RELEASE_VERSION:release,FANJU_BILL_CLI_FIXTURE:join(dir,'cli-config.json')};
   async function runCli(file,args,extraEnv={}){writeFileSync(join(dir,'cli-fetch-count'),'0',{mode:0o600});const child=spawn(process.execPath,['--import',`${repo}/tests/prelaunch/fixtures/wechat-bill-cli-network.mjs`,`${repo}/services/api/dist/prelaunch/${file}`, ...args],{env:{...cliEnv,...extraEnv},stdio:['ignore','pipe','pipe']});let output='',errors='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>errors+=x);const timeout=setTimeout(()=>child.kill('SIGKILL'),15000);try{const [code,signal]=await once(child,'exit');assert.equal(code,0,errors);assert.equal(signal,null);assert.equal(errors,'');return {value:JSON.parse(output),calls:Number(readFileSync(join(dir,'cli-fetch-count'),'utf8'))};}finally{clearTimeout(timeout);}}
   try{
    const daily=await runCli('wechat-bill-reconcile-cli.js',[date,dailyId]);assert.equal(daily.calls,2);assert.equal(daily.value.runId,dailyId);assert.equal((await db.auditLog.findFirstOrThrow({where:{action:'funding.v11-trade-bill-snapshot',targetId:dailyId}})).metadata.identity.comparisonVersion,'v11-bill-snapshot-4');
    const range=await runCli('wechat-bill-range-run-cli.js',[date,date,rangeId]);assert.equal(range.calls,2);assert.equal(range.value.days[0].status,'OBSERVED');assert.equal((await db.auditLog.findFirstOrThrow({where:{action:'funding.v11-trade-bill-snapshot',targetId:dayId}})).metadata.identity.comparisonVersion,'v11-bill-snapshot-4');
    const resumed=await runCli('wechat-bill-range-run-cli.js',[date,date,rangeId]);assert.equal(resumed.calls,0);assert.equal(resumed.value.days[0].status,'RESUMED');assert.equal(resumed.value.releaseAuthorized,false);
    const legacy=await runCli('wechat-bill-reconcile-cli.js',[date,runId],{FINANCIAL_CASE_OWNER:owner});assert.deepEqual(legacy.value,result);assert.equal(await db.v11BillComparisonSnapshot.count({where:{id:runId}}),0);
   }finally{await db.v11BillComparisonPage.deleteMany({where:{snapshotId:{in:[dayId,dailyId]}}});await db.v11BillComparisonSnapshot.deleteMany({where:{id:{in:[dayId,dailyId]}}});await db.auditLog.deleteMany({where:{targetId:{in:[rangeId,dayId,dailyId]},action:{in:['funding.v11-trade-bill-snapshot','funding.v11-bill-comparison-facts-captured','funding.v11-bill-range-task','funding.v11-bill-range-failure']}}});}
  });
  await t.test('snapshot captures only necessary legacy references and binds facts to the exact verified plan',async()=>{
   const {createBillComparisonPlan,readBillComparisonFacts,executeBillComparisonCore,ensureBillComparisonSnapshot}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-comparison-core.js`));
   const {reconcileDownloadedWechatBillPaged}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-page-checkpoint.js`));
   const id=randomUUID(),legacyOwner=owner+'_legacy_scope',paymentIds=[],refundIds=[];
   const sampleOrder=await db.order.create({data:{userId:user.id,activityId:reg.activityId,amountCents:100,agreementVersion:'synthetic-legacy',status:'CANCELED',registrationActive:false,capacityHeld:false}});
   try{
    for(const merchantOrderNo of [records[2].orderNo,records[4].orderNo,prefix+'_unrelated_legacy'])paymentIds.push((await db.payment.create({data:{orderId:sampleOrder.id,merchantOrderNo,channel:'wechat',merchantScope:binding.merchantScope,amountCents:100,active:false}})).id);
    for(const merchantRefundNo of [records[3].merchantRefundNo,prefix+'_unrelated_legacy_refund'])refundIds.push((await db.refund.create({data:{orderId:sampleOrder.id,merchantRefundNo,channel:'wechat',merchantScope:binding.merchantScope,amountCents:10,reason:'合成范围测试',requestedBy:user.id}})).id);
    const plan=createBillComparisonPlan(bill,env),facts=await db.$transaction(tx=>readBillComparisonFacts(tx,binding,plan));
    assert.deepEqual(facts.legacyPayments,[{merchantOrderNo:records[2].orderNo}]);assert.deepEqual(facts.legacyRefunds,[{merchantRefundNo:records[3].merchantRefundNo}]);
    await assert.rejects(()=>db.$transaction(tx=>readBillComparisonFacts(tx,binding,{...plan})),/Explicit bill fact binding/);
    const otherPlan=createBillComparisonPlan(bill,env);await assert.rejects(()=>db.$transaction(tx=>executeBillComparisonCore(tx,bill,legacyOwner,id,binding,otherPlan,facts)),/Trusted bill comparison context/);
    await ensureBillComparisonSnapshot(db,env,bill,legacyOwner,release,id);const stored=await db.v11BillComparisonSnapshot.findUniqueOrThrow({where:{id}});assert.deepEqual(stored.snapshot.legacyPayments,facts.legacyPayments);assert.deepEqual(stored.snapshot.legacyRefunds,facts.legacyRefunds);
    await db.refund.deleteMany({where:{id:{in:refundIds}}});await db.payment.deleteMany({where:{id:{in:paymentIds}}});
    const report=await reconcileDownloadedWechatBillPaged(db,env,bill,legacyOwner,release,id);assert.equal(report.legacyRows,2);assert.equal(report.releaseAuthorized,false);
   }finally{await db.refund.deleteMany({where:{id:{in:refundIds}}});await db.payment.deleteMany({where:{id:{in:paymentIds}}});await db.order.deleteMany({where:{id:sampleOrder.id,userId:user.id}});await db.v11BillComparisonPage.deleteMany({where:{snapshotId:id}});await db.v11BillComparisonSnapshot.deleteMany({where:{id}});await db.auditLog.deleteMany({where:{targetId:id,action:{in:['funding.v11-trade-bill-snapshot','funding.v11-bill-comparison-facts-captured']}}});}
  });
  await t.test('checkpoint insert failure rolls back page observations, cases and durable queries',async()=>{
   const {ensureBillComparisonSnapshot}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-comparison-core.js`));
   const {commitBillComparisonPage}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-page-checkpoint.js`));
   const changed=await acquire(syntheticBill(date,records.map((x,i)=>i===0?{...x,product:'合成回滚菜单'}:x),env.WECHAT_PAY_MCH_ID));
   const id=randomUUID(),failureOwner=owner+'_failure',name='test_bill_page_'+id.replaceAll('-','');await ensureBillComparisonSnapshot(db,env,changed,failureOwner,release,id);
   await db.$executeRawUnsafe(`CREATE FUNCTION "${name}"() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."snapshotId"='${id}'::uuid THEN RAISE EXCEPTION 'synthetic checkpoint failure'; END IF; RETURN NEW; END $$`);
   await db.$executeRawUnsafe(`CREATE TRIGGER "${name}" BEFORE INSERT ON "V11BillComparisonPage" FOR EACH ROW EXECUTE FUNCTION "${name}"()`);
   try{
    await assert.rejects(()=>commitBillComparisonPage(db,env,changed,failureOwner,release,id,{phase:'FORWARD',start:0,end:records.length}));
    assert.equal(await db.v11BillComparisonPage.count({where:{snapshotId:id}}),0);assert.equal(await db.receivedEvent.count({where:{source:'wechat-bill-observation-v11',merchantScope:binding.merchantScope,eventKey:{startsWith:`BILL:${changed.sourceSha256}:`}}}),0);assert.equal(await db.financialCase.count({where:{owner:failureOwner}}),0);assert.equal(await db.durableJob.count({where:{businessKey:{startsWith:`v11:bill-query:${id}:`}}}),0);
   }finally{await db.$executeRawUnsafe(`DROP TRIGGER "${name}" ON "V11BillComparisonPage"`);await db.$executeRawUnsafe(`DROP FUNCTION "${name}"()`);await db.v11BillComparisonSnapshot.deleteMany({where:{id,merchantScope:binding.merchantScope}});await db.auditLog.deleteMany({where:{action:'funding.v11-bill-comparison-facts-captured',targetId:id}});}
  });
  await t.test('range task pins scope and persists failed dates across retries',async()=>{
   const {ensureWechatBillRangeTask,recordWechatBillRangeFailure}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-journal.js`));
   const {billDayRunId}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/wechat-bill-range-runner.js`));
   const task={rangeId:randomUUID(),start:'2026-09-29',end:date,binding,owner,releaseVersion:release};
   await Promise.all([ensureWechatBillRangeTask(db,task),ensureWechatBillRangeTask(db,task)]);
   assert.equal(await db.auditLog.count({where:{action:'funding.v11-bill-range-task',targetId:task.rangeId}}),1);
   for(const change of [{start:date},{end:'2026-10-01'},{owner:owner+'x'},{releaseVersion:release+'x'},{binding:{...binding,providerConfigId:'changed'}},{binding:{...binding,merchantScope:'b'.repeat(64)}}])await assert.rejects(()=>ensureWechatBillRangeTask(db,{...task,...change}),/identity conflict/);
   const dayRun=billDayRunId(task.rangeId,'2026-09-29');await recordWechatBillRangeFailure(db,task,'2026-09-29',dayRun);await ensureWechatBillRangeTask(db,task);await recordWechatBillRangeFailure(db,task,'2026-09-29',dayRun);
   const failures=await db.auditLog.findMany({where:{action:'funding.v11-bill-range-day-failed',targetId:task.rangeId}});assert.equal(failures.length,2);assert.ok(failures.every(x=>x.metadata.date==='2026-09-29'&&x.metadata.status==='FAILED'&&x.metadata.releaseAuthorized===false));
   await assert.rejects(()=>recordWechatBillRangeFailure(db,task,date,dayRun),/identity conflict/);
   await assert.rejects(()=>recordWechatBillRangeFailure(db,{...task,owner:owner+'x'},'2026-09-29',dayRun),/identity conflict/);
   assert.equal(await db.auditLog.count({where:{action:'funding.v11-bill-range-day-failed',targetId:task.rangeId}}),2);
  });
 }finally{await db.$disconnect();rmSync(dir,{recursive:true,force:true});}
});
