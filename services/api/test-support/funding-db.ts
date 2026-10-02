import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client.js";

export function fundingTestDatabase() {
  const schema = `funding_test_${randomUUID().replaceAll("-", "")}`;
  const connectionString = process.env.DATABASE_URL;
  const control = new Pool({ connectionString });
  const pool = new Pool({ connectionString, options: `-c search_path=${schema}` });
  const db = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });
  return { db, async setup() {
    if (!connectionString || process.env.RUN_DB_TESTS !== "1") throw new Error("Explicit isolated DATABASE_URL required");
    await control.query(`CREATE SCHEMA "${schema}"`);
    const migrations = fileURLToPath(new URL("../../../prisma/migrations/", import.meta.url));
    for (const folder of (await readdir(migrations)).sort()) {
      if (/^\d/.test(folder)) await pool.query(await readFile(`${migrations}/${folder}/migration.sql`, "utf8"));
    }
  }, async close() {
    await db.$disconnect();
    await pool.end();
    await control.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await control.end();
  } };
}
