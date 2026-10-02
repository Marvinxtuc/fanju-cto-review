/** Versioned transport for the isolated local acceptance workspace. No auto-login. */
export const PRELAUNCH_API_VERSION = "prelaunch-v11-1";
export const PRELAUNCH_API_PREFIX = "/api/prelaunch/v11";
export interface PrelaunchSession { token: string; actor: { id: string; role: string }; }
export interface PrelaunchSessionStore {
  read(): PrelaunchSession | null;
  write(session: PrelaunchSession): void;
  clear(): void;
}
export interface PrelaunchHttpResult { status: number; data: unknown; }
export type PrelaunchTransport = (request: { path: string; method: "GET" | "POST" | "PUT"; token?: string; data?: unknown }) => Promise<PrelaunchHttpResult>;
export class PrelaunchClientError extends Error {
  constructor(readonly code: string, readonly blockers: readonly string[] = []) { super(prelaunchErrorLabel(code, blockers)); }
}
const LABELS: Readonly<Record<string, string>> = {
  BLOCKED_POLICY: "相关规则尚待确认，申请及资金事实会保留",
  INVALID_INPUT: "请检查填写内容",
  FORBIDDEN: "当前账号无权执行这项操作",
  RESOURCE_NOT_FOUND: "记录不存在或当前账号无权查看",
  SESSION_EXPIRED: "登录已失效，请重新登录",
  INCOMPATIBLE_VERSION: "客户端版本不兼容，请更新后重试",
  SESSION_CHANGED: "登录账号已改变，请重新加载",
  NETWORK_UNAVAILABLE: "网络暂时不可用，已保存的订单可稍后找回",
  INTERNAL_ERROR: "服务暂时不可用，请稍后重试",
};
export function prelaunchErrorLabel(code: string, blockers: readonly string[] = []): string {
  const refs = blockers.filter(id => /^(?:B-)?(?:OP|RV)-\d{2}$/.test(id));
  return `${LABELS[code] ?? "当前操作未完成，请刷新查看进度"}${refs.length ? `（${refs.join("、")}）` : ""}`;
}
function record(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
export function createPrelaunchClient(transport: PrelaunchTransport, store: PrelaunchSessionStore) {
  async function call<T>(method: "GET" | "POST" | "PUT", path: string, data?: unknown, authenticated = true): Promise<T> {
    if (!/^\/[a-zA-Z0-9_/?=&.:%-]*$/.test(path) || path.includes("..") || path.startsWith("//")) throw new PrelaunchClientError("INVALID_INPUT");
    const session = store.read();
    if (authenticated && !session) throw new PrelaunchClientError("SESSION_EXPIRED");
    let result: PrelaunchHttpResult;
    try { result = await transport({ path: PRELAUNCH_API_PREFIX + path, method, ...(authenticated && session ? { token: session.token } : {}), ...(data === undefined ? {} : { data }) }); }
    catch { throw new PrelaunchClientError("NETWORK_UNAVAILABLE"); }
    if (authenticated && store.read()?.token !== session?.token) throw new PrelaunchClientError("SESSION_CHANGED");
    if (result.status === 401) { if (store.read()?.token === session?.token) store.clear(); throw new PrelaunchClientError("SESSION_EXPIRED"); }
    if (!record(result.data) || result.data.version !== PRELAUNCH_API_VERSION) throw new PrelaunchClientError("INCOMPATIBLE_VERSION");
    if (result.status < 200 || result.status >= 300) {
      const error = record(result.data.error) ? result.data.error : {};
      const code = typeof error.code === "string" && /^[A-Z0-9_]{1,80}$/.test(error.code) ? error.code : "INTERNAL_ERROR";
      const blockers = Array.isArray(error.blockerIds) ? error.blockerIds.filter((id): id is string => typeof id === "string" && /^(?:B-)?(?:OP|RV)-\d{2}$/.test(id)) : [];
      throw new PrelaunchClientError(code, blockers);
    }
    return result.data as T;
  }
  return {
    call,
    async list<T>(path: string, field: string, authenticated = true): Promise<T[]> {
      const initialToken = authenticated ? store.read()?.token : undefined;
      const assertSession = () => { if (authenticated && store.read()?.token !== initialToken) throw new PrelaunchClientError("SESSION_CHANGED"); };
      const all:T[] = []; const seen = new Set<string>(); let cursor:string|null = null;
      do {
        assertSession();
        const page:Record<string,unknown> = await call<Record<string,unknown>>("GET", `${path}${cursor ? `${path.includes("?") ? "&" : "?"}cursor=${encodeURIComponent(cursor)}` : ""}`, undefined, authenticated);
        assertSession();
        if (!Array.isArray(page[field])) throw new PrelaunchClientError("INCOMPATIBLE_VERSION");
        all.push(...page[field] as T[]);
        const next:unknown = page.nextCursor;
        if (next != null && (typeof next !== "string" || !next || seen.has(next))) throw new PrelaunchClientError("INCOMPATIBLE_VERSION");
        cursor = typeof next === "string" ? next : null; if (cursor) seen.add(cursor);
      } while (cursor);
      return all;
    },
    async login(actorId: string, password: string) {
      const response = await call<{ version: string; token: string; actor: { id: string; role: string } }>("POST", "/auth/login", { actorId, password }, false);
      if (typeof response.token !== "string" || !response.token || !record(response.actor) || typeof response.actor.id !== "string" || typeof response.actor.role !== "string") throw new PrelaunchClientError("INCOMPATIBLE_VERSION");
      const session = { token: response.token, actor: response.actor }; store.write(session); return session;
    },
    logout() { store.clear(); },
    session() { return store.read(); },
  };
}
export interface PrelaunchDocument { documentId: string; version: string; fullHash: string; publicHash: string; publicText: string; }
export interface PrelaunchPolicy { policyId: string; bundleVersion: string; status: string; activation: "NOT_ACTIVATABLE"; documents: PrelaunchDocument[]; }
export interface PrelaunchRegistrationView {
  id: string; state: string; category?: string; F: number; D: number; total: number;
  holdExpiresAt?: string | null; table?: { state: string; restaurantName?: string | null; address?: string | null } | null;
  blockerIds?: string[]; refunds?: Array<{ id: string; state: string; F?: number; D?: number }>;
}
export function fundingLabel(F: number, D: number): string {
  return `服务费 ¥${(F / 100).toFixed(2)} · 保证金 ¥${(D / 100).toFixed(2)} · 合计 ¥${((F + D) / 100).toFixed(2)}，餐费到店自理`;
}

export function prelaunchShanghaiDate(value: string | null | undefined): string {
  if (!value) return "暂无";
  const at = new Date(value); if (!Number.isFinite(at.getTime())) return "时间待核实";
  return new Intl.DateTimeFormat("zh-CN", {timeZone:"Asia/Shanghai",year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).format(at) + "（上海时间）";
}
