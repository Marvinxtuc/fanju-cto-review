import { createHmac, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { evaluateDisputeWindow } from "@timeleft-shanghai/shared";
import type { PrismaClient } from "../generated/prisma/client.js";
import { activityLock, registrationLock, dbNow, requestRecord, audit, notify, json, object, reserveRefund, terminateAndRefund, publicRequest, acceptCancellation } from "./domain.js";
import { businessKey, identifier, pageQuery, parse, profileInput, reject, requireOwner, requireRole, simulationNextDay, type LocalPrincipal } from "./contracts.js";
import { enqueue, type Lease } from "../jobs/queue.js";
import { assertLease } from "./domain.js";

const hour = 3_600_000;
const regBody = z.object({ registrationId: identifier, result: z.enum(["NORMAL", "ABNORMAL"]) }).strict();
const rightBody = z.object({ kind: z.enum(["ACCESS", "EXPORT", "CORRECTION", "CLOSURE", "WITHDRAWAL"]), businessKey, correction: profileInput.optional() }).strict();
const decisionBody = z.object({ requestId: identifier.optional(), decision: z.enum(["REFUND_D", "REFUND_FD", "BREACH", "REJECT"]), reason: z.string().trim().min(1).max(500) }).strict();
const changeBody = z.object({ activityId: identifier, supplyId: identifier, kind: z.enum(["RESTAURANT", "OTHER_CORE"]), proposedSnapshot: z.record(z.string(), z.unknown()), businessKey, deadlineAt: z.string().datetime().optional(), extraCompensationCents: z.number().int().min(1).max(2_147_483_647).optional() }).strict();
const choiceBody = z.object({ changeId: identifier.optional(), choice: z.enum(["ACCEPT", "REJECT"]) }).strict();
function batchHour(reg: Awaited<ReturnType<typeof registrationLock>>) { return parse(z.number().int().min(0).max(23), object(object(reg.supply.snapshot).approval).simulationBatchHour); }
function idOf(input: Record<string, unknown>) { return parse(identifier, input.id); }
function qrSecret() { const s = process.env.PRELAUNCH_SESSION_SECRET; if (!s || s.length < 32) reject(503, "LOCAL_SESSION_CONFIGURATION_REQUIRED"); return s; }
function sign(value: string) { return createHmac("sha256", qrSecret()).update(value).digest("base64url"); }
function verifyQr(token: string) {
  const parts = token.split("."); if (parts.length !== 2) reject(400, "INVALID_CHECKIN_CODE");
  const expected = Buffer.from(sign(parts[0]!)); const actual = Buffer.from(parts[1]!);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) reject(400, "INVALID_CHECKIN_CODE");
  try { return parse(z.object({ activityId: identifier, restaurantId: identifier, scope: z.literal("SIMULATION_ONLY"), expiresAt: z.number().int() }).strict(), JSON.parse(Buffer.from(parts[0]!, "base64url").toString())); }
  catch { reject(400, "INVALID_CHECKIN_CODE"); }
}
async function scopedRestaurant(db: PrismaClient, actor: LocalPrincipal, activityId: string) {
  requireRole(actor, "RESTAURANT"); const a = await db.activity.findUnique({ where: { id: activityId } });
  if (!a || a.restaurantId !== actor.restaurantId) reject(404, "RESOURCE_NOT_FOUND"); return a;
}
async function refundDue(tx: Parameters<typeof reserveRefund>[0], reg: Awaited<ReturnType<typeof registrationLock>>, F: number, D: number, key: string, at: Date) {
  const rows = await tx.v11ReceiptBinding.findMany({ where: { registrationId: reg.id, classification: "PRIMARY" } });
  for (const row of rows) await reserveRefund(tx, reg, row.receiptId, { F, D }, `${key}:${row.receiptId}`, at);
}
// This dispatcher is used only by the dedicated owned Mock app. It is never registered in the legacy/live app.
export async function aftersalesRoute(db: PrismaClient, actor: LocalPrincipal, action: string, input: Record<string, unknown>) {
  if (action === "specialRefund") {
    const id = idOf(input); const body = parse(z.object({ businessKey, reasonCode: z.enum(["ILLNESS", "FLIGHT_CANCELED", "TRANSPORT_INTERRUPTED", "OTHER_EXCEPTION"]), syntheticEvidence: z.string().trim().min(1).max(1000).optional() }).strict(), input.body);
    const cancellation = await acceptCancellation(db, actor, id, `special-original:${body.businessKey}`);
    return db.$transaction(async tx => {
      const reg = await registrationLock(tx, id); requireOwner(actor, reg.userId);
      const payload = object(cancellation.payload);
      const request = await requestRecord(tx, { businessKey: `special:${body.businessKey}`, kind: "SPECIAL_REFUND", registrationId: id, userId: reg.userId, acceptedAt: cancellation.acceptedAt,
        payload: { reasonCode: body.reasonCode, syntheticEvidence: body.syntheticEvidence ?? null, evidenceScope: "SYNTHETIC_ONLY", originalCancellation: payload.decision, originalRequestId: cancellation.id }, blockers: ["OP-10", "RV-05"], state: "SIMULATION_REVIEW_PENDING" });
      await audit(tx, "special-refund.accepted", "V11Request", request.id, actor); return { request: publicRequest(request), realMaterialCollectionEnabled: false };
    });
  }
  if (action === "checkinCode") {
    const a = await scopedRestaurant(db, actor, idOf(input));
    const at = await db.$transaction(dbNow);
    const payload = Buffer.from(JSON.stringify({ activityId: a.id, restaurantId: a.restaurantId, scope: "SIMULATION_ONLY", expiresAt: at.getTime() + 10 * 60_000 })).toString("base64url");
    await db.$transaction(tx => audit(tx, "checkin-code.created", "Activity", a.id, actor));
    return { qrToken: `${payload}.${sign(payload)}`, scope: "SIMULATION_ONLY", engineeringTtlSeconds: 600 };
  }
  if (action === "checkin") {
    const body = parse(z.object({ registrationId: identifier, qrToken: z.string().min(1).max(3000) }).strict(), input.body);
    const code = verifyQr(body.qrToken);
    return db.$transaction(async tx => {
      const reg = await registrationLock(tx, body.registrationId); requireOwner(actor, reg.userId); const at = await dbNow(tx);
      if (code.activityId !== reg.activityId || code.restaurantId !== reg.activity.restaurantId || code.expiresAt <= at.getTime()) reject(409, "CHECKIN_CODE_EXPIRED_OR_SCOPE_MISMATCH");
      if (!reg.active || reg.eligibilityState !== "FORMAL") reject(409, "FORMAL_MEMBERSHIP_REQUIRED");
      const prior = await tx.v11Attendance.findUnique({ where: { registrationId: reg.id } });
      if (prior?.checkinAt) return { attendance: { registrationId: reg.id, checkinAt: prior.checkinAt, restaurantResult: prior.restaurantResult } };
      const row = await tx.v11Attendance.upsert({ where: { registrationId: reg.id }, create: { registrationId: reg.id, checkinAt: at }, update: { checkinAt: at, version: { increment: 1 } } });
      await audit(tx, "arrival.recorded", "V11Attendance", row.id, actor);
      return { attendance: { registrationId: reg.id, checkinAt: row.checkinAt, restaurantResult: row.restaurantResult } };
    });
  }
  if (action === "fulfillment") {
    const body = parse(regBody, input.body); requireRole(actor, "RESTAURANT");
    return db.$transaction(async tx => {
      const reg = await registrationLock(tx, body.registrationId); if (reg.activity.restaurantId !== actor.restaurantId) reject(404, "RESOURCE_NOT_FOUND");
      const at = await dbNow(tx); if (at < reg.activity.endsAt) reject(409, "ACTIVITY_NOT_ENDED");
      if (reg.eligibilityState !== "FORMAL" || !reg.active) reject(409, "FORMAL_MEMBERSHIP_REQUIRED");
      const prior = await tx.v11Attendance.findUnique({ where: { registrationId: reg.id } });
      if (prior?.restaurantResult) { if (prior.restaurantResult !== body.result) reject(409, "FULFILLMENT_RESULT_CONFLICT"); return { attendance: prior }; }
      const attendance = await tx.v11Attendance.upsert({ where: { registrationId: reg.id }, create: { registrationId: reg.id, restaurantActorId: actor.id, restaurantResult: body.result, confirmedAt: at }, update: { restaurantActorId: actor.id, restaurantResult: body.result, confirmedAt: at, version: { increment: 1 } } });
      if (body.result === "NORMAL") {
        // The supply's explicitly chosen TEST_ONLY schedule is never official batch policy.
        const runAt = simulationNextDay(reg.activity.endsAt, batchHour(reg));
        await refundDue(tx, reg, 0, reg.depositCents, `normal:${reg.id}`, runAt);
        await notify(tx, reg.id, "NORMAL_DEPOSIT_WAITING_BATCH", `v11:normal:${reg.id}`);
      } else {
        const request = await requestRecord(tx, { businessKey: `dispute:${reg.id}`, kind: "DISPUTE", userId: reg.userId, registrationId: reg.id, state: "WAITING_EXPLANATION", blockers: ["OP-13", "RV-02"], payload: { source: "RESTAURANT_ABNORMAL", depositCents: reg.depositCents, scope: "SIMULATION_ONLY", initialDeliveredAt: null, resultDeliveredAt: null, finalReviewUsed: false } });
        await notify(tx, reg.id, "ABNORMAL_NOTICE", `v11:abnormal:${request.id}`, request.id);
      }
      await audit(tx, "fulfillment.restaurant-confirmed", "V11Attendance", attendance.id, actor);
      return { attendance: { registrationId: reg.id, restaurantResult: attendance.restaurantResult, confirmedAt: attendance.confirmedAt }, batchPolicy: "TEST_ONLY_EXPLICIT_SCHEDULE", channelConfirmed: false };
    });
  }
  if (action === "receiveNotice") {
    const id = idOf(input);
    return db.$transaction(async tx => {
      const initial = await tx.v11DeliveryProof.findUnique({ where: { id } }); if (!initial?.registrationId) reject(404, "RESOURCE_NOT_FOUND");
      const reg = await registrationLock(tx, initial.registrationId); requireOwner(actor, reg.userId);
      const row = await tx.v11DeliveryProof.findUniqueOrThrow({ where: { id } }); const at = await dbNow(tx);
      if (row.receivedAt) return { notice: { id, state: row.state, receivedAt: row.receivedAt, evidenceClass: "SIMULATION_ONLY" } };
      if (row.proofType !== "SIMULATED") reject(409, "DELIVERY_EVIDENCE_UNRESOLVED", ["OP-13"]);
      await tx.v11DeliveryProof.update({ where: { id }, data: { state: "SIMULATED_READ", receivedAt: at, personId: actor.personId } });
      if (row.requestId) {
        const request = await tx.v11Request.findUniqueOrThrow({ where: { id: row.requestId } }); if(request.source!=="SIMULATION_ONLY")reject(409,"SIMULATION_REQUEST_REQUIRED"); const payload = object(request.payload);
        if (row.kind === "ABNORMAL_NOTICE" && !payload.initialDeliveredAt) payload.initialDeliveredAt = at.toISOString();
        if (row.kind === "FIRST_RESULT" && !payload.resultDeliveredAt) payload.resultDeliveredAt = at.toISOString();
        await tx.v11Request.update({ where: { id: request.id }, data: { payload: json(payload), version: { increment: 1 } } });
        if (["ABNORMAL_NOTICE", "FIRST_RESULT"].includes(row.kind)) await enqueue(tx, "V11_DISPUTE_EXPIRE", `v11:dispute-clock:${row.id}`, request.id, new Date(at.getTime() + 48 * hour + 1));
      }
      await audit(tx, "notice.simulated-read", "V11DeliveryProof", id, actor);
      return { notice: { id, state: "SIMULATED_READ", receivedAt: at, evidenceClass: "SIMULATION_ONLY", productionDeliveryApproved: false } };
    });
  }
  if (action === "explanation" || action === "review") {
    const id = idOf(input); const body = parse(z.object({ businessKey, statement: z.string().trim().min(1).max(1000).optional() }).strict(), input.body);
    return db.$transaction(async tx => {
      const initial = await tx.v11Request.findUnique({ where: { id } }); if (!initial?.registrationId) reject(404, "RESOURCE_NOT_FOUND");
      await registrationLock(tx, initial.registrationId); const request = await tx.v11Request.findUniqueOrThrow({ where: { id } }); requireOwner(actor, request.userId ?? "");
      if (request.kind !== "DISPUTE") reject(409, "DISPUTE_REQUEST_REQUIRED");
      if(request.source!=="SIMULATION_ONLY")reject(409,"SIMULATION_REQUEST_REQUIRED"); const payload = object(request.payload); const at = await dbNow(tx);
      const final = action === "review"; const clock = final ? payload.resultDeliveredAt : payload.initialDeliveredAt;
      const deliveredAt = typeof clock === "string" ? new Date(clock).getTime() : null;
      const window = evaluateDisputeWindow({ deliveredAt, acceptedAt: at.getTime(), deliveryPolicy: "SIMULATION_ONLY", phase: final ? "FINAL_REVIEW_APPLICATION" : "INITIAL_EXPLANATION" });
      // Requests are accepted even without approved delivery; no lawful appeal is blanket rejected.
      const application = await requestRecord(tx, { businessKey: `${action}:${body.businessKey}`, kind: final ? "FINAL_REVIEW_APPLICATION" : "DISPUTE_EXPLANATION", userId: request.userId!, registrationId: request.registrationId!, payload: { parentRequestId: id, statement: body.statement ?? "", acceptedAt: at.toISOString(), window, scope: "SIMULATION_ONLY" }, blockers: window.status === "READY" ? [] : ["OP-13", "RV-02"], acceptedAt: at });
      if (window.effect?.inWindow) {
        if (final) {
          if (!payload.firstReviewerPersonId) reject(409, "FIRST_DECISION_REQUIRED");
          if (payload.finalReviewUsed) {
            const prior = await tx.v11Request.findFirst({ where: { kind: "FINAL_REVIEW_APPLICATION", registrationId: request.registrationId, id: { not: application.id } }, orderBy: { acceptedAt: "asc" } });
            if (prior) return { request: publicRequest(prior), alreadyUsed: true };
          }
          payload.finalReviewUsed = true; payload.finalApplicationAt = at.toISOString();
        } else payload.explanationReceivedAt = at.toISOString();
        await tx.v11Request.update({ where: { id }, data: { state: final ? "FINAL_REVIEW_PENDING" : "EXPLANATION_SUBMITTED", payload: json(payload), version: { increment: 1 } } });
      } else if (window.status === "READY") await tx.v11Request.update({ where: { id: application.id }, data: { state: "LATE_APPLICATION_REQUIRES_REVIEW", blockerIds: json(["OP-11", "OP-13"]) } });
      await audit(tx, `${action}.accepted`, "V11Request", application.id, actor);
      return { request: publicRequest(await tx.v11Request.findUniqueOrThrow({ where: { id: application.id } })), depositSettlementAllowed: false };
    });
  }
  if (action === "decision") {
    const body = parse(decisionBody, input.body); const id = body.requestId ?? idOf(input); requireRole(actor, "OPS", "REVIEWER");
    return db.$transaction(async tx => {
      const initial = await tx.v11Request.findUnique({ where: { id } }); if (!initial?.registrationId) reject(404, "RESOURCE_NOT_FOUND");
      const reg = await registrationLock(tx, initial.registrationId); const request = await tx.v11Request.findUniqueOrThrow({ where: { id } }); if(request.source!=="SIMULATION_ONLY")reject(409,"SIMULATION_REQUEST_REQUIRED"); const payload = object(request.payload); const at = await dbNow(tx);
      if (!["DISPUTE", "SPECIAL_REFUND"].includes(request.kind)) reject(409, "REVIEWABLE_REQUEST_REQUIRED");
      if (request.kind === "DISPUTE" && !["REFUND_D", "BREACH"].includes(body.decision)) reject(400, "DISPUTE_DECISION_INVALID");
      if (request.kind === "SPECIAL_REFUND" && body.decision === "BREACH") reject(400, "SPECIAL_DECISION_INVALID");
      const final = request.state === "FINAL_REVIEW_PENDING";
      const prior = await tx.v11Decision.findFirst({ where: { requestId: id, kind: final ? "FINAL" : "FIRST" }, orderBy: { createdAt: "asc" } });
      if (prior) { if (object(prior.payload).decision !== body.decision) reject(409, "DECISION_ALREADY_RECORDED"); return { request: publicRequest(request) }; }
      if (final && payload.firstReviewerPersonId === actor.personId) reject(409, "DISTINCT_REVIEWER_PERSON_REQUIRED");
      if (!final && request.kind === "DISPUTE") {
        const delivered = typeof payload.initialDeliveredAt === "string" ? Date.parse(payload.initialDeliveredAt) : null;
        if (!delivered) reject(409, "DELIVERY_EVIDENCE_UNRESOLVED", ["OP-13", "RV-02"]);
        if (!payload.explanationReceivedAt && at.getTime() <= delivered + 48 * hour) reject(409, "EXPLANATION_WINDOW_OPEN");
        if (!payload.explanationReceivedAt && body.decision === "BREACH") {
          const retained = await requestRecord(tx, { businessKey: `default-breach-blocked:${id}`, kind: "DEFAULT_BREACH_REVIEW", registrationId: reg.id, userId: reg.userId, payload: { parentRequestId: id, proposedDecision: body.decision }, blockers: ["OP-13", "RV-02"] });
          return { request: publicRequest(retained), depositSettlementAllowed: false };
        }
      }
      let correctionRequired = false;
      if (body.decision === "REFUND_D" || body.decision === "REFUND_FD") {
        const settled = await tx.v11Disposition.findMany({ where: { component: { receipt: { v11ReceiptBinding_receiptId: { registrationId: reg.id } }, kind: "D" }, kind: { not: "REFUND" }, state: "COMPLETED" }, include: { component: true } });
        if (settled.length) {
          correctionRequired = true;
          await requestRecord(tx, { businessKey: `settled-correction:${id}:${final ? "final" : "first"}`, kind: "SETTLED_DEPOSIT_CORRECTION", registrationId: reg.id, userId: reg.userId, payload: { parentRequestId: id, approvedDecision: body.decision, originalDispositions: settled.map(row => ({ id: row.id, componentId: row.componentId, receiptId: row.component.receiptId, amountCents: row.amountCents, sourceRef: row.sourceRef })), userRefundObligationCents: reg.depositCents, serviceFeeRefundObligationCents: body.decision === "REFUND_FD" ? reg.serviceFeeCents : 0, correctionFundingSource: "UNRESOLVED", recoveryResponsibility: "UNRESOLVED", originalDepositReusable: false, scope: "SIMULATION_ONLY" }, blockers: ["OP-14", "RV-06"], state: "BLOCKED_POLICY" });
        }
        if (!correctionRequired) await refundDue(tx, reg, body.decision === "REFUND_FD" ? reg.serviceFeeCents : 0, reg.depositCents, `decision:${id}:${final ? "final" : "first"}`, simulationNextDay(at, batchHour(reg)));
      }
      if (body.decision === "REJECT" && request.kind === "SPECIAL_REFUND") {
        const original = object(payload.originalCancellation);
        const effect = object(original.effect);
        if (typeof effect.refundF !== "number" || typeof effect.refundD !== "number") reject(409, "ORIGINAL_CANCELLATION_EVIDENCE_REQUIRED", ["OP-04"]);
        await refundDue(tx, reg, effect.refundF, effect.refundD, `special-reject:${id}`, simulationNextDay(at, batchHour(reg)));
      }
      const decision = await tx.v11Decision.create({ data: { requestId: id, actorId: actor.id, personId: actor.personId, kind: final ? "FINAL" : "FIRST", payload: json({ decision: body.decision, reason: body.reason, scope: "SIMULATION_ONLY", acceptedAt: at.toISOString() }) } });
      if (!final) payload.firstReviewerPersonId = actor.personId;
      payload.latestDecision = body.decision; payload.latestDecisionId = decision.id;
      const state = correctionRequired ? "CORRECTION_BLOCKED_POLICY" : body.decision === "BREACH" ? (final ? "SETTLEMENT_BLOCKED_POLICY" : "FIRST_RESULT_PENDING_DELIVERY") : "REFUND_APPROVED_WAITING_BATCH";
      await tx.v11Request.update({ where: { id }, data: { state, payload: json(payload), blockerIds: json(correctionRequired || body.decision === "BREACH" ? ["OP-14", "RV-06"] : []), version: { increment: 1 } } });
      await notify(tx, reg.id, final ? "FINAL_RESULT" : "FIRST_RESULT", `v11:decision:${decision.id}`, id);
      await audit(tx, "review.simulated-decision", "V11Decision", decision.id, actor);
      return { request: publicRequest(await tx.v11Request.findUniqueOrThrow({ where: { id } })), depositSettlementAllowed: false, scope: "SIMULATION_ONLY" };
    });
  }
  if (action === "createRight") {
    requireRole(actor, "USER"); if (!actor.userId) reject(403, "USER_ID_REQUIRED"); const body = parse(rightBody, input.body);
    return db.$transaction(async tx => {
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId} FOR UPDATE`;
      const row = await requestRecord(tx, { businessKey: `right:${body.businessKey}`, kind: `RIGHT_${body.kind}`, userId: actor.userId!, payload: { correction: body.correction ?? null, scope: "SIMULATION_ONLY" }, blockers: ["OP-15", "RV-05"] });
      await audit(tx, "privacy.request-accepted", "V11Request", row.id, actor); return { request: publicRequest(row) };
    });
  }
  if (action === "listRights" || action === "getRight") {
    requireRole(actor, "USER", "OPS");
    const where = actor.role === "USER" ? { userId: actor.userId ?? "" } : {};
    if (action === "listRights") { const q = parse(pageQuery, input.query ?? {}); const rows = await db.v11Request.findMany({ where: { ...where, kind: { startsWith: "RIGHT_" }, ...(q.cursor ? { id: { gt: q.cursor } } : {}) }, orderBy: { id: "asc" }, take: q.limit + 1 }); const rights = rows.slice(0, q.limit); return { rights: rights.map(publicRequest), nextCursor: rows.length > q.limit ? rights.at(-1)!.id : null }; }
    const row = await db.v11Request.findFirst({ where: { ...where, id: idOf(input), kind: { startsWith: "RIGHT_" } } }); if (!row) reject(404, "RESOURCE_NOT_FOUND");
    return { right: publicRequest(row), export: object(row.payload).export ?? null, dispositions: await db.v11PrivacyDisposition.findMany({ where: { requestId: row.id }, select: { id: true, state: true, fields: true, appliedAt: true } }) };
  }
  if (action === "processRight") {
    requireRole(actor, "OPS"); const id = idOf(input);
    return db.$transaction(async tx => {
      const initial = await tx.v11Request.findUnique({ where: { id } }); if (!initial?.userId || !initial.kind.startsWith("RIGHT_")) reject(404, "RESOURCE_NOT_FOUND");
      await tx.$queryRaw`SELECT id FROM "User" WHERE id=${initial.userId} FOR UPDATE`;
      const row = await tx.v11Request.findUniqueOrThrow({ where: { id } }); const payload = object(row.payload); const at = await dbNow(tx);
      if (row.state === "RESOLVED") return { request: publicRequest(row), export: payload.export ?? null, scope: "SIMULATION_ONLY" };
      if (row.kind === "RIGHT_ACCESS" || row.kind === "RIGHT_EXPORT") {
        const profile = await tx.v11Profile.findUnique({ where: { userId: row.userId! }, select: { gender: true, availableTimes: true, adultConfirmed: true, adaptationConfirmed: true } });
        const registrations = await tx.v11Registration.findMany({ where: { userId: row.userId! }, select: { id: true, activityId: true, serviceFeeCents: true, depositCents: true, eligibilityState: true, acceptedAt: true } });
        payload.export = { scope: "SIMULATION_ONLY", profile, registrations }; // No phone, openid, credential, other user, or restaurant evidence is exported.
      } else if (row.kind === "RIGHT_CORRECTION") {
        const correction = parse(profileInput, payload.correction);
        await tx.v11Profile.upsert({ where: { userId: row.userId! }, create: { userId: row.userId!, gender: correction.gender, availableTimes: correction.timePreferences, adultConfirmed: true, adaptationConfirmed: true }, update: { gender: correction.gender, availableTimes: correction.timePreferences, version: { increment: 1 } } });
      } else {
        const active = await tx.v11Registration.count({ where: { userId: row.userId!, active: true } });
        const refunds = await tx.v11RefundInstruction.count({ where: { registration: { userId: row.userId! }, state: { not: "CONFIRMED" } } });
        const disputes = await tx.v11Request.count({ where: { userId: row.userId!, kind: { in: ["DISPUTE", "SPECIAL_REFUND"] }, state: { notIn: ["RESOLVED", "REFUND_APPROVED_WAITING_BATCH", "CLOSED", "CANCELED"] } } });
        const settlements = await tx.v11SettlementObligation.count({ where: { registration: { userId: row.userId! }, state: { notIn: ["COMPLETED", "RELEASED", "CANCELED"] } } });
        const deposits = await tx.v11FundComponent.findMany({ where: { kind: "D", receipt: { v11ReceiptBinding_receiptId: { is: { registration: { userId: row.userId! } } } } }, include: { v11Disposition_componentId: { where: { state: "COMPLETED" } } } });
        const heldD = deposits.reduce((total, component) => total + Math.max(0, component.originalCents - component.v11Disposition_componentId.reduce((sum, disposition) => sum + disposition.amountCents, 0)), 0);
        payload.obligations = { activeRegistrations: active, unresolvedRefunds: refunds, unresolvedDisputes: disputes, unresolvedSettlements: settlements, heldDepositCents: heldD };
        await tx.v11Request.update({ where: { id }, data: { state: active || refunds || disputes || settlements || heldD ? "OBLIGATIONS_PENDING" : "BLOCKED_POLICY", payload: json(payload), blockerIds: json(["OP-15", "RV-05"]), version: { increment: 1 } } });
        return { request: publicRequest(await tx.v11Request.findUniqueOrThrow({ where: { id } })), fundingFactsPreserved: true };
      }
      await tx.v11PrivacyDisposition.upsert({ where: { businessKey: `privacy:${id}` }, update: {}, create: { requestId: id, userId: row.userId!, businessKey: `privacy:${id}`, fields: row.kind === "RIGHT_CORRECTION" ? ["gender", "availableTimes"] : ["OWN_SYNTHETIC_EXPORT"], state: "APPLIED_SIMULATION", appliedAt: at } });
      await tx.v11Request.update({ where: { id }, data: { state: "RESOLVED", payload: json(payload), blockerIds: json([]), version: { increment: 1 } } });
      await audit(tx, "privacy.simulated-process", "V11Request", id, actor);
      return { request: publicRequest(await tx.v11Request.findUniqueOrThrow({ where: { id } })), export: payload.export ?? null, scope: "SIMULATION_ONLY" };
    });
  }
  if (action === "createChange") {
    requireRole(actor, "OPS"); const body = parse(changeBody, input.body);
    return db.$transaction(async tx => {
      await activityLock(tx, body.activityId); const a = await tx.activity.findUniqueOrThrow({ where: { id: body.activityId } });
      const supply = await tx.v11SupplyRevision.findUniqueOrThrow({ where: { id: body.supplyId } }); if (supply.activityId !== a.id) reject(409, "SUPPLY_SCOPE_MISMATCH");
      const proposed = { ...body.proposedSnapshot, deadlineAt: body.deadlineAt ?? null, deadlineSource: body.deadlineAt ? "SIMULATION_ONLY" : "UNRESOLVED" };
      const canonical = (value: unknown): string => JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item);
      const previous = await tx.v11CoreChange.findUnique({ where: { businessKey: body.businessKey } });
      if (previous) { if (previous.activityId !== body.activityId || previous.kind !== body.kind || previous.supplyId !== body.supplyId || previous.extraCompensationCents !== (body.extraCompensationCents ?? null) || canonical(previous.proposedSnapshot) !== canonical(proposed)) reject(409, "IDEMPOTENCY_CONFLICT"); return { change: previous }; }
      const at = await dbNow(tx); if (body.deadlineAt && new Date(body.deadlineAt) <= at) reject(400, "CHANGE_DEADLINE_INVALID");
      const change = await tx.v11CoreChange.create({ data: { activityId: a.id, supplyId: supply.id, businessKey: body.businessKey, kind: body.kind, originalSnapshot: json({ startsAt: a.startsAt, restaurantId: a.restaurantId, supplyId: supply.id, snapshot: supply.snapshot }), proposedSnapshot: json(proposed), ...(body.extraCompensationCents === undefined ? {} : { extraCompensationCents: body.extraCompensationCents }), acceptedAt: at } });
      if (body.deadlineAt && body.kind === "RESTAURANT") await enqueue(tx, "V11_CHANGE_EXPIRE", `v11:change-expire:${change.id}`, change.id, new Date(body.deadlineAt));
      const regs = await tx.v11Registration.findMany({ where: { activityId: a.id, active: true, eligibilityState: "FORMAL" } });
      for (const reg of regs) await notify(tx, reg.id, "CORE_CHANGE_PROPOSED", `v11:change:${change.id}:${reg.id}`);
      await requestRecord(tx, { businessKey: `change-policy:${change.id}`, kind: "CORE_CHANGE_POLICY", payload: { changeId: change.id, extraCompensationCents: body.extraCompensationCents ?? null }, blockers: ["OP-09", "OP-13", "RV-03"] });
      await audit(tx, "change.proposed", "V11CoreChange", change.id, actor); return { change };
    });
  }
  if (action === "respondChange") {
    const body = parse(choiceBody, input.body); const id = body.changeId ?? idOf(input);
    return db.$transaction(async tx => {
      const change = await tx.v11CoreChange.findUniqueOrThrow({ where: { id } }); await activityLock(tx, change.activityId); requireRole(actor, "USER");
      const reg0 = await tx.v11Registration.findFirst({ where: { activityId: change.activityId, userId: actor.userId ?? "", eligibilityState: "FORMAL" } }); if (!reg0) reject(404, "RESOURCE_NOT_FOUND");
      const reg = await registrationLock(tx, reg0.id); const at = await dbNow(tx); const proposal = object(change.proposedSnapshot);
      const prior = await tx.v11ChangeChoice.findUnique({ where: { changeId_registrationId: { changeId: id, registrationId: reg.id } } });
      if (prior) { if (prior.choice !== body.choice) reject(409, "CHANGE_CHOICE_ALREADY_RECORDED"); return { choice: prior }; }
      if (body.choice === "ACCEPT" && (typeof proposal.deadlineAt !== "string" || proposal.deadlineSource !== "SIMULATION_ONLY")) {
        const request = await requestRecord(tx, { businessKey: `change-accept:${id}:${reg.id}`, kind: "CHANGE_ACCEPTANCE", registrationId: reg.id, userId: reg.userId, payload: { changeId: id, choice: body.choice }, blockers: ["OP-09", "OP-13"] }); return { request: publicRequest(request) };
      }
      if (body.choice === "ACCEPT" && at >= new Date(String(proposal.deadlineAt))) reject(409, "CORE_CHANGE_ACCEPTANCE_EXPIRED");
      const choice = await tx.v11ChangeChoice.create({ data: { changeId: id, registrationId: reg.id, choice: body.choice, acceptedAt: at } });
      if (body.choice === "REJECT") {
        await terminateAndRefund(tx, reg, `change-reject:${id}:${reg.id}`, "CORE_CHANGE_REJECTED", at);
        if (change.kind === "RESTAURANT") await requestRecord(tx, { businessKey: `change-compensation:${id}:${reg.id}`, kind: "EXTRA_COMPENSATION", registrationId: reg.id, userId: reg.userId, payload: { changeId: id, required: true, amountCents: change.extraCompensationCents, scope: "SIMULATION_ONLY" }, blockers: ["OP-09", "RV-03"] });
      }
      // Accepting one user's proposal never rewrites the shared activity or historical supply.
      await audit(tx, "change.choice-accepted", "V11ChangeChoice", choice.id, actor); return { choice, originalSnapshotPreserved: true };
    });
  }
  if (action === "listChanges") {
    requireRole(actor, "USER", "OPS", "RESTAURANT");
    const q = parse(pageQuery, input.query ?? {});
    const rows = await db.v11CoreChange.findMany({ where: { ...(actor.role === "USER" ? { activity: { v11Registration_activityId: { some: { userId: actor.userId ?? "" } } } } : actor.role === "RESTAURANT" ? { activity: { restaurantId: actor.restaurantId ?? "" } } : {}), ...(q.cursor ? { id: { gt: q.cursor } } : {}) }, orderBy: { id: "asc" }, take: q.limit + 1 });
    const selected = rows.slice(0, q.limit); return { changes: selected.map(row => ({ ...row, allowedActions: row.state === "PROPOSED" ? ["ACCEPT", "REJECT"] : [] })), nextCursor: rows.length > q.limit ? selected.at(-1)!.id : null };
  }
  if (action === "cancelActivity" || action === "closeActivity") {
    requireRole(actor, "OPS"); const id = idOf(input);
    parse(z.object({ businessKey, reason: z.string().trim().min(1).max(500).optional() }).strict(), input.body);
    return db.$transaction(async tx => {
      await activityLock(tx, id); const activity = await tx.activity.findUniqueOrThrow({ where: { id } }); const at = await dbNow(tx);
      if (action === "closeActivity") { await tx.activity.update({ where: { id }, data: { registrationEndsAt: at } }); await audit(tx, "activity.closed", "Activity", id, actor); return { activityId: id, registrationClosed: true }; }
      const regs = await tx.v11Registration.findMany({ where: { activityId: id, active: true }, orderBy: { id: "asc" } });
      for (const reg of regs) {
        if (reg.cancelAcceptedAt) { await requestRecord(tx, { businessKey: `cancel-overlap:${id}:${reg.id}`, kind: "CANCELLATION_OVERLAP", registrationId: reg.id, userId: reg.userId, payload: { reason: "PLATFORM_CANCEL", originalAcceptedAt: reg.cancelAcceptedAt }, blockers: ["OP-04"] }); continue; }
        await terminateAndRefund(tx, reg, `platform-cancel:${id}:${reg.id}`, "PLATFORM_CANCEL", at);
        await requestRecord(tx, { businessKey: `compensation:${id}:${reg.id}`, kind: "EXTRA_COMPENSATION", registrationId: reg.id, userId: reg.userId, payload: { required: true, amountCents: null }, blockers: ["OP-09", "RV-03"] });
      }
      await tx.activity.update({ where: { id }, data: { status: "CANCELED" } }); await audit(tx, "activity.canceled", "Activity", id, actor);
      return { activityId: id, state: "CANCELED", compensationRequired: true, compensationBlockers: ["OP-09", "RV-03"], originalState: activity.status };
    });
  }
  if (action === "listRestaurantActivities" || action === "listOpsActivities") {
    requireRole(actor, action === "listRestaurantActivities" ? "RESTAURANT" : "OPS");
    const q = parse(pageQuery, input.query ?? {});
    const rows = await db.activity.findMany({ where: { ...(action === "listRestaurantActivities" ? { restaurantId: actor.restaurantId ?? "" } : {}), ...(q.cursor ? { id: { gt: q.cursor } } : {}) }, select: { id: true, title: true, startsAt: true, endsAt: true, status: true, restaurantId: true }, orderBy: { id: "asc" }, take: q.limit + 1 });
    const activities = rows.slice(0, q.limit); return { activities, nextCursor: rows.length > q.limit ? activities.at(-1)!.id : null };
  }
  reject(404, "RESOURCE_NOT_FOUND");
}

export function aftersalesHandlers(db: PrismaClient) {
  return {
    V11_FULFILLMENT_CHECK: async (lease: Lease) => { await db.$transaction(async tx => {
      await activityLock(tx, lease.refId); await assertLease(tx, lease); const at = await dbNow(tx);
      const activity = await tx.activity.findUniqueOrThrow({ where: { id: lease.refId } });
      if (at < lease.runAt || at < activity.endsAt) reject(409, "FULFILLMENT_CHECK_NOT_DUE");
      const registrations = await tx.v11Registration.findMany({ where: { activityId: activity.id, eligibilityState: "FORMAL", active: true }, orderBy: { id: "asc" } });
      for (const reg of registrations) {
        const result = await tx.v11Attendance.findUnique({ where: { registrationId: reg.id } });
        if (!result?.restaurantResult) await requestRecord(tx, { businessKey: `missing-confirmation:${reg.id}`, kind: "MISSING_RESTAURANT_CONFIRMATION", registrationId: reg.id, userId: reg.userId, payload: { restaurantId: activity.restaurantId, notBreach: true }, blockers: ["OP-12"], acceptedAt: at });
      }
    }); },
    V11_DISPUTE_EXPIRE: async (lease: Lease) => { await db.$transaction(async tx => {
      const initial = await tx.v11Request.findUniqueOrThrow({ where: { id: lease.refId } });
      if (!initial.registrationId) reject(409, "DISPUTE_REQUEST_REQUIRED");
      const reg = await registrationLock(tx, initial.registrationId); await assertLease(tx, lease);
      const request = await tx.v11Request.findUniqueOrThrow({ where: { id: lease.refId } }); if(request.source!=="SIMULATION_ONLY")reject(409,"SIMULATION_REQUEST_REQUIRED"); const payload = object(request.payload); const at = await dbNow(tx);
      if (request.kind !== "DISPUTE") reject(409, "DISPUTE_REQUEST_REQUIRED");
      if (!payload.firstReviewerPersonId && !payload.explanationReceivedAt) {
        if (typeof payload.initialDeliveredAt !== "string" || at.getTime() <= Date.parse(payload.initialDeliveredAt) + 48 * hour) return;
        await requestRecord(tx, { businessKey: `default-breach-blocked:${request.id}`, kind: "DEFAULT_BREACH_REVIEW", registrationId: reg.id, userId: reg.userId, payload: { parentRequestId: request.id, intent: "DEFAULT_FIRST_BREACH", depositCents: reg.depositCents }, blockers: ["OP-13", "RV-02"] });
        return;
      }
      if (payload.latestDecision !== "BREACH" || payload.finalReviewUsed || typeof payload.resultDeliveredAt !== "string" || at.getTime() <= Date.parse(payload.resultDeliveredAt) + 48 * hour) return;
      const bindings = await tx.v11ReceiptBinding.findMany({ where: { registrationId: reg.id, classification: "PRIMARY" } });
      for (const binding of bindings) {
        const component = await tx.v11FundComponent.findUnique({ where: { receiptId_kind: { receiptId: binding.receiptId, kind: "D" } } });
        if (!component) reject(409, "COMPONENT_EVIDENCE_REQUIRED");
        const allocated = await tx.v11Disposition.aggregate({ where: { componentId: component.id, state: { not: "RELEASED" } }, _sum: { amountCents: true } });
        if ((allocated._sum.amountCents ?? 0) > 0) {
          await requestRecord(tx, { businessKey: `settlement-budget-blocked:${request.id}`, kind: "SETTLEMENT_BUDGET_REVIEW", registrationId: reg.id, userId: reg.userId, payload: { parentRequestId: request.id }, blockers: ["OP-14"] }); continue;
        }
        await tx.v11SettlementObligation.upsert({ where: { businessKey: `settlement:${request.id}:${component.id}` }, update: {}, create: { registrationId: reg.id, componentId: component.id, businessKey: `settlement:${request.id}:${component.id}`, amountCents: component.originalCents, state: "BLOCKED_POLICY", sourceRef: request.id } });
      }
      await tx.v11Request.update({ where: { id: request.id }, data: { state: "SETTLEMENT_BLOCKED_POLICY", blockerIds: json(["OP-14", "RV-06"]), version: { increment: 1 } } });
      await audit(tx, "settlement.flow-entered-no-transfer", "V11Request", request.id);
    }); },
    V11_CHANGE_EXPIRE: async (lease: Lease) => { await db.$transaction(async tx => {
      const change = await tx.v11CoreChange.findUniqueOrThrow({ where: { id: lease.refId } });
      await activityLock(tx, change.activityId); await assertLease(tx, lease); const at = await dbNow(tx); const proposal = object(change.proposedSnapshot);
      if (change.kind !== "RESTAURANT" || proposal.deadlineSource !== "SIMULATION_ONLY" || typeof proposal.deadlineAt !== "string") reject(409, "CHANGE_DEADLINE_UNRESOLVED", ["OP-09"]);
      if (at < new Date(proposal.deadlineAt)) reject(409, "CHANGE_DEADLINE_NOT_DUE");
      const regs = await tx.v11Registration.findMany({ where: { activityId: change.activityId, active: true, eligibilityState: "FORMAL" }, orderBy: { id: "asc" } });
      for (const reg of regs) {
        if (await tx.v11ChangeChoice.findUnique({ where: { changeId_registrationId: { changeId: change.id, registrationId: reg.id } } })) continue;
        await tx.v11ChangeChoice.create({ data: { changeId: change.id, registrationId: reg.id, choice: "SIMULATION_TIMEOUT_REJECTED", acceptedAt: new Date(proposal.deadlineAt) } });
        await terminateAndRefund(tx, reg, `change-timeout:${change.id}:${reg.id}`, "CORE_CHANGE_REJECTED", new Date(proposal.deadlineAt));
        await requestRecord(tx, { businessKey: `change-compensation:${change.id}:${reg.id}`, kind: "EXTRA_COMPENSATION", registrationId: reg.id, userId: reg.userId, payload: { changeId: change.id, required: true, source: "PROPOSAL_HARNESS", amountCents: change.extraCompensationCents }, blockers: ["OP-09", "RV-03"] });
      }
      await tx.v11CoreChange.update({ where: { id: change.id }, data: { state: "SIMULATION_WINDOW_ENDED", version: { increment: 1 } } });
    }); },
  };
}
