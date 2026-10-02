import { verifyChannelResponse, parseChannelPaymentTime } from "./wechat-response.js";
import { createSign, randomUUID, X509Certificate } from "node:crypto";
import { readFileSync } from "node:fs";

export type ProviderMode = "mock" | "wechat";

export interface ProviderEnv {
  [key: string]: string | undefined;
}

export interface ProviderHttpRequest {
  url: string;
  method?: "GET" | "POST";
  body?: unknown;
  headers?: Record<string, string>;
  verifyResponse?: (raw: string, headers: Headers) => void;
}

export type ProviderHttpClient = (
  request: ProviderHttpRequest,
) => Promise<unknown>;

export interface ProviderOptions {
  httpClient?: ProviderHttpClient;
  readFile?: (path: string) => string;
}

export interface AuthProvider {
  mode: ProviderMode;
  exchangeLoginCode(input: { code: string }): Promise<{
    provider: ProviderMode;
    openid: string;
    unionid?: string;
  }>;
}

export interface PhoneProvider {
  mode: ProviderMode;
  resolvePhone(input: { phone?: string; code?: string }): Promise<{
    provider: ProviderMode;
    phone: string;
    phoneNumber: string;
    countryCode?: string;
    purePhoneNumber?: string;
  }>;
}

export interface PaymentProvider {
  mode: ProviderMode;
  resumePayment?(prepayId: string): WechatMiniProgramPaymentParams;
  queryPayment?(merchantOrderNo: string): Promise<ChannelPaymentResult>;
  closePayment?(merchantOrderNo: string, beforeSend?: () => Promise<void>): Promise<void>;
  createPayment(input: {
    merchantOrderNo: string;
    amountCents: number;
    openid: string;
  }): Promise<{
    channel: string;
    prepayId?: string;
    paymentParams?: WechatMiniProgramPaymentParams;
  }>;
  applySuccessCallback(input: { paymentId: string }): Promise<{
    channelTradeNo: string;
    callbackNonce: string;
  }>;
}

export interface RefundProvider {
  mode: ProviderMode;
  queryRefund?(merchantRefundNo: string): Promise<ChannelRefundResult>;
  createRefund(input: {
    merchantRefundNo: string;
    merchantOrderNo: string;
    amountCents: number;
  }, beforeSend?: () => Promise<void>): Promise<{
    channel: string;
    channelRefundNo?: string;
  }>;
  applySuccessCallback(input: { refundId: string }): Promise<{
    channelRefundNo: string;
    callbackNonce: string;
  }>;
  applyFailureCallback(input: { refundId: string; reason: string }): Promise<{
    failureReason: string;
  }>;
}

export type ChannelPaymentResult = { merchantOrderNo: string; status: "NOT_FOUND" } | {
  merchantOrderNo: string; status: "SUCCEEDED" | "PENDING" | "CLOSED";
  channelTradeNo?: string; paidAt?: string; amountCents: number; currency: "CNY";
};
export type ChannelRefundResult = { merchantRefundNo: string; status: 'NOT_FOUND' } | {
  merchantRefundNo: string; status: "SUCCEEDED" | "PENDING" | "CLOSED" | "FAILED";
  channelRefundNo: string; originalTradeNo: string; amountCents: number; currency: "CNY"; refundedAt?:string;
};
export interface WechatMiniProgramPaymentParams {
  appId: string;
  timeStamp: string;
  nonceStr: string;
  package: string;
  signType: "RSA";
  paySign: string;
}

export interface WechatProviders {
  auth: AuthProvider;
  phone: PhoneProvider;
  payment: PaymentProvider;
  refund: RefundProvider;
}

export class ProviderConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderConfigError";
  }
}

export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProviderUnavailableError";
  }
}

// Only fetchJson constructs this after verifying the exact error response bytes.
export class VerifiedChannelError extends ProviderUnavailableError {
  constructor(readonly status: number, readonly code: "ORDER_NOT_EXIST" | "RESOURCE_NOT_EXISTS") {
    super(`Verified channel error: ${code}`);
  }
}

