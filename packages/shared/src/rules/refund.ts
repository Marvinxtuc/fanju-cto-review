import type { ActivityStatus } from "./activity.js";
import type { OrderStatus } from "./order.js";

export type RefundDecision =
  | {
      action: "auto_full_refund";
      reason: "group_failed" | "operator_canceled";
    }
  | {
      action: "requires_ops_review";
      reason: "before_24h";
    }
  | {
      action: "requires_ops_review";
      reason: "within_24h";
    }
  | {
      action: "not_allowed";
      reason: "order_not_refundable" | "activity_already_started";
    };

export interface RefundDecisionInput {
  orderStatus: OrderStatus;
  activityStatus: ActivityStatus;
  startsAt: Date;
  now: Date;
  requestedBy: "user" | "operator" | "system";
}

const REFUNDABLE_ORDER_STATUSES: readonly OrderStatus[] = [
  "paid_pending_group",
  "grouped",
  "group_failed",
  "refund_requested",
  "refund_reviewing",
];

export function evaluateRefundDecision({
  orderStatus,
  activityStatus,
  startsAt,
  now,
  requestedBy,
}: RefundDecisionInput): RefundDecision {
  if (!REFUNDABLE_ORDER_STATUSES.includes(orderStatus)) {
    return { action: "not_allowed", reason: "order_not_refundable" };
  }

  if (activityStatus === "group_failed" || orderStatus === "group_failed") {
    return { action: "auto_full_refund", reason: "group_failed" };
  }

  if (activityStatus === "canceled" && requestedBy !== "user") {
    return { action: "auto_full_refund", reason: "operator_canceled" };
  }

  if (now >= startsAt) {
    return { action: "not_allowed", reason: "activity_already_started" };
  }

  const cutoff = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
  if (now < cutoff) {
    return { action: "requires_ops_review", reason: "before_24h" };
  }

  return { action: "requires_ops_review", reason: "within_24h" };
}
