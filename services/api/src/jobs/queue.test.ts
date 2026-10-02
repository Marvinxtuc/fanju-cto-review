import { randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../generated/prisma/client.js";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { claimJob, enqueue, finishJob, retryJob, runOne } from "./queue.js";
const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const prefix = `jobs_test_${randomUUID().replaceAll("-", "")}`;
const control = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${prefix}` }, { schema: prefix }) });
suite("persistent queue on PostgreSQL", () => {
  beforeAll(async () => {
    await control.$executeRawUnsafe(`CREATE SCHEMA "${prefix}"`);
    for (const name of ["DurableJob", "FinancialCase"]) {
      await control.$executeRawUnsafe(`CREATE TABLE "${prefix}"."${name}" (LIKE public."${name}" INCLUDING ALL)`);
    }
  });
  afterAll(async () => {
    const jobs = await db.durableJob.findMany({ where: { businessKey: { startsWith: prefix } }, select: { id: true } });
    await db.financialCase.deleteMany({ where: { sourceRef: { in: jobs.map(j => j.id) } } });
    await db.durableJob.deleteMany({ where: { businessKey: { startsWith: prefix } } });
    await db.$disconnect();
    await control.$executeRawUnsafe(`DROP SCHEMA "${prefix}" CASCADE`);
    await control.$disconnect();
  });
  it("enqueues atomically with the enclosing business transaction", async () => {
    await expect(db.$transaction(async tx => {
      await enqueue(tx, "TEST", `${prefix}:rollback`, "none");
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect(await db.durableJob.count({ where: { businessKey: `${prefix}:rollback` } })).toBe(0);
  });
  it("uses the database clock for immediate work and preserves explicit scheduling", async () => {
    const future = new Date(Date.now() + 60 * 60 * 1000);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(future);
    try {
      const immediate = await db.$transaction(tx => enqueue(tx, "TEST", `${prefix}:clock`, "one"));
      const scheduled = await db.$transaction(tx => enqueue(tx, "TEST", `${prefix}:scheduled`, "one", future));
      const lease = await claimJob(db, `${prefix}:clock-worker`);
      expect(lease?.id).toBe(immediate.id);
      expect(await finishJob(db, lease!)).toBe(true);
      expect(await claimJob(db, `${prefix}:early-worker`)).toBeNull();
      expect(scheduled.runAt).toEqual(future);
    } finally {
      vi.useRealTimers();
      await db.durableJob.deleteMany({ where: { businessKey: `${prefix}:scheduled` } });
    }
  });
  it("deduplicates jobs and allows only one of twenty consumers to claim", async () => {
    const key = `${prefix}:concurrent`;
    await Promise.all(Array.from({ length: 20 }, () => db.$transaction(tx => enqueue(tx, "TEST", key, "one"))));
    expect(await db.durableJob.count({ where: { businessKey: key } })).toBe(1);
    const claimed = (await Promise.all(Array.from({ length: 20 }, (_, i) => claimJob(db, `${prefix}:${i}`)))).filter(j => j !== null);
    expect(claimed).toHaveLength(1);
    expect(await finishJob(db, claimed[0]!)).toBe(true);
  });
  it("fences expired A after B has completed, including A's retry write", async () => {
    await db.$transaction(tx => enqueue(tx, "TEST", `${prefix}:lease`, "one"));
    const a = (await claimJob(db, `${prefix}:A`))!;
    await db.durableJob.update({ where: { id: a.id }, data: { leaseUntil: new Date(0) } });
    expect(await finishJob(db, a)).toBe(false);
    const b = (await claimJob(db, `${prefix}:B`))!;
    expect(b.id).toBe(a.id);
    expect(b.generation).toBe(a.generation + 1);
    expect(await finishJob(db, b)).toBe(true);
    expect(await retryJob(db, a, "local-review")).toBe(false);
    expect((await db.durableJob.findUniqueOrThrow({ where: { id: a.id } })).state).toBe("DONE");
  });
  it("backs off and transfers the eighth failed attempt to a dated manual case", async () => {
    const job = await db.$transaction(tx => enqueue(tx, "TEST", `${prefix}:budget`, "one"));
    for (let n = 1; n <= 8; n++) {
      const lease = (await claimJob(db, `${prefix}:worker`))!;
      expect(lease.attempts).toBe(n);
      expect(await retryJob(db, lease, "local-review", "unsafe arbitrary error text")).toBe(true);
      const saved = await db.durableJob.findUniqueOrThrow({ where: { id: job.id } });
      expect(saved.errorClass).toBe("RECOVERY_REQUIRED");
      expect(saved.state).toBe(n === 8 ? "MANUAL" : "RETRY");
      expect(saved.runAt.getTime()).toBeGreaterThan(Date.now());
      if (n < 8) await db.durableJob.update({ where: { id: job.id }, data: { runAt: new Date(0) } });
    }
    const issue = await db.financialCase.findUniqueOrThrow({ where: { caseKey: `JOB_REQUIRES_REVIEW:${job.id}` } });
    expect(issue.owner).toBe("local-review");
    expect(issue.deadline.getTime() - Date.now()).toBeGreaterThan(23 * 60 * 60 * 1000);
    expect(await claimJob(db, `${prefix}:again`)).toBeNull();
  });
  it("never invokes a ninth channel attempt after repeated worker death", async () => {
    const job = await db.$transaction(tx => enqueue(tx, "TEST", `${prefix}:crash`, "one"));
    await db.durableJob.update({ where: { id: job.id }, data: { attempts: 8 } });
    let called = false;
    await runOne(db, `${prefix}:worker`, "local-review", { TEST: async () => { called = true; } });
    expect(called).toBe(false);
    expect((await db.durableJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("MANUAL");
  });
  it("event-only consumers leave channel-dispatch tasks untouched", async () => {
    const payment = await db.$transaction(tx => enqueue(tx, "RECOVER_PAYMENT", `${prefix}:dispatch`, "payment"));
    const event = await db.$transaction(tx => enqueue(tx, "APPLY_EVENT", `${prefix}:event-only`, "event"));
    const lease = (await claimJob(db, `${prefix}:event-worker`, ["APPLY_EVENT"]))!;
    expect(lease.id).toBe(event.id);
    await finishJob(db, lease);
    expect((await db.durableJob.findUniqueOrThrow({ where: { id: payment.id } })).state).toBe("READY");
    // Consume this fixture so subsequent tests retain an empty queue.
    const next = (await claimJob(db, `${prefix}:local-worker`))!;
    expect(next.id).toBe(payment.id);await finishJob(db, next);
  });
  it("survives reconnect and parks unsupported payloads instead of discarding", async () => {
    const job = await db.$transaction(tx => enqueue(tx, "FUTURE", `${prefix}:restart`, "one"));
    await db.durableJob.update({ where: { id: job.id }, data: { payloadVersion: 2 } });
    await db.$disconnect();
    await runOne(db, `${prefix}:restarted`, "local-review", {});
    expect((await db.durableJob.findUniqueOrThrow({ where: { id: job.id } })).state).toBe("MANUAL");
  });
});
