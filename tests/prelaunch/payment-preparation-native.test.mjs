import test from 'node:test';
import {spawn,spawnSync} from 'node:child_process';
import {once} from 'node:events';
import assert from 'node:assert/strict';
import {randomUUID,generateKeyPairSync,createCipheriv,createSign} from 'node:crypto';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';
import {root,verifyOwnedEnvironment} from '../../scripts/prelaunch-owned-env.mjs';
const repo=process.env.PRELAUNCH_SOURCE_ROOT??root;const require=createRequire(resolve(repo,'services/api/package.json'));
const {PrismaPg}=require('@prisma/adapter-pg');
const {PrismaClient}=await import(pathToFileURL(resolve(repo,'services/api/dist/generated/prisma/client.js')));
const {createPaymentPreparationStore}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-preparation.js')));
const {createPaymentPreparationRunner}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-preparation-runner.js')));
const {createPaymentQueryIntake}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-query-intake.js')));
const {wechatQueryHandlers}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/wechat-query-handlers.js')));
const {claimJob,finishJob}=await import(pathToFileURL(resolve(repo,'services/api/dist/jobs/queue.js')));
const {createPaymentReceiptLedger}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-receipt-ledger.js')));
const {createReceiptAllocator}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/receipt-allocation.js')));
const {reserveRefund}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/domain.js')));
const {createWechatRefundReserver}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/wechat-refund-reservation.js')));
const {createRefundQueryConfirmation}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/refund-query-confirmation.js')));
const {createRefundDispatcher}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/refund-dispatch.js')));
const {createPaymentPreparationResumer}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-preparation-resume.js')));
const {createPaymentNotificationTrigger}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/payment-notification-trigger.js')));
const {checkReadiness,recordWorkerPoll}=await import(pathToFileURL(resolve(repo,'services/api/dist/jobs/heartbeat.js')));
const {buildApp}=await import(pathToFileURL(resolve(repo,'services/api/dist/app.js')));
const {bindingFor}=await import(pathToFileURL(resolve(repo,'services/api/dist/funding/intents.js')));
const {scheduleWechatQuerySweep}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/wechat-query-sweep.js')));
test('preparation persists and serializes on owned PostgreSQL',async t=>{
  const {runtime}=await verifyOwnedEnvironment('/tmp/fanju-prelaunch-20261001-b48140fda0c1');
  const db=new PrismaClient({adapter:new PrismaPg({connectionString:runtime.database_url})});const prefix='preparation_native_'+randomUUID().replaceAll('-','');
  try {
    const sample=await db.v11Registration.findFirst();assert.ok(sample,'owned synthetic registration fixture required');
    const consentSample=await db.v11BundleConsent.findUniqueOrThrow({where:{id:sample.consentId}});
    const create=async()=>{
      const suffix=randomUUID();const user=await db.user.create({data:{id:prefix+suffix,wechatOpenid:'mock_'+prefix+suffix}});
      const consent=await db.v11BundleConsent.create({data:{...consentSample,id:prefix+suffix+'_consent',userId:user.id}});
      const reg=await db.v11Registration.create({data:{...sample,id:prefix+suffix+'_reg',userId:user.id,consentId:consent.id,active:true,eligibilityState:'PENDING_PAYMENT',serviceFeeCents:100,depositCents:0}});
      await db.v11SeatHold.create({data:{registrationId:reg.id,expiresAt:new Date(Date.now()+600000)}});
      return db.v11PaymentIntent.create({data:{registrationId:reg.id,merchantOrderNo:prefix+'_'+suffix,channel:'wechat',merchantScope:'a'.repeat(64),providerConfigId:'synthetic-v1',totalCents:100}});
    };
    // Synthetic persistence test authorization only; never exported into runtime assembly.
    const store=createPaymentPreparationStore(db,async()=>{});const row=await create();
    await t.test('twenty concurrent claims produce one durable submitting attempt',async()=>{
      const results=await Promise.allSettled(Array.from({length:20},()=>store.claim(row)));
      assert.equal(results.filter(x=>x.status==='fulfilled').length,1);
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.preparationState,'SUBMITTING');assert.equal(saved.preparationVersion,1);assert.equal(saved.state,'NEW');
      const jobs=await db.durableJob.findMany({where:{kind:'V11_QUERY_PAYMENT',refId:row.id}});assert.equal(jobs.length,1);assert.equal(jobs[0].state,'READY');
    });
    await t.test('prepayment save does not confirm money and stale failures cannot undo it',async()=>{
      await store.savePrepared(row.id,1,'synthetic-prepay');await store.markUnknown(row.id,1);
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:row.id}});assert.equal(saved.preparationState,'PREPARED');assert.equal(saved.prepayId,'synthetic-prepay');assert.equal(saved.state,'NEW');
      await assert.rejects(store.savePrepared(row.id,1,'other-prepay'));await assert.rejects(store.claim(saved));
    });
    await t.test('resume signs only persisted pending prepayment and rejects cancellation during query',async()=>{
      const other=await create();const claimed=await store.claim(other);await store.savePrepared(other.id,claimed.preparationVersion,'synthetic-saved-prepay');
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});let queries=0;let signatures=0;let cancel=false;let status='PENDING';
      const resume=createPaymentPreparationResumer(store,{assertBinding(){},async queryPayment(input){queries++;if(cancel)await db.v11Registration.update({where:{id:input.registrationId},data:{active:false}});return {merchantOrderNo:input.merchantOrderNo,status};},resumePayment(input){signatures++;assert.equal(input.prepayId,'synthetic-saved-prepay');return {kind:'PREPARED',prepayId:input.prepayId};}});
      assert.equal((await resume(saved)).kind,'PREPARED');assert.equal(signatures,1);
      status='SUCCEEDED';assert.equal((await resume(saved)).kind,'EXISTING');assert.equal(signatures,1);
      status='PENDING';cancel=true;await assert.rejects(resume(saved));assert.equal(signatures,1);assert.equal(queries,3);
      await assert.rejects(resume(saved));assert.equal(queries,3);
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).preparationState,'PREPARED');
      const unknown=await create();const unknownClaim=await store.claim(unknown);await store.markUnknown(unknown.id,unknownClaim.preparationVersion);
      await assert.rejects(resume(await db.v11PaymentIntent.findUniqueOrThrow({where:{id:unknown.id}})));assert.equal(queries,3);
    });
    await t.test('unknown outcome cannot be claimed for another submission',async()=>{
      const other=await create();const claimed=await store.claim(other);await store.markUnknown(other.id,claimed.preparationVersion);
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});assert.equal(saved.preparationState,'UNKNOWN');await assert.rejects(store.claim(saved));
    });
    await t.test('cancellation during channel query blocks prepayment send and retains recovery',async()=>{
      const other=await create();let sends=0;
      const run=createPaymentPreparationRunner(store,{assertBinding(){},async preparePayment(input,_openid,guard){
        await db.v11Registration.update({where:{id:input.registrationId},data:{active:false}});
        await guard();sends++;throw Error('must not send');
      }});
      await assert.rejects(run(other,'synthetic-openid'),/qualification changed/);assert.equal(sends,0);
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).preparationState,'UNKNOWN');
      assert.ok(await db.durableJob.findUnique({where:{businessKey:'v11:wechat-query:'+other.id}}));
    });
    await t.test('wrong binding and inactive intents reject without writes',async()=>{
      const other=await create();await assert.rejects(store.claim({...other,totalCents:101}));
      await db.v11PaymentIntent.update({where:{id:other.id},data:{active:false}});await assert.rejects(store.claim(other));
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).preparationVersion,0);
    });
    await t.test('database constraint rejects prepared state without a reference',async()=>{
      const other=await create();await assert.rejects(db.v11PaymentIntent.update({where:{id:other.id},data:{preparationState:'PREPARED'}}));
    });
    await t.test('runner persists submitting before network and prepay before returning',async()=>{
      const other=await create();let calls=0;
      const run=createPaymentPreparationRunner(store,{assertBinding(){},async preparePayment(input){calls++;
        const persisted=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:input.id}});assert.equal(persisted.preparationState,'SUBMITTING');
        return {kind:'PREPARED',prepayId:'synthetic-runner-prepay',paymentParams:{}};
      }});
      assert.equal((await run(other,'synthetic-openid')).kind,'PREPARED');
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});assert.equal(saved.prepayId,'synthetic-runner-prepay');assert.equal(saved.state,'NEW');
      await assert.rejects(run(saved,'synthetic-openid'));assert.equal(calls,1);
    });
    await t.test('runner timeout leaves unknown and cannot resend',async()=>{
      const other=await create();let calls=0;
      const run=createPaymentPreparationRunner(store,{assertBinding(){},async preparePayment(){calls++;throw Error('synthetic-channel-timeout');}});
      await assert.rejects(run(other,'synthetic-openid'));
      const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});assert.equal(saved.preparationState,'UNKNOWN');
      await assert.rejects(run(saved,'synthetic-openid'));assert.equal(calls,1);
    });
    await t.test('authorization rejection rolls back before a durable claim',async()=>{
      const other=await create();const denied=createPaymentPreparationStore(db,async()=>{throw Error('synthetic-policy-denied');});
      await assert.rejects(denied.claim(other));assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).preparationState,'NOT_STARTED');
    });
    await t.test('canceled registration and expired hold cannot prepare a payment',async()=>{
      const other=await create();await db.v11Registration.update({where:{id:other.registrationId},data:{active:false}});await assert.rejects(store.claim(other));
      await db.v11Registration.update({where:{id:other.registrationId},data:{active:true}});
      await db.v11SeatHold.update({where:{registrationId:other.registrationId},data:{expiresAt:new Date(Date.now()-1000)}});await assert.rejects(store.claim(other));
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).preparationVersion,0);
    });
    await t.test('verified notification triggers query once even for canceled intent and preserves conflict',async()=>{
      const other=await create();await db.v11Registration.update({where:{id:other.registrationId},data:{active:false}});await db.v11PaymentIntent.update({where:{id:other.id},data:{active:false,state:'CLOSED'}});
      const trigger=createPaymentNotificationTrigger(db,{channel:'wechat',merchantScope:'a'.repeat(64),providerConfigId:'synthetic-v1'},prefix+'_case-owner');
      const callback={eventId:prefix+'_notify-event',merchantOrderNo:other.merchantOrderNo,channelTradeNo:prefix+'_notify-trade',amountCents:100,paidAt:'2026-10-01T01:00:00Z',callbackNonce:'synthetic-only'};
      const results=await Promise.all(Array.from({length:20},()=>trigger(callback,'synthetic-verification-material')));
      assert.ok(results.every(x=>x.handled&&!x.conflict));assert.equal(new Set(results.map(x=>x.eventId)).size,1);assert.equal(results.filter(x=>!x.duplicate).length,1);
      const event=await db.receivedEvent.findUniqueOrThrow({where:{id:results[0].eventId}});assert.equal(event.state,'RECEIVED');assert.equal(event.normalizedPayload.kind,'PAYMENT_QUERY_TRIGGER');assert.equal(event.normalizedPayload.callbackNonce,undefined);
      assert.equal(await db.durableJob.count({where:{businessKey:'v11:notify-query:'+event.id}}),1);assert.equal(await db.channelReceipt.count({where:{channelTradeNo:callback.channelTradeNo}}),0);
      const conflict=await trigger({...callback,amountCents:101},'synthetic-verification-material');assert.equal(conflict.conflict,true);
      assert.equal((await db.receivedEvent.findUniqueOrThrow({where:{id:conflict.eventId}})).state,'MANUAL');assert.equal((await db.receivedEvent.findUniqueOrThrow({where:{id:event.id}})).payloadHash,event.payloadHash);
      assert.ok(await db.financialCase.findFirst({where:{sourceRef:conflict.eventId,category:'V11_PAYMENT_NOTIFICATION_CONFLICT'}}));
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).state,'CLOSED');
      assert.equal((await trigger({...callback,merchantOrderNo:prefix+'_missing'},'synthetic-verification-material')).handled,false);
    });
    await t.test('signed raw HTTP callback commits V11 trigger and query while tampering writes nothing',async()=>{
      const other=await create();const env={APP_ENV:'ci',NODE_ENV:'test',AUTH_PROVIDER:'wechat',PHONE_PROVIDER:'wechat',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat',SESSION_SECRET:'synthetic-only-session-signing-material',WECHAT_MINIAPP_APP_SECRET:'wx_test_secret',WECHAT_MINIAPP_APP_ID:'wx_test_app_id',WECHAT_PAY_MCH_ID:'test_mch_id',WECHAT_PAY_API_V3_KEY:'test_api_v3_key',WECHAT_PAY_ENABLED:'true',FEATURE_REAL_WECHAT_PAY:'false',NEW_PAYMENTS_ENABLED:'false',FEATURE_V11_PAYMENT_NOTIFICATIONS:'true',FEATURE_V11_REFUND_NOTIFICATIONS:'true',RELEASE_VERSION:prefix+'_release',FINANCIAL_CASE_OWNER:prefix+'_http-case-owner',WECHAT_PAY_PRIVATE_KEY_PATH:'/tmp/test-key.pem',WECHAT_PAY_CERT_SERIAL_NO:'test_cert_serial',WECHAT_PAY_PLATFORM_CERT_PATH:'/tmp/test-platform-cert.pem',WECHAT_PAY_CALLBACK_URL:'https://example.invalid/pay',WECHAT_REFUND_CALLBACK_URL:'https://example.invalid/refund'};
      await db.v11PaymentIntent.update({where:{id:other.id},data:{...bindingFor(env,'wechat'),active:false,state:'CLOSED'}});
      await db.v11Registration.update({where:{id:other.registrationId},data:{active:false}});
      const {privateKey,publicKey}=generateKeyPairSync('rsa',{modulusLength:2048});const key=['0123456789abcdef','0123456789abcdef'].join('');const now=Math.floor(Date.now()/1000);
      const eventId=prefix+'_http-event';const resource={mchid:env.WECHAT_PAY_MCH_ID,appid:env.WECHAT_MINIAPP_APP_ID,out_trade_no:other.merchantOrderNo,transaction_id:prefix+'_http-trade',trade_state:'SUCCESS',success_time:'2026-10-01T01:00:00Z',amount:{total:100,currency:'CNY'}};
      const nonce='synthetic123';const aad='transaction';const cipher=createCipheriv('aes-256-gcm',Buffer.from(key),Buffer.from(nonce));cipher.setAAD(Buffer.from(aad));
      const ciphertext=Buffer.concat([cipher.update(JSON.stringify(resource),'utf8'),cipher.final(),cipher.getAuthTag()]).toString('base64');
      const body=JSON.stringify({id:eventId,event_type:'TRANSACTION.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce,associated_data:aad,ciphertext}},null,2);
      const signer=createSign('RSA-SHA256');signer.update(`${now}\nsynthetic-notification-nonce\n${body}\n`);signer.end();
      const headers={'content-type':'application/json','wechatpay-serial':'synthetic-serial','wechatpay-timestamp':String(now),'wechatpay-nonce':'synthetic-notification-nonce','wechatpay-signature':signer.sign(privateKey,'base64')};
      const app=await buildApp({prisma:db,providerEnv:env,providerHttpClient:async()=>{throw Error('Network provider must not run during callback');},wechatPayNotificationConfig:{apiV3Key:key,platformCertificate:publicKey,certificateSerial:'synthetic-serial',expectedMerchantId:env.WECHAT_PAY_MCH_ID,expectedAppId:env.WECHAT_MINIAPP_APP_ID,now:()=>now*1000}});
      try{
        const origin=await app.listen({host:'127.0.0.1',port:0});
        async function readyStatus(){const response=await fetch(origin+'/ready');await response.text();return response.status;}
        assert.equal(await readyStatus(),503);
        await recordWorkerPoll(db,'v11-wechat-query',prefix+'_ready-worker',prefix+'_wrong-release');assert.equal(await readyStatus(),503);
        await recordWorkerPoll(db,'v11-wechat-query',prefix+'_ready-worker',env.RELEASE_VERSION);assert.equal(await readyStatus(),503);
        const {channelWorkerMode}=await import(pathToFileURL(resolve(repo,'services/api/dist/prelaunch/channel-worker-mode.js')));
        const boundMode=channelWorkerMode('v11-wechat-query',bindingFor(env,'wechat'));
        await recordWorkerPoll(db,channelWorkerMode('v11-wechat-query',{...bindingFor(env,'wechat'),providerConfigId:'wrong-config'}),prefix+'_wrong-config',env.RELEASE_VERSION);assert.equal(await readyStatus(),503);
        await recordWorkerPoll(db,boundMode,prefix+'_ready-worker',env.RELEASE_VERSION);assert.equal(await readyStatus(),200);
        assert.equal((await checkReadiness(db,['v11-wechat-query'],undefined,{version:env.RELEASE_VERSION,migrations:['20261001040000_v11_real_refund_binding','synthetic_required_missing_migration']})).ok,false);
        await db.workerHeartbeat.update({where:{mode_instanceId:{mode:boundMode,instanceId:prefix+'_ready-worker'}},data:{lastPolledAt:new Date('2000-01-01')}});assert.equal(await readyStatus(),503);
        await recordWorkerPoll(db,boundMode,prefix+'_ready-worker',env.RELEASE_VERSION);

        const workerEnv={...env,RELEASE_VERSION:prefix+'_workers_release',FEATURE_V11_FORMAL_PAYMENT_CLOSE:'true',FEATURE_V11_FORMAL_HOLD_EXPIRY:'true',FEATURE_V11_QUERY_RECOVERY:'true',REQUIRED_WORKER_MODES:'events-only'};
        const workerApp=await buildApp({prisma:db,providerEnv:workerEnv,providerHttpClient:async()=>{throw Error('No readiness channel I/O');}});
        try{
          const workerOrigin=await workerApp.listen({host:'127.0.0.1',port:0});
          const status=async()=>{const res=await fetch(workerOrigin+'/ready');await res.text();return res.status;};
          const scope=bindingFor(workerEnv,'wechat'),closeMode=channelWorkerMode('v11-formal-payment-close',scope),expiryMode=channelWorkerMode('v11-formal-hold-expiry',scope);
          await recordWorkerPoll(db,'events-only',prefix+'_events',workerEnv.RELEASE_VERSION);
          await recordWorkerPoll(db,boundMode,prefix+'_bound-query',workerEnv.RELEASE_VERSION);assert.equal(await status(),503);
          await recordWorkerPoll(db,'v11-formal-payment-close',prefix+'_generic-close',workerEnv.RELEASE_VERSION);await recordWorkerPoll(db,'v11-formal-hold-expiry',prefix+'_generic-expiry',workerEnv.RELEASE_VERSION);assert.equal(await status(),503);
          await recordWorkerPoll(db,closeMode,prefix+'_bound-close',workerEnv.RELEASE_VERSION);assert.equal(await status(),503);
          await recordWorkerPoll(db,expiryMode,prefix+'_bound-expiry',workerEnv.RELEASE_VERSION);assert.equal(await status(),200);
          for(const at of [new Date('2000-01-01'),new Date(Date.now()+600000)]){await db.workerHeartbeat.update({where:{mode_instanceId:{mode:closeMode,instanceId:prefix+'_bound-close'}},data:{lastPolledAt:at}});assert.equal(await status(),503);}
          await recordWorkerPoll(db,closeMode,prefix+'_bound-close',prefix+'_other-release');assert.equal(await status(),503);
          await recordWorkerPoll(db,closeMode,prefix+'_bound-close',workerEnv.RELEASE_VERSION);assert.equal(await status(),200);
        }finally{await workerApp.close();}

        const bad=await fetch(origin+'/api/wechat/pay/notify',{method:'POST',headers,body:body+' '});assert.equal(bad.status,400);await bad.text();
        assert.equal(await db.receivedEvent.count({where:{source:'wechat-notify-trigger-v11',eventKey:eventId}}),0);
        const first=await fetch(origin+'/api/wechat/pay/notify',{method:'POST',headers,body});assert.equal(first.status,200);assert.deepEqual(await first.json(),{code:'SUCCESS',idempotent:false});
        const duplicate=await fetch(origin+'/api/wechat/pay/notify',{method:'POST',headers,body});assert.equal(duplicate.status,200);assert.deepEqual(await duplicate.json(),{code:'SUCCESS',idempotent:true});
        const event=await db.receivedEvent.findFirstOrThrow({where:{source:'wechat-notify-trigger-v11',eventKey:eventId}});assert.equal(event.state,'RECEIVED');
        assert.equal(await db.durableJob.count({where:{businessKey:'v11:notify-query:'+event.id,kind:'V11_QUERY_PAYMENT',refId:other.id}}),1);
        assert.equal(await db.receivedEvent.count({where:{source:'wechat-payment-callback',eventKey:eventId}}),0);
        assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).state,'CLOSED');
        assert.equal(await db.channelReceipt.count({where:{channelTradeNo:resource.transaction_id}}),0);
        const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:bindingFor(env,'wechat').merchantScope,channelTradeNo:prefix+'_refund-http-original',merchantOrderNo:prefix+'_refund-http-order',amountCents:100,currency:'CNY',evidenceHash:'synthetic-http-evidence',verifiedAt:new Date(),paidAt:new Date()}});
        const instruction=await db.v11RefundInstruction.create({data:{receiptId:receipt.id,...bindingFor(env,'wechat'),businessKey:prefix+'_http-refund-key',merchantRefundNo:prefix+'_http-refund-no',originalTradeNo:receipt.channelTradeNo,serviceFeeCents:40,depositCents:10,totalCents:50,state:'UNKNOWN'}});
        for(const [kind,originalCents,amountCents]of [['F',80,40],['D',20,10]]){
          const component=await db.v11FundComponent.create({data:{receiptId:receipt.id,kind,originalCents}});
          await db.v11Disposition.create({data:{componentId:component.id,businessKey:prefix+'_http-refund-'+kind,kind:'REFUND',amountCents,state:'RESERVED',sourceRef:instruction.id}});
        }
        async function signedRefund(amount,originalTradeNo=receipt.channelTradeNo){
          const refundNonce=randomUUID().replaceAll('-','').slice(0,12);const encrypt=createCipheriv('aes-256-gcm',Buffer.from(key),Buffer.from(refundNonce));encrypt.setAAD(Buffer.from(aad));
          const value={mchid:env.WECHAT_PAY_MCH_ID,transaction_id:originalTradeNo,out_refund_no:instruction.merchantRefundNo,refund_id:prefix+'_http-channel-refund',refund_status:'SUCCESS',amount:{total:100,refund:amount,payer_total:100,payer_refund:amount}};
          const packed=Buffer.concat([encrypt.update(JSON.stringify(value),'utf8'),encrypt.final(),encrypt.getAuthTag()]).toString('base64');
          const raw=JSON.stringify({id:prefix+'_http-refund-event',event_type:'REFUND.SUCCESS',resource:{algorithm:'AEAD_AES_256_GCM',nonce:refundNonce,associated_data:aad,ciphertext:packed}},null,2);
          const signature=createSign('RSA-SHA256');signature.update(`${now}\nsynthetic-notification-nonce\n${raw}\n`);signature.end();
          const response=await fetch(origin+'/api/wechat/refund/notify',{method:'POST',headers:{...headers,'wechatpay-signature':signature.sign(privateKey,'base64')},body:raw});assert.equal(response.status,200);return response.json();
        }
        assert.deepEqual(await signedRefund(50),{code:'SUCCESS',idempotent:false});assert.deepEqual(await signedRefund(50),{code:'SUCCESS',idempotent:true});
        const refundEvent=await db.receivedEvent.findFirstOrThrow({where:{source:'wechat-refund-notify-trigger-v11',eventKey:prefix+'_http-refund-event'}});assert.equal(refundEvent.state,'RECEIVED');
        assert.equal(await db.durableJob.count({where:{businessKey:'v11:refund-notify-query:'+refundEvent.id,kind:'V11_QUERY_REFUND',refId:instruction.id}}),1);
        await signedRefund(51,prefix+'_wrong-original');
        assert.equal(await db.receivedEvent.count({where:{source:'wechat-refund-notify-trigger-v11',state:'MANUAL',eventKey:{startsWith:prefix}}}),1);
        assert.equal(await db.financialCase.count({where:{category:'V11_REFUND_NOTIFICATION_CONFLICT',sourceRef:{in:(await db.receivedEvent.findMany({where:{source:'wechat-refund-notify-trigger-v11',state:'MANUAL',eventKey:{startsWith:prefix}},select:{id:true}})).map(x=>x.id)}}}),1);
        assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:instruction.id}})).state,'UNKNOWN');assert.equal(await db.v11Disposition.count({where:{sourceRef:instruction.id,state:'RESERVED'}}),2);
        const recovery=wechatQueryHandlers(db,{assertBinding(input){for(const [key,value]of Object.entries(bindingFor(env,'wechat')))assert.equal(input[key],value);},async queryPayment(input){assert.equal(input.merchantOrderNo,other.merchantOrderNo);return {merchantOrderNo:input.merchantOrderNo,status:'SUCCEEDED',channelTradeNo:resource.transaction_id,paidAt:resource.success_time,amountCents:100,currency:'CNY'};},async queryRefund(input){assert.equal(input.merchantRefundNo,instruction.merchantRefundNo);return {merchantRefundNo:input.merchantRefundNo,status:'SUCCEEDED',channelRefundNo:prefix+'_http-channel-refund',originalTradeNo:receipt.channelTradeNo,amountCents:50,currency:'CNY'};}},prefix+'_recovery-case-owner');
        async function recoverCallback(eventId,kind,refId,key){
          const job=await db.durableJob.findUniqueOrThrow({where:{businessKey:key+eventId}});assert.equal(job.refId,refId);
          const lease=await db.durableJob.update({where:{id:job.id},data:{state:'RUNNING',leaseOwner:prefix+'_callback-worker',leaseUntil:new Date(Date.now()+60000),generation:1,attempts:1}});
          await recovery[kind](lease);assert.equal(await finishJob(db,lease),true);await assert.rejects(recovery[kind](lease));
        }
        await recoverCallback(event.id,'V11_QUERY_PAYMENT',other.id,'v11:notify-query:');
        const paidReceipt=await db.channelReceipt.findUniqueOrThrow({where:{channel_merchantScope_channelTradeNo:{channel:'wechat',merchantScope:bindingFor(env,'wechat').merchantScope,channelTradeNo:resource.transaction_id}}});
        assert.equal(paidReceipt.amountCents,100);assert.equal((await db.v11FundComponent.aggregate({where:{receiptId:paidReceipt.id},_sum:{originalCents:true}}))._sum.originalCents,100);
        assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:other.registrationId}})).active,false);assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).state,'CLOSED');
        await recoverCallback(refundEvent.id,'V11_QUERY_REFUND',instruction.id,'v11:refund-notify-query:');
        assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:instruction.id}})).state,'CONFIRMED');assert.equal(await db.v11Disposition.count({where:{sourceRef:instruction.id,state:'COMPLETED'}}),2);
        assert.equal(await db.auditLog.count({where:{action:'funding.v11-refund-query-confirmed',targetId:instruction.id}}),1);
        assert.equal((await db.receivedEvent.findUniqueOrThrow({where:{id:refundEvent.id}})).state,'RECEIVED');


      }finally{await app.close();}
    });
    await t.test('late trusted payment query survives cancellation and concurrent duplicate intake',async()=>{
      const other=await create();await db.v11Registration.update({where:{id:other.registrationId},data:{active:false}});
      await db.v11PaymentIntent.update({where:{id:other.id},data:{active:false,state:'CLOSED'}});
      let paidAt='2026-10-01T01:00:00Z';
      const channelNo=prefix+'_trade';const intake=createPaymentQueryIntake(db,{assertBinding(){},async queryPayment(){return {merchantOrderNo:other.merchantOrderNo,status:'SUCCEEDED',channelTradeNo:channelNo,paidAt,amountCents:100,currency:'CNY'};}});
      const results=await Promise.all(Array.from({length:10},()=>intake(other.id)));assert.equal(new Set(results.map(x=>x.eventId)).size,1);
      const event=await db.receivedEvent.findUniqueOrThrow({where:{id:results[0].eventId}});assert.equal(event.state,'RECEIVED');assert.equal(event.normalizedPayload.paidAt,'2026-10-01T01:00:00Z');
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-payment-query-received',targetId:event.id}}),1);
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}})).state,'CLOSED');assert.equal(await db.channelReceipt.count({where:{channelTradeNo:channelNo}}),0);
      paidAt='2026-10-01T01:01:00Z';
      const conflicts=await Promise.all(Array.from({length:10},()=>intake(other.id)));
      assert.ok(conflicts.every(x=>x.kind==='CONFLICT'));assert.equal(new Set(conflicts.map(x=>x.eventId)).size,1);
      const conflict=await db.receivedEvent.findUniqueOrThrow({where:{id:conflicts[0].eventId}});assert.equal(conflict.state,'MANUAL');
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-payment-query-conflict',targetId:conflict.id}}),1);
      assert.equal((await db.receivedEvent.findUniqueOrThrow({where:{id:event.id}})).normalizedPayload.paidAt,'2026-10-01T01:00:00Z');
      const ledger=createPaymentReceiptLedger(db,{assertBinding(){}});
      const posted=await Promise.all(Array.from({length:10},()=>ledger(event.id)));assert.equal(new Set(posted.map(x=>x.receiptId)).size,1);
      const receipt=await db.channelReceipt.findUniqueOrThrow({where:{id:posted[0].receiptId}});assert.equal(receipt.amountCents,100);
      assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:other.registrationId}})).active,false);
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-receipt-recorded',targetId:receipt.id}}),1);
      await assert.rejects(ledger(conflict.id));
      const allocate=createReceiptAllocator(db,{assertBinding(){}});
      const allocations=await Promise.all(Array.from({length:10},()=>allocate(receipt.id,other.id)));
      assert.ok(allocations.every(x=>x.classification==='PRIMARY'));
      const components=await db.v11FundComponent.findMany({where:{receiptId:receipt.id}});assert.equal(components.length,2);assert.equal(components.reduce((s,x)=>s+x.originalCents,0),100);
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-receipt-allocated',targetId:receipt.id}}),1);
      assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:other.registrationId}})).active,false);
      await db.v11Registration.update({where:{id:other.registrationId},data:{serviceFeeCents:99}});await assert.rejects(allocate(receipt.id,other.id));
      await db.v11Registration.update({where:{id:other.registrationId},data:{serviceFeeCents:100}});
      const extraIntake=createPaymentQueryIntake(db,{assertBinding(){},async queryPayment(){return {merchantOrderNo:other.merchantOrderNo,status:'SUCCEEDED',channelTradeNo:prefix+'_extra-trade',paidAt:'2026-10-01T01:02:00Z',amountCents:100,currency:'CNY'};}});
      const extraEvent=await extraIntake(other.id);const extraReceipt=await ledger(extraEvent.eventId);
      assert.equal((await allocate(extraReceipt.receiptId,other.id)).classification,'EXTRA');
      assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:other.registrationId}})).active,false);
      const realReserve=createWechatRefundReserver(db,{assertBinding(){}},async()=>{});
      const refundKey=prefix+'_real-refund';const reserved=await Promise.all(Array.from({length:10},()=>realReserve(extraReceipt.receiptId,{F:40,D:0},refundKey)));
      assert.equal(new Set(reserved.map(x=>x.id)).size,1);assert.equal(reserved[0].channel,'wechat');assert.equal(reserved[0].originalTradeNo,prefix+'_extra-trade');
      assert.equal((await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:refund:'+reserved[0].id}})).kind,'V11_WECHAT_REFUND');
      await assert.rejects(realReserve(extraReceipt.receiptId,{F:101,D:0},refundKey+'_over'));
      const deniedReserve=createWechatRefundReserver(db,{assertBinding(){}},async()=>{throw Error('synthetic-refund-policy-denied');});
      await assert.rejects(deniedReserve(extraReceipt.receiptId,{F:50,D:0},refundKey+'_denied'));
      assert.equal(await db.v11RefundInstruction.count({where:{businessKey:refundKey+'_denied'}}),0);
      let status='PENDING';let originalTradeNo=prefix+'_extra-trade';
      const confirm=createRefundQueryConfirmation(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:reserved[0].merchantRefundNo,status,channelRefundNo:prefix+'_channel-refund',originalTradeNo,amountCents:40,currency:'CNY'};}},prefix+'_refund-case-owner');
      assert.equal((await confirm(reserved[0].id)).kind,'UNCONFIRMED');
      assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:reserved[0].id}})).state,'RESERVED');
      status='SUCCEEDED';const confirmations=await Promise.all(Array.from({length:10},()=>confirm(reserved[0].id)));
      assert.ok(confirmations.every(x=>x.kind==='CONFIRMED'));
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-refund-query-confirmed',targetId:reserved[0].id}}),1);
      assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:reserved[0].id}})).state,'COMPLETED');
      originalTradeNo=prefix+'_wrong-original';assert.equal((await confirm(reserved[0].id)).kind,'CONFLICT');
      assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:reserved[0].id}})).state,'CONFIRMED');
      const toSend=await realReserve(extraReceipt.receiptId,{F:60,D:0},refundKey+'_send');
      const dispatchJob=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:refund:'+toSend.id}});
      const dispatchLease=await db.durableJob.update({where:{id:dispatchJob.id},data:{state:'RUNNING',generation:1,attempts:1,leaseOwner:prefix+'_dispatch',leaseUntil:new Date(Date.now()+60000)}});
      let sends=0;
      const dispatch=createRefundDispatcher(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:toSend.merchantRefundNo,status:'NOT_FOUND'};},async submitRefund(input,guard){await guard();sends++;
        assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:input.id}})).state,'SUBMITTING');
        assert.ok(await db.durableJob.findUnique({where:{businessKey:'v11:wechat-refund-query:'+input.id}}));
        throw Error('synthetic-dispatch-timeout');
      }},async()=>{});
      await assert.rejects(dispatch(toSend.id,dispatchLease));
      assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:toSend.id}})).state,'UNKNOWN');
      assert.equal((await dispatch(toSend.id,dispatchLease)).kind,'QUERY_REQUIRED');assert.equal(sends,1);
      assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:toSend.id}})).state,'RESERVED');
      const takeover=await realReserve(extraReceipt.receiptId,{F:80,D:0},refundKey+'_takeover');
      const takeoverJob=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:refund:'+takeover.id}});
      const oldLease=await db.durableJob.update({where:{id:takeoverJob.id},data:{state:'RUNNING',generation:1,attempts:1,leaseOwner:prefix+'_old',leaseUntil:new Date(Date.now()+60000)}});
      let takeoverSends=0;
      const dispatchTakeover=createRefundDispatcher(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:takeover.merchantRefundNo,status:'NOT_FOUND'};},async submitRefund(_input,guard){
        await guard();takeoverSends++;
        await db.durableJob.update({where:{id:takeoverJob.id},data:{generation:2,leaseOwner:prefix+'_new',leaseUntil:new Date(Date.now()+60000)}});
        return {channel:'wechat',channelRefundNo:prefix+'_takeover-refund'};
      }},async()=>{});
      await assert.rejects(dispatchTakeover(takeover.id,oldLease));
      const fenced=await db.v11RefundInstruction.findUniqueOrThrow({where:{id:takeover.id}});assert.equal(fenced.state,'SUBMITTING');assert.equal(fenced.channelRefundNo,null);
      const successor=await db.durableJob.findUniqueOrThrow({where:{id:takeoverJob.id}});
      assert.equal((await dispatchTakeover(takeover.id,successor)).kind,'QUERY_REQUIRED');assert.equal(takeoverSends,1);
      const queryJob=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:wechat-refund-query:'+takeover.id}});
      const queryLease=await db.durableJob.update({where:{id:queryJob.id},data:{state:'RUNNING',generation:1,attempts:1,leaseOwner:prefix+'_query-successor',leaseUntil:new Date(Date.now()+60000)}});
      const recover=createRefundQueryConfirmation(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:takeover.merchantRefundNo,status:'SUCCEEDED',channelRefundNo:prefix+'_takeover-refund',originalTradeNo:prefix+'_extra-trade',amountCents:20,currency:'CNY'};}},prefix+'_refund-case-owner');
      assert.equal((await recover(takeover.id,queryLease)).kind,'CONFIRMED');
      assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:takeover.id}})).state,'COMPLETED');
      const revoked=await realReserve(extraReceipt.receiptId,{F:100,D:0},refundKey+'_revoked');
      const revokedJob=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:refund:'+revoked.id}});
      const revokedLease=await db.durableJob.update({where:{id:revokedJob.id},data:{state:'RUNNING',generation:1,attempts:1,leaseOwner:prefix+'_revoked',leaseUntil:new Date(Date.now()+60000)}});
      let allowed=true;let revokedSends=0;let authorizationChecks=0;
      const revokedDispatch=createRefundDispatcher(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:revoked.merchantRefundNo,status:'NOT_FOUND'};},async submitRefund(_input,guard){
        allowed=false;await guard();revokedSends++;return {channel:'wechat',channelRefundNo:prefix+'_must-not-send'};
      }},async()=>{authorizationChecks++;if(!allowed)throw Error('synthetic-authority-revoked');});
      await assert.rejects(revokedDispatch(revoked.id,revokedLease),/synthetic-authority-revoked/);
      assert.equal(authorizationChecks,2);assert.equal(revokedSends,0);
      assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:revoked.id}})).state,'UNKNOWN');
      assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:revoked.id}})).state,'RESERVED');
      assert.ok(await db.durableJob.findUnique({where:{businessKey:'v11:wechat-refund-query:'+revoked.id}}));
    });
    await t.test('SIGKILL after synthetic refund send retains obligation and successor cannot resubmit',async()=>{
      const intent=await create();const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:'a'.repeat(64),channelTradeNo:prefix+'_crash-trade',merchantOrderNo:intent.merchantOrderNo,amountCents:100,currency:'CNY',evidenceHash:'synthetic-crash-evidence',verifiedAt:new Date(),paidAt:new Date()}});
      await createReceiptAllocator(db,{assertBinding(){}})(receipt.id,intent.id);
      const instruction=await createWechatRefundReserver(db,{assertBinding(){}},async()=>{})(receipt.id,{F:40,D:0},prefix+'_crash-refund');
      const job=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:refund:'+instruction.id}});
      await db.durableJob.update({where:{id:job.id},data:{state:'RUNNING',leaseOwner:prefix+'_crash-old',leaseUntil:new Date(Date.now()+60000),generation:1,attempts:1}});
      const child=spawn(process.execPath,[resolve(root,'tests/prelaunch/fixtures/refund-crash-child.mjs'),instruction.id,job.id],{env:{...process.env,PRELAUNCH_SOURCE_ROOT:repo},stdio:['ignore','ignore','ignore','ipc']});
      try{
        let timer;try{await Promise.race([once(child,'message').then(([m])=>assert.equal(m.kind,'SYNTHETIC_SEND_ENTERED')),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Crash child did not reach synthetic send')),15000);})]);}finally{clearTimeout(timer);}
        assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:instruction.id}})).state,'SUBMITTING');
        assert.ok(await db.durableJob.findUnique({where:{businessKey:'v11:wechat-refund-query:'+instruction.id}}));
        const exited=once(child,'exit');assert.equal(child.kill('SIGKILL'),true);const [code,signal]=await exited;assert.equal(code,null);assert.equal(signal,'SIGKILL');
      }finally{if(child.exitCode===null&&child.signalCode===null){const exited=once(child,'exit');child.kill('SIGKILL');await exited;}}
      // Only this owned fixture is changed. Set it ahead of the current queue
      // minimum so claimJob cannot consume another retained test's obligation.
      const earliest=await db.durableJob.aggregate({where:{kind:'V11_WECHAT_REFUND'},_min:{runAt:true}});
      await db.durableJob.update({where:{id:job.id},data:{runAt:new Date(earliest._min.runAt.getTime()-1000),leaseUntil:new Date(Date.now()-1000)}});
      const successor=await claimJob(db,prefix+'_crash-new',['V11_WECHAT_REFUND']);
      assert.ok(successor);assert.equal(successor.id,job.id);assert.equal(successor.generation,2);assert.equal(successor.attempts,2);assert.equal(successor.leaseOwner,prefix+'_crash-new');

      let resends=0;const dispatch=createRefundDispatcher(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:instruction.merchantRefundNo,status:'NOT_FOUND'};},async submitRefund(){resends++;throw Error('Must not resend');}},async()=>{});
      assert.equal((await dispatch(instruction.id,successor)).kind,'QUERY_REQUIRED');assert.equal(resends,0);
      assert.equal((await db.v11RefundInstruction.findUniqueOrThrow({where:{id:instruction.id}})).state,'SUBMITTING');assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:instruction.id}})).state,'RESERVED');
      const query=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:wechat-refund-query:'+instruction.id}});const lease=await db.durableJob.update({where:{id:query.id},data:{state:'RUNNING',leaseOwner:prefix+'_crash-query',leaseUntil:new Date(Date.now()+60000),generation:1,attempts:1}});
      const confirm=createRefundQueryConfirmation(db,{assertBinding(){},async queryRefund(){return {merchantRefundNo:instruction.merchantRefundNo,status:'SUCCEEDED',channelRefundNo:prefix+'_crash-refund-result',originalTradeNo:receipt.channelTradeNo,amountCents:40,currency:'CNY'};}},prefix+'_crash-case-owner');
      assert.equal((await confirm(instruction.id,lease)).kind,'CONFIRMED');assert.equal((await db.v11Disposition.findFirstOrThrow({where:{sourceRef:instruction.id}})).state,'COMPLETED');
    });
    await t.test('expired lease cannot query and lease loss during query cannot persist',async()=>{
      const other=await create();const owner=prefix+'_worker';let calls=0;
      const job=await db.durableJob.create({data:{kind:'V11_QUERY_PAYMENT',businessKey:prefix+'_lease-test',refId:other.id,state:'RUNNING',leaseOwner:owner,leaseUntil:new Date(Date.now()-1000),generation:1}});
      const intake=createPaymentQueryIntake(db,{assertBinding(){},async queryPayment(){calls++;
        await db.durableJob.update({where:{id:job.id},data:{generation:2,leaseOwner:prefix+'_successor'}});
        return {merchantOrderNo:other.merchantOrderNo,status:'SUCCEEDED',channelTradeNo:prefix+'_fenced-trade',paidAt:'2026-10-01T01:00:00Z',amountCents:100,currency:'CNY'};
      }});
      await assert.rejects(intake(other.id,job));assert.equal(calls,0);
      const live=await db.durableJob.update({where:{id:job.id},data:{leaseUntil:new Date(Date.now()+60000)}});
      await assert.rejects(intake(other.id,live));assert.equal(calls,1);
      assert.equal(await db.receivedEvent.count({where:{eventKey:'PAYMENT:'+prefix+'_fenced-trade'}}),0);
    });
    await t.test('query handler persists success and escalates conflict under a live lease',async()=>{
      const other=await create();await store.claim(other);
      let paidAt='2026-10-01T01:00:00Z';const channelNo=prefix+'_handler-trade';
      const handlers=wechatQueryHandlers(db,{assertBinding(){},async queryPayment(){return {merchantOrderNo:other.merchantOrderNo,status:'SUCCEEDED',channelTradeNo:channelNo,paidAt,amountCents:100,currency:'CNY'};}},prefix+'_case-owner');
      const queued=await db.durableJob.findUniqueOrThrow({where:{businessKey:'v11:wechat-query:'+other.id}});
      const lease=await db.durableJob.update({where:{id:queued.id},data:{state:'RUNNING',generation:1,attempts:1,leaseOwner:prefix+'_handler',leaseUntil:new Date(Date.now()+60000)}});
      await handlers.V11_QUERY_PAYMENT(lease);assert.equal(await finishJob(db,lease),true);
      const receipts=await db.channelReceipt.findMany({where:{channelTradeNo:channelNo}});assert.equal(receipts.length,1);
      assert.equal(receipts[0].paidAt.toISOString(),'2026-10-01T01:00:00.000Z');
      assert.equal((await db.v11Registration.findUniqueOrThrow({where:{id:other.registrationId}})).eligibilityState,'PENDING_PAYMENT');
      assert.equal(await db.v11FundComponent.count({where:{receiptId:receipts[0].id}}),2);
      paidAt='2026-10-01T01:01:00Z';
      const conflictLease=await db.durableJob.update({where:{id:queued.id},data:{state:'RUNNING',generation:2,attempts:2,leaseOwner:prefix+'_handler',leaseUntil:new Date(Date.now()+60000)}});
      await handlers.V11_QUERY_PAYMENT(conflictLease);assert.equal(await finishJob(db,conflictLease),false);
      const manual=await db.durableJob.findUniqueOrThrow({where:{id:queued.id}});assert.equal(manual.state,'MANUAL');assert.equal(manual.errorClass,'DATA_CONFLICT');
      assert.equal(await db.financialCase.count({where:{category:'JOB_REQUIRES_REVIEW',sourceRef:queued.id}}),1);
    });
    await t.test('recovery job identity conflict rolls back the submission claim',async()=>{
      const other=await create();await db.durableJob.create({data:{kind:'V11_QUERY_PAYMENT',businessKey:'v11:wechat-query:'+other.id,refId:prefix+'_wrong-reference'}});
      await assert.rejects(store.claim(other));const saved=await db.v11PaymentIntent.findUniqueOrThrow({where:{id:other.id}});
      assert.equal(saved.preparationState,'NOT_STARTED');assert.equal(saved.preparationVersion,0);
    });
    await t.test('refund budget rejects invalid components and cross-receipt business key reuse',async()=>{
      const intent=await create();const reg=await db.v11Registration.findUniqueOrThrow({where:{id:intent.registrationId}});
      const receipt=await db.channelReceipt.create({data:{channel:'mock',merchantScope:'mock-local',channelTradeNo:prefix+'_budget-trade',merchantOrderNo:prefix+'_budget-order',amountCents:100,currency:'CNY',evidenceHash:'synthetic',verifiedAt:new Date()}});
      await db.v11FundComponent.createMany({data:[{receiptId:receipt.id,kind:'F',originalCents:100},{receiptId:receipt.id,kind:'D',originalCents:0}]});
      const key=prefix+'_refund-budget';
      for(const F of [-1,NaN,Infinity,0.5]) await assert.rejects(db.$transaction(tx=>reserveRefund(tx,reg,receipt.id,{F,D:0},key)));
      assert.equal(await db.v11RefundInstruction.count({where:{businessKey:key}}),0);
      const first=await db.$transaction(tx=>reserveRefund(tx,reg,receipt.id,{F:20,D:0},key));
      assert.equal((await db.$transaction(tx=>reserveRefund(tx,reg,receipt.id,{F:20,D:0},key))).id,first.id);
      await assert.rejects(db.$transaction(tx=>reserveRefund(tx,reg,receipt.id,{F:21,D:0},key)));
      const repeated=await Promise.all(Array.from({length:10},()=>db.$transaction(tx=>reserveRefund(tx,reg,receipt.id,{F:40,D:0},key+'_next'))));
      assert.equal(new Set(repeated.map(x=>x.id)).size,1);assert.equal(repeated[0].serviceFeeCents,20);assert.equal(repeated[0].requestedServiceFeeCents,40);
      await assert.rejects(db.$transaction(tx=>reserveRefund(tx,reg,prefix+'_other-receipt',{F:20,D:0},key)));
      await assert.rejects(db.$transaction(tx=>reserveRefund(tx,{...reg,id:prefix+'_other-reg'},receipt.id,{F:20,D:0},key)));
      await assert.rejects(db.$transaction(tx=>reserveRefund(tx,reg,receipt.id,{F:101,D:0},key+'_over')));
      assert.equal(await db.v11Disposition.count({where:{sourceRef:first.id}}),1);
    });
    await t.test('closed query completes only an already closed obligation and retains conflicting money evidence',async()=>{
      const payment=await create();let status='CLOSED';let revoke=false;
      const channel={assertBinding(){},async queryPayment(input){if(revoke)await db.durableJob.updateMany({where:{refId:input.id,leaseOwner:prefix+'_closed-owner'},data:{generation:{increment:1}}});return {status,merchantOrderNo:input.merchantOrderNo,amountCents:100,currency:'CNY'};}};
      const intake=createPaymentQueryIntake(db,channel);
      assert.equal((await intake(payment.id)).kind,'UNCONFIRMED');assert.equal(await db.receivedEvent.count({where:{source:'wechat-closed-query-v11',eventKey:'PAYMENT_CLOSED:'+payment.id}}),0);
      await db.v11PaymentIntent.update({where:{id:payment.id},data:{active:false,state:'CLOSED'}});
      const job=await db.durableJob.create({data:{kind:'V11_QUERY_PAYMENT',businessKey:prefix+'_closed-query',refId:payment.id,state:'RUNNING',leaseOwner:prefix+'_closed-owner',leaseUntil:new Date(Date.now()+60000),attempts:1}});
      const handlers=wechatQueryHandlers(db,channel,'synthetic-owner');await handlers.V11_QUERY_PAYMENT(job);assert.equal(await finishJob(db,job),true);
      assert.equal((await intake(payment.id)).kind,'CLOSED_CONVERGED');
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-closed-query-converged',targetId:(await intake(payment.id)).eventId}}),1);
      assert.equal(await db.financialCase.count({where:{sourceRef:job.id}}),0);assert.equal(await db.channelReceipt.count({where:{merchantOrderNo:payment.merchantOrderNo}}),0);
      status='NOT_FOUND';assert.equal((await intake(payment.id)).kind,'UNCONFIRMED');status='CLOSED';
      const lease=await db.durableJob.update({where:{id:job.id},data:{state:'RUNNING',generation:{increment:1},leaseOwner:prefix+'_closed-owner',leaseUntil:new Date(Date.now()+60000)}});
      revoke=true;await assert.rejects(intake(payment.id,lease));revoke=false;
      const receipt=await db.channelReceipt.create({data:{channel:payment.channel,merchantScope:payment.merchantScope,channelTradeNo:prefix+'_closed-conflict-trade',merchantOrderNo:payment.merchantOrderNo,amountCents:100,currency:'CNY',evidenceHash:'synthetic',verifiedAt:new Date()}});
      const conflictLease=await db.durableJob.update({where:{id:job.id},data:{state:'RUNNING',generation:{increment:1},leaseOwner:prefix+'_closed-owner',leaseUntil:new Date(Date.now()+60000)}});
      await handlers.V11_QUERY_PAYMENT(conflictLease);assert.equal((await db.durableJob.findUniqueOrThrow({where:{id:job.id}})).state,'MANUAL');
      assert.equal((await intake(payment.id)).kind,'CONFLICT');assert.ok(await db.channelReceipt.findUnique({where:{id:receipt.id}}));
      assert.equal((await db.v11PaymentIntent.findUniqueOrThrow({where:{id:payment.id}})).state,'CLOSED');
    });
    await t.test('changed closure evidence persists independently without replacing history or duplicating audit',async()=>{
      const payment=await create();await db.v11PaymentIntent.update({where:{id:payment.id},data:{active:false,state:'CLOSED'}});
      const intake=createPaymentQueryIntake(db,{assertBinding(){},async queryPayment(input){return {status:'CLOSED',merchantOrderNo:input.merchantOrderNo,amountCents:input.totalCents,currency:'CNY'};}});
      const first=await intake(payment.id);assert.equal(first.kind,'CLOSED_CONVERGED');
      const original=await db.receivedEvent.findUniqueOrThrow({where:{id:first.eventId}});
      await db.v11PaymentIntent.update({where:{id:payment.id},data:{totalCents:101}});
      const results=await Promise.all(Array.from({length:10},()=>intake(payment.id)));
      assert.ok(results.every(x=>x.kind==='CONFLICT'&&x.originalEventId===first.eventId));assert.equal(new Set(results.map(x=>x.eventId)).size,1);
      const changed=await db.receivedEvent.findUniqueOrThrow({where:{id:results[0].eventId}});
      assert.notEqual(changed.id,original.id);assert.equal(changed.state,'MANUAL');assert.equal(changed.normalizedPayload.amountCents,101);
      assert.deepEqual(await db.receivedEvent.findUniqueOrThrow({where:{id:original.id}}),original);
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-closed-query-conflict',targetId:changed.id}}),1);
      assert.equal((await db.auditLog.findFirstOrThrow({where:{action:'funding.v11-closed-query-conflict',targetId:changed.id}})).metadata.originalEventId,original.id);
      await db.v11PaymentIntent.update({where:{id:payment.id},data:{totalCents:100}});
      assert.equal((await intake(payment.id)).kind,'CONFLICT');
      assert.equal((await db.receivedEvent.findUniqueOrThrow({where:{id:changed.id}})).state,'MANUAL');
    });
    await t.test('query sweep executable rejects implicit activation, mock providers and invalid retry identity',()=>{
      const env={PATH:process.env.PATH,FEATURE_V11_RECONCILIATION_QUERY:'true',FEATURE_V11_QUERY_RECOVERY:'true',DATABASE_URL:'postgresql://synthetic:synthetic@127.0.0.1:1/unreachable',FINANCIAL_CASE_OWNER:'synthetic-owner',RELEASE_VERSION:'synthetic-release',PAYMENT_PROVIDER:'wechat',REFUND_PROVIDER:'wechat'};
      for(const [changes,runId] of [[{FEATURE_V11_RECONCILIATION_QUERY:'false'},randomUUID()],[{PAYMENT_PROVIDER:'mock'},randomUUID()],[{},'invalid']]){
        const result=spawnSync(process.execPath,[resolve(repo,'services/api/dist/prelaunch/wechat-query-sweep-cli.js'),runId],{env:{...env,...changes},encoding:'utf8',timeout:5000});
        assert.equal(result.status,1);assert.match(result.stderr,/Explicit real query sweep configuration and run UUID required/);assert.equal(result.stdout,'');
      }
    });
    await t.test('real query sweep scopes both inventories, includes closed obligations and preserves prior jobs',async()=>{
      const payment=await create();const binding={channel:'wechat',merchantScope:randomUUID().replaceAll('-','').repeat(2),providerConfigId:'synthetic-sweep-v1'};
      await db.v11PaymentIntent.update({where:{id:payment.id},data:{...binding,active:false,state:'CLOSED'}});
      const receipt=await db.channelReceipt.create({data:{channel:'wechat',merchantScope:binding.merchantScope,channelTradeNo:prefix+'_sweep-trade',merchantOrderNo:payment.merchantOrderNo,amountCents:100,currency:'CNY',evidenceHash:'synthetic',verifiedAt:new Date()}});
      const refund=await db.v11RefundInstruction.create({data:{...binding,registrationId:payment.registrationId,receiptId:receipt.id,merchantRefundNo:prefix+'_sweep-refund',originalTradeNo:receipt.channelTradeNo,totalCents:100,serviceFeeCents:100,depositCents:0,businessKey:prefix+'_sweep',state:'CONFIRMED'}});
      const original=await db.durableJob.create({data:{kind:'V11_QUERY_PAYMENT',businessKey:prefix+'_sweep-original',refId:payment.id,state:'DONE'}});
      const runId=randomUUID();const args=[db,binding,'synthetic-case-owner','synthetic-release',runId];
      const results=await Promise.all(Array.from({length:10},()=>scheduleWechatQuerySweep(...args)));
      for(const result of results)assert.deepEqual(result,{runId,paymentsQueued:1,refundsQueued:1,scope:'LOCAL_TO_CHANNEL_QUERY',coverageState:'INCOMPLETE',releaseVersion:'synthetic-release'});
      const jobs=await db.durableJob.findMany({where:{businessKey:{startsWith:'v11:recon-query:'+runId+':'}}});
      assert.equal(jobs.length,2);assert.deepEqual(new Set(jobs.map(x=>x.refId)),new Set([payment.id,refund.id]));assert.ok(jobs.every(x=>x.state==='READY'));
      assert.equal((await db.durableJob.findUniqueOrThrow({where:{id:original.id}})).state,'DONE');
      assert.equal(await db.auditLog.count({where:{action:'funding.v11-query-sweep',targetId:runId}}),1);
      await assert.rejects(scheduleWechatQuerySweep(db,{...binding,providerConfigId:'other'},args[2],args[3],runId),/identity conflict/);
      await assert.rejects(scheduleWechatQuerySweep(db,binding,'other-owner',args[3],runId),/identity conflict/);
      await assert.rejects(scheduleWechatQuerySweep(db,binding,args[2],'other-release',runId),/identity conflict/);
      const empty=await scheduleWechatQuerySweep(db,{...binding,merchantScope:'c'.repeat(64)},args[2],args[3],randomUUID());
      assert.equal(empty.paymentsQueued+empty.refundsQueued,0);assert.equal(empty.coverageState,'INCOMPLETE');
      const failingRun=randomUUID();const failingDb={$transaction:callback=>db.$transaction(tx=>callback(new Proxy(tx,{get(target,key){return key==='auditLog'?{...target.auditLog,create:async()=>{throw Error('synthetic audit failure');}}:target[key];}})))};
      await assert.rejects(scheduleWechatQuerySweep(failingDb,binding,args[2],args[3],failingRun),/audit failure/);
      assert.equal(await db.durableJob.count({where:{businessKey:{startsWith:'v11:recon-query:'+failingRun+':'}}}),0);
      for(const invalid of [{...binding,channel:'mock'},{...binding,merchantScope:'invalid'}])await assert.rejects(scheduleWechatQuerySweep(db,invalid,args[2],args[3],randomUUID()));
    });
  } finally {await db.$disconnect();}
});
