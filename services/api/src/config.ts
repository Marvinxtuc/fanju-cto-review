import type { ProviderEnv } from "./providers.js";

/** Demo routes can mutate arbitrary mock records; enable only in an isolated local environment. */
export function localDemoEnabled(env: ProviderEnv): boolean {
  if (env.LOCAL_DEMO_ENABLED !== undefined && !["true", "false"].includes(env.LOCAL_DEMO_ENABLED)) {
    throw new Error("LOCAL_DEMO_ENABLED must be true or false");
  }
  if (env.LOCAL_DEMO_ENABLED !== "true") return false;
  if (env.APP_ENV !== "local" || !["development", "test"].includes(env.NODE_ENV ?? "")) {
    throw new Error("Demo routes require APP_ENV=local and NODE_ENV=development or test");
  }
  const payment = env.PAYMENT_PROVIDER ?? env.WECHAT_PAY_MODE ?? "mock";
  const refund = env.REFUND_PROVIDER ?? payment;
  if ([env.AUTH_PROVIDER ?? "mock", env.PHONE_PROVIDER ?? "mock", payment, refund].some(mode => mode !== "mock") ||
      env.WECHAT_PAY_ENABLED === "true" || env.FEATURE_REAL_WECHAT_PAY === "true") {
    throw new Error("Demo routes require exclusively mock providers and real payment flags disabled");
  }
  return true;
}

/** Validate application combinations after individual providers validate their own credentials. */
export function validateRuntimeMode(env: ProviderEnv, modes: { auth: { mode: string }; phone: { mode: string }; payment: { mode: string }; refund: { mode: string } }): void {
  const production = env.NODE_ENV === "production" || env.APP_ENV === "production";
  const { auth, phone, payment, refund } = modes;
  const isolated = (env.APP_ENV === "local" && ["development", "test"].includes(env.NODE_ENV ?? "")) ||
    (env.APP_ENV === "ci" && env.NODE_ENV === "test");
  if (!isolated && [auth, phone, payment, refund].some(provider => provider.mode === "mock")) {
    throw new Error("Mock providers require an explicit isolated local or CI environment");
  }
  if (production && [auth, phone, payment, refund].some(provider => provider.mode !== "wechat")) {
    throw new Error("Production requires WeChat identity, phone, payment and refund providers");
  }
  if (auth.mode !== phone.mode || payment.mode !== refund.mode) {
    throw new Error("Identity/phone and payment/refund provider pairs must match");
  }
  if (payment.mode === "wechat" && auth.mode !== "wechat") {
    throw new Error("Real funding requires real identity providers");
  }
  for (const key of ["NEW_PAYMENTS_ENABLED", "FEATURE_REAL_WECHAT_PAY"]) {
    if (env[key] !== undefined && !["true", "false"].includes(env[key]!)) throw new Error(`${key} must be true or false`);
  }
  if (env.NEW_PAYMENTS_ENABLED === "true") {
    if (payment.mode !== "wechat" || env.FEATURE_REAL_WECHAT_PAY !== "true" ||
        !hasFinancialCaseOwner(env) || !env.REAL_PAYMENT_APPROVAL_ID?.trim() || !env.REAL_PAYMENT_ALLOWED_USER_IDS?.trim() ||
        !env.REQUIRED_BILL_SCOPE?.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(env.REQUIRED_BILL_PERIOD ?? "") ||
        !/^[1-9]\d*$/.test(env.REAL_PAYMENT_MAX_AMOUNT_CENTS ?? "") ||
        !Number.isSafeInteger(Number(env.REAL_PAYMENT_MAX_AMOUNT_CENTS))) {
      throw new Error("New real payments require case owner, approval reference, allowlist, amount cap and enabled channel");
    }
  }
}

export function hasFinancialCaseOwner(env: ProviderEnv): boolean {
  const owner = env.FINANCIAL_CASE_OWNER?.trim();
  return Boolean(owner && owner.length <= 100 && !/^(local-review-required|unassigned|unknown|todo|placeholder|待配置|负责人|<.*>)$/i.test(owner));
}

export function assertBillScopeBinding(env: ProviderEnv, actualScope: string): void {
  if (env.NEW_PAYMENTS_ENABLED === "true" && env.REQUIRED_BILL_SCOPE !== actualScope) {
    throw new Error("Required bill scope must match the active payment merchant");
  }
}

export function canStartRealPayment(env: ProviderEnv, userId: string, amountCents: number): boolean {
  return env.NEW_PAYMENTS_ENABLED === "true" && env.FEATURE_REAL_WECHAT_PAY === "true" &&
    hasFinancialCaseOwner(env) && Boolean(env.REAL_PAYMENT_APPROVAL_ID?.trim()) &&
    (env.REAL_PAYMENT_ALLOWED_USER_IDS ?? "").split(",").map(value => value.trim()).includes(userId) &&
    Number.isSafeInteger(amountCents) && amountCents > 0 && amountCents <= Number(env.REAL_PAYMENT_MAX_AMOUNT_CENTS);
}
