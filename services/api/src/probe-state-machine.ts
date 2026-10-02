import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "./generated/prisma/client.js";
import {
  ActivityStatus,
  OrderStatus,
  type RefundStatus,
} from "./generated/prisma/client.js";
import { buildApp } from "./app.js";
import { agreementHash } from "./orders/agreement.js";

const connectionString =
  process.env.DATABASE_URL ??
  "postgresql://timeleft:timeleft_dev_password@localhost:5432/timeleft_shanghai?schema=public";

const runId = `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
const agreementVersion = `${runId}_agreement`;
const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString }),
});

type HttpMethod = "GET" | "POST" | "PUT";

interface ProbeContext {
  baseUrl: string;
  adminToken: string;
}

async function main(): Promise<void> {
  await cleanupProbeData();
  const agreementText = "仅用于本地状态机探针的协议文本";
  await prisma.agreementPolicy.create({ data: { version: agreementVersion, text: agreementText,
    textHash: agreementHash(agreementText), source: "isolated-state-machine-probe",
    active: true, activatedAt: new Date("2026-01-01T00:00:00.000Z") } });
  const app = await buildApp({ prisma, providerEnv: { NODE_ENV: "test", APP_ENV: "local", LOCAL_DEMO_ENABLED: "true" } });

  try {
    await app.listen({ port: 0, host: "127.0.0.1" });
    const address = app.server.address();
    if (!address || typeof address === "string") {
      throw new Error("Failed to resolve probe API server address");
    }
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const adminToken = await loginAdmin(baseUrl, "ops");
    const context: ProbeContext = { baseUrl, adminToken };

    await probeExpiredRegistration(context);
    await probeCapacityLimit(context);
    await probeDuplicateRegistration(context);
    await probeRefundCallbackRequiresApproval(context);
    await probeRefundedOrderCannotBeApprovedAgain(context);
    await probePaymentCallbackCannotReviveProtectedOrders(context);
    await probeAuditLogExists(context);

    console.log("state-machine probe passed");
  } finally {
    await app.close();
    await cleanupProbeData();
    await prisma.$disconnect();
  }
}

async function probeExpiredRegistration(context: ProbeContext): Promise<void> {
  const activityId = await createActivity(context);
  await prisma.activity.update({ where: { id: activityId }, data: {
    registrationEndsAt: new Date(Date.now() - 60 * 60 * 1000),
  } });
  const userToken = await loginBoundUser(context.baseUrl, "expired", "13500200001");
  const response = await request(context.baseUrl, "POST", "/api/orders", userToken, {
    activityId,
    agreementVersion,
  });
  assertStatus("expired registration rejects order creation", response.status, 409);
}

async function probeCapacityLimit(context: ProbeContext): Promise<void> {
  const activityId = await createActivity(context, { capacity: 4, targetSize: 4, maxSize: 4 });
  for (let index = 0; index < 4; index += 1) {
    const userToken = await loginBoundUser(
      context.baseUrl,
      `capacity_${index}`,
      `1350020010${index}`,
    );
    const response = await createOrder(context.baseUrl, userToken, activityId);
    assertStatus(`capacity order ${index + 1} succeeds`, response.status, 200);
  }
  const overflowUserToken = await loginBoundUser(
    context.baseUrl,
    "capacity_overflow",
    "13500200199",
  );
  const overflow = await createOrder(context.baseUrl, overflowUserToken, activityId);
  assertStatus("capacity overflow rejects fifth order", overflow.status, 409);
}

async function probeDuplicateRegistration(context: ProbeContext): Promise<void> {
  const activityId = await createActivity(context);
  const userToken = await loginBoundUser(context.baseUrl, "duplicate", "13500200201");
  const first = await createOrder(context.baseUrl, userToken, activityId);
  assertStatus("first duplicate probe order succeeds", first.status, 200);
  const duplicate = await createOrder(context.baseUrl, userToken, activityId);
  assertStatus("duplicate pending registration reuses the first order", duplicate.status, 200);
  const firstBody = await first.json() as { order: { id: string } };
  const duplicateBody = await duplicate.json() as { order: { id: string }; reused: boolean };
  if (!duplicateBody.reused || duplicateBody.order.id !== firstBody.order.id) {
    throw new Error("Duplicate registration created or returned a different order");
  }
}

async function probeRefundCallbackRequiresApproval(context: ProbeContext): Promise<void> {
  const { userToken, orderId } = await createPaidOrder(context, "refund_early", "13500200301");
  const cancel = await request(
    context.baseUrl,
    "POST",
    `/api/orders/${orderId}/cancel`,
    userToken,
    { reason: "探针取消" },
  );
  assertStatus("cancel request enters refund review", cancel.status, 200);
  const refund = (await cancel.json()).refund as { id: string; status: RefundStatus };

  const earlyCallback = await request(
    context.baseUrl,
    "POST",
    `/api/mock/refunds/${refund.id}/succeed`,
  );
  assertStatus("unapproved refund callback rejects", earlyCallback.status, 409);
}

async function probeRefundedOrderCannotBeApprovedAgain(
  context: ProbeContext,
): Promise<void> {
  const { userToken, orderId } = await createPaidOrder(
    context,
    "refund_regression",
    "13500200401",
  );
  const cancel = await request(
    context.baseUrl,
    "POST",
    `/api/orders/${orderId}/cancel`,
    userToken,
    { reason: "探针取消后退款" },
  );
  assertStatus("cancel before refund approval succeeds", cancel.status, 200);
  const refund = (await cancel.json()).refund as { id: string };
  const approve = await approveRefund(context, refund.id);
  assertStatus("refund approval succeeds", approve.status, 200);
  const callback = await request(
    context.baseUrl,
    "POST",
    `/api/mock/refunds/${refund.id}/succeed`,
  );
  assertStatus("approved refund callback succeeds", callback.status, 200);
  const approveAgain = await approveRefund(context, refund.id);
  assertStatus("refunded order cannot be approved again", approveAgain.status, 409);
}

async function probePaymentCallbackCannotReviveProtectedOrders(
  context: ProbeContext,
): Promise<void> {
  for (const status of [
    OrderStatus.CANCELED,
    OrderStatus.REFUNDING,
    OrderStatus.REFUNDED,
  ]) {
    const { orderId, paymentId } = await createPendingOrderWithPayment(
      context,
      `payment_${status.toLowerCase()}`,
      nextPhone(),
    );
    await prisma.order.update({
      where: { id: orderId },
      data: { status },
    });

    const callback = await request(
      context.baseUrl,
      "POST",
      `/api/mock/payments/${paymentId}/succeed`,
    );
    assertStatus(`payment callback rejects ${status} order`, callback.status, 409);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId } });
    if (order.status !== status) {
      throw new Error(`Payment callback changed ${status} order to ${order.status}`);
    }
  }
}

async function probeAuditLogExists(context: ProbeContext): Promise<void> {
  const response = await request(
    context.baseUrl,
    "GET",
    "/api/ops/audit-logs",
    context.adminToken,
  );
  assertStatus("audit log endpoint is available", response.status, 200);
  const payload = (await response.json()) as {
    auditLogs: Array<{ action: string }>;
  };
  for (const action of [
    "order.create",
    "payment.callback.rejected",
    "refund.callback.rejected",
    "refund.approve.rejected",
  ]) {
    if (!payload.auditLogs.some((auditLog) => auditLog.action === action)) {
      throw new Error(`Missing expected audit log action: ${action}`);
    }
  }
}

async function createPaidOrder(
  context: ProbeContext,
  code: string,
  phone: string,
): Promise<{ userToken: string; orderId: string }> {
  const { userToken, orderId, paymentId } = await createPendingOrderWithPayment(
    context,
    code,
    phone,
  );
  const callback = await request(
    context.baseUrl,
    "POST",
    `/api/mock/payments/${paymentId}/succeed`,
  );
  assertStatus("payment success callback succeeds", callback.status, 200);
  return { userToken, orderId };
}

async function createPendingOrderWithPayment(
  context: ProbeContext,
  code: string,
  phone: string,
): Promise<{ userToken: string; orderId: string; paymentId: string }> {
  const activityId = await createActivity(context);
  const userToken = await loginBoundUser(context.baseUrl, code, phone);
  const orderResponse = await createOrder(context.baseUrl, userToken, activityId);
  assertStatus("pending order creation succeeds", orderResponse.status, 200);
  const order = (await orderResponse.json()).order as { id: string };
  const paymentResponse = await request(
    context.baseUrl,
    "POST",
    "/api/mock/payments",
    userToken,
    { orderId: order.id },
  );
  assertStatus("mock payment creation succeeds", paymentResponse.status, 200);
  const payment = (await paymentResponse.json()).payment as { id: string };
  return { userToken, orderId: order.id, paymentId: payment.id };
}

async function approveRefund(context: ProbeContext, refundId: string): Promise<Response> {
  return request(
    context.baseUrl,
    "POST",
    `/api/ops/refunds/${refundId}/approve`,
    context.adminToken,
    { reason: "探针运营审核" },
  );
}

async function createOrder(
  baseUrl: string,
  userToken: string,
  activityId: string,
): Promise<Response> {
  return request(baseUrl, "POST", "/api/orders", userToken, {
    activityId,
    agreementVersion,
    amountCents: 1,
  });
}

async function createActivity(
  context: ProbeContext,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const startsAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
  const endsAt = new Date(startsAt.getTime() + 2 * 60 * 60 * 1000);
  const registrationEndsAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
  const restaurantId = await createRestaurant(context);
  const response = await request(
    context.baseUrl,
    "POST",
    "/api/ops/activities",
    context.adminToken,
    {
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
      status: ActivityStatus.REGISTRATION_OPEN,
      ...overrides,
    },
  );
  assertStatus("activity creation succeeds", response.status, 200);
  return (await response.json()).activity.id as string;
}

async function createRestaurant(context: ProbeContext): Promise<string> {
  const response = await request(
    context.baseUrl,
    "POST",
    "/api/ops/restaurants",
    context.adminToken,
    {
      name: scoped("梧桐小馆"),
      district: "徐汇",
      businessArea: "衡山路",
      address: "衡山路 100 号",
      contactName: "运营联系人",
      contactPhone: "13500200000",
      budgetCents: 18800,
      cuisineTags: ["本帮菜"],
      capacity: 12,
    },
  );
  assertStatus("restaurant creation succeeds", response.status, 200);
  return (await response.json()).restaurant.id as string;
}

async function loginAdmin(baseUrl: string, username: string): Promise<string> {
  const response = await request(baseUrl, "POST", "/api/mock/admin-login", undefined, {
    username: scoped(username),
    role: "OPS",
  });
  assertStatus("admin login succeeds", response.status, 200);
  return (await response.json()).token as string;
}

async function loginBoundUser(
  baseUrl: string,
  code: string,
  phone: string,
): Promise<string> {
  const login = await request(baseUrl, "POST", "/api/mock/wechat-login", undefined, {
    code: scoped(code),
  });
  assertStatus("user login succeeds", login.status, 200);
  const token = (await login.json()).token as string;
  const bind = await request(baseUrl, "POST", "/api/mock/phone", token, { phone });
  assertStatus("phone bind succeeds", bind.status, 200);
  const consent = await request(baseUrl, "POST", "/api/consents", token, {
    agreementVersion,
    source: "state-machine-probe",
  });
  assertStatus("agreement confirmation succeeds", consent.status, 200);
  const profile = await request(baseUrl, "PUT", "/api/profile", token, {
    preferredAreas: ["徐汇"], availableTimes: ["周六晚"], tastePreferences: [],
    dietaryRestrictions: ["无"], budgetRange: "150-250", tableVibe: "轻松聊天",
    acceptableTableSizes: [4, 5, 6, 7, 8],
  });
  assertStatus("questionnaire submission succeeds", profile.status, 200);
  return token;
}

async function request(
  baseUrl: string,
  method: HttpMethod,
  path: string,
  token?: string,
  payload?: unknown,
): Promise<Response> {
  const init: RequestInit = {
    method,
    headers: {
      ...(payload === undefined ? {} : { "content-type": "application/json" }),
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
  };
  if (payload !== undefined) {
    init.body = JSON.stringify(payload);
  }
  return fetch(`${baseUrl}${path}`, init);
}

function assertStatus(label: string, actual: number, expected: number): void {
  if (actual !== expected) {
    throw new Error(`${label}: expected HTTP ${expected}, got ${actual}`);
  }
}

async function cleanupProbeData(): Promise<void> {
  const [users, admins, restaurants] = await Promise.all([
    prisma.user.findMany({
      where: { wechatOpenid: { startsWith: `mock_openid_${runId}_` } },
      select: { id: true },
    }),
    prisma.adminUser.findMany({
      where: { username: { startsWith: `${runId}_` } },
      select: { id: true },
    }),
    prisma.restaurant.findMany({
      where: { name: { startsWith: `${runId}_` } },
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
        { title: { startsWith: `${runId}_` } },
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
  const targetIds = [
    ...orderIds,
    ...paymentIds,
    ...refundIds,
    ...activityIds,
    ...restaurantIds,
    ...tableGroupIds,
  ];

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
  const duties = await prisma.refundObligation.findMany({ where: { orderId: { in: orderIds } }, select: { id: true } });
  await prisma.durableJob.deleteMany({ where: { refId: { in: [...paymentIds, ...refundIds, ...duties.map(d => d.id)] } } });
  await prisma.refundObligation.deleteMany({ where: { orderId: { in: orderIds } } });
  const receipts = await prisma.channelReceipt.findMany({ where: { orderId: { in: orderIds } }, select: { id: true, channelTradeNo: true } });
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
  await prisma.agreementPolicy.deleteMany({ where: { version: agreementVersion } });
}

let phoneCounter = 400;

function nextPhone(): string {
  phoneCounter += 1;
  return `1350021${phoneCounter.toString().padStart(4, "0")}`;
}

function scoped(value: string): string {
  return `${runId}_${value}`;
}

void main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
