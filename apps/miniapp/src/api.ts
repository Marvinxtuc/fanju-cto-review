import Taro from "@tarojs/taro";

declare const __FANJU_API_BASE_URL__: string;
declare const __FANJU_DEMO_MODE__: boolean;
declare const __FANJU_FORMAL_BUSINESS__: boolean;

export const demoModeEnabled = __FANJU_DEMO_MODE__;
export const formalBusinessEnabled=typeof __FANJU_FORMAL_BUSINESS__!=='undefined'&&__FANJU_FORMAL_BUSINESS__;

const API_BASE_URL = __FANJU_API_BASE_URL__;
const TOKEN_KEY = "fanju_session_v2";
const LAST_ORDER_ID_KEY = "timeleft_last_order_id";
let pendingLogin: Promise<string> | undefined;

export interface ActivitySummary {
  id: string;
  title: string;
  theme: string;
  district: string;
  businessArea: string;
  startsAt: string;
  serviceFeeCents: number;
  status: string;
}

export interface OrderDetail {
  id: string;
  amountCents: number;
  status: string;
  visibility: string;
  paymentState: "NONE" | "PROCESSING" | "REQUIRES_REVIEW";
  canRequestCancel: boolean;
  refunds: Array<{ id: string; status: string; amountCents: number; updatedAt: string; requiresReview: boolean }>;
  activity: {
    id: string;
    title: string;
    theme: string;
    district: string;
    businessArea: string;
    startsAt: string;
    endsAt: string;
    restaurantName: string | null;
    address: string | null;
  };
}

export interface SubmittedReport {
  id: string;
  type: string;
  status: "OPEN" | "RESOLVED" | "REJECTED";
  createdAt: string;
}