export function createWechatProviders(
  env: ProviderEnv = process.env,
  options: ProviderOptions = {},
): WechatProviders {
  const authMode = readMode(env.AUTH_PROVIDER, "mock", "AUTH_PROVIDER");
  const phoneMode = readMode(env.PHONE_PROVIDER, "mock", "PHONE_PROVIDER");
  const paymentMode = readMode(
    env.PAYMENT_PROVIDER ?? env.WECHAT_PAY_MODE,
    "mock",
    "PAYMENT_PROVIDER",
  );
  const refundMode = readMode(
    env.REFUND_PROVIDER ?? env.PAYMENT_PROVIDER ?? env.WECHAT_PAY_MODE,
    paymentMode,
    "REFUND_PROVIDER",
  );

  if (authMode === "wechat" || phoneMode === "wechat") {
    assertWechatMiniappConfig(env);
  }
  assertProductionPaymentMode(env, paymentMode);
  if (paymentMode === "wechat" || refundMode === "wechat") {
    assertWechatPayConfig(env);
  }
  const httpClient = options.httpClient ?? fetchJson;
  const readFile = options.readFile ?? ((path: string) => readFileSync(path, "utf8"));

  return {
    auth:
      authMode === "mock"
        ? new MockAuthProvider()
        : new WechatAuthProvider(env, httpClient),
    phone:
      phoneMode === "mock"
        ? new MockPhoneProvider()
        : new WechatPhoneProvider(env, httpClient),
    payment:
      paymentMode === "mock" ? new MockPaymentProvider() : new WechatPaymentProvider(env, httpClient, readFile),
    refund:
      refundMode === "mock" ? new MockRefundProvider() : new WechatRefundProvider(env, httpClient, readFile),
  };
}

function readMode(
  value: string | undefined,
  fallback: ProviderMode,
  name: string,
): ProviderMode {
  if (value === undefined || value === "") {
    return fallback;
  }
  if (value === "mock" || value === "wechat") {
    return value;
  }
  throw new ProviderConfigError(`${name} must be mock or wechat`);
}

function assertProductionPaymentMode(env: ProviderEnv, mode: ProviderMode): void {
  const isProduction =
    env.NODE_ENV === "production" || env.APP_ENV === "production";
  const allowMockPayment =
    env.ALLOW_MOCK_PAYMENT_IN_PRODUCTION === "true" ||
    env.WECHAT_PAY_MOCK_ENABLED_IN_PRODUCTION === "true";
  if (isProduction && mode === "mock" && !allowMockPayment) {
    throw new ProviderConfigError(
      "Mock payment provider is disabled in production unless explicitly allowed",
    );
  }
}

function assertWechatMiniappConfig(env: ProviderEnv): void {
  const required = ["WECHAT_MINIAPP_APP_ID", "WECHAT_MINIAPP_APP_SECRET"];
  const missing = required.filter((key) => !env[key]);
  if (missing.length > 0) {
    throw new ProviderConfigError(
      `Missing required WeChat Mini Program configuration: ${missing.join(", ")}`,
    );
  }
}

function assertWechatPayConfig(env: ProviderEnv): void {
  const enabled = env.WECHAT_PAY_ENABLED === "true";
  const required = [
    "WECHAT_PAY_MCH_ID",
    "WECHAT_MINIAPP_APP_ID",
    "WECHAT_PAY_API_V3_KEY",
    "WECHAT_PAY_PRIVATE_KEY_PATH",
    "WECHAT_PAY_CERT_SERIAL_NO",
    "WECHAT_PAY_PLATFORM_CERT_PATH",
    "WECHAT_PAY_CALLBACK_URL",
    "WECHAT_REFUND_CALLBACK_URL",
  ];
  const missing = [
    ...(enabled ? [] : ["WECHAT_PAY_ENABLED=true"]),
    ...required.filter((key) => !env[key]),
  ];
  if (missing.length > 0) {
    throw new ProviderConfigError(
      `Missing required WeChat Pay configuration: ${missing.join(", ")}`,
    );
  }
}

class MockAuthProvider implements AuthProvider {
  readonly mode = "mock" as const;

  async exchangeLoginCode(input: { code: string }) {
    return { provider: this.mode, openid: `mock_openid_${input.code}` };
  }
}

class WechatAuthProvider implements AuthProvider {
  readonly mode = "wechat" as const;

  constructor(
    private readonly env: ProviderEnv,
    private readonly httpClient: ProviderHttpClient,
  ) {}

