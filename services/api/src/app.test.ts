import { applyEvent } from "./events/inbox.js";
import { bindingFor } from "./funding/intents.js";
import { applyPaymentEvidence } from "./funding/receipts.js";
import { runOne } from "./jobs/queue.js";
import { hasCompleteBillCoverage, recordWorkerPoll } from "./jobs/heartbeat.js";
import { deliverInbox } from "./orders/formation.js";
import { auditInbox, repairMissingInboxJobs } from "./orders/inbox-recovery.js";
import { prepareObligation } from "./funding/refunds.js";
import { recoveryHandlers } from "./funding/recovery.js";
import { PersistentMockChannel } from "./funding/mock-channel.js";
import {
  ActivityStatus,
  OrderStatus,
  PrismaClient,
  RefundStatus,
} from "./generated/prisma/client.js";
import { createCipheriv, createSign, generateKeyPairSync, randomBytes, scryptSync } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { buildApp } from "./app.js";
import { agreementHash } from "./orders/agreement.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://timeleft:timeleft_dev_password@localhost:5432/timeleft_shanghai?schema=public";

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

const describeDb = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const testRunPrefix = `api_db_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const { privateKey: callbackPrivateKey, publicKey: callbackPublicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const callbackFixtureKey = "0123456789abcdef0123456789abcdef";
const callbackNowSeconds = 1_800_000_000;

describeDb("api mock MVP flow", () => {
  let app: Awaited<ReturnType<typeof buildApp>>;

  it("allows the operations console to preflight manual table-group adjustments", async () => {
    const response = await appInject({
      method: "OPTIONS",
      url: "/api/ops/activities/activity-1/table-groups",
      headers: {
        origin: "http://127.0.0.1:5173",
        "access-control-request-method": "PUT",
      },
    });

    expect(response.statusCode).toBe(204);
    expect(response.headers["access-control-allow-methods"]).toContain("PUT");
  });

  beforeAll(async () => {
    await cleanupTestData();
    await prisma.agreementPolicy.create({ data: { version: "v1", text: "仅用于隔离数据库测试的协议文本", textHash: agreementHash("仅用于隔离数据库测试的协议文本"),
      source: "isolated-test-fixture", active: true, activatedAt: new Date("2026-01-01T00:00:00.000Z") } });
    app = await buildApp({ prisma, providerEnv: { NODE_ENV: "test", APP_ENV: "local", LOCAL_DEMO_ENABLED: "true", SESSION_SECRET: "test-session-signing-material-32-bytes" } });
    appRef = app;
  });

  afterEach(async () => {
    await cleanupTestData();
  });

  afterAll(async () => {
    await app.close();
    await cleanupTestData();
    await prisma.agreementPolicy.delete({ where: { version: "v1" } });
    await prisma.$disconnect();
  });

  it("requires fresh configured worker heartbeats before readiness succeeds", async () => {
    const requiredMode = `test-${testRunPrefix}`;
    const guarded = await buildApp({ prisma, providerEnv: { NODE_ENV: "test", APP_ENV: "local",
      LOCAL_DEMO_ENABLED: "true", SESSION_SECRET: "test-session-signing-material-32-bytes",
      REQUIRED_WORKER_MODES: requiredMode } });
    try {
      expect((await guarded.inject({ method: "GET", url: "/health" })).statusCode).toBe(200);
      expect((await guarded.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
      await recordWorkerPoll(prisma, requiredMode, `${testRunPrefix}-worker`, "test-version");
      expect((await guarded.inject({ method: "GET", url: "/ready" })).statusCode).toBe(200);
      await prisma.workerHeartbeat.update({ where: { mode_instanceId: { mode: requiredMode,
        instanceId: `${testRunPrefix}-worker` } }, data: { lastPolledAt: new Date("2000-01-01") } });
      expect((await guarded.inject({ method: "GET", url: "/ready" })).statusCode).toBe(503);
      await recordWorkerPoll(prisma, requiredMode, `${testRunPrefix}-worker`, "test-version");
      const scope = `test-${testRunPrefix}`;
      expect(await hasCompleteBillCoverage(prisma, scope, "2026-09-30")).toBe(false);
      const bill = await prisma.reconciliationBatch.create({ data: { merchantScope: scope, period: "2026-09-30",
        sourceHash: `test-${testRunPrefix}`, coverageState: "INCOMPLETE" } });
      expect(await hasCompleteBillCoverage(prisma, scope, "2026-09-30")).toBe(false);
      await prisma.reconciliationBatch.update({ where: { id: bill.id }, data: { coverageState: "COMPLETE" } });
      expect(await hasCompleteBillCoverage(prisma, scope, "2026-09-30")).toBe(true);
      const secondBill = await prisma.reconciliationBatch.create({ data: { merchantScope: scope, period: "2026-09-30",
        sourceHash: `second-${testRunPrefix}`, coverageState: "INCOMPLETE" } });
      expect(await hasCompleteBillCoverage(prisma, scope, "2026-09-30")).toBe(false);
      await prisma.reconciliationBatch.update({ where: { id: secondBill.id }, data: { coverageState: "COMPLETE" } });
      expect(await hasCompleteBillCoverage(prisma, scope, "2026-09-30")).toBe(true);
    } finally {
      await prisma.workerHeartbeat.deleteMany({ where: { instanceId: `${testRunPrefix}-worker` } });
      await prisma.reconciliationBatch.deleteMany({ where: { merchantScope: `test-${testRunPrefix}` } });
      await guarded.close();
    }
  });

  it("creates an order with server-side service fee and handles payment idempotently", async () => {
    const adminToken = await loginAdmin("ops-user");
    const userToken = await loginUser("buyer-1");
    await bindPhone(userToken, "13800138000");
    await confirmAgreement(userToken);
    const activityId = await createOpenActivity(adminToken);

    const orderResponse = await app.inject({
      method: "POST",
      url: "/api/orders",
      headers: auth(userToken),
      payload: {
        activityId,
        agreementVersion: "v1",
        amountCents: 1,
      },
    });
    expect(orderResponse.statusCode).toBe(200);
    const orderPayload = orderResponse.json();
    expect(orderPayload.order.amountCents).toBe(9900);

    const paymentResponse = await app.inject({
      method: "POST",
      url: "/api/mock/payments",
      headers: auth(userToken),
      payload: { orderId: orderPayload.order.id },
    });
    expect(paymentResponse.statusCode).toBe(200);
    const payment = paymentResponse.json().payment;

    const firstCallback = await app.inject({
      method: "POST",
      url: `/api/mock/payments/${payment.id}/succeed`,
    });
    expect(firstCallback.statusCode).toBe(200);
    expect(firstCallback.json().idempotent).toBe(false);

    const secondCallback = await app.inject({
      method: "POST",
      url: `/api/mock/payments/${payment.id}/succeed`,
    });
    expect(secondCallback.statusCode).toBe(200);
    expect(secondCallback.json().idempotent).toBe(true);

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderPayload.order.id },
    });
    expect(updatedOrder.status).toBe("PAID_PENDING_GROUP");
    const receiptForDiagnosis = await prisma.channelReceipt.findFirstOrThrow({ where: { orderId: updatedOrder.id } });
    const jobForDiagnosis = await prisma.durableJob.findFirstOrThrow({ where: { refId: payment.id } });
    await prisma.financialCase.createMany({ data: [
      { caseKey: `${testRunPrefix}-receipt-diagnosis`, category: "AMOUNT_CONFLICT", sourceRef: receiptForDiagnosis.id,
        owner: "test-owner", deadline: new Date(Date.now() + 86400000) },
      { caseKey: `${testRunPrefix}-job-diagnosis`, category: "JOB_REQUIRES_REVIEW", sourceRef: jobForDiagnosis.id,
        owner: "test-owner", deadline: new Date(Date.now() + 86400000) },
    ] });
    const diagnostic = await app.inject({ method: "GET", url: `/api/ops/diagnostics/orders/${updatedOrder.id}`, headers: auth(adminToken) });
    expect(diagnostic.statusCode).toBe(200);
    expect(diagnostic.json().order.id).toBe(updatedOrder.id);
    expect(JSON.stringify(diagnostic.json())).not.toMatch(/wechatOpenid|merchantOrderNo|channelTradeNo|phone/);
    expect(diagnostic.json().cases.map((issue: { category: string }) => issue.category)).toEqual(expect.arrayContaining(["AMOUNT_CONFLICT", "JOB_REQUIRES_REVIEW"]));
    const ordersForOps = await app.inject({ method: "GET", url: "/api/ops/orders", headers: auth(adminToken) });
    const summary = ordersForOps.json().orders.find((order: { id: string }) => order.id === updatedOrder.id);
    expect(summary.openCaseCount).toBe(diagnostic.json().cases.filter((issue: { state: string }) => issue.state === "OPEN").length);
    expect((await app.inject({ method: "GET", url: `/api/ops/diagnostics/orders/${updatedOrder.id}`,
      headers: auth(userToken) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/ops/diagnostics/queue", headers: auth(adminToken) })).statusCode).toBe(200);
    const paymentAuditCount = await prisma.auditLog.count({
      where: {
        action: "payment.callback.succeeded",
        targetId: payment.id,
      },
    });
    expect(paymentAuditCount).toBe(1);
  });

  it("recovers only the current user's orders with stable pagination and private details", async () => {
    const admin = await loginAdmin("list-ops");
    const owner = await loginUser("list-owner");
    const other = await loginUser("list-other");
    await bindPhone(owner, "13800138000"); await bindPhone(other, "13900139000");
    const ids: string[] = [];
    let activityId = "";
    for (let i = 0; i < 22; i++) {
      activityId = await createOpenActivity(admin);
      const created = await createOrder(owner, activityId);
      expect(created.statusCode).toBe(200); ids.push(created.json().order.id);
    }
    await prisma.order.updateMany({ where: { id: { in: ids } }, data: { createdAt: new Date("2026-01-01T00:00:00Z") } });
    const foreign = (await createOrder(other, activityId)).json().order.id;
    expect((await app.inject({ method: "GET", url: "/api/orders" })).statusCode).toBe(401);
    const page1 = (await app.inject({ method: "GET", url: "/api/orders", headers: auth(owner) })).json();
    expect(page1.orders).toHaveLength(20);
    const page2 = (await app.inject({ method: "GET", url: `/api/orders?cursor=${page1.nextCursor}`, headers: auth(owner) })).json();
    expect(page2.orders).toHaveLength(2); expect(page2.nextCursor).toBeNull();
    const recovered = [...page1.orders, ...page2.orders];
    expect(recovered.map(o => o.id)).toEqual([...ids].sort().reverse());
    expect(Object.keys(recovered[0]).sort()).toEqual(["activity", "amountCents", "createdAt", "id", "status"]);
    expect(Object.keys(recovered[0].activity).sort()).toEqual(["endsAt", "id", "startsAt", "title"]);
    for (const cursor of [foreign, "nonexistent"]) {
      expect((await app.inject({ method: "GET", url: `/api/orders?cursor=${cursor}`, headers: auth(owner) })).statusCode).toBe(400);
    }
    expect((await app.inject({ method: "GET", url: `/api/orders/${foreign}`, headers: auth(owner) })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: `/api/orders/${foreign}/cancel`, headers: auth(owner), payload: { reason: "changed" } })).statusCode).toBe(404);
    expect((await app.inject({ method: "POST", url: "/api/mock/payments", headers: auth(owner), payload: { orderId: foreign } })).statusCode).toBe(404);
    const orderId = ids[0]!;
    const payment = (await app.inject({ method: "POST", url: "/api/mock/payments", headers: auth(owner), payload: { orderId } })).json().payment;
    await prisma.durableJob.update({ where: { businessKey: `payment:${payment.id}` }, data: { state: "MANUAL" } });
    const manual = (await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(owner) })).json().order;
    expect(manual.paymentState).toBe("REQUIRES_REVIEW");
    await prisma.durableJob.update({ where: { businessKey: `payment:${payment.id}` }, data: { state: "READY" } });
    await app.inject({ method: "POST", url: `/api/mock/payments/${payment.id}/succeed` });
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`, headers: auth(owner), payload: { reason: "change of plan" } });
    expect(cancel.statusCode).toBe(200);
    const detail = (await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(owner) })).json().order;
    expect(detail.status).toBe("REFUND_REVIEWING"); expect(detail.canRequestCancel).toBe(false);
    expect(detail.refunds[0]).toMatchObject({ id: cancel.json().refund.id, status: "REVIEWING", amountCents: 9900, requiresReview: false });
    expect(detail.refunds[0]).not.toHaveProperty("merchantRefundNo");
    expect(detail.activity.address).toBeNull();
    const refundId = cancel.json().refund.id;
    const approval = await app.inject({ method: "POST", url: `/api/ops/refunds/${refundId}/approve`, headers: auth(admin), payload: { reason: "approve test" } });
    expect(approval.statusCode).toBe(200);
    await prisma.durableJob.update({ where: { businessKey: `refund:${refundId}` }, data: { state: "MANUAL" } });
    const manualRefund = (await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(owner) })).json().order;
    expect(manualRefund.refunds[0].requiresReview).toBe(true);
    await prisma.refund.update({ where: { id: refundId }, data: { status: "SUCCEEDED", resolutionState: "CONFIRMED" } });
    const settled = (await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(owner) })).json().order;
    expect(settled.refunds[0].requiresReview).toBe(false);
  });

  it("shows confirmed receipts with unresolved fulfillment as requiring review", async () => {
    const admin = await loginAdmin("fulfillment-review-ops");
    const owner = await loginUser("fulfillment-review-owner");
    await bindPhone(owner, "13800138000");
    const orderId = await createPendingOrder(owner, await createOpenActivity(admin));
    const payment = await createMockPayment(owner, orderId);
    await prisma.order.update({ where: { id: orderId }, data: { inventoryLockedUntil: new Date(Date.now() - 60_000) } });
    const result = await applyPaymentEvidence(prisma, { kind: "PAYMENT_SUCCEEDED", channel: "mock",
      merchantScope: payment.merchantScope, merchantOrderNo: payment.merchantOrderNo,
      channelTradeNo: scoped("expired-paid-trade"), amountCents: payment.amountCents,
      currency: "CNY", evidenceHash: "verified-local-fixture" }, "test-review");
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: payment.id } })).resolutionState).toBe("CONFIRMED");
    const read = async () => (await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(owner) })).json().order;
    expect(await read()).toMatchObject({ status: "PENDING_PAYMENT", paymentState: "REQUIRES_REVIEW" });
    expect(await read()).toMatchObject({ paymentState: "REQUIRES_REVIEW" });
    await prisma.financialCase.updateMany({ where: { sourceRef: result.receipt.id }, data: { state: "RESOLVED", resolution: "synthetic fulfilled fixture", reviewedBy: "separate-test-reviewer", reviewedAt: new Date() } });
    await prisma.order.update({ where: { id: orderId }, data: { status: "PAID_PENDING_GROUP" } });
    await prisma.durableJob.update({ where: { businessKey: `payment:${payment.id}` }, data: { state: "MANUAL" } });
    expect(await read()).toMatchObject({ status: "PAID_PENDING_GROUP", paymentState: "NONE" });
  });

  it("requires the order owner to confirm the current agreement before creating an order", async () => {
    const adminToken = await loginAdmin("agreement-ops");
    const userToken = await loginUser("agreement-user");
    await bindPhone(userToken, "13500209999");
    const activityId = await createOpenActivity(adminToken);

    const withoutAgreement = await appInject({
      method: "POST",
      url: "/api/orders",
      headers: auth(userToken),
      payload: { activityId, agreementVersion: "v1" },
    });
    expect(withoutAgreement.statusCode).toBe(409);
    expect(withoutAgreement.json().error).toBe("Agreement confirmation required");

    const confirmation = await appInject({
      method: "POST",
      url: "/api/consents",
      headers: auth(userToken),
      payload: { agreementVersion: "v1", source: "miniapp-registration" },
    });
    expect(confirmation.statusCode).toBe(200);

    const withoutProfile = await appInject({ method: "POST", url: "/api/orders", headers: auth(userToken),
      payload: { activityId, agreementVersion: "v1" } });
    expect(withoutProfile.statusCode).toBe(409);
    expect(withoutProfile.json().error).toBe("Profile questionnaire required");
    const savedProfile = await appInject({ method: "PUT", url: "/api/profile", headers: auth(userToken), payload: profilePayload() });
    expect(savedProfile.statusCode).toBe(200);

    const withAgreement = await appInject({
      method: "POST",
      url: "/api/orders",
      headers: auth(userToken),
      payload: { activityId, agreementVersion: "v1" },
    });
    expect(withAgreement.statusCode).toBe(200);
  });

  it("rejects invented and old agreement versions after a policy switch while preserving the old order", async () => {
    const admin = await loginAdmin("agreement-switch-ops");
    const user = await loginUser("agreement-switch-user");
    await bindPhone(user, "13500209998");
    const firstActivity = await createOpenActivity(admin);
    const current = await appInject({ method: "GET", url: "/api/agreement/current" });
    expect(current.statusCode).toBe(200);
    expect(current.json().agreement).toMatchObject({ version: "v1", source: "isolated-test-fixture" });
    expect((await appInject({ method: "POST", url: "/api/consents", headers: auth(user),
      payload: { agreementVersion: "invented", source: "test" } })).statusCode).toBe(409);
    const first = await createOrder(user, firstActivity);
    expect(first.statusCode).toBe(200);
    const firstOrder = await prisma.order.findUniqueOrThrow({ where: { id: first.json().order.id } });
    expect(firstOrder.agreementVersion).toBe("v1");
    expect(firstOrder.consentRecordId).toBeTruthy();
    const nextText = "仅用于隔离数据库第二版测试的协议文本";
    await prisma.$transaction(async tx => {
      await tx.agreementPolicy.update({ where: { version: "v1" }, data: { active: false } });
      await tx.agreementPolicy.create({ data: { version: "v2", text: nextText, textHash: agreementHash(nextText),
        source: "isolated-test-fixture", active: true, activatedAt: new Date("2026-01-01T00:00:00.000Z") } });
    });
    try {
      const secondActivity = await createOpenActivity(admin);
      const request = (agreementVersion: string) => appInject({ method: "POST", url: "/api/orders",
        headers: auth(user), payload: { activityId: secondActivity, agreementVersion } });
      expect((await request("v1")).statusCode).toBe(409);
      expect((await request("v2")).json().error).toBe("Agreement confirmation required");
      expect(await prisma.order.count({ where: { activityId: secondActivity } })).toBe(0);
      expect((await appInject({ method: "POST", url: "/api/consents", headers: auth(user),
        payload: { agreementVersion: "v2", source: "test" } })).statusCode).toBe(200);
      const second = await request("v2");
      expect(second.statusCode).toBe(200);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: firstOrder.id } })).agreementVersion).toBe("v1");
      expect((await prisma.order.findUniqueOrThrow({ where: { id: second.json().order.id } })).agreementVersion).toBe("v2");
    } finally {
      await prisma.$transaction(async tx => {
        await tx.agreementPolicy.update({ where: { version: "v2" }, data: { active: false } });
        await tx.agreementPolicy.update({ where: { version: "v1" }, data: { active: true } });
        await tx.agreementPolicy.delete({ where: { version: "v2" } });
      });
    }
  });

  it("stops new registration when no approved agreement policy is active", async () => {
    const admin = await loginAdmin("agreement-unavailable-ops");
    const user = await loginUser("agreement-unavailable-user");
    await bindPhone(user, "13500209996");
    const activityId = await createOpenActivity(admin);
    await prisma.agreementPolicy.update({ where: { version: "v1" }, data: { active: false } });
    try {
      expect((await appInject({ method: "GET", url: "/api/agreement/current" })).statusCode).toBe(503);
      expect((await appInject({ method: "POST", url: "/api/consents", headers: auth(user),
        payload: { agreementVersion: "v1", source: "test" } })).statusCode).toBe(503);
      expect((await appInject({ method: "POST", url: "/api/orders", headers: auth(user),
        payload: { activityId, agreementVersion: "v1" } })).statusCode).toBe(503);
      expect(await prisma.order.count({ where: { activityId } })).toBe(0);
    } finally {
      await prisma.agreementPolicy.update({ where: { version: "v1" }, data: { active: true } });
    }
  });

  it("keeps the order questionnaire immutable and exposes it only to operations", async () => {
    const admin = await loginAdmin("snapshot-ops");
    const owner = await loginUser("snapshot-owner");
    const other = await loginUser("snapshot-other");
    await bindPhone(owner, "13500209997");
    const activityId = await createOpenActivity(admin);
    const order = await createOrder(owner, activityId);
    expect(order.statusCode).toBe(200);
    const orderId = order.json().order.id;
    const saved = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    expect(saved.profileSnapshot).toMatchObject({ ruleVersion: "l3-v1", preferredAreas: ["徐汇", "静安"] });
    expect(JSON.stringify(saved.profileSnapshot)).not.toContain("靠近地铁即可");
    expect((await appInject({ method: "PUT", url: "/api/profile", headers: auth(owner),
      payload: { ...profilePayload(), preferredAreas: ["浦东"] } })).statusCode).toBe(200);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).profileSnapshot).toEqual(saved.profileSnapshot);
    expect((await appInject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(other) })).statusCode).toBe(404);
  });

  it("blocks a table-size conflict using the original order snapshot after profile edits", async () => {
    const admin = await loginAdmin("size-policy-ops");
    const activityId = await createOpenActivity(admin);
    for (let index = 0; index < 4; index++) {
      const user = await loginUser(`size-policy-user-${index}`);
      await bindPhone(user, `13600210${String(index).padStart(3, "0")}`);
      if (index === 0) {
        expect((await appInject({ method: "PUT", url: "/api/profile", headers: auth(user),
          payload: { ...profilePayload(), acceptableTableSizes: [6] } })).statusCode).toBe(200);
      }
      await createPaidOrder(user, activityId);
      if (index === 0) {
        expect((await appInject({ method: "PUT", url: "/api/profile", headers: auth(user),
          payload: { ...profilePayload(), acceptableTableSizes: [4, 5, 6, 7, 8] } })).statusCode).toBe(200);
      }
    }
    const draft = await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(draft.statusCode).toBe(409);
    expect(draft.json().reason).toBe("TABLE_SIZE_CONFLICT");
    expect(await prisma.tableGroup.count({ where: { activityId } })).toBe(0);
    expect(await prisma.financialCase.count({ where: { caseKey: `FORMATION_POLICY_REVIEW:${activityId}` } })).toBe(1);
  });

  it("blocks automatic confirmation when a dietary limit lacks verified restaurant capability", async () => {
    const admin = await loginAdmin("dietary-policy-ops");
    const activityId = await createOpenActivity(admin);
    for (let index = 0; index < 4; index++) {
      const user = await loginUser(`dietary-policy-user-${index}`);
      await bindPhone(user, `13600211${String(index).padStart(3, "0")}`);
      if (index === 0) {
        expect((await appInject({ method: "PUT", url: "/api/profile", headers: auth(user),
          payload: { ...profilePayload(), dietaryRestrictions: ["花生过敏"] } })).statusCode).toBe(200);
      }
      await createPaidOrder(user, activityId);
    }
    const draft = await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(draft.statusCode).toBe(409);
    expect(draft.json().reason).toBe("DIETARY_CAPABILITY_UNVERIFIED");
    expect(await prisma.order.count({ where: { activityId, status: "GROUPED" } })).toBe(0);
  });

  it("accepts a valid first manual four-person grouping after the automatic six-person proposal conflicts", async () => {
    const admin = await loginAdmin("manual-first-ops");
    const activityId = await createOpenActivity(admin);
    const orderIds: string[] = [];
    for (let index = 0; index < 12; index++) {
      const user = await loginUser(`manual-first-user-${index}`);
      await bindPhone(user, `13600310${String(index).padStart(3, "0")}`);
      expect((await appInject({ method: "PUT", url: "/api/profile", headers: auth(user),
        payload: { ...profilePayload(), acceptableTableSizes: [4] } })).statusCode).toBe(200);
      orderIds.push(await createPaidOrder(user, activityId));
    }
    const auto = await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(auto.statusCode).toBe(409);
    expect(auto.json().reason).toBe("TABLE_SIZE_CONFLICT");
    expect(await prisma.tableGroup.count({ where: { activityId } })).toBe(0);
    const manual = await appInject({ method: "PUT", url: `/api/ops/activities/${activityId}/table-groups`, headers: auth(admin),
      payload: { tableGroups: [0, 4, 8].map(start => ({ orderIds: orderIds.slice(start, start + 4) })) } });
    expect(manual.statusCode).toBe(200);
    expect(manual.json().tableGroups).toHaveLength(3);
    expect((await prisma.financialCase.findUniqueOrThrow({ where: { caseKey: `FORMATION_POLICY_REVIEW:${activityId}` } })).state).toBe("RESOLVED");
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: activityId } })).status).toBe("LOCKING");
    const confirmed = await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/confirm`, headers: auth(admin) });
    expect(confirmed.statusCode).toBe(200);
    expect(await prisma.order.count({ where: { activityId, status: "GROUPED" } })).toBe(12);
  });

  it("reopens a resolved formation review when the candidate set changes and the conflict returns", async () => {
    const admin = await loginAdmin("recurrent-formation-ops");
    const activityId = await createOpenActivity(admin);
    const orderIds: string[] = [];
    const owners = new Map<string, string>();
    for (let index = 0; index < 10; index++) {
      const user = await loginUser(`recurrent-formation-user-${index}`);
      await bindPhone(user, `13600311${String(index).padStart(3, "0")}`);
      expect((await appInject({ method: "PUT", url: "/api/profile", headers: auth(user),
        payload: { ...profilePayload(), acceptableTableSizes: [5] } })).statusCode).toBe(200);
      const orderId = await createPaidOrder(user, activityId);
      orderIds.push(orderId);
      owners.set(orderId, user);
    }
    const firstConflict = await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(firstConflict.statusCode).toBe(409);
    expect(firstConflict.json().reason).toBe("TABLE_SIZE_CONFLICT");
    const manual = await appInject({ method: "PUT", url: `/api/ops/activities/${activityId}/table-groups`, headers: auth(admin),
      payload: { tableGroups: [orderIds.slice(0, 5), orderIds.slice(5)].map(ids => ({ orderIds: ids })) } });
    expect(manual.statusCode).toBe(200);
    const resolved = await prisma.financialCase.findUniqueOrThrow({ where: { caseKey: `FORMATION_POLICY_REVIEW:${activityId}` } });
    expect(resolved.state).toBe("RESOLVED");
    const removedId = orderIds[0]!;
    expect((await appInject({ method: "POST", url: `/api/orders/${removedId}/cancel`,
      headers: auth(owners.get(removedId)!), payload: { reason: "无法参加" } })).statusCode).toBe(200);
    const repeatedConflict = await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(repeatedConflict.statusCode).toBe(409);
    expect(repeatedConflict.json().reason).toBe("TABLE_SIZE_CONFLICT");
    const reopened = await prisma.financialCase.findUniqueOrThrow({ where: { id: resolved.id } });
    expect(reopened).toMatchObject({ state: "OPEN", resolution: null, reviewedBy: null, reviewedAt: null });
    expect(reopened.deadline.getTime()).toBeGreaterThanOrEqual(resolved.deadline.getTime());
    const listed = await appInject({ method: "GET", url: "/api/ops/financial-cases", headers: auth(admin) });
    expect(listed.json().cases.some((issue: { id: string }) => issue.id === resolved.id)).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "formation.policy.review.reopened", targetId: resolved.id } })).toBe(1);
  });

  it("stores a complete profile for its owner and rejects incomplete submissions", async () => {
    const userToken = await loginUser("profile-owner");
    const initial = await app.inject({ method: "GET", url: "/api/profile", headers: auth(userToken) });
    expect(initial.statusCode).toBe(200);
    expect(initial.json().profile).toBeNull();

    const invalid = await app.inject({
      method: "PUT",
      url: "/api/profile",
      headers: auth(userToken),
      payload: { preferredAreas: ["徐汇"] },
    });
    expect(invalid.statusCode).toBe(400);

    const saved = await app.inject({
      method: "PUT",
      url: "/api/profile",
      headers: auth(userToken),
      payload: profilePayload(),
    });
    expect(saved.statusCode).toBe(200);
    expect(saved.json().profile).toMatchObject(profilePayload());

    const otherToken = await loginUser("profile-other");
    const other = await app.inject({ method: "GET", url: "/api/profile", headers: auth(otherToken) });
    expect(other.statusCode).toBe(200);
    expect(other.json().profile).toBeNull();
  });

  it("authenticates a controlled administrator in PostgreSQL and revokes a downgraded session", async () => {
    const username = scoped("controlled-admin");
    const salt = "b".repeat(32);
    const password = "isolated-admin-test-password";
    const adminApp = await buildApp({ prisma, providerEnv: {
      NODE_ENV: "test", APP_ENV: "local", SESSION_SECRET: "test-session-signing-material-32-bytes",
      OPS_ACCOUNTS_JSON: JSON.stringify([{ username, role: "SUPER_ADMIN", enabled: true, version: "1", passwordHash: `scrypt:${salt}:${scryptSync(password, salt, 64).toString("hex")}` }]),
    } });
    try {
      const denied = await adminApp.inject({ method: "POST", url: "/api/ops/login", payload: { username, password: "wrong" } });
      expect(denied.statusCode).toBe(401);
      expect(await prisma.adminUser.findUnique({ where: { username } })).toBeNull();
      const loggedIn = await adminApp.inject({ method: "POST", url: "/api/ops/login", payload: { username, password } });
      expect(loggedIn.statusCode).toBe(200);
      const { token, admin } = loggedIn.json();
      expect((await adminApp.inject({ url: "/api/ops/orders", headers: auth(token) })).statusCode).toBe(200);
      expect(await prisma.auditLog.count({ where: { actorId: admin.id, action: "admin.login" } })).toBe(1);
      await prisma.adminUser.update({ where: { id: admin.id }, data: { role: "OPS" } });
      expect((await adminApp.inject({ url: "/api/ops/orders", headers: auth(token) })).statusCode).toBe(401);
      expect((await adminApp.inject({ method: "POST", url: "/api/mock/admin-login", payload: { username, role: "SUPER_ADMIN" } })).statusCode).toBe(404);
    } finally { await adminApp.close(); }
  });

  it("serializes twenty cancellations and approvals into one refund and one recovery job", async () => {
    const adminToken = await loginAdmin("concurrent-cancel-ops");
    const userToken = await loginUser("concurrent-cancel-user");
    await bindPhone(userToken, "13800138000");
    const orderId = await createPaidOrder(userToken, await createOpenActivity(adminToken));
    const results = await Promise.all(Array.from({ length: 20 }, () => app.inject({ method: "POST",
      url: `/api/orders/${orderId}/cancel`, headers: auth(userToken), payload: { reason: "并发取消测试" } })));
    expect(results.filter(r => r.statusCode === 200)).toHaveLength(1);
    expect(results.every(r => [200, 400].includes(r.statusCode))).toBe(true);
    expect(await prisma.refund.count({ where: { orderId } })).toBe(1);
    const refund = await prisma.refund.findFirstOrThrow({ where: { orderId } });
    const approvals = await Promise.all(Array.from({ length: 20 }, () => app.inject({ method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`, headers: auth(adminToken), payload: { reason: "并发审批测试" } })));
    expect(approvals.filter(r => r.statusCode === 200)).toHaveLength(1);
    expect(approvals.every(r => [200, 409].includes(r.statusCode))).toBe(true);
    expect(await prisma.durableJob.count({ where: { businessKey: `refund:${refund.id}` } })).toBe(1);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("REFUNDING");
  });

  it("keeps signed callbacks active while new charges are stopped, and hides them for mock providers", async () => {
    const disabled = await app.inject({ method: "POST", url: "/api/wechat/pay/notify", payload: {} });
    expect(disabled.statusCode).toBe(404);

    const adminToken = await loginAdmin("callback-ops");
    const userToken = await loginUser("callback-buyer");
    await bindPhone(userToken, "13800138000");
    const orderId = await createPendingOrder(userToken, await createOpenActivity(adminToken));
    const payment = await createMockPayment(userToken, orderId);
    await prisma.payment.update({ where: { id: payment.id }, data: bindingFor(wechatCallbackEnv(), "wechat") });
    const wechatApp = await buildApp({
      prisma,
      providerEnv: { ...wechatCallbackEnv(), FEATURE_REAL_WECHAT_PAY: "false", NEW_PAYMENTS_ENABLED: "false" },
      wechatPayNotificationConfig: {
        apiV3Key: ["0123456789abcdef", "0123456789abcdef"].join(""),
        platformCertificate: callbackPublicKey,
        certificateSerial: "fixture-serial", expectedMerchantId: "test_mch_id", expectedAppId: "wx_test_app_id",
        now: () => callbackNowSeconds * 1000,
      },
    });
    try {
      const before = await prisma.payment.count({ where: { orderId } });
      const blocked = await wechatApp.inject({ method: "POST", url: "/api/mock/payments", headers: auth(userToken), payload: { orderId } });
      expect(blocked.statusCode).toBe(403);
      expect(await prisma.payment.count({ where: { orderId } })).toBe(before);
      const fixture = signedWechatCallback({
        out_trade_no: payment.merchantOrderNo,
        transaction_id: "test_channel_trade_callback_001",
        trade_state: "SUCCESS",
        amount: { total: payment.amountCents },
      });
      const first = await wechatApp.inject({ method: "POST", url: "/api/wechat/pay/notify", headers: fixture.headers, payload: fixture.body });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ code: "SUCCESS", idempotent: false });
      const second = await wechatApp.inject({ method: "POST", url: "/api/wechat/pay/notify", headers: fixture.headers, payload: fixture.body });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ code: "SUCCESS", idempotent: true });
      const replayNonce = "independent-valid-transport-nonce";
      const replaySigner = createSign("RSA-SHA256");
      replaySigner.update(`${callbackNowSeconds}\n${replayNonce}\n${fixture.body}\n`); replaySigner.end();
      const replay = await wechatApp.inject({ method: "POST", url: "/api/wechat/pay/notify", payload: fixture.body,
        headers: { ...fixture.headers, "wechatpay-nonce": replayNonce, "wechatpay-signature": replaySigner.sign(callbackPrivateKey, "base64") } });
      expect(replay.statusCode).toBe(200);
      expect(replay.json()).toMatchObject({ code: "SUCCESS", idempotent: true });
      expect(await prisma.receivedEvent.count({ where: { eventKey: JSON.parse(fixture.body).id } })).toBe(1);
      await expectOrderStatus(orderId, OrderStatus.PENDING_PAYMENT);
      const event = await prisma.receivedEvent.findFirstOrThrow({ where: { eventKey: JSON.parse(fixture.body).id } });
      await applyEvent(prisma, event.id, "test-review");
      await expectOrderStatus(orderId, OrderStatus.PAID_PENDING_GROUP);
    } finally {
      await wechatApp.close();
    }
  });

  it("applies a signed refund callback once after ops approval", async () => {
    const adminToken = await loginAdmin("refund-callback-ops");
    const userToken = await loginUser("refund-callback-buyer");
    await bindPhone(userToken, "13800138000");
    const orderId = await createPendingOrder(userToken, await createOpenActivity(adminToken));
    const payment = await createMockPayment(userToken, orderId);
    const binding = bindingFor(wechatCallbackEnv(), "wechat");
    await prisma.payment.update({ where: { id: payment.id }, data: binding });
    await applyPaymentEvidence(prisma, { kind: "PAYMENT_SUCCEEDED", channel: "wechat", merchantScope: binding.merchantScope,
      merchantOrderNo: payment.merchantOrderNo, channelTradeNo: scoped("refund-original-trade"), amountCents: payment.amountCents,
      currency: "CNY", evidenceHash: "verified-offline-fixture" }, "test-review");
    const cancel = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "测试退款回调" },
    });
    expect(cancel.statusCode).toBe(200);
    const refund = cancel.json().refund;
    const approve = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "测试审核通过" },
    });
    expect(approve.statusCode).toBe(200);
    const wechatApp = await buildApp({
      prisma,
      providerEnv: wechatCallbackEnv(),
      wechatPayNotificationConfig: {
        apiV3Key: ["0123456789abcdef", "0123456789abcdef"].join(""),
        platformCertificate: callbackPublicKey,
        certificateSerial: "fixture-serial", expectedMerchantId: "test_mch_id", expectedAppId: "wx_test_app_id",
        now: () => callbackNowSeconds * 1000,
      },
    });
    try {
      const fixture = signedWechatCallback({
        out_refund_no: refund.merchantRefundNo,
        transaction_id: scoped("refund-original-trade"),
        refund_id: "test_channel_refund_callback_001",
        refund_status: "SUCCESS",
        amount: { total: refund.amountCents, refund: refund.amountCents, payer_total: refund.amountCents, payer_refund: refund.amountCents },
      });
      const first = await wechatApp.inject({ method: "POST", url: "/api/wechat/refund/notify", headers: fixture.headers, payload: fixture.body });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ code: "SUCCESS", idempotent: false });
      const second = await wechatApp.inject({ method: "POST", url: "/api/wechat/refund/notify", headers: fixture.headers, payload: fixture.body });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ code: "SUCCESS", idempotent: true });
      await expectOrderStatus(orderId, OrderStatus.REFUNDING);
      const event = await prisma.receivedEvent.findFirstOrThrow({ where: { eventKey: JSON.parse(fixture.body).id } });
      await applyEvent(prisma, event.id, "test-review");
      await expectOrderStatus(orderId, OrderStatus.REFUNDED);
    } finally {
      await wechatApp.close();
    }
  });

  it("uses wechat auth provider results to create idempotent users", async () => {
    const wechatApp = await buildApp({
      prisma,
      providerEnv: {
        NODE_ENV: "test", APP_ENV: "local",
        SESSION_SECRET: "test-session-signing-material-32-bytes",
        AUTH_PROVIDER: "wechat",
        PHONE_PROVIDER: "wechat",
        PAYMENT_PROVIDER: "mock",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
      },
      providerHttpClient: async (request) => {
        const url = new URL(request.url);
        const code = url.searchParams.get("js_code");
        if (code === "bad-login-code") {
          return { errcode: 40029, errmsg: "invalid code" };
        }
        return {
          openid: `mock_openid_${testRunPrefix}_wechat_${code}`,
        };
      },
    });
    try {
      const concurrentLogins = await Promise.all(
        Array.from({ length: 3 }, () =>
          wechatApp.inject({
            method: "POST",
            url: "/api/mock/wechat-login",
            payload: { code: "same-login-code" },
          }),
        ),
      );
      expect(concurrentLogins.every((response) => response.statusCode === 200)).toBe(true);
      const userIds = new Set(concurrentLogins.map((response) => response.json().user.id));
      expect(userIds.size).toBe(1);
      const [firstUserId] = userIds;

      const different = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/wechat-login",
        payload: { code: "different-login-code" },
      });
      expect(different.statusCode).toBe(200);
      expect(different.json().user.id).not.toBe(firstUserId);

      const beforeErrorCount = await prisma.user.count({
        where: { wechatOpenid: { startsWith: `mock_openid_${testRunPrefix}_wechat_` } },
      });
      const failed = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/wechat-login",
        payload: { code: "bad-login-code" },
      });
      expect(failed.statusCode).toBe(503);
      const afterErrorCount = await prisma.user.count({
        where: { wechatOpenid: { startsWith: `mock_openid_${testRunPrefix}_wechat_` } },
      });
      expect(afterErrorCount).toBe(beforeErrorCount);
    } finally {
      await wechatApp.close();
    }
  });

  it("uses wechat phone provider results and preserves existing phone on failure", async () => {
    const wechatApp = await buildApp({
      prisma,
      providerEnv: {
        NODE_ENV: "test", APP_ENV: "local",
        SESSION_SECRET: "test-session-signing-material-32-bytes",
        AUTH_PROVIDER: "wechat",
        PHONE_PROVIDER: "wechat",
        PAYMENT_PROVIDER: "mock",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
      },
      providerHttpClient: async (request) => {
        if (request.url.includes("/sns/jscode2session")) return { openid: `mock_openid_${testRunPrefix}_phone_real` };
        if (request.url.includes("/cgi-bin/token")) {
          return { access_token: "mock_access_token", expires_in: 7200 };
        }
        const body = request.body as { code?: string };
        if (body.code === "bad-phone-code") {
          return { errcode: 40029, errmsg: "invalid code" };
        }
        return {
          errcode: 0,
          errmsg: "ok",
          phone_info: {
            phoneNumber: "13500135099",
            purePhoneNumber: "13500135099",
            countryCode: "86",
          },
        };
      },
    });
    try {
      const login = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/wechat-login",
        payload: { code: scoped("phone-provider-user") },
      });
      expect(login.statusCode).toBe(200);
      const token = login.json().token;
      const userId = login.json().user.id;

      const success = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        headers: auth(token),
        payload: { code: "good-phone-code" },
      });
      expect(success.statusCode).toBe(200);
      expect(success.json().user.phone).toBe("135****5099");
      const afterSuccess = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(afterSuccess.phone).toBe("13500135099");

      const repeat = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        headers: auth(token),
        payload: { code: "good-phone-code" },
      });
      expect(repeat.statusCode).toBe(200);

      const failed = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        headers: auth(token),
        payload: { code: "bad-phone-code" },
      });
      expect(failed.statusCode).toBe(503);
      const afterFailure = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
      expect(afterFailure.phone).toBe("13500135099");

      const unauthorized = await wechatApp.inject({
        method: "POST",
        url: "/api/mock/phone",
        payload: { code: "good-phone-code" },
      });
      expect(unauthorized.statusCode).toBe(401);
    } finally {
      await wechatApp.close();
    }
  });

  it("creates ops-review refunds for user cancellation and completes refund idempotently", async () => {
    const adminToken = await loginAdmin("refund-ops");
    const userToken = await loginUser("buyer-2");
    await bindPhone(userToken, "13900139000");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "计划调整" },
    });
    expect(cancelResponse.statusCode).toBe(200);
    const refund = cancelResponse.json().refund;
    expect(refund.status).toBe("REVIEWING");
    const requestAuditCount = await prisma.auditLog.count({
      where: {
        action: "refund.requested",
        targetId: refund.id,
      },
    });
    expect(requestAuditCount).toBe(1);

    const approveResponse = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "T-24 前运营快速审核通过" },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().refund.status).toBe("REFUNDING");

    const firstCallback = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(firstCallback.statusCode).toBe(200);
    expect(firstCallback.json().idempotent).toBe(false);

    const secondCallback = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(secondCallback.statusCode).toBe(200);
    expect(secondCallback.json().idempotent).toBe(true);

    const updatedOrder = await prisma.order.findUniqueOrThrow({
      where: { id: orderId },
    });
    expect(updatedOrder.status).toBe("REFUNDED");
  });

  it("blocks forbidden user-visible activity copy", async () => {
    const adminToken = await loginAdmin("copy-ops");
    const restaurantId = await createRestaurant(adminToken);

    const response = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, {
        title: "周末脱单饭局",
      }),
    });

    expect(response.statusCode).toBe(400);
    expect(response.json().error).toContain("forbidden words");
  });

  it("does not allow a user to read another user's order", async () => {
    const adminToken = await loginAdmin("acl-ops");
    const ownerToken = await loginUser("owner");
    const otherToken = await loginUser("other");
    await bindPhone(ownerToken, "13700137000");
    await bindPhone(otherToken, "13600136000");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(ownerToken, activityId);

    const response = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(otherToken),
    });

    expect(response.statusCode).toBe(404);
  });

  it("unlocks order information in stages without exposing the address early", async () => {
    const adminToken = await loginAdmin("address-unlock-ops");
    const userToken = await loginUser("address-unlock-user");
    await bindPhone(userToken, "13500135120");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);

    const beforeGrouping = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(userToken),
    });
    expect(beforeGrouping.statusCode).toBe(200);
    expect(beforeGrouping.json().order).toMatchObject({
      visibility: "basic",
      activity: { restaurantName: null, address: null },
    });

    await prisma.$transaction([
      prisma.activity.update({ where: { id: activityId }, data: { status: ActivityStatus.GROUPED } }),
      prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.GROUPED } }),
    ]);
    const afterGrouping = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(userToken),
    });
    expect(afterGrouping.statusCode).toBe(200);
    expect(afterGrouping.json().order).toMatchObject({
      visibility: "basic",
      activity: { restaurantName: null, address: null },
    });

    await prisma.tableGroup.create({ data: { activityId, status: "CONFIRMED",
      members: { create: { orderId } } } });
    const withSeat = await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(userToken) });
    expect(withSeat.json().order).toMatchObject({ visibility: "restaurant",
      activity: { restaurantName: scoped("梧桐小馆"), address: null } });

    await prisma.activity.update({
      where: { id: activityId },
      data: { startsAt: new Date(Date.now() + 23 * 60 * 60 * 1000) },
    });
    const atT24 = await app.inject({
      method: "GET",
      url: `/api/orders/${orderId}`,
      headers: auth(userToken),
    });
    expect(atT24.statusCode).toBe(200);
    expect(atT24.json().order).toMatchObject({
      visibility: "address",
      activity: { restaurantName: scoped("梧桐小馆"), address: "衡山路 100 号" },
    });
  });

  it("lets a user report only their completed order and records ops resolution", async () => {
    const adminToken = await loginAdmin("report-ops");
    const userToken = await loginUser("report-user");
    const otherToken = await loginUser("report-other");
    await bindPhone(userToken, "13500135121");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);
    const early = await app.inject({ method: "POST", url: `/api/orders/${orderId}/reports`, headers: auth(userToken), payload: { type: "现场异常", content: "尚未结束" } });
    expect(early.statusCode).toBe(409);
    await prisma.activity.update({ where: { id: activityId }, data: { endsAt: new Date(Date.now() - 60 * 60 * 1000) } });
    const forbidden = await app.inject({ method: "POST", url: `/api/orders/${orderId}/reports`, headers: auth(otherToken), payload: { type: "现场异常", content: "无权提交" } });
    expect(forbidden.statusCode).toBe(404);
    const submitted = await app.inject({ method: "POST", url: `/api/orders/${orderId}/reports`, headers: auth(userToken), payload: { type: "现场异常", content: "需要运营跟进" } });
    expect(submitted.statusCode).toBe(200);
    const reportId = submitted.json().report.id;
    const list = await app.inject({ method: "GET", url: "/api/ops/reports", headers: auth(adminToken) });
    expect(list.statusCode).toBe(200);
    expect(list.json().reports.some((report: { id: string }) => report.id === reportId)).toBe(true);
    const simultaneous = await Promise.all(["RESOLVED", "REJECTED"].map(status => app.inject({ method: "POST",
      url: `/api/ops/reports/${reportId}/resolve`, headers: auth(adminToken), payload: { status, reason: "已处理" } })));
    expect(simultaneous.map(response => response.statusCode).sort()).toEqual([200, 409]);
    expect(["RESOLVED", "REJECTED"]).toContain((await prisma.report.findUniqueOrThrow({ where: { id: reportId } })).status);
    expect(await prisma.auditLog.count({ where: { action: "report.resolved", targetId: reportId } })).toBe(1);
  });

  it("enforces activity status gates when creating orders", async () => {
    const adminToken = await loginAdmin("activity-gates");
    const draftActivityId = await createOpenActivity(adminToken, {
      status: "DRAFT",
    });
    const publishedActivityId = await createOpenActivity(adminToken, {
      status: "PUBLISHED",
    });
    const openActivityId = await createOpenActivity(adminToken, {
      status: "REGISTRATION_OPEN",
    });
    const canceledActivityId = await createOpenActivity(adminToken, {
      status: "PUBLISHED",
    });
    const completedActivityId = await createOpenActivity(adminToken, {
      status: "PUBLISHED",
    });
    await prisma.activity.update({
      where: { id: canceledActivityId },
      data: { status: ActivityStatus.CANCELED },
    });
    await prisma.activity.update({
      where: { id: completedActivityId },
      data: { status: ActivityStatus.COMPLETED },
    });

    await expectOrderCreateStatus(draftActivityId, "draft-user", 400);
    await expectOrderCreateStatus(canceledActivityId, "canceled-user", 400);
    await expectOrderCreateStatus(completedActivityId, "completed-user", 400);
    await expectOrderCreateStatus(publishedActivityId, "published-user", 200);
    await expectOrderCreateStatus(openActivityId, "open-user", 200);
  });

  it("creates audited supply, validates activity bounds, and publishes a draft once", async () => {
    const admin = await loginAdmin("o1-supply");
    const restaurantId = await createRestaurant(admin);
    expect(await prisma.auditLog.count({ where: { action: "restaurant.created", targetId: restaurantId } })).toBe(1);
    const invalid = await app.inject({ method: "POST", url: "/api/ops/activities", headers: auth(admin),
      payload: activityPayload(restaurantId, { status: "DRAFT", minSize: 7, targetSize: 6 }) });
    expect(invalid.statusCode).toBe(400);
    const expiredDeadline = await app.inject({ method: "POST", url: "/api/ops/activities", headers: auth(admin),
      payload: activityPayload(restaurantId, { registrationEndsAt: new Date(Date.now() - 60000).toISOString() }) });
    expect(expiredDeadline.statusCode).toBe(400);
    const created = await app.inject({ method: "POST", url: "/api/ops/activities", headers: auth(admin),
      payload: activityPayload(restaurantId, { status: "DRAFT" }) });
    expect(created.statusCode).toBe(200);
    const activityId = created.json().activity.id;
    expect(await prisma.auditLog.count({ where: { action: "activity.created", targetId: activityId } })).toBe(1);
    const published = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/publish`, headers: auth(admin) });
    expect(published.statusCode).toBe(200);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: activityId } })).status).toBe(ActivityStatus.PUBLISHED);
    expect((await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/publish`, headers: auth(admin) })).statusCode).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "activity.published", targetId: activityId } })).toBe(1);
    const opened = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/open-registration`, headers: auth(admin) });
    expect(opened.statusCode).toBe(200);
    expect((await prisma.activity.findUniqueOrThrow({ where: { id: activityId } })).status).toBe(ActivityStatus.REGISTRATION_OPEN);
    expect((await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/open-registration`, headers: auth(admin) })).statusCode).toBe(409);
    expect(await prisma.auditLog.count({ where: { action: "activity.registration.opened", targetId: activityId } })).toBe(1);
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const unsafeEdit = await app.inject({ method: "PUT", url: `/api/ops/restaurants/${restaurantId}`, headers: auth(admin),
      payload: { ...restaurant, capacity: 6 } });
    expect(unsafeEdit.statusCode).toBe(409);
    const contactEdit = await app.inject({ method: "PUT", url: `/api/ops/restaurants/${restaurantId}`, headers: auth(admin),
      payload: { ...restaurant, contactName: "更新的测试联系人" } });
    expect(contactEdit.statusCode).toBe(200);
    expect(await prisma.auditLog.count({ where: { action: "restaurant.updated", targetId: restaurantId } })).toBe(1);
  });

  it("serializes restaurant capacity edits with draft publication", async () => {
    const admin = await loginAdmin("o1-supply-race");
    const restaurantId = await createRestaurant(admin);
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    const created = await app.inject({ method: "POST", url: "/api/ops/activities", headers: auth(admin),
      payload: activityPayload(restaurantId, { status: "DRAFT" }) });
    expect(created.statusCode).toBe(200);
    const activityId = created.json().activity.id;
    await prisma.$executeRawUnsafe(`CREATE FUNCTION pause_restaurant_edit_n1p1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER pause_restaurant_edit_n1p1 BEFORE UPDATE ON "Restaurant" FOR EACH ROW EXECUTE FUNCTION pause_restaurant_edit_n1p1()`);
    try {
      const edit = app.inject({ method: "PUT", url: `/api/ops/restaurants/${restaurantId}`, headers: auth(admin),
        payload: { ...restaurant, capacity: 6 } });
      await new Promise(resolve => setTimeout(resolve, 80));
      const publish = app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/publish`, headers: auth(admin) });
      const [edited, published] = await Promise.all([edit, publish]);
      expect([edited.statusCode, published.statusCode].sort()).toEqual([200, 409]);
      const finalActivity = await prisma.activity.findUniqueOrThrow({ where: { id: activityId }, include: { restaurant: true } });
      if (finalActivity.status === "PUBLISHED") expect(finalActivity.capacity).toBeLessThanOrEqual(finalActivity.restaurant.capacity);
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER pause_restaurant_edit_n1p1 ON "Restaurant"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION pause_restaurant_edit_n1p1()`);
    }
  });

  it("serializes restaurant capacity edits with direct open activity creation", async () => {
    const admin = await loginAdmin("o1-direct-open-race");
    const restaurantId = await createRestaurant(admin);
    const restaurant = await prisma.restaurant.findUniqueOrThrow({ where: { id: restaurantId } });
    await prisma.$executeRawUnsafe(`CREATE FUNCTION pause_restaurant_edit_direct_n1p1() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.4); RETURN NEW; END $$`);
    await prisma.$executeRawUnsafe(`CREATE TRIGGER pause_restaurant_edit_direct_n1p1 BEFORE UPDATE ON "Restaurant" FOR EACH ROW EXECUTE FUNCTION pause_restaurant_edit_direct_n1p1()`);
    try {
      const edit = app.inject({ method: "PUT", url: `/api/ops/restaurants/${restaurantId}`, headers: auth(admin),
        payload: { ...restaurant, capacity: 6 } });
      await new Promise(resolve => setTimeout(resolve, 80));
      const create = app.inject({ method: "POST", url: "/api/ops/activities", headers: auth(admin),
        payload: activityPayload(restaurantId, { status: "REGISTRATION_OPEN" }) });
      const [edited, created] = await Promise.all([edit, create]);
      expect(edited.statusCode === 200 && created.statusCode === 200).toBe(false);
      if (created.statusCode === 200) {
        const activity = await prisma.activity.findUniqueOrThrow({ where: { id: created.json().activity.id }, include: { restaurant: true } });
        expect(activity.capacity).toBeLessThanOrEqual(activity.restaurant.capacity);
      }
    } finally {
      await prisma.$executeRawUnsafe(`DROP TRIGGER pause_restaurant_edit_direct_n1p1 ON "Restaurant"`);
      await prisma.$executeRawUnsafe(`DROP FUNCTION pause_restaurant_edit_direct_n1p1()`);
    }
  });

  it("requires separate case owner and super-admin reviewer before verified closure", async () => {
    const owner = await loginAdmin("o1-case-owner");
    const reviewer = await loginAdmin("o1-case-reviewer", "SUPER_ADMIN");
    const activityId = await createOpenActivity(owner);
    const issue = await prisma.financialCase.create({ data: { caseKey: scoped("case-review"), category: "JOB_REQUIRES_REVIEW",
      sourceRef: activityId, owner: "local-review-required", deadline: new Date(Date.now() + 86400000) } });
    const claim = await app.inject({ method: "POST", url: `/api/ops/financial-cases/${issue.id}/claim`, headers: auth(owner) });
    expect(claim.statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/ops/financial-cases/${issue.id}/claim`, headers: auth(owner) })).statusCode).toBe(409);
    expect((await app.inject({ method: "POST", url: `/api/ops/financial-cases/${issue.id}/resolve`, headers: auth(owner) })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: `/api/ops/financial-cases/${issue.id}/resolve`, headers: auth(reviewer) })).statusCode).toBe(409);
    expect((await prisma.financialCase.findUniqueOrThrow({ where: { id: issue.id } })).state).toBe("OPEN");
  });

  it("paginates more than one hundred mixed-state orders and activities without truncating seat totals", async () => {
    const admin = await loginAdmin("o1-pages");
    // Ops lists are global. Preserve unrelated owned fixtures and assert the exact complete universe.
    const [baselineActivities, baselineOrders] = await Promise.all([
      prisma.activity.findMany({ select: { id: true } }),
      prisma.order.findMany({ select: { id: true, capacityHeld: true } }),
    ]);
    const baselineHeld = baselineOrders.filter(row => row.capacityHeld).length;
    const created = await Promise.all(Array.from({ length: 151 }, () => createOpenActivity(admin)));
    const token = await loginUser("o1-page-owner");
    const states = [OrderStatus.PENDING_PAYMENT, OrderStatus.CANCELED, OrderStatus.REFUNDED, OrderStatus.PAID_PENDING_GROUP, OrderStatus.COMPLETED];
    await prisma.order.createMany({ data: created.map((activityId, index) => ({
      id: scoped(`page-order-${index}`), userId: userTokenPayload(token).sub, activityId,
      amountCents: 9900, agreementVersion: "v1", status: states[index % states.length]!,
      capacityHeld: index % states.length !== 1 && index % states.length !== 2,
      registrationActive: index % states.length !== 1 && index % states.length !== 2,
    })) });
    const first = await app.inject({ method: "GET", url: "/api/ops/activities", headers: auth(admin) });
    expect(first.statusCode).toBe(200);
    expect(first.json().activities).toHaveLength(50);
    expect(first.json().nextCursor).toBeTruthy();
    const visibleIds = new Set(first.json().activities.map((activity: { id: string }) => activity.id));
    let cursor: string | null = first.json().nextCursor;
    while (cursor) {
      const next = await app.inject({ method: "GET", url: `/api/ops/activities?cursor=${cursor}`, headers: auth(admin) });
      expect(next.statusCode).toBe(200);
      for (const activity of next.json().activities as Array<{ id: string }>) visibleIds.add(activity.id);
      cursor = next.json().nextCursor;
    }
    expect(created.every(id => visibleIds.has(id))).toBe(true);
    for (const path of ["/api/ops/activities", "/api/ops/orders"]) {
      const field = path.endsWith("activities") ? "activities" : "orders";
      const rows: Array<{ id: string; heldSeats?: number }> = [];
      let after: string | null = null;
      do {
        const response = await app.inject({ method: "GET", url: `${path}${after ? `?cursor=${encodeURIComponent(after)}` : ""}`, headers: auth(admin) });
        expect(response.statusCode).toBe(200);
        expect(response.json().total).toBe(151 + (field === "activities" ? baselineActivities.length : baselineOrders.length));
        rows.push(...response.json()[field]); after = response.json().nextCursor;
      } while (after);
      const baseline = field === "activities" ? baselineActivities : baselineOrders;
      const ownIds = field === "activities" ? created : created.map((_id, index) => scoped(`page-order-${index}`));
      expect(rows).toHaveLength(151 + baseline.length);
      expect(new Set(rows.map(row => row.id)).size).toBe(151 + baseline.length);
      expect(new Set(rows.map(row => row.id))).toEqual(new Set([...baseline.map(row => row.id), ...ownIds]));
      expect(rows.filter(row => ownIds.includes(row.id))).toHaveLength(151);
      if (field === "activities") {
        for (let index = 0; index < created.length; index++)
          expect(rows.find(row => row.id === created[index])?.heldSeats).toBe(index % 5 === 1 || index % 5 === 2 ? 0 : 1);
        expect(rows.reduce((sum, row) => sum + row.heldSeats!, 0)).toBe(91 + baselineHeld);
      }
    }
  }, 30_000);

  it("limits cross-origin management requests and permits the approved DELETE preflight", async () => {
    const allowed = await app.inject({ method: "OPTIONS", url: "/api/ops/blacklist/example", headers: {
      origin: "http://localhost:5173", "access-control-request-method": "DELETE",
    } });
    expect(allowed.headers["access-control-allow-origin"]).toBe("http://localhost:5173");
    expect(String(allowed.headers["access-control-allow-methods"])).toContain("DELETE");
    const denied = await app.inject({ method: "OPTIONS", url: "/api/ops/blacklist/example", headers: {
      origin: "https://untrusted.example.invalid", "access-control-request-method": "DELETE",
    } });
    expect(denied.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("rejects expired registration and capacity overflow while reusing the active pending order", async () => {
    const adminToken = await loginAdmin("capacity-ops");
    const expiredActivityId = await createOpenActivity(adminToken);
    await prisma.activity.update({ where: { id: expiredActivityId }, data: {
      registrationEndsAt: new Date(Date.now() - 60 * 60 * 1000),
    } });
    await expectOrderCreateStatus(expiredActivityId, "expired-user", 409);
    await expectOrderCount(expiredActivityId, 0);

    const duplicateActivityId = await createOpenActivity(adminToken);
    const duplicateUserToken = await loginUser("duplicate-user");
    await bindPhone(duplicateUserToken, "13500135001");
    const firstOrder = await createOrder(duplicateUserToken, duplicateActivityId);
    expect(firstOrder.statusCode).toBe(200);
    const duplicateOrder = await createOrder(duplicateUserToken, duplicateActivityId);
    expect(duplicateOrder.statusCode).toBe(200);
    expect(duplicateOrder.json()).toMatchObject({ reused: true, order: { id: firstOrder.json().order.id } });
    await expectOrderCount(duplicateActivityId, 1);

    const cappedActivityId = await createOpenActivity(adminToken, { capacity: 4, targetSize: 4, maxSize: 4 });
    for (let index = 0; index < 4; index += 1) {
      await expectOrderCreateStatus(
        cappedActivityId,
        `capacity-user-${index}`,
        200,
        `13600135${index.toString().padStart(3, "0")}`,
      );
    }
    await expectOrderCreateStatus(cappedActivityId, "capacity-user-5", 409);
    await expectOrderCount(cappedActivityId, 4);
  });

  it("cancels a pending order, closes its merchant number, and permits a fresh registration", async () => {
    const admin = await loginAdmin("l1-cancel-ops");
    const owner = await loginUser("l1-cancel-owner");
    await bindPhone(owner, "13800138000");
    const activityId = await createOpenActivity(admin, { capacity: 4, targetSize: 4, maxSize: 4 });
    const first = await createOrder(owner, activityId);
    expect(first.statusCode).toBe(200);
    const firstId = first.json().order.id;
    const intent = (await app.inject({ method: "POST", url: "/api/mock/payments", headers: auth(owner),
      payload: { orderId: firstId } })).json().payment;
    const canceled = await app.inject({ method: "POST", url: `/api/orders/${firstId}/cancel`,
      headers: auth(owner), payload: { reason: "change of plan" } });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json()).toMatchObject({ pendingPaymentCanceled: true, order: {
      id: firstId, status: "CANCELED", registrationActive: false, capacityHeld: false,
    } });
    expect((await prisma.payment.findUniqueOrThrow({ where: { id: intent.id } })).resolutionState).toBe("CLOSED");
    const again = await createOrder(owner, activityId);
    expect(again.statusCode).toBe(200);
    expect(again.json().order.id).not.toBe(firstId);
    expect(await prisma.order.count({ where: { userId: (await prisma.order.findUniqueOrThrow({ where: { id: firstId } })).userId,
      activityId, registrationActive: true } })).toBe(1);
    expect((await app.inject({ method: "POST", url: `/api/mock/payments/${intent.id}/succeed` })).statusCode).toBe(409);
    expect(await prisma.channelReceipt.count({ where: { orderId: firstId } })).toBe(0);
  });

  it("allows only one of twenty users to take the last available seat", async () => {
    const admin = await loginAdmin("l1-capacity-ops");
    const activityId = await createOpenActivity(admin, { capacity: 4, targetSize: 4, maxSize: 4 });
    for (let index = 0; index < 3; index++) {
      const token = await loginUser(`l1-reserved-${index}`);
      await bindPhone(token, "13800138000");
      expect((await createOrder(token, activityId)).statusCode).toBe(200);
    }
    const contenders = await Promise.all(Array.from({ length: 20 }, async (_, index) => {
      const token = await loginUser(`l1-contender-${index}`);
      await bindPhone(token, "13800138000");
      await confirmAgreement(token);
      return token;
    }));
    const outcomes = await Promise.all(contenders.map(token => app.inject({ method: "POST", url: "/api/orders",
      headers: auth(token), payload: { activityId, agreementVersion: "v1" } })));
    expect(outcomes.filter(result => result.statusCode === 200)).toHaveLength(1);
    expect(outcomes.filter(result => result.statusCode === 409)).toHaveLength(19);
    expect(await prisma.order.count({ where: { activityId, capacityHeld: true } })).toBe(4);
  });

  it("rejects illegal payment callbacks without changing protected order states", async () => {
    const adminToken = await loginAdmin("payment-state-ops");

    for (const [index, status] of [
      OrderStatus.CANCELED,
      OrderStatus.REFUNDING,
      OrderStatus.REFUNDED,
    ].entries()) {
      const userToken = await loginUser(`payment-state-user-${index}`);
      await bindPhone(userToken, `1350013510${index}`);
      const activityId = await createOpenActivity(adminToken);
      const orderId = await createPendingOrder(userToken, activityId);
      const payment = await createMockPayment(userToken, orderId);
      await prisma.order.update({
        where: { id: orderId },
        data: { status },
      });

      const response = await app.inject({
        method: "POST",
        url: `/api/mock/payments/${payment.id}/succeed`,
      });

      expect(response.statusCode).toBe(409);
      const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
      expect(order.status).toBe(status);
      expect(order.amountCents).toBe(9900);
      const auditCount = await prisma.auditLog.count({
        where: {
          action: "payment.callback.rejected",
          targetId: payment.id,
        },
      });
      expect(auditCount).toBe(1);
    }
  });

  it("requires ops approval before refund callbacks and blocks refunded regressions", async () => {
    const adminToken = await loginAdmin("refund-state-ops");
    const userToken = await loginUser("refund-state-user");
    await bindPhone(userToken, "13500135020");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);

    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "计划调整" },
    });
    expect(cancelResponse.statusCode).toBe(200);
    const refund = cancelResponse.json().refund;
    expect(refund.status).toBe("REVIEWING");

    const earlyCallback = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(earlyCallback.statusCode).toBe(409);
    await expectOrderStatus(orderId, OrderStatus.REFUND_REVIEWING);

    const approveResponse = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "T-24 前运营快速审核通过" },
    });
    expect(approveResponse.statusCode).toBe(200);
    expect(approveResponse.json().refund.status).toBe("REFUNDING");
    await expectOrderStatus(orderId, OrderStatus.REFUNDING);

    const failResponse = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/fail`,
      payload: { reason: "mock channel rejected" },
    });
    expect(failResponse.statusCode).toBe(200);
    expect(failResponse.json().refund.status).toBe("FAILED");
    await expectOrderStatus(orderId, OrderStatus.REFUND_REVIEWING);
    const failureAudit = await prisma.auditLog.findFirstOrThrow({
      where: {
        action: "refund.callback.failed",
        targetId: refund.id,
      },
    });
    expect(failureAudit.reason).toBe("mock channel rejected");

    const retryApproveResponse = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "失败后重试" },
    });
    expect(retryApproveResponse.statusCode).toBe(200);
    expect(retryApproveResponse.json().refund.status).toBe("REFUNDING");

    const successResponse = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(successResponse.statusCode).toBe(200);
    expect(successResponse.json().idempotent).toBe(false);
    await expectOrderStatus(orderId, OrderStatus.REFUNDED);

    const secondSuccessResponse = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${refund.id}/succeed`,
    });
    expect(secondSuccessResponse.statusCode).toBe(200);
    expect(secondSuccessResponse.json().idempotent).toBe(true);

    const approveAfterRefunded = await app.inject({
      method: "POST",
      url: `/api/ops/refunds/${refund.id}/approve`,
      headers: auth(adminToken),
      payload: { reason: "不得回退" },
    });
    expect(approveAfterRefunded.statusCode).toBe(409);
    await expectOrderStatus(orderId, OrderStatus.REFUNDED);
  });

  it("blocks new refund callbacks after an order is already refunded", async () => {
    const adminToken = await loginAdmin("double-refund-ops");
    const userToken = await loginUser("double-refund-user");
    await bindPhone(userToken, "13500135030");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);
    const refund = await cancelApproveAndRefund(adminToken, userToken, orderId);

    const secondRefund = await prisma.refund.create({
      data: {
        orderId,
        amountCents: 9900,
        reason: "重复退款探针",
        requestedBy: "ops",
        status: RefundStatus.REFUNDING,
      },
    });
    const response = await app.inject({
      method: "POST",
      url: `/api/mock/refunds/${secondRefund.id}/succeed`,
    });
    expect(response.statusCode).toBe(409);
    await expectOrderStatus(orderId, OrderStatus.REFUNDED);
    const originalRefund = await prisma.refund.findUniqueOrThrow({
      where: { id: refund.id },
    });
    expect(originalRefund.status).toBe(RefundStatus.SUCCEEDED);
  });

  it("validates table size configuration", async () => {
    const adminToken = await loginAdmin("table-rule-ops");
    const restaurantId = await createRestaurant(adminToken);

    const tooSmall = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, { minSize: 3 }),
    });
    expect(tooSmall.statusCode).toBe(400);

    const tooLarge = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, { targetSize: 9 }),
    });
    expect(tooLarge.statusCode).toBe(400);

    const manualFourToEight = await app.inject({
      method: "POST",
      url: "/api/ops/activities",
      headers: auth(adminToken),
      payload: activityPayload(restaurantId, {
        minSize: 4,
        targetSize: 6,
        maxSize: 8,
      }),
    });
    expect(manualFourToEight.statusCode).toBe(200);
  });

  it("lets ops preview paid grouping candidates, draft tables idempotently, and confirm them", async () => {
    const adminToken = await loginAdmin("table-grouping-ops");
    const activityId = await createOpenActivity(adminToken);
    const userTokens: string[] = [];

    for (let index = 0; index < 6; index += 1) {
      const userToken = await loginUser(`table-grouping-user-${index}`);
      userTokens.push(userToken);
      await bindPhone(userToken, `13600136${String(index).padStart(3, "0")}`);
      const profileResponse = await app.inject({
        method: "PUT",
        url: "/api/profile",
        headers: auth(userToken),
        payload: profilePayload(),
      });
      expect(profileResponse.statusCode).toBe(200);
      await createPaidOrder(userToken, activityId);
    }

    const forbiddenPreview = await app.inject({
      method: "GET",
      url: `/api/ops/activities/${activityId}/table-candidates`,
      headers: auth(userTokens[0]!),
    });
    expect(forbiddenPreview.statusCode).toBe(403);

    const preview = await app.inject({
      method: "GET",
      url: `/api/ops/activities/${activityId}/table-candidates`,
      headers: auth(adminToken),
    });
    expect(preview.statusCode).toBe(200);
    expect(preview.json().candidates).toHaveLength(6);
    expect(preview.json().candidates[0]).toMatchObject({
      order: { status: "PAID_PENDING_GROUP" },
      profile: {
        preferredAreas: ["徐汇", "静安"],
        acceptableTableSizes: [4, 6],
      },
    });
    expect(JSON.stringify(preview.json())).not.toContain("13600136");
    expect(JSON.stringify(preview.json())).not.toContain("wechatOpenid");
    expect(JSON.stringify(preview.json())).not.toContain("靠近地铁即可");

    const draft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(draft.statusCode).toBe(200);
    expect(draft.json()).toMatchObject({
      idempotent: false,
      decision: { canForm: true, tableSizes: [6], unassignedCount: 0 },
    });
    expect(draft.json().tableGroups).toHaveLength(1);

    const repeatedDraft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(repeatedDraft.statusCode).toBe(200);
    expect(repeatedDraft.json().idempotent).toBe(true);
    expect(await prisma.tableGroup.count({ where: { activityId } })).toBe(1);
    expect(await prisma.tableMember.count({ where: { tableGroup: { activityId } } })).toBe(6);
    await expectActivityStatus(activityId, ActivityStatus.LOCKING);

    const confirmed = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/confirm`,
      headers: auth(adminToken),
    });
    expect(confirmed.statusCode).toBe(200);
    expect(confirmed.json()).toMatchObject({ idempotent: false, activityStatus: "GROUPED", notificationQueued: true });
    await expectActivityStatus(activityId, ActivityStatus.GROUPED);
    expect(await prisma.order.count({ where: { activityId, status: OrderStatus.GROUPED } })).toBe(6);
    expect(await prisma.tableGroup.count({ where: { activityId, status: "CONFIRMED" } })).toBe(1);
    expect(await prisma.auditLog.count({
      where: { action: "table-groups.confirmed", targetId: activityId },
    })).toBe(1);
    expect(await prisma.notification.count({
      where: { type: "GROUP_CONFIRMED", status: "PENDING", user: { orders: { some: { activityId } } } },
    })).toBe(6);
    const inbox = await app.inject({ method: "GET", url: "/api/notifications", headers: auth(userTokens[0]!) });
    expect(inbox.statusCode).toBe(200);
    expect(inbox.json().notifications).toHaveLength(0);
  });

  it("lets ops manually rearrange a locking table draft without adding or dropping paid orders", async () => {
    const adminToken = await loginAdmin("table-grouping-adjust-ops");
    const activityId = await createOpenActivity(adminToken, { targetSize: 8, maxSize: 8 });
    const orderIds: string[] = [];

    for (let index = 0; index < 8; index += 1) {
      const userToken = await loginUser(`table-grouping-adjust-user-${index}`);
      await bindPhone(userToken, `13600137${String(index).padStart(3, "0")}`);
      orderIds.push(await createPaidOrder(userToken, activityId));
    }

    const draft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(draft.statusCode).toBe(200);

    const adjusted = await app.inject({
      method: "PUT",
      url: `/api/ops/activities/${activityId}/table-groups`,
      headers: auth(adminToken),
      payload: { tableGroups: [{ orderIds: orderIds.slice(0, 4) }, { orderIds: orderIds.slice(4) }] },
    });
    expect(adjusted.statusCode).toBe(200);
    expect(adjusted.json().tableGroups.map((group: { orderIds: string[] }) => group.orderIds)).toEqual([
      orderIds.slice(0, 4),
      orderIds.slice(4),
    ]);
    expect(await prisma.tableGroup.count({ where: { activityId, status: "PENDING_CONFIRMATION" } })).toBe(2);
    expect(await prisma.auditLog.count({ where: { action: "table-groups.adjusted", targetId: activityId } })).toBe(1);

    const reopened = await app.inject({
      method: "GET",
      url: `/api/ops/activities/${activityId}/table-candidates`,
      headers: auth(adminToken),
    });
    expect(reopened.statusCode).toBe(200);
    expect(reopened.json().tableGroups.map((group: { orderIds: string[] }) => group.orderIds)).toEqual([
      orderIds.slice(0, 4),
      orderIds.slice(4),
    ]);

    const dropsAnOrder = await app.inject({
      method: "PUT",
      url: `/api/ops/activities/${activityId}/table-groups`,
      headers: auth(adminToken),
      payload: { tableGroups: [{ orderIds: orderIds.slice(0, 4) }] },
    });
    expect(dropsAnOrder.statusCode).toBe(400);
  });

  it("keeps the old draft and requires rebuilding after a paid candidate leaves", async () => {
    const admin = await loginAdmin("stale-draft-ops");
    const activityId = await createOpenActivity(admin);
    const owners = new Map<string, string>();
    for (let index = 0; index < 6; index += 1) {
      const user = await loginUser(`stale-draft-user-${index}`);
      await bindPhone(user, `13600139${String(index).padStart(3, "0")}`);
      owners.set(await createPaidOrder(user, activityId), user);
    }
    const draft = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(draft.statusCode).toBe(200);
    const removedOrderId = draft.json().tableGroups[0].orderIds[0];
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${removedOrderId}/cancel`,
      headers: auth(owners.get(removedOrderId)!), payload: { reason: "无法参加" } });
    expect(cancel.statusCode).toBe(200);
    const stale = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/confirm`, headers: auth(admin) });
    expect(stale.statusCode).toBe(409);
    expect(await prisma.order.count({ where: { activityId, status: "GROUPED" } })).toBe(0);
    const rebuilt = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(rebuilt.statusCode).toBe(200);
    expect(rebuilt.json().tableGroups[0].orderIds).toHaveLength(5);
    expect(await prisma.tableGroup.count({ where: { activityId, status: "CANCELED" } })).toBe(1);
    expect((await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/confirm`, headers: auth(admin) })).statusCode).toBe(200);
  });

  it("serializes cancellation and confirmation without double seating", async () => {
    const admin = await loginAdmin("confirm-cancel-race-ops");
    const activityId = await createOpenActivity(admin);
    const owners = new Map<string, string>();
    for (let index = 0; index < 4; index += 1) {
      const user = await loginUser(`confirm-cancel-race-user-${index}`);
      await bindPhone(user, `13500135${String(300 + index)}`);
      owners.set(await createPaidOrder(user, activityId), user);
    }
    const draft = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(draft.statusCode).toBe(200);
    const cancelOrderId = draft.json().tableGroups[0].orderIds[0];
    const [confirmation, cancellation] = await Promise.all([
      app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/confirm`, headers: auth(admin) }),
      app.inject({ method: "POST", url: `/api/orders/${cancelOrderId}/cancel`,
        headers: auth(owners.get(cancelOrderId)!), payload: { reason: "临时有事" } }),
    ]);
    expect(cancellation.statusCode).toBe(200);
    expect([200, 409]).toContain(confirmation.statusCode);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: cancelOrderId } });
    expect(order.status).toBe("REFUND_REVIEWING");
    expect(await prisma.tableMember.count({ where: { orderId: cancelOrderId,
      tableGroup: { status: "CONFIRMED" } } })).toBeLessThanOrEqual(1);
    const detail = await app.inject({ method: "GET", url: `/api/orders/${cancelOrderId}`, headers: auth(owners.get(cancelOrderId)!) });
    expect(detail.json().order.activity.address).toBeNull();
  });

  it("rejects confirmation when a pending order pays after the draft", async () => {
    const admin = await loginAdmin("new-payment-draft-ops");
    const activityId = await createOpenActivity(admin);
    for (let index = 0; index < 4; index += 1) {
      const user = await loginUser(`new-payment-draft-user-${index}`);
      await bindPhone(user, `13600142${String(index).padStart(3, "0")}`);
      await createPaidOrder(user, activityId);
    }
    const fifthUser = await loginUser("new-payment-draft-user-4");
    await bindPhone(fifthUser, "13500135114");
    const fifthOrder = await createPendingOrder(fifthUser, activityId);
    const fifthPayment = await createMockPayment(fifthUser, fifthOrder);
    expect((await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: `/api/mock/payments/${fifthPayment.id}/succeed` })).statusCode).toBe(200);
    const stale = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/confirm`, headers: auth(admin) });
    expect(stale.statusCode).toBe(409);
    const rebuilt = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(rebuilt.statusCode).toBe(200);
    expect(rebuilt.json().tableGroups[0].orderIds).toContain(fifthOrder);
    expect(await prisma.tableGroup.count({ where: { activityId, status: "CANCELED" } })).toBe(1);
  });

  it("keeps a legacy draft with no candidate digest and requires rebuilding it", async () => {
    const admin = await loginAdmin("legacy-draft-ops");
    const activityId = await createOpenActivity(admin);
    const orderIds: string[] = [];
    for (let index = 0; index < 4; index += 1) {
      const user = await loginUser(`legacy-draft-user-${index}`);
      await bindPhone(user, `13500135${String(200 + index)}`);
      orderIds.push(await createPaidOrder(user, activityId));
    }
    await prisma.activity.update({ where: { id: activityId }, data: { status: "LOCKING" } });
    const legacy = await prisma.tableGroup.create({ data: { activityId,
      members: { create: orderIds.map(orderId => ({ orderId })) } } });
    expect((await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/confirm`,
      headers: auth(admin) })).statusCode).toBe(409);
    const rebuilt = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect(rebuilt.statusCode).toBe(200);
    expect((await prisma.tableGroup.findUniqueOrThrow({ where: { id: legacy.id } })).status).toBe("CANCELED");
    expect(await prisma.tableMember.count({ where: { tableGroupId: legacy.id } })).toBe(4);
    expect((await prisma.tableGroup.findFirstOrThrow({ where: { activityId, generation: 1 } })).candidateDigest).not.toBeNull();
  });

  it("replays a durable inbox job after grouping without duplicate messages", async () => {
    const admin = await loginAdmin("durable-inbox-ops");
    const activityId = await createOpenActivity(admin);
    const userTokens: string[] = [];
    const tokensByOrder = new Map<string, string>();
    for (let index = 0; index < 4; index += 1) {
      const user = await loginUser(`durable-inbox-user-${index}`);
      userTokens.push(user);
      await bindPhone(user, `13600140${String(index).padStart(3, "0")}`);
      tokensByOrder.set(await createPaidOrder(user, activityId), user);
    }
    await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/draft`, headers: auth(admin) });
    expect((await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/table-groups/confirm`, headers: auth(admin) })).statusCode).toBe(200);
    const pending = await prisma.notification.findFirstOrThrow({ where: { type: "GROUP_CONFIRMED", user: { orders: { some: { activityId } } } } });
    const job = await prisma.durableJob.findUniqueOrThrow({ where: { businessKey: `inbox:${pending.businessKey}` } });
    expect(job.state).toBe("READY");
    const jobDiagnosis = await app.inject({ method: "GET", url: `/api/ops/diagnostics/jobs/${job.id}`, headers: auth(admin) });
    expect(jobDiagnosis.statusCode).toBe(200);
    expect(jobDiagnosis.json().notification).toMatchObject({ id: pending.id, userId: pending.userId, orderId: pending.orderId });
    expect((await app.inject({ method: "GET", url: `/api/ops/diagnostics/jobs/${job.id}`, headers: auth(userTokens[0]!) })).statusCode).toBe(403);
    await prisma.durableJob.update({ where: { id: job.id }, data: { runAt: new Date("2000-01-01") } });
    await runOne(prisma, "inbox-test-worker", "test-owner", { DELIVER_INBOX: lease =>
      prisma.$transaction(tx => deliverInbox(tx, lease.refId)) }, ["DELIVER_INBOX"]);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: pending.id } })).status).toBe("SENT");
    await prisma.$transaction(tx => deliverInbox(tx, pending.id));
    expect(await prisma.notification.count({ where: { businessKey: pending.businessKey } })).toBe(1);
    const ownedToken = tokensByOrder.get(pending.orderId!)!;
    const visible = await app.inject({ method: "GET", url: "/api/notifications?limit=1", headers: auth(ownedToken) });
    expect(visible.statusCode).toBe(200);
    expect(visible.json().notifications[0]).toMatchObject({ id: pending.id, status: "SENT", orderId: pending.orderId, activityId });
    expect(visible.json().notifications[0].readAt).toBeNull();
    const stranger = userTokens.find(token => token !== ownedToken)!;
    expect((await app.inject({ method: "POST", url: `/api/notifications/${pending.id}/read`, headers: auth(stranger) })).statusCode).toBe(404);
    const firstRead = await app.inject({ method: "POST", url: `/api/notifications/${pending.id}/read`, headers: auth(ownedToken) });
    expect(firstRead.statusCode).toBe(200);
    const secondRead = await app.inject({ method: "POST", url: `/api/notifications/${pending.id}/read`, headers: auth(ownedToken) });
    expect(secondRead.json().readAt).toBe(firstRead.json().readAt);
    // A later refund changes fulfillment state, not the historic notification's ownership.
    for (const status of ["REFUND_REVIEWING", "REFUNDING", "REFUNDED"] as const) {
      await prisma.order.update({ where: { id: pending.orderId! }, data: { status,
        ...(status === "REFUNDED" ? { registrationActive: false, capacityHeld: false } : {}) } });
      expect((await auditInbox(prisma)).invalidLink).not.toContain(pending.id);
    }
    const stranded = await prisma.notification.create({ data: { userId: pending.userId, orderId: pending.orderId,
      activityId, type: "GROUP_CONFIRMED", status: "PENDING", businessKey: `group:${activityId}:999:${pending.orderId}` } });
    expect((await auditInbox(prisma)).pendingWithoutJob).toContain(stranded.id);
    expect((await repairMissingInboxJobs(prisma)).repaired).toContain(stranded.id);
    expect((await repairMissingInboxJobs(prisma)).repaired).not.toContain(stranded.id);
    for (const index of [1, 2]) {
      await prisma.notification.create({ data: { userId: pending.userId, orderId: pending.orderId,
        activityId, type: "GROUP_CONFIRMED", status: "SENT", businessKey: `inbox-page:${pending.id}:${index}`,
        createdAt: new Date(pending.createdAt.getTime() + index * 1000) } });
    }
    const firstPage = await app.inject({ method: "GET", url: "/api/notifications?limit=1", headers: auth(ownedToken) });
    const secondPage = await app.inject({ method: "GET", url: `/api/notifications?limit=1&cursor=${encodeURIComponent(firstPage.json().nextCursor)}`, headers: auth(ownedToken) });
    expect(firstPage.json().nextCursor).toBeTruthy();
    expect(secondPage.json().notifications[0].id).not.toBe(firstPage.json().notifications[0].id);
    expect((await app.inject({ method: "GET", url: "/api/notifications?cursor=broken", headers: auth(ownedToken) })).statusCode).toBe(400);
  });

  it("rejects a grouping draft when fewer than four paid orders are eligible", async () => {
    const adminToken = await loginAdmin("table-grouping-minimum-ops");
    const activityId = await createOpenActivity(adminToken);

    for (let index = 0; index < 3; index += 1) {
      const userToken = await loginUser(`table-grouping-minimum-user-${index}`);
      await bindPhone(userToken, `13700137${String(index).padStart(3, "0")}`);
      await createPaidOrder(userToken, activityId);
    }

    const draft = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/table-groups/draft`,
      headers: auth(adminToken),
    });
    expect(draft.statusCode).toBe(409);
    expect(draft.json()).toMatchObject({
      error: "Not enough paid orders to form valid tables",
      decision: { canForm: false, reason: "below_minimum", unassignedCount: 3 },
    });
    expect(await prisma.tableGroup.count({ where: { activityId } })).toBe(0);
    await expectActivityStatus(activityId, ActivityStatus.REGISTRATION_OPEN);
  });

  it("records durable refund duties when an undersized activity fails", async () => {
    const adminToken = await loginAdmin("group-failure-ops");
    const activityId = await createOpenActivity(adminToken);
    const orderIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const userToken = await loginUser(`group-failure-user-${index}`);
      await bindPhone(userToken, `13700138${String(index).padStart(3, "0")}`);
      orderIds.push(await createPaidOrder(userToken, activityId));
    }
    await prisma.activity.update({
      where: { id: activityId },
      data: { registrationEndsAt: new Date(Date.now() - 60 * 60 * 1000) },
    });

    const forbidden = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/mark-group-failed`,
      headers: auth(await loginUser("group-failure-forbidden")),
      payload: { reason: "报名截止后人数不足" },
    });
    expect(forbidden.statusCode).toBe(403);

    const marked = await app.inject({
      method: "POST",
      url: `/api/ops/activities/${activityId}/mark-group-failed`,
      headers: auth(adminToken),
      payload: { reason: "报名截止后人数不足" },
    });
    expect(marked.statusCode).toBe(200);
    expect(marked.json()).toMatchObject({ idempotent: false, activityStatus: "GROUP_FAILED", affectedOrderCount: 3, notificationQueued: true });
    await expectActivityStatus(activityId, ActivityStatus.GROUP_FAILED);
    expect(await prisma.order.count({ where: { id: { in: orderIds }, status: OrderStatus.GROUP_FAILED } })).toBe(3);
    expect(await prisma.refundObligation.count({ where: { orderId: { in: orderIds }, cause: "GROUP_FAILED" } })).toBe(3);
    expect(await prisma.durableJob.count({ where: { kind: "REFUND_OBLIGATION", state: "READY",
      refId: { in: (await prisma.refundObligation.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } })).map(row => row.id) } } })).toBe(3);
    expect(await prisma.notification.count({
      where: { type: "GROUP_FAILED", status: "PENDING", user: { orders: { some: { id: { in: orderIds } } } } },
    })).toBe(3);
    expect(await prisma.auditLog.findFirst({ where: { action: "activity.group_failed", targetId: activityId, reason: "报名截止后人数不足" } })).not.toBeNull();

    const repeated = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/mark-group-failed`, headers: auth(adminToken), payload: { reason: "重复请求" } });
    expect(repeated.statusCode).toBe(200);
    expect(repeated.json().idempotent).toBe(true);
  });

  it("recovers a group-failure refund from its original receipt", async () => {
    const admin = await loginAdmin("failure-recovery-ops");
    const activityId = await createOpenActivity(admin);
    const user = await loginUser("failure-recovery-user");
    await bindPhone(user, "13500135111");
    const orderId = await createPaidOrder(user, activityId);
    await prisma.activity.update({ where: { id: activityId }, data: { registrationEndsAt: new Date(Date.now() - 60_000) } });
    const failed = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/mark-group-failed`,
      headers: auth(admin), payload: { reason: "人数不足" } });
    expect(failed.statusCode).toBe(200);
    const duty = await prisma.refundObligation.findFirstOrThrow({ where: { orderId } });
    await prisma.durableJob.update({ where: { businessKey: `obligation:${duty.id}` }, data: { runAt: new Date("2000-01-01") } });
    const receipt = await prisma.channelReceipt.findUniqueOrThrow({ where: { id: duty.receiptId } });
    expect(duty.amountCents).toBe(receipt.amountCents);
    await runOne(prisma, "obligation-test-worker", "test-owner", { REFUND_OBLIGATION: async lease => {
      await prepareObligation(prisma, lease.refId, "test-owner");
    } }, ["REFUND_OBLIGATION"]);
    const refund = await prisma.refund.findFirstOrThrow({ where: { obligationId: duty.id } });
    expect(refund.receiptId).toBe(receipt.id);
    expect(refund.status).toBe("REFUNDING");
    await prisma.durableJob.update({ where: { businessKey: `refund:${refund.id}` }, data: { runAt: new Date("2000-01-01") } });
    const mockChannel = new PersistentMockChannel(prisma);
    const handlers = recoveryHandlers(prisma, mockChannel, "test-owner");
    await runOne(prisma, "refund-test-worker", "test-owner", handlers, ["RECOVER_REFUND"]);
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refund.id } })).status).toBe("SUCCEEDED");
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("REFUNDED");
    expect((await prisma.refundObligation.findUniqueOrThrow({ where: { id: duty.id } })).state).toBe("SATISFIED");
  });

  it("reserves only the unrefunded part of a receipt when grouping fails", async () => {
    const admin = await loginAdmin("partial-failure-ops");
    const activityId = await createOpenActivity(admin);
    const user = await loginUser("partial-failure-user");
    await bindPhone(user, "13500135115");
    const orderId = await createPaidOrder(user, activityId);
    const receipt = await prisma.channelReceipt.findFirstOrThrow({ where: { orderId }, include: { payment: true } });
    await prisma.refund.create({ data: { orderId, paymentId: receipt.paymentId,
      receiptId: receipt.id, amountCents: 2000, status: "REFUNDING", resolutionState: "UNKNOWN",
      reason: "部分退款结果待查", requestedBy: "SYSTEM", channel: receipt.channel,
      merchantScope: receipt.merchantScope, providerConfigId: receipt.payment!.providerConfigId } });
    await prisma.activity.update({ where: { id: activityId }, data: { registrationEndsAt: new Date(Date.now() - 60_000) } });
    const response = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/mark-group-failed`,
      headers: auth(admin), payload: { reason: "人数不足" } });
    expect(response.statusCode).toBe(200);
    const duty = await prisma.refundObligation.findFirstOrThrow({ where: { receiptId: receipt.id } });
    expect(duty.amountCents).toBe(receipt.amountCents - 2000);
    expect(await prisma.refund.aggregate({ where: { receiptId: receipt.id }, _sum: { amountCents: true } }))
      .toMatchObject({ _sum: { amountCents: 2000 } });
  });

  it("requires super admin cancellation and records a refund duty before responding", async () => {
    const ops = await loginAdmin("operator-cancel-ops");
    const superAdmin = await loginAdmin("operator-cancel-super", "SUPER_ADMIN");
    const activityId = await createOpenActivity(ops);
    const user = await loginUser("operator-cancel-user");
    await bindPhone(user, "13500135112");
    const orderId = await createPaidOrder(user, activityId);
    const forbidden = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/cancel`,
      headers: auth(ops), payload: { reason: "餐厅临时停业" } });
    expect(forbidden.statusCode).toBe(403);
    const canceled = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/cancel`,
      headers: auth(superAdmin), payload: { reason: "餐厅临时停业" } });
    expect(canceled.statusCode).toBe(200);
    expect(await prisma.refundObligation.count({ where: { orderId, cause: "OPERATOR_CANCELED" } })).toBe(1);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("REFUNDING");
    const detail = await app.inject({ method: "GET", url: `/api/orders/${orderId}`, headers: auth(user) });
    expect(detail.json().order.activity.address).toBeNull();
    expect((await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/cancel`,
      headers: auth(superAdmin), payload: { reason: "重复取消" } })).json().idempotent).toBe(true);
  });

  it("creates a durable funding review when a canceled legacy paid order has no receipt", async () => {
    const ops = await loginAdmin("cancel-legacy-ops");
    const superAdmin = await loginAdmin("cancel-legacy-super", "SUPER_ADMIN");
    const activityId = await createOpenActivity(ops);
    const user = await loginUser("cancel-legacy-user");
    await bindPhone(user, "13500135118");
    const orderId = await createPendingOrder(user, activityId);
    await prisma.order.update({ where: { id: orderId }, data: { status: "PAID_PENDING_GROUP" } });
    const canceled = await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/cancel`,
      headers: auth(superAdmin), payload: { reason: "餐厅无法接待" } });
    expect(canceled.statusCode).toBe(200);
    expect(canceled.json().refundObligations).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("REFUNDING");
    const review = await prisma.financialCase.findUnique({ where: { caseKey: `CANCELED_FUNDING_UNVERIFIED:${orderId}` } });
    expect(review).toMatchObject({ sourceRef: orderId, state: "OPEN" });
    expect(review?.deadline.getTime()).toBeGreaterThan(Date.now());
    expect((await appInject({ method: "POST", url: `/api/ops/activities/${activityId}/cancel`,
      headers: auth(superAdmin), payload: { reason: "重复取消" } })).json().idempotent).toBe(true);
    expect(await prisma.financialCase.count({ where: { caseKey: `CANCELED_FUNDING_UNVERIFIED:${orderId}` } })).toBe(1);
  });

  it("reuses an existing user refund review when the operator cancels", async () => {
    const ops = await loginAdmin("cancel-review-ops");
    const superAdmin = await loginAdmin("cancel-review-super", "SUPER_ADMIN");
    const activityId = await createOpenActivity(ops);
    const user = await loginUser("cancel-review-user");
    await bindPhone(user, "13500135117");
    const orderId = await createPaidOrder(user, activityId);
    const requested = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`,
      headers: auth(user), payload: { reason: "无法参加" } });
    expect(requested.statusCode).toBe(200);
    const refundId = requested.json().refund.id;
    const canceled = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/cancel`,
      headers: auth(superAdmin), payload: { reason: "餐厅临时停业" } });
    expect(canceled.statusCode).toBe(200);
    const refund = await prisma.refund.findUniqueOrThrow({ where: { id: refundId } });
    expect(refund.status).toBe("REFUNDING");
    expect(refund.receiptId).not.toBeNull();
    expect(await prisma.refund.count({ where: { orderId } })).toBe(1);
    expect(await prisma.refundObligation.count({ where: { orderId } })).toBe(0);
    expect(await prisma.durableJob.count({ where: { businessKey: `refund:${refundId}`, state: "READY" } })).toBe(1);
  });

  it("rechecks current facts before rejecting a user's refund review", async () => {
    const ops = await loginAdmin("reject-refund-ops");
    const activityId = await createOpenActivity(ops);
    const user = await loginUser("reject-refund-user");
    await bindPhone(user, "13500135113");
    const orderId = await createPaidOrder(user, activityId);
    const cancel = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`,
      headers: auth(user), payload: { reason: "行程变化" } });
    expect(cancel.statusCode).toBe(200);
    const refundId = cancel.json().refund.id;
    const rejected = await app.inject({ method: "POST", url: `/api/ops/refunds/${refundId}/reject`,
      headers: auth(ops), payload: { reason: "未符合退款条件" } });
    expect(rejected.statusCode).toBe(200);
    expect(rejected.json().orderStatus).toBe("PAID_PENDING_GROUP");
    expect((await prisma.refund.findUniqueOrThrow({ where: { id: refundId } })).status).toBe("REJECTED");
    expect((await app.inject({ method: "POST", url: `/api/ops/refunds/${refundId}/reject`,
      headers: auth(ops), payload: { reason: "重复" } })).statusCode).toBe(409);
  });

  it("does not open a new user refund review after the activity starts", async () => {
    const ops = await loginAdmin("late-cancel-ops");
    const activityId = await createOpenActivity(ops);
    const user = await loginUser("late-cancel-user");
    await bindPhone(user, "13500135116");
    const orderId = await createPaidOrder(user, activityId);
    await prisma.activity.update({ where: { id: activityId }, data: { startsAt: new Date(Date.now() - 60_000) } });
    const response = await app.inject({ method: "POST", url: `/api/orders/${orderId}/cancel`,
      headers: auth(user), payload: { reason: "活动开始后申请" } });
    expect(response.statusCode).toBe(409);
    expect(await prisma.refund.count({ where: { orderId } })).toBe(0);
    expect((await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).status).toBe("PAID_PENDING_GROUP");
  });

  it("lets ops add a blacklist entry, blocks new registration, and requires super admin to remove it", async () => {
    const opsToken = await loginAdmin("blacklist-ops");
    const superAdminToken = await loginAdmin("blacklist-super", "SUPER_ADMIN");
    const userToken = await loginUser("blacklist-user");
    await bindPhone(userToken, "13500135090");
    const userId = userTokenPayload(userToken).sub;
    const activityId = await createOpenActivity(opsToken);

    const added = await app.inject({
      method: "POST",
      url: "/api/ops/blacklist",
      headers: auth(opsToken),
      payload: { userId, reason: "多次扰乱活动秩序" },
    });
    expect(added.statusCode).toBe(200);
    expect(added.json().idempotent).toBe(false);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ status: "BLACKLISTED" });

    const registration = await createOrder(userToken, activityId);
    expect(registration.statusCode).toBe(403);
    expect(registration.json().error).toBe("User cannot register");
    const listed = await app.inject({ method: "GET", url: "/api/ops/blacklist", headers: auth(opsToken) });
    expect(listed.statusCode).toBe(200);
    expect(listed.json().entries).toEqual(expect.arrayContaining([expect.objectContaining({ userId, reason: "多次扰乱活动秩序" })]));

    const forbiddenRemove = await app.inject({ method: "DELETE", url: `/api/ops/blacklist/${userId}`, headers: auth(opsToken), payload: { reason: "无权解除" } });
    expect(forbiddenRemove.statusCode).toBe(403);
    const removed = await app.inject({ method: "DELETE", url: `/api/ops/blacklist/${userId}`, headers: auth(superAdminToken), payload: { reason: "复核后解除" } });
    expect(removed.statusCode).toBe(200);
    expect(await prisma.user.findUniqueOrThrow({ where: { id: userId } })).toMatchObject({ status: "NORMAL" });
    expect(await prisma.auditLog.count({ where: { targetId: userId, action: { in: ["blacklist.added", "blacklist.removed"] } } })).toBe(2);
  });

  it("lets an order owner create or update a completed-order review and rejects other order states", async () => {
    const adminToken = await loginAdmin("review-ops");
    const ownerToken = await loginUser("review-owner");
    const otherUserToken = await loginUser("review-other-user");
    await bindPhone(ownerToken, "13500135091");
    await bindPhone(otherUserToken, "13500135092");
    const completedOrderId = await createPaidOrder(ownerToken, await createOpenActivity(adminToken));
    await prisma.order.update({ where: { id: completedOrderId }, data: { status: OrderStatus.COMPLETED } });

    const created = await app.inject({
      method: "PUT",
      url: `/api/orders/${completedOrderId}/review`,
      headers: auth(ownerToken),
      payload: { score: 5, tags: ["餐厅氛围", "组织顺畅"], content: "体验不错" },
    });
    expect(created.statusCode).toBe(200);
    expect(created.json().review).toMatchObject({ score: 5, tags: ["餐厅氛围", "组织顺畅"], content: "体验不错" });

    const updated = await app.inject({
      method: "PUT",
      url: `/api/orders/${completedOrderId}/review`,
      headers: auth(ownerToken),
      payload: { score: 4, tags: ["菜品"], content: "已更新" },
    });
    expect(updated.statusCode).toBe(200);
    expect(await prisma.review.count({ where: { orderId: completedOrderId } })).toBe(1);
    expect(await prisma.review.findUniqueOrThrow({ where: { orderId: completedOrderId } })).toMatchObject({ score: 4, tags: ["菜品"], content: "已更新" });

    const forbidden = await app.inject({ method: "PUT", url: `/api/orders/${completedOrderId}/review`, headers: auth(otherUserToken), payload: { score: 5, tags: [], content: "越权" } });
    expect(forbidden.statusCode).toBe(404);
    const pendingOrderId = await createPendingOrder(ownerToken, await createOpenActivity(adminToken));
    const pending = await app.inject({ method: "PUT", url: `/api/orders/${pendingOrderId}/review`, headers: auth(ownerToken), payload: { score: 5, tags: [], content: "尚未结束" } });
    expect(pending.statusCode).toBe(409);
    const canceledOrderId = await createPendingOrder(ownerToken, await createOpenActivity(adminToken));
    await prisma.order.update({ where: { id: canceledOrderId }, data: { status: OrderStatus.CANCELED } });
    const canceled = await app.inject({ method: "PUT", url: `/api/orders/${canceledOrderId}/review`, headers: auth(ownerToken), payload: { score: 5, tags: [], content: "已取消" } });
    expect(canceled.statusCode).toBe(409);
    const refundedOrderId = await createPendingOrder(ownerToken, await createOpenActivity(adminToken));
    await prisma.order.update({ where: { id: refundedOrderId }, data: { status: OrderStatus.REFUNDED } });
    const refunded = await app.inject({ method: "PUT", url: `/api/orders/${refundedOrderId}/review`, headers: auth(ownerToken), payload: { score: 5, tags: [], content: "已退款" } });
    expect(refunded.statusCode).toBe(409);

    const opsList = await app.inject({ method: "GET", url: "/api/ops/reviews", headers: auth(adminToken) });
    expect(opsList.statusCode).toBe(200);
    expect(opsList.json().reviews).toEqual(expect.arrayContaining([expect.objectContaining({ order: expect.objectContaining({ id: completedOrderId }), score: 4 })]));
  });

  it("lets ops manually start and complete a past grouped activity, then unlocks the review path", async () => {
    const opsToken = await loginAdmin("activity-completion-ops");
    const userToken = await loginUser("activity-completion-user");
    await bindPhone(userToken, "13500135093");
    const activityId = await createOpenActivity(opsToken);
    const orderId = await createPaidOrder(userToken, activityId);
    await prisma.activity.update({
      where: { id: activityId },
      data: { status: ActivityStatus.GROUPED, startsAt: new Date(Date.now() - 2 * 60 * 60 * 1000), endsAt: new Date(Date.now() - 60 * 60 * 1000) },
    });
    await prisma.order.update({ where: { id: orderId }, data: { status: OrderStatus.GROUPED } });

    const userStart = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/start`, headers: auth(userToken) });
    expect(userStart.statusCode).toBe(403);
    const started = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/start`, headers: auth(opsToken) });
    expect(started.statusCode).toBe(200);
    expect(started.json()).toMatchObject({ idempotent: false, activityStatus: "IN_PROGRESS" });
    const completed = await app.inject({ method: "POST", url: `/api/ops/activities/${activityId}/complete`, headers: auth(opsToken) });
    expect(completed.statusCode).toBe(200);
    expect(completed.json()).toMatchObject({ idempotent: false, activityStatus: "COMPLETED", completedOrderCount: 1 });
    await expectActivityStatus(activityId, ActivityStatus.COMPLETED);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: orderId } })).toMatchObject({ status: OrderStatus.COMPLETED });
    expect(await prisma.auditLog.count({ where: { targetId: activityId, action: { in: ["activity.started", "activity.completed"] } } })).toBe(2);
    const review = await app.inject({ method: "PUT", url: `/api/orders/${orderId}/review`, headers: auth(userToken), payload: { score: 5, tags: ["完成"], content: "可以评价" } });
    expect(review.statusCode).toBe(200);
  });

  it("serves minimal ops list endpoints for restaurants, activities, orders, refunds, and audits", async () => {
    const adminToken = await loginAdmin("ops-list-ops");
    const userToken = await loginUser("ops-list-user");
    await bindPhone(userToken, "13500135040");
    const activityId = await createOpenActivity(adminToken);
    const orderId = await createPaidOrder(userToken, activityId);
    const cancelResponse = await app.inject({
      method: "POST",
      url: `/api/orders/${orderId}/cancel`,
      headers: auth(userToken),
      payload: { reason: "列表联调取消" },
    });
    expect(cancelResponse.statusCode).toBe(200);

    for (const [url, key] of [
      ["/api/ops/restaurants", "restaurants"],
      ["/api/ops/activities", "activities"],
      ["/api/ops/orders", "orders"],
      ["/api/ops/refunds", "refunds"],
      ["/api/ops/audit-logs", "auditLogs"],
    ] as const) {
      const response = await app.inject({
        method: "GET",
        url,
        headers: auth(adminToken),
      });
      expect(response.statusCode).toBe(200);
      expect(Array.isArray(response.json()[key])).toBe(true);
      expect(response.json()[key].length).toBeGreaterThan(0);
    }
  });
});

