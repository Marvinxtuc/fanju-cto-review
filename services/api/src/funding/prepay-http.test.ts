import { createHash, generateKeyPairSync, randomUUID } from "node:crypto";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { fundingTestDatabase } from "../../test-support/funding-db.js";
import { buildApp } from "../app.js";
import { signSession } from "../auth.js";
import { VerifiedChannelError } from "../providers.js";
const suite = process.env.RUN_DB_TESTS === "1" ? describe : describe.skip;
const fixture = fundingTestDatabase();
const { db } = fixture;
suite("HTTP payment response persistence recovery", () => {
  beforeAll(fixture.setup); afterAll(fixture.close);
  it("retains intent after storage failure, reuses the original merchant number, and stops parameters at MANUAL", async () => {
    const user = await db.user.create({ data: { wechatOpenid: `mock_${randomUUID()}` } });
    const restaurant = await db.restaurant.create({ data: { name: "测试餐厅", district: "测试区", businessArea: "测试区", address: "测试地址", contactName: "测试负责人", contactPhone: "13800138000", budgetCents: 9900, capacity: 6, cuisineTags: [] } });
    const activity = await db.activity.create({ data: { restaurantId: restaurant.id, title: "菜单体验", theme: "菜单体验", description: "菜单体验", district: "测试区", businessArea: "测试区", startsAt: new Date(Date.now() + 172800000), endsAt: new Date(Date.now() + 180000000), registrationEndsAt: new Date(Date.now() + 86400000), serviceFeeCents: 9900, mealFeePolicyText: "现场结算", capacity: 6, status: "REGISTRATION_OPEN" } });
    const order = await db.order.create({ data: { userId: user.id, activityId: activity.id, amountCents: 9900, agreementVersion: "v1" } });
    const billScope = createHash("sha256").update("test_mch_id:wx_test_app_id").digest("hex");
    await db.reconciliationBatch.create({ data: { merchantScope: billScope, period: "2026-09-30",
      sourceHash: "offline-fixture-complete-bill", coverageState: "COMPLETE" } });
    const dir = await mkdtemp(join(tmpdir(), "fanju-prepay-fixture-"));
    const keyPath = join(dir, "synthetic-key.pem");
    await writeFile(keyPath, generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" }), { mode: 0o600 });
    const merchantNumbers: string[] = [];
    let accepted = false;
    const app = await buildApp({ prisma: db, providerEnv: {
      FINANCIAL_CASE_OWNER: "fixture-operator", APP_ENV: "ci", NODE_ENV: "test", AUTH_PROVIDER: "wechat", PHONE_PROVIDER: "wechat", PAYMENT_PROVIDER: "wechat", REFUND_PROVIDER: "wechat",
      SESSION_SECRET: "test-session-signing-material-32-bytes", WECHAT_MINIAPP_APP_ID: "wx_test_app_id", WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
      WECHAT_PAY_ENABLED: "true", FEATURE_REAL_WECHAT_PAY: "true", NEW_PAYMENTS_ENABLED: "true", REAL_PAYMENT_APPROVAL_ID: "offline-fixture-only",
      REAL_PAYMENT_ALLOWED_USER_IDS: user.id, REAL_PAYMENT_MAX_AMOUNT_CENTS: "9900", WECHAT_PAY_MCH_ID: "test_mch_id", WECHAT_PAY_API_V3_KEY: "test_api_v3_key",
      REQUIRED_BILL_SCOPE: billScope, REQUIRED_BILL_PERIOD: "2026-09-30",
      WECHAT_PAY_PRIVATE_KEY_PATH: keyPath, WECHAT_PAY_CERT_SERIAL_NO: "fixture", WECHAT_PAY_PLATFORM_CERT_PATH: "/unused-offline-fixture",
      WECHAT_PAY_CALLBACK_URL: "https://example.invalid/pay", WECHAT_REFUND_CALLBACK_URL: "https://example.invalid/refund",
    }, providerHttpClient: async request => {
      // All provider calls terminate in this fixture. No fetch or WeChat network is used.
      if (request.method === "GET") {
        if (!accepted) throw new VerifiedChannelError(404, "ORDER_NOT_EXIST");
        return { out_trade_no: merchantNumbers[0], mchid: "test_mch_id", appid: "wx_test_app_id", trade_state: "NOTPAY", amount: { total: 9900, currency: "CNY" } };
      }
      const body = request.body as { out_trade_no: string };
      merchantNumbers.push(body.out_trade_no);accepted = true;
      return { prepay_id: "synthetic-prepay" };
    } });
    try {
      const origin = await app.listen({ host: "127.0.0.1", port: 0 });
      const token = signSession(app, { sub: user.id, role: "USER" });
      const pay = () => fetch(`${origin}/api/mock/payments`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ orderId: order.id }), signal: AbortSignal.timeout(5000) });
      await db.$executeRawUnsafe(`CREATE FUNCTION fail_http_prepay() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW."prepayId" IS NOT NULL THEN RAISE EXCEPTION 'injected storage failure'; END IF; RETURN NEW; END $$`);
      await db.$executeRawUnsafe(`CREATE TRIGGER fail_http_prepay BEFORE UPDATE ON "Payment" FOR EACH ROW EXECUTE FUNCTION fail_http_prepay()`);
      expect((await pay()).status).toBe(500);
      const payment = await db.payment.findFirstOrThrow({ where: { orderId: order.id } });
      expect(payment.resolutionState).toBe("UNKNOWN");
      expect(await db.durableJob.count({ where: { refId: payment.id } })).toBe(1);
      await db.$executeRawUnsafe(`DROP TRIGGER fail_http_prepay ON "Payment"`);
      await db.$executeRawUnsafe(`DROP FUNCTION fail_http_prepay()`);
      const resumed = await pay();expect(resumed.status).toBe(200);
      const result = await resumed.json() as { paymentParams: { package: string } };
      expect(result.paymentParams.package).toBe("prepay_id=synthetic-prepay");
      expect(merchantNumbers).toEqual([payment.merchantOrderNo, payment.merchantOrderNo]);
      expect(await db.payment.count({ where: { orderId: order.id } })).toBe(1);
      await db.durableJob.update({ where: { businessKey: `payment:${payment.id}` }, data: { state: "MANUAL", attempts: 8 } });
      const manual = await (await pay()).json() as { requiresReview: boolean; paymentParams?: unknown };
      expect(manual.requiresReview).toBe(true);expect(manual.paymentParams).toBeUndefined();
      expect(merchantNumbers).toHaveLength(2);
      await db.reconciliationBatch.deleteMany({ where: { merchantScope: billScope } });
      expect((await pay()).status).toBe(503);
      expect(merchantNumbers).toHaveLength(2);
    } finally { await app.close(); await rm(dir, { recursive: true, force: true }); }
  });
});
