import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createWechatProviders, ProviderConfigError, VerifiedChannelError, type ProviderHttpRequest } from "./providers.js";

describe("wechat provider configuration", () => {
  it("defaults to mock providers in local development", () => {
    const providers = createWechatProviders({
      NODE_ENV: "development",
      APP_ENV: "local",
    });

    expect(providers.auth.mode).toBe("mock");
    expect(providers.phone.mode).toBe("mock");
    expect(providers.payment.mode).toBe("mock");
    expect(providers.refund.mode).toBe("mock");
  });

  it("rejects mock payment in production unless explicitly allowed", () => {
    expect(() =>
      createWechatProviders({
        NODE_ENV: "production",
        APP_ENV: "production",
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow(ProviderConfigError);
  });

  it("rejects wechat payment provider when required config is missing", () => {
    expect(() =>
      createWechatProviders({
        NODE_ENV: "development",
        APP_ENV: "local",
        PAYMENT_PROVIDER: "wechat",
        WECHAT_PAY_ENABLED: "true",
      }),
    ).toThrow(/Missing required WeChat Pay configuration/);
  });

  it("rejects wechat auth provider when miniapp config is missing", () => {
    expect(() =>
      createWechatProviders({
        AUTH_PROVIDER: "wechat",
        PAYMENT_PROVIDER: "mock",
      }),
    ).toThrow(/Missing required WeChat Mini Program configuration/);
  });

  it("exchanges wechat login code with the jscode2session endpoint", async () => {
    const calls: Array<{ url: string; method: string }> = [];
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async (request) => {
          calls.push({ url: request.url, method: request.method ?? "GET" });
          return { openid: "mock_provider_openid_a", unionid: "mock_union_a" };
        },
      },
    );

    const identity = await providers.auth.exchangeLoginCode({ code: "login-code" });

    expect(identity).toEqual({
      provider: "wechat",
      openid: "mock_provider_openid_a",
      unionid: "mock_union_a",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toContain("/sns/jscode2session");
    expect(calls[0]?.url).toContain("grant_type=authorization_code");
    expect(calls[0]?.url).not.toContain("session_key");
  });

  it("rejects wechat auth errors without falling back to mock", async () => {
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async () => ({ errcode: 40029, errmsg: "invalid code" }),
      },
    );

    await expect(
      providers.auth.exchangeLoginCode({ code: "bad-code" }),
    ).rejects.toThrow(/WeChat auth failed with errcode 40029/);
  });

  it("rejects empty wechat login code before calling the channel", async () => {
    let called = false;
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async () => {
          called = true;
          return {};
        },
      },
    );

    await expect(
      providers.auth.exchangeLoginCode({ code: "" }),
    ).rejects.toThrow(/WeChat login code is required/);
    expect(called).toBe(false);
  });

  it("exchanges wechat phone code with access token and getuserphonenumber", async () => {
    const calls: Array<{ url: string; method: string; body?: unknown }> = [];
    const providers = createWechatProviders(
      {
        PHONE_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async (request) => {
          calls.push(request);
          if (request.url.includes("/cgi-bin/token")) {
            return { access_token: "mock_access_token", expires_in: 7200 };
          }
          return {
            errcode: 0,
            errmsg: "ok",
            phone_info: {
              phoneNumber: "13500135000",
              purePhoneNumber: "13500135000",
              countryCode: "86",
            },
          };
        },
      },
    );

    const result = await providers.phone.resolvePhone({ code: "phone-code" });

    expect(result).toEqual({
      provider: "wechat",
      phone: "13500135000",
      phoneNumber: "13500135000",
      purePhoneNumber: "13500135000",
      countryCode: "86",
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]?.url).toContain("/cgi-bin/token");
    expect(calls[1]?.url).toContain("/wxa/business/getuserphonenumber");
    expect(calls[1]?.method).toBe("POST");
    expect(calls[1]?.body).toEqual({ code: "phone-code" });
  });

  it("rejects wechat phone errors without returning a mock phone", async () => {
    const providers = createWechatProviders(
      {
        PHONE_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async (request) => {
          if (request.url.includes("/cgi-bin/token")) {
            return { access_token: "mock_access_token", expires_in: 7200 };
          }
          return { errcode: 40029, errmsg: "invalid code" };
        },
      },
    );

    await expect(
      providers.phone.resolvePhone({ code: "bad-phone-code" }),
    ).rejects.toThrow(/WeChat phone failed with errcode 40029/);
  });

  it("does not fall back from wechat auth provider to mock", async () => {
    const providers = createWechatProviders(
      {
        AUTH_PROVIDER: "wechat",
        WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
        WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        PAYMENT_PROVIDER: "mock",
      },
      {
        httpClient: async () => ({ errcode: 40029, errmsg: "invalid code" }),
      },
    );

    await expect(providers.auth.exchangeLoginCode({ code: "code" })).rejects.toThrow(
      /WeChat auth failed with errcode 40029/,
    );
  });

  it("creates a signed JSAPI payment request without trusting a client amount", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const calls: Array<{ url: string; method: string; body?: unknown; headers?: Record<string, string> }> = [];
    const providers = createWechatProviders(
      wechatPayEnv(),
      {
        readFile: () => privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        httpClient: async (request) => {
          calls.push(request);
          return { prepay_id: "wx_prepay_001" };
        },
      },
    );

    const payment = await providers.payment.createPayment({
      merchantOrderNo: "order_001",
      amountCents: 9900,
      openid: "openid_001",
    });

    expect(payment).toMatchObject({ channel: "wechat", prepayId: "wx_prepay_001" });
    expect(payment.paymentParams).toMatchObject({ appId: "wx_test_app_id", package: "prepay_id=wx_prepay_001", signType: "RSA" });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      url: "https://api.mch.weixin.qq.com/v3/pay/transactions/jsapi",
      method: "POST",
      body: {
        appid: "wx_test_app_id",
        mchid: "test_mch_id",
        out_trade_no: "order_001",
        amount: { total: 9900, currency: "CNY" },
        payer: { openid: "openid_001" },
      },
    });
    expect(calls[0]?.headers?.authorization).toContain("WECHATPAY2-SHA256-RSA2048");
    expect(calls[0]?.headers?.authorization).not.toContain("test_api_v3_key");
  });

  it("creates a signed partial refund with the verified original payment total", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const calls: Array<{ url: string; method: string; body?: unknown; headers?: Record<string, string> }> = [];
    const providers = createWechatProviders(
      wechatPayEnv(),
      {
        readFile: () => privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        httpClient: async (request) => {
          calls.push(request);
          if (request.method === "GET") return { out_trade_no: "order_001", mchid: wechatPayEnv().WECHAT_PAY_MCH_ID,
            appid: wechatPayEnv().WECHAT_MINIAPP_APP_ID, trade_state: "SUCCESS", transaction_id: "wx_trade_original",
            success_time: "2026-07-20T10:00:00+08:00", amount: { total: 19900, currency: "CNY" } };
          return { refund_id: "wx_refund_001" };
        },
      },
    );

    const refund = await providers.refund.createRefund({
      merchantRefundNo: "refund_001",
      merchantOrderNo: "order_001",
      amountCents: 9900,
    });

    expect(refund).toEqual({ channel: "wechat", channelRefundNo: "wx_refund_001" });
    expect(calls[0]?.method).toBe("GET");
    expect(calls[1]).toMatchObject({
      url: "https://api.mch.weixin.qq.com/v3/refund/domestic/refunds",
      method: "POST",
      body: {
        out_refund_no: "refund_001",
        out_trade_no: "order_001",
        amount: { refund: 9900, total: 19900, currency: "CNY" },
      },
    });
    expect(calls[1]?.headers?.authorization).toContain("WECHATPAY2-SHA256-RSA2048");
  });

  it.each(["NOTPAY", "CLOSED", "SUCCESS"])("does not send a refund when original payment is %s or amount is excessive", async state => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const calls: ProviderHttpRequest[] = [];
    const providers = createWechatProviders(wechatPayEnv(), { readFile: () => privateKey.export({type:"pkcs8",format:"pem"}).toString(),
      httpClient: async request => { calls.push(request); return { out_trade_no:"order_001",mchid:wechatPayEnv().WECHAT_PAY_MCH_ID,
        appid:wechatPayEnv().WECHAT_MINIAPP_APP_ID,trade_state:state,transaction_id:"original-trade",
        success_time:"2026-07-20T10:00:00+08:00",amount:{total:100,currency:"CNY"} }; } });
    await expect(providers.refund.createRefund({merchantRefundNo:"refund_001",merchantOrderNo:"order_001",amountCents:101})).rejects.toThrow();
    expect(calls).toHaveLength(1);expect(calls[0]?.method).toBe("GET");
  });

  it("does not silently succeed when wechat payment provider is configured without a channel response", async () => {
    const providers = createWechatProviders({
      PAYMENT_PROVIDER: "wechat",
      REFUND_PROVIDER: "wechat",
      WECHAT_PAY_ENABLED: "true",
      WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
      WECHAT_PAY_MCH_ID: "test_mch_id",
      WECHAT_PAY_API_V3_KEY: "test_api_v3_key",
      WECHAT_PAY_PRIVATE_KEY_PATH: "/tmp/test-wechat-pay-key.pem",
      WECHAT_PAY_CERT_SERIAL_NO: "test_cert_serial",
      WECHAT_PAY_PLATFORM_CERT_PATH: "/tmp/test-wechat-pay-platform-cert.pem",
      WECHAT_PAY_CALLBACK_URL: "https://example.invalid/pay",
      WECHAT_REFUND_CALLBACK_URL: "https://example.invalid/refund",
    });

    expect(providers.payment.mode).toBe("wechat");
    expect(providers.refund.mode).toBe("wechat");
    await expect(providers.payment.createPayment({ merchantOrderNo: "order", amountCents: 9900, openid: "openid" })).rejects.toThrow();
    await expect(providers.refund.createRefund({ merchantRefundNo: "refund", merchantOrderNo: "order", amountCents: 9900 })).rejects.toThrow();
  });
});