async function cleanupTestData(): Promise<void> {
  const [users, admins, restaurants] = await Promise.all([
    prisma.user.findMany({
      where: { wechatOpenid: { startsWith: `mock_openid_${testRunPrefix}_` } },
      select: { id: true },
    }),
    prisma.adminUser.findMany({
      where: { username: { startsWith: `${testRunPrefix}_` } },
      select: { id: true },
    }),
    prisma.restaurant.findMany({
      where: { name: { startsWith: `${testRunPrefix}_` } },
      select: { id: true },
    }),
  ]);
  const userIds = users.map((user) => user.id);
  const adminIds = admins.map((admin) => admin.id);
  const restaurantIds = restaurants.map((restaurant) => restaurant.id);
  const activities = await prisma.activity.findMany({
    where: {
      OR: [
        { restaurantId: { in: restaurantIds } },
        { title: { startsWith: `${testRunPrefix}_` } },
      ],
    },
    select: { id: true },
  });
  const activityIds = activities.map((activity) => activity.id);
  const orders = await prisma.order.findMany({
    where: {
      OR: [
        { userId: { in: userIds } },
        { activityId: { in: activityIds } },
      ],
    },
    select: { id: true },
  });
  const orderIds = orders.map((order) => order.id);
  const [payments, refunds, tableGroups] = await Promise.all([
    prisma.payment.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    }),
    prisma.refund.findMany({
      where: { orderId: { in: orderIds } },
      select: { id: true },
    }),
    prisma.tableGroup.findMany({
      where: { activityId: { in: activityIds } },
      select: { id: true },
    }),
  ]);
  const paymentIds = payments.map((payment) => payment.id);
  const refundIds = refunds.map((refund) => refund.id);
  const tableGroupIds = tableGroups.map((group) => group.id);
  const receipts = await prisma.channelReceipt.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, channelTradeNo: true } });
  const duties = await prisma.refundObligation.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  const linkedRefs = [...orderIds, ...paymentIds, ...refundIds, ...receipts.map(row => row.id), ...duties.map(row => row.id)];
  const linkedJobs = await prisma.durableJob.findMany({ where: { refId: { in: linkedRefs } }, select: { id: true } });
  const targetIds = [
    ...orderIds,
    ...paymentIds,
    ...refundIds,
    ...activityIds,
    ...restaurantIds,
    ...tableGroupIds,
    ...receipts.map(row => row.id),
    ...duties.map(row => row.id),
    ...linkedJobs.map(row => row.id),
  ];
  await prisma.financialCase.deleteMany({ where: { sourceRef: { in: targetIds } } });

  const notifications = await prisma.notification.findMany({ where: { userId: { in: userIds } }, select: { id: true } });
  await prisma.durableJob.deleteMany({ where: { refId: { in: notifications.map(row => row.id) } } });
  await prisma.notification.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.auditLog.deleteMany({
    where: {
      OR: [
        { actorId: { in: [...userIds, ...adminIds] } },
        { targetId: { in: targetIds } },
      ],
    },
  });
  await prisma.blacklist.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.review.deleteMany({ where: { OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }] } });
  await prisma.report.deleteMany({
    where: {
      OR: [{ userId: { in: userIds } }, { orderId: { in: orderIds } }],
    },
  });
  await prisma.tableMember.deleteMany({
    where: {
      OR: [
        { tableGroupId: { in: tableGroupIds } },
        { orderId: { in: orderIds } },
      ],
    },
  });
  await prisma.tableGroup.deleteMany({ where: { id: { in: tableGroupIds } } });
  await prisma.refund.deleteMany({ where: { id: { in: refundIds } } });
  const events = await prisma.receivedEvent.findMany({ where: { eventKey: { startsWith: testRunPrefix } }, select: { id: true } });
  await prisma.durableJob.deleteMany({ where: { refId: { in: events.map(e => e.id) } } });
  await prisma.receivedEvent.deleteMany({ where: { id: { in: events.map(e => e.id) } } });
  await prisma.durableJob.deleteMany({ where: { refId: { in: [...paymentIds, ...refundIds, ...duties.map(d => d.id)] } } });
  await prisma.refundObligation.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.auditLog.deleteMany({ where: { targetId: { in: receipts.map(r => r.id) } } });
  await prisma.mockChannelTransaction.deleteMany({ where: { OR: [{ channelNo: { in: receipts.map(r => r.channelTradeNo) } }, { originalTradeNo: { in: receipts.map(r => r.channelTradeNo) } }] } });
  await prisma.channelReceipt.deleteMany({ where: { orderId: { in: orderIds } } });
  await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
  await prisma.order.deleteMany({ where: { id: { in: orderIds } } });
  await prisma.activity.deleteMany({ where: { id: { in: activityIds } } });
  await prisma.restaurant.deleteMany({ where: { id: { in: restaurantIds } } });
  await prisma.consentRecord.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.adminUser.deleteMany({ where: { id: { in: adminIds } } });
}

