import { describe, expect, it } from "vitest";

import { prepareProfileSubmission } from "./profile-form.js";

describe("profile form submission", () => {
  it("returns field errors for an incomplete form", () => {
    const result = prepareProfileSubmission({
      preferredAreas: "",
      availableTimes: "",
      tastePreferences: "",
      dietaryRestrictions: "",
      budgetRange: "",
      tableVibe: "",
      tableSizes: "",
      note: "",
    });

    expect(result).toEqual({
      fieldErrors: {
        preferredAreas: "请至少填写一个常去区域",
        availableTimes: "请至少填写一个方便时间",
        dietaryRestrictions: "请填写饮食限制；无也请填写“无”",
        budgetRange: "请填写餐费预算",
        tableVibe: "请填写饭局氛围",
        tableSizes: "请填写 4 至 8 人的可接受桌位人数",
      },
    });
  });

  it("accepts the form defaults and normalizes list fields", () => {
    const result = prepareProfileSubmission({
      preferredAreas: "徐汇，静安",
      availableTimes: "周六晚",
      tastePreferences: "本帮菜, 日料",
      dietaryRestrictions: "无",
      budgetRange: "150-250",
      tableVibe: "轻松聊天",
      tableSizes: "4, 6, 9",
      note: "  靠近地铁  ",
    });

    expect(result).toEqual({
      payload: {
        preferredAreas: ["徐汇", "静安"],
        availableTimes: ["周六晚"],
        tastePreferences: ["本帮菜", "日料"],
        dietaryRestrictions: ["无"],
        budgetRange: "150-250",
        tableVibe: "轻松聊天",
        acceptableTableSizes: [4, 6],
        note: "靠近地铁",
      },
    });
  });
});
