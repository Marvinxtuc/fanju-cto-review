import { readFile, stat } from "node:fs/promises";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { importStatement } from "./reconciliation/service.js";

if (!["local", "ci"].includes(process.env.APP_ENV ?? "") || !["development", "test"].includes(process.env.NODE_ENV ?? "")
  || process.env.PAYMENT_PROVIDER !== "mock" || process.env.REFUND_PROVIDER !== "mock" || !process.env.DATABASE_URL) {
  throw new Error("Controlled import requires an explicit local mock environment");
}
const [file, expectedDigest] = process.argv.slice(2);
const owner = process.env.FINANCIAL_CASE_OWNER?.trim();
if (!file || !/^[a-f0-9]{64}$/.test(expectedDigest ?? "") || !owner) {
  throw new Error("Usage: FINANCIAL_CASE_OWNER=<operator> node dist/reconciliation-cli.js <statement.json> <verified-sha256>");
}
const info = await stat(file);
if (!info.isFile() || info.size > 32 * 1024 * 1024) throw new Error("Invalid statement file");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const result = await importStatement(db, await readFile(file, "utf8"), expectedDigest!, owner);
  console.log(JSON.stringify(result));
} finally { await db.$disconnect(); }
