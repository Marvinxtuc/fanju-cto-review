const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? (import.meta.env.DEV ? "http://localhost:3000" : "");

export interface OpsRestaurant {
  id: string;
  name: string;
  district: string;
  businessArea: string;
  capacity: number;
  address: string;
  contactName: string;
  contactPhone: string;
  budgetCents: number;
  cuisineTags: string[];
}

export type RestaurantInput = Omit<OpsRestaurant, "id">;
export interface ActivityInput {
  restaurantId: string; title: string; theme: string; description: string;
  district: string; businessArea: string; startsAt: string; endsAt: string;
  registrationEndsAt: string; serviceFeeCents: number; mealFeeIncluded: false;
  mealFeePolicyText: string; minSize: number; targetSize: number; maxSize: number;
  capacity: number; status: "DRAFT";
}

export interface OpsActivity {
  id: string;
  title: string;
  status: string;
  startsAt: string;
  endsAt: string;
  registrationEndsAt: string;
  minSize: number;
  serviceFeeCents: number;
  capacity: number;
  heldSeats: number;
}

export interface OpsTableCandidate {
  order: { id: string; status: string; createdAt: string };
  profile: {
    preferredAreas: string[];
    availableTimes: string[];
    tastePreferences: string[];
    dietaryRestrictions: string[];
    budgetRange: string;
    tableVibe: string;
    acceptableTableSizes: number[];
  } | null;
}

export interface OpsTableGroup {
  id: string;
  status: string;
  orderIds: string[];
}

export interface OpsOrder {
  id: string;
  amountCents: number;
  status: string;
  capacityHeld: boolean;
  receivedCents: number;
  receiptCount: number;
  openCaseCount: number;
  activity: { title: string };
  user: { phone: string | null };
}

export interface OpsRefund {
  id: string;
  amountCents: number;
  status: string;
  reason: string;
  order: { id: string; status: string; activityTitle: string; userPhone: string | null };
}

export interface OpsAuditLog {
  id: string;
  action: string;
  targetType: string;
  targetId: string;
  reason: string | null;
  createdAt: string;
}

export interface OpsFinancialCase {
  id: string; category: string; sourceRef: string; owner: string; deadline: string; state: string;
}

export interface OpsReport {
  id: string;
  type: string;
  content: string;
  status: "OPEN" | "RESOLVED" | "REJECTED";
  createdAt: string;
  order: { id: string; status: string; activityTitle: string };
}

export interface OpsReview {
  id: string;
  score: number;
  tags: string[];
  content: string | null;
  createdAt: string;
  updatedAt: string;
  order: { id: string; activityTitle: string };
}

export interface OpsBlacklistEntry {
  id: string;
  userId: string;
  reason: string;
  createdAt: string;
  user: { phone: string | null; status: string };
}

export interface OpsData {
  restaurants: OpsRestaurant[];
  activities: OpsActivity[];
  orders: OpsOrder[];
  refunds: OpsRefund[];
  reports: OpsReport[];
  reviews: OpsReview[];
  blacklist: OpsBlacklistEntry[];
  auditLogs: OpsAuditLog[];
  financialCases: OpsFinancialCase[];
}

export class SessionExpiredError extends Error {}

export type OpsRole = "OPS" | "SUPER_ADMIN";
export interface OpsLogin { token: string; admin: { role: OpsRole } }

export async function loginOps(username: string, password: string): Promise<OpsLogin> {
  return apiRequest<OpsLogin>("/api/ops/login", {
    method: "POST", body: JSON.stringify({ username, password }),
  });
}

export async function loginDemoOps(): Promise<OpsLogin> {
  if (!import.meta.env.DEV || import.meta.env.VITE_DEMO_MODE !== "true") throw new Error("演示登录未启用");
  return apiRequest<OpsLogin>("/api/mock/admin-login", {
    method: "POST", body: JSON.stringify({ username: "ops-demo", role: "OPS" }),
  });
}

export async function loadOpsData(token: string): Promise<OpsData> {
  const [restaurants, activities, orders, refunds, reports, reviews, blacklist, auditLogs, financialCases] = await Promise.all([
    loadAllPages<OpsRestaurant>("/api/ops/restaurants", "restaurants", token),
    loadAllPages<OpsActivity>("/api/ops/activities", "activities", token),
    loadAllPages<OpsOrder>("/api/ops/orders", "orders", token),
    loadAllPages<OpsRefund>("/api/ops/refunds", "refunds", token),
    loadAllPages<OpsReport>("/api/ops/reports", "reports", token),
    loadAllPages<OpsReview>("/api/ops/reviews", "reviews", token),
    loadAllPages<OpsBlacklistEntry>("/api/ops/blacklist", "entries", token),
    loadAllPages<OpsAuditLog>("/api/ops/audit-logs", "auditLogs", token),
    loadAllPages<OpsFinancialCase>("/api/ops/financial-cases", "cases", token),
  ]);

  return {
    restaurants,
    activities,
    orders,
    refunds,
    reports,
    reviews,
    blacklist,
    auditLogs,
    financialCases,
  };
}

async function loadAllPages<T>(path: string, field: string, token: string): Promise<T[]> {
  const rows: T[] = [];
  let cursor: string | null = null;
  const seen = new Set<string>();
  do {
    const url: string = cursor ? `${path}?cursor=${encodeURIComponent(cursor)}` : path;
    const page: Record<string, unknown> = await apiRequest<Record<string, unknown>>(url, authOptions(token));
    const batch = page[field];
    if (!Array.isArray(batch)) throw new Error("后台分页结果格式错误");
    rows.push(...batch as T[]);
    cursor = typeof page.nextCursor === "string" ? page.nextCursor : null;
    if (cursor && seen.has(cursor)) throw new Error("后台分页游标重复");
    if (cursor) seen.add(cursor);
  } while (cursor);
  return rows;
}

