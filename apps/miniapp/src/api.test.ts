import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ storage: new Map<string, string>(), request: vi.fn(), login: vi.fn(), requestPayment: vi.fn() }));
vi.mock("@tarojs/taro", () => ({ default: {
  getStorageSync: (key: string) => mock.storage.get(key),
  setStorageSync: (key: string, value: string) => mock.storage.set(key, value),
  removeStorageSync: (key: string) => mock.storage.delete(key),
  request: mock.request, login: mock.login, requestPayment: mock.requestPayment,
} }));
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); mock.storage.clear();
  vi.stubGlobal("__FANJU_API_BASE_URL__", "https://api.example.invalid");
  vi.stubGlobal("__FANJU_DEMO_MODE__", false);
});
describe("client identity and payment boundaries", () => {
  it("sends a JSON object for bodyless payment confirmation and notification-read actions", async () => {
    vi.stubGlobal("__FANJU_DEMO_MODE__", true);
    mock.storage.set("fanju_session_v2", "session");
    mock.request.mockImplementation(async options => {
      if (options.method === "POST" && options.data === undefined) {
        return { statusCode: 400, data: { error: "Body cannot be empty when content-type is set to 'application/json'" } };
      }
      return { statusCode: 200, data: options.url.endsWith("/api/mock/payments")
        ? { payment: { id: "payment", channel: "mock" }, payable: true } : {} };
    });
    const api = await import("./api");
    await api.continueOrderPayment("order");
    await api.markNotificationRead("notification");
    const actions = mock.request.mock.calls.map(call => call[0]).filter(options =>
      options.url.endsWith("/succeed") || options.url.endsWith("/read"));
    expect(actions).toHaveLength(2);
    expect(actions.every(options => options.data && JSON.stringify(options.data) === "{}")).toBe(true);
  });
  it("keeps a new session when an older request returns a late 401", async () => {
    mock.storage.set("fanju_session_v2", "old-session");
    let finish!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const api = await import("./api");
    const pending = api.confirmAgreement("v1");
    mock.storage.set("fanju_session_v2", "new-session");
    finish({ statusCode: 401, data: {} });
    await expect(pending).rejects.toThrow("登录已失效");
    expect(mock.storage.get("fanju_session_v2")).toBe("new-session");
    expect(mock.request).toHaveBeenCalledOnce();
  });
  it("uses WeChat login on cold start and never silently binds a mock phone", async () => {
    mock.login.mockResolvedValue({ code: "one-time-code" });
    mock.request.mockResolvedValue({ statusCode: 200, data: { token: "session" } });
    const api = await import("./api");
    expect(await api.ensureAuthenticatedUser()).toBe("session");
    expect(mock.login).toHaveBeenCalledOnce();
    expect(mock.request).toHaveBeenCalledOnce();
    expect(mock.request.mock.calls[0]![0].data).toEqual({ code: "one-time-code" });
    await expect(api.ensureMockUser()).rejects.toThrow("不支持演示登录");
  });
  it("does not manufacture an identity when WeChat authorization fails", async () => {
    mock.login.mockRejectedValue(new Error("denied"));
    const api = await import("./api");
    await expect(api.ensureAuthenticatedUser()).rejects.toThrow("denied");
    expect(mock.request).not.toHaveBeenCalled();
    expect(mock.storage.size).toBe(0);
  });
  it("keeps the created order but never simulates payment when real params are absent", async () => {
    mock.storage.set("fanju_session_v2", "session");
    mock.request.mockResolvedValueOnce({ statusCode: 200, data: { order: { id: "order-one" } } })
      .mockResolvedValueOnce({ statusCode: 200, data: { payment: { id: "payment-one" } } });
    const api = await import("./api");
    await expect(api.createAndPayOrder("activity-one", "v1")).rejects.toThrow("无法发起支付");
    expect(mock.request).toHaveBeenCalledTimes(2);
    expect(mock.requestPayment).not.toHaveBeenCalled();
    expect(mock.storage.get("timeleft_last_order_id")).toBe("order-one");
  });
  it("clears a rejected session but retains pending order context without replay", async () => {
    mock.storage.set("fanju_session_v2", "old-session");
    mock.storage.set("timeleft_last_order_id", "pending-order");
    mock.request.mockResolvedValue({ statusCode: 401, data: {} });
    const api = await import("./api");
    await expect(api.confirmAgreement("v1")).rejects.toThrow("登录已失效");
    expect(api.hasAuthenticatedSession()).toBe(false);
    expect(mock.storage.get("timeleft_last_order_id")).toBe("pending-order");
    expect(mock.request).toHaveBeenCalledOnce();
  });
});

