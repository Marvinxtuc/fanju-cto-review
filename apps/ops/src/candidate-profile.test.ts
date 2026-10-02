import { describe, expect, it } from "vitest";
import { formatCandidateProfile } from "./candidate-profile.js";

describe("formatCandidateProfile", () => {
  it("only formats table-planning preferences and includes budget and table sizes", () => {
    expect(formatCandidateProfile({
      preferredAreas: ["徐汇", "静安"],
      availableTimes: ["周六晚"],
      tastePreferences: ["本帮菜"],
      dietaryRestrictions: ["无"],
      budgetRange: "150-250",
      tableVibe: "轻松聊天",
      acceptableTableSizes: [4, 6],
    })).toBe("徐汇 / 静安 · 周六晚 · 预算 150-250 · 轻松聊天 · 可接受 4 / 6 人桌 · 饮食限制 无");
  });
});
