/** Approved V1.1 business branches expressed as pure decisions.
 * All timestamps, receipt facts, transaction order and actor attestations come
 * from the controlled server adapter. These functions grant no execution authority.
 * Unresolved policy branches return blockers; no official monetary defaults exist. */
export type PrelaunchStatus = "READY" | "BLOCKED_POLICY" | "INVALID_INPUT";
export interface PrelaunchDecision<T> {
  readonly status: PrelaunchStatus;
  readonly code: string;
  readonly blockerIds: readonly string[];
  readonly effect?: T;
}
const HOUR = 60 * 60 * 1000;
export const FORMAL_RESERVATION_MS = 10 * 60 * 1000;
function ready<T>(code: string, effect: T): PrelaunchDecision<T> { return { status: "READY", code, blockerIds: [], effect }; }
function blocked<T>(code: string, ids: readonly string[], effect?: T): PrelaunchDecision<T> { return effect === undefined ? { status: "BLOCKED_POLICY", code, blockerIds: ids } : { status: "BLOCKED_POLICY", code, blockerIds: ids, effect }; }
function invalid<T>(code = "INVALID_INPUT"): PrelaunchDecision<T> { return { status: "INVALID_INPUT", code, blockerIds: [] }; }
function integer(value: number): boolean { return Number.isSafeInteger(value) && value >= 0; }
function time(value: number): boolean { return integer(value) && value <= 8_640_000_000_000_000; }
export interface FundingComponents { readonly F: number; readonly D: number }
function funds(value: FundingComponents): boolean { return integer(value.F) && integer(value.D) && Number.isSafeInteger(value.F + value.D); }
export type PrelaunchTableState = "WAITING" | "FORMED" | "INVALIDATED" | "FAILED";
export type AllocationStrategy = "FILL_TO_TARGET" | "FILL_TO_MAX";
export interface SupplyRevisionInput {
  readonly revisionId: string;
  readonly restaurantId: string;
  readonly activityId: string;
  readonly min: number;
  readonly target: number;
  readonly max: number;
  readonly maxTables: number;
  readonly allocationStrategy: AllocationStrategy;
  /** Facts asserted only by a controlled adapter; request booleans are not attestations. */
  readonly restaurantConfirmed: boolean;
  readonly platformApproved: boolean;
  readonly D: number;
  readonly D_MIN: number | null;
  readonly D_MAX: number | null;
  readonly WAITLIST_MAX: number | null;
}
export function validateSupplyRevision(input: SupplyRevisionInput): PrelaunchDecision<{ capacity: number }> {
  if (!input.revisionId || !input.restaurantId || !input.activityId || !integer(input.min) || !integer(input.target) || !integer(input.max) || input.min < 4 || input.min > input.target || input.target > input.max || input.max > 8 || !integer(input.maxTables) || input.maxTables < 1 || !Number.isSafeInteger(input.max * input.maxTables) || !integer(input.D) || !["FILL_TO_TARGET", "FILL_TO_MAX"].includes(input.allocationStrategy)) return invalid("SUPPLY_INVALID");
  if (!input.restaurantConfirmed || !input.platformApproved) return blocked("SUPPLY_ATTESTATION_REQUIRED", ["RV-07"]);
  if (input.D_MIN === null || input.D_MAX === null) return blocked("DEPOSIT_LIMITS_UNRESOLVED", ["OP-03"]);
  if (!integer(input.D_MIN) || !integer(input.D_MAX) || input.D_MIN > input.D_MAX || input.D < input.D_MIN || input.D > input.D_MAX) return invalid("DEPOSIT_RANGE_INVALID");
  if (input.WAITLIST_MAX === null) return blocked("WAITLIST_LIMIT_UNRESOLVED", ["OP-08"]);
  if (!integer(input.WAITLIST_MAX)) return invalid("WAITLIST_LIMIT_INVALID");
  return ready("SUPPLY_VALID", { capacity: input.max * input.maxTables });
}
export interface FundingQuote {
  readonly supplyRevisionId: string;
  readonly policyBundleId: string;
  readonly F: number;
  readonly D: number;
  readonly total: number;
  readonly mealCollection: "DIRECT_TO_RESTAURANT";
}
export function quoteFunding(input: { readonly supply: SupplyRevisionInput; readonly policyBundleId: string; readonly defaultF: number | null; readonly activityF: number | null }): PrelaunchDecision<FundingQuote> {
  const supply = validateSupplyRevision(input.supply);
  if (supply.status !== "READY") return { status: supply.status, code: supply.code, blockerIds: supply.blockerIds };
  const F = input.activityF ?? input.defaultF;
  if (F === null) return blocked("SERVICE_FEE_UNRESOLVED", ["OP-03"]);
  if (!input.policyBundleId || !funds({ F, D: input.supply.D }) || F + input.supply.D <= 0) return invalid("QUOTE_INVALID");
  return ready("QUOTE_SNAPSHOT", Object.freeze({ supplyRevisionId: input.supply.revisionId, policyBundleId: input.policyBundleId, F, D: input.supply.D, total: F + input.supply.D, mealCollection: "DIRECT_TO_RESTAURANT" as const }));
}
export function evaluateRegistrationEligibility(input: { readonly loggedIn: boolean; readonly phoneAuthorized: boolean; readonly gender: string | null; readonly adultEligibility: "UNRESOLVED" | "SIMULATION_CONFIRMED" | "FORMAL_DECLARATION_VERIFIED"; readonly blacklisted: boolean; readonly accountClosurePending: boolean; readonly requiresSpecialAccommodation: boolean | null }): PrelaunchDecision<{ allowed: boolean }> {
  if (!input.loggedIn || !input.phoneAuthorized || !["MALE", "FEMALE"].includes(input.gender ?? "") || input.blacklisted) return ready("REGISTRATION_PREREQUISITES_REQUIRED", { allowed: false });
  if (input.accountClosurePending) return blocked("CLOSURE_REGISTRATION_UNRESOLVED", ["OP-15"], { allowed: false });
  if (!["SIMULATION_CONFIRMED","FORMAL_DECLARATION_VERIFIED"].includes(input.adultEligibility)) return blocked("ADULT_ELIGIBILITY_UNRESOLVED", ["RV-04"], { allowed: false });
  if (input.requiresSpecialAccommodation === true) return ready("SPECIAL_ACCOMMODATION_UNAVAILABLE", { allowed: false });
  if (input.requiresSpecialAccommodation === null) return blocked("ADAPTATION_CHECK_UNRESOLVED", ["OP-10", "RV-07"], { allowed: false });
  return ready(input.adultEligibility === "FORMAL_DECLARATION_VERIFIED" ? "FORMAL_REGISTRATION_ELIGIBLE" : "SIMULATION_REGISTRATION_ELIGIBLE", { allowed: true });
}
export interface PaymentQualificationInput {
  readonly reservedAt: number;
  /** Trusted server confirmation/evaluation time; never a client-paidAt override. */
  readonly confirmedAt: number;
  readonly startAt: number;
  readonly status: "SUCCEEDED" | "UNKNOWN" | "FAILED" | "PENDING";
  readonly expected: FundingComponents;
  readonly received: FundingComponents;
}
export interface PaymentQualificationEffect {
  readonly qualification: "NONE" | "FORMAL_OR_WAITLIST";
  readonly releaseReservation: boolean;
  readonly refundRequired: FundingComponents;
  readonly recordReceipt: boolean;
  readonly recoverMoney: boolean;
}
export function evaluatePaymentQualification(input: PaymentQualificationInput): PrelaunchDecision<PaymentQualificationEffect> {
  if (!time(input.reservedAt) || !time(input.confirmedAt) || !time(input.startAt) || input.confirmedAt < input.reservedAt || !funds(input.expected) || !funds(input.received) || input.expected.F + input.expected.D <= 0 || !["SUCCEEDED", "UNKNOWN", "FAILED", "PENDING"].includes(input.status)) return invalid();
  const expired = input.confirmedAt - input.reservedAt >= FORMAL_RESERVATION_MS;
  const base: PaymentQualificationEffect = { qualification: "NONE", releaseReservation: expired || input.status === "FAILED", refundRequired: { F: 0, D: 0 }, recordReceipt: input.status === "SUCCEEDED", recoverMoney: input.status === "UNKNOWN" || input.status === "PENDING" };
  if (input.status !== "SUCCEEDED") return ready(expired ? "RESERVATION_EXPIRED" : "PAYMENT_NOT_QUALIFIED", base);
  if (input.received.F !== input.expected.F || input.received.D !== input.expected.D) return ready("RECEIPT_AMOUNT_CONFLICT_REFUND", { ...base, releaseReservation: true, refundRequired: { ...input.received } });
  if (expired) return ready("LATE_RECEIPT_FULL_REFUND", { ...base, releaseReservation: true, refundRequired: { ...input.received } });
  if (input.confirmedAt === input.startAt - 24 * HOUR) return blocked("PAYMENT_AT_T24_CATEGORY_UNRESOLVED", ["OP-05"], { ...base, releaseReservation: true });
  if (input.confirmedAt >= input.startAt - 8 * HOUR) return blocked("PAYMENT_CROSSED_REGISTRATION_CUTOFF", ["OP-05"], { ...base, releaseReservation: true, recoverMoney: true });
  return ready("COMPLETE_PAYMENT_QUALIFIED", { ...base, qualification: "FORMAL_OR_WAITLIST", releaseReservation: true });
}
export type CancellationReason = "VOLUNTARY" | "WAITLIST_EXPIRED" | "FORMATION_FAILED" | "PLATFORM_CANCEL" | "RESTAURANT_CANCEL" | "CORE_CHANGE_REJECTED" | "LATE_RECEIPT" | "NORMAL_FULFILLMENT" | "NO_SHOW" | "SPECIAL_APPROVED";
export interface CancellationInput {
  readonly startAt: number;
  readonly acceptedAt: number;
  readonly membership: "WAITLIST" | "FORMAL";
  readonly category: "ORDINARY" | "LATE_FORMED" | "UNRESOLVED";
  readonly tableState: PrelaunchTableState;
  readonly funding: FundingComponents;
  readonly reason: CancellationReason;
  readonly specialScope?: "D_ONLY" | "F_AND_D";
}
export interface CancellationEffect {
  readonly refundF: number;
  readonly refundD: number;
  readonly depositDisposition: "REFUND" | "RESTAURANT_COMPENSATION" | "PLATFORM_RETAINED" | "HELD";
  readonly compensationRequired: boolean;
  /** Financial recognition is outside this business disposition, including retained D. */
  readonly accountingRevenue: null;
}
export function evaluateCancellation(input: CancellationInput): PrelaunchDecision<CancellationEffect> {
  if (!time(input.startAt) || !time(input.acceptedAt) || !funds(input.funding) || !["WAITLIST", "FORMAL"].includes(input.membership) || !["ORDINARY", "LATE_FORMED", "UNRESOLVED"].includes(input.category) || !["WAITING", "FORMED", "INVALIDATED", "FAILED"].includes(input.tableState)) return invalid();
  const result = (code: string, refundF: number, refundD: number, depositDisposition: CancellationEffect["depositDisposition"], compensationRequired = false) => ready(code, { refundF, refundD, depositDisposition, compensationRequired, accountingRevenue: null });
  const { F, D } = input.funding;
  // Reason takes precedence over a button name, category or historical formation.
  if (["PLATFORM_CANCEL", "RESTAURANT_CANCEL", "CORE_CHANGE_REJECTED"].includes(input.reason)) return result("RESPONSIBILITY_FULL_REFUND", F, D, "REFUND", true);
  if (["WAITLIST_EXPIRED", "FORMATION_FAILED", "LATE_RECEIPT"].includes(input.reason)) return result("MANDATORY_FULL_REFUND", F, D, "REFUND");
  if (input.reason === "NORMAL_FULFILLMENT") return result("NORMAL_FULFILLMENT_REFUND_DEPOSIT", 0, D, "REFUND");
  if (input.reason === "NO_SHOW") return result("CONFIRMED_NO_SHOW", 0, 0, "RESTAURANT_COMPENSATION");
  if (input.reason === "SPECIAL_APPROVED") {
    if (input.specialScope === "D_ONLY") return result("SPECIAL_DEPOSIT_REFUND", 0, D, "REFUND");
    if (input.specialScope === "F_AND_D") return result("SPECIAL_FULL_REFUND", F, D, "REFUND");
    return invalid("SPECIAL_SCOPE_INVALID");
  }
  if (input.reason !== "VOLUNTARY") return invalid("CANCELLATION_REASON_INVALID");
  if (input.membership === "WAITLIST") return result("WAITLIST_EXIT_FULL_REFUND", F, D, "REFUND");
  if (input.category === "UNRESOLVED") return blocked("REGISTRATION_CATEGORY_UNRESOLVED", ["OP-05"]);
  const delta = input.startAt - input.acceptedAt;
  if (delta <= 0) return blocked("POST_START_VOLUNTARY_UNRESOLVED", ["OP-12"]);
  if (input.category === "LATE_FORMED" && input.tableState === "FORMED") return delta >= 8 * HOUR ? result("LATE_FORMED_REFUND_DEPOSIT", 0, D, "REFUND") : result("LATE_FORMED_RESTAURANT_DEPOSIT", 0, 0, "RESTAURANT_COMPENSATION");
  if (input.tableState === "FORMED") return result("FORMED_NONREFUNDABLE", 0, 0, delta > 24 * HOUR ? "PLATFORM_RETAINED" : "RESTAURANT_COMPENSATION");
  if (input.tableState === "FAILED") return result("FAILED_FORMATION_FULL_REFUND", F, D, "REFUND");
  if (delta >= 24 * HOUR) return result("UNFORMED_FULL_REFUND", F, D, "REFUND");
  if (delta >= 8 * HOUR) return result("UNFORMED_REFUND_DEPOSIT", 0, D, "REFUND");
  return result("UNFORMED_RESTAURANT_DEPOSIT", 0, 0, "RESTAURANT_COMPENSATION");
}
/** UNKNOWN/in-flight amounts reserve the component until authoritative convergence. */
export function allocateRefundBudget(input: { readonly received: FundingComponents; readonly completed: FundingComponents; readonly inFlight: FundingComponents; readonly desired: FundingComponents }): PrelaunchDecision<FundingComponents> {
  if (![input.received, input.completed, input.inFlight, input.desired].every(funds)) return invalid("REFUND_BUDGET_INVALID");
  if (input.completed.F + input.inFlight.F > input.received.F || input.completed.D + input.inFlight.D > input.received.D || input.desired.F > input.received.F || input.desired.D > input.received.D) return invalid("REFUND_BUDGET_EXCEEDED");
  return ready("REFUND_BUDGET_AVAILABLE", { F: Math.max(0, input.desired.F - input.completed.F - input.inFlight.F), D: Math.max(0, input.desired.D - input.completed.D - input.inFlight.D) });
}
export interface TableLifecycleInput {
  readonly state: PrelaunchTableState;
  readonly activeFormalCount: number;
  readonly min: number;
  readonly max: number;
  readonly startAt: number;
  readonly acceptedAt: number;
  readonly formedAtT24: boolean | null;
  readonly everFormed: boolean;
}
export interface TableLifecycleEffect {
  readonly state: PrelaunchTableState;
  readonly action: "NONE" | "FORM" | "INVALIDATE" | "RESTORE" | "FAIL_AND_REFUND" | "RESTAURANT_DECISION_REQUIRED";
  readonly directRecruiting: boolean;
  readonly waitlistAllowed: boolean;
}
export function evaluateTableLifecycle(input: TableLifecycleInput): PrelaunchDecision<TableLifecycleEffect> {
  if (!["WAITING", "FORMED", "INVALIDATED", "FAILED"].includes(input.state) || !integer(input.activeFormalCount) || !integer(input.min) || !integer(input.max) || input.min < 4 || input.min > input.max || input.max > 8 || input.activeFormalCount > input.max || !time(input.startAt) || !time(input.acceptedAt)) return invalid("TABLE_INPUT_INVALID");
  const delta = input.startAt - input.acceptedAt;
  const effect = (state: PrelaunchTableState, action: TableLifecycleEffect["action"], directRecruiting: boolean, waitlistAllowed: boolean) => ready("TABLE_LIFECYCLE", { state, action, directRecruiting, waitlistAllowed });
  if (input.state === "FAILED") return effect("FAILED", "NONE", false, false);
  if (delta < 24 * HOUR && input.formedAtT24 === null) return blocked("T24_FORMATION_SNAPSHOT_REQUIRED", ["OP-05"]);
  if (delta < 24 * HOUR && input.formedAtT24 === false) return effect("FAILED", "FAIL_AND_REFUND", false, false);
  if (delta <= 8 * HOUR && input.activeFormalCount < input.min) return blocked("LOW_PERSON_RESTAURANT_DECISION_REQUIRED", ["OP-07", "RV-03"], { state: input.state === "FORMED" ? "INVALIDATED" : input.state, action: "RESTAURANT_DECISION_REQUIRED", directRecruiting: false, waitlistAllowed: false });
  if (input.activeFormalCount >= input.min) return effect("FORMED", input.state === "FORMED" ? "NONE" : input.everFormed ? "RESTORE" : "FORM", delta > 8 * HOUR && input.activeFormalCount < input.max, delta > 24 * HOUR);
  if (delta === 24 * HOUR) return effect("FAILED", "FAIL_AND_REFUND", false, false);
  return effect(input.everFormed ? "INVALIDATED" : "WAITING", input.state === "FORMED" ? "INVALIDATE" : "NONE", delta > 8 * HOUR, delta > 24 * HOUR);
}
export function getOwnTableVisibility(input: { readonly membership: "FORMAL" | "WAITLIST" | "NONE"; readonly memberValid: boolean; readonly ownTable: boolean; readonly state: PrelaunchTableState; readonly everFormed: boolean; readonly terminalAccess: "UNRESOLVED" | "ACTIVE" }): PrelaunchDecision<{ showName: boolean; showAddress: boolean }> {
  if (input.terminalAccess !== "ACTIVE") return blocked("TERMINAL_ACCESS_UNRESOLVED", ["OP-15"], { showName: false, showAddress: false });
  if (input.membership !== "FORMAL" || !input.memberValid || !input.ownTable) return ready("OWN_TABLE_REQUIRED", { showName: false, showAddress: false });
  return ready("OWN_TABLE_VISIBILITY", { showName: input.state === "FORMED" || input.everFormed, showAddress: input.state === "FORMED" });
}
export interface WaitlistState { readonly state: "WAITING" | "PROMOTED" | "EXITED" | "EXPIRED"; readonly version: number; readonly fifoSequence: number; readonly qualified: boolean }
export function reduceWaitlist(current: WaitlistState, event: { readonly type: "EXIT" | "PROMOTE" | "EXPIRE"; readonly transactionSequence: number; readonly beforeT24: boolean; readonly capacityAvailable: boolean }): PrelaunchDecision<{ next: WaitlistState; fullRefundObligation: boolean; grantFormalSeat: boolean }> {
  if (!integer(current.version) || !integer(current.fifoSequence) || current.fifoSequence < 1 || !integer(event.transactionSequence)) return invalid("WAITLIST_INPUT_INVALID");
  if (event.transactionSequence <= current.version) return ready("WAITLIST_STALE_EVENT", { next: current, fullRefundObligation: false, grantFormalSeat: false });
  if (current.state !== "WAITING") return ready("WAITLIST_ALREADY_RESOLVED", { next: current, fullRefundObligation: false, grantFormalSeat: false });
  if (!current.qualified) return invalid("WAITLIST_REQUIRES_COMPLETE_PAYMENT");
  if (event.type === "PROMOTE" && (!event.beforeT24 || !event.capacityAvailable)) return ready("WAITLIST_PROMOTION_UNAVAILABLE", { next: current, fullRefundObligation: false, grantFormalSeat: false });
  if (event.type === "EXPIRE" && event.beforeT24) return invalid("WAITLIST_EXPIRY_BEFORE_CUTOFF");
  if (!["EXIT", "PROMOTE", "EXPIRE"].includes(event.type)) return invalid("WAITLIST_EVENT_INVALID");
  const state = event.type === "PROMOTE" ? "PROMOTED" : event.type === "EXIT" ? "EXITED" : "EXPIRED";
  return ready("WAITLIST_EVENT_APPLIED", { next: { ...current, state, version: event.transactionSequence }, fullRefundObligation: state !== "PROMOTED", grantFormalSeat: state === "PROMOTED" });
}
export function evaluateWaitlistAdmission(input: { readonly validCount: number; readonly limit: number | null; readonly beforeT24: boolean; readonly unresolvedPriorRegistration: boolean; readonly inFlightAdmissions: number; readonly concurrentExposureReserved?: boolean }): PrelaunchDecision<{ createPayment: boolean }> {
  if (!integer(input.validCount) || !integer(input.inFlightAdmissions)) return invalid();
  if (input.limit === null) return blocked("WAITLIST_LIMIT_UNRESOLVED", ["OP-08"], { createPayment: false });
  if (!integer(input.limit)) return invalid();
  if (!input.beforeT24 || input.validCount + input.inFlightAdmissions >= input.limit) return ready("WAITLIST_CLOSED_OR_FULL", { createPayment: false });
  if (input.unresolvedPriorRegistration || (input.inFlightAdmissions > 0 && input.concurrentExposureReserved !== true)) return blocked("WAITLIST_CONCURRENT_EXPOSURE_UNRESOLVED", ["OP-08"], { createPayment: false });
  return ready("WAITLIST_ADMISSION_ALLOWED", { createPayment: true });
}
/** Only new/uncommitted members are distributed. Existing formed memberships are immutable. */
export function allocateNewTableMembers(input: { readonly supply: Pick<SupplyRevisionInput, "min" | "target" | "max" | "maxTables" | "allocationStrategy">; readonly committedTables: readonly { readonly tableId: string; readonly memberIds: readonly string[] }[]; readonly orderedNewMemberIds: readonly string[] }): PrelaunchDecision<{ committedTables: readonly { readonly tableId: string; readonly memberIds: readonly string[] }[]; pendingTableMembers: readonly (readonly string[])[] }> {
  const { min, target, max, maxTables, allocationStrategy } = input.supply;
  if (![min, target, max, maxTables].every(integer) || min < 4 || min > target || target > max || max > 8 || maxTables < 1 || !["FILL_TO_TARGET", "FILL_TO_MAX"].includes(allocationStrategy) || input.committedTables.length > maxTables) return invalid("ALLOCATION_INPUT_INVALID");
  const ids = [...input.committedTables.flatMap(t => [...t.memberIds]), ...input.orderedNewMemberIds];
  if (ids.some(id => !id) || new Set(ids).size !== ids.length || new Set(input.committedTables.map(t => t.tableId)).size !== input.committedTables.length || input.committedTables.some(t => !t.tableId || t.memberIds.length < min || t.memberIds.length > max)) return invalid("ALLOCATION_MEMBERS_INVALID");
  const committedTables = input.committedTables.map(t => ({ tableId: t.tableId, memberIds: [...t.memberIds] }));
  const cap = allocationStrategy === "FILL_TO_TARGET" ? target : max;
  let appended = 0;
  for (const table of committedTables) {
    while (table.memberIds.length < cap && appended < input.orderedNewMemberIds.length) {
      table.memberIds.push(input.orderedNewMemberIds[appended]!);
      appended += 1;
    }
  }
  const available = maxTables - input.committedTables.length;
  // Target is a preference: consume additional committed-table capacity when
  // otherwise maxTables would prevent an admissible FIFO member from joining.
  let overflow = Math.max(0, input.orderedNewMemberIds.length - appended - available * max);
  for (const table of committedTables) {
    while (overflow > 0 && table.memberIds.length < max) {
      table.memberIds.push(input.orderedNewMemberIds[appended]!);
      appended += 1;
      overflow -= 1;
    }
  }
  const remainingIds = input.orderedNewMemberIds.slice(appended);
  if (remainingIds.length > available * max) return invalid("ALLOCATION_CAPACITY_EXCEEDED");
  const groups: string[][] = [];
  const count = Math.min(available, Math.ceil(remainingIds.length / cap));
  let offset = 0;
  for (let index = 0; index < count; index++) {
    const remaining = remainingIds.length - offset;
    // Shift only uncommitted candidates when needed to honor max/maxTables.
    const size = Math.max(Math.min(remaining, cap), remaining - (count - index - 1) * max);
    groups.push(remainingIds.slice(offset, offset + size));
    offset += size;
  }
  return ready("TABLE_ALLOCATION_CANDIDATE", { committedTables, pendingTableMembers: groups });
}
export function nextShanghaiNaturalDay(timestamp: number): PrelaunchDecision<{ date: string }> {
  if (!time(timestamp) || timestamp + 32 * HOUR > 8_640_000_000_000_000) return invalid("TIMESTAMP_INVALID");
  // Shanghai modern operational dates are UTC+08; no worker clock is used.
  const shifted = new Date(timestamp + 8 * HOUR);
  return ready("NEXT_SHANGHAI_NATURAL_DAY", { date: new Date(Date.UTC(shifted.getUTCFullYear(), shifted.getUTCMonth(), shifted.getUTCDate() + 1)).toISOString().slice(0, 10) });
}
export function evaluateCoreChange(input: { readonly kind: "RESTAURANT" | "OTHER_CORE"; readonly response: "ACCEPT" | "REJECT" | "NONE"; readonly acceptedAt: number; readonly now: number; readonly deadlineAt: number | null; readonly deadlineSource: "UNRESOLVED" | "SIMULATION_ONLY"; readonly originalT: number; readonly proposedT: number }): PrelaunchDecision<{ applyChange: boolean; fullRefundObligation: boolean; compensationRequired: boolean; compensationAmount: null }> {
  if (!time(input.acceptedAt) || !time(input.now) || input.now < input.acceptedAt || !time(input.originalT) || !time(input.proposedT)) return invalid();
  const effect = (applyChange: boolean, fullRefundObligation: boolean, compensationRequired: boolean) => ({ applyChange, fullRefundObligation, compensationRequired, compensationAmount: null });
  if (input.response === "REJECT") return ready("CORE_CHANGE_REJECTED", effect(false, true, input.kind === "RESTAURANT"));
  if (input.response === "ACCEPT") {
    if (input.deadlineAt === null || input.deadlineSource === "UNRESOLVED") return blocked("CHANGE_DEADLINE_UNRESOLVED", ["OP-09"]);
    if (!time(input.deadlineAt) || input.acceptedAt > input.deadlineAt) return invalid("CORE_CHANGE_ACCEPTANCE_EXPIRED");
    return ready("SIMULATION_EXPLICIT_CHANGE_ACCEPTED", effect(true, false, false));
  }
  if (input.response !== "NONE") return invalid();
  if (input.kind !== "RESTAURANT" || input.deadlineAt === null || input.deadlineSource === "UNRESOLVED") return blocked("CHANGE_SILENCE_UNRESOLVED", ["OP-09"], effect(false, false, false));
  if (!time(input.deadlineAt)) return invalid();
  return ready("SIMULATION_RESTAURANT_CHANGE_WINDOW", effect(false, input.now >= input.deadlineAt, input.now >= input.deadlineAt));
}
export function evaluateDisputeWindow(input: { readonly deliveredAt: number | null; readonly acceptedAt: number; readonly deliveryPolicy: "UNRESOLVED" | "SIMULATION_ONLY"; readonly phase: "INITIAL_EXPLANATION" | "FINAL_REVIEW_APPLICATION" }): PrelaunchDecision<{ deadlineAt: number; inWindow: boolean; evidenceClass: "SIMULATION_ONLY" }> {
  if (!time(input.acceptedAt) || (input.deliveredAt !== null && (!time(input.deliveredAt) || input.acceptedAt < input.deliveredAt))) return invalid("DISPUTE_TIME_INVALID");
  if (input.deliveryPolicy !== "SIMULATION_ONLY" || input.deliveredAt === null) return blocked("DELIVERY_EVIDENCE_UNRESOLVED", ["OP-13", "RV-02"]);
  const deadlineAt = input.deliveredAt + 48 * HOUR;
  if (!time(deadlineAt)) return invalid();
  return ready("SIMULATION_DISPUTE_WINDOW", { deadlineAt, inWindow: input.acceptedAt <= deadlineAt, evidenceClass: "SIMULATION_ONLY" });
}
export function evaluateFinalReview(input: { readonly firstReviewerPersonId: string; readonly finalReviewerPersonId: string; readonly alreadyUsed: boolean; readonly applicationInWindow: boolean; readonly pending: boolean }): PrelaunchDecision<{ mayReview: boolean; holdDeposit: boolean; settlementAllowed: boolean }> {
  if (!input.firstReviewerPersonId || !input.finalReviewerPersonId) return invalid("REVIEWER_PERSON_REQUIRED");
  if (input.firstReviewerPersonId === input.finalReviewerPersonId || input.alreadyUsed || !input.applicationInWindow) return ready("FINAL_REVIEW_INELIGIBLE", { mayReview: false, holdDeposit: input.pending, settlementAllowed: false });
  return ready("DISTINCT_PERSON_FINAL_REVIEW", { mayReview: true, holdDeposit: true, settlementAllowed: false });
}
export function evaluateAccountClosure(input: { readonly obligations: { readonly funds: boolean; readonly fulfillment: boolean; readonly dispute: boolean }; readonly requestedAt: number }): PrelaunchDecision<{ acceptRequest: boolean; finalize: boolean; preserveFundingFacts: true }> {
  if (!time(input.requestedAt)) return invalid();
  return ready("ACCOUNT_CLOSURE_REQUEST", { acceptRequest: true, finalize: !input.obligations.funds && !input.obligations.fulfillment && !input.obligations.dispute, preserveFundingFacts: true });
}