describe("order recovery", () => {
  it("finds a server order after local order cache is cleared and honors an explicit ID", async () => {
    mock.storage.set("fanju_session_v2", "session");
    mock.request.mockResolvedValueOnce({ statusCode: 200, data: { orders: [{ id: "server-order" }], nextCursor: null } })
      .mockResolvedValueOnce({ statusCode: 200, data: { order: { id: "server-order" } } });
    const api = await import("./api");
    expect((await api.getLastOrder()).id).toBe("server-order");
    expect(mock.request.mock.calls[0]![0].url).toBe("https://api.example.invalid/api/orders");
    mock.storage.set("timeleft_last_order_id", "cached-other-order");
    mock.request.mockResolvedValueOnce({ statusCode: 200, data: { order: { id: "route-order" } } });
    expect((await api.getOrder("route-order")).id).toBe("route-order");
    expect(mock.request.mock.calls[2]![0].url).toBe("https://api.example.invalid/api/orders/route-order");
  });
  it("rejects a late successful private response after account change", async () => {
    mock.storage.set("fanju_session_v2", "old-session");
    let finish!: (value: unknown) => void;
    mock.request.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const api = await import("./api");
    const pending = api.getOrder("old-order");
    await vi.waitFor(() => expect(mock.request).toHaveBeenCalledOnce());
    mock.storage.set("fanju_session_v2", "new-session");
    finish({ statusCode: 200, data: { order: { id: "old-order" } } });
    await expect(pending).rejects.toThrow("登录状态已改变");
  });
  it.each([{ requiresReview: true }, { processing: true }, { payable: false }])("does not invoke a cashier or simulate success when blocked: %o", async flags => {
    vi.stubGlobal("__FANJU_DEMO_MODE__", true);
    mock.storage.set("fanju_session_v2", "session");
    mock.request.mockResolvedValue({ statusCode: 200, data: { payment: { id: "p", channel: "mock" }, ...flags } });
    const api = await import("./api");
    await api.continueOrderPayment("order");
    expect(mock.request).toHaveBeenCalledOnce(); expect(mock.requestPayment).not.toHaveBeenCalled();
  });
  it("preserves the pending order when the cashier is canceled and can retry that order", async () => {
    mock.storage.set("fanju_session_v2", "session");
    mock.request.mockResolvedValueOnce({ statusCode: 200, data: { order: { id: "pending" } } })
      .mockResolvedValue({ statusCode: 200, data: { payment: { id: "p", channel: "wechat" }, payable: true, paymentParams: { package: "prepay_id=synthetic" } } });
    mock.requestPayment.mockRejectedValueOnce(new Error("cancel"));
    const api = await import("./api");
    await expect(api.createAndPayOrder("activity", "v1")).rejects.toThrow("cancel");
    expect(mock.storage.get("timeleft_last_order_id")).toBe("pending");
    mock.requestPayment.mockResolvedValueOnce({});
    expect(await api.continueOrderPayment("pending")).toContain("以刷新后的订单状态为准");
    expect(mock.request.mock.calls[2]![0].data).toEqual({ orderId: "pending" });
    expect(mock.request.mock.calls.filter(call => call[0].url.endsWith("/api/orders"))).toHaveLength(1);
  });
});

it("shares one login between parallel order and notification requests", async () => {
  mock.login.mockResolvedValue({ code: "one-time-code" });
  mock.request.mockImplementation(async options => ({ statusCode: 200, data:
    options.url.endsWith("/wechat-login") ? { token: "session" }
      : options.url.endsWith("/notifications") ? { notifications: [] } : { order: { id: "order" } } }));
  const api = await import("./api");
  await Promise.all([api.getOrder("order"), api.getNotifications()]);
  expect(mock.login).toHaveBeenCalledOnce();
  expect(mock.request.mock.calls.filter(call => call[0].url.endsWith("/wechat-login"))).toHaveLength(1);
});

it("never simulates a WeChat payment even in a demo build", async () => {
  vi.stubGlobal("__FANJU_DEMO_MODE__", true);
  mock.storage.set("fanju_session_v2", "session");
  mock.request.mockResolvedValue({ statusCode: 200, data: { payment: { id: "p", channel: "wechat" }, payable: true } });
  const api = await import("./api");
  await expect(api.continueOrderPayment("order")).rejects.toThrow("无法发起支付");
  expect(mock.request).toHaveBeenCalledOnce(); expect(mock.requestPayment).not.toHaveBeenCalled();
});

it("keeps order details available during a notification outage", async () => {
  mock.storage.set("fanju_session_v2", "session");
  mock.request.mockImplementation(async options => options.url.endsWith("/notifications")
    ? { statusCode: 503, data: {} } : { statusCode: 200, data: { order: { id: "order" } } });
  const api = await import("./api");
  expect(await api.getOrderPage("order")).toEqual({ order: { id: "order" }, notifications: [], notificationUnavailable: true });
});

