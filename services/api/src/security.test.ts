import { describe, expect, it, vi } from "vitest";
import { buildApp } from "./app.js";
import { localDemoEnabled } from "./config.js";
import type { PrismaClient } from "./generated/prisma/client.js";

describe("local demo isolation", () => {
  it("defaults closed and rejects ambiguous or real-provider demo configurations", () => {
    expect(localDemoEnabled({})).toBe(false);
    expect(localDemoEnabled({ APP_ENV: "local", NODE_ENV: "test", LOCAL_DEMO_ENABLED: "true" })).toBe(true);
    for (const override of [
      { NODE_ENV: "production" }, { APP_ENV: "production" }, { APP_ENV: "staging" },
      { LOCAL_DEMO_ENABLED: "yes" }, { AUTH_PROVIDER: "wechat" }, { PHONE_PROVIDER: "wechat" },
      { PAYMENT_PROVIDER: "wechat" }, { REFUND_PROVIDER: "wechat" }, { WECHAT_PAY_MODE: "wechat" },
      { WECHAT_PAY_ENABLED: "true" }, { FEATURE_REAL_WECHAT_PAY: "true" },
    ]) {
      expect(() => localDemoEnabled({ APP_ENV: "local", NODE_ENV: "test", LOCAL_DEMO_ENABLED: "true", ...override })).toThrow();
    }
  });

  it.each(["production", "test"])("omits demo routes and rejects even valid signed ops tokens in %s", async (mode) => {
    const upsert = vi.fn();
    const app = await buildApp({
      prisma: { adminUser: { upsert } } as unknown as PrismaClient,
      // Production configuration uses inert synthetic credentials; no external request is made.
      providerEnv: { SESSION_SECRET: "test-session-signing-material-32-bytes", NODE_ENV: mode, APP_ENV: mode,
        AUTH_PROVIDER: "wechat", PHONE_PROVIDER: "wechat", PAYMENT_PROVIDER: "wechat", REFUND_PROVIDER: "wechat",
        WECHAT_PAY_ENABLED: "true", WECHAT_MINIAPP_APP_ID: "wx_test_app_id", WECHAT_MINIAPP_APP_SECRET: "wx_test_secret",
        WECHAT_PAY_MCH_ID: "test_mch_id", WECHAT_PAY_API_V3_KEY: "test_api_v3_key", WECHAT_PAY_PRIVATE_KEY_PATH: "/unused-test-key",
        WECHAT_PAY_CERT_SERIAL_NO: "test_cert_serial", WECHAT_PAY_PLATFORM_CERT_PATH: "/unused-test-cert",
        WECHAT_PAY_CALLBACK_URL: "https://example.invalid/pay", WECHAT_REFUND_CALLBACK_URL: "https://example.invalid/refund",
      },
    });
    try {
      for (const url of ["/api/mock/admin-login", "/api/mock/payments/p/succeed", "/api/mock/refunds/r/succeed", "/api/mock/refunds/r/fail"]) {
        const response = await app.inject({ method: "POST", url, payload: { username: "attacker", role: "SUPER_ADMIN" } });
        expect(response.statusCode).toBe(404);
      }
      expect(upsert).not.toHaveBeenCalled();
      for (const role of ["OPS", "SUPER_ADMIN"]) {
        const token = app.jwt.sign({ sub: "old-demo-admin", role });
        for (const [method, url] of [["GET", "/api/ops/orders"], ["POST", "/api/ops/refunds/r/approve"], ["DELETE", "/api/ops/blacklist/u"]] as const) {
          expect((await app.inject({ method, url, headers: { authorization: `Bearer ${token}` } })).statusCode).toBe(403);
        }
      }
      for (const url of ["/api/mock/wechat-login", "/api/mock/phone", "/api/mock/payments", "/api/wechat/pay/notify", "/api/wechat/refund/notify"]) {
        expect(app.hasRoute({ method: "POST", url })).toBe(true);
      }
    } finally { await app.close(); }
  });
});