export interface SubmittedReview {
  id: string;
  score: number;
  tags: string[];
  content: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface InboxNotification {
  id: string;
  type: string;
  status: string;
  payload: { title?: string; message?: string } | null;
  createdAt: string;
  readAt: string | null;
  orderId: string | null;
  activityId: string | null;
}

export interface UserProfile {
  id: string;
  preferredAreas: string[];
  availableTimes: string[];
  tastePreferences: string[];
  dietaryRestrictions: string[];
  budgetRange: string;
  tableVibe: string;
  acceptableTableSizes: number[];
  note: string | null;
}

export interface UserProfileInput {
  preferredAreas: string[];
  availableTimes: string[];
  tastePreferences: string[];
  dietaryRestrictions: string[];
  budgetRange: string;
  tableVibe: string;
  acceptableTableSizes: number[];
  note?: string;
}

export async function listActivityPage(cursor?:string):Promise<{activities:ActivitySummary[];nextCursor:string|null;unavailableCount:number}>{
 if(formalBusinessEnabled){const data=await apiRequest<{activities:FormalOffer[];nextCursor:string|null;unavailableCount:number}>('/api/v11/formal/activities'+(cursor?'?cursor='+encodeURIComponent(cursor):''));if(!Array.isArray(data.activities)||!(data.nextCursor===null||validId(data.nextCursor))||!validMoney(data.unavailableCount))throw Error('活动列表资料不完整，请刷新');return {activities:data.activities.map(validateFormalOffer),nextCursor:data.nextCursor,unavailableCount:data.unavailableCount};}
 return {activities:(await apiRequest<{activities:ActivitySummary[]}>('/api/activities')).activities,nextCursor:null,unavailableCount:0};
}
export async function listActivities(): Promise<ActivitySummary[]> {return (await listActivityPage()).activities;}

export async function getActivity(activityId: string): Promise<ActivitySummary> {
  const data = await apiRequest<{ activity: ActivitySummary }>(`/api/activities/${activityId}`);
  return data.activity;
}

export async function ensureAuthenticatedUser(): Promise<string> {
  const cached = Taro.getStorageSync<string>(TOKEN_KEY);
  if (cached) return cached;
  if (!pendingLogin) {
    pendingLogin = (demoModeEnabled ? ensureMockUser() : loginWithWechatProvider())
      .finally(() => { pendingLogin = undefined; });
  }
  return pendingLogin;
}

export async function ensureMockUser(): Promise<string> {
  if (!demoModeEnabled) throw new Error("当前环境不支持演示登录");
  const cached = Taro.getStorageSync<string>(TOKEN_KEY);
  if (cached) {
    return cached;
  }
  const token = await loginWithWechatCode(`miniapp-${Date.now()}`);
  await apiRequest("/api/mock/phone", {
    method: "POST",
    token,
    data: { phone: "13800138000" },
  });
  return token;
}

export async function loginWithWechatCode(code: string): Promise<string> {
  const login = await apiRequest<{ token: string }>("/api/mock/wechat-login", {
    method: "POST",
    data: { code },
  });
  Taro.setStorageSync(TOKEN_KEY, login.token);
  return login.token;
}

export async function loginWithWechatProvider(): Promise<string> {
  const login = await Taro.login();
  if (!login.code) {
    throw new Error("微信登录未返回授权码");
  }
  return loginWithWechatCode(login.code);
}

export interface V11UserIdentity {
  id: string; userId: string; personId: string; role: "USER"; version: number;
}

// No second credential cache: all responses remain bound to the current WeChat session.
export async function initializeAvailableV11Identity(authToken: string): Promise<V11UserIdentity | null> {
  if (!isCurrentUserSession(authToken)) throw new Error("登录状态已改变，请重新加载");
  const capability = await apiRequest<{ version: string; identityEnabled: boolean }>("/api/v11/identity/capabilities", { token: authToken });
  if (capability.version !== "v11-identity-1" || typeof capability.identityEnabled !== "boolean") throw new Error("账号服务暂不可用，请稍后重试");
  if (!capability.identityEnabled) return null;
  const response = await apiRequest<{ version: string; principal: V11UserIdentity & { restaurantId: null } }>("/api/v11/identity/initialize", { method: "POST", token: authToken, data: {} });
  const actor = response.principal;
  if (response.version !== "v11-identity-1" || !actor || actor.role !== "USER" || actor.restaurantId !== null
      || typeof actor.id !== "string" || !actor.id || typeof actor.userId !== "string" || !actor.userId
      || typeof actor.personId !== "string" || !actor.personId || !Number.isInteger(actor.version) || actor.version < 0) {
    throw new Error("账号初始化失败，请重新登录后重试");
  }
  return { id: actor.id, userId: actor.userId, personId: actor.personId, role: "USER", version: actor.version };
}

export async function bindPhoneWithWechatCode(code: string): Promise<void> {
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  if (!token) {
    throw new Error("请先完成登录");
  }
  await apiRequest("/api/mock/phone", {
    method: "POST",
    token,
    data: { code },
  });
}

export function hasAuthenticatedSession(): boolean {
  return Boolean(Taro.getStorageSync<string>(TOKEN_KEY));
}

export function isCurrentUserSession(token: string): boolean {
  return Taro.getStorageSync<string>(TOKEN_KEY) === token;
}

export interface CurrentAgreement {
  version: string;
  text: string;
  textHash: string;
  activatedAt: string;
  source: string;
}

export async function getCurrentAgreement(): Promise<CurrentAgreement> {
  const data = await apiRequest<{ agreement: CurrentAgreement }>("/api/agreement/current");
  return data.agreement;
}

export async function confirmAgreement(agreementVersion: string): Promise<void> {
  const authToken = requireAuthenticatedSession();
  await apiRequest("/api/consents", {
    method: "POST",
    token: authToken,
    data: { agreementVersion, source: "miniapp-registration" },
  });
}

export async function createAndPayOrder(activityId: string, agreementVersion: string): Promise<string> {
  const authToken = requireAuthenticatedSession();
  const orderData = await apiRequest<{ order: { id: string } }>("/api/orders", {
    method: "POST",
    token: authToken,
    data: { activityId, agreementVersion },
  });
  // Preserve recovery context even if the user cancels payment or the channel fails.
  Taro.setStorageSync(LAST_ORDER_ID_KEY, orderData.order.id);
  await continueOrderPayment(orderData.order.id);
  return orderData.order.id;
}

export async function continueOrderPayment(orderId: string): Promise<string> {
  const authToken = requireAuthenticatedSession();
  const paymentData = await apiRequest<{
    payment: { id: string; channel?: string; status?: string };
    payable?: boolean;
    processing?: boolean;
    requiresReview?: boolean;
    paymentParams?: {
      timeStamp: string;
      nonceStr: string;
      package: string;
      signType: "RSA";
      paySign: string;
    };
  }>("/api/mock/payments", {
    method: "POST",
    token: authToken,
    data: { orderId },
  });
  if (paymentData.requiresReview) return "付款状态待核查，请稍后刷新订单或联系运营";
  if (paymentData.processing) return "付款结果处理中，请稍后刷新订单";
  if (paymentData.payment.status === "SUCCEEDED") return "付款结果已更新，请查看订单状态";
  if (paymentData.payable === false) return "当前订单暂时不可支付，请刷新查看状态";
  if (paymentData.paymentParams) {
    await Taro.requestPayment(paymentData.paymentParams);
  } else if (demoModeEnabled && paymentData.payment.channel === "mock" && paymentData.payable === true) {
    await apiRequest(`/api/mock/payments/${paymentData.payment.id}/succeed`, {
      method: "POST",
    });
  } else {
    throw new Error("暂时无法发起支付，请从订单页重试");
  }
  return "已提交付款，请以刷新后的订单状态为准";
}

function requireAuthenticatedSession(): string {
  const token = Taro.getStorageSync<string>(TOKEN_KEY);
  if (!token) {
    throw new Error("请先完成登录");
  }
  return token;
}

export interface OrderSummary {
  id: string; status: string; amountCents: number; createdAt: string;
  activity: { id: string; title: string; startsAt: string; endsAt: string };
}
export async function listOrders(cursor?: string): Promise<{ orders: OrderSummary[]; nextCursor: string | null }> {
  const token = await ensureAuthenticatedUser();
  return apiRequest(`/api/orders${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { token });
}
export async function getOrder(orderId: string): Promise<OrderDetail> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ order: OrderDetail }>(`/api/orders/${encodeURIComponent(orderId)}`, { token });
  return data.order;
}
export async function getLastOrder(): Promise<OrderDetail> {
  const orderId = Taro.getStorageSync<string>(LAST_ORDER_ID_KEY);
  if (orderId) return getOrder(orderId);
  const first = (await listOrders()).orders[0];
  if (!first) throw new Error("暂无订单，请先报名活动");
  return getOrder(first.id);
}
export async function getOrderPage(orderId?: string): Promise<{ order: OrderDetail; notifications: InboxNotification[]; notificationUnavailable: boolean }> {
  const token = await ensureAuthenticatedUser();
  const [order, notifications] = await Promise.allSettled([orderId ? getOrder(orderId) : getLastOrder(), getNotifications()]);
  if (!isCurrentUserSession(token)) throw new Error("登录状态已改变，请重新登录后刷新");
  if (order.status === "rejected") throw order.reason;
  return { order: order.value, notifications: notifications.status === "fulfilled" ? notifications.value : [],
    notificationUnavailable: notifications.status === "rejected" };
}
export async function requestOrderCancel(orderId: string, reason: string): Promise<void> {
  const authToken = requireAuthenticatedSession();
  await apiRequest(`/api/orders/${encodeURIComponent(orderId)}/cancel`, { method: "POST", token: authToken, data: { reason: reason.trim() } });
}

export async function submitOrderReport(orderId: string, type: string, content: string): Promise<SubmittedReport> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ report: SubmittedReport }>(`/api/orders/${orderId}/reports`, {
    method: "POST",
    token,
    data: { type, content },
  });
  return data.report;
}

export async function submitOrderReview(orderId: string, score: number, tags: string[], content: string): Promise<SubmittedReview> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ review: SubmittedReview }>(`/api/orders/${orderId}/review`, {
    method: "PUT",
    token,
    data: { score, tags, ...(content.trim() ? { content } : {}) },
  });
  return data.review;
}

export async function getNotifications(): Promise<InboxNotification[]> {
  return (await getNotificationPage()).notifications;
}

export async function getNotificationPage(cursor?: string): Promise<{ notifications: InboxNotification[]; nextCursor: string | null }> {
  const token = await ensureAuthenticatedUser();
  return apiRequest<{ notifications: InboxNotification[]; nextCursor: string | null }>(
    `/api/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ""}`, { token });
}

export async function markNotificationRead(id: string): Promise<void> {
  const token = await ensureAuthenticatedUser();
  await apiRequest(`/api/notifications/${encodeURIComponent(id)}/read`, { method: "POST", token });
}

export async function getProfile(): Promise<UserProfile | null> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ profile: UserProfile | null }>("/api/profile", { token });
  return data.profile;
}

export async function saveProfile(profile: UserProfileInput): Promise<UserProfile> {
  const token = await ensureAuthenticatedUser();
  const data = await apiRequest<{ profile: UserProfile }>("/api/profile", {
    method: "PUT",
    token,
    data: profile,
  });
  return data.profile;
}

interface RequestOptions {
  method?: "GET" | "POST" | "PUT";
  token?: string;
  data?: unknown;
}

async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await Taro.request<T & { error?: string }>({
    url: `${API_BASE_URL}${path}`,
    method: options.method ?? "GET",
    data: options.data === undefined && options.method && options.method !== "GET" ? {} : options.data,
    header: {
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      "content-type": "application/json",
    },
  });
  if (response.statusCode === 401) {
    if (options.token && Taro.getStorageSync(TOKEN_KEY) === options.token) {
      Taro.removeStorageSync(TOKEN_KEY);
    }
    // Keep pending order and form context; a failed request is never silently replayed.
    throw new Error("登录已失效，请重新登录后继续");
  }
  if (options.token && Taro.getStorageSync(TOKEN_KEY) !== options.token) {
    throw new Error("登录状态已改变，请重新加载");
  }
  if (response.statusCode < 200 || response.statusCode >= 300) {
    const data = response.data as { error?: string | {code?:string} };
    const messages:Record<string,string>={RESOURCE_NOT_FOUND:'未找到本人的记录',FUNDS_DATA_CONFLICT:'收款与退款记录正在核对，请稍后重试',FORBIDDEN:'当前账号无法执行此操作',INVALID_INPUT:'提交内容有误，请重新加载后重试',REQUEST_IDEMPOTENCY_CONFLICT:'申请信息正在核对，请稍后重试'};
    throw new Error(typeof data.error==='string'?data.error:messages[data.error?.code??'']??`请求未完成，请稍后重试（${response.statusCode}）`);
  }
  return response.data;
}
export interface FormalOffer extends ActivitySummary {depositCents:number;totalCents:number;supplyId:string;policyId:string;waitlistMax:number|null;mealCollection:'DIRECT_TO_RESTAURANT'}
export interface FormalPolicyDelivery {policyId:string;deliveryId:string;documents:Array<{kind:string;documentId:string;fullHash:string;publicHash:string;publicText:string}>;fullHashes:Record<string,string>;publicHashes:Record<string,string>}
export type FormalRefundRequestCategory = 'ORDINARY_CANCEL'|'CONSULTATION'|'EVIDENCE'|'DISPUTE'|'APPEAL'|'SPECIAL_REFUND';
export interface FormalCancellationResult {parentRequestId:string|null;originalRequestId:string|null;originalAcceptedAt:string|null;linkageState:'LINKED'|'ROOT'|'UNLINKED';requestId:string;registrationId:string;acceptedAt:string;state:string;refundApproved:false;requestCategory:FormalRefundRequestCategory;cancellationAccepted:boolean;membershipEnded:boolean;pendingReview:boolean;scope:'CANCELLATION_ACCEPTED_REFUND_PENDING'|'REQUEST_INTAKE_ONLY'}
export interface FormalRegistrationDetail {rejoinSafety?:{state:'NO_MONEY_CHANNEL_CLOSED'|'NO_PRIOR_REGISTRATION'|'BLOCKED_POLICY';blockerIds:string[];proofKind:string|null;eventIds:string[]};id:string;activityId:string;supplyId:string;policyId:string;category:string;title:string;state:string;F:number;D:number;total:number;acceptedAt:string;holdExpiresAt:string|null;restaurantName:string|null;address:string|null;
 responsibilityReviews?:Array<{id:string;state:string;originalRequestAcceptedAt:string;reviewOwner:string|null;membershipEnded:false;cancellationAccepted:false}>;
 fulfillment?:{restaurantResult:'NORMAL'|'ABNORMAL'|null;confirmedAt:string|null}|null;
 tableState?:'UNFORMED'|'WAITING'|'FORMED'|'INVALIDATED'|'FAILED'|null;cancelAcceptedAt?:string|null;queueOrdinal?:string|null;notices?:Array<{id:string;kind:string;state:string;receivedAt:string|null}>;
 refunds:Array<{id:string;F:number;D:number;total:number;state:string}>;requests:Array<{id:string;kind:string;requestCategory?:FormalRefundRequestCategory;parentRequestId?:string|null;originalRequestId?:string|null;originalAcceptedAt?:string|null;linkageState?:'LINKED'|'ROOT'|'UNLINKED';acceptedAt:string;state:string;blockerIds:string[]}>}
export async function formalRequest<T>(path:string,options:Omit<RequestOptions,'token'>={}):Promise<T>{
 const token=await ensureAuthenticatedUser();const identity=await initializeAvailableV11Identity(token);if(!identity)throw Error('报名账号服务暂不可用');
 const result=await apiRequest<T>(path,{...options,token});
 if(!isCurrentUserSession(token))throw Error("登录状态已改变，请重新加载");
 if(/^\/api\/v11\/formal\/registrations(?:\/[^/?]+)?(?:\?[^]*)?$/.test(path))validateFormalRegistrationResponse(result,path);
 return result;
}
export async function getFormalOffer(id:string){return validateFormalOffer((await apiRequest<{activity:FormalOffer}>('/api/v11/formal/activities/'+encodeURIComponent(id))).activity);}
export async function deliverFormalTerms(id:string){return validateFormalTerms(await formalRequest<FormalPolicyDelivery>('/api/v11/policies/'+encodeURIComponent(id)+'/delivery'),id);}
export async function acceptFormalTerms(delivery:FormalPolicyDelivery){validateFormalTerms(delivery,delivery.policyId);return formalRequest<{consentId:string;acceptedAt:string}>('/api/v11/policies/'+encodeURIComponent(delivery.policyId)+'/consents',
 {method:'POST',data:{deliveryId:delivery.deliveryId,fullHashes:delivery.fullHashes,publicHashes:delivery.publicHashes}});}
export async function prepareFormalPayment(id:string){
 const result=await formalRequest<{state:string;paymentParams:Taro.requestPayment.Option|null}>('/api/v11/formal/registrations/'+encodeURIComponent(id)+'/payment/prepare',{method:'POST'});
 if(result.state!=='PREPARED'||!result.paymentParams)throw Error('支付结果正在查询，请稍后刷新');
 await Taro.requestPayment(result.paymentParams);
 // User-device acknowledgement is not a receipt; always ask the trusted route.
 return formalRequest('/api/v11/formal/registrations/'+encodeURIComponent(id)+'/payment/query',{method:'POST'});
}

export interface FormalRefundRequest {
  requestId:string; registrationId:string; acceptedAt:string; state:string;
  scope:'REQUEST_INTAKE_ONLY'; refundApproved:false; policyActivation:'NOT_ASSESSED';
}
export interface FormalFunds {
  version:'v11-funds-1'; scope:'MONETARY_RECORDS_ONLY'; observation:'RECORDED_ONLY';
  registrationId:string; paidCents:number; confirmedRefundCents:number; unallocatedReceiptCount:number;
  receipts:Array<{receiptId:string;amountCents:number;paidAt:string;classification:string}>;
  refunds:Array<{refundId:string;amountCents:number;state:string}>;
  refundObligations?:Array<{receiptId:string;amountCents:number;confirmedCents:number;remainingCents:number;recordedAt:string;state:'CONFIRMED'|'EXECUTION_RECORDED'|'AWAITING_EXECUTION'}>;
  obligationEvidenceConflicts?:number;
  refundObligationCoverage?:'RECORDED_ONLY';
}
export interface MoneyRegistration {registrationId:string;activityTitle:string;startsAt:string;refundRequests:FormalRefundRequest[]}
export async function openMoneySession(){
  const token=await ensureAuthenticatedUser();
  const capabilities=await apiRequest<{version:string;identityEnabled:boolean;financialRecordsEnabled:boolean;refundIntakeEnabled:boolean}>("/api/v11/identity/capabilities",{token});
  if(capabilities.version!=='v11-identity-1'||!capabilities.identityEnabled||(!capabilities.financialRecordsEnabled&&!capabilities.refundIntakeEnabled))throw Error('收款与退款记录服务暂不可用');
  const actor=await initializeAvailableV11Identity(token);if(!actor)throw Error('请重新登录后重试');
  return {token,userId:actor.userId,financialRecordsEnabled:capabilities.financialRecordsEnabled===true,refundIntakeEnabled:capabilities.refundIntakeEnabled===true};
}
export async function listMoneyRegistrations(token:string,cursor?:string){
 return apiRequest<{registrations:MoneyRegistration[];nextCursor:string|null}>(`/api/v11/money-registrations${cursor?'?cursor='+encodeURIComponent(cursor):''}`,{token});
}
export async function getFormalFunds(token:string,id:string){return apiRequest<FormalFunds>(`/api/v11/registrations/${encodeURIComponent(id)}/funds`,{token});}
export async function submitFormalRefund(token:string,id:string,idempotencyKey:string){
 return apiRequest<FormalRefundRequest>(`/api/v11/registrations/${encodeURIComponent(id)}/refund-requests`,{method:'POST',token,data:{idempotencyKey}});
}
export async function getFormalRefund(token:string,id:string){return apiRequest<FormalRefundRequest>(`/api/v11/refund-requests/${encodeURIComponent(id)}`,{token});}

// Persist the exact accepted intent before sending: retries across remounts use
// the same consent and business key, scoped to the authenticated server user.
export async function submitFormalSignup(offer:FormalOffer,terms:FormalPolicyDelivery,membership:'FORMAL'|'WAITLIST',gender:'MALE'|'FEMALE'){
 const token=await ensureAuthenticatedUser(),identity=await initializeAvailableV11Identity(token);
 if(!identity)throw Error('报名账号服务暂不可用');
 const storageKey='fanju_formal_signup_v1:'+identity.userId+':'+offer.id+':'+offer.supplyId+':'+membership;
 let input=Taro.getStorageSync<{activityId:string;supplyId:string;policyId:string;consentId:string;membership:string;businessKey:string}>(storageKey);
 if(!input){
  await formalRequest('/api/v11/formal/profile',{method:'PUT',data:{policyId:offer.policyId,gender,adultDeclaration:true,serviceCompatible:true}});
  const accepted=await acceptFormalTerms(terms);
  if(!isCurrentUserSession(token))throw Error('登录状态已改变，请重新加载');
  input={activityId:offer.id,supplyId:offer.supplyId,policyId:offer.policyId,consentId:accepted.consentId,membership,businessKey:'signup_'+Date.now()+'_'+Math.random().toString(36).slice(2)};
  Taro.setStorageSync(storageKey,input);
 }
 if(input.activityId!==offer.id||input.supplyId!==offer.supplyId||input.policyId!==offer.policyId||input.membership!==membership||!input.businessKey||!input.consentId)throw Error('报名恢复记录不一致，请核对原申请');
 return formalRequest<{registration?:FormalRegistrationDetail;request?:{acceptedAt:string};blockerIds?:string[]}>('/api/v11/formal/registrations',{method:'POST',data:input});
}
export async function formalRefundRequestKey(id:string,category:FormalRefundRequestCategory='ORDINARY_CANCEL',parentRequestId?:string){
 const token=await ensureAuthenticatedUser(),identity=await initializeAvailableV11Identity(token);if(!identity)throw Error('报名账号服务暂不可用');
 const storageKey='fanju_formal_refund_v1:'+identity.userId+':'+id+(category==='ORDINARY_CANCEL'?'':':'+category)+(parentRequestId?':parent:'+parentRequestId:'');let key=Taro.getStorageSync<string>(storageKey);
 if(!key){key='refund_'+Date.now()+'_'+Math.random().toString(36).slice(2);Taro.setStorageSync(storageKey,key);}return key;
}

export async function beginNewFormalAttempt(record:FormalRegistrationDetail){
 const current=(await formalRequest<{registration:FormalRegistrationDetail}>('/api/v11/formal/registrations/'+encodeURIComponent(record.id))).registration;
 if(!['ENDED','EXPIRED'].includes(current.state)||current.refunds.some(r=>r.state!=='CONFIRMED')||current.rejoinSafety?.state!=='NO_MONEY_CHANNEL_CLOSED'||current.rejoinSafety.proofKind!=='VERIFIED_ORIGINAL_CHANNEL_CLOSURE'||!current.rejoinSafety.eventIds.length||current.rejoinSafety.blockerIds.length)throw Error('原报名或退款仍在处理，请先核对原记录');
 const token=await ensureAuthenticatedUser(),identity=await initializeAvailableV11Identity(token);if(!identity)throw Error('报名账号服务暂不可用');
 for(const membership of ['FORMAL','WAITLIST'])Taro.removeStorageSync('fanju_formal_signup_v1:'+identity.userId+':'+current.activityId+':'+current.supplyId+':'+membership);
 return current.activityId;
}

function validMoney(n:unknown){return Number.isSafeInteger(n)&&Number(n)>=0;}
function validateFormalOffer(value:FormalOffer):FormalOffer{
 if(!value||typeof value.id!=='string'||!value.id||typeof value.supplyId!=='string'||!value.supplyId||typeof value.policyId!=='string'||!value.policyId||typeof value.title!=='string'||!value.title||!validMoney(value.serviceFeeCents)||!validMoney(value.depositCents)||!validMoney(value.totalCents)||value.totalCents!==value.serviceFeeCents+value.depositCents||value.mealCollection!=='DIRECT_TO_RESTAURANT'||!(value.waitlistMax===null||validMoney(value.waitlistMax))||!Number.isFinite(Date.parse(value.startsAt)))throw Error('活动报价资料不完整，请重新加载');
 return value;
}

function validId(value:unknown){return typeof value==='string'&&value.length>0;}
function validDate(value:unknown){return typeof value==='string'&&Number.isFinite(Date.parse(value));}
function moneyParts(value:any){return value&&validMoney(value.F)&&validMoney(value.D)&&validMoney(value.total)&&value.total===value.F+value.D;}
function validateFormalTerms(value:FormalPolicyDelivery,policyId:string){
 const fail=()=>{throw Error('报名规则资料不完整，请重新阅读');};
 if(!value||value.policyId!==policyId||!validId(value.deliveryId)||!Array.isArray(value.documents)||value.documents.length!==3||!value.fullHashes||!value.publicHashes)fail();
 const kinds=new Set(),ids=new Set();
 for(const d of value.documents){
  if(!d||!['USER_AGREEMENT','PRIVACY_NOTICE','REFUND_POLICY'].includes(d.kind)||kinds.has(d.kind)||!validId(d.documentId)||ids.has(d.documentId)||typeof d.publicText!=='string'||!d.publicText.trim()||! /^[a-f0-9]{64}$/.test(d.fullHash)||! /^[a-f0-9]{64}$/.test(d.publicHash)||value.fullHashes[d.documentId]!==d.fullHash||value.publicHashes[d.documentId]!==d.publicHash)fail();
  kinds.add(d.kind);ids.add(d.documentId);
 }
 if(Object.keys(value.fullHashes).length!==3||Object.keys(value.publicHashes).length!==3)fail();return value;
}
function validateFormalRegistrationResponse(value:any,path:string){
 const fail=()=>{throw Error('报名记录资料不完整，请刷新核对');};
 function record(r:any){
  if(!r||!validId(r.id)||!validId(r.activityId)||!validId(r.supplyId)||!validId(r.policyId)||!validId(r.title)||!validId(r.state)||!validId(r.category)||!moneyParts(r)||!validDate(r.acceptedAt)||!(r.holdExpiresAt===null||validDate(r.holdExpiresAt))||!(r.restaurantName===null||typeof r.restaurantName==='string')||!(r.address===null||typeof r.address==='string')||!Array.isArray(r.refunds)||!Array.isArray(r.requests))fail();
  if(r.responsibilityReviews!==undefined&&(!Array.isArray(r.responsibilityReviews)||r.responsibilityReviews.some((q:any)=>!validId(q?.id)||q.state!=='AWAITING_FULFILLMENT_RIGHTS_REVIEW'||!validDate(q.originalRequestAcceptedAt)||!validId(q.reviewOwner)||q.membershipEnded!==false||q.cancellationAccepted!==false)))fail();
  if(r.rejoinSafety!==undefined&&(!r.rejoinSafety||!['NO_MONEY_CHANNEL_CLOSED','NO_PRIOR_REGISTRATION','BLOCKED_POLICY'].includes(r.rejoinSafety.state)||!Array.isArray(r.rejoinSafety.blockerIds)||r.rejoinSafety.blockerIds.some((v:unknown)=>!validId(v))||!Array.isArray(r.rejoinSafety.eventIds)||r.rejoinSafety.eventIds.some((v:unknown)=>!validId(v))||!(r.rejoinSafety.proofKind===null||r.rejoinSafety.proofKind==='VERIFIED_ORIGINAL_CHANNEL_CLOSURE')))fail();
  if(r.fulfillment!==undefined&&r.fulfillment!==null&&(!['NORMAL','ABNORMAL',null].includes(r.fulfillment.restaurantResult)||!(r.fulfillment.confirmedAt===null||validDate(r.fulfillment.confirmedAt))))fail();
  if(r.tableState!==undefined&&r.tableState!==null&&!['UNFORMED','WAITING','FORMED','INVALIDATED','FAILED'].includes(r.tableState)||r.cancelAcceptedAt!==undefined&&r.cancelAcceptedAt!==null&&!validDate(r.cancelAcceptedAt)||r.queueOrdinal!==undefined&&r.queueOrdinal!==null&&(typeof r.queueOrdinal!=='string'||!/^([1-9][0-9]*)$/.test(r.queueOrdinal))||r.notices!==undefined&&(!Array.isArray(r.notices)||r.notices.some((n:any)=>!validId(n?.id)||!validId(n.kind)||!validId(n.state)||!(n.receivedAt===null||validDate(n.receivedAt)))))fail();
  if(r.refunds.some((f:any)=>!validId(f?.id)||!validId(f.state)||!moneyParts(f))||r.requests.some((q:any)=>!validId(q?.id)||!validId(q.kind)||(q.requestCategory!==undefined&&!['ORDINARY_CANCEL','CONSULTATION','EVIDENCE','DISPUTE','APPEAL','SPECIAL_REFUND'].includes(q.requestCategory))||q.parentRequestId!==undefined&&q.parentRequestId!==null&&!validId(q.parentRequestId)||q.originalRequestId!==undefined&&q.originalRequestId!==null&&!validId(q.originalRequestId)||q.originalAcceptedAt!==undefined&&q.originalAcceptedAt!==null&&!validDate(q.originalAcceptedAt)||q.linkageState!==undefined&&!['LINKED','ROOT','UNLINKED'].includes(q.linkageState)||!validId(q.state)||!validDate(q.acceptedAt)||!Array.isArray(q.blockerIds)||q.blockerIds.some((x:unknown)=>!validId(x))))fail();
 }
 if(!value||typeof value!=='object')fail();
 if(value.registration){record(value.registration);const suffix=path.split('?')[0]!.split('/').slice(5);if(suffix.length&&value.registration.id!==decodeURIComponent(suffix[0]!))fail();}
 else if(Array.isArray(value.registrations)){value.registrations.forEach(record);if(!(value.nextCursor===null||validId(value.nextCursor)))fail();}
 else if(!value.request||!validDate(value.request.acceptedAt)||!Array.isArray(value.blockerIds)||value.blockerIds.some((x:unknown)=>!validId(x)))fail();
}