  async exchangeLoginCode(input: { code: string }): Promise<{
    provider: ProviderMode;
    openid: string;
    unionid?: string;
  }> {
    const code = input.code.trim();
    if (!code) {
      throw new ProviderUnavailableError("WeChat login code is required");
    }
    const url = new URL("https://api.weixin.qq.com/sns/jscode2session");
    url.searchParams.set(
      "appid",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_ID"),
    );
    url.searchParams.set(
      "secret",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_SECRET"),
    );
    url.searchParams.set("js_code", code);
    url.searchParams.set("grant_type", "authorization_code");

    const response = asRecord(
      await this.httpClient({ url: url.toString(), method: "GET" }),
    );
    throwIfWechatError(response, "auth");
    const openid = response.openid;
    if (typeof openid !== "string" || openid.length === 0) {
      throw new ProviderUnavailableError("WeChat auth response missing openid");
    }
    const unionid = typeof response.unionid === "string" ? response.unionid : undefined;
    return unionid === undefined
      ? { provider: this.mode, openid }
      : { provider: this.mode, openid, unionid };
  }
}

class MockPhoneProvider implements PhoneProvider {
  readonly mode = "mock" as const;

  async resolvePhone(input: { phone?: string }) {
    if (!input.phone) {
      throw new ProviderUnavailableError("Mock phone provider requires phone");
    }
    return { provider: this.mode, phone: input.phone, phoneNumber: input.phone };
  }
}

class WechatPhoneProvider implements PhoneProvider {
  readonly mode = "wechat" as const;

  constructor(
    private readonly env: ProviderEnv,
    private readonly httpClient: ProviderHttpClient,
  ) {}

  async resolvePhone(input: { code?: string }): Promise<{
    provider: ProviderMode;
    phone: string;
    phoneNumber: string;
    countryCode?: string;
    purePhoneNumber?: string;
  }> {
    const code = input.code?.trim();
    if (!code) {
      throw new ProviderUnavailableError("WeChat phone authorization code is required");
    }

    const credential = await this.fetchAccessToken();
    const url = new URL(
      "https://api.weixin.qq.com/wxa/business/getuserphonenumber",
    );
    url.searchParams.set("access_token", credential);
    const response = asRecord(
      await this.httpClient({
        url: url.toString(),
        method: "POST",
        body: { code },
      }),
    );
    throwIfWechatError(response, "phone");
    const phoneInfo = asRecord(response.phone_info);
    const phoneNumber = phoneInfo.phoneNumber;
    if (typeof phoneNumber !== "string" || phoneNumber.length === 0) {
      throw new ProviderUnavailableError("WeChat phone response missing phone number");
    }
    const countryCode =
      phoneInfo.countryCode === undefined ? undefined : String(phoneInfo.countryCode);
    const purePhoneNumber =
      phoneInfo.purePhoneNumber === undefined
        ? undefined
        : String(phoneInfo.purePhoneNumber);
    return {
      provider: this.mode,
      phone: phoneNumber,
      phoneNumber,
      ...(countryCode === undefined ? {} : { countryCode }),
      ...(purePhoneNumber === undefined ? {} : { purePhoneNumber }),
    };
  }

  private async fetchAccessToken(): Promise<string> {
    const url = new URL("https://api.weixin.qq.com/cgi-bin/token");
    url.searchParams.set("grant_type", "client_credential");
    url.searchParams.set(
      "appid",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_ID"),
    );
    url.searchParams.set(
      "secret",
      requireConfigValue(this.env, "WECHAT_MINIAPP_APP_SECRET"),
    );
    const response = asRecord(
      await this.httpClient({ url: url.toString(), method: "GET" }),
    );
    throwIfWechatError(response, "phone access token");
    const credential = response.access_token;
    if (typeof credential !== "string" || credential.length === 0) {
      throw new ProviderUnavailableError("WeChat access token response missing token");
    }
    return credential;
  }
}

class MockPaymentProvider implements PaymentProvider {
  readonly mode = "mock" as const;

  async createPayment() {
    return { channel: "mock" };
  }

  async applySuccessCallback(input: { paymentId: string }) {
    return {
      channelTradeNo: `mock_trade_${input.paymentId}`,
      callbackNonce: `mock_payment_success_${input.paymentId}`,
    };
  }
}

class WechatPaymentProvider implements PaymentProvider {
  readonly mode = "wechat" as const;

  constructor(
    private readonly env: ProviderEnv,
    private readonly httpClient: ProviderHttpClient,
    private readonly readFile: (path: string) => string,
  ) {}

