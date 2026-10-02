import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { readFileSync, readdirSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const require = createRequire(resolve('services/api/package.json'));
const { Pool } = require('pg');
const schema = `l1_migration_${randomUUID().replaceAll('-', '')}`;
const control = new Pool({ connectionString: process.env.DATABASE_URL });
const scoped = new Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
try {
  await control.query(`CREATE SCHEMA "${schema}"`);
  const folders = readdirSync('prisma/migrations').filter(name => /^\d/.test(name)).sort();
  for (const name of folders.slice(0, 4)) {
    await scoped.query(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
  }
  await scoped.query(`INSERT INTO "User" (id,"wechatOpenid","updatedAt") VALUES
    ('u1','test_u1',now()),('u2','test_u2',now()),('u3','test_u3',now())`);
  await scoped.query(`INSERT INTO "Restaurant" (id,name,district,"businessArea",address,"contactName","contactPhone","budgetCents","cuisineTags",capacity,"updatedAt")
    VALUES ('r1','Test','Test','Test','Test','Test','000',9900,ARRAY[]::text[],6,now())`);
  await scoped.query(`INSERT INTO "Activity" (id,"restaurantId",title,theme,description,district,"businessArea","startsAt","endsAt","registrationEndsAt","serviceFeeCents","mealFeePolicyText",capacity,"updatedAt")
    VALUES ('a1','r1','Test','Test','Test','Test','Test',now()+interval '2 day',now()+interval '3 day',now()+interval '1 day',9900,'Test',6,now())`);
  await scoped.query(`INSERT INTO "Order" (id,"userId","activityId","amountCents",status,"agreementVersion","updatedAt") VALUES
    ('o1','u1','a1',9900,'PENDING_PAYMENT','v1',now()),
    ('o2','u2','a1',9900,'CANCELED','v1',now()),
    ('o3','u3','a1',9900,'PAID_PENDING_GROUP','v1',now())`);
  for (const name of folders.slice(4)) {
    await scoped.query(readFileSync(`prisma/migrations/${name}/migration.sql`, 'utf8'));
  }
  const migrated = await scoped.query(`SELECT id,status,"registrationActive","capacityHeld",version FROM "Order" ORDER BY id`);
  if (migrated.rows.length !== 3 || migrated.rows.some(row => !row.registrationActive || !row.capacityHeld || row.version !== 0)) {
    throw new Error('Historical orders were changed or discarded');
  }
  await scoped.query(`UPDATE "Order" SET "registrationActive"=false,"capacityHeld"=false WHERE id='o2'`);
  await scoped.query(`INSERT INTO "Order" (id,"userId","activityId","amountCents",status,"agreementVersion","updatedAt")
    VALUES ('o2_new','u2','a1',9900,'PENDING_PAYMENT','v1',now())`);
  let duplicateBlocked = false;
  try {
    await scoped.query(`INSERT INTO "Order" (id,"userId","activityId","amountCents",status,"agreementVersion","updatedAt")
      VALUES ('o2_duplicate','u2','a1',9900,'PENDING_PAYMENT','v1',now())`);
  } catch (error) {
    duplicateBlocked = error.code === '23505';
  }
  if (!duplicateBlocked) throw new Error('Partial unique index failed');
  let paidWithoutCapacityBlocked = false;
  try {
    await scoped.query(`UPDATE "Order" SET "capacityHeld"=false WHERE id='o3'`);
  } catch (error) {
    paidWithoutCapacityBlocked = error.code === '23514';
  }
  if (!paidWithoutCapacityBlocked) throw new Error('Paid capacity check failed');
  const retained = await scoped.query(`SELECT count(*)::int AS count FROM "Order"`);
  if (retained.rows[0].count !== 4) throw new Error('Historical row was lost');
  console.log(JSON.stringify({ historicalRowsPreserved: 3, replacementRows: 1,
    duplicateBlocked, paidWithoutCapacityBlocked }));
} finally {
  await scoped.end();
  await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await control.end();
}
