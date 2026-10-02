export const DEFAULT_TABLE_RULE = {
  minSize: 4,
  targetSize: 6,
  maxSize: 8,
} as const;

export interface TableRule {
  minSize: number;
  targetSize: number;
  maxSize: number;
}

export type TableFormationDecision =
  | {
      canForm: true;
      unassignedCount: number;
      tableSizes: number[];
    }
  | {
      canForm: false;
      reason: "below_minimum" | "invalid_rule";
      unassignedCount: number;
    };

export function evaluateTableFormation(
  eligibleParticipantCount: number,
  rule: TableRule = DEFAULT_TABLE_RULE,
): TableFormationDecision {
  if (
    rule.minSize < 1 ||
    rule.targetSize < rule.minSize ||
    rule.maxSize < rule.targetSize
  ) {
    return {
      canForm: false,
      reason: "invalid_rule",
      unassignedCount: eligibleParticipantCount,
    };
  }

  if (eligibleParticipantCount < rule.minSize) {
    return {
      canForm: false,
      reason: "below_minimum",
      unassignedCount: eligibleParticipantCount,
    };
  }

  const tableCount = Math.ceil(eligibleParticipantCount / rule.maxSize);
  const tableSizes = distributeParticipants(
    eligibleParticipantCount,
    tableCount,
    rule,
  );

  if (tableSizes.length === 0) {
    return {
      canForm: false,
      reason: "below_minimum",
      unassignedCount: eligibleParticipantCount,
    };
  }

  return {
    canForm: true,
    tableSizes,
    unassignedCount: eligibleParticipantCount - tableSizes.reduce((sum, size) => sum + size, 0),
  };
}

function distributeParticipants(
  participantCount: number,
  tableCount: number,
  rule: TableRule,
): number[] {
  if (participantCount < tableCount * rule.minSize) {
    return [];
  }

  const tableSizes = Array.from({ length: tableCount }, () => rule.minSize);
  let remaining = participantCount - tableCount * rule.minSize;

  for (let index = 0; index < tableSizes.length && remaining > 0; index += 1) {
    const currentSize = tableSizes[index];
    if (currentSize === undefined) {
      continue;
    }

    const add = Math.min(rule.targetSize - currentSize, remaining);
    tableSizes[index] = currentSize + add;
    remaining -= add;
  }

  for (let index = 0; index < tableSizes.length && remaining > 0; index += 1) {
    const currentSize = tableSizes[index];
    if (currentSize === undefined) {
      continue;
    }

    const add = Math.min(rule.maxSize - currentSize, remaining);
    tableSizes[index] = currentSize + add;
    remaining -= add;
  }

  if (remaining > 0) {
    return [];
  }

  return tableSizes;
}
