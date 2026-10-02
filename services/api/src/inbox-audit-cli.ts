import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { auditInbox, repairMissingInboxJobs } from "./orders/inbox-recovery.js";

if (!["local", "ci"].includes(process.env.APP_ENV ?? "") || !["test", "development"].includes(process.env.NODE_ENV ?? "")
  || !process.env.DATABASE_URL) throw new Error("Inbox audit requires explicit isolated local database");
const repair = process.argv.includes("--repair");
if (process.argv.some(arg => arg.startsWith("--") && arg !== "--repair")) throw new Error("Unsupported option");
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  const before = await auditInbox(db);
  const result = repair ? await repairMissingInboxJobs(db) : null;
  console.log(JSON.stringify({ before, repair: result }));
} finally {
  await db.$disconnect();
}