async function loginAdmin(username: string, role: "OPS" | "SUPER_ADMIN" = "OPS"): Promise<string> {
  const response = await appInject({
    method: "POST",
    url: "/api/mock/admin-login",
    payload: { username: scoped(username), role },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token;
}

function userTokenPayload(token: string): { sub: string } {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Invalid user token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { sub: string };
}

async function loginUser(code: string): Promise<string> {
  const response = await appInject({
    method: "POST",
    url: "/api/mock/wechat-login",
    payload: { code: scoped(code) },
  });
  expect(response.statusCode).toBe(200);
  return response.json().token;
}

async function bindPhone(token: string, phone: string): Promise<void> {
  const response = await appInject({
    method: "POST",
    url: "/api/mock/phone",
    headers: auth(token),
    payload: { phone },
  });
  expect(response.statusCode).toBe(200);
}

async function createRestaurant(adminToken: string): Promise<string> {
  const response = await appInject({
    method: "POST",
    url: "/api/ops/restaurants",
    headers: auth(adminToken),
    payload: {
      name: scoped("梧桐小馆"),
      district: "徐汇",
      businessArea: "衡山路",
      address: "衡山路 100 号",
      contactName: "运营联系人",
      contactPhone: "13500135000",
      budgetCents: 18800,
      cuisineTags: ["本帮菜"],
      capacity: 12,
    },
  });
  expect(response.statusCode).toBe(200);
  return response.json().restaurant.id;
}

async function createOpenActivity(
  adminToken: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const restaurantId = await createRestaurant(adminToken);
  const response = await appInject({
    method: "POST",
    url: "/api/ops/activities",
    headers: auth(adminToken),
    payload: activityPayload(restaurantId, overrides),
  });
  expect(response.statusCode).toBe(200);
  return response.json().activity.id;
}

async function createOrder(userToken: string, activityId: string) {
  await confirmAgreement(userToken);
  return appInject({
    method: "POST",
    url: "/api/orders",
    headers: auth(userToken),
    payload: {
      activityId,
      agreementVersion: "v1",
      amountCents: 1,
    },
  });
}

async function confirmAgreement(token: string, agreementVersion = "v1"): Promise<void> {
  const response = await appInject({
    method: "POST",
    url: "/api/consents",
    headers: auth(token),
    payload: { agreementVersion, source: "test" },
  });
  expect(response.statusCode).toBe(200);
  const profile = await appInject({ method: "GET", url: "/api/profile", headers: auth(token) });
  expect(profile.statusCode).toBe(200);
  if (!profile.json().profile) {
    const saved = await appInject({ method: "PUT", url: "/api/profile", headers: auth(token),
      payload: { ...profilePayload(), acceptableTableSizes: [4, 5, 6, 7, 8] } });
    expect(saved.statusCode).toBe(200);
  }
}

async function createPendingOrder(userToken: string, activityId: string): Promise<string> {
  const orderResponse = await createOrder(userToken, activityId);
  expect(orderResponse.statusCode).toBe(200);
  return orderResponse.json().order.id;
}

async function createPaidOrder(userToken: string, activityId: string): Promise<string> {
  const orderId = await createPendingOrder(userToken, activityId);
  const payment = await createMockPayment(userToken, orderId);
  const callbackResponse = await appInject({
    method: "POST",
    url: `/api/mock/payments/${payment.id}/succeed`,
  });
  expect(callbackResponse.statusCode).toBe(200);
  return orderId;
}

async function createMockPayment(userToken: string, orderId: string) {
  const paymentResponse = await appInject({
    method: "POST",
    url: "/api/mock/payments",
    headers: auth(userToken),
    payload: { orderId },
  });
  expect(paymentResponse.statusCode).toBe(200);
  return paymentResponse.json().payment;
}

async function expectOrderCreateStatus(
  activityId: string,
  code: string,
  statusCode: number,
  phone = "13500135000",
): Promise<void> {
  const userToken = await loginUser(code);
  await bindPhone(userToken, phone);
  const response = await createOrder(userToken, activityId);
  expect(response.statusCode).toBe(statusCode);
  if (statusCode === 200) {
    expect(response.json().order.amountCents).toBe(9900);
  }
}

async function expectOrderCount(activityId: string, expectedCount: number): Promise<void> {
  const count = await prisma.order.count({ where: { activityId } });
  expect(count).toBe(expectedCount);
}

async function expectOrderStatus(orderId: string, status: OrderStatus): Promise<void> {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
  expect(order.status).toBe(status);
}

async function expectActivityStatus(activityId: string, status: ActivityStatus): Promise<void> {
  const activity = await prisma.activity.findUniqueOrThrow({ where: { id: activityId } });
  expect(activity.status).toBe(status);
}

async function cancelApproveAndRefund(
  adminToken: string,
  userToken: string,
  orderId: string,
) {
  const cancelResponse = await appInject({
    method: "POST",
    url: `/api/orders/${orderId}/cancel`,
    headers: auth(userToken),
    payload: { reason: "取消后退款" },
  });
  expect(cancelResponse.statusCode).toBe(200);
  const refund = cancelResponse.json().refund;
  const approveResponse = await appInject({
    method: "POST",
    url: `/api/ops/refunds/${refund.id}/approve`,
    headers: auth(adminToken),
    payload: { reason: "运营快速审核通过" },
  });
  expect(approveResponse.statusCode).toBe(200);
  const successResponse = await appInject({
    method: "POST",
    url: `/api/mock/refunds/${refund.id}/succeed`,
  });
  expect(successResponse.statusCode).toBe(200);
  return refund;
}

function activityPayload(
  restaurantId: string,
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const registrationEndsAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);

  return {
    restaurantId,
    title: scoped("周末兴趣餐桌"),
    theme: "本帮菜体验",
    description: "两小时餐厅体验，费用为服务费/订位费，餐费到店自理。",
    district: "徐汇",
    businessArea: "衡山路",
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    registrationEndsAt: registrationEndsAt.toISOString(),
    serviceFeeCents: 9900,
    mealFeeIncluded: false,
    mealFeePolicyText: "票价仅为服务费/订位费，不包含全部餐费。",
    capacity: 12,
    status: "REGISTRATION_OPEN",
    ...overrides,
  };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function profilePayload() {
  return {
    preferredAreas: ["徐汇", "静安"],
    availableTimes: ["周六晚"],
    tastePreferences: ["本帮菜"],
    dietaryRestrictions: ["无"],
    budgetRange: "150-250",
    tableVibe: "轻松聊天",
    acceptableTableSizes: [4, 6],
    note: "靠近地铁即可",
  };
}

function wechatCallbackEnv() {
  return {
    AUTH_PROVIDER: "wechat", PHONE_PROVIDER: "wechat",
    WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
    SESSION_SECRET: "test-session-signing-material-32-bytes",
    PAYMENT_PROVIDER: "wechat",
    REFUND_PROVIDER: "wechat",
    FEATURE_REAL_WECHAT_PAY: "true",
    WECHAT_PAY_ENABLED: "true",
    WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
    WECHAT_PAY_MCH_ID: "test_mch_id",
    WECHAT_PAY_API_V3_KEY: "test_api_v3_key",
    WECHAT_PAY_PRIVATE_KEY_PATH: "/tmp/test-key.pem",
    WECHAT_PAY_CERT_SERIAL_NO: "test_cert_serial",
    WECHAT_PAY_PLATFORM_CERT_PATH: "/tmp/test-platform-cert.pem",
    WECHAT_PAY_CALLBACK_URL: "https://example.invalid/pay",
    WECHAT_REFUND_CALLBACK_URL: "https://example.invalid/refund",
  };
}

function signedWechatCallback(resource: Record<string, unknown>) {
  resource = { mchid: "test_mch_id", appid: "wx_test_app_id", success_time: new Date().toISOString(), ...resource, amount: { ...(resource.refund_status ? {} : { currency: "CNY" }), ...(resource.amount as object) } };
  const nonce = randomBytes(12).toString("base64url").slice(0, 12);
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(callbackFixtureKey), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(resource), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const body = JSON.stringify({ id: scoped(`event_${randomBytes(8).toString("hex")}`), event_type: resource.refund_status ? "REFUND.SUCCESS" : "TRANSACTION.SUCCESS", resource: { algorithm: "AEAD_AES_256_GCM", associated_data: associatedData, nonce, ciphertext } });
  const signer = createSign("RSA-SHA256");
  signer.update(`${callbackNowSeconds}\ncallback-notification-nonce\n${body}\n`);
  signer.end();
  return {
    body,
    headers: {
      "content-type": "application/json",
      "wechatpay-serial": "fixture-serial",
      "wechatpay-timestamp": String(callbackNowSeconds),
      "wechatpay-nonce": "callback-notification-nonce",
      "wechatpay-signature": signer.sign(callbackPrivateKey, "base64"),
    },
  };
}

function scoped(value: string): string {
  return `${testRunPrefix}_${value}`;
}

let appRef: Awaited<ReturnType<typeof buildApp>>;

async function appInject(options: Parameters<typeof appRef.inject>[0]) {
  return appRef.inject(options);
}
