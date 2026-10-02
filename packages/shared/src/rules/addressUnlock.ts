import type { ActivityStatus } from "./activity.js";
import type { OrderStatus } from "./order.js";
import { isPaidEffectiveOrder } from "./order.js";

export type ActivityInfoVisibility = "none" | "basic" | "restaurant" | "address";

export interface ActivityInfoVisibilityInput {
  orderStatus: OrderStatus;
  activityStatus: ActivityStatus;
  startsAt: Date;
  now: Date;
}

const GROUPED_ACTIVITY_STATUSES: readonly ActivityStatus[] = [
  "grouped",
  "address_unlocked",
  "in_progress",
  "completed",
];

export function getActivityInfoVisibility({
  orderStatus,
  activityStatus,
  startsAt,
  now,
}: ActivityInfoVisibilityInput): ActivityInfoVisibility {
  if (!isPaidEffectiveOrder(orderStatus)) {
    return "none";
  }

  if (!GROUPED_ACTIVITY_STATUSES.includes(activityStatus)) {
    return "basic";
  }

  const unlockAt = new Date(startsAt.getTime() - 24 * 60 * 60 * 1000);
  if (now >= unlockAt) {
    return "address";
  }

  return "restaurant";
}