  async createPayment(input: {
    merchantOrderNo: string;
    amountCents: number;
    openid: string;
  }): Promise<{ channel: string; prepayId: string; paymentParams: WechatMiniProgramPaymentParams }> {
    assertPositiveAmount(input.amountCents);
    const appId = requireConfigValue(this.env, "WECHAT_MINIAPP_APP_ID");
    const body = {
      appid: appId,
      mchid: requireConfigValue(this.env, "WECHAT_PAY_MCH_ID"),
      description: "餐厅兴趣体验服务费",
      out_trade_no: input.merchantOrderNo,
      notify_url: requireConfigValue(this.env, "WECHAT_PAY_CALLBACK_URL"),
      amount: { total: input.amountCents, currency: "CNY" },
      payer: { openid: input.openid },
    };
    const response = asRecord(await this.httpClient(signedWechatPayRequest(this.env, this.readFile, "/v3/pay/transactions/jsapi", body)));
    const prepayId = requiredResponseString(response, "prepay_id", "payment");
    const paymentParams = createMiniProgramPaymentParams(appId, prepayId, this.privateKey());
    return { channel: "wechat", prepayId, paymentParams };
  }

  async applySuccessCallback(): Promise<{
    channelTradeNo: string;
    callbackNonce: string;
  }> {
    throw new ProviderUnavailableError(
      "WeChat payment callback provider is not implemented in M3.0",
    );
  }

  async queryPayment(merchantOrderNo: string): Promise<ChannelPaymentResult> {
    const path = `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderNo)}?mchid=${encodeURIComponent(requireConfigValue(this.env, "WECHAT_PAY_MCH_ID"))}`;
    let value: Record<string, unknown>;
    try { value = asRecord(await this.httpClient(signedWechatPayRequest(this.env, this.readFile, path, undefined, "GET"))); }
    catch (error) {
      if (error instanceof VerifiedChannelError && error.status === 404 && error.code === "ORDER_NOT_EXIST") {
        return { merchantOrderNo, status: "NOT_FOUND" };
      }
      throw error;
    }
    if (value.out_trade_no !== merchantOrderNo || value.mchid !== this.env.WECHAT_PAY_MCH_ID || value.appid !== this.env.WECHAT_MINIAPP_APP_ID) throw new ProviderUnavailableError("Payment query identity mismatch");
    const amount = asRecord(value.amount);assertPositiveAmount(Number(amount.total));
    if (typeof amount.total !== "number" || amount.currency !== "CNY") throw new ProviderUnavailableError("Payment query amount invalid");
    const state = requiredResponseString(value, "trade_state", "payment query");
    if (!["SUCCESS", "REFUND", "NOTPAY", "USERPAYING", "CLOSED", "REVOKED", "PAYERROR"].includes(state)) throw new ProviderUnavailableError("Unknown payment state");
    const succeeded = state === "SUCCESS" || state === "REFUND";
    return { merchantOrderNo, amountCents: amount.total, currency: "CNY",
      status: succeeded ? "SUCCEEDED" : ["CLOSED", "REVOKED", "PAYERROR"].includes(state) ? "CLOSED" : "PENDING",
      ...(succeeded ? { channelTradeNo: requiredResponseString(value, "transaction_id", "payment query"), paidAt: parseChannelPaymentTime(value.success_time) } : {}) };
  }
  async closePayment(merchantOrderNo: string, beforeSend?: () => Promise<void>): Promise<void> {
    const request = signedWechatPayRequest(this.env, this.readFile,
      `/v3/pay/transactions/out-trade-no/${encodeURIComponent(merchantOrderNo)}/close`,
      { mchid: requireConfigValue(this.env, "WECHAT_PAY_MCH_ID") });
    if (beforeSend) await beforeSend();
    await this.httpClient(request);
  }

  resumePayment(prepayId: string): WechatMiniProgramPaymentParams {
    return createMiniProgramPaymentParams(requireConfigValue(this.env, "WECHAT_MINIAPP_APP_ID"), prepayId, this.privateKey());
  }

  private privateKey(): string {
    return this.readFile(requireConfigValue(this.env, "WECHAT_PAY_PRIVATE_KEY_PATH"));
  }
}

class MockRefundProvider implements RefundProvider {
  readonly mode = "mock" as const;

  async createRefund() {
    return { channel: "mock" };
  }

  async applySuccessCallback(input: { refundId: string }) {
    return {
      channelRefundNo: `mock_refund_${input.refundId}`,
      callbackNonce: `mock_refund_success_${input.refundId}`,
    };
  }

  async applyFailureCallback(input: { reason: string }) {
    return { failureReason: input.reason };
  }
}

class WechatRefundProvider implements RefundProvider {
  readonly mode = "wechat" as const;