function wechatPayEnv() {
  return {
    PAYMENT_PROVIDER: "wechat",
    REFUND_PROVIDER: "wechat",
    WECHAT_PAY_ENABLED: "true",
    WECHAT_MINIAPP_APP_ID: "wx_test_app_id",
    WECHAT_PAY_MCH_ID: "test_mch_id",
    WECHAT_PAY_API_V3_KEY: "test_api_v3_key",
    WECHAT_PAY_PRIVATE_KEY_PATH: "/tmp/test-wechat-pay-key.pem",
    WECHAT_PAY_CERT_SERIAL_NO: "test_cert_serial",
    WECHAT_PAY_PLATFORM_CERT_PATH: "/tmp/test-wechat-pay-platform-cert.pem",
    WECHAT_PAY_CALLBACK_URL: "https://example.invalid/pay",
    WECHAT_REFUND_CALLBACK_URL: "https://example.invalid/refund",
  };
}

describe("offline funding recovery protocols", () => {
  it('blocks signed closure HTTP when final send authority is revoked',async()=>{
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});let reads=0;const calls:ProviderHttpRequest[]=[];
    const provider=createWechatProviders(wechatPayEnv(),{readFile:()=>{reads++;return privateKey.export({type:'pkcs8',format:'pem'}).toString();},httpClient:async request=>{calls.push(request);return {};}});
    await expect(provider.payment.closePayment!('synthetic-close',async()=>{expect(reads).toBeGreaterThan(0);throw Error('closure-authority-revoked');})).rejects.toThrow('authority-revoked');
    expect(calls).toHaveLength(0);
    await provider.payment.closePayment!('synthetic-close',async()=>{});expect(calls).toHaveLength(1);expect(calls[0]?.method).toBe('POST');
  });

  it('rechecks the send guard after original-payment query and refuses POST when lease is lost',async()=>{
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});const calls:ProviderHttpRequest[]=[];
    const provider=createWechatProviders(wechatPayEnv(),{readFile:()=>privateKey.export({type:'pkcs8',format:'pem'}).toString(),httpClient:async request=>{
      calls.push(request);return {out_trade_no:'synthetic-order',mchid:'test_mch_id',appid:'wx_test_app_id',trade_state:'SUCCESS',transaction_id:'synthetic-trade',success_time:'2026-10-01T10:00:00+08:00',amount:{total:100,currency:'CNY'}};
    }});
    await expect(provider.refund.createRefund({merchantRefundNo:'synthetic-refund',merchantOrderNo:'synthetic-order',amountCents:40},async()=>{expect(calls).toHaveLength(1);throw Error('synthetic-lease-lost');})).rejects.toThrow('lease-lost');
    expect(calls).toHaveLength(1);expect(calls[0]?.method).toBe('GET');
  });
  it("maps only verified official refund absence",async()=>{
    const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
    const provider=createWechatProviders(wechatPayEnv(),{readFile:()=>privateKey.export({type:'pkcs8',format:'pem'}).toString(),
      httpClient:async()=>{throw new VerifiedChannelError(404,'RESOURCE_NOT_EXISTS');}});
    expect(await provider.refund.queryRefund!('synthetic-refund')).toEqual({merchantRefundNo:'synthetic-refund',status:'NOT_FOUND'});
    await expect(provider.payment.queryPayment!('synthetic-order')).rejects.toThrow();
  });
  it.each([new Error('RESOURCE_NOT_EXISTS'),{status:404,code:'RESOURCE_NOT_EXISTS'},new VerifiedChannelError(500,'RESOURCE_NOT_EXISTS'),new VerifiedChannelError(404,'ORDER_NOT_EXIST')])
    ('rejects untrusted or unrelated refund absence %j',async error=>{
      const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});
      const provider=createWechatProviders(wechatPayEnv(),{readFile:()=>privateKey.export({type:'pkcs8',format:'pem'}).toString(),httpClient:async()=>{throw error;}});
      await expect(provider.refund.queryRefund!('synthetic-refund')).rejects.toBe(error);
    });
  it("queries the same merchant payment number and signs GET without a request body", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const calls: import("./providers.js").ProviderHttpRequest[] = [];
    const providers = createWechatProviders(wechatPayEnv(), { readFile: () => privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      httpClient: async request => { calls.push(request); return { out_trade_no: "original/order", mchid: "test_mch_id", appid: "wx_test_app_id", transaction_id: "channel-one", trade_state: "SUCCESS", success_time: "2026-09-29T08:00:00+08:00", amount: { total: 9900, currency: "CNY" } }; } });
    expect(await providers.payment.queryPayment!("original/order")).toMatchObject({ status: "SUCCEEDED", merchantOrderNo: "original/order", channelTradeNo: "channel-one", amountCents: 9900 });
    expect(calls[0]?.url).toContain("out-trade-no/original%2Forder?mchid=test_mch_id");
    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.body).toBeUndefined();
    expect(calls[0]?.verifyResponse).toBeTypeOf("function");
    await expect(providers.payment.queryPayment!("another-order")).rejects.toThrow("identity mismatch");
  });
  it("maps a verified missing order without treating network errors as absence", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    let missing = true;
    const providers = createWechatProviders(wechatPayEnv(), {
      readFile: () => privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      httpClient: async () => { if (missing) throw new VerifiedChannelError(404, "ORDER_NOT_EXIST"); throw new Error("network failure"); },
    });
    expect(await providers.payment.queryPayment!("original-order")).toEqual({ merchantOrderNo: "original-order", status: "NOT_FOUND" });
    missing = false;
    await expect(providers.payment.queryPayment!("original-order")).rejects.toThrow("network failure");
  });
  it("closes by the original number and verifies refund associations", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const calls: import("./providers.js").ProviderHttpRequest[] = [];
    const providers = createWechatProviders(wechatPayEnv(), { readFile: () => privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
      httpClient: async request => { calls.push(request); return request.method === "POST" ? {} : { out_refund_no: "refund-one", refund_id: "channel-refund", transaction_id: "original-trade", status: "SUCCESS", amount: { refund: 9900, currency: "CNY" } }; } });
    await providers.payment.closePayment!("original-order");
    expect(calls[0]?.url).toContain("out-trade-no/original-order/close");
    expect(calls[0]?.body).toEqual({ mchid: "test_mch_id" });
    expect(await providers.refund.queryRefund!("refund-one")).toMatchObject({ status: "SUCCEEDED", originalTradeNo: "original-trade", channelRefundNo: "channel-refund" });
    await expect(providers.refund.queryRefund!("other-refund")).rejects.toThrow("identity mismatch");
  });
});

it('normalizes successful refund completion time and rejects malformed supplied time',async()=>{
 const {privateKey}=generateKeyPairSync('rsa',{modulusLength:2048});let time:unknown=undefined;
 const providers=createWechatProviders(wechatPayEnv(),{readFile:()=>privateKey.export({type:'pkcs8',format:'pem'}).toString(),httpClient:async()=>({out_refund_no:'refund-time',refund_id:'channel-time',transaction_id:'trade-time',status:'SUCCESS',amount:{refund:100,currency:'CNY'},...(time===undefined?{}:{success_time:time})})});
 expect((await providers.refund.queryRefund!('refund-time'))).not.toHaveProperty('refundedAt');time='2026-09-30T10:00:00+08:00';expect(await providers.refund.queryRefund!('refund-time')).toHaveProperty('refundedAt','2026-09-30T02:00:00.000Z');time='invalid-time';await expect(providers.refund.queryRefund!('refund-time')).rejects.toThrow('time');
});
