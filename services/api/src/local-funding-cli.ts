import { z } from "zod";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import { claimLegacyMockPayment } from "./funding/legacy.js";
import { resolveVerifiedCase } from "./reconciliation/cases.js";

if (!["local", "ci"].includes(process.env.APP_ENV ?? "") || !["development", "test"].includes(process.env.NODE_ENV ?? "")
  || process.env.PAYMENT_PROVIDER !== "mock" || process.env.REFUND_PROVIDER !== "mock" || !process.env.DATABASE_URL) {
  throw new Error("Funding rehearsal requires an explicit isolated mock environment");
}
const [action, ...args] = process.argv.slice(2);
const identity = z.string().regex(/^[a-zA-Z0-9_-]{1,100}$/);
const operator = identity.parse(process.env.FINANCIAL_CASE_OWNER);
const reviewer = action === "list" ? undefined : identity.parse(process.env.FINANCIAL_CASE_REVIEWER);
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
try {
  if (action === "list" && !args.length) {
    console.log(JSON.stringify(await db.financialCase.findMany({ where: { state: "OPEN" }, take: 100,
      orderBy: { deadline: "asc" }, select: { id: true, category: true, sourceRef: true, owner: true, deadline: true } })));
  } else if (action === "claim-mock" && args.length === 2) {
    const receipt = await claimLegacyMockPayment(db, { paymentId: identity.parse(args[0]), receiptId: identity.parse(args[1]), operator, reviewer: reviewer! });
    console.log(JSON.stringify({ receiptId: receipt.id, paymentId: receipt.paymentId, status: "associated-only" }));
  } else if (action === "resolve" && args.length === 1) {
    const result = await resolveVerifiedCase(db, { caseId: identity.parse(args[0]), operator, reviewer: reviewer! });
    console.log(JSON.stringify({ caseId: result.id, state: result.state }));
  } else throw new Error("Usage: local-funding-cli.js list | claim-mock <payment-id> <receipt-id> | resolve <case-id>");
} finally { await db.$disconnect(); }