  constructor(
    private readonly env: ProviderEnv,
    private readonly httpClient: ProviderHttpClient,
    private readonly readFile: (path: string) => string,
  ) {}

  async createRefund(input: {
    merchantRefundNo: string;
    merchantOrderNo: string;
    amountCents: number;
  }, beforeSend?: () => Promise<void>): Promise<{ channel: string; channelRefundNo?: string }> {
    assertPositiveAmount(input.amountCents);
    // WeChat requires the original payment total, even for a partial refund.
    // Query through the same signed, identity-checked payment provider rather than trusting the caller.
    const original = await new WechatPaymentProvider(this.env, this.httpClient, this.readFile).queryPayment(input.merchantOrderNo);
    if (original.status !== "SUCCEEDED" || input.amountCents > original.amountCents) {
      throw new ProviderUnavailableError("Original payment unavailable or refund exceeds original amount");
    }
    const body = {
      out_refund_no: input.merchantRefundNo,
      out_trade_no: input.merchantOrderNo,
      notify_url: requireConfigValue(this.env, "WECHAT_REFUND_CALLBACK_URL"),
      amount: { refund: input.amountCents, total: original.amountCents, currency: "CNY" },
    };
    await beforeSend?.();
    const response = asRecord(await this.httpClient(signedWechatPayRequest(this.env, this.readFile, "/v3/refund/domestic/refunds", body)));
    const channelRefundNo = optionalResponseString(response, "refund_id", "refund");
    return { channel: "wechat", ...(channelRefundNo === undefined ? {} : { channelRefundNo }) };
  }

  async queryRefund(merchantRefundNo: string): Promise<ChannelRefundResult> {
    let value: Record<string, unknown>;
    try { value = asRecord(await this.httpClient(signedWechatPayRequest(this.env, this.readFile,
      `/v3/refund/domestic/refunds/${encodeURIComponent(merchantRefundNo)}`, undefined, "GET"))); }
    catch (error) {
      if (error instanceof VerifiedChannelError && error.status === 404 && error.code === 'RESOURCE_NOT_EXISTS')
        return { merchantRefundNo, status: 'NOT_FOUND' };
      throw error;
    }
    if (value.out_refund_no !== merchantRefundNo) throw new ProviderUnavailableError("Refund query identity mismatch");
    const amount = asRecord(value.amount);assertPositiveAmount(Number(amount.refund));
    if (typeof amount.refund !== "number" || amount.currency !== "CNY") throw new ProviderUnavailableError("Refund query amount invalid");
    const state = requiredResponseString(value, "status", "refund query");
    if (!["SUCCESS", "PROCESSING", "CLOSED", "ABNORMAL"].includes(state)) throw new ProviderUnavailableError("Unknown refund state");
    return { merchantRefundNo, amountCents: amount.refund, currency: "CNY",
      status: state === "SUCCESS" ? "SUCCEEDED" : state === "PROCESSING" ? "PENDING" : state === "CLOSED" ? "CLOSED" : "FAILED",
      channelRefundNo: requiredResponseString(value, "refund_id", "refund query"),
      originalTradeNo: requiredResponseString(value, "transaction_id", "refund query"),
      ...(state === "SUCCESS" && value.success_time !== undefined ? { refundedAt: parseChannelPaymentTime(value.success_time) } : {}) };
  }

  async applySuccessCallback(): Promise<{
    channelRefundNo: string;
    callbackNonce: string;
  }> {
    throw new ProviderUnavailableError(
      "WeChat refund callback provider is not implemented in M3.0",
    );
  }

  async applyFailureCallback(): Promise<{ failureReason: string }> {
    throw new ProviderUnavailableError(
      "WeChat refund callback provider is not implemented in M3.0",
    );
  }
}