/** A scan is arrival evidence only; only a scoped restaurant result creates D obligation. */
export function evaluateFulfillment(input: { readonly scanned: boolean; readonly restaurantResult: "NOT_CONFIRMED" | "NORMAL" | "ABNORMAL"; readonly restaurantConfirmedAt: number | null; readonly activityEndedAt: number; readonly funding: FundingComponents }): PrelaunchDecision<{ refundRequired: FundingComponents; reviewRequired: boolean; operationalTodo: boolean; initiationDay: string | null }> {
  if (!time(input.activityEndedAt) || !funds(input.funding) || (input.restaurantConfirmedAt !== null && !time(input.restaurantConfirmedAt))) return invalid("FULFILLMENT_INPUT_INVALID");
  if (input.restaurantResult === "NOT_CONFIRMED") return ready("RESTAURANT_CONFIRMATION_MISSING", { refundRequired: { F: 0, D: 0 }, reviewRequired: false, operationalTodo: true, initiationDay: null });
  if (input.restaurantConfirmedAt === null) return invalid("RESTAURANT_RESULT_REQUIRES_CONFIRMATION");
  if (input.restaurantResult === "ABNORMAL") return ready("ABNORMAL_REQUIRES_PLATFORM_REVIEW", { refundRequired: { F: 0, D: 0 }, reviewRequired: true, operationalTodo: true, initiationDay: null });
  if (input.restaurantResult !== "NORMAL") return invalid("FULFILLMENT_RESULT_INVALID");
  const day = nextShanghaiNaturalDay(input.activityEndedAt);
  if (day.status !== "READY") return invalid("FULFILLMENT_DAY_INVALID");
  return ready("NORMAL_DEPOSIT_OBLIGATION", { refundRequired: { F: 0, D: input.funding.D }, reviewRequired: false, operationalTodo: false, initiationDay: day.effect!.date });
}
/** Acceptance time/rights remain original; this does not restore a removed member. */
export function evaluateSpecialRejection(original: CancellationInput): PrelaunchDecision<CancellationEffect> {
  return evaluateCancellation({ ...original, reason: "VOLUNTARY" });
}
export function evaluateFormalMemberRemoval(): PrelaunchDecision<{ removeMember: false }> {
  return blocked("FORMAL_MEMBER_REMOVAL_EVENT_UNRESOLVED", ["OP-04"], { removeMember: false });
}
export function evaluateWaitlistReentry(input: { readonly previousState: WaitlistState["state"]; readonly previousSequence: number; readonly tailSequence: number; readonly newSequence: number; readonly orderingAuthority: "UNRESOLVED" | "SIMULATION_ONLY"; readonly admission: Parameters<typeof evaluateWaitlistAdmission>[0] }): PrelaunchDecision<{ newApplication: true; fifoSequence: number; restorePriority: false }> {
  if (!integer(input.previousSequence) || !integer(input.tailSequence) || !integer(input.newSequence) || input.previousSequence < 1 || input.tailSequence < input.previousSequence || input.newSequence !== input.tailSequence + 1) return invalid("REENTRY_SEQUENCE_INVALID");
  if (input.previousState === "EXPIRED") return blocked("EXPIRED_WAITLIST_REBOOKING_UNRESOLVED", ["OP-08"]);
  if (input.previousState !== "EXITED") return invalid("REENTRY_REQUIRES_VOLUNTARY_EXIT");
  const admission = evaluateWaitlistAdmission(input.admission);
  if (admission.status !== "READY") return { status: admission.status, code: admission.code, blockerIds: admission.blockerIds };
  if (!admission.effect?.createPayment) return invalid("REENTRY_WINDOW_CLOSED");
  if (input.orderingAuthority !== "SIMULATION_ONLY") return blocked("FIFO_CLOCK_AND_TIE_BREAKER_UNRESOLVED", ["OP-05"]);
  return ready("SIMULATION_WAITLIST_NEW_TAIL", { newApplication: true, fifoSequence: input.newSequence, restorePriority: false });
}