it("discards an already loaded order if the parallel notification request expires the session", async () => {
  mock.storage.set("fanju_session_v2", "session");
  let finish!: (value: unknown) => void;
  mock.request.mockImplementation(options => options.url.endsWith("/notifications")
    ? new Promise(resolve => { finish = resolve; }) : Promise.resolve({ statusCode: 200, data: { order: { id: "order" } } }));
  const api = await import("./api");
  const pending = api.getOrderPage("order");
  await vi.waitFor(() => expect(mock.request).toHaveBeenCalledTimes(2));
  finish({ statusCode: 401, data: {} });
  await expect(pending).rejects.toThrow("登录状态已改变");
});

describe('formal money client',()=>{
 it('refuses disabled capabilities without initialization or money requests',async()=>{
  mock.storage.set('fanju_session_v2','formal-session');mock.request.mockResolvedValue({statusCode:200,data:{version:'v11-identity-1',identityEnabled:true,financialRecordsEnabled:false,refundIntakeEnabled:false}});
  const api=await import('./api');await expect(api.openMoneySession()).rejects.toThrow('暂不可用');expect(mock.request).toHaveBeenCalledOnce();
 });
 it('uses the current session for formal routes and never sends refund amount or user hints',async()=>{
  mock.storage.set('fanju_session_v2','formal-session');mock.request.mockResolvedValue({statusCode:200,data:{}});const api=await import('./api');
  await api.listMoneyRegistrations('formal-session','cursor-a');await api.submitFormalRefund('formal-session','reg-a','stable-key');await api.getFormalRefund('formal-session','request-a');
  expect(mock.request.mock.calls.map(call=>new URL(call[0].url).pathname)).toEqual(['/api/v11/money-registrations','/api/v11/registrations/reg-a/refund-requests','/api/v11/refund-requests/request-a']);
  expect(mock.request.mock.calls[1]![0].data).toEqual({idempotencyKey:'stable-key'});expect(mock.request.mock.calls.every(call=>call[0].header.authorization==='Bearer formal-session')).toBe(true);expect(mock.requestPayment).not.toHaveBeenCalled();
 });
 it('formats structured financial conflicts without rendering internal objects',async()=>{
  mock.storage.set('fanju_session_v2','formal-session');mock.request.mockResolvedValue({statusCode:503,data:{error:{code:'FUNDS_DATA_CONFLICT'}}});const api=await import('./api');await expect(api.getFormalFunds('formal-session','reg-a')).rejects.toThrow('记录正在核对');
 });
});

describe('formal order lifecycle metadata validation',()=>{
 const base={id:'registration',activityId:'activity',supplyId:'supply',policyId:'policy',title:'菜单体验',state:'FORMAL',category:'ORDINARY',F:100,D:200,total:300,acceptedAt:'2026-10-01T00:00:00Z',holdExpiresAt:null,restaurantName:null,address:null,refunds:[],requests:[]};
 async function read(change:Record<string,unknown>){mock.storage.set('fanju_session_v2','current');mock.request.mockImplementation(async options=>({statusCode:200,data:options.url.endsWith('/capabilities')?{version:'v11-identity-1',identityEnabled:true}:options.url.endsWith('/initialize')?{version:'v11-identity-1',principal:{id:'actor',userId:'user',personId:'person',role:'USER',version:1,restaurantId:null}}:{registration:{...base,...change}}}));const api=await import('./api');return api.formalRequest('/api/v11/formal/registrations/registration');}
 it('accepts actual lifecycle metadata without inventing delivery proof',async()=>{await expect(read({tableState:'INVALIDATED',cancelAcceptedAt:'2026-10-02T00:00:00Z',queueOrdinal:'9',notices:[{id:'notice',kind:'TABLE_INVALIDATE',state:'CREATED',receivedAt:null}],fulfillment:{restaurantResult:'NORMAL',confirmedAt:'2026-10-02T00:00:00Z'}})).resolves.toBeDefined();});
 const review={id:'review',state:'AWAITING_FULFILLMENT_RIGHTS_REVIEW',originalRequestAcceptedAt:'2026-10-02T00:00:00Z',reviewOwner:'ops-owner',membershipEnded:false,cancellationAccepted:false};
 it('accepts an independently projected own responsibility review',async()=>{await expect(read({responsibilityReviews:[review]})).resolves.toBeDefined();});
 it.each([{membershipEnded:undefined},{membershipEnded:true},{cancellationAccepted:undefined},{cancellationAccepted:true},{reviewOwner:null},{originalRequestAcceptedAt:'never'}])('rejects incomplete or contradictory responsibility review %j',async change=>{await expect(read({responsibilityReviews:[{...review,...change}]})).rejects.toThrow('报名记录资料不完整');});
 it.each([{tableState:'INVALID'},{cancelAcceptedAt:'never'},{queueOrdinal:-1},{queueOrdinal:'0'},{notices:{}},{notices:[{id:'notice',kind:'TABLE',state:'CREATED',receivedAt:'never'}]},{fulfillment:{restaurantResult:'BREACH',confirmedAt:null}}])('rejects malformed lifecycle metadata %j',async change=>{await expect(read(change)).rejects.toThrow('报名记录资料不完整');});
});


