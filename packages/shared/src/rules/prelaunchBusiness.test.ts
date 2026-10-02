import { describe, expect, it } from "vitest";
import {
  allocateNewTableMembers, allocateRefundBudget, evaluateAccountClosure,
  evaluateCancellation, evaluateCoreChange, evaluateDisputeWindow,
  evaluateFinalReview, evaluateFormalMemberRemoval, evaluateFulfillment, evaluateSpecialRejection, evaluateWaitlistReentry, evaluatePaymentQualification, evaluateRegistrationEligibility,
  evaluateTableLifecycle, evaluateWaitlistAdmission, FORMAL_RESERVATION_MS,
  getOwnTableVisibility, nextShanghaiNaturalDay, quoteFunding, reduceWaitlist,
  validateSupplyRevision, type CancellationInput, type SupplyRevisionInput,
  type TableLifecycleInput, type WaitlistState,
} from "./prelaunchBusiness.js";
const H = 3_600_000;
const T = Date.parse("2026-10-10T18:00:00+08:00");
const FD = Object.freeze({ F: 1200, D: 2800 }); // TEST_ONLY illustrative amounts, not official defaults.
const supply: SupplyRevisionInput = { revisionId: "test-r1", restaurantId: "test-restaurant", activityId: "test-activity", min: 4, target: 6, max: 8, maxTables: 2, allocationStrategy: "FILL_TO_TARGET", restaurantConfirmed: true, platformApproved: true, D: 2800, D_MIN: 1000, D_MAX: 9000, WAITLIST_MAX: 3 };
const cancel: CancellationInput = { startAt: T, acceptedAt: T - 25 * H, membership: "FORMAL", category: "ORDINARY", tableState: "WAITING", funding: FD, reason: "VOLUNTARY" };
const table: TableLifecycleInput = { state: "WAITING", activeFormalCount: 4, min: 4, max: 8, startAt: T, acceptedAt: T - 25 * H, formedAtT24: null, everFormed: false };
function freeze<T>(v: T): T { if (v && typeof v === "object") { Object.freeze(v); for (const x of Object.values(v)) freeze(x); } return v; }
describe("approved business: F/D snapshots and supply", () => {
  it("separates F/D in one quote and keeps restaurant meal collection direct", () => {
    const q = quoteFunding({ supply, policyBundleId: "SIMULATION_ONLY", defaultF: 900, activityF: 1200 });
    expect(q.effect).toEqual({ F: 1200, D: 2800, total: 4000, supplyRevisionId: "test-r1", policyBundleId: "SIMULATION_ONLY", mealCollection: "DIRECT_TO_RESTAURANT" });
    const changed = quoteFunding({ supply: { ...supply, D: 3000, revisionId: "test-r2" }, policyBundleId: "SIMULATION_ONLY", defaultF: 1700, activityF: null });
    expect(changed.effect?.total).toBe(4700); expect(q.effect?.total).toBe(4000); expect(Object.isFrozen(q.effect)).toBe(true);
  });
  it.each([{ min: 5, target: 4 }, { max: 9 }, { maxTables: 0 }, { D: 900 }, { D_MIN: 9100, D_MAX: 9000 }, { allocationStrategy: "UNLIMITED" }])("rejects invalid supply %j", patch => expect(validateSupplyRevision({ ...supply, ...patch } as SupplyRevisionInput).status).toBe("INVALID_INPUT"));
  it.each(["D_MIN", "D_MAX", "WAITLIST_MAX"] as const)("does not invent missing %s", key => expect(validateSupplyRevision({ ...supply, [key]: null }).status).toBe("BLOCKED_POLICY"));
  it("requires each party's attestation and never derives restaurant consent from ops", () => {
    expect(validateSupplyRevision({ ...supply, restaurantConfirmed: false }).code).toBe("SUPPLY_ATTESTATION_REQUIRED");
    expect(validateSupplyRevision({ ...supply, platformApproved: false }).code).toBe("SUPPLY_ATTESTATION_REQUIRED");
  });
  it("never supplies a missing default F", () => expect(quoteFunding({ supply, policyBundleId: "SIMULATION_ONLY", defaultF: null, activityF: null }).blockerIds).toEqual(["OP-03"]));
  it("validates integer cents rather than floats or unsafe totals", () => {
    expect(quoteFunding({ supply, policyBundleId: "SIMULATION_ONLY", defaultF: 1.2, activityF: null }).status).toBe("INVALID_INPUT");
    expect(quoteFunding({ supply, policyBundleId: "SIMULATION_ONLY", defaultF: Number.MAX_SAFE_INTEGER, activityF: null }).status).toBe("INVALID_INPUT");
  });
});
describe("approved business: absolute ten-minute qualification", () => {
  const payment = { reservedAt: T - 48 * H, confirmedAt: T - 48 * H + FORMAL_RESERVATION_MS - 1, startAt: T, status: "SUCCEEDED" as const, expected: FD, received: FD };
  it("grants qualification only for complete F+D before expiry", () => expect(evaluatePaymentQualification(payment).effect?.qualification).toBe("FORMAL_OR_WAITLIST"));
  it.each(["UNKNOWN", "FAILED", "PENDING"] as const)("%s never counts toward min", status => expect(evaluatePaymentQualification({ ...payment, status, received: { F: 0, D: 0 } }).effect?.qualification).toBe("NONE"));
  it.each([FORMAL_RESERVATION_MS, FORMAL_RESERVATION_MS + 1])("trusted success at %d releases and refunds without reviving", elapsed => {
    const p = evaluatePaymentQualification({ ...payment, confirmedAt: payment.reservedAt + elapsed });
    expect(p.effect).toMatchObject({ qualification: "NONE", releaseReservation: true, recordReceipt: true, refundRequired: FD });
  });
  it("UNKNOWN releases at the logical deadline while retaining recovery", () => {
    expect(evaluatePaymentQualification({ ...payment, confirmedAt: payment.reservedAt + FORMAL_RESERVATION_MS, status: "UNKNOWN", received: { F: 0, D: 0 } }).effect).toMatchObject({ releaseReservation: true, recoverMoney: true, qualification: "NONE" });
  });
  it("records mismatched actual receipts for a full obligation instead of qualification", () => expect(evaluatePaymentQualification({ ...payment, received: { F: 1200, D: 0 } }).effect).toMatchObject({ recordReceipt: true, qualification: "NONE", refundRequired: { F: 1200, D: 0 } }));
  it("blocks payment crossing T8 before its ten-minute timer expires", () => {
    const p = evaluatePaymentQualification({ ...payment, reservedAt: T - 8 * H - 5 * 60_000, confirmedAt: T - 8 * H });
    expect(p.status).toBe("BLOCKED_POLICY"); expect(p.blockerIds).toEqual(["OP-05"]); expect(p.effect?.recordReceipt).toBe(true);
  });
  it("rejects reverse time or unsafe amounts", () => expect(evaluatePaymentQualification({ ...payment, confirmedAt: payment.reservedAt - 1 }).status).toBe("INVALID_INPUT"));
});
describe("approved business: cancellation event/time/component matrix", () => {
  it.each([
    [24 * H + 1, 1200, 2800, "REFUND"], [24 * H, 1200, 2800, "REFUND"], [24 * H - 1, 0, 2800, "REFUND"],
    [8 * H + 1, 0, 2800, "REFUND"], [8 * H, 0, 2800, "REFUND"], [8 * H - 1, 0, 0, "RESTAURANT_COMPENSATION"],
  ])("current unformed Δ=%d", (delta, F, D, disposition) => {
    for (const tableState of ["WAITING", "INVALIDATED"] as const) expect(evaluateCancellation({ ...cancel, tableState, acceptedAt: T - Number(delta) }).effect).toEqual({ refundF: F, refundD: D, depositDisposition: disposition, compensationRequired: false, accountingRevenue: null });
  });
  it.each([[24 * H + 1, "PLATFORM_RETAINED"], [24 * H, "RESTAURANT_COMPENSATION"], [24 * H - 1, "RESTAURANT_COMPENSATION"]])("current formed Δ=%d preserves business disposition, no revenue recognition", (delta, disposition) => expect(evaluateCancellation({ ...cancel, tableState: "FORMED", acceptedAt: T - Number(delta) }).effect).toEqual({ refundF: 0, refundD: 0, depositDisposition: disposition, compensationRequired: false, accountingRevenue: null }));
  it.each([[8 * H + 1, 2800], [8 * H, 2800], [8 * H - 1, 0]])("explicit late-formed Δ=%d", (delta, D) => expect(evaluateCancellation({ ...cancel, category: "LATE_FORMED", tableState: "FORMED", acceptedAt: T - delta }).effect?.refundD).toBe(D));
  it("the original acceptedAt controls a delayed review", () => {
    const request = freeze({ ...cancel, acceptedAt: T - 24 * H });
    expect(evaluateCancellation(request).effect?.refundF).toBe(1200); expect(evaluateCancellation(request).effect?.refundF).toBe(1200);
  });
  it.each(["PLATFORM_CANCEL", "RESTAURANT_CANCEL", "CORE_CHANGE_REJECTED"] as const)("%s preserves full refunds and distinct compensation", reason => expect(evaluateCancellation({ ...cancel, tableState: "FORMED", category: "UNRESOLVED", reason }).effect).toMatchObject({ refundF: 1200, refundD: 2800, compensationRequired: true }));
  it.each(["WAITLIST_EXPIRED", "FORMATION_FAILED", "LATE_RECEIPT"] as const)("%s establishes full obligation", reason => expect(evaluateCancellation({ ...cancel, reason }).effect).toMatchObject({ refundF: 1200, refundD: 2800 }));
  it("waitlist exits refund irrespective of hours or other tables' state", () => expect(evaluateCancellation({ ...cancel, membership: "WAITLIST", tableState: "FORMED", acceptedAt: T - H }).effect).toMatchObject({ refundF: 1200, refundD: 2800 }));
  it("normal restaurant-confirmed fulfillment refunds only D", () => expect(evaluateCancellation({ ...cancel, reason: "NORMAL_FULFILLMENT" }).effect).toMatchObject({ refundF: 0, refundD: 2800 }));
  it.each(["D_ONLY", "F_AND_D"] as const)("exception %s permits no invented percentage", specialScope => expect(evaluateCancellation({ ...cancel, reason: "SPECIAL_APPROVED", specialScope }).effect?.refundF).toBe(specialScope === "D_ONLY" ? 0 : 1200));
  it("missing category blocks money disposition without losing the request", () => expect(evaluateCancellation({ ...cancel, category: "UNRESOLVED" }).blockerIds).toEqual(["OP-05"]));
  it("post-start self cancellation cannot be silently treated as no-show", () => expect(evaluateCancellation({ ...cancel, acceptedAt: T }).status).toBe("BLOCKED_POLICY"));
  it("unsafe funding or negative times are rejected", () => expect(evaluateCancellation({ ...cancel, funding: { F: -1, D: 1 } }).status).toBe("INVALID_INPUT"));
  it("component budgets deduct successful and unknown/in-flight refunds", () => {
    expect(allocateRefundBudget({ received: FD, completed: { F: 0, D: 2800 }, inFlight: { F: 0, D: 0 }, desired: FD }).effect).toEqual({ F: 1200, D: 0 });
    expect(allocateRefundBudget({ received: FD, completed: { F: 0, D: 0 }, inFlight: FD, desired: FD }).effect).toEqual({ F: 0, D: 0 });
    expect(allocateRefundBudget({ received: FD, completed: FD, inFlight: { F: 0, D: 1 }, desired: FD }).status).toBe("INVALID_INPUT");
  });
  it("next-day batches follow Shanghai natural day across UTC midnight", () => {
    expect(nextShanghaiNaturalDay(Date.parse("2026-10-01T15:59:59Z")).effect?.date).toBe("2026-10-02");
    expect(nextShanghaiNaturalDay(Date.parse("2026-10-01T16:00:00Z")).effect?.date).toBe("2026-10-03");
  });
});
describe("approved business: formation history, own-table access and supply strategy", () => {
  it("reaching min forms immediately below target", () => expect(evaluateTableLifecycle(table).effect).toMatchObject({ state: "FORMED", action: "FORM" }));
  it("below min invalidates formed history without deleting it", () => expect(evaluateTableLifecycle({ ...table, state: "FORMED", activeFormalCount: 3, everFormed: true }).effect).toMatchObject({ state: "INVALIDATED", action: "INVALIDATE" }));
  it("T24 still below min finally fails", () => expect(evaluateTableLifecycle({ ...table, activeFormalCount: 3, acceptedAt: T - 24 * H }).effect).toMatchObject({ state: "FAILED", action: "FAIL_AND_REFUND" }));
  it("a T24-failed table never revives even after an apparent later min", () => expect(evaluateTableLifecycle({ ...table, state: "FAILED", activeFormalCount: 4, acceptedAt: T - 12 * H, formedAtT24: false }).effect?.state).toBe("FAILED"));
  it("only formed-at-T24 history allows direct middle-window recovery", () => {
    expect(evaluateTableLifecycle({ ...table, state: "INVALIDATED", activeFormalCount: 3, acceptedAt: T - 12 * H, formedAtT24: true, everFormed: true }).effect).toMatchObject({ directRecruiting: true, waitlistAllowed: false });
    expect(evaluateTableLifecycle({ ...table, state: "INVALIDATED", activeFormalCount: 4, acceptedAt: T - 12 * H, formedAtT24: true, everFormed: true }).effect).toMatchObject({ action: "RESTORE", state: "FORMED" });
    expect(evaluateTableLifecycle({ ...table, acceptedAt: T - 12 * H, formedAtT24: null }).status).toBe("BLOCKED_POLICY");
  });
  it("T8 stops recruiting and preserves the restaurant decision carrier", () => expect(evaluateTableLifecycle({ ...table, state: "INVALIDATED", activeFormalCount: 3, acceptedAt: T - 8 * H, formedAtT24: true, everFormed: true }).effect).toMatchObject({ action: "RESTAURANT_DECISION_REQUIRED", directRecruiting: false }));
  it("own formed table reveals name and address immediately before T24", () => expect(getOwnTableVisibility({ membership: "FORMAL", memberValid: true, ownTable: true, state: "FORMED", everFormed: true, terminalAccess: "ACTIVE" }).effect).toEqual({ showName: true, showAddress: true }));
  it("invalidated keeps name, hides address; restore reopens", () => {
    const v = { membership: "FORMAL" as const, memberValid: true, ownTable: true, everFormed: true, terminalAccess: "ACTIVE" as const };
    expect(getOwnTableVisibility({ ...v, state: "INVALIDATED" }).effect).toEqual({ showName: true, showAddress: false });
    expect(getOwnTableVisibility({ ...v, state: "FORMED" }).effect?.showAddress).toBe(true);
  });
  it.each([{ ownTable: false }, { membership: "WAITLIST" }, { memberValid: false }])("other tables/waitlist/invalid members get no address: %j", patch => expect(getOwnTableVisibility({ membership: "FORMAL", memberValid: true, ownTable: true, state: "FORMED", everFormed: true, terminalAccess: "ACTIVE", ...patch } as Parameters<typeof getOwnTableVisibility>[0]).effect?.showAddress).toBe(false));
  it("terminal address matrix remains unresolved", () => expect(getOwnTableVisibility({ membership: "FORMAL", memberValid: false, ownTable: true, state: "FORMED", everFormed: true, terminalAccess: "UNRESOLVED" }).blockerIds).toEqual(["OP-15"]));
  it("finite strategies allocate new FIFO members, preserving already committed tables", () => {
    const members = Array.from({ length: 8 }, (_, i) => `test-${i}`);
    const r = allocateNewTableMembers({ supply, committedTables: [], orderedNewMemberIds: members });
    expect(r.effect?.pendingTableMembers.map(g => g.length)).toEqual([6, 2]);
    expect(allocateNewTableMembers({ supply: { ...supply, allocationStrategy: "FILL_TO_MAX" }, committedTables: [], orderedNewMemberIds: members }).effect?.pendingTableMembers.map(g => g.length)).toEqual([8]);
    const locked = freeze([{ tableId: "test-locked", memberIds: ["a", "b", "c", "d"] }]);
    const added = allocateNewTableMembers({ supply, committedTables: locked, orderedNewMemberIds: members });
    expect(added.effect?.committedTables[0]?.memberIds.slice(0, 4)).toEqual(locked[0]?.memberIds);
    expect(added.effect?.committedTables[0]?.memberIds.length).toBe(6);
    expect(added.effect?.pendingTableMembers.flat()).toEqual(members.slice(2));
    expect(locked[0]?.memberIds.length).toBe(4);
  });
  it("target preference yields to max/maxTables and never loses members", () => {
    const ids = Array.from({ length: 15 }, (_, i) => `test-${i}`);
    const r = allocateNewTableMembers({ supply, committedTables: [], orderedNewMemberIds: ids });
    expect(r.effect?.pendingTableMembers.map(g => g.length)).toEqual([7, 8]); expect(r.effect?.pendingTableMembers.flat()).toEqual(ids);
    expect(allocateNewTableMembers({ supply, committedTables: [], orderedNewMemberIds: [...ids, "a", "b"] }).status).toBe("INVALID_INPUT");
  });
});
describe("approved business: paid waitlist race and limits", () => {
  const current: WaitlistState = { state: "WAITING", version: 1, fifoSequence: 8, qualified: true };
  const event = { type: "EXIT" as const, transactionSequence: 2, beforeT24: true, capacityAvailable: true };
  it("exit-first establishes one refund, rejects later promotion", () => {
    const exit = reduceWaitlist(current, event); expect(exit.effect?.fullRefundObligation).toBe(true);
    const later = reduceWaitlist(exit.effect!.next, { ...event, type: "PROMOTE", transactionSequence: 3 }); expect(later.effect?.grantFormalSeat).toBe(false);
  });
  it("promotion-first grants exactly one seat and later exit is formal cancellation", () => {
    const promote = reduceWaitlist(current, { ...event, type: "PROMOTE" }); expect(promote.effect?.grantFormalSeat).toBe(true);
    expect(reduceWaitlist(promote.effect!.next, { ...event, transactionSequence: 3 }).effect?.fullRefundObligation).toBe(false);
  });
  it("stale transaction replay produces no second effect", () => expect(reduceWaitlist(current, { ...event, transactionSequence: 1 }).effect?.fullRefundObligation).toBe(false));
  it("T24 expires remaining qualification and establishes obligation independently of payout", () => expect(reduceWaitlist(current, { ...event, type: "EXPIRE", beforeT24: false }).effect).toMatchObject({ fullRefundObligation: true, next: { state: "EXPIRED" } }));
  it("promotion never continues into the post-T24 window", () => expect(reduceWaitlist(current, { ...event, type: "PROMOTE", beforeT24: false }).effect?.grantFormalSeat).toBe(false));
  it("unpaid waitlist never gains eligibility", () => expect(reduceWaitlist({ ...current, qualified: false }, { ...event, type: "PROMOTE" }).status).toBe("INVALID_INPUT"));
  it.each([[null, "BLOCKED_POLICY"], [0, "READY"], [2, "READY"], [3, "READY"]])("admission limit=%s", (limit, status) => {
    const r = evaluateWaitlistAdmission({ validCount: 2, limit, beforeT24: true, unresolvedPriorRegistration: false, inFlightAdmissions: 0 });
    expect(r.status).toBe(status); expect(r.effect?.createPayment).toBe(limit === 3);
  });
  it("concurrent exposure and unsettled prior refunds stay OP08", () => expect(evaluateWaitlistAdmission({ validCount: 0, limit: 3, beforeT24: true, unresolvedPriorRegistration: true, inFlightAdmissions: 1 }).blockerIds).toEqual(["OP-08"]));
});
describe("approved business scaffolding with explicit unresolved operational gates", () => {
  const eligible = { loggedIn: true, phoneAuthorized: true, gender: "MALE", adultEligibility: "SIMULATION_CONFIRMED" as const, blacklisted: false, accountClosurePending: false, requiresSpecialAccommodation: false };
  it("minimal synthetic eligibility has no time-preference requirement", () => expect(evaluateRegistrationEligibility(eligible).effect?.allowed).toBe(true));
  it("special accommodation is refused before charging without sensitive details", () => expect(evaluateRegistrationEligibility({ ...eligible, requiresSpecialAccommodation: true }).effect?.allowed).toBe(false));
  it("unresolved adult/adaptation/new registration during closure are isolated", () => {
    expect(evaluateRegistrationEligibility({ ...eligible, adultEligibility: "UNRESOLVED" }).blockerIds).toEqual(["RV-04"]);
    expect(evaluateRegistrationEligibility({ ...eligible, requiresSpecialAccommodation: null }).blockerIds).toEqual(["OP-10", "RV-07"]);
    expect(evaluateRegistrationEligibility({ ...eligible, accountClosurePending: true }).blockerIds).toEqual(["OP-15"]);
  });
  it("account closure accepts requests while preserving unsettled responsibilities", () => {
    expect(evaluateAccountClosure({ requestedAt: T, obligations: { funds: true, fulfillment: false, dispute: false } }).effect).toEqual({ acceptRequest: true, finalize: false, preserveFundingFacts: true });
    expect(evaluateAccountClosure({ requestedAt: T, obligations: { funds: false, fulfillment: false, dispute: false } }).effect?.finalize).toBe(true);
  });
  it("a restaurant change refusal preserves full obligation and unspecified extra compensation", () => expect(evaluateCoreChange({ kind: "RESTAURANT", response: "REJECT", acceptedAt: T - H, now: T, deadlineAt: null, deadlineSource: "UNRESOLVED", originalT: T, proposedT: T + H }).effect).toEqual({ applyChange: false, fullRefundObligation: true, compensationRequired: true, compensationAmount: null }));
  it("real delivery definition never becomes approved merely by a timestamp", () => expect(evaluateDisputeWindow({ deliveredAt: T, acceptedAt: T + H, deliveryPolicy: "UNRESOLVED", phase: "INITIAL_EXPLANATION" }).blockerIds).toEqual(["OP-13", "RV-02"]));
  it("a final reviewer must be a different person, not just another account", () => expect(evaluateFinalReview({ firstReviewerPersonId: "test-person", finalReviewerPersonId: "test-person", alreadyUsed: false, applicationInWindow: true, pending: true }).effect).toEqual({ mayReview: false, holdDeposit: true, settlementAllowed: false }));
});
describe("PROPOSAL_HARNESS: explicit synthetic delivery/deadline inputs only", () => {
  it.each(["INITIAL_EXPLANATION", "FINAL_REVIEW_APPLICATION"] as const)("%s has its own 48h clock", phase => {
    expect(evaluateDisputeWindow({ deliveredAt: T, acceptedAt: T + 48 * H, deliveryPolicy: "SIMULATION_ONLY", phase }).effect).toMatchObject({ inWindow: true, evidenceClass: "SIMULATION_ONLY" });
    expect(evaluateDisputeWindow({ deliveredAt: T, acceptedAt: T + 48 * H + 1, deliveryPolicy: "SIMULATION_ONLY", phase }).effect?.inWindow).toBe(false);
  });
  it("only synthetic configured restaurant deadline turns no response into a refund", () => {
    const args = { kind: "RESTAURANT" as const, response: "NONE" as const, acceptedAt: T - H, now: T, deadlineAt: T, deadlineSource: "SIMULATION_ONLY" as const, originalT: T, proposedT: T + H };
    expect(evaluateCoreChange(args).effect).toMatchObject({ applyChange: false, fullRefundObligation: true, compensationRequired: true });
    expect(evaluateCoreChange({ ...args, kind: "OTHER_CORE" }).blockerIds).toEqual(["OP-09"]);
  });
});

