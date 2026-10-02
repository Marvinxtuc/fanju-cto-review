export const ORDER_STATUSES = [
  "pending_payment",
  "payment_failed",
  "closed",
  "paid_pending_group",
  "grouped",
  "group_failed",
  "refund_requested",
  "refund_reviewing",
  "refunding",
  "refunded",
  "canceled",
  "completed",
] as const;

export type OrderStatus = (typeof ORDER_STATUSES)[number];

const ORDER_TRANSITIONS: Record<OrderStatus, readonly OrderStatus[]> = {
  pending_payment: ["paid_pending_group", "payment_failed", "closed"],
  payment_failed: ["pending_payment", "closed"],
  closed: [],
  paid_pending_group: ["grouped", "group_failed", "refund_requested", "canceled"],
  grouped: ["refund_requested", "refund_reviewing", "completed", "canceled"],
  group_failed: ["refunding"],
  refund_requested: ["refund_reviewing", "refunding", "canceled"],
  refund_reviewing: ["refunding", "canceled"],
  refunding: ["refunded"],
  refunded: [],
  canceled: [],
  completed: [],
};

export function canTransitionOrder(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return ORDER_TRANSITIONS[from].includes(to);
}

export function assertOrderTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransitionOrder(from, to)) {
    throw new Error(`Invalid order transition: ${from} -> ${to}`);
  }
}

export function isPaidEffectiveOrder(status: OrderStatus): boolean {
  return status === "paid_pending_group" || status === "grouped" || status === "completed";
}