export async function claimFinancialCase(token: string, id: string): Promise<void> {
  await apiRequest(`/api/ops/financial-cases/${id}/claim`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

export async function resolveFinancialCase(token: string, id: string): Promise<void> {
  await apiRequest(`/api/ops/financial-cases/${id}/resolve`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

export async function saveRestaurant(token: string, input: RestaurantInput, id?: string): Promise<void> {
  await apiRequest(id ? `/api/ops/restaurants/${id}` : "/api/ops/restaurants", {
    method: id ? "PUT" : "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input),
  });
}

export async function createActivity(token: string, input: ActivityInput): Promise<void> {
  await apiRequest("/api/ops/activities", { method: "POST", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify(input) });
}

export async function publishActivity(token: string, id: string): Promise<void> {
  await apiRequest(`/api/ops/activities/${id}/publish`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

export async function openActivityRegistration(token: string, id: string): Promise<void> {
  await apiRequest(`/api/ops/activities/${id}/open-registration`, { method: "POST", headers: { authorization: `Bearer ${token}` } });
}

export async function addBlacklistEntry(token: string, userId: string, reason: string): Promise<{ idempotent: boolean }> {
  return apiRequest("/api/ops/blacklist", {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ userId, reason }),
  });
}

export async function removeBlacklistEntry(token: string, userId: string, reason: string): Promise<void> {
  await apiRequest(`/api/ops/blacklist/${userId}`, { method: "DELETE", headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ reason }) });
}

export async function approveRefund(token: string, refundId: string): Promise<void> {
  await apiRequest(`/api/ops/refunds/${refundId}/approve`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ reason: "运营快速审核通过" }),
  });
}

export async function rejectRefund(token: string, refundId: string, reason: string): Promise<void> {
  await apiRequest(`/api/ops/refunds/${refundId}/reject`, { method: "POST",
    headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ reason }) });
}

export async function cancelActivity(token: string, activityId: string, reason: string): Promise<void> {
  await apiRequest(`/api/ops/activities/${activityId}/cancel`, { method: "POST",
    headers: { authorization: `Bearer ${token}` }, body: JSON.stringify({ reason }) });
}

export async function resolveReport(token: string, reportId: string, status: "RESOLVED" | "REJECTED", reason: string): Promise<void> {
  await apiRequest(`/api/ops/reports/${reportId}/resolve`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ status, reason }),
  });
}

export async function loadTableCandidates(token: string, activityId: string): Promise<{ candidates: OpsTableCandidate[]; tableGroups: OpsTableGroup[] }> {
  return apiRequest<{ candidates: OpsTableCandidate[]; tableGroups: OpsTableGroup[] }>(
    `/api/ops/activities/${activityId}/table-candidates`,
    authOptions(token),
  );
}

export async function draftTableGroups(
  token: string,
  activityId: string,
): Promise<{ idempotent: boolean; tableGroups: OpsTableGroup[] }> {
  return apiRequest(`/api/ops/activities/${activityId}/table-groups/draft`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function confirmTableGroups(
  token: string,
  activityId: string,
): Promise<{ idempotent: boolean; activityStatus: string }> {
  return apiRequest(`/api/ops/activities/${activityId}/table-groups/confirm`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function adjustTableGroups(
  token: string,
  activityId: string,
  tableGroups: Array<{ orderIds: string[] }>,
): Promise<{ tableGroups: OpsTableGroup[] }> {
  return apiRequest(`/api/ops/activities/${activityId}/table-groups`, {
    method: "PUT",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ tableGroups }),
  });
}

export async function markGroupFailed(token: string, activityId: string, reason: string): Promise<{ idempotent: boolean; activityStatus: string; affectedOrderCount?: number }> {
  return apiRequest(`/api/ops/activities/${activityId}/mark-group-failed`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  });
}

export async function startActivity(token: string, activityId: string): Promise<{ idempotent: boolean; activityStatus: string }> {
  return apiRequest(`/api/ops/activities/${activityId}/start`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

export async function completeActivity(token: string, activityId: string): Promise<{ idempotent: boolean; activityStatus: string; completedOrderCount: number }> {
  return apiRequest(`/api/ops/activities/${activityId}/complete`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
}

function authOptions(token: string): RequestInit {
  return { headers: { authorization: `Bearer ${token}` } };
}

async function apiRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      ...(options.headers ?? {}),
      ...(options.body === undefined ? {} : { "content-type": "application/json" }),
    },
  });
  const data = (await response.json().catch(() => ({}))) as { error?: string; issues?: Array<{ path?: Array<string | number>; message?: string }> };
  if (response.status === 401) {
    const authorization = new Headers(options.headers).get("authorization");
    if (authorization) window.dispatchEvent(new CustomEvent("fanju-session-expired", { detail: { authorization } }));
    else throw new Error("账号或密码错误");
    throw new SessionExpiredError("登录已失效，请重新登录后继续");
  }
  if (!response.ok) {
    const firstIssue = data.issues?.[0];
    throw new Error(firstIssue ? `${firstIssue.path?.join(".") ?? "字段"}：${firstIssue.message ?? "输入不符合要求"}` : data.error ?? `API 请求失败：${response.status}`);
  }
  return data as T;
}
