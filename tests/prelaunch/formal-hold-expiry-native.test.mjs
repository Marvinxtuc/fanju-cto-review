import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID,createHash,scryptSync} from 'node:crypto';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import {spawn} from 'node:child_process';
const repo=process.env.PRELAUNCH_SOURCE_ROOT;if(!repo)throw Error('Explicit source required');const require=createRequire(`${repo}/services/api/package.json`),{PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(`${repo}/services/api/dist/generated/prisma/client.js`));
const {verifyOwnedDatabase}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/ownership.js`));
const {createFormalHoldExpirer,scanFormalHoldExpiryBatch}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/formal-hold-expiry.js`));
test('formal absolute hold expiry preserves unknown money and routes ambiguous qualifications to review',async t=>{
 const db=new PrismaClient({adapter:new PrismaPg({connectionString:process.env.DATABASE_URL})});await verifyOwnedDatabase(db,process.env);const prefix='formal_expire_'+randomUUID();
 try{
  const sample=await db.v11Registration.findFirstOrThrow(),consent=await db.v11BundleConsent.findUniqueOrThrow({where:{id:sample.consentId}});
  const now=(await db.$queryRaw`SELECT clock_timestamp() AS now`)[0].now.getTime(),binding={channel:'wechat',merchantScope:createHash('sha256').update(prefix+'_mch:synthetic-app').digest('hex'),providerConfigId:prefix},owner=prefix+'_owner';
  async function setup(suffix,changes={},holdChanges={}){
   const user=await db.user.create({data:{wechatOpenid:'mock_'+prefix+suffix}}),newConsent=await db.v11BundleConsent.create({data:{...consent,id:prefix+suffix+'_consent',userId:user.id}});
   const reg=await db.v11Registration.create({data:{...sample,id:prefix+suffix,userId:user.id,consentId:newConsent.id,category:'ORDINARY',active:true,eligibilityState:'PENDING_PAYMENT',paidEffectiveAt:null,cancelAcceptedAt:null,serviceFeeCents:40,depositCents:60,acceptedAt:new Date(now-1200000),...changes}});
   const hold=await db.v11SeatHold.create({data:{registrationId:reg.id,expiresAt:new Date(reg.acceptedAt.getTime()+600000),...holdChanges}});
   const intent=await db.v11PaymentIntent.create({data:{...binding,registrationId:reg.id,merchantOrderNo:prefix+suffix,totalCents:100,state:'UNKNOWN'}});
   return {reg,hold,intent};
  }
  async function expiredWithoutAudit(suffix){
   // Construct a synthetic corrupt historical state before any authority exists.
   // Never erase committed immutable proof to fabricate this fixture.
   const row=await setup(suffix,{active:false,eligibilityState:'EXPIRED'},{state:'EXPIRED',releasedAt:new Date(now)});
   await db.v11PaymentIntent.update({where:{id:row.intent.id},data:{active:false}});
   await db.durableJob.create({data:{kind:'V11_QUERY_PAYMENT',businessKey:'v11:formal-expire-query:'+row.intent.id,refId:row.intent.id,runAt:new Date(now)}});
   return row;
  }
  const expire=createFormalHoldExpirer(db,binding,owner),due=await setup('_due');
  await t.test('concurrent expiry releases capacity once, preserves UNKNOWN and commits one query task',async()=>{
   const results=await Promise.all([expire(due.reg.id),expire(due.reg.id)]);assert.deepEqual(results.map(x=>x.kind).sort(),['ALREADY_EXPIRED','EXPIRED']);
   const reg=await db.v11Registration.findUniqueOrThrow({where:{id:due.reg.id}}),hold=await db.v11SeatHold.findUniqueOrThrow({where:{id:due.hold.id}}),intent=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:due.intent.id}});
   assert.equal(reg.active,false);assert.equal(reg.eligibilityState,'EXPIRED');assert.equal(hold.state,'EXPIRED');assert.ok(hold.releasedAt>=hold.expiresAt);assert.equal(intent.active,false);assert.equal(intent.state,'UNKNOWN');
   assert.equal(await db.durableJob.count({where:{businessKey:'v11:formal-expire-query:'+intent.id,kind:'V11_QUERY_PAYMENT'}}),1);assert.equal(await db.auditLog.count({where:{action:'qualification.v11-formal-hold-expired',targetId:hold.id}}),1);assert.equal(await db.v11Membership.count({where:{registrationId:reg.id}}),0);
  });
  await t.test('trusted channel closure converges only with committed formal expiry evidence',async()=>{
   const {createPaymentQueryIntake}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/payment-query-intake.js`));
   const row=await setup('_closed'),channel={assertBinding:()=>{},queryPayment:async()=>({status:'CLOSED',amountCents:100,currency:'CNY'})};
   const intake=createPaymentQueryIntake(db,channel);
   assert.equal((await intake(row.intent.id)).kind,'UNCONFIRMED');
   await expire(row.reg.id);
   assert.equal((await intake(row.intent.id)).kind,'CLOSED_CONVERGED');
   assert.equal((await intake(row.intent.id)).kind,'CLOSED_CONVERGED');
   assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.intent.id}})).state,'UNKNOWN');
   await assert.rejects(db.auditLog.deleteMany({where:{action:'qualification.v11-formal-hold-expired',targetId:row.hold.id}}));
   const noProof=await expiredWithoutAudit('_closed_no_proof');assert.equal((await intake(noProof.intent.id)).kind,'UNCONFIRMED');
   const conflict=await setup('_closed_conflict');await expire(conflict.reg.id);
   await db.receivedEvent.create({data:{source:'wechat-query-v11',merchantScope:binding.merchantScope,eventKey:prefix+'_closure_success',payloadHash:'synthetic',normalizedPayload:{sourceId:conflict.intent.id},verificationMaterialId:binding.providerConfigId,verifiedAt:new Date(now)}});
   assert.equal((await intake(conflict.intent.id)).kind,'CONFLICT');
  });
  await t.test('subsequent trustworthy query records timely channel payment as full late refund obligation',async()=>{
   const {createPaymentQueryIntake}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/payment-query-intake.js`)),{createPaymentReceiptLedger}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/payment-receipt-ledger.js`)),{createReceiptAllocator}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/receipt-allocation.js`)),{createLatePaymentRefundObligation}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/late-payment-refund-obligation.js`));
   const channel={assertBinding:()=>{},queryPayment:async()=>({status:'SUCCEEDED',merchantOrderNo:due.intent.merchantOrderNo,channelTradeNo:prefix+'_trade',amountCents:100,currency:'CNY',paidAt:new Date(due.hold.expiresAt.getTime()-1000).toISOString()})};
   const result=await createPaymentQueryIntake(db,channel)(due.intent.id),receipt=await createPaymentReceiptLedger(db,channel)(result.eventId);await createReceiptAllocator(db,channel)(receipt.receiptId,due.intent.id);
   const obligation=await createLatePaymentRefundObligation(db,channel,owner)(receipt.receiptId,due.intent.id);assert.equal(obligation.kind,'OBLIGATION_RECORDED');assert.equal((await db.receivedEvent.findUniqueOrThrow({where:{id:obligation.eventId}})).normalizedPayload.totalCents,100);assert.equal(await db.v11RefundInstruction.count({where:{registrationId:due.reg.id}}),0);assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:due.reg.id}})).active,false);
  });
  await t.test('durable formal close commits recovery before I/O and fences stale send authority',async()=>{
   const {createFormalPaymentCloser}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/formal-payment-close.js`));
   async function leaseFor(row){return db.durableJob.update({where:{businessKey:'v11:formal-expire-close:'+row.intent.id},data:{state:'RUNNING',leaseOwner:prefix+'_close_worker',leaseUntil:new Date(Date.now()+60000),generation:{increment:1},attempts:{increment:1}}});}
   const row=await setup('_active_close');await expire(row.reg.id);const lease=await leaseFor(row);let calls=0;
   const channel={assertBinding:()=>{},closePayment:async(intent,guard)=>{calls++;assert.equal(intent.id,row.intent.id);assert.equal(await db.durableJob.count({where:{businessKey:'v11:close-recovery:'+lease.id+':'+lease.generation}}),1);await guard();return {status:'CLOSED'};}};
   await createFormalPaymentCloser(db,channel)(lease);assert.equal(calls,1);assert.equal(await db.durableJob.count({where:{businessKey:'v11:close-result:'+lease.id+':'+lease.generation}}),1);assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.intent.id}})).state,'UNKNOWN');
   const stale=await setup('_stale_close');await expire(stale.reg.id);const old=await leaseFor(stale);let posts=0;
   const raced={assertBinding:()=>{},closePayment:async(_intent,guard)=>{await db.durableJob.update({where:{id:old.id},data:{generation:{increment:1}}});await guard();posts++;return {status:'CLOSED'};}};
   await assert.rejects(createFormalPaymentCloser(db,raced)(old));assert.equal(posts,0);assert.equal(await db.durableJob.count({where:{businessKey:'v11:close-recovery:'+old.id+':'+old.generation}}),1);
   const conflict=await setup('_money_close');await expire(conflict.reg.id);const blocked=await leaseFor(conflict);
   await db.receivedEvent.create({data:{source:'wechat-query-v11',merchantScope:binding.merchantScope,eventKey:prefix+'_close_money',payloadHash:'synthetic',normalizedPayload:{sourceId:conflict.intent.id},verificationMaterialId:binding.providerConfigId,verifiedAt:new Date(now)}});
   await assert.rejects(createFormalPaymentCloser(db,channel)(blocked));assert.equal(calls,1);
  });
  await t.test('money and preparation axes cover valid pending states without promoting terminal or corrupt records',async()=>{
   const {createFormalPaymentCloser}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/formal-payment-close.js`)),{createPaymentQueryIntake}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/payment-query-intake.js`));
   let calls=0;
   for(const state of ['NEW','SUBMITTING','UNKNOWN'])for(const preparationState of ['NOT_STARTED','SUBMITTING','UNKNOWN','PREPARED']){
    const row=await setup('_axes_'+state+'_'+preparationState);await db.v11PaymentIntent.update({where:{id:row.intent.id},data:{state,preparationState,prepayId:preparationState==='PREPARED'?'synthetic-prepay':null}});
    assert.equal((await expire(row.reg.id)).kind,'EXPIRED');
    const lease=await db.durableJob.update({where:{businessKey:'v11:formal-expire-close:'+row.intent.id},data:{state:'RUNNING',leaseOwner:prefix+'_axes',leaseUntil:new Date(Date.now()+60000),generation:{increment:1},attempts:{increment:1}}});
    const channel={assertBinding:()=>{},closePayment:async(_intent,guard)=>{await guard();calls++;return {status:'CLOSED'};},queryPayment:async()=>({status:'CLOSED',amountCents:100,currency:'CNY'})};
    await createFormalPaymentCloser(db,channel)(lease);assert.equal((await createPaymentQueryIntake(db,channel)(row.intent.id)).kind,'CLOSED_CONVERGED');
    const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.intent.id}});assert.equal(saved.state,state);assert.equal(saved.preparationState,preparationState);
   }
   assert.equal(calls,12);
   const terminal=await setup('_terminal_axes');await db.v11PaymentIntent.update({where:{id:terminal.intent.id},data:{state:'SUCCEEDED',preparationState:'PREPARED',prepayId:'synthetic-terminal-prepay'}});
   assert.equal((await expire(terminal.reg.id)).kind,'REVIEW_REQUIRED');assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:terminal.reg.id}})).active,true);
   const {isUnsettledPayment}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/unsettled-payment.js`));
   const invalid=await setup('_invalid_axes');
   for(const data of [{state:'UNKNOWN',preparationState:'UNSUPPORTED',prepayId:null},{state:'NEW',preparationState:'PREPARED',prepayId:null}]){
    assert.equal(isUnsettledPayment(data),false);await assert.rejects(db.v11PaymentIntent.update({where:{id:invalid.intent.id},data}));
   }
  });
  await t.test('historical bounded close sweep restores missing jobs without resetting prior tasks or crossing binding',async()=>{
   const {scheduleFormalCloseBatch}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/formal-close-sweep.js`));
   const historical=await setup('_historical_close');await expire(historical.reg.id);const key='v11:formal-expire-close:'+historical.intent.id;
   await db.durableJob.delete({where:{businessKey:key}});
   assert.equal((await scheduleFormalCloseBatch(db,{...binding,merchantScope:'c'.repeat(64)},owner)).counts.scheduled,0);
   assert.equal(await db.durableJob.count({where:{businessKey:key}}),0);
   const first=await scheduleFormalCloseBatch(db,binding,owner);assert.ok(first.counts.scheduled>=1);assert.equal(first.channelCalled,false);
   const task=await db.durableJob.update({where:{businessKey:key},data:{state:'MANUAL',attempts:8,generation:4,errorClass:'DATA_CONFLICT'}});
   await scheduleFormalCloseBatch(db,binding,owner);const retained=await db.durableJob.findUniqueOrThrow({where:{businessKey:key}});assert.equal(retained.id,task.id);assert.equal(retained.state,'MANUAL');assert.equal(retained.generation,4);assert.equal(retained.attempts,8);assert.equal(retained.errorClass,'DATA_CONFLICT');
   const missing=await expiredWithoutAudit('_missing_close_audit');
   await scheduleFormalCloseBatch(db,binding,owner);assert.equal(await db.durableJob.count({where:{businessKey:'v11:formal-expire-close:'+missing.intent.id}}),0);assert.equal(await db.financialCase.count({where:{category:'V11_FORMAL_CLOSE_SWEEP_REVIEW',sourceRef:missing.intent.id}}),1);
   const ids=[];for(let n=0;n<51;n++){const row=await setup('_close_sweep_page_'+n);await expire(row.reg.id);ids.push(row.intent.id);await db.durableJob.delete({where:{businessKey:'v11:formal-expire-close:'+row.intent.id}});}
   let cursor,pages=0;do{const result=await scheduleFormalCloseBatch(db,binding,owner,cursor);cursor=result.nextCursor??undefined;pages++;assert.ok(pages<10);}while(cursor);
   assert.ok(pages>=2);assert.equal(await db.durableJob.count({where:{kind:'V11_CLOSE_EXPIRED_PAYMENT',refId:{in:ids}}}),51);
  });
  await t.test('shared closure runtime survives process death before and after synthetic channel send, drains and caps retries',async()=>{
   function launch(row,mode){
    const child=spawn(process.execPath,[`${repo}/tests/prelaunch/fixtures/formal-close-worker.mjs`],{env:{...process.env,PRELAUNCH_TEST_CLOSE_ID:row.intent.id,PRELAUNCH_TEST_CLOSE_MCH:prefix+'_mch',PRELAUNCH_TEST_CLOSE_MODE:mode},stdio:['ignore','pipe','pipe','ipc']});
    let stdout='',stderr='',done=false;const stages=[];child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);child.on('message',x=>stages.push(x.stage));
    const closed=new Promise(resolve=>child.once('close',(code,signal)=>{done=true;resolve({code,signal});}));
    async function stage(wanted){const deadline=Date.now()+10000;while(!stages.includes(wanted)){if(done)throw Error('Close child ended: '+stderr);if(Date.now()>deadline)throw Error('Close child stage timeout');await new Promise(r=>setTimeout(r,25));}}
    return {child,closed,stage,stages,output:()=>({stdout,stderr}),done:()=>done};
   }
   async function prepare(suffix){const row=await setup(suffix);await expire(row.reg.id);await db.durableJob.update({where:{businessKey:'v11:formal-expire-close:'+row.intent.id},data:{runAt:new Date(0)}});return row;}
   for(const mode of ['before','after']){
    const row=await prepare('_process_'+mode),run=launch(row,mode);try{
     await run.stage(mode==='before'?'QUERIED':'SENT');run.child.kill('SIGKILL');assert.equal((await run.closed).signal,'SIGKILL');
     const old=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:formal-expire-close:'+row.intent.id}});assert.equal(old.state,'RUNNING');assert.equal(await db.durableJob.count({where:{businessKey:'v11:close-recovery:'+old.id+':'+old.generation}}),1);
     await db.durableJob.update({where:{id:old.id},data:{leaseUntil:new Date(0)}});
     const recovered=launch(row,'recover');try{const result=await recovered.closed;assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(recovered.output().stderr,'');if(mode==='after')assert.ok(recovered.stages.includes('RECOVERED'));}finally{if(!recovered.done()){recovered.child.kill('SIGKILL');await recovered.closed;}}
     const current=await db.durableJob.findUniqueOrThrow({where:{id:old.id}});assert.equal(current.state,'DONE');assert.equal(current.generation,old.generation+1);assert.equal(await db.receivedEvent.count({where:{source:'owned-test-close-channel',merchantScope:binding.merchantScope,eventKey:row.intent.id}}),1);assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.intent.id}})).state,'UNKNOWN');assert.equal(await db.v11RefundInstruction.count({where:{registrationId:row.reg.id}}),0);
    }finally{if(!run.done()){run.child.kill('SIGKILL');await run.closed;}}
   }
   const draining=await prepare('_process_drain'),drain=launch(draining,'drain');try{await drain.stage('SENT');drain.child.kill('SIGTERM');await new Promise(r=>setTimeout(r,100));drain.child.send('release');const result=await drain.closed;assert.equal(result.code,0);assert.equal(result.signal,null);assert.equal(drain.output().stderr,'');assert.equal((await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:formal-expire-close:'+draining.intent.id}})).state,'DONE');}finally{if(!drain.done()){drain.child.kill('SIGKILL');await drain.closed;}}
   const capped=await prepare('_process_cap');await db.durableJob.update({where:{businessKey:'v11:formal-expire-close:'+capped.intent.id},data:{attempts:8}});const cap=launch(capped,'recover');try{assert.equal((await cap.closed).code,0);assert.deepEqual(cap.stages,[]);assert.equal((await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:formal-expire-close:'+capped.intent.id}})).state,'MANUAL');}finally{if(!cap.done()){cap.child.kill('SIGKILL');await cap.closed;}}
  });
  await t.test('bound job claims leave other merchant and config leases and retry budgets untouched',async()=>{
   const {claimJob,finishJob}=await import(pathToFileURL(`${repo}/services/api/dist/jobs/queue.js`));
   const scope={...binding,merchantScope:createHash('sha256').update(prefix+'_claim-scope').digest('hex')};
   async function queued(suffix,target){const row=await setup(suffix);await db.v11PaymentIntent.update({where:{id:row.intent.id},data:target});await createFormalHoldExpirer(db,target,owner)(row.reg.id);const job=await db.durableJob.update({where:{businessKey:'v11:formal-expire-close:'+row.intent.id},data:{runAt:new Date(0)}});return {row,job};}
   const own=await queued('_claim_own',scope),foreign=await queued('_claim_foreign',{...scope,merchantScope:'e'.repeat(64)}),version=await queued('_claim_version',{...scope,providerConfigId:prefix+'_other_config'});
   await db.durableJob.update({where:{id:foreign.job.id},data:{state:'RUNNING',leaseOwner:'synthetic-expired-foreign',leaseUntil:new Date(0),generation:2,attempts:3}});
   const before=await db.durableJob.findUniqueOrThrow({where:{id:foreign.job.id}});
   const claims=await Promise.all([claimJob(db,prefix+'_claim_a',['V11_CLOSE_EXPIRED_PAYMENT'],scope),claimJob(db,prefix+'_claim_b',['V11_CLOSE_EXPIRED_PAYMENT'],scope)]);
   assert.equal(claims.filter(Boolean).length,1);const claimed=claims.find(Boolean);assert.equal(claimed.id,own.job.id);assert.equal(await finishJob(db,claimed),true);
   assert.equal(await claimJob(db,prefix+'_claim_none',['V11_CLOSE_EXPIRED_PAYMENT'],scope),null);
   const after=await db.durableJob.findUniqueOrThrow({where:{id:foreign.job.id}});assert.equal(after.state,before.state);assert.equal(after.generation,before.generation);assert.equal(after.attempts,before.attempts);assert.equal(after.leaseOwner,before.leaseOwner);assert.equal(after.leaseUntil.getTime(),before.leaseUntil.getTime());assert.equal((await db.durableJob.findUniqueOrThrow({where:{id:version.job.id}})).attempts,0);
   const paymentQuery=await db.durableJob.create({data:{kind:'V11_QUERY_PAYMENT',businessKey:prefix+'_scope_payment_query',refId:own.row.intent.id,runAt:new Date(0)}});
   async function refundJob(suffix,target){const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:target.merchantScope,channelTradeNo:prefix+suffix+'_trade',merchantOrderNo:prefix+suffix+'_order',amountCents:100,currency:'CNY',evidenceHash:'synthetic',verifiedAt:new Date()}});const refund=await db.v11RefundInstruction.create({data:{...target,receiptId:receipt.id,businessKey:prefix+suffix,merchantRefundNo:prefix+suffix+'_refund',originalTradeNo:receipt.channelTradeNo,serviceFeeCents:40,depositCents:60,totalCents:100,state:'UNKNOWN'}});return db.durableJob.create({data:{kind:'V11_QUERY_REFUND',businessKey:prefix+suffix+'_job',refId:refund.id,runAt:new Date(0)}});}
   const refundQuery=await refundJob('_scope_own_refund',scope),foreignRefund=await refundJob('_scope_foreign_refund',{...scope,merchantScope:'f'.repeat(64)}),versionRefund=await refundJob('_scope_version_refund',{...scope,providerConfigId:prefix+'_other_config'});
   const queryClaims=[];for(let n=0;n<2;n++){const lease=await claimJob(db,prefix+'_query_scope',['V11_QUERY_PAYMENT','V11_QUERY_REFUND'],scope);queryClaims.push(lease.id);await finishJob(db,lease);}
   assert.deepEqual(queryClaims.sort(),[paymentQuery.id,refundQuery.id].sort());for(const job of [foreignRefund,versionRefund]){const retained=await db.durableJob.findUniqueOrThrow({where:{id:job.id}});assert.equal(retained.state,'READY');assert.equal(retained.attempts,0);assert.equal(retained.generation,0);}
   await assert.rejects(claimJob(db,prefix+'_claim_invalid',undefined,scope));await assert.rejects(claimJob(db,prefix+'_claim_invalid_kind',['APPLY_EVENT'],scope));
  });
  await t.test('controlled obligation observation preserves conflicts, isolates scope and rejects role or actor revocation',async()=>{
   const {controlledRefundObligations}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/controlled-refund-obligations.js`));
   const ops=await db.v11Actor.create({data:{personId:prefix+'_obligation_ops',role:'OPS',passwordHash:'synthetic-unused'}}),actor={id:ops.id,personId:ops.personId,role:'OPS',userId:null,restaurantId:null,version:ops.version};
   const result=await controlledRefundObligations(db,actor,binding);const valid=result.items.find(x=>x.obligation?.receiptId);assert.ok(valid);assert.equal(valid.dispatchAuthorized,false);assert.equal(valid.obligation.amountCents,100);assert.equal(valid.obligation.remainingCents,100);assert.equal(result.releaseAuthorized,false);
   await assert.rejects(controlledRefundObligations(db,{...actor,role:'USER'},binding));await assert.rejects(controlledRefundObligations(db,{...actor,role:'RESTAURANT'},binding));await assert.rejects(controlledRefundObligations(db,{...actor,version:actor.version+1},binding));
   const original=await db.receivedEvent.findFirstOrThrow({where:{source:'wechat-late-refund-obligation-v11',merchantScope:binding.merchantScope}});
   const broken=await db.receivedEvent.create({data:{...original,id:prefix+'_broken_obligation',eventKey:prefix+'_broken_obligation',payloadHash:'tampered'}});
   const conflictCase=await db.financialCase.create({data:{caseKey:prefix+'_conflict_case',category:'V11_LATE_PAYMENT_FULL_REFUND_DUE',sourceRef:broken.id,owner,deadline:new Date()}});
   const foreign=await db.receivedEvent.create({data:{...original,id:prefix+'_foreign_obligation',merchantScope:'a'.repeat(64)}});const foreignCase=await db.financialCase.create({data:{caseKey:prefix+'_foreign_case',category:'V11_LATE_PAYMENT_FULL_REFUND_DUE',sourceRef:foreign.id,owner,deadline:new Date()}});
   const inspected=await controlledRefundObligations(db,actor,binding);const conflict=inspected.items.find(x=>x.caseId===conflictCase.id);assert.equal(conflict.evidenceConflict,true);assert.equal(conflict.obligation,null);assert.ok(!inspected.items.some(x=>x.caseId===foreignCase.id));assert.ok(!JSON.stringify(inspected).includes(due.intent.merchantOrderNo));
   await db.v11Actor.update({where:{id:ops.id},data:{enabled:false}});await assert.rejects(controlledRefundObligations(db,actor,binding));
  });
  await t.test('controlled HTTP obligation route requires dedicated session and rejects caller scope and revoked account',async()=>{
   const Fastify=require('fastify'),{registerAuth,signSession}=await import(pathToFileURL(`${repo}/services/api/dist/auth.js`)),{registerProductionIdentityRoutes}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/production-identity-routes.js`)),{errorResponse}=await import(pathToFileURL(`${repo}/services/api/dist/prelaunch/contracts.js`));
   const salt='a'.repeat(32),password='synthetic-only-password',hash='scrypt:'+salt+':'+scryptSync(password,salt,64).toString('hex');
   const ops=await db.v11Actor.create({data:{personId:prefix+'_http_ops',role:'OPS',passwordHash:hash}});
   const accounts=[{accountId:prefix+'_http_account',username:'synthetic-ops',accountVersion:'synthetic-v1',enabled:true,passwordHash:hash,actorId:ops.id,personId:ops.personId,actorVersion:ops.version,role:'OPS',restaurantId:null}];
   const env={APP_ENV:'test',SESSION_SECRET:'synthetic-session-signing-material-long',FEATURE_V11_IDENTITY:'true',FEATURE_V11_CONTROLLED_OBLIGATIONS:'true',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat',WECHAT_PAY_MCH_ID:prefix+'_mch',WECHAT_MINIAPP_APP_ID:'synthetic-app',WECHAT_PAY_CONFIG_VERSION:binding.providerConfigId,V11_CONTROLLED_ACCOUNTS_JSON:JSON.stringify(accounts)};
   const app=Fastify();try{
    await registerAuth(app,db,env);registerProductionIdentityRoutes(app,db,env,{auth:{mode:'wechat'},phone:{mode:'wechat'}},false);app.setErrorHandler((error,_req,reply)=>{if('issues'in error)return reply.code(400).send({error:'INVALID_INPUT'});const result=errorResponse(error);return reply.code(result.statusCode).send(result.body);});
    const url='/api/v11/ops/refund-obligations';assert.equal((await app.inject({url})).statusCode,401);
    assert.equal((await app.inject({url,headers:{authorization:'Bearer '+signSession(app,{sub:due.reg.userId,role:'USER'})}})).statusCode,401);
    const login=await app.inject({method:'POST',url:'/api/v11/ops/login',payload:{username:'synthetic-ops',password}});assert.equal(login.statusCode,200);const headers={authorization:'Bearer '+login.json().token};
    const result=await app.inject({url,headers});assert.equal(result.statusCode,200);const data=result.json();assert.equal(data.scope,'BOUND_RECORDED_OBLIGATIONS_ONLY');assert.ok(data.items.some(x=>x.obligation?.amountCents===100));assert.ok(data.items.every(x=>x.dispatchAuthorized===false));assert.ok(!result.body.includes(due.intent.merchantOrderNo));
    assert.equal((await app.inject({url:url+'?merchantScope=other',headers})).statusCode,400);
    assert.equal((await app.inject({url:url+'?cursor='+('a'.repeat(161)),headers})).statusCode,400);
    await db.v11Actor.update({where:{id:ops.id},data:{version:{increment:1}}});assert.equal((await app.inject({url,headers})).statusCode,403);
    await db.v11Actor.update({where:{id:ops.id},data:{version:ops.version,enabled:false}});assert.equal((await app.inject({url,headers})).statusCode,401);
   }finally{await app.close();}
  });
  await t.test('future hold and foreign binding cannot be expired',async()=>{const future=await setup('_future',{acceptedAt:new Date(now)});assert.equal((await expire(future.reg.id)).kind,'NOT_DUE');const foreign=await setup('_foreign');assert.equal((await createFormalHoldExpirer(db,{...binding,merchantScope:'b'.repeat(64)},owner)(foreign.reg.id)).kind,'OUT_OF_SCOPE');assert.equal((await db.v11SeatHold.findUniqueOrThrow({where:{id:foreign.hold.id}})).state,'HELD');});
  await t.test('existing paid qualification, cancellation, waitlist and wrong deadline require review without changing rights',async()=>{
   for(const [suffix,change,holdChange] of [['_paid',{paidEffectiveAt:new Date(now-700000)},{}],['_cancel',{cancelAcceptedAt:new Date(now)},{}],['_waitlist',{category:'WAITLIST'},{}],['_clock',{}, {expiresAt:new Date(now-600001)}]]){const row=await setup(suffix,change,holdChange);assert.equal((await expire(row.reg.id)).kind,'REVIEW_REQUIRED');assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:row.reg.id}})).active,true);assert.equal((await db.v11SeatHold.findUniqueOrThrow({where:{id:row.hold.id}})).state,'HELD');}
  });
  await t.test('timely success evidence before cutoff cannot be silently reclassified as an unknown expired order',async()=>{
   const row=await setup('_timely');await db.receivedEvent.create({data:{source:'wechat-query-v11',merchantScope:binding.merchantScope,eventKey:prefix+'_timely',payloadHash:'synthetic',normalizedPayload:{sourceId:row.intent.id},verificationMaterialId:binding.providerConfigId,verifiedAt:new Date(row.hold.expiresAt.getTime()-1)}});
   assert.equal((await expire(row.reg.id)).kind,'REVIEW_REQUIRED');assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:row.reg.id}})).eligibilityState,'PENDING_PAYMENT');
  });
  await t.test('bounded scanner traverses past a full page of review items instead of starving later rows',async()=>{
   const ids=[];for(let n=0;n<51;n++)ids.push((await setup('_page_'+n,{category:'WAITLIST'})).hold.id);
   let cursor,total=0,pages=0;do{const result=await scanFormalHoldExpiryBatch(db,binding,owner,cursor);total+=Object.values(result.counts).reduce((a,b)=>a+b,0);cursor=result.nextCursor??undefined;pages++;assert.ok(pages<10);}while(cursor);
   assert.ok(pages>=2);assert.ok(total>=51);assert.equal(await db.financialCase.count({where:{category:'V11_FORMAL_HOLD_EXPIRY_REVIEW',sourceRef:{in:ids}}}),51);
  });
  await t.test('owned standalone process runs shared worker runtime, reaches a later page and drains SIGTERM',async()=>{
   const row=await setup('_worker');let stdout='',stderr='';const child=spawn(process.execPath,[`${repo}/tests/prelaunch/fixtures/formal-hold-worker.mjs`],{env:{...process.env,PRELAUNCH_TEST_EXPIRY_SCOPE:binding.merchantScope,PRELAUNCH_TEST_EXPIRY_CONFIG:binding.providerConfigId},stdio:['ignore','pipe','pipe']});
   child.stdout.on('data',x=>stdout+=x);child.stderr.on('data',x=>stderr+=x);let done=false;const closed=new Promise(resolve=>child.once('close',(code,signal)=>{done=true;resolve({code,signal});}));
   try{const until=Date.now()+15000;let observed;do{observed=await db.v11SeatHold.findUniqueOrThrow({where:{id:row.hold.id}});if(observed.state==='EXPIRED')break;if(done)throw Error('Expiry process ended before observation');await new Promise(r=>setTimeout(r,100));}while(Date.now()<until);
    assert.equal(observed.state,'EXPIRED');assert.equal(await db.durableJob.count({where:{businessKey:'v11:formal-expire-query:'+row.intent.id}}),1);child.kill('SIGTERM');const result=await Promise.race([closed,new Promise((_,reject)=>{const deadline=setTimeout(()=>reject(Error('Worker shutdown deadline')),5000);deadline.unref();})]);assert.equal(result.code,0);assert.equal(result.signal,null);assert.ok(!stdout.includes(prefix));assert.equal(stderr,'');
   }finally{if(!done){child.kill('SIGKILL');await closed;}}
  });
 }finally{await db.$disconnect();}
});
