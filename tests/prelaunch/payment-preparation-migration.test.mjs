import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {root,verifyOwnedEnvironment} from '../../scripts/prelaunch-owned-env.mjs';
test('complete preparation SQL migrates the prior intent table and preserves mock rows',async()=>{
  const {runtime}=await verifyOwnedEnvironment('/tmp/fanju-prelaunch-20261001-b48140fda0c1');
  const require=createRequire(root+'/services/api/package.json');const {Client}=require('pg');
  const db=new Client({connectionString:runtime.database_url});await db.connect();
  const schema='preparation_migration_'+randomUUID().replaceAll('-','');
  try {
    await db.query('BEGIN');await db.query(`CREATE SCHEMA "${schema}"`);await db.query(`SET LOCAL search_path TO "${schema}"`);
    const baseline=await readFile(root+'/prisma/migrations/20261001000000_prelaunch_v11_expand/migration.sql','utf8');
    const table=baseline.match(/CREATE TABLE "V11PaymentIntent" \([\s\S]*?\n\);/);assert.ok(table);
    const constraint=baseline.match(/ALTER TABLE "V11PaymentIntent" ADD CONSTRAINT "V11PaymentIntent_mock_only"[^;]+;/);assert.ok(constraint);
    await db.query(table[0]);await db.query(constraint[0]);
    await db.query(`INSERT INTO "V11PaymentIntent" (id,"registrationId","merchantOrderNo","totalCents","updatedAt") VALUES ('synthetic-old','synthetic-reg','synthetic-order',100,now())`);
    await db.query(await readFile(root+'/prisma/migrations/20261001010000_v11_payment_preparation/migration.sql','utf8'));
    const {rows}=await db.query(`SELECT channel,"merchantScope","preparationState","prepayId",state FROM "V11PaymentIntent" WHERE id='synthetic-old'`);
    assert.deepEqual(rows[0],{channel:'mock',merchantScope:'mock-local',preparationState:'NOT_STARTED',prepayId:null,state:'NEW'});
    await db.query(`INSERT INTO "V11PaymentIntent" (id,"registrationId","merchantOrderNo",channel,"merchantScope","providerConfigId","totalCents","updatedAt") VALUES ('synthetic-new','synthetic-reg','synthetic-real-order','wechat',$1,'synthetic-v1',100,now())`,['a'.repeat(64)]);
    await db.query('SAVEPOINT bad_binding');
    await assert.rejects(db.query(`UPDATE "V11PaymentIntent" SET "merchantScope"='wrong' WHERE id='synthetic-new'`));await db.query('ROLLBACK TO SAVEPOINT bad_binding');
    await db.query('SAVEPOINT bad_prepared');
    await assert.rejects(db.query(`UPDATE "V11PaymentIntent" SET "preparationState"='PREPARED' WHERE id='synthetic-new'`));await db.query('ROLLBACK TO SAVEPOINT bad_prepared');
    await db.query(`UPDATE "V11PaymentIntent" SET "preparationState"='PREPARED',"prepayId"='synthetic-prepay' WHERE id='synthetic-new'`);
  } finally {await db.query('ROLLBACK');await db.end();}
});
