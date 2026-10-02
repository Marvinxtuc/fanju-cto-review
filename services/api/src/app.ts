import {channelWorkerMode} from './prelaunch/channel-worker-mode.js';
import { createRefundNotificationTrigger } from './prelaunch/refund-notification-trigger.js';
import { createPaymentNotificationTrigger } from './prelaunch/payment-notification-trigger.js';
import { registerProductionIdentityRoutes } from './prelaunch/production-identity-routes.js';
import { registerFormalBusinessRoutes } from './prelaunch/formal-business-routes.js';
import type {createWechatChannel} from './prelaunch/wechat-channel.js';
import type { RuntimeAuthoritySource } from './prelaunch/formal-runtime-policy.js';
import {PrelaunchError} from './prelaunch/contracts.js';
import { recoverPrepay, publishPrepay } from "./funding/prepay.js";
import { persistTrustedEvent } from "./events/inbox.js";
import { openCase } from "./jobs/queue.js";
import { checkReadiness, hasCompleteBillCoverage } from "./jobs/heartbeat.js";
import { resolveVerifiedCase } from "./reconciliation/cases.js";
import { createHash, X509Certificate } from "node:crypto";
import { bindingFor, ensurePaymentIntent } from "./funding/intents.js";
import { applyPaymentEvidence, lockOrder } from "./funding/receipts.js";
import { reserveRefund, confirmRefund, recordRefundFailure } from "./funding/refunds.js";
import { PersistentMockChannel } from "./funding/mock-channel.js";
import { expireOrder, markOrderState, scheduleExpiration } from "./orders/inventory.js";
import { currentCandidates, draftFormation, adjustFormation, confirmFormation, createDecisionRefundDuties, queueDecisionNotifications } from "./orders/formation.js";
import { currentAgreement } from "./orders/agreement.js";
import { assertBillScopeBinding, canStartRealPayment, validateRuntimeMode, localDemoEnabled } from "./config.js";
import cors from "@fastify/cors";
import { readFileSync } from "node:fs";
import {
  ActivityStatus,
  OrderStatus,
  PaymentStatus,
  ReportStatus,
  RefundStatus,
  type PrismaClient,
} from "./generated/prisma/client.js";
import {
  assertActivityTransition,
  assertOrderTransition,
  assertVisibleCopyAllowed,
  calculateOrderAmountCents,
  evaluateTableFormation,
  evaluateRefundDecision,
  type ActivityStatus as SharedActivityStatus,
  type OrderStatus as SharedOrderStatus,
} from "@timeleft-shanghai/shared";
import Fastify from "fastify";
import { z, ZodError } from "zod";
import { registerAdminLogin } from "./admin-auth.js";
import { signSession, registerAuth, requireOps, requireSuperAdmin, requireUser } from "./auth.js";
import { prisma as defaultPrisma } from "./prisma.js";
import {
  createWechatProviders,
  ProviderConfigError,
  type ProviderHttpClient,
  ProviderUnavailableError,
  type ProviderEnv,
} from "./providers.js";
import {
  WechatPayNotificationError,
  verifyPaymentNotification,
  verifyRefundNotification,
  type WechatPayNotificationConfig,
} from "./wechat-pay.js";

const phoneSchema = z.string().regex(/^\+?\d{8,15}$/);

export interface BuildAppOptions {
  prisma?: PrismaClient;
  providerEnv?: ProviderEnv;
  providerHttpClient?: ProviderHttpClient;
  wechatPayNotificationConfig?: WechatPayNotificationConfig;
  formalRuntimeAuthoritySource?: RuntimeAuthoritySource;
  formalChannel?: ReturnType<typeof createWechatChannel>;
}

