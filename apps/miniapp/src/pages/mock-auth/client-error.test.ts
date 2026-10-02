import { describe, expect, it } from "vitest";

import { formatClientError } from "./client-error.js";

describe("formatClientError", () => {
  it("shows a Taro-style errMsg so client-side request failures are actionable", () => {
    expect(formatClientError({ errMsg: "request:fail url not in domain list" }, "微信登录失败")).toBe(
      "微信登录失败：request:fail url not in domain list",
    );
  });

  it("redacts sensitive values before showing a client error", () => {
    expect(formatClientError({ errMsg: "request:fail code=abc123 token=secret" }, "手机号授权失败")).toBe(
      "手机号授权失败：request:fail code=已隐藏 token=已隐藏",
    );
  });

  it("keeps the fallback for unknown error shapes", () => {
    expect(formatClientError(null, "微信登录失败")).toBe("微信登录失败");
  });
});