describe("approved business: confirmation, rejection and preserved request", () => {
  it("scan and missing confirmation do not create refund or user violation", () => expect(evaluateFulfillment({ scanned: true, restaurantResult: "NOT_CONFIRMED", restaurantConfirmedAt: null, activityEndedAt: T, funding: FD }).effect).toEqual({ refundRequired: { F: 0, D: 0 }, reviewRequired: false, operationalTodo: true, initiationDay: null }));
  it("normal confirmation creates only D next Shanghai day, not completed refund", () => expect(evaluateFulfillment({ scanned: true, restaurantResult: "NORMAL", restaurantConfirmedAt: T + H, activityEndedAt: T, funding: FD }).effect).toMatchObject({ refundRequired: { F: 0, D: 2800 }, initiationDay: "2026-10-11" }));
  it("restaurant abnormal marker creates review without immediate deductions", () => expect(evaluateFulfillment({ scanned: true, restaurantResult: "ABNORMAL", restaurantConfirmedAt: T + H, activityEndedAt: T, funding: FD }).effect).toMatchObject({ reviewRequired: true, refundRequired: { F: 0, D: 0 } }));
  it("a restaurant result lacking confirmation cannot be forged from the scan", () => expect(evaluateFulfillment({ scanned: true, restaurantResult: "NORMAL", restaurantConfirmedAt: null, activityEndedAt: T, funding: FD }).status).toBe("INVALID_INPUT"));
  it("special denial restores original cancellation rights without moving its time", () => expect(evaluateSpecialRejection({ ...cancel, tableState: "FORMED", acceptedAt: T - 25 * H }).effect?.depositDisposition).toBe("PLATFORM_RETAINED"));
  it("member-removal timing stays explicitly OP04", () => expect(evaluateFormalMemberRemoval()).toMatchObject({ status: "BLOCKED_POLICY", blockerIds: ["OP-04"], effect: { removeMember: false } }));
  it("exact T24 payment cannot invent its joining classification", () => expect(evaluatePaymentQualification({ reservedAt: T - 24 * H - 60_000, confirmedAt: T - 24 * H, startAt: T, status: "SUCCEEDED", expected: FD, received: FD })).toMatchObject({ status: "BLOCKED_POLICY", blockerIds: ["OP-05"], effect: { recordReceipt: true, qualification: "NONE" } }));
});
describe("PROPOSAL_HARNESS: queue authority remains explicit", () => {
  const reentry = { previousState: "EXITED" as const, previousSequence: 8, tailSequence: 20, newSequence: 21, orderingAuthority: "SIMULATION_ONLY" as const, admission: { validCount: 0, limit: 3, beforeT24: true, unresolvedPriorRegistration: false, inFlightAdmissions: 0 } };
  it("a lawful new request goes to the new tail and never regains old priority", () => expect(evaluateWaitlistReentry(reentry).effect).toEqual({ newApplication: true, fifoSequence: 21, restorePriority: false }));
  it("real ordering clock remains blocked", () => expect(evaluateWaitlistReentry({ ...reentry, orderingAuthority: "UNRESOLVED" }).blockerIds).toEqual(["OP-05"]));
  it("expired queue rebooking remains OP08 and does not revive the queue", () => expect(evaluateWaitlistReentry({ ...reentry, previousState: "EXPIRED" }).blockerIds).toEqual(["OP-08"]));
  it("new reentry sequence cannot claim an old sequence", () => expect(evaluateWaitlistReentry({ ...reentry, newSequence: 8 }).status).toBe("INVALID_INPUT"));
});
