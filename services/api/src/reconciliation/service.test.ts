import { createHash } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fundingTestDatabase } from "../../test-support/funding-db.js";
import { importStatement, reconcileKnown } from "./service.js";
import { applyEvent } from "../events/inbox.js";
import { hasCompleteBillCoverage } from "../jobs/heartbeat.js";
const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const fixture = fundingTestDatabase();
const { db } = fixture;
const digest = (text: string) => createHash("sha256").update(text).digest("hex");
suite("controlled bilateral reconciliation", () => {
  beforeAll(fixture.setup);
  afterAll(fixture.close);
  it("finds channel-only money and recovers it when no local intent or job exists", async () => {
    const raw = JSON.stringify({ merchantScope: "mock-local", period: "2026-09-29", coverageState: "COMPLETE", records: [{
      kind: "PAYMENT_SUCCEEDED", channel: "mock", merchantScope: "mock-local", merchantOrderNo: "lost-local-order",
      channelTradeNo: "channel-only-trade", amountCents: 9900, currency: "CNY", evidenceHash: "controlled-export-proof",
    }] });
    await expect(importStatement(db, raw, "wrong-digest", "test-owner")).rejects.toThrow("digest");
    const batch = await importStatement(db, raw, digest(raw), "test-owner");
    expect(batch.imported).toBe(1);
    const event = await db.receivedEvent.findFirstOrThrow();
    await applyEvent(db, event.id, "test-owner");
    await importStatement(db, raw, digest(raw), "test-owner");
    await applyEvent(db, event.id, "test-owner");
    expect(await db.reconciliationBatch.count()).toBe(1);
    expect(await db.channelReceipt.count()).toBe(1);
    const issue = await db.financialCase.findFirstOrThrow({ where: { category: "UNASSOCIATED_RECEIPT" } });
    expect(issue.owner).toBe("test-owner");
    expect(issue.deadline.getTime()).toBeGreaterThan(Date.now());
  });
  it("does not record an unavailable statement as a zero-difference completed reconciliation", async () => {
    const raw = JSON.stringify({ merchantScope: "mock-local", period: "2026-09-28", coverageState: "UNAVAILABLE", records: [] });
    expect((await importStatement(db, raw, digest(raw), "test-owner")).coverageState).toBe("UNAVAILABLE");
    expect(await db.financialCase.count({ where: { category: "STATEMENT_UNAVAILABLE_OR_INCOMPLETE" } })).toBe(1);
  });
  it("lets a later complete decision replace unavailable coverage while retaining audit history", async () => {
    const scope = "mock-coverage-sequence";
    const statement = (coverageState: "UNAVAILABLE" | "INCOMPLETE" | "COMPLETE") => JSON.stringify({
      merchantScope: scope, period: "2026-09-30", coverageState, records: [],
    });
    for (const state of ["UNAVAILABLE", "COMPLETE", "INCOMPLETE", "COMPLETE"] as const) {
      const raw = statement(state);
      await importStatement(db, raw, digest(raw), "test-owner");
      expect(await hasCompleteBillCoverage(db, scope, "2026-09-30")).toBe(state === "COMPLETE");
    }
    expect(await db.reconciliationBatch.count({ where: { merchantScope: scope, period: "2026-09-30" } })).toBe(3);
  });
  it("rejects mixed merchant scopes before persisting any import", async () => {
    const raw = JSON.stringify({ merchantScope: "scope-a", period: "2026-09-29", coverageState: "COMPLETE", records: [{
      kind: "PAYMENT_SUCCEEDED", channel: "mock", merchantScope: "scope-b", merchantOrderNo: "one",
      channelTradeNo: "two", amountCents: 9900, currency: "CNY", evidenceHash: "proof",
    }] });
    await expect(importStatement(db, raw, digest(raw), "test-owner")).rejects.toThrow("scope");
    expect(await db.reconciliationBatch.count({ where: { merchantScope: "scope-a" } })).toBe(0);
  });
  it("reports local records that channels cannot confirm and separately reports query outage", async () => {
    // Minimal local historical data; all fields are synthetic and confined to this schema.
    const user = await db.user.create({ data: { wechatOpenid: "mock_reconcile" } });
    const restaurant = await db.restaurant.create({ data: { name: "测试餐厅", district: "测试区", businessArea: "测试区", address: "测试地址", contactName: "测试负责人", contactPhone: "13800138000", budgetCents: 9900, capacity: 6, cuisineTags: [] } });
    const activity = await db.activity.create({ data: { restaurantId: restaurant.id, title: "菜单体验", theme: "菜单体验", description: "菜单体验", district: "测试区", businessArea: "测试区", startsAt: new Date(), endsAt: new Date(), registrationEndsAt: new Date(), serviceFeeCents: 9900, mealFeePolicyText: "现场结算", capacity: 6 } });
    const order = await db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 9900, agreementVersion: "v1" } });
    const payment = await db.payment.create({ data: { orderId: order.id, amountCents: 9900, merchantScope: "mock-local", providerConfigId: "mock-v1", status: "SUCCEEDED" } });
    const first = await reconcileKnown(db, "mock-local", async () => null, "test-owner");
    expect(first.checked).toBe(1);
    expect(await db.financialCase.count({ where: { category: "LOCAL_SUCCESS_CHANNEL_UNCONFIRMED", sourceRef: payment.id } })).toBe(1);
    const outage = await reconcileKnown(db, "mock-local", async () => { throw new Error("offline"); }, "test-owner");
    expect(outage.unavailable).toBe(1);
    expect(outage.coverageState).toBe("INCOMPLETE");
  });
});