export async function buildApp(options: BuildAppOptions = {}) {
  const db = options.prisma ?? defaultPrisma;
  const providerEnv = options.providerEnv ?? process.env;
  const demoEnabled = localDemoEnabled(providerEnv);
  const providers = createWechatProviders(providerEnv, {
    ...(options.providerHttpClient === undefined
      ? {}
      : { httpClient: options.providerHttpClient }),
  });
  validateRuntimeMode(providerEnv, providers);
  const paymentBinding = bindingFor(providerEnv, providers.payment.mode);
  assertBillScopeBinding(providerEnv, paymentBinding.merchantScope);
  const mockChannel = new PersistentMockChannel(db);
  const caseOwner = providerEnv.FINANCIAL_CASE_OWNER?.trim() || "local-review-required";
  const app = Fastify({ logger: true, bodyLimit: 262144 });
  const callbackBodies = new WeakMap<object, string>();

  app.addHook("preParsing", (request, _reply, payload, done) => {
    if (
      request.url === "/api/wechat/pay/notify" ||
      request.url === "/api/wechat/refund/notify"
    ) {
      const chunks: Buffer[] = [];
      let receivedBytes = 0;
      payload.on("data", (chunk: Buffer | string) => {
        receivedBytes += Buffer.byteLength(chunk);
        if (receivedBytes <= 262144) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      });
      payload.on("end", () => {
        if (receivedBytes <= 262144) callbackBodies.set(request, Buffer.concat(chunks).toString("utf8"));
      });
    }
    done(null, payload);
  });

  const allowedOpsOrigins = new Set((providerEnv.OPS_ALLOWED_ORIGINS?.trim() || (providerEnv.NODE_ENV === "production" ? "" : "http://localhost:5173,http://127.0.0.1:5173"))
    .split(",").map(origin => origin.trim()).filter(Boolean));
  await app.register(cors, { origin: (origin, callback) => callback(null, !!origin && allowedOpsOrigins.has(origin)),
    methods: ["GET", "HEAD", "POST", "PUT", "DELETE"] });
  await registerAuth(app, db, providerEnv, demoEnabled);
  registerAdminLogin(app);
  registerProductionIdentityRoutes(app, db, providerEnv, providers, demoEnabled);
  await registerFormalBusinessRoutes(app, db, providerEnv, providers, demoEnabled, options.formalRuntimeAuthoritySource,options.formalChannel);
  const v11NotifyFlag = providerEnv.FEATURE_V11_PAYMENT_NOTIFICATIONS;
  if (v11NotifyFlag !== undefined && !['true','false'].includes(v11NotifyFlag)) throw Error('Invalid V1.1 payment notification flag');
  if (v11NotifyFlag === 'true' && (providers.payment.mode !== 'wechat' || !providerEnv.FINANCIAL_CASE_OWNER?.trim()))
    throw Error('Real payment notifications require real provider and explicit case owner');
  const v11PaymentNotification = v11NotifyFlag === 'true'
    ? createPaymentNotificationTrigger(db, bindingFor(providerEnv, 'wechat'), caseOwner) : undefined;
  const v11RefundNotifyFlag = providerEnv.FEATURE_V11_REFUND_NOTIFICATIONS;
  if (v11RefundNotifyFlag !== undefined && !['true','false'].includes(v11RefundNotifyFlag)) throw Error('Invalid V1.1 refund notification flag');
  if (v11RefundNotifyFlag === 'true' && (providers.refund.mode !== 'wechat' || !providerEnv.FINANCIAL_CASE_OWNER?.trim()))
    throw Error('Real refund notifications require real provider and explicit case owner');
  const v11RefundNotification = v11RefundNotifyFlag === 'true'
    ? createRefundNotificationTrigger(db, bindingFor(providerEnv, 'wechat'), caseOwner) : undefined;
  const v11WorkerFlags = [providerEnv.FEATURE_V11_FORMAL_PAYMENT_CLOSE,providerEnv.FEATURE_V11_FORMAL_HOLD_EXPIRY];
  if(v11WorkerFlags.some(flag=>flag!==undefined&&!['true','false'].includes(flag)))throw Error('Invalid formal worker flag');
  const v11RecoveryRequired = v11NotifyFlag === 'true' || v11RefundNotifyFlag === 'true' || v11WorkerFlags.includes('true');
  if(v11WorkerFlags.includes('true')&&(providers.payment.mode!=='wechat'||providers.refund.mode!=='wechat'||providerEnv.FEATURE_V11_QUERY_RECOVERY!=='true'))throw Error('Formal workers require real providers and query recovery');
  if (v11RecoveryRequired && !providerEnv.RELEASE_VERSION?.trim()) throw Error('V1.1 recovery readiness requires explicit release version');




  app.setErrorHandler((error, _request, reply) => {
    if(error instanceof PrelaunchError)return reply.code(error.statusCode).send({version:'v11-business-1',error:{code:error.code,blockerIds:error.blockerIds}});
    if (error instanceof WechatPayNotificationError) {
      return reply.code(400).send({ error: "Invalid payment notification" });
    }
    if (error instanceof ZodError) {
      return reply.code(400).send({
        error: "Validation failed",
        issues: error.issues,
      });
    }
    const message = error instanceof Error ? error.message : String(error);
    if (
      message.includes("forbidden words") ||
      message.includes("mealFeeIncluded")
    ) {
      return reply.code(400).send({ error: message });
    }
    if (error instanceof ProviderUnavailableError) {
      return reply.code(503).send({ error: message });
    }
    if (error instanceof ProviderConfigError) {
      return reply.code(500).send({ error: message });
    }
    const statusCode = (error as { statusCode?: unknown }).statusCode;
    if (
      typeof statusCode === "number" &&
      statusCode >= 400 &&
      statusCode < 500
    ) {
      return reply
        .code(statusCode)
        .send({ error: statusCode === 401 ? "Unauthorized" : message });
    }

    app.log.error(error);
    return reply.code(500).send({ error: "Internal server error" });
  });

  app.get("/health", async () => ({ ok: true }));
  app.get("/ready", async (_request, reply) => {
    const configuredModes = (providerEnv.REQUIRED_WORKER_MODES?.trim()
      || (providerEnv.NODE_ENV === "production" ? "events-only,inbox-only" : ""))
      .split(",").map(mode => mode.trim()).filter(Boolean);
    const requiredModes = [...new Set([...configuredModes, ...(v11RecoveryRequired ? [channelWorkerMode('v11-wechat-query',bindingFor(providerEnv,'wechat'))] : []),
      ...(providerEnv.FEATURE_V11_FORMAL_PAYMENT_CLOSE==='true'?[channelWorkerMode('v11-formal-payment-close',bindingFor(providerEnv,'wechat'))]:[]),
      ...(providerEnv.FEATURE_V11_FORMAL_HOLD_EXPIRY==='true'?[channelWorkerMode('v11-formal-hold-expiry',bindingFor(providerEnv,'wechat'))]:[])])];
    try {
      const bill = providerEnv.NEW_PAYMENTS_ENABLED === "true" ? {
        scope: paymentBinding.merchantScope, period: providerEnv.REQUIRED_BILL_PERIOD! } : undefined;
      const result = await checkReadiness(db, requiredModes, bill, v11RecoveryRequired ? {
        version: providerEnv.RELEASE_VERSION!.trim(), migrations: ['20261001000000_prelaunch_v11_expand',
          '20261001010000_v11_payment_preparation','20261001020000_v11_receipt_recorded_state',
          '20261001030000_v11_refund_request_snapshot','20261001040000_v11_real_refund_binding'] } : undefined);
      return reply.code(result.ok ? 200 : 503).send(result);
    } catch {
      return reply.code(503).send({ ok: false, missingModes: requiredModes, billCovered: null });
    }
  });

  app.post("/api/mock/wechat-login", async (request) => {
    const body = z.object({ code: z.string().min(1) }).parse(request.body);
    const identity = await providers.auth.exchangeLoginCode({ code: body.code });
    const user = await upsertWechatUser(db, identity);
    const token = signSession(app, { sub: user.id, role: "USER" });

    return {
      token,
      user: {
        id: user.id,
        phone: maskPhone(user.phone),
        status: user.status,
      },
    };
  });

  app.post("/api/mock/phone", async (request) => {
    const auth = await requireUser(request);
    const body = z
      .object({
        phone: phoneSchema.optional(),
        code: z.string().min(1).optional(),
      })
      .parse(request.body);
    const resolved = await providers.phone.resolvePhone({
      ...(body.phone === undefined ? {} : { phone: body.phone }),
      ...(body.code === undefined ? {} : { code: body.code }),
    });
    const user = await db.user.update({
      where: { id: auth.sub },
      data: { phone: resolved.phone },
    });

    return { user: { id: user.id, phone: maskPhone(user.phone) } };
  });

  app.get("/api/agreement/current", async (_request, reply) => {
    const policy = await db.$transaction(tx => currentAgreement(tx));
    if (!policy) return reply.code(503).send({ error: "Current agreement is unavailable" });
    return { agreement: { version: policy.version, text: policy.text, textHash: policy.textHash,
      activatedAt: policy.activatedAt, source: policy.source } };
  });

  app.post("/api/consents", async (request, reply) => {
    const auth = await requireUser(request);
    const body = z.object({
      agreementVersion: z.string().trim().min(1).max(100),
      source: z.string().trim().min(1).max(100),
    }).parse(request.body);
    const consent = await db.$transaction(async (tx) => {
      const policy = await currentAgreement(tx, true);
      if (!policy) return { error: "Current agreement is unavailable", statusCode: 503 as const };
      if (body.agreementVersion !== policy.version) return { error: "Current agreement must be accepted", statusCode: 409 as const };
      const existing = await tx.consentRecord.findFirst({
        where: { userId: auth.sub, agreementVersion: policy.version, policyHash: policy.textHash },
        orderBy: { createdAt: "desc" },
      });
      if (existing) return existing;
      const next = await tx.consentRecord.create({
        data: { userId: auth.sub, agreementVersion: policy.version, policyHash: policy.textHash, source: body.source },
      });
      await tx.auditLog.create({
        data: {
          action: "consent.confirmed",
          targetType: "ConsentRecord",
          targetId: next.id,
          metadata: { agreementVersion: next.agreementVersion, source: next.source },
        },
      });
      return next;
    });
    if ("error" in consent) return reply.code(consent.statusCode).send({ error: consent.error });
    return { consent: { id: consent.id, agreementVersion: consent.agreementVersion, createdAt: consent.createdAt } };
  });

  app.get("/api/profile", async (request) => {
    const auth = await requireUser(request);
    const profile = await db.userProfile.findUnique({
      where: { userId: auth.sub },
    });
    return { profile };
  });

  app.put("/api/profile", async (request) => {
    const auth = await requireUser(request);
    const body = profileInputSchema.parse(request.body);
    const { note, ...profileFields } = body;
    const profileData = {
      ...profileFields,
      ...(note === undefined ? {} : { note }),
    };
    const profile = await db.$transaction(async (tx) => {
      const next = await tx.userProfile.upsert({
        where: { userId: auth.sub },
        create: { userId: auth.sub, ...profileData },
        update: profileData,
      });
      await tx.auditLog.create({
        data: {
          action: "profile.upsert",
          targetType: "UserProfile",
          targetId: next.id,
          metadata: { userId: auth.sub, hasNote: note !== undefined },
        },
      });
      return next;
    });
    return { profile };
  });

  if (demoEnabled) {
    app.post("/api/mock/admin-login", async (request) => {
      const body = z
        .object({
          username: z.string().min(2),
          role: z.enum(["OPS", "SUPER_ADMIN"]).default("OPS"),
        })
        .parse(request.body);
      const admin = await db.adminUser.upsert({
        where: { username: body.username },
        update: { role: body.role },
        create: { username: body.username, role: body.role },
      });
      const token = signSession(app, { sub: admin.id, role: admin.role, adminRevision: admin.updatedAt.toISOString() });

      return { token, admin: { id: admin.id, username: admin.username, role: admin.role } };
    });
  }

  app.get("/api/activities", async () => {
    const activities = await db.activity.findMany({
      where: { status: { in: [ActivityStatus.PUBLISHED, ActivityStatus.REGISTRATION_OPEN] } },
      orderBy: { startsAt: "asc" },
      select: publicActivitySelect,
    });

    return { activities };
  });

  app.get("/api/activities/:id", async (request, reply) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const activity = await db.activity.findUnique({
      where: { id: params.id },
      select: publicActivitySelect,
    });
    if (!activity) {
      return reply.code(404).send({ error: "Activity not found" });
    }

    return { activity };
  });

  app.post("/api/ops/restaurants", async (request) => {
    const operator = await requireOps(request);
    const body = restaurantInputSchema.parse(request.body);
    const restaurant = await db.$transaction(async tx => {
      const created = await tx.restaurant.create({ data: body });
      await tx.auditLog.create({ data: { actorId: operator.sub, actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS", action: "restaurant.created", targetType: "Restaurant", targetId: created.id } });
      return created;
    });

    return { restaurant };
  });

  app.put("/api/ops/restaurants/:id", async (request, reply) => {
    const operator = await requireOps(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const body = restaurantInputSchema.parse(request.body);
    const restaurant = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ${id} FOR UPDATE`;
      const current = await tx.restaurant.findUnique({ where: { id } });
      if (!current) return "not_found" as const;
      const scheduled = await tx.activity.count({ where: { restaurantId: id, status: { notIn: [ActivityStatus.DRAFT, ActivityStatus.CANCELED, ActivityStatus.COMPLETED] } } });
      if (scheduled && (body.name !== current.name || body.district !== current.district || body.businessArea !== current.businessArea || body.address !== current.address || body.capacity !== current.capacity)) return "locked" as const;
      await tx.restaurant.update({ where: { id }, data: body });
      await tx.auditLog.create({ data: { actorId: operator.sub, actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS", action: "restaurant.updated", targetType: "Restaurant", targetId: id } });
      return tx.restaurant.findUniqueOrThrow({ where: { id } });
    });
    if (restaurant === "not_found") return reply.code(404).send({ error: "Restaurant not found" });
    if (restaurant === "locked") return reply.code(409).send({ error: "Scheduled activity prevents changing restaurant location or capacity" });
    return { restaurant };
  });

  app.get("/api/ops/restaurants", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const restaurants = await db.restaurant.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return { restaurants: restaurants.slice(0, 50), nextCursor: restaurants.length > 50 ? restaurants[49]!.id : null,
      total: await db.restaurant.count() };
  });

  app.post("/api/ops/activities", async (request, reply) => {
    const operator = await requireOps(request);
    const body = activityInputSchema.parse(request.body);
    assertVisibleCopyAllowed(`${body.title} ${body.theme} ${body.description}`);
    if (new Date(body.registrationEndsAt) <= new Date()) return reply.code(400).send({ error: "Registration deadline must be in the future" });
    if (body.mealFeeIncluded !== false) {
      throw new Error("mealFeeIncluded must be false for MVP service-fee pricing");
    }

    const result = await db.$transaction(async tx => {
      // Serialize direct published/open activities with edits to the same restaurant.
      await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ${body.restaurantId} FOR UPDATE`;
      const restaurant = await tx.restaurant.findUnique({ where: { id: body.restaurantId } });
      if (!restaurant || restaurant.status !== "ACTIVE") return { kind: "invalid_restaurant" as const };
      if (body.capacity > restaurant.capacity) return { kind: "capacity" as const };
      const created = await tx.activity.create({ data: {
        ...body,
        startsAt: new Date(body.startsAt), endsAt: new Date(body.endsAt), registrationEndsAt: new Date(body.registrationEndsAt),
      } });
      await tx.auditLog.create({ data: { actorId: operator.sub, actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS", action: "activity.created", targetType: "Activity", targetId: created.id, metadata: { status: created.status } } });
      return { kind: "created" as const, activity: created };
    });
    if (result.kind === "invalid_restaurant") return reply.code(409).send({ error: "Active restaurant required" });
    if (result.kind === "capacity") return reply.code(400).send({ error: "Activity capacity exceeds restaurant capacity" });
    return { activity: result.activity };
  });

  app.post("/api/ops/activities/:id/publish", async (request, reply) => {
    const operator = await requireOps(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async tx => {
      const locator = await tx.activity.findUnique({ where: { id }, select: { restaurantId: true } });
      if (!locator) return "not_found" as const;
      // Restaurant edits take this same lock before checking scheduled activities.
      await tx.$queryRaw`SELECT id FROM "Restaurant" WHERE id = ${locator.restaurantId} FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id }, include: { restaurant: true } });
      if (!activity) return "not_found" as const;
      if (activity.status !== ActivityStatus.DRAFT) return "invalid_status" as const;
      if (activity.restaurant.status !== "ACTIVE" || activity.registrationEndsAt <= new Date() || activity.capacity > activity.restaurant.capacity) return "invalid_supply" as const;
      assertActivityTransition(toSharedActivityStatus(activity.status), "published");
      const changed = await tx.activity.updateMany({ where: { id, status: ActivityStatus.DRAFT }, data: { status: ActivityStatus.PUBLISHED } });
      if (changed.count !== 1) return "invalid_status" as const;
      await tx.auditLog.create({ data: { actorId: operator.sub, actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS", action: "activity.published", targetType: "Activity", targetId: id } });
      return "published" as const;
    });
    if (result === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result !== "published") return reply.code(409).send({ error: "Activity cannot be published" });
    return { activityStatus: ActivityStatus.PUBLISHED };
  });

  app.post("/api/ops/activities/:id/open-registration", async (request, reply) => {
    const operator = await requireOps(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id }, include: { restaurant: true } });
      if (!activity) return "not_found" as const;
      if (activity.status !== ActivityStatus.PUBLISHED) return "invalid_status" as const;
      if (activity.restaurant.status !== "ACTIVE" || activity.registrationEndsAt <= new Date() || activity.capacity > activity.restaurant.capacity) return "invalid_supply" as const;
      assertActivityTransition(toSharedActivityStatus(activity.status), "registration_open");
      await tx.activity.update({ where: { id }, data: { status: ActivityStatus.REGISTRATION_OPEN } });
      await tx.auditLog.create({ data: { actorId: operator.sub, actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
        action: "activity.registration.opened", targetType: "Activity", targetId: id } });
      return "opened" as const;
    });
    if (result === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result !== "opened") return reply.code(409).send({ error: "Activity registration cannot be opened" });
    return { activityStatus: ActivityStatus.REGISTRATION_OPEN };
  });

  app.get("/api/ops/activities", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const activities = await db.activity.findMany({
      orderBy: [{ startsAt: "asc" }, { id: "asc" }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { restaurant: true },
    });
    const page = activities.slice(0, 50);
    const heldSeats = await db.order.groupBy({ by: ["activityId"], where: { activityId: { in: page.map(activity => activity.id) }, capacityHeld: true }, _count: { _all: true } });
    const heldByActivity = new Map(heldSeats.map(row => [row.activityId, row._count._all]));

    return { activities: page.map(activity => ({ ...activity, heldSeats: heldByActivity.get(activity.id) ?? 0 })), nextCursor: activities.length > 50 ? activities[49]!.id : null,
      total: await db.activity.count() };
  });

  app.post("/api/ops/activities/:id/start", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status === ActivityStatus.IN_PROGRESS) return { kind: "already_started" as const };
      if (activity.status !== ActivityStatus.GROUPED && activity.status !== ActivityStatus.ADDRESS_UNLOCKED) return { kind: "invalid_status" as const };
      if (Date.now() < activity.startsAt.getTime()) return { kind: "too_early" as const };
      assertActivityTransition(toSharedActivityStatus(activity.status), "in_progress");
      await tx.activity.update({ where: { id: activity.id }, data: { status: ActivityStatus.IN_PROGRESS } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "activity.started",
          targetType: "Activity",
          targetId: activity.id,
        },
      });
      return { kind: "started" as const };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "too_early") return reply.code(409).send({ error: "Activity has not started" });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Activity cannot be started in its current status" });
    return { idempotent: result.kind === "already_started", activityStatus: ActivityStatus.IN_PROGRESS };
  });

  app.post("/api/ops/activities/:id/complete", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status === ActivityStatus.COMPLETED) return { kind: "already_completed" as const };
      if (activity.status !== ActivityStatus.IN_PROGRESS) return { kind: "invalid_status" as const };
      if (Date.now() < activity.endsAt.getTime()) return { kind: "too_early" as const };
      const groupedOrders = await tx.order.findMany({ where: { activityId: activity.id, status: OrderStatus.GROUPED }, select: { id: true, status: true } });
      assertActivityTransition(toSharedActivityStatus(activity.status), "completed");
      for (const order of groupedOrders) assertOrderTransition(toSharedOrderStatus(order.status), "completed");
      await tx.order.updateMany({ where: { id: { in: groupedOrders.map((order) => order.id) }, status: OrderStatus.GROUPED }, data: {
        status: OrderStatus.COMPLETED, version: { increment: 1 },
      } });
      await tx.activity.update({ where: { id: activity.id }, data: { status: ActivityStatus.COMPLETED } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "activity.completed",
          targetType: "Activity",
          targetId: activity.id,
          metadata: { completedOrderCount: groupedOrders.length },
        },
      });
      return { kind: "completed" as const, completedOrderCount: groupedOrders.length };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "too_early") return reply.code(409).send({ error: "Activity has not ended" });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Activity cannot be completed in its current status" });
    if (result.kind === "already_completed") return { idempotent: true, activityStatus: ActivityStatus.COMPLETED, completedOrderCount: 0 };
    return { idempotent: false, activityStatus: ActivityStatus.COMPLETED, completedOrderCount: result.completedOrderCount };
  });

  app.get("/api/ops/orders", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const orders = await db.order.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: {
        activity: true,
        user: true,
        receipts: { select: { id: true, amountCents: true } },
        payments: { select: { id: true } },
        refunds: { select: { id: true } },
        refundObligations: { select: { id: true } },
        notifications: { select: { id: true } },
      },
    });
    const page = orders.slice(0, 50);
    const referencesByOrder = new Map(page.map(order => [order.id, [order.id,
      ...order.receipts.map(receipt => receipt.id), ...order.payments.map(payment => payment.id),
      ...order.refunds.map(refund => refund.id), ...order.refundObligations.map(duty => duty.id),
      ...order.notifications.map(notification => notification.id)]]));
    const orderByRef = new Map([...referencesByOrder].flatMap(([orderId, refs]) => refs.map(ref => [ref, orderId] as const)));
    const jobs = await db.durableJob.findMany({ where: { refId: { in: [...orderByRef.keys()] } },
      select: { id: true, refId: true } });
    for (const job of jobs) {
      const orderId = orderByRef.get(job.refId);
      if (orderId) referencesByOrder.get(orderId)?.push(job.id);
    }
    const openCases = await db.financialCase.findMany({ where: { state: "OPEN", sourceRef: { in: [...referencesByOrder.values()].flat() } }, select: { id: true, sourceRef: true } });
    const caseCountByRef = new Map<string, number>();
    for (const issue of openCases) caseCountByRef.set(issue.sourceRef, (caseCountByRef.get(issue.sourceRef) ?? 0) + 1);

    return {
      orders: page.map((order) => ({
        id: order.id,
        amountCents: order.amountCents,
        status: order.status,
        capacityHeld: order.capacityHeld,
        receivedCents: order.receipts.reduce((sum, receipt) => sum + receipt.amountCents, 0),
        receiptCount: order.receipts.length,
        openCaseCount: (referencesByOrder.get(order.id) ?? []).reduce((sum, ref) => sum + (caseCountByRef.get(ref) ?? 0), 0),
        createdAt: order.createdAt,
        activity: {
          id: order.activity.id,
          title: order.activity.title,
          startsAt: order.activity.startsAt,
        },
        user: {
          id: order.user.id,
          phone: maskPhone(order.user.phone),
          status: order.user.status,
        },
      })),
      nextCursor: orders.length > 50 ? orders[49]!.id : null,
      total: await db.order.count(),
    };
  });

  app.get("/api/ops/refunds", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const refunds = await db.refund.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 51,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { order: { include: { activity: true, user: true } } },
    });

    return {
      refunds: refunds.slice(0, 50).map((refund) => ({
        id: refund.id,
        amountCents: refund.amountCents,
        status: refund.status,
        reason: refund.reason,
        requestedBy: refund.requestedBy,
        createdAt: refund.createdAt,
        order: {
          id: refund.order.id,
          status: refund.order.status,
          activityTitle: refund.order.activity.title,
          userPhone: maskPhone(refund.order.user.phone),
        },
      })),
      nextCursor: refunds.length > 50 ? refunds[49]!.id : null,
      total: await db.refund.count(),
    };
  });

  app.get("/api/ops/audit-logs", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const auditLogs = await db.auditLog.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });

    return { auditLogs: auditLogs.slice(0, 100), nextCursor: auditLogs.length > 100 ? auditLogs[99]!.id : null,
      total: await db.auditLog.count() };
  });

  app.get("/api/notifications", async (request) => {
    const auth = await requireUser(request);
    const query = z.object({ cursor: z.string().max(256).optional(), limit: z.coerce.number().int().min(1).max(50).default(20) }).parse(request.query);
    const cursor = query.cursor ? decodeNotificationCursor(query.cursor) : null;
    const notifications = await db.notification.findMany({
      where: { userId: auth.sub, status: "SENT",
        ...(cursor ? { OR: [{ createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } }] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: query.limit + 1,
    });
    const page = notifications.slice(0, query.limit);
    return {
      notifications: page.map((notification) => ({
        id: notification.id,
        type: notification.type,
        status: notification.status,
        payload: notification.payload,
        createdAt: notification.createdAt,
        readAt: notification.readAt,
        orderId: notification.orderId,
        activityId: notification.activityId,
      })),
      nextCursor: notifications.length > query.limit ? encodeNotificationCursor(page.at(-1)!) : null,
    };
  });

  app.post("/api/notifications/:id/read", async (request, reply) => {
    const auth = await requireUser(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const notification = await db.notification.findFirst({ where: { id, userId: auth.sub, status: "SENT" }, select: { id: true } });
    if (!notification) return reply.code(404).send({ error: "Notification not found" });
    await db.notification.updateMany({ where: { id, userId: auth.sub, status: "SENT", readAt: null }, data: { readAt: new Date() } });
    const current = await db.notification.findUniqueOrThrow({ where: { id }, select: { readAt: true } });
    return { id, readAt: current.readAt };
  });

  app.get("/api/ops/reports", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const reports = await db.report.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { order: { include: { activity: true } } },
    });
    return {
      reports: reports.slice(0, 100).map((report) => ({
        id: report.id,
        type: report.type,
        content: report.content,
        status: report.status,
        createdAt: report.createdAt,
        order: { id: report.order.id, status: report.order.status, activityTitle: report.order.activity.title },
      })),
      nextCursor: reports.length > 100 ? reports[99]!.id : null,
      total: await db.report.count(),
    };
  });

  app.get("/api/ops/reviews", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const reviews = await db.review.findMany({
      orderBy: [{ updatedAt: "desc" }, { id: "desc" }],
      take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { order: { include: { activity: true } } },
    });
    return {
      reviews: reviews.slice(0, 100).map((review) => ({
        id: review.id,
        score: review.score,
        tags: review.tags,
        content: review.content,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
        order: { id: review.order.id, activityTitle: review.order.activity.title },
      })),
      nextCursor: reviews.length > 100 ? reviews[99]!.id : null,
      total: await db.review.count(),
    };
  });

  app.get("/api/ops/blacklist", async (request) => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const entries = await db.blacklist.findMany({
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { user: true },
    });
    return {
      entries: entries.slice(0, 100).map((entry) => ({
        id: entry.id,
        userId: entry.userId,
        reason: entry.reason,
        createdAt: entry.createdAt,
        user: { phone: maskPhone(entry.user.phone), status: entry.user.status },
      })),
      nextCursor: entries.length > 100 ? entries[99]!.id : null,
      total: await db.blacklist.count(),
    };
  });

  app.post("/api/ops/blacklist", async (request, reply) => {
    const operator = await requireOps(request);
    const body = z.object({ userId: z.string(), reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async (tx) => {
      const user = await tx.user.findUnique({ where: { id: body.userId } });
      if (!user) return { kind: "not_found" as const };
      const existing = await tx.blacklist.findUnique({ where: { userId: user.id } });
      if (existing) return { kind: "existing" as const, entry: existing };
      const entry = await tx.blacklist.create({ data: { userId: user.id, reason: body.reason } });
      await tx.user.update({ where: { id: user.id }, data: { status: "BLACKLISTED" } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "blacklist.added",
          targetType: "User",
          targetId: user.id,
          reason: body.reason,
        },
      });
      return { kind: "created" as const, entry };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "User not found" });
    return { idempotent: result.kind === "existing", entry: result.entry };
  });

  app.delete("/api/ops/blacklist/:userId", async (request, reply) => {
    const operator = await requireSuperAdmin(request);
    const params = z.object({ userId: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async (tx) => {
      const entry = await tx.blacklist.findUnique({ where: { userId: params.userId } });
      if (!entry) return null;
      await tx.blacklist.delete({ where: { id: entry.id } });
      await tx.user.update({ where: { id: params.userId }, data: { status: "NORMAL" } });
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: "SUPER_ADMIN",
          action: "blacklist.removed",
          targetType: "User",
          targetId: params.userId,
          reason: body.reason,
        },
      });
      return entry;
    });
    if (!result) return reply.code(404).send({ error: "Blacklist entry not found" });
    return { removed: true };
  });

  app.post("/api/ops/reports/:id/resolve", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ status: z.enum(["RESOLVED", "REJECTED"]), reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const report = await db.$transaction(async (tx) => {
      const current = await tx.report.findUnique({ where: { id: params.id } });
      if (!current) return null;
      if (current.status !== ReportStatus.OPEN) return "already_processed" as const;
      const changed = await tx.report.updateMany({ where: { id: current.id, status: ReportStatus.OPEN }, data: { status: body.status } });
      if (changed.count !== 1) return "already_processed" as const;
      await tx.auditLog.create({ data: {
        actorId: operator.sub,
        actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
        action: "report.resolved",
        targetType: "Report",
        targetId: current.id,
        reason: body.reason,
        metadata: { status: body.status },
      } });
      return tx.report.findUniqueOrThrow({ where: { id: current.id } });
    });
    if (report === null) return reply.code(404).send({ error: "Report not found" });
    if (report === "already_processed") return reply.code(409).send({ error: "Report has already been processed" });
    return { report };
  });

  app.get("/api/ops/activities/:id/table-candidates", async (request, reply) => {
    await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const activity = await db.activity.findUnique({
      where: { id: params.id },
      select: { id: true },
    });
    if (!activity) {
      return reply.code(404).send({ error: "Activity not found" });
    }

    const eligibleIds = new Set((await db.$transaction(tx => currentCandidates(tx, activity.id))).map(order => order.id));
    const [orders, tableGroups] = await Promise.all([
      db.order.findMany({
      where: { id: { in: [...eligibleIds] } },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        status: true,
        createdAt: true,
        profileSnapshot: true,
      },
      }),
      db.tableGroup.findMany({
        where: { activityId: activity.id, status: "PENDING_CONFIRMATION" },
        orderBy: { createdAt: "asc" },
        include: { members: { orderBy: { createdAt: "asc" } } },
      }),
    ]);

    return {
      candidates: orders.map((order) => ({
        order: {
          id: order.id,
          status: order.status,
          createdAt: order.createdAt,
        },
        profile: order.profileSnapshot,
      })),
      tableGroups: serializeTableGroups(tableGroups),
    };
  });

  app.post("/api/ops/activities/:id/table-groups/draft", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      return draftFormation(tx, activity, { sub: operator.sub, role: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS" });
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Activity cannot be grouped in its current status" });
    if (result.kind === "not_enough") return reply.code(409).send({
      error: "Not enough paid orders to form valid tables", decision: result.decision,
    });
    if (result.kind === "needs_review") return reply.code(409).send({ error: "Table formation requires policy review", reason: result.reason });
    return { idempotent: result.kind === "existing",
      ...("decision" in result ? { decision: result.decision } : {}),
      tableGroups: serializeTableGroups(result.tableGroups) };
  });

  app.post("/api/ops/activities/:id/table-groups/confirm", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      return confirmFormation(tx, activity, { sub: operator.sub, role: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS" });
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "already_confirmed") return { idempotent: true, activityStatus: ActivityStatus.GROUPED };
    if (result.kind === "missing_draft") return reply.code(409).send({ error: "Table grouping draft is required" });
    if (result.kind === "stale_draft") return reply.code(409).send({ error: "Table grouping draft is stale; rebuild it" });
    if (result.kind === "needs_review") return reply.code(409).send({ error: "Table formation requires policy review", reason: result.reason });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Table grouping cannot be confirmed in its current state" });
    return { idempotent: false, activityStatus: ActivityStatus.GROUPED, notificationQueued: true };
  });

  app.put("/api/ops/activities/:id/table-groups", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      tableGroups: z.array(z.object({ orderIds: z.array(z.string().min(1)).min(1) })).min(1),
    }).parse(request.body);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      return adjustFormation(tx, activity, { sub: operator.sub, role: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS" },
        body.tableGroups.map(group => group.orderIds));
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "needs_review") return reply.code(409).send({ error: "Table formation requires policy review", reason: result.reason });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Table grouping cannot be adjusted in its current state" });
    if (result.kind === "invalid_size") return reply.code(400).send({ error: "Each table must satisfy the activity table-size rules" });
    if (result.kind === "invalid_members") return reply.code(400).send({ error: "Adjusted tables must contain each current candidate exactly once" });
    return { tableGroups: serializeTableGroups(result.tableGroups) };
  });

  app.post("/api/ops/activities/:id/mark-group-failed", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status === ActivityStatus.GROUP_FAILED) return { kind: "already_failed" as const };
      if (activity.status !== ActivityStatus.REGISTRATION_OPEN && activity.status !== ActivityStatus.LOCKING) {
        return { kind: "invalid_activity_status" as const };
      }
      if (Date.now() < activity.registrationEndsAt.getTime()) return { kind: "registration_open" as const };

      const [paidOrders, pendingPaymentCount] = await Promise.all([
        tx.order.findMany({
          where: { activityId: activity.id, status: OrderStatus.PAID_PENDING_GROUP },
          select: { id: true, status: true, userId: true },
        }),
        tx.order.count({ where: { activityId: activity.id, status: OrderStatus.PENDING_PAYMENT } }),
      ]);
      if (pendingPaymentCount > 0) return { kind: "pending_payment" as const };

      const verifiedCandidates = await currentCandidates(tx, activity.id);
      const verifiedIds = new Set(verifiedCandidates.map(candidate => candidate.id));
      for (const order of paidOrders) {
        if (!verifiedIds.has(order.id)) await openCase(tx, "GROUP_FAILURE_FUNDING_UNVERIFIED", order.id, caseOwner);
      }
      const decision = evaluateTableFormation(verifiedCandidates.length, {
        minSize: activity.minSize,
        targetSize: activity.targetSize,
        maxSize: activity.maxSize,
      });
      if (decision.canForm) return { kind: "can_form" as const, decision };

      if (activity.status === ActivityStatus.REGISTRATION_OPEN) {
        assertActivityTransition(toSharedActivityStatus(activity.status), "locking");
      }
      assertActivityTransition("locking", "group_failed");
      for (const order of paidOrders) {
        assertOrderTransition(toSharedOrderStatus(order.status), "group_failed");
      }
      await tx.order.updateMany({
        where: { id: { in: paidOrders.map((order) => order.id) }, status: OrderStatus.PAID_PENDING_GROUP },
        data: { status: OrderStatus.GROUP_FAILED, version: { increment: 1 } },
      });
      await tx.activity.update({ where: { id: activity.id }, data: { status: ActivityStatus.GROUP_FAILED } });
      await tx.tableGroup.updateMany({ where: { activityId: activity.id, status: "PENDING_CONFIRMATION" }, data: { status: "CANCELED" } });
      const refundObligations = await createDecisionRefundDuties(tx, activity.id, caseOwner, "GROUP_FAILED");
      await queueDecisionNotifications(tx, activity, paidOrders, "GROUP_FAILED");
      await tx.auditLog.create({
        data: {
          actorId: operator.sub,
          actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "activity.group_failed",
          targetType: "Activity",
          targetId: activity.id,
          reason: body.reason,
          metadata: { affectedOrderCount: paidOrders.length, refundObligations },
        },
      });
      return { kind: "marked" as const, affectedOrderCount: paidOrders.length, refundObligations };
    });

    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "invalid_activity_status") return reply.code(409).send({ error: "Activity cannot be marked group failed in its current status" });
    if (result.kind === "registration_open") return reply.code(409).send({ error: "Registration has not ended" });
    if (result.kind === "pending_payment") return reply.code(409).send({ error: "Pending payments must be handled before marking group failed" });
    if (result.kind === "can_form") return reply.code(409).send({ error: "Eligible paid orders can still form valid tables", decision: result.decision });
    if (result.kind === "already_failed") return { idempotent: true, activityStatus: ActivityStatus.GROUP_FAILED };
    return { idempotent: false, activityStatus: ActivityStatus.GROUP_FAILED,
      affectedOrderCount: result.affectedOrderCount, refundObligations: result.refundObligations,
      notificationQueued: true };
  });

  app.post("/api/ops/activities/:id/cancel", async (request, reply) => {
    const operator = await requireSuperAdmin(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${params.id} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: params.id } });
      if (!activity) return { kind: "not_found" as const };
      if (activity.status === "CANCELED") return { kind: "already_canceled" as const };
      if (activity.startsAt <= new Date() || ["COMPLETED", "IN_PROGRESS"].includes(activity.status))
        return { kind: "too_late" as const };
      if (await tx.order.count({ where: { activityId: activity.id, status: "PENDING_PAYMENT" } }))
        return { kind: "pending_payment" as const };
      const orders = await tx.order.findMany({ where: { activityId: activity.id,
        status: { in: ["PAID_PENDING_GROUP", "GROUPED", "REFUND_REVIEWING", "REFUNDING"] } },
        orderBy: { id: "asc" }, select: { id: true, userId: true, status: true } });
      for (const order of orders) await tx.$queryRaw`SELECT id FROM "Order" WHERE id = ${order.id} FOR UPDATE`;
      await tx.activity.update({ where: { id: activity.id }, data: { status: "CANCELED" } });
      await tx.tableGroup.updateMany({ where: { activityId: activity.id, status: { in: ["PENDING_CONFIRMATION", "CONFIRMED"] } },
        data: { status: "CANCELED" } });
      await tx.order.updateMany({ where: { id: { in: orders.filter(order =>
        ["PAID_PENDING_GROUP", "GROUPED"].includes(order.status)).map(order => order.id) } },
        data: { status: "REFUNDING", version: { increment: 1 } } });
      const refundObligations = await createDecisionRefundDuties(tx, activity.id, caseOwner, "OPERATOR_CANCELED");
      for (const order of orders) {
        if (await tx.channelReceipt.count({ where: { orderId: order.id } }) === 0) {
          await openCase(tx, "CANCELED_FUNDING_UNVERIFIED", order.id, caseOwner);
        }
      }
      await queueDecisionNotifications(tx, activity, orders, "ACTIVITY_CANCELED");
      await tx.auditLog.create({ data: { actorId: operator.sub, actorRole: "SUPER_ADMIN",
        action: "activity.canceled", targetType: "Activity", targetId: activity.id, reason: body.reason,
        metadata: { affectedOrderCount: orders.length, refundObligations } } });
      return { kind: "canceled" as const, affectedOrderCount: orders.length, refundObligations };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Activity not found" });
    if (result.kind === "too_late") return reply.code(409).send({ error: "Activity has started or completed" });
    if (result.kind === "pending_payment") return reply.code(409).send({ error: "Pending payments require recovery before cancellation" });
    if (result.kind === "already_canceled") return { idempotent: true, activityStatus: "CANCELED" };
    return { idempotent: false, activityStatus: "CANCELED", ...result };
  });

  app.post("/api/orders", async (request, reply) => {
    const auth = await requireUser(request);
    const body = z
      .object({
        activityId: z.string(),
        agreementVersion: z.string().min(1),
      })
      .passthrough()
      .parse(request.body);
    const user = await db.user.findUnique({ where: { id: auth.sub } });

    if (!user || !user.phone) {
      return reply.code(400).send({ error: "Phone binding required" });
    }
    if (user.status === "BLACKLISTED") {
      return reply.code(403).send({ error: "User cannot register" });
    }
    const result = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${body.activityId} FOR UPDATE`;
      const activity = await tx.activity.findUnique({ where: { id: body.activityId } });
      if (!activity || !canCreateOrder(activity.status)) {
        return { error: "Activity is not open for registration", statusCode: 400 as const };
      }
      if (Date.now() >= activity.registrationEndsAt.getTime()) {
        return { error: "Registration has ended", statusCode: 409 as const };
      }

      const existingOrder = await tx.order.findFirst({ where: {
        userId: auth.sub, activityId: body.activityId, registrationActive: true,
      } });
      if (existingOrder) {
        if (existingOrder.status === OrderStatus.PENDING_PAYMENT
          && (!existingOrder.inventoryLockedUntil || existingOrder.inventoryLockedUntil > new Date())) {
          return { order: existingOrder, idempotent: true };
        }
        return { error: "User already registered for this activity", statusCode: 409 as const };
      }

      const policy = await currentAgreement(tx, true);
      if (!policy) return { error: "Current agreement is unavailable", statusCode: 503 as const };
      if (body.agreementVersion !== policy.version) {
        return { error: "Current agreement must be accepted", statusCode: 409 as const };
      }
      const consent = await tx.consentRecord.findFirst({ where: {
        userId: auth.sub, agreementVersion: policy.version, policyHash: policy.textHash,
      }, orderBy: { createdAt: "desc" }, select: { id: true } });
      if (!consent) return { error: "Agreement confirmation required", statusCode: 409 as const };
      const profile = await tx.userProfile.findUnique({ where: { userId: auth.sub } });
      const parsedProfile = profileInputSchema.omit({ note: true }).safeParse(profile);
      if (!parsedProfile.success) return { error: "Profile questionnaire required", statusCode: 409 as const };

      const activeOrderCount = await tx.order.count({
        where: {
          activityId: activity.id,
          capacityHeld: true,
        },
      });
      if (activeOrderCount >= activity.capacity) {
        return { error: "Activity capacity is full", statusCode: 409 as const };
      }

      const order = await tx.order.create({
        data: {
          userId: auth.sub,
          activityId: activity.id,
          amountCents: calculateOrderAmountCents({
            serviceFeeCents: activity.serviceFeeCents,
          }),
          agreementVersion: policy.version,
          consentRecordId: consent.id,
          profileSnapshot: { ...parsedProfile.data, ruleVersion: "l3-v1" },
          inventoryLockedUntil: new Date(Date.now() + 15 * 60 * 1000),
        },
      });
      await scheduleExpiration(tx, order.id, order.inventoryLockedUntil!);
      await tx.auditLog.create({
        data: {
          action: "order.create",
          targetType: "Order",
          targetId: order.id,
          metadata: {
            activityId: activity.id,
            status: order.status,
            amountCents: order.amountCents,
          },
        },
      });
      return { order };
    });

    if ("error" in result && typeof result.statusCode === "number") {
      return reply.code(result.statusCode).send({ error: result.error });
    }

    return { order: result.order, reused: "idempotent" in result && result.idempotent === true };
  });

  app.get("/api/orders", async (request, reply) => {
    const auth = await requireUser(request);
    const { cursor } = z.object({ cursor: z.string().min(1).max(100).optional() }).parse(request.query);
    const anchor = cursor ? await db.order.findFirst({ where: { id: cursor, userId: auth.sub }, select: { id: true, createdAt: true } }) : null;
    if (cursor && !anchor) return reply.code(400).send({ error: "Invalid order cursor" });
    const rows = await db.order.findMany({
      where: { userId: auth.sub, ...(anchor ? { OR: [
        { createdAt: { lt: anchor.createdAt } },
        { createdAt: anchor.createdAt, id: { lt: anchor.id } },
      ] } : {}) },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 21,
      select: { id: true, status: true, amountCents: true, createdAt: true,
        activity: { select: { id: true, title: true, startsAt: true, endsAt: true } } },
    });
    return { orders: rows.slice(0, 20), nextCursor: rows.length > 20 ? rows[19]!.id : null };
  });

  app.get("/api/orders/:id", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const order = await db.order.findUnique({
      where: { id: params.id },
      include: { activity: { include: { restaurant: true } },
        receipts: { select: { id: true } },
        refunds: { orderBy: { createdAt: "desc" }, select: { id: true, status: true, amountCents: true, resolutionState: true, updatedAt: true } },
        payments: { where: { active: true }, select: { id: true, status: true, resolutionState: true } } },
    });
    if (!order || order.userId !== auth.sub) {
      return reply.code(404).send({ error: "Order not found" });
    }

    const confirmedSeat = await db.tableMember.findFirst({ where: { orderId: order.id,
      tableGroup: { activityId: order.activityId, status: "CONFIRMED" } }, select: { id: true } });
    const visibility = confirmedSeat && order.registrationActive && order.capacityHeld
      ? getOrderVisibility(order.status, order.activity.status, order.activity.startsAt) :
        isPaidEffectivePrismaOrder(order.status) ? "basic" : "none";
    const pendingPayments = order.payments.filter(p => !(p.status === "SUCCEEDED" && p.resolutionState === "CONFIRMED"));
    const manualJobs = await db.durableJob.findMany({
      where: { businessKey: { in: [...pendingPayments.map(p => `payment:${p.id}`), ...order.refunds.map(r => `refund:${r.id}`)] }, state: "MANUAL" },
      select: { businessKey: true },
    });
    const manualKeys = new Set(manualJobs.map(job => job.businessKey));
    // Confirmed money can still have an unresolved fulfillment exception.
    const fulfillmentReview = await db.financialCase.findFirst({
      where: { sourceRef: { in: order.receipts.map(receipt => receipt.id) },
        category: { in: ["FULFILLMENT_REQUIRES_REVIEW", "LEGACY_FULFILLMENT_REQUIRES_REVIEW"] },
        state: { not: "RESOLVED" } }, select: { id: true },
    });

    return {
      order: {
        id: order.id,
        amountCents: order.amountCents,
        status: order.status,
        visibility,
        refunds: order.refunds.map(({ resolutionState, ...refund }) => ({ ...refund,
          requiresReview: !(refund.status === "SUCCEEDED" && resolutionState === "CONFIRMED")
            && (resolutionState === "MANUAL" || manualKeys.has(`refund:${refund.id}`)) })),
        paymentState: fulfillmentReview || pendingPayments.some(p => p.resolutionState === "MANUAL" || manualKeys.has(`payment:${p.id}`)) ? "REQUIRES_REVIEW"
          : pendingPayments.some(p => p.resolutionState === "UNKNOWN") ? "PROCESSING" : "NONE",
        canRequestCancel: canRequestCancel(order.status)
          || (order.status === OrderStatus.PENDING_PAYMENT && providers.payment.mode === "mock"),
        activity: {
          id: order.activity.id,
          title: order.activity.title,
          theme: order.activity.theme,
          district: order.activity.district,
          businessArea: order.activity.businessArea,
          startsAt: order.activity.startsAt,
          endsAt: order.activity.endsAt,
          restaurantName:
            visibility === "restaurant" || visibility === "address"
              ? order.activity.restaurant.name
              : null,
          address: visibility === "address" ? order.activity.restaurant.address : null,
        },
      },
    };
  });

  app.post("/api/orders/:id/reports", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ type: z.string().trim().min(1).max(40), content: z.string().trim().min(1).max(1000) }).parse(request.body);
    const order = await db.order.findUnique({ where: { id: params.id }, include: { activity: true } });
    if (!order || order.userId !== auth.sub) return reply.code(404).send({ error: "Order not found" });
    if (Date.now() < order.activity.endsAt.getTime()) return reply.code(409).send({ error: "Report is available after the activity ends" });
    const deadline = order.activity.endsAt.getTime() + 7 * 24 * 60 * 60 * 1000;
    if (Date.now() > deadline) return reply.code(409).send({ error: "Report submission window has ended" });
    const report = await db.report.create({ data: { userId: auth.sub, orderId: order.id, type: body.type, content: body.content } });
    return { report: { id: report.id, type: report.type, status: report.status, createdAt: report.createdAt } };
  });

  app.put("/api/orders/:id/review", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({
      score: z.number().int().min(1).max(5),
      tags: z.array(z.string().trim().min(1).max(40)).max(8),
      content: z.string().trim().min(1).max(1000).optional(),
    }).parse(request.body);
    const order = await db.order.findUnique({ where: { id: params.id }, select: { id: true, userId: true, status: true } });
    if (!order || order.userId !== auth.sub) return reply.code(404).send({ error: "Order not found" });
    if (order.status !== OrderStatus.COMPLETED) return reply.code(409).send({ error: "Review is available after the activity is completed" });
    const review = await db.review.upsert({
      where: { orderId: order.id },
      create: { userId: auth.sub, orderId: order.id, score: body.score, tags: body.tags, content: body.content ?? null },
      update: { score: body.score, tags: body.tags, content: body.content ?? null },
    });
    return {
      review: {
        id: review.id,
        score: review.score,
        tags: review.tags,
        content: review.content,
        createdAt: review.createdAt,
        updatedAt: review.updatedAt,
      },
    };
  });

  app.post("/api/orders/:id/cancel", async (request, reply) => {
    const auth = await requireUser(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(200) }).parse(request.body);
    const order = await db.order.findUnique({
      where: { id: params.id },
      include: { activity: true },
    });
    if (!order || order.userId !== auth.sub) {
      return reply.code(404).send({ error: "Order not found" });
    }
    if (order.status === OrderStatus.PENDING_PAYMENT) {
      const result = await expireOrder(db, order.id, mockChannel, caseOwner, true);
      if (result.kind === "released" || (result.kind === "terminal"
        && (result.order.status === OrderStatus.CLOSED || result.order.status === OrderStatus.CANCELED))) {
        return { order: result.order, pendingPaymentCanceled: true };
      }
      return reply.code(409).send({ error: "Payment result requires review before releasing the order" });
    }
    if (!canRequestCancel(order.status)) {
      return reply.code(400).send({ error: "Order cannot be canceled" });
    }

    const refund = await db.$transaction(async (tx) => {
      const current = await lockOrder(tx, order.id);
      if (!canRequestCancel(current.status)) throw Object.assign(new Error("Order cannot be canceled"), { statusCode: 400 });
      const policy = evaluateRefundDecision({ orderStatus: toSharedOrderStatus(current.status),
        activityStatus: toSharedActivityStatus(current.activity.status), startsAt: current.activity.startsAt,
        now: new Date(), requestedBy: "user" });
      if (policy.action !== "requires_ops_review" || ["CANCELED", "GROUP_FAILED"].includes(current.activity.status))
        throw Object.assign(new Error("Cancellation requires current activity review"), { statusCode: 409 });
      const createdRefund = await tx.refund.create({
        data: {
          orderId: order.id,
          amountCents: order.amountCents,
          reason: body.reason,
          requestedBy: "user",
          status: RefundStatus.REVIEWING,
        },
      });
      await markOrderState(tx, order.id, OrderStatus.REFUND_REVIEWING);
      await tx.auditLog.create({
        data: {
          action: "refund.requested",
          targetType: "Refund",
          targetId: createdRefund.id,
          reason: body.reason,
          metadata: {
            orderId: order.id,
            userId: auth.sub,
            fromOrderStatus: current.status,
            toOrderStatus: OrderStatus.REFUND_REVIEWING,
          },
        },
      });
      return createdRefund;
    });

    return { refund };
  });

  app.post("/api/mock/payments", async (request, reply) => {
    const auth = await requireUser(request);
    const body = z.object({ orderId: z.string() }).passthrough().parse(request.body);
    const order = await db.order.findUnique({
      where: { id: body.orderId },
      include: { user: true },
    });
    if (!order || order.userId !== auth.sub) {
      return reply.code(404).send({ error: "Order not found" });
    }
    if (order.status !== OrderStatus.PENDING_PAYMENT) {
      return reply.code(400).send({ error: "Order is not pending payment" });
    }

    if (providers.payment.mode === "wechat" && !canStartRealPayment(providerEnv, auth.sub, order.amountCents)) {
      return reply.code(403).send({ error: "New payments are disabled or outside the approved scope" });
    }
    if (providers.payment.mode === "wechat" && !(await hasCompleteBillCoverage(db,
      paymentBinding.merchantScope, providerEnv.REQUIRED_BILL_PERIOD!))) {
      return reply.code(503).send({ error: "Required channel bill coverage is incomplete" });
    }

    const intent = await ensurePaymentIntent(db, order.id, auth.sub, paymentBinding);
    const payment = intent.payment;
    if (!intent.created) {
      const gate = await publishPrepay(db, payment.id, payment.version);
      if (!gate.payable) return gate;
      if (!payment.prepayId && providers.payment.mode === "wechat") return recoverPrepay(db, payment.id, providers.payment, caseOwner);
      const paymentParams = payment.prepayId ? providers.payment.resumePayment?.(payment.prepayId) : undefined;
      return publishPrepay(db, payment.id, payment.version, { paymentParams });
    }
    await db.payment.updateMany({ where: { id: payment.id, version: payment.version, resolutionState: "NEW" },
      data: { resolutionState: "UNKNOWN", version: { increment: 1 } } });
    // No transaction is held during channel I/O. A lost response leaves the intent and recovery task intact.
    const providerPayment = await providers.payment.createPayment({
      merchantOrderNo: payment.merchantOrderNo, amountCents: payment.amountCents, openid: order.user.wechatOpenid,
    });
    if (providerPayment.channel !== payment.channel) throw new ProviderUnavailableError("Original payment channel changed");
    return publishPrepay(db, payment.id, payment.version + 1, providerPayment);
  });

  app.get("/api/payments/:id", async request => {
    const user = await requireUser(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const payment = await db.payment.findFirst({ where: { id, order: { userId: user.sub } },
      select: { id: true, orderId: true, status: true, resolutionState: true, amountCents: true } });
    if (!payment) throw Object.assign(new Error("Payment not found"), { statusCode: 404 });
    const recovery = await db.durableJob.findUnique({ where: { businessKey: `payment:${payment.id}` }, select: { state: true } });
    return { payment, recoveryState: recovery?.state ?? "UNAVAILABLE", requiresReview: payment.resolutionState === "MANUAL" || recovery?.state === "MANUAL" };
  });
  app.get("/api/ops/financial-cases", async request => {
    await requireOps(request);
    const { cursor } = z.object({ cursor: z.string().optional() }).parse(request.query);
    const cases = await db.financialCase.findMany({ where: { state: "OPEN" }, orderBy: [{ deadline: "asc" }, { id: "asc" }], take: 101,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    return { cases: cases.slice(0, 100), nextCursor: cases.length > 100 ? cases[99]!.id : null,
      total: await db.financialCase.count({ where: { state: "OPEN" } }) };
  });

  app.get("/api/ops/diagnostics/orders/:id", async (request, reply) => {
    await requireOps(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const order = await db.order.findUnique({ where: { id }, select: { id: true, activityId: true, status: true,
      payments: { select: { id: true, status: true, resolutionState: true } },
      refunds: { select: { id: true, status: true, resolutionState: true } },
      receipts: { select: { id: true, amountCents: true, verifiedAt: true } },
      refundObligations: { select: { id: true, state: true, deadline: true } },
      notifications: { select: { id: true, status: true, readAt: true } } } });
    if (!order) return reply.code(404).send({ error: "Order not found" });
    const refs = [...order.payments.map(row => row.id), ...order.refunds.map(row => row.id),
      ...order.receipts.map(row => row.id), ...order.refundObligations.map(row => row.id),
      ...order.notifications.map(row => row.id), id];
    const jobs = await db.durableJob.findMany({ where: { refId: { in: refs } }, select: { id: true, kind: true, refId: true,
      state: true, attempts: true, errorClass: true, runAt: true } });
    const cases = await db.financialCase.findMany({ where: { sourceRef: { in: [...refs, ...jobs.map(job => job.id)] } },
      select: { id: true, category: true, sourceRef: true, state: true, owner: true, deadline: true } });
    return { order, jobs, cases };
  });

  app.get("/api/ops/diagnostics/queue", async request => {
    await requireOps(request);
    const [states, oldest, bills] = await Promise.all([
      db.durableJob.groupBy({ by: ["state"], _count: { _all: true } }),
      db.durableJob.findFirst({ where: { state: { in: ["READY", "RETRY"] } },
        orderBy: [{ runAt: "asc" }, { id: "asc" }], select: { runAt: true } }),
      db.reconciliationBatch.findMany({ orderBy: { createdAt: "desc" }, take: 20,
        select: { merchantScope: true, period: true, coverageState: true, createdAt: true } }),
    ]);
    return { jobs: Object.fromEntries(states.map(row => [row.state, row._count._all])),
      oldestRunnableAt: oldest?.runAt ?? null, billCoverage: bills };
  });

  app.get("/api/ops/diagnostics/jobs/:id", async (request, reply) => {
    await requireOps(request);
    const { id } = z.object({ id: z.string().min(1) }).parse(request.params);
    const job = await db.durableJob.findUnique({ where: { id }, select: { id: true, kind: true, refId: true,
      state: true, attempts: true, errorClass: true, runAt: true } });
    if (!job) return reply.code(404).send({ error: "Job not found" });
    const notification = job.kind === "DELIVER_INBOX" ? await db.notification.findUnique({ where: { id: job.refId },
      select: { id: true, userId: true, orderId: true, activityId: true, status: true, readAt: true } }) : null;
    return { job, notification };
  });

  app.post("/api/ops/financial-cases/:id/claim", async (request, reply) => {
    const operator = await requireOps(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const result = await db.$transaction(async tx => {
      const issue = await tx.financialCase.findUnique({ where: { id } });
      if (!issue) return "not_found" as const;
      if (caseOwner !== "local-review-required" || issue.state !== "OPEN" || issue.owner !== caseOwner) return "unavailable" as const;
      const changed = await tx.financialCase.updateMany({ where: { id, state: "OPEN", owner: caseOwner }, data: { owner: operator.sub } });
      if (changed.count !== 1) return "unavailable" as const;
      await tx.auditLog.create({ data: { actorId: operator.sub, actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS", action: "funding.case.claim", targetType: "FinancialCase", targetId: id } });
      return "claimed" as const;
    });
    if (result === "not_found") return reply.code(404).send({ error: "Case not found" });
    if (result !== "claimed") return reply.code(409).send({ error: "Case is unavailable for claim" });
    return { claimed: true };
  });

  app.post("/api/ops/financial-cases/:id/resolve", async (request, reply) => {
    const reviewer = await requireSuperAdmin(request);
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const issue = await db.financialCase.findUnique({ where: { id } });
    if (!issue) return reply.code(404).send({ error: "Case not found" });
    if (issue.owner === reviewer.sub) return reply.code(409).send({ error: "Independent case owner and reviewer required" });
    const assignedOwner = await db.adminUser.findUnique({ where: { id: issue.owner }, select: { id: true } });
    if (!assignedOwner) return reply.code(409).send({ error: "Case owner must be a verified administrator" });
    try {
      const resolved = await resolveVerifiedCase(db, { caseId: id, operator: issue.owner, reviewer: reviewer.sub });
      return { case: resolved };
    } catch (error) {
      if (error instanceof Error && /evidence|changed|owner/i.test(error.message)) return reply.code(409).send({ error: error.message });
      throw error;
    }
  });

  if (demoEnabled) {
    app.post("/api/mock/payments/:paymentId/succeed", async (request, reply) => {
      const params = z.object({ paymentId: z.string() }).parse(request.params);
      const payment = await db.payment.findUnique({
        where: { id: params.paymentId },
        include: { order: true },
      });
      if (!payment) {
        return reply.code(404).send({ error: "Payment not found" });
      }
      mockChannel.assertBinding(payment);
      const paymentDecision = canApplyPaymentSuccess(payment.status, payment.order.status);
      if (paymentDecision === "idempotent") {
        return { payment, idempotent: true };
      }
      if (paymentDecision === "reject" && payment.status !== PaymentStatus.PENDING) {
        return reply.code(409).send({ error: "Payment is not pending" });
      }
      if (paymentDecision === "reject") {
        await db.auditLog.create({
          data: {
            action: "payment.callback.rejected",
            targetType: "Payment",
            targetId: payment.id,
            reason: "Order is not pending payment",
            metadata: {
              orderId: payment.orderId,
              orderStatus: payment.order.status,
              paymentStatus: payment.status,
            },
          },
        });
        return reply.code(409).send({ error: "Order is not pending payment" });
      }

      const fact = await mockChannel.pay(payment.merchantOrderNo, payment.amountCents);
      await applyPaymentEvidence(db, { kind: "PAYMENT_SUCCEEDED", channel: "mock", merchantScope: payment.merchantScope,
        merchantOrderNo: payment.merchantOrderNo, channelTradeNo: fact.channelNo, amountCents: fact.amountCents,
        paidAt: fact.createdAt.toISOString(), currency: "CNY", evidenceHash: createHash("sha256").update(fact.id).digest("hex") }, caseOwner);
      const updated = await db.payment.findUniqueOrThrow({ where: { id: payment.id } });
      await db.auditLog.create({ data: { action: "payment.callback.succeeded", targetType: "Payment", targetId: payment.id } });

      return { payment: updated, idempotent: false };
    });
  }

  app.post("/api/ops/refunds/:id/approve", async (request, reply) => {
    const auth = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().min(1).max(200) }).parse(request.body);
    const refund = await db.$transaction(async (tx) => {
      const locator = await tx.refund.findUnique({ where: { id: params.id } });
      if (locator) await lockOrder(tx, locator.orderId);
      const currentRefund = await tx.refund.findUnique({
        where: { id: params.id },
        include: { order: true },
      });
      if (!currentRefund) {
        return { error: "Refund not found", statusCode: 404 as const };
      }
      if (
        !canApproveRefund(currentRefund.status, currentRefund.order.status)
      ) {
        await tx.auditLog.create({
          data: {
            actorId: auth.sub,
            actorRole: auth.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
            action: "refund.approve.rejected",
            targetType: "Refund",
            targetId: currentRefund.id,
            reason: body.reason,
            metadata: {
              orderId: currentRefund.orderId,
              orderStatus: currentRefund.order.status,
              refundStatus: currentRefund.status,
            },
          },
        });
        return { error: "Refund cannot be approved from current state", statusCode: 409 as const };
      }
      const original = await tx.payment.findFirst({ where: { orderId: currentRefund.orderId, active: true, status: "SUCCEEDED" } });
      const receipt = original?.channelTradeNo ? await tx.channelReceipt.findUnique({ where: {
        channel_merchantScope_channelTradeNo: { channel: original.channel, merchantScope: original.merchantScope, channelTradeNo: original.channelTradeNo },
      } }) : null;
      if (!receipt) return { error: "Refund requires a verified original receipt", statusCode: 409 as const };
      const nextRefund = await reserveRefund(tx, currentRefund.id, receipt.id);
      await markOrderState(tx, nextRefund.orderId, OrderStatus.REFUNDING);
      await tx.auditLog.create({
        data: {
          actorId: auth.sub,
          actorRole: auth.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
          action: "refund.approve",
          targetType: "Refund",
          targetId: nextRefund.id,
          reason: body.reason,
        },
      });
      return { refund: nextRefund };
    });

    if ("error" in refund && typeof refund.statusCode === "number") {
      return reply.code(refund.statusCode).send({ error: refund.error });
    }

    return { refund: refund.refund };
  });

  app.post("/api/ops/refunds/:id/reject", async (request, reply) => {
    const operator = await requireOps(request);
    const params = z.object({ id: z.string() }).parse(request.params);
    const body = z.object({ reason: z.string().trim().min(1).max(200) }).parse(request.body);
    const result = await db.$transaction(async tx => {
      const locator = await tx.refund.findUnique({ where: { id: params.id }, select: { orderId: true } });
      if (!locator) return { kind: "not_found" as const };
      const order = await lockOrder(tx, locator.orderId);
      const refund = await tx.refund.findUniqueOrThrow({ where: { id: params.id } });
      if (refund.status !== "REVIEWING" || order.status !== "REFUND_REVIEWING")
        return { kind: "invalid_status" as const };
      if (order.activity.startsAt <= new Date() || ["IN_PROGRESS", "COMPLETED"].includes(order.activity.status))
        return { kind: "requires_review" as const };
      const seat = await tx.tableMember.findFirst({ where: { orderId: order.id,
        tableGroup: { activityId: order.activityId, status: "CONFIRMED" } }, select: { id: true } });
      const funding = await tx.channelReceipt.findFirst({ where: { orderId: order.id, amountCents: order.amountCents,
        payment: { status: "SUCCEEDED", resolutionState: "CONFIRMED" } }, select: { id: true } });
      const competingRefund = funding ? await tx.refund.count({ where: { orderId: order.id, id: { not: refund.id },
        status: { not: "REJECTED" }, OR: [{ receiptId: funding.id }, { receiptId: null }] } }) : 0;
      await tx.refund.update({ where: { id: refund.id }, data: { status: "REJECTED", resolutionState: "REJECTED",
        version: { increment: 1 } } });
      let nextStatus: OrderStatus;
      if (funding && !competingRefund && seat && ["GROUPED", "ADDRESS_UNLOCKED"].includes(order.activity.status))
        nextStatus = OrderStatus.GROUPED;
      else if (funding && !competingRefund && !seat && ["PUBLISHED", "REGISTRATION_OPEN", "LOCKING"].includes(order.activity.status)
        && order.registrationActive && order.capacityHeld)
        nextStatus = OrderStatus.PAID_PENDING_GROUP;
      else {
        nextStatus = OrderStatus.GROUP_FAILED;
        await createDecisionRefundDuties(tx, order.activityId, caseOwner, "REFUND_REJECTED_NO_FULFILLMENT", order.id);
      }
      await markOrderState(tx, order.id, nextStatus);
      await tx.auditLog.create({ data: { actorId: operator.sub,
        actorRole: operator.role === "SUPER_ADMIN" ? "SUPER_ADMIN" : "OPS",
        action: "refund.rejected", targetType: "Refund", targetId: refund.id, reason: body.reason,
        metadata: { orderId: order.id, nextStatus } } });
      return { kind: "rejected" as const, orderStatus: nextStatus };
    });
    if (result.kind === "not_found") return reply.code(404).send({ error: "Refund not found" });
    if (result.kind === "invalid_status") return reply.code(409).send({ error: "Refund cannot be rejected from current state" });
    if (result.kind === "requires_review") return reply.code(409).send({ error: "Current fulfillment requires manual review" });
    return { refundStatus: "REJECTED", orderStatus: result.orderStatus };
  });

  if (demoEnabled) {
    app.post("/api/mock/refunds/:refundId/succeed", async (request, reply) => {
      const params = z.object({ refundId: z.string() }).parse(request.params);
      const refund = await db.refund.findUnique({
        where: { id: params.refundId },
        include: { order: true },
      });
      if (!refund) {
        return reply.code(404).send({ error: "Refund not found" });
      }
      const refundDecision = canApplyRefundCallback(refund.status, refund.order.status);
      if (refundDecision === "idempotent") {
        return { refund, idempotent: true };
      }
      if (refundDecision === "reject") {
        await db.auditLog.create({
          data: {
            action: "refund.callback.rejected",
            targetType: "Refund",
            targetId: refund.id,
            reason: "Refund or order is not refunding",
            metadata: {
              orderId: refund.orderId,
              orderStatus: refund.order.status,
              refundStatus: refund.status,
            },
          },
        });
        return reply.code(409).send({ error: "Refund is not ready for callback" });
      }

      const receipt = refund.receiptId ? await db.channelReceipt.findUnique({ where: { id: refund.receiptId } }) : null;
      if (!receipt) return reply.code(409).send({ error: "Original receipt missing" });
      mockChannel.assertBinding(refund);
      const fact = await mockChannel.refund(refund.merchantRefundNo, receipt.channelTradeNo, refund.amountCents);
      await confirmRefund(db, { merchantRefundNo: refund.merchantRefundNo, channel: "mock", merchantScope: refund.merchantScope,
        originalTradeNo: receipt.channelTradeNo, channelRefundNo: fact.channelNo, amountCents: fact.amountCents }, caseOwner);
      const updated = await db.refund.findUniqueOrThrow({ where: { id: refund.id } });
      await db.auditLog.create({ data: { action: "refund.callback.succeeded", targetType: "Refund", targetId: refund.id } });

      return { refund: updated, idempotent: false };
    });
  }

  if (demoEnabled) {
    app.post("/api/mock/refunds/:refundId/fail", async (request, reply) => {
      const params = z.object({ refundId: z.string() }).parse(request.params);
      const body = z.object({ reason: z.string().min(1).max(200) }).parse(request.body);
      const refund = await db.refund.findUnique({
        where: { id: params.refundId },
        include: { order: true },
      });
      if (!refund) {
        return reply.code(404).send({ error: "Refund not found" });
      }
      mockChannel.assertBinding(refund);
      if (canApplyRefundCallback(refund.status, refund.order.status) !== "apply") {
        return reply.code(409).send({ error: "Refund is not ready for callback" });
      }

      const providerCallback = await providers.refund.applyFailureCallback({
        refundId: refund.id,
        reason: body.reason,
      });

      const updated = await recordRefundFailure(db, refund.id, refund.version, providerCallback.failureReason);

      return { refund: updated };
    });
  }

  app.post("/api/wechat/pay/notify", async (request, reply) => {
    if (providers.payment.mode !== "wechat") {
      return reply.code(404).send({ error: "Not found" });
    }
    const rawBody = callbackBodies.get(request);
    if (!rawBody) return reply.code(400).send({ error: "Missing raw callback body" });
    const callback = verifyPaymentNotification(
      rawBody,
      request.headers,
      options.wechatPayNotificationConfig ?? notificationConfigFromEnv(providerEnv),
    );
    if (v11PaymentNotification) {
      const trigger = await v11PaymentNotification(callback, String(request.headers["wechatpay-serial"]));
      if (trigger.handled) return { code: "SUCCESS", idempotent: trigger.duplicate };
    }
    const saved = await persistTrustedEvent(db, {
      source: "wechat-payment-callback", eventKey: callback.eventId,
      verificationMaterialId: String(request.headers["wechatpay-serial"]),
      evidence: { kind: "PAYMENT_SUCCEEDED", channel: "wechat", merchantScope: bindingFor(providerEnv, "wechat").merchantScope,
        merchantOrderNo: callback.merchantOrderNo, channelTradeNo: callback.channelTradeNo,
        amountCents: callback.amountCents, paidAt: callback.paidAt, currency: "CNY", evidenceHash: createHash("sha256").update(rawBody).digest("hex") },
    }, caseOwner);
    if (saved.conflict) return reply.code(409).send({ error: "Notification event conflict" });
    return { code: "SUCCESS", idempotent: saved.duplicate };
  });

  app.post("/api/wechat/refund/notify", async (request, reply) => {
    if (providers.refund.mode !== "wechat") return reply.code(404).send({ error: "Not found" });
    const rawBody = callbackBodies.get(request);
    if (!rawBody) return reply.code(400).send({ error: "Missing raw callback body" });
    const callback = verifyRefundNotification(rawBody, request.headers,
      options.wechatPayNotificationConfig ?? notificationConfigFromEnv(providerEnv));
    if (v11RefundNotification) {
      const trigger = await v11RefundNotification(callback, String(request.headers["wechatpay-serial"]));
      if (trigger.handled) return { code: "SUCCESS", idempotent: trigger.duplicate };
    }
    const saved = await persistTrustedEvent(db, {
      source: "wechat-refund-callback", eventKey: callback.eventId,
      verificationMaterialId: String(request.headers["wechatpay-serial"]),
      evidence: { kind: "REFUND_SUCCEEDED", channel: "wechat", merchantScope: bindingFor(providerEnv, "wechat").merchantScope,
        merchantRefundNo: callback.merchantRefundNo, channelRefundNo: callback.channelRefundNo,
        originalTradeNo: callback.originalTradeNo, amountCents: callback.amountCents, currency: "CNY",
        evidenceHash: createHash("sha256").update(rawBody).digest("hex") },
    }, caseOwner);
    if (saved.conflict) return reply.code(409).send({ error: "Notification event conflict" });
    return { code: "SUCCESS", idempotent: saved.duplicate };
  });

  return app;
}

function notificationConfigFromEnv(env: ProviderEnv): WechatPayNotificationConfig {
  const apiV3Key = env.WECHAT_PAY_API_V3_KEY;
  const certificatePath = env.WECHAT_PAY_PLATFORM_CERT_PATH;
  if (!apiV3Key || !certificatePath) {
    throw new ProviderConfigError("Missing WeChat Pay notification verification configuration");
  }
  const platformCertificate = readFileSync(certificatePath, "utf8");
  const certificate = new X509Certificate(platformCertificate);
  const now = Date.now();
  if (Date.parse(certificate.validFrom) > now || Date.parse(certificate.validTo) <= now) throw new ProviderConfigError("Platform certificate expired or not yet valid");
  return { apiV3Key, platformCertificate, certificateSerial: certificate.serialNumber,
    expectedMerchantId: env.WECHAT_PAY_MCH_ID ?? "", expectedAppId: env.WECHAT_MINIAPP_APP_ID ?? "" };
}

async function upsertWechatUser(
  db: PrismaClient,
  identity: { openid: string; unionid?: string },
) {
  const update = identity.unionid === undefined ? {} : { wechatUnionid: identity.unionid };
  try {
    return await db.user.upsert({
      where: { wechatOpenid: identity.openid },
      update,
      create: { wechatOpenid: identity.openid, ...update },
    });
  } catch (error) {
    if ((error as { code?: unknown }).code !== "P2002") {
      throw error;
    }

    const existing = await db.user.findUnique({ where: { wechatOpenid: identity.openid } });
    if (existing === null) {
      throw error;
    }
    if (identity.unionid === undefined || existing.wechatUnionid === identity.unionid) {
      return existing;
    }
    return db.user.update({ where: { id: existing.id }, data: update });
  }
}

const publicActivitySelect = {
  id: true,
  title: true,
  theme: true,
  description: true,
  district: true,
  businessArea: true,
  startsAt: true,
  endsAt: true,
  registrationEndsAt: true,
  serviceFeeCents: true,
  mealFeeIncluded: true,
  mealFeePolicyText: true,
  status: true,
} as const;

const restaurantInputSchema = z.object({
  name: z.string().min(1),
  district: z.string().min(1),
  businessArea: z.string().min(1),
  address: z.string().min(1),
  contactName: z.string().min(1),
  contactPhone: phoneSchema,
  budgetCents: z.number().int().positive(),
  cuisineTags: z.array(z.string()).default([]),
  capacity: z.number().int().min(4),
});

const activityInputSchema = z.object({
  restaurantId: z.string(),
  title: z.string().min(1),
  theme: z.string().min(1),
  description: z.string().min(1),
  district: z.string().min(1),
  businessArea: z.string().min(1),
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  registrationEndsAt: z.string().datetime(),
  serviceFeeCents: z.number().int().positive(),
  mealFeeIncluded: z.literal(false),
  mealFeePolicyText: z.string().min(1),
  minSize: z.number().int().min(4).default(4),
  targetSize: z.number().int().min(4).max(8).default(6),
  maxSize: z.number().int().min(4).max(8).default(8),
  capacity: z.number().int().min(4),
  status: z.enum(["DRAFT", "PUBLISHED", "REGISTRATION_OPEN"]).default("DRAFT"),
}).superRefine((activity, context) => {
  if (!(Date.parse(activity.registrationEndsAt) <= Date.parse(activity.startsAt) && Date.parse(activity.startsAt) < Date.parse(activity.endsAt))) {
    context.addIssue({ code: "custom", path: ["startsAt"], message: "Registration deadline, start and end must be ordered" });
  }
  if (!(activity.minSize <= activity.targetSize && activity.targetSize <= activity.maxSize && activity.maxSize <= activity.capacity)) {
    context.addIssue({ code: "custom", path: ["capacity"], message: "Group sizes must fit activity capacity" });
  }
});

const profileInputSchema = z.object({
  preferredAreas: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  availableTimes: z.array(z.string().trim().min(1).max(40)).min(1).max(8),
  tastePreferences: z.array(z.string().trim().min(1).max(40)).max(12).default([]),
  dietaryRestrictions: z.array(z.string().trim().min(1).max(80)).min(1).max(8),
  budgetRange: z.string().trim().min(1).max(40),
  tableVibe: z.string().trim().min(1).max(80),
  acceptableTableSizes: z.array(z.number().int().min(4).max(8)).min(1).max(5),
  note: z.string().trim().min(1).max(500).optional(),
});

function toSharedActivityStatus(status: ActivityStatus): SharedActivityStatus {
  return status.toLowerCase() as SharedActivityStatus;
}

function toSharedOrderStatus(status: OrderStatus): SharedOrderStatus {
  return status.toLowerCase() as SharedOrderStatus;
}

function serializeTableGroups(
  tableGroups: Array<{ id: string; status: string; members: Array<{ orderId: string }> }>,
) {
  return tableGroups.map((tableGroup) => ({
    id: tableGroup.id,
    status: tableGroup.status,
    orderIds: tableGroup.members.map((member) => member.orderId),
  }));
}

function maskPhone(phone: string | null): string | null {
  if (!phone) {
    return null;
  }

  if (phone.length <= 6) {
    return "***";
  }

  return `${phone.slice(0, 3)}****${phone.slice(-4)}`;
}

function getOrderVisibility(
  orderStatus: OrderStatus,
  activityStatus: ActivityStatus,
  startsAt: Date,
): "none" | "basic" | "restaurant" | "address" {
  if (!isPaidEffectivePrismaOrder(orderStatus)) {
    return "none";
  }
  if (!isGroupedOrLaterActivity(activityStatus)) {
    return "basic";
  }

  const unlockAt = startsAt.getTime() - 24 * 60 * 60 * 1000;
  return Date.now() >= unlockAt ? "address" : "restaurant";
}

function canCreateOrder(status: ActivityStatus): boolean {
  return (
    status === ActivityStatus.PUBLISHED ||
    status === ActivityStatus.REGISTRATION_OPEN
  );
}

function canApplyPaymentSuccess(
  paymentStatus: PaymentStatus,
  orderStatus: OrderStatus,
): "apply" | "idempotent" | "reject" {
  if (paymentStatus === PaymentStatus.SUCCEEDED) {
    return "idempotent";
  }
  if (
    paymentStatus === PaymentStatus.PENDING &&
    orderStatus === OrderStatus.PENDING_PAYMENT
  ) {
    return "apply";
  }
  return "reject";
}

function canRequestCancel(status: OrderStatus): boolean {
  return (
    status === OrderStatus.PAID_PENDING_GROUP || status === OrderStatus.GROUPED
  );
}

function canApproveRefund(
  refundStatus: RefundStatus,
  orderStatus: OrderStatus,
): boolean {
  const refundIsReviewable =
    refundStatus === RefundStatus.REVIEWING ||
    refundStatus === RefundStatus.FAILED;
  const orderIsReviewable =
    orderStatus === OrderStatus.REFUND_REVIEWING ||
    orderStatus === OrderStatus.REFUND_REQUESTED;
  return refundIsReviewable && orderIsReviewable;
}

function canApplyRefundCallback(
  refundStatus: RefundStatus,
  orderStatus: OrderStatus,
): "apply" | "idempotent" | "reject" {
  if (
    refundStatus === RefundStatus.SUCCEEDED &&
    orderStatus === OrderStatus.REFUNDED
  ) {
    return "idempotent";
  }
  if (
    refundStatus === RefundStatus.REFUNDING &&
    orderStatus === OrderStatus.REFUNDING
  ) {
    return "apply";
  }
  return "reject";
}

function isPaidEffectivePrismaOrder(status: OrderStatus): boolean {
  return (
    status === OrderStatus.PAID_PENDING_GROUP ||
    status === OrderStatus.GROUPED ||
    status === OrderStatus.COMPLETED
  );
}

function isGroupedOrLaterActivity(status: ActivityStatus): boolean {
  return (
    status === ActivityStatus.GROUPED ||
    status === ActivityStatus.ADDRESS_UNLOCKED ||
    status === ActivityStatus.IN_PROGRESS ||
    status === ActivityStatus.COMPLETED
  );
}

function encodeNotificationCursor(row: { createdAt: Date; id: string }): string {
  return Buffer.from(JSON.stringify([row.createdAt.toISOString(), row.id])).toString("base64url");
}

function decodeNotificationCursor(value: string): { createdAt: Date; id: string } {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
    const pair = z.tuple([z.string().datetime(), z.string().min(1)]).parse(parsed);
    return { createdAt: new Date(pair[0]), id: pair[1] };
  } catch {
    throw Object.assign(new Error("Invalid notification cursor"), { statusCode: 400 });
  }
}
