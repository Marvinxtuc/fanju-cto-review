import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { realpathSync } from 'node:fs';
import { verifyOwnedEnvironment, childEnvironment, root } from '../../scripts/prelaunch-owned-env.mjs';

test('legacy worker preserves a newer domain job and executes a legacy inbox job in the same durable queue', { timeout: 30_000 }, async () => {
  const runtimePath = process.env.PRELAUNCH_ENV_FILE;
  assert.ok(runtimePath, 'Owned synthetic runtime must be supplied');
  const { runtime } = await verifyOwnedEnvironment(dirname(runtimePath));
  const consumerRoot = realpathSync(process.env.PRELAUNCH_COMPAT_WORKER_ROOT ?? '');
  assert.ok(consumerRoot.startsWith(runtime.scratch + '/'), 'Legacy consumer must come from the owned compatibility copy');
  const { Pool } = createRequire(resolve(root, 'services/api/package.json'))('pg');
  const pool = new Pool({ connectionString: runtime.database_url, connectionTimeoutMillis: 5000, max: 1 });
  const id = `prelaunch_compat_${randomUUID().replaceAll('-', '')}`;
  const userId = `${id}_user`, noticeId = `${id}_notice`, futureJobId = `${id}_future`, legacyJobId = `${id}_legacy`, refundJobId = `${id}_refundjob`, refundId = `${id}_refund`, receiptId = `${id}_receipt`;
  const restaurantId=`${id}_restaurant`,activityId=`${id}_activity`,orderId=`${id}_order`,paymentId=`${id}_oldrealpayment`,oldRefundId=`${id}_oldrealrefund`,paymentJobId=`${id}_oldpaymentjob`,oldRefundJobId=`${id}_oldrefundjob`;
  let beforeV11, beforeOldPayment, beforeOldRefund;
  try {
    await pool.query('INSERT INTO "User" (id,"wechatOpenid","updatedAt") VALUES ($1,$2,clock_timestamp())', [userId, `mock_${id}`]);
    await pool.query(`INSERT INTO "Restaurant" (id,name,district,"businessArea",address,"contactName","contactPhone","budgetCents","cuisineTags",capacity,"updatedAt") VALUES ($1,'合成餐厅','合成区','合成商圈','合成地址','合成联系人','synthetic-phone',0,ARRAY[]::text[],4,clock_timestamp())`,[restaurantId]);
    await pool.query(`INSERT INTO "Activity" (id,"restaurantId",title,theme,description,district,"businessArea","startsAt","endsAt","registrationEndsAt","serviceFeeCents","mealFeePolicyText",capacity,"updatedAt") VALUES ($1,$2,'合成体验','菜单体验','合成资料','合成区','合成商圈',clock_timestamp()+interval '3 days',clock_timestamp()+interval '4 days',clock_timestamp()+interval '2 days',100,'到店支付',4,clock_timestamp())`,[activityId,restaurantId]);
    await pool.query(`INSERT INTO "Order" (id,"userId","activityId","amountCents","agreementVersion","updatedAt") VALUES ($1,$2,$3,100,'synthetic-legacy',clock_timestamp())`,[orderId,userId,activityId]);
    await pool.query(`INSERT INTO "Payment" (id,"orderId","merchantOrderNo","amountCents",channel,"merchantScope","providerConfigId","updatedAt") VALUES ($1,$2,$3,100,'wechat',$4,'synthetic-original-config',clock_timestamp())`,[paymentId,orderId,`${id}_oldpaymentmerchant`,'a'.repeat(64)]);
    await pool.query(`INSERT INTO "Refund" (id,"orderId","paymentId","merchantRefundNo","amountCents",reason,"requestedBy",channel,"merchantScope","providerConfigId","updatedAt") VALUES ($1,$2,$3,$4,100,'SYNTHETIC_COMPAT_SENTINEL','synthetic-owner','wechat',$5,'synthetic-original-config',clock_timestamp())`,[oldRefundId,orderId,paymentId,`${id}_oldrefundmerchant`,'a'.repeat(64)]);
    beforeOldPayment=(await pool.query('SELECT to_jsonb(p) AS value FROM "Payment" p WHERE id=$1',[paymentId])).rows[0].value;
    beforeOldRefund=(await pool.query('SELECT to_jsonb(r) AS value FROM "Refund" r WHERE id=$1',[oldRefundId])).rows[0].value;
    for(const [jobId,kind,refId] of [[paymentJobId,'RECOVER_PAYMENT',paymentId],[oldRefundJobId,'RECOVER_REFUND',oldRefundId]])await pool.query('INSERT INTO "DurableJob" (id,kind,"businessKey","refId","runAt","updatedAt") VALUES ($1,$2,$3,$4,$5,clock_timestamp())',[jobId,kind,`${id}:${kind}`,refId,new Date('1900-01-01T00:00:00Z')]);
    await pool.query('INSERT INTO "Notification" (id,"businessKey","userId",type,"updatedAt") VALUES ($1,$2,$3,$4,clock_timestamp())', [noticeId, `${id}:notice`, userId, 'SIMULATION_WORKER_COMPAT']);
    await pool.query('INSERT INTO "ChannelReceipt" (id,channel,"merchantScope","channelTradeNo","merchantOrderNo","amountCents","evidenceHash","verifiedAt","paidAt") VALUES ($1,$2,$3,$4,$5,10600,$6,clock_timestamp(),clock_timestamp())',[receiptId,'mock','mock-local',`${id}_trade`,`${id}_merchant_order`,'a'.repeat(64)]);
    await pool.query('INSERT INTO "V11FundComponent" (id,"receiptId",kind,"originalCents") VALUES ($1,$3,\'F\',600),($2,$3,\'D\',10000)',[`${id}_F`,`${id}_D`,receiptId]);
    await pool.query('INSERT INTO "V11RefundInstruction" (id,"receiptId","businessKey","merchantRefundNo","serviceFeeCents","depositCents","totalCents","originalTradeNo","updatedAt") VALUES ($1,$2,$3,$4,600,10000,10600,$5,clock_timestamp())',[refundId,receiptId,`${id}:refund`,`${id}_merchant`,`${id}_trade`]);
    beforeV11=(await pool.query('SELECT to_jsonb(r) AS value FROM "V11RefundInstruction" r WHERE id=$1',[refundId])).rows[0].value;
    for (const [jobId, kind, refId] of [[futureJobId, 'V11_COMPAT_SENTINEL', id], [legacyJobId, 'DELIVER_INBOX', noticeId], [refundJobId, 'V11_REFUND', refundId]]) {
      await pool.query('INSERT INTO "DurableJob" (id,kind,"businessKey","refId","runAt","updatedAt") VALUES ($1,$2,$3,$4,$5,clock_timestamp())', [jobId, kind, `${id}:${kind}`, refId, new Date(0)]);
    }
    const result = await new Promise((resolveExit, reject) => {
      const child = spawn(process.execPath, ['dist/worker.js', '--once'], {
        cwd: resolve(consumerRoot, 'services/api'), env: { ...childEnvironment(runtime), RELEASE_VERSION: 'SIMULATION-legacy-compat' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 15_000);
      child.stdout.on('data', data => { stdout += data; }); child.stderr.on('data', data => { stderr += data; });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('close', code => { clearTimeout(timer); resolveExit({ code, stdout, stderr }); });
    });
    assert.equal(result.code, 0, `Packaged legacy worker failed: ${result.stderr}`);
    const jobs = (await pool.query('SELECT id,state,attempts,generation,"leaseOwner" FROM "DurableJob" WHERE id=ANY($1::text[])', [[futureJobId, legacyJobId, refundJobId,paymentJobId,oldRefundJobId]])).rows;
    const future = jobs.find(job => job.id === futureJobId), legacy = jobs.find(job => job.id === legacyJobId);
    for(const realJobId of [paymentJobId,oldRefundJobId]){const job=jobs.find(j=>j.id===realJobId);assert.equal(job.state,'READY');assert.equal(job.attempts,0);assert.equal(job.generation,0);assert.equal(job.leaseOwner,null);}
    assert.deepEqual((await pool.query('SELECT to_jsonb(p) AS value FROM "Payment" p WHERE id=$1',[paymentId])).rows[0].value,beforeOldPayment);
    assert.deepEqual((await pool.query('SELECT to_jsonb(r) AS value FROM "Refund" r WHERE id=$1',[oldRefundId])).rows[0].value,beforeOldRefund);
    assert.equal(future.state, 'READY'); assert.equal(future.attempts, 0); assert.equal(future.generation, 0); assert.equal(future.leaseOwner, null);
    const newRefund=jobs.find(job=>job.id===refundJobId);
    assert.equal(newRefund.state,'READY');assert.equal(newRefund.attempts,0);assert.equal(newRefund.generation,0);assert.equal(newRefund.leaseOwner,null);
    assert.deepEqual((await pool.query('SELECT to_jsonb(r) AS value FROM "V11RefundInstruction" r WHERE id=$1',[refundId])).rows[0].value,beforeV11);
    assert.deepEqual((await pool.query('SELECT kind,"originalCents",version FROM "V11FundComponent" WHERE "receiptId"=$1 ORDER BY kind',[receiptId])).rows,[{kind:'D',originalCents:10000,version:0},{kind:'F',originalCents:600,version:0}]);
    assert.equal(legacy.state, 'DONE'); assert.equal(legacy.attempts, 1);
    assert.equal((await pool.query('SELECT status FROM "Notification" WHERE id=$1', [noticeId])).rows[0].status, 'SENT');
  } finally {
    // The selected rows belong only to this test; no shared reset/drop or general cleanup occurs.
    try {
      await verifyOwnedEnvironment(dirname(runtimePath));
      await pool.query('DELETE FROM "DurableJob" WHERE id=ANY($1::text[])', [[futureJobId, legacyJobId, refundJobId,paymentJobId,oldRefundJobId]]);
      await pool.query('DELETE FROM "V11RefundInstruction" WHERE id=$1',[refundId]);
      await pool.query('DELETE FROM "V11FundComponent" WHERE "receiptId"=$1',[receiptId]);
      await pool.query('DELETE FROM "ChannelReceipt" WHERE id=$1',[receiptId]);
      await pool.query('DELETE FROM "Notification" WHERE id=$1', [noticeId]);
      await pool.query('DELETE FROM "Refund" WHERE id=$1',[oldRefundId]);
      await pool.query('DELETE FROM "Payment" WHERE id=$1',[paymentId]);
      await pool.query('DELETE FROM "Order" WHERE id=$1',[orderId]);
      await pool.query('DELETE FROM "Activity" WHERE id=$1',[activityId]);
      await pool.query('DELETE FROM "Restaurant" WHERE id=$1',[restaurantId]);
      await pool.query('DELETE FROM "User" WHERE id=$1', [userId]);
    } finally { await pool.end(); }
  }
});
