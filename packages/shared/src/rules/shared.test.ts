import { describe, expect, it } from "vitest";
import {
  assertActivityTransition,
  assertOrderTransition,
  evaluateRefundDecision,
  evaluateTableFormation,
  findForbiddenVisibleCopyWords,
  getActivityInfoVisibility,
  isUserVisibleActivity,
  calculateOrderAmountCents,
} from "../index.js";

describe("forbidden visible copy", () => {
  it("allows restaurant-experience copy", () => {
    expect(findForbiddenVisibleCopyWords("周末两小时兴趣餐桌体验")).toEqual([]);
  });

  it("finds forbidden positioning words", () => {
    expect(findForbiddenVisibleCopyWords("来这里脱单找对象")).toEqual([
      { word: "脱单", index: 3 },
      { word: "找对象", index: 5 },
    ]);
  });
});

describe("activity status", () => {
  it("allows publish flow and hides drafts", () => {
    expect(() => assertActivityTransition("draft", "published")).not.toThrow();
    expect(isUserVisibleActivity("draft")).toBe(false);
    expect(isUserVisibleActivity("published")).toBe(true);
  });

  it("rejects terminal transitions", () => {
    expect(() => assertActivityTransition("completed", "canceled")).toThrow(
      "Invalid activity transition",
    );
  });
});

describe("order status", () => {
  it("allows payment success once", () => {
    expect(() =>
      assertOrderTransition("pending_payment", "paid_pending_group"),
    ).not.toThrow();
  });

  it("rejects paying closed orders", () => {
    expect(() => assertOrderTransition("closed", "paid_pending_group")).toThrow(
      "Invalid order transition",
    );
  });
});

describe("table formation", () => {
  it("forms a standard six-person table", () => {
    expect(evaluateTableFormation(6)).toEqual({
      canForm: true,
      tableSizes: [6],
      unassignedCount: 0,
    });
  });

  it("splits nine people into two valid tables", () => {
    expect(evaluateTableFormation(9)).toEqual({
      canForm: true,
      tableSizes: [5, 4],
      unassignedCount: 0,
    });
  });

  it("does not form with three people", () => {
    expect(evaluateTableFormation(3)).toEqual({
      canForm: false,
      reason: "below_minimum",
      unassignedCount: 3,
    });
  });
});

describe("activity info visibility", () => {
  const startsAt = new Date("2026-07-10T12:00:00.000+08:00");

  it("shows only basic info before grouping", () => {
    expect(
      getActivityInfoVisibility({
        orderStatus: "paid_pending_group",
        activityStatus: "registration_open",
        startsAt,
        now: new Date("2026-07-08T12:00:00.000+08:00"),
      }),
    ).toBe("basic");
  });

  it("shows restaurant after grouping before T-24", () => {
    expect(
      getActivityInfoVisibility({
        orderStatus: "grouped",
        activityStatus: "grouped",
        startsAt,
        now: new Date("2026-07-08T12:00:00.000+08:00"),
      }),
    ).toBe("restaurant");
  });

  it("shows address at T-24 for valid grouped users", () => {
    expect(
      getActivityInfoVisibility({
        orderStatus: "grouped",
        activityStatus: "grouped",
        startsAt,
        now: new Date("2026-07-09T12:00:00.000+08:00"),
      }),
    ).toBe("address");
  });

  it("does not show info to refunded users", () => {
    expect(
      getActivityInfoVisibility({
        orderStatus: "refunded",
        activityStatus: "address_unlocked",
        startsAt,
        now: new Date("2026-07-09T12:00:00.000+08:00"),
      }),
    ).toBe("none");
  });
});

describe("refund decisions", () => {
  const startsAt = new Date("2026-07-10T12:00:00.000+08:00");

  it("auto-refunds group failures", () => {
    expect(
      evaluateRefundDecision({
        orderStatus: "group_failed",
        activityStatus: "group_failed",
        startsAt,
        now: new Date("2026-07-08T12:00:00.000+08:00"),
        requestedBy: "system",
      }),
    ).toEqual({ action: "auto_full_refund", reason: "group_failed" });
  });

  it("requires ops review before T-24", () => {
    expect(
      evaluateRefundDecision({
        orderStatus: "grouped",
        activityStatus: "grouped",
        startsAt,
        now: new Date("2026-07-08T12:00:00.000+08:00"),
        requestedBy: "user",
      }),
    ).toEqual({ action: "requires_ops_review", reason: "before_24h" });
  });

  it("requires ops review within T-24", () => {
    expect(
      evaluateRefundDecision({
        orderStatus: "grouped",
        activityStatus: "grouped",
        startsAt,
        now: new Date("2026-07-10T00:00:00.000+08:00"),
        requestedBy: "user",
      }),
    ).toEqual({ action: "requires_ops_review", reason: "within_24h" });
  });
});

describe("pricing", () => {
  it("uses service fee as the order amount", () => {
    expect(calculateOrderAmountCents({ serviceFeeCents: 9900 })).toBe(9900);
  });

  it("rejects invalid service fee amounts", () => {
    expect(() => calculateOrderAmountCents({ serviceFeeCents: 0 })).toThrow(
      "serviceFeeCents must be a positive integer",
    );
  });
});
