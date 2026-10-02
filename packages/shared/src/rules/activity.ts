export const ACTIVITY_STATUSES = [
  "draft",
  "published",
  "registration_open",
  "locking",
  "grouped",
  "group_failed",
  "address_unlocked",
  "in_progress",
  "completed",
  "canceled",
] as const;

export type ActivityStatus = (typeof ACTIVITY_STATUSES)[number];

const ACTIVITY_TRANSITIONS: Record<ActivityStatus, readonly ActivityStatus[]> = {
  draft: ["published", "canceled"],
  published: ["registration_open", "locking", "canceled"],
  registration_open: ["locking", "canceled"],
  locking: ["grouped", "group_failed", "canceled"],
  grouped: ["address_unlocked", "in_progress", "canceled"],
  group_failed: [],
  address_unlocked: ["in_progress", "canceled"],
  in_progress: ["completed", "canceled"],
  completed: [],
  canceled: [],
};

export function canTransitionActivity(
  from: ActivityStatus,
  to: ActivityStatus,
): boolean {
  return ACTIVITY_TRANSITIONS[from].includes(to);
}

export function assertActivityTransition(
  from: ActivityStatus,
  to: ActivityStatus,
): void {
  if (!canTransitionActivity(from, to)) {
    throw new Error(`Invalid activity transition: ${from} -> ${to}`);
  }
}

export function isUserVisibleActivity(status: ActivityStatus): boolean {
  return status === "published" || status === "registration_open";
}
