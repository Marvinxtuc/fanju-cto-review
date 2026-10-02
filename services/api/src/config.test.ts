import { describe, expect, it } from "vitest";
import { assertBillScopeBinding, canStartRealPayment, validateRuntimeMode } from "./config.js";
function modes(a: string, p: string, pay: string, refund: string) {
  return { auth: { mode: a }, phone: { mode: p }, payment: { mode: pay }, refund: { mode: refund } };
}
describe("runtime provider and new payment configuration", () => {
  it("checks all sixteen provider combinations in local and production environments", () => {
    for (const auth of ["mock", "wechat"]) for (const phone of ["mock", "wechat"]) for (const payment of ["mock", "wechat"]) for (const refund of ["mock", "wechat"]) {
      const combination = modes(auth, phone, payment, refund);
      const validLocal = auth === phone && payment === refund && (payment !== "wechat" || auth === "wechat");
      const validProduction = [auth, phone, payment, refund].every(mode => mode === "wechat");
      for (const [env, valid] of [[{ APP_ENV: "local", NODE_ENV: "test" }, validLocal], [{ NODE_ENV: "production", ALLOW_MOCK_PAYMENT_IN_PRODUCTION: "true" }, validProduction], [{ APP_ENV: "production" }, validProduction]] as const) {
        if (valid) expect(() => validateRuntimeMode(env, combination)).not.toThrow();
        else expect(() => validateRuntimeMode(env, combination)).toThrow();
      }
    }
  });
  it("defaults new real payments closed and enforces allowlist and per-payment amount cap", () => {
    const env = { FINANCIAL_CASE_OWNER: "payments-operator", NEW_PAYMENTS_ENABLED: "true", FEATURE_REAL_WECHAT_PAY: "true", REAL_PAYMENT_APPROVAL_ID: "test-approval", REAL_PAYMENT_ALLOWED_USER_IDS: "user-one", REAL_PAYMENT_MAX_AMOUNT_CENTS: "100", REQUIRED_BILL_SCOPE: "mock-test", REQUIRED_BILL_PERIOD: "2026-09-30" };
    expect(canStartRealPayment({}, "user-one", 1)).toBe(false);
    expect(() => validateRuntimeMode({ NEW_PAYMENTS_ENABLED: "true" }, modes("wechat", "wechat", "wechat", "wechat"))).toThrow();
    expect(() => validateRuntimeMode(env, modes("wechat", "wechat", "wechat", "wechat"))).not.toThrow();
    expect(() => assertBillScopeBinding(env, "another-merchant")).toThrow("active payment merchant");
    expect(() => assertBillScopeBinding(env, "mock-test")).not.toThrow();
    expect(() => validateRuntimeMode({ ...env, REQUIRED_BILL_PERIOD: "" }, modes("wechat", "wechat", "wechat", "wechat"))).toThrow();
    for (const owner of [undefined, "", "  ", "local-review-required", "placeholder", "<负责人>"]) {
      const missingOwner = { ...env, FINANCIAL_CASE_OWNER: owner };
      expect(() => validateRuntimeMode(missingOwner, modes("wechat", "wechat", "wechat", "wechat"))).toThrow("case owner");
      expect(canStartRealPayment(missingOwner, "user-one", 100)).toBe(false);
    }
    expect(canStartRealPayment(env, "user-one", 100)).toBe(true);
    expect(canStartRealPayment(env, "user-two", 1)).toBe(false);
    expect(canStartRealPayment(env, "user-one", 101)).toBe(false);
    expect(canStartRealPayment({ ...env, NEW_PAYMENTS_ENABLED: "false" }, "user-one", 1)).toBe(false);
    expect(canStartRealPayment({ ...env, FEATURE_REAL_WECHAT_PAY: "false" }, "user-one", 1)).toBe(false);
  });
});
