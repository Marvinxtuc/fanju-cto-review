import type { OpsTableCandidate } from "./api.js";

export function formatCandidateProfile(profile: NonNullable<OpsTableCandidate["profile"]>): string {
  return [
    profile.preferredAreas.join(" / "),
    profile.availableTimes.join(" / "),
    `预算 ${profile.budgetRange}`,
    profile.tableVibe,
    `可接受 ${profile.acceptableTableSizes.join(" / ")} 人桌`,
    `饮食限制 ${profile.dietaryRestrictions.join(" / ")}`,
  ].join(" · ");
}