export function signedWechatPayRequest(
  env: ProviderEnv,
  readFile: (path: string) => string,
  path: string,
  body: Record<string, unknown> | undefined,
  method: "GET" | "POST" = "POST",
): ProviderHttpRequest {
  const timestamp = String(Math.floor(Date.now() / 1000));
  const nonce = randomUUID().replace(/-/g, "");
  const rawBody = body === undefined ? "" : JSON.stringify(body);
  const privateKey = readFile(requireConfigValue(env, "WECHAT_PAY_PRIVATE_KEY_PATH"));
  const signer = createSign("RSA-SHA256");
  signer.update(`${method}\n${path}\n${timestamp}\n${nonce}\n${rawBody}\n`);
  signer.end();
  const signature = signer.sign(privateKey, "base64");
  const mchid = requireConfigValue(env, "WECHAT_PAY_MCH_ID");
  const serialNo = requireConfigValue(env, "WECHAT_PAY_CERT_SERIAL_NO");
  return {
    url: `https://api.mch.weixin.qq.com${path}`,
    method,
    ...(body === undefined ? {} : { body }),
    verifyResponse: (raw, headers) => {
      const certificate = readFile(requireConfigValue(env, "WECHAT_PAY_PLATFORM_CERT_PATH"));
      verifyChannelResponse(raw, headers, { certificate, serial: new X509Certificate(certificate).serialNumber });
    },
    headers: {
      authorization: `WECHATPAY2-SHA256-RSA2048 mchid=\"${mchid}\",nonce_str=\"${nonce}\",timestamp=\"${timestamp}\",serial_no=\"${serialNo}\",signature=\"${signature}\"`,
      accept: "application/json",
      "content-type": "application/json",
    },
  };
}

function createMiniProgramPaymentParams(appId: string, prepayId: string, privateKey: string): WechatMiniProgramPaymentParams {
  const timeStamp = String(Math.floor(Date.now() / 1000));
  const nonceStr = randomUUID().replace(/-/g, "");
  const packageValue = `prepay_id=${prepayId}`;
  const signer = createSign("RSA-SHA256");
  signer.update(`${appId}\n${timeStamp}\n${nonceStr}\n${packageValue}\n`);
  signer.end();
  return { appId, timeStamp, nonceStr, package: packageValue, signType: "RSA", paySign: signer.sign(privateKey, "base64") };
}

function assertPositiveAmount(amountCents: number): void {
  if (!Number.isSafeInteger(amountCents) || amountCents <= 0) {
    throw new ProviderUnavailableError("WeChat payment amount must be a positive integer");
  }
}

function requiredResponseString(value: Record<string, unknown>, key: string, operation: string): string {
  const result = value[key];
  if (typeof result !== "string" || result.length === 0) {
    throw new ProviderUnavailableError(`WeChat ${operation} response missing ${key}`);
  }
  return result;
}

function optionalResponseString(value: Record<string, unknown>, key: string, operation: string): string | undefined {
  const result = value[key];
  if (result === undefined) return undefined;
  if (typeof result !== "string" || result.length === 0) {
    throw new ProviderUnavailableError(`WeChat ${operation} response has invalid ${key}`);
  }
  return result;
}

function requireConfigValue(env: ProviderEnv, key: string): string {
  const value = env[key];
  if (!value) {
    throw new ProviderConfigError(`Missing required WeChat configuration: ${key}`);
  }
  return value;
}

export async function fetchJson(request: ProviderHttpRequest): Promise<unknown> {
  const method = request.method ?? "GET";
  const init: RequestInit = { method, redirect: "error", signal: AbortSignal.timeout(10_000) };
  if (request.headers !== undefined) init.headers = request.headers;
  if (request.body !== undefined) {
    init.body = JSON.stringify(request.body);
    init.headers = { ...request.headers, "content-type": "application/json" };
  }
  const response = await fetch(request.url, init);
  const reader = response.body?.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  if (reader) {
    for (;;) {
      const part = await reader.read();
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > 1_048_576) { await reader.cancel(); throw new ProviderUnavailableError("Channel response exceeds size limit"); }
      chunks.push(part.value);
    }
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  request.verifyResponse?.(raw, response.headers);
  if (!response.ok) {
    if (request.verifyResponse && response.status === 404) {
      let code: unknown;
      try { code = JSON.parse(raw)?.code; } catch { /* Invalid errors remain unavailable. */ }
      if (code === "ORDER_NOT_EXIST" || code === 'RESOURCE_NOT_EXISTS') throw new VerifiedChannelError(404, code);
    }
    throw new ProviderUnavailableError(
      `WeChat channel request failed with status ${response.status}`,
    );
  }
  try {
    return response.status === 204 ? {} : JSON.parse(raw);
  } catch {
    throw new ProviderUnavailableError("WeChat channel returned invalid JSON");
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    throw new ProviderUnavailableError("WeChat channel returned invalid payload");
  }
  return value as Record<string, unknown>;
}

function throwIfWechatError(
  response: Record<string, unknown>,
  capability: string,
): void {
  const errcode = response.errcode;
  if (typeof errcode === "number" && errcode !== 0) {
    throw new ProviderUnavailableError(
      `WeChat ${capability} failed with errcode ${errcode}`,
    );
  }
}