it('keeps ordinary, non-cancel categories and separate users in independent durable request keys',async()=>{
 mock.storage.set('fanju_session_v2','current');let userId='user-a';mock.request.mockImplementation(async options=>({statusCode:200,data:options.url.endsWith('/capabilities')?{version:'v11-identity-1',identityEnabled:true}:{version:'v11-identity-1',principal:{id:'actor',userId,personId:'person',role:'USER',version:1,restaurantId:null}}}));const api=await import('./api');const ordinary=await api.formalRefundRequestKey('reg');const keys=[ordinary];for(const c of ['CONSULTATION','EVIDENCE','DISPUTE','APPEAL'] as const){const key=await api.formalRefundRequestKey('reg',c);keys.push(key);expect(await api.formalRefundRequestKey('reg',c)).toBe(key);}expect(new Set(keys).size).toBe(5);expect(await api.formalRefundRequestKey('reg','ORDINARY_CANCEL')).toBe(ordinary);userId='user-b';expect(await api.formalRefundRequestKey('reg')).not.toBe(ordinary);
});

describe('formal restart requires original-channel no-money proof',()=>{
 const base={id:'registration',activityId:'activity',supplyId:'supply',policyId:'policy',title:'菜单体验',state:'ENDED',category:'ORDINARY',F:100,D:200,total:300,acceptedAt:'2026-10-01T00:00:00Z',holdExpiresAt:null,restaurantName:null,address:null,refunds:[],requests:[]};
 async function restart(proof:unknown){mock.storage.set('fanju_session_v2','current');mock.storage.set('fanju_formal_signup_v1:user:activity:supply:FORMAL','old-key');mock.request.mockImplementation(async options=>({statusCode:200,data:options.url.endsWith('/capabilities')?{version:'v11-identity-1',identityEnabled:true}:options.url.endsWith('/initialize')?{version:'v11-identity-1',principal:{id:'actor',userId:'user',personId:'person',role:'USER',version:1,restaurantId:null}}:{registration:{...base,...(proof===undefined?{}:{rejoinSafety:proof})}}}));const api=await import('./api');return api.beginNewFormalAttempt(base);}
 it.each([undefined,{state:'BLOCKED_POLICY',blockerIds:['OP-08'],proofKind:null,eventIds:[]},{state:'NO_MONEY_CHANNEL_CLOSED',blockerIds:[],proofKind:'VERIFIED_ORIGINAL_CHANNEL_CLOSURE',eventIds:[]}])('preserves original signup key for absent or insufficient proof',async proof=>{await expect(restart(proof)).rejects.toThrow('原报名或退款仍在处理');expect(mock.storage.get('fanju_formal_signup_v1:user:activity:supply:FORMAL')).toBe('old-key');});
 it('clears an old attempt only for explicit verified no-money closure',async()=>{await expect(restart({state:'NO_MONEY_CHANNEL_CLOSED',blockerIds:[],proofKind:'VERIFIED_ORIGINAL_CHANNEL_CLOSURE',eventIds:['event']})).resolves.toBe('activity');expect(mock.storage.has('fanju_formal_signup_v1:user:activity:supply:FORMAL')).toBe(false);});
});

 it('keeps supplement keys independent for each original request without rewriting the stored parent key',async()=>{mock.storage.set('fanju_session_v2','current');mock.request.mockImplementation(async options=>({statusCode:200,data:options.url.endsWith('/capabilities')?{version:'v11-identity-1',identityEnabled:true}:{version:'v11-identity-1',principal:{id:'actor',userId:'user',personId:'person',role:'USER',version:1,restaurantId:null}}}));const api=await import('./api');const a=await api.formalRefundRequestKey('reg','EVIDENCE','request-a'),b=await api.formalRefundRequestKey('reg','EVIDENCE','request-b'),unlinked=await api.formalRefundRequestKey('reg','EVIDENCE');expect(new Set([a,b,unlinked]).size).toBe(3);expect(await api.formalRefundRequestKey('reg','EVIDENCE','request-a')).toBe(a);});
