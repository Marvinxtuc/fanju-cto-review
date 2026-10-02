import { createCipheriv, createSign, generateKeyPairSync, randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyPaymentNotification, verifyRefundNotification } from "./wechat-pay.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const FIXTURE_KEY = "0123456789abcdef0123456789abcdef";
const NOW_SECONDS = 1_800_000_000;

describe("WeChat Pay v3 notifications", () => {
  it("verifies and decrypts a successful payment notification", () => {
    const fixture = signedNotification({ out_trade_no: "pay_local_001", transaction_id: "wechat_transaction_001", trade_state: "SUCCESS", amount: { total: 9900 } });
    expect(verifyPaymentNotification(fixture.body, fixture.headers, config())).toEqual({ paidAt: "2026-09-29T00:00:00.000Z", merchantOrderNo: "pay_local_001", channelTradeNo: "wechat_transaction_001", amountCents: 9900, callbackNonce: "notification-nonce", eventId: "fixture-event" });
  });

  it("requires a valid signed payment success time", () => {
    const fixture = signedNotification({ out_trade_no: "pay_local_001", transaction_id: "wechat_transaction_001", trade_state: "SUCCESS", success_time: "invalid", amount: { total: 9900 } });
    expect(() => verifyPaymentNotification(fixture.body, fixture.headers, config())).toThrow("payment time");
  });

  it("rejects altered bodies and stale timestamps before state can change", () => {
    const fixture = signedNotification({ out_trade_no: "pay_local_002", transaction_id: "wechat_transaction_002", trade_state: "SUCCESS", amount: { total: 9900 } });
    expect(() => verifyPaymentNotification(`${fixture.body} `, fixture.headers, config())).toThrow(/signature verification failed/);
    expect(() => verifyPaymentNotification(fixture.body, fixture.headers, config({ now: () => 0 }))).toThrow(/timestamp/);
  });

  it("verifies a refund notification with the official amount shape and no currency", () => {
    const fixture = signedNotification({ transaction_id: "original-trade", out_refund_no: "refund_local_001", refund_id: "wechat_refund_001", refund_status: "SUCCESS", amount: { total: 9900, refund: 9900, payer_total: 9900, payer_refund: 9900 } });
    expect(verifyRefundNotification(fixture.body, fixture.headers, config())).toEqual({ refundedAt: "2026-09-29T00:00:00.000Z", originalTradeNo: "original-trade", merchantRefundNo: "refund_local_001", channelRefundNo: "wechat_refund_001", amountCents: 9900, callbackNonce: "notification-nonce", eventId: "fixture-event" });
  });
  it.each([undefined, "USD"])("rejects payment currency %s", currency => {
    const fixture = signedNotification({ out_trade_no: "pay_local_001", transaction_id: "wechat_transaction_001", trade_state: "SUCCESS", amount: { total: 9900, currency } });
    expect(() => verifyPaymentNotification(fixture.body, fixture.headers, config())).toThrow("currency");
  });
  it('preserves missing refund time and rejects a malformed signed time',()=>{
    const base={transaction_id:'original-trade',out_refund_no:'refund_local_001',refund_id:'wechat_refund_001',refund_status:'SUCCESS',amount:{refund:9900}};
    const missing=signedNotification({...base,success_time:undefined});expect(verifyRefundNotification(missing.body,missing.headers,config()).refundedAt).toBeUndefined();
    const invalid=signedNotification({...base,success_time:'invalid'});expect(()=>verifyRefundNotification(invalid.body,invalid.headers,config())).toThrow('payment time');
  });
  it("rejects an explicitly conflicting currency in a refund extension", () => {
    const fixture = signedNotification({ transaction_id: "original-trade", out_refund_no: "refund_local_001", refund_id: "wechat_refund_001", refund_status: "SUCCESS", amount: { refund: 9900, currency: "USD" } });
    expect(() => verifyRefundNotification(fixture.body, fixture.headers, config())).toThrow("currency");
  });
});

function config(overrides: Partial<{ now: () => number }> = {}) { return { certificateSerial: "fixture-serial", expectedMerchantId: "test_mch_id", expectedAppId: "wx_test_app_id", apiV3Key: FIXTURE_KEY, platformCertificate: publicKey, now: () => NOW_SECONDS * 1000, ...overrides }; }

function signedNotification(resource: Record<string, unknown>) {
  resource = { success_time: "2026-09-29T08:00:00+08:00", mchid: "test_mch_id", appid: "wx_test_app_id", ...resource, amount: { ...(resource.refund_status ? {} : { currency: "CNY" }), ...(resource.amount as object) } };
  const nonce = randomBytes(12).toString("base64url").slice(0, 12);
  const associatedData = "transaction";
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(FIXTURE_KEY), Buffer.from(nonce));
  cipher.setAAD(Buffer.from(associatedData));
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(resource), "utf8"), cipher.final(), cipher.getAuthTag()]).toString("base64");
  const body = JSON.stringify({ id: "fixture-event", event_type: resource.refund_status ? "REFUND.SUCCESS" : "TRANSACTION.SUCCESS", resource: { algorithm: "AEAD_AES_256_GCM", associated_data: associatedData, nonce, ciphertext: encrypted } });
  const signer = createSign("RSA-SHA256");
  signer.update(`${NOW_SECONDS}\nnotification-nonce\n${body}\n`);
  signer.end();
  return { body, headers: { "wechatpay-serial": "fixture-serial", "wechatpay-timestamp": String(NOW_SECONDS), "wechatpay-nonce": "notification-nonce", "wechatpay-signature": signer.sign(privateKey, "base64") } };
}
