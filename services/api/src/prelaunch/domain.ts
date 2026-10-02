import {formalRejoinSafety} from './formal-rejoin-safety.js';
import { createHash, randomUUID } from "node:crypto";
import { evaluateCancellation, evaluatePaymentQualification, evaluateRegistrationEligibility, evaluateTableLifecycle, evaluateWaitlistAdmission, getOwnTableVisibility, type CancellationReason, type PrelaunchTableState } from "@timeleft-shanghai/shared";
import type { Prisma, PrismaClient, V11Registration } from "../generated/prisma/client.js";
import { enqueue, openCase, type Lease } from "../jobs/queue.js";
import { LOCAL_MOCK_BINDING, PersistentMockChannel, type ChannelBinding } from "../funding/mock-channel.js";
import { PrelaunchError, reject, requireOwner, requireRole, type LocalPrincipal } from "./contracts.js";
import { matchesConsentDocuments, intactDraftConsentDocuments } from './consent-evidence.js';

export type Tx = Prisma.TransactionClient;
export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");
export const json = (value: unknown): Prisma.InputJsonValue => JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
export function object(value: unknown): Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
export async function dbNow(tx: Tx) { const rows = await tx.$queryRaw<{ at: Date }[]>`SELECT clock_timestamp() AS at`; return rows[0]!.at; }
export async function activityLock(tx: Tx, activityId: string) { await tx.$queryRaw`SELECT id FROM "Activity" WHERE id = ${activityId} FOR UPDATE`; }
export async function registrationLock(tx: Tx, id: string) {
  const row = await tx.v11Registration.findUnique({ where: { id } });
  if (!row) reject(404, "RESOURCE_NOT_FOUND");
  await activityLock(tx, row.activityId);
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${row.userId} FOR UPDATE`;
  await tx.$queryRaw`SELECT id FROM "V11Registration" WHERE id = ${id} FOR UPDATE`;
  return tx.v11Registration.findUniqueOrThrow({ where: { id }, include: { activity: true, supply: true, policy: true } });
}
export async function assertLease(tx: Tx, lease: Lease) {
  const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM "DurableJob" WHERE id=${lease.id} AND state='RUNNING' AND generation=${lease.generation} AND "leaseOwner"=${lease.leaseOwner} AND "leaseUntil">clock_timestamp() FOR UPDATE`;
  if (!rows.length) reject(409, "STALE_WORKER_LEASE");
}
export function assertSimulationPolicy(policy: { bundleVersion: string; status: string; docsJson: unknown }) {
  if (policy.status !== "LOCAL_DRAFT" || !policy.bundleVersion.startsWith("SIMULATION_ONLY:") || object(policy.docsJson).scope !== "TEST_ONLY") reject(409, "POLICY_NOT_ACTIVATABLE", ["RV-01", "RV-02", "RV-03", "RV-04", "RV-05", "RV-06", "RV-07"]);
}
export async function audit(tx: Tx, action: string, targetType: string, targetId: string, actor?: LocalPrincipal) {
  await tx.auditLog.create({ data: { action: `prelaunch.${action}`, targetType, targetId, metadata: { scope: "SIMULATION_ONLY", ...(actor ? { actorId: actor.id, personId: actor.personId } : {}) } } });
}
export async function requestRecord(tx: Tx, input: { businessKey: string; kind: string; userId?: string; registrationId?: string; payload: unknown; blockers?: readonly string[]; ownerActorId?: string; state?: string; acceptedAt?: Date; source?: 'FORMAL_BUSINESS_ROUTE' }) {
  const previous = await tx.v11Request.findUnique({ where: { businessKey: input.businessKey } });
  if (previous) {
    if (previous.kind !== input.kind || previous.userId !== (input.userId ?? null) || previous.registrationId !== (input.registrationId ?? null)
      ||previous.source!==(input.source??'SIMULATION_ONLY')) reject(409, "IDEMPOTENCY_CONFLICT");
    return previous;
  }
  const owners = input.ownerActorId ? [] : await tx.v11Actor.findMany({ where: { role: "OPS", enabled: true }, orderBy: { id: "asc" }, take: 1 });
  return tx.v11Request.create({ data: { businessKey: input.businessKey, kind: input.kind, ...(input.userId ? { userId: input.userId } : {}), ...(input.registrationId ? { registrationId: input.registrationId } : {}),
    source: input.source??"SIMULATION_ONLY", acceptedAt: input.acceptedAt ?? await dbNow(tx), state: input.state ?? (input.blockers?.length ? "BLOCKED_POLICY" : "ACCEPTED"),
    blockerIds: json(input.blockers ?? []), payload: json(input.payload), ...(input.ownerActorId || owners[0] ? { ownerActorId: input.ownerActorId ?? owners[0]!.id } : {}) } });
}
export async function notify(tx: Tx, registrationId: string, kind: string, key: string, requestId?: string) {
  const notice = await tx.v11DeliveryProof.upsert({ where: { noticeKey: key }, update: {}, create: { registrationId, ...(requestId ? { requestId } : {}), noticeKey: key, kind, state: "CREATED", proofType: "SIMULATED" } });
  await enqueue(tx, "V11_NOTIFY", `v11:notify:${notice.id}`, notice.id);
  return notice;
}
export async function enqueueMerchantClose(tx: Tx, registrationId: string) {
  const intents = await tx.v11PaymentIntent.findMany({ where: { registrationId, active: true } });
  for (const intent of intents) await enqueue(tx, "V11_CLOSE_PAYMENT", `v11:close:${intent.id}`, intent.id);
}
export async function expireHolds(tx: Tx, activityId: string, at: Date) {
  const holds = await tx.v11SeatHold.findMany({ where: { state: "HELD", expiresAt: { lte: at }, registration: { activityId } }, orderBy: { registrationId: "asc" } });
  for (const hold of holds) {
    const updated = await tx.v11SeatHold.updateMany({ where: { id: hold.id, state: "HELD" }, data: { state: "EXPIRED", releasedAt: at, version: { increment: 1 } } });
    if (updated.count) await enqueueMerchantClose(tx, hold.registrationId);
    if (updated.count) await tx.v11Registration.updateMany({ where: { id: hold.registrationId, eligibilityState: "PENDING_PAYMENT" }, data: { eligibilityState: "EXPIRED", active: false, version: { increment: 1 } } });
  }
  await promoteWaitlist(tx, activityId, at);
}
function tableState(state: string): PrelaunchTableState { if (state === "UNFORMED") return "WAITING"; if (["WAITING", "FORMED", "INVALIDATED", "FAILED"].includes(state)) return state as PrelaunchTableState; reject(409, "UNKNOWN_TABLE_STATE", ["OP-05"]); }
export async function refreshTable(tx: Tx, tableId: string, effectiveAt: Date) {
  const table = await tx.v11Table.findUniqueOrThrow({ where: { id: tableId }, include: { activity: true, supply: true } });
  const count = await tx.v11Membership.count({ where: { tableId, active: true } });
  const t24 = new Date(table.activity.startsAt.getTime() - 24 * 3_600_000);
  // Delayed T24 workers must not turn missing materialization into a failed cutoff.
  const historicalAtCutoff = effectiveAt > t24 && table.t24FormedAt === null
    ? await tx.v11Membership.count({ where: { tableId, joinedAt: { lte: t24 }, OR: [{ leftAt: null }, { leftAt: { gt: t24 } }] } })
    : null;
  const formedAtCutoff = table.t24FormedAt !== null ? true : effectiveAt <= t24 ? null : historicalAtCutoff! >= table.supply.minSize;
  // Decisions delayed by a worker use the original cutoff, never the execution clock.
  const decision = evaluateTableLifecycle({ state: tableState(table.state), activeFormalCount: count, min: table.supply.minSize, max: table.supply.maxSize,
    startAt: table.activity.startsAt.getTime(), acceptedAt: effectiveAt.getTime(), formedAtT24: formedAtCutoff, everFormed: table.everFormed });
  if (decision.effect && (decision.effect.state !== tableState(table.state) || decision.effect.action !== "NONE")) {
    const next = decision.effect;
    const version = table.version + 1;
    await tx.v11Table.update({ where: { id: table.id }, data: { state: next.state, version, everFormed: table.everFormed || next.state === "FORMED", ...(next.state === "FAILED" ? { failedAt: effectiveAt } : {}) } });
    await tx.v11TableEvent.create({ data: { tableId, businessKey: `table:${table.id}:${version}`, kind: next.action, acceptedAt: effectiveAt, version,
      snapshot: json({ count, supplyId: table.supplyId, policyId: table.supply.policyId, state: next.state, blockerIds: decision.blockerIds }) } });
    const members = await tx.v11Membership.findMany({ where: { tableId, active: true } });
    for (const member of members) await notify(tx, member.registrationId, `TABLE_${next.action}`, `v11:table:${table.id}:${version}:${member.registrationId}`);
    if (next.action === "FAIL_AND_REFUND") for (const member of members) {
      const reg = await tx.v11Registration.findUniqueOrThrow({ where: { id: member.registrationId } });
      await terminateAndRefund(tx, reg, `formation:${table.id}:${reg.id}`, "FORMATION_FAILED", effectiveAt);
    }
  }
  if (decision.status === "BLOCKED_POLICY") await requestRecord(tx, { businessKey: `table-blocker:${table.id}:${table.version}`, kind: "LOW_PERSON_DECISION", payload: { tableId, count }, blockers: decision.blockerIds });
  return decision;
}
export async function assignFormal(tx: Tx, reg: V11Registration, at: Date,formal?:{refresh:(tx:Tx,tableId:string,at:Date)=>Promise<unknown>;audit:(tx:Tx,tableId:string)=>Promise<unknown>}) {
  const supply = await tx.v11SupplyRevision.findUniqueOrThrow({ where: { id: reg.supplyId } });
  if((supply.status==='FORMAL_APPROVED')!==!!formal)reject(409,'TABLE_ASSEMBLY_SCOPE_CONFLICT');
  const activity = await tx.activity.findUniqueOrThrow({ where: { id: reg.activityId } });
  const tables = await tx.v11Table.findMany({ where: { activityId: reg.activityId, ...(formal?{supplyId:reg.supplyId}:{}), state: { not: "FAILED" } }, orderBy: { ordinal: "asc" } });
  let chosen: typeof tables[number] | undefined;
  const cap = supply.strategy === "FILL_TO_TARGET" ? supply.targetSize : supply.maxSize;
  const counts = new Map<string, number>();
  for (const table of tables) counts.set(table.id, await tx.v11Membership.count({ where: { tableId: table.id, active: true } }));
  const chooseEquivalent = async (legal: typeof tables) => {
    const first = legal[0]; if (!first) return undefined;
    const tied = legal.filter(table => counts.get(table.id) === counts.get(first.id));
    const incoming = object(reg.snapshot).gender;
    if (tied.length < 2 || (incoming !== "MALE" && incoming !== "FEMALE")) return first;
    const scores: { table: typeof first; score: number }[] = [];
    for (const table of tied) {
      const members = await tx.v11Membership.findMany({ where: { tableId: table.id, active: true }, include: { registration: { select: { snapshot: true } } } });
      const genders = members.map(member => object(member.registration.snapshot).gender);
      if (genders.some(gender => gender !== "MALE" && gender !== "FEMALE")) return first;
      const balance = genders.reduce<number>((sum, gender) => sum + (gender === "MALE" ? 1 : -1), 0);
      scores.push({ table, score: Math.abs(balance + (incoming === "MALE" ? 1 : -1)) });
    }
    scores.sort((a, b) => a.score - b.score || a.table.ordinal - b.table.ordinal);
    const chosen = scores[0]!.table;
    if (chosen.id !== first.id){if(formal)await formal.audit(tx,chosen.id);else await audit(tx, "table.internal-soft-tiebreak", "V11Table", chosen.id);}
    return chosen;
  };
  if (at.getTime() <= activity.startsAt.getTime() - 24 * 3_600_000) {
    chosen = await chooseEquivalent(tables.filter(table => (counts.get(table.id) ?? 0) < cap));
    if (!chosen && tables.length < supply.maxTables) chosen = await tx.v11Table.create({ data: { activityId: reg.activityId, supplyId: reg.supplyId, ordinal: tables.length + 1, state: "WAITING" } });
    chosen ??= await chooseEquivalent(tables.filter(table => (counts.get(table.id) ?? 0) < supply.maxSize));
  } else chosen = await chooseEquivalent(tables.filter(table => table.state === "FORMED" && table.t24FormedAt !== null && (counts.get(table.id) ?? 0) < supply.maxSize));
  if (!chosen) reject(409, "NO_LEGAL_FORMAL_CAPACITY");
  await tx.v11Membership.create({ data: { registrationId: reg.id, tableId: chosen.id, joinedAt: at } });
  await tx.v11Registration.update({ where: { id: reg.id }, data: { eligibilityState: "FORMAL", paidEffectiveAt: reg.paidEffectiveAt ?? at, version: { increment: 1 } } });
  if(formal)await formal.refresh(tx,chosen.id,at);else await refreshTable(tx, chosen.id, at);
}
/** Owned simulation harness only: ordinal is transaction order, not approved official FIFO time. */
export async function promoteWaitlist(tx: Tx, activityId: string, at: Date) {
  await activityLock(tx,activityId);
  const activity = await tx.activity.findUniqueOrThrow({ where: { id:activityId } });
  if (!["PUBLISHED","REGISTRATION_OPEN"].includes(activity.status) || at >= activity.registrationEndsAt || at.getTime() >= activity.startsAt.getTime()-24*3_600_000) return;
  const waiting = await tx.v11Registration.findMany({ where: { activityId, active:true, eligibilityState:"WAITLIST" }, orderBy:[{queueOrdinal:"asc"},{id:"asc"}], include:{supply:{include:{policy:true}}} });
  for (const reg of waiting) {
    assertSimulationPolicy(reg.supply.policy);
    if (reg.queueOrdinal === null || reg.supply.status !== "SIMULATION_APPROVED") { await requestRecord(tx,{businessKey:`promotion-blocked:${reg.id}`,kind:"WAITLIST_PROMOTION",registrationId:reg.id,userId:reg.userId,payload:{scope:"SIMULATION_ONLY",rankingClock:"UNRESOLVED"},blockers:["OP-05"]});break; }
    const formal=await tx.v11Membership.count({where:{active:true,registration:{activityId}}});
    const held=await tx.v11SeatHold.count({where:{state:"HELD",expiresAt:{gt:at},registration:{activityId,category:{not:"WAITLIST"}}}});
    if (formal+held>=reg.supply.capacity) break;
    // The activity lock is also held by exit/cancel. No inactive member can win promotion.
    const current=await tx.v11Registration.findUniqueOrThrow({where:{id:reg.id}});
    if(!current.active || current.eligibilityState!=="WAITLIST")continue;
    await tx.v11Registration.update({where:{id:reg.id},data:{category:"ORDINARY",version:{increment:1}}});
    await assignFormal(tx,reg,at);
    await requestRecord(tx,{businessKey:`promotion:${reg.id}`,kind:"WAITLIST_PROMOTION",registrationId:reg.id,userId:reg.userId,payload:{scope:"SIMULATION_ONLY",rankingClock:"TEST_ONLY_TRANSACTION_ORDINAL",originalOrdinal:reg.queueOrdinal.toString()},acceptedAt:at,state:"RESOLVED"});
    await notify(tx,reg.id,"WAITLIST_PROMOTED",`v11:promotion:${reg.id}`);
    await audit(tx,"waitlist.promoted.simulation","V11Registration",reg.id);
  }
}
export interface FormalRegistrationBoundary {
 validateSupply(tx:Tx,actor:LocalPrincipal,supply:Prisma.V11SupplyRevisionGetPayload<{include:{policy:true}}>,membership:'FORMAL'|'WAITLIST'):Promise<void>;
 validateProfile(tx:Tx,actor:LocalPrincipal,profile:Prisma.V11ProfileGetPayload<object>|null):Promise<boolean>;
 validateConsent(tx:Tx,actor:LocalPrincipal,consent:Prisma.V11BundleConsentGetPayload<object>,policy:Prisma.V11PolicySnapshotGetPayload<object>):Promise<void>;
 expire(tx:Tx,activityId:string,at:Date):Promise<void>;
 created(tx:Tx,actor:LocalPrincipal,registration:V11Registration):Promise<void>;
 allowConcurrentWaitlist?(tx:Tx):boolean;
 admissionBlockers(tx:Tx,supply:Prisma.V11SupplyRevisionGetPayload<{include:{policy:true}}>,membership:'FORMAL'|'WAITLIST'):Promise<string[]>;
}
export async function createRegistration(db: PrismaClient, actor: LocalPrincipal, input: { activityId: string; supplyId: string; policyId: string; consentId: string; membership: "FORMAL" | "WAITLIST"; businessKey: string },formal?:FormalRegistrationBoundary) {
  requireRole(actor, "USER");
  if (!actor.userId) reject(403, "USER_ID_REQUIRED");
  return db.$transaction(async tx => {
    const record=(v:Parameters<typeof requestRecord>[1])=>requestRecord(tx,{...v,...(formal?{source:'FORMAL_BUSINESS_ROUTE' as const}:{})});
    await activityLock(tx, input.activityId);
    await tx.$queryRaw`SELECT id FROM "User" WHERE id=${actor.userId} FOR UPDATE`;
    const at = await dbNow(tx);
    const activity = await tx.activity.findUniqueOrThrow({ where: { id: input.activityId } });
    const supply = await tx.v11SupplyRevision.findUniqueOrThrow({ where: { id: input.supplyId }, include: { policy: true } });
    await tx.$queryRaw`SELECT id FROM "V11PolicySnapshot" WHERE id=${supply.policyId} FOR SHARE`;
    supply.policy = await tx.v11PolicySnapshot.findUniqueOrThrow({ where: { id: supply.policyId } });
    if(formal)await formal.validateSupply(tx,actor,supply,input.membership);else assertSimulationPolicy(supply.policy);
    if (supply.activityId !== activity.id || supply.policyId !== input.policyId || supply.status !== (formal?"FORMAL_APPROVED":"SIMULATION_APPROVED")) reject(409, "SUPPLY_NOT_APPROVED");
    const user = await tx.user.findUniqueOrThrow({ where: { id: actor.userId! } });
    const profile = await tx.v11Profile.findUnique({ where: { userId: user.id } });
    const closing = await tx.v11Request.count({ where: { userId: user.id, kind: "RIGHT_CLOSURE", state: { not: "RESOLVED" } } });
    const adultEligibility=formal?(await formal.validateProfile(tx,actor,profile)?'FORMAL_DECLARATION_VERIFIED':'UNRESOLVED'):(profile?.adultConfirmed?'SIMULATION_CONFIRMED':'UNRESOLVED');
    const eligible = evaluateRegistrationEligibility({ loggedIn: true, phoneAuthorized: !!user.phone, gender: profile?.gender ?? null, adultEligibility, blacklisted: user.status !== "NORMAL", accountClosurePending: closing > 0, requiresSpecialAccommodation: profile?.adaptationConfirmed ? false : null });
    if (eligible.status !== "READY" || !eligible.effect?.allowed) reject(409, eligible.code, eligible.blockerIds);
    await tx.$queryRaw`SELECT id FROM "V11BundleConsent" WHERE id=${input.consentId} FOR SHARE`;
    const consent = await tx.v11BundleConsent.findUnique({ where: { id: input.consentId } });
    if (!consent || consent.userId !== user.id || consent.policyId !== supply.policyId) reject(409, "CONSENT_REQUIRED");
    const consentDocuments = object(supply.policy.docsJson).documents;
    if(formal)await formal.validateConsent(tx,actor,consent,supply.policy);
    else if (consent.source !== 'SIMULATION_ONLY' || !intactDraftConsentDocuments(consentDocuments)
      || !matchesConsentDocuments(consentDocuments,consent.documentHashesJson,consent.publicHashesJson)) reject(409,'CONSENT_EVIDENCE_INVALID');
    const prior = await tx.v11Request.findUnique({ where: { businessKey: `registration:${input.businessKey}` } });
    if (prior) {
      if (prior.source!==(formal?'FORMAL_BUSINESS_ROUTE':'SIMULATION_ONLY')||prior.userId !== user.id || object(prior.payload).activityId !== input.activityId || object(prior.payload).supplyId !== input.supplyId || object(prior.payload).membership !== input.membership || object(prior.payload).policyId !== input.policyId || object(prior.payload).consentId !== input.consentId) reject(409, "IDEMPOTENCY_CONFLICT");
      return prior.registrationId ? tx.v11Registration.findUniqueOrThrow({ where: { id: prior.registrationId } }) : prior;
    }
    if (!["PUBLISHED", "REGISTRATION_OPEN"].includes(activity.status) || at >= activity.registrationEndsAt || at.getTime() >= activity.startsAt.getTime() - 8 * 3_600_000) reject(409, "REGISTRATION_CLOSED");
    const formalBlockers=formal?await formal.admissionBlockers(tx,supply,input.membership):[];
    if(formalBlockers.length)return record({businessKey:`registration:${input.businessKey}`,kind:'REGISTRATION',userId:user.id,payload:input,blockers:formalBlockers,acceptedAt:at});
    if(formal)await formal.expire(tx,activity.id,at);else await expireHolds(tx, activity.id, at);
    if (await tx.v11Registration.count({ where: { userId: user.id, activityId: activity.id, active: true } })) reject(409, "ACTIVE_REGISTRATION_EXISTS");
    if(formal&&(await formalRejoinSafety(tx,user.id,activity.id)).state==='BLOCKED_POLICY')return record({businessKey:`registration:${input.businessKey}`,kind:'REGISTRATION',userId:user.id,payload:input,blockers:['OP-08'],acceptedAt:at});
    const t24 = activity.startsAt.getTime() - 24 * 3_600_000;
    if (at.getTime() === t24) return record({ businessKey: `registration:${input.businessKey}`, kind: "REGISTRATION", userId: user.id, payload: input, blockers: ["OP-05"], acceptedAt: at });
    const formalCount = await tx.v11Membership.count({ where: { active: true, registration: { activityId: activity.id } } });
    const holdCount = await tx.v11SeatHold.count({ where: { state: "HELD", expiresAt: { gt: at }, registration: { activityId: activity.id, category: { not: "WAITLIST" } } } });
    let category = at.getTime() < t24 ? "ORDINARY" : "LATE_FORMED";
    const unresolvedRefunds = await tx.v11RefundInstruction.count({ where: { registration: { userId: user.id, activityId: activity.id }, state: { not: "CONFIRMED" } } });
    const unresolvedPayments = await tx.v11PaymentIntent.count({ where: { registration: { userId: user.id, activityId: activity.id }, state: { in: ["SUBMITTING", "UNKNOWN"] } } });
    const unresolvedFormalObligations=formal?await tx.v11Request.count({where:{userId:user.id,registration:{activityId:activity.id},kind:'FORMAL_MANDATORY_REFUND',state:{notIn:['REFUND_CONFIRMED','NO_ADDITIONAL_REFUND','NO_FUNDS_CHANNEL_CLOSED']}}}):0;
    if (unresolvedRefunds || unresolvedPayments || unresolvedFormalObligations) return record({ businessKey: `registration:${input.businessKey}`, kind: "REGISTRATION", userId: user.id, payload: input, blockers: ["OP-08"], acceptedAt: at });
    if (input.membership === "WAITLIST") {
      const count = await tx.v11Registration.count({ where: { activityId: activity.id, eligibilityState: "WAITLIST", active: true } });
      const inFlight = await tx.v11Registration.count({ where: { activityId: activity.id, category: "WAITLIST", eligibilityState: "PENDING_PAYMENT", active: true } });
      const priorUnsettled = await tx.v11RefundInstruction.count({ where: { registration: { userId: user.id, activityId: activity.id }, state: { not: "CONFIRMED" } } });
      const allowed = evaluateWaitlistAdmission({ validCount: count, limit: supply.waitlistMax, beforeT24: at.getTime() < t24, unresolvedPriorRegistration: priorUnsettled > 0, inFlightAdmissions: inFlight,...(formal?{concurrentExposureReserved:formal.allowConcurrentWaitlist?.(tx)===true}:{}) });
      if (allowed.status !== "READY" || !allowed.effect?.createPayment) return record({ businessKey: `registration:${input.businessKey}`, kind: "REGISTRATION", userId: user.id, payload: input, blockers: allowed.blockerIds.length ? allowed.blockerIds : ["OP-08"], acceptedAt: at });
      if (formalCount + holdCount < supply.capacity) reject(409, "FORMAL_CAPACITY_AVAILABLE");
      category = "WAITLIST";
    } else {
      if (await tx.v11Registration.count({ where: { activityId: activity.id, eligibilityState: "WAITLIST", active: true } })) reject(409, "WAITLIST_HAS_PRIORITY", ["OP-05"]);
      if (formalCount + holdCount >= supply.capacity) reject(409, "FORMAL_CAPACITY_FULL");
      if (at.getTime() > t24 && !(await tx.v11Table.count({ where: { activityId: activity.id, state: "FORMED", t24FormedAt: { not: null } } }))) return record({ businessKey: `registration:${input.businessKey}`, kind: "REGISTRATION", userId: user.id, payload: input, blockers: ["OP-05"], acceptedAt: at });
    }
    const reg = await tx.v11Registration.create({ data: { userId: user.id, activityId: activity.id, supplyId: supply.id, policyId: supply.policyId, consentId: consent.id, category,
      serviceFeeCents: supply.serviceFeeCents, depositCents: supply.depositCents, acceptedAt: at, snapshot: json({ inputKey: input.businessKey, supply: supply.snapshot, policyDigest: supply.policy.bundleDigest, gender: profile!.gender, priceScope: formal?"FORMAL_QUOTE":"TEST_ONLY" }) } });
    const hold = await tx.v11SeatHold.create({ data: { registrationId: reg.id, expiresAt: new Date(at.getTime() + 600_000) } });
    if(formal)await formal.created(tx,actor,reg);else await enqueue(tx, "V11_EXPIRE_HOLD", `v11:expire:${reg.id}`, reg.id, hold.expiresAt);
    await record({ businessKey: `registration:${input.businessKey}`, kind: "REGISTRATION", userId: user.id, registrationId: reg.id, payload: input, acceptedAt: at, state: "RESOLVED" });
    if(!formal)await audit(tx, "registration.create", "V11Registration", reg.id, actor);
    return reg;
  });
}
export async function startPayment(db: PrismaClient, actor: LocalPrincipal, registrationId: string) {
  return db.$transaction(async tx => {
    const reg = await registrationLock(tx, registrationId); requireOwner(actor, reg.userId); assertSimulationPolicy(reg.policy);
    await expireHolds(tx, reg.activityId, await dbNow(tx));
    const current = await tx.v11Registration.findUniqueOrThrow({ where: { id: reg.id } });
    const existing = await tx.v11PaymentIntent.findFirst({ where: { registrationId, active: true } });
    if (existing) return existing;
    if (current.eligibilityState !== "PENDING_PAYMENT" || !current.active) reject(409, "PAYMENT_REGISTRATION_CLOSED");
    if (reg.supply.status !== "SIMULATION_APPROVED") reject(409, "SUPPLY_NOT_APPROVED");
    const intent = await tx.v11PaymentIntent.create({ data: { registrationId, merchantOrderNo: `v11_${randomUUID()}`, totalCents: reg.serviceFeeCents + reg.depositCents } });
    await enqueue(tx, "V11_PAY", `v11:pay:${intent.id}`, intent.id);
    return intent;
  });
}
export async function reserveRefund(tx: Tx, reg: V11Registration, receiptId: string, desired: { F: number; D: number }, key: string, runAt?: Date) {
  return reserveRefundBudget(tx, reg, receiptId, desired, key, LOCAL_MOCK_BINDING, runAt);
}
// Internal real-channel seam; production callers must use the authorized reserver.
export async function reserveWechatRefundBudget(tx: Tx, reg: V11Registration, receiptId: string, desired: { F: number; D: number }, key: string, binding: ChannelBinding,runAt?:Date) {
  if (binding.channel !== 'wechat' || !/^[a-f0-9]{64}$/.test(binding.merchantScope) || !binding.providerConfigId) reject(409, 'ORIGINAL_CHANNEL_UNAVAILABLE');
  return reserveRefundBudget(tx, reg, receiptId, desired, key, binding,runAt);
}
async function reserveRefundBudget(tx: Tx, reg: V11Registration, receiptId: string, desired: { F: number; D: number }, key: string, binding: ChannelBinding, runAt?: Date) {
  if (![desired.F, desired.D].every(value => Number.isSafeInteger(value) && value >= 0 && value <= 2_147_483_647))
    reject(400, "INVALID_REFUND_COMPONENTS");
  // Read idempotency after the existing budget lock, so concurrent same-receipt
  // retries see the committed instruction rather than an earlier empty snapshot.
  await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${receiptId} FOR UPDATE`;
  const previous = await tx.v11RefundInstruction.findUnique({ where: { businessKey: key } });
  if (previous) {
    if (previous.registrationId !== reg.id || previous.receiptId !== receiptId) reject(409, "REFUND_IDEMPOTENCY_CONFLICT");
    if (previous.channel !== binding.channel || previous.merchantScope !== binding.merchantScope || previous.providerConfigId !== binding.providerConfigId)
      reject(409, 'ORIGINAL_CHANNEL_UNAVAILABLE');
    if (previous.requestedServiceFeeCents !== null && (previous.requestedServiceFeeCents !== desired.F || previous.requestedDepositCents !== desired.D))
      reject(409, "REFUND_IDEMPOTENCY_CONFLICT");
    // Historical null snapshots retain the existing instruction without guessing
    // or changing its amount; exact target equality cannot be established for them.
    return previous;
  }
  const receipt = await tx.channelReceipt.findUniqueOrThrow({ where: { id: receiptId } });
  if (receipt.channel !== binding.channel || receipt.merchantScope !== binding.merchantScope) reject(409, "ORIGINAL_CHANNEL_UNAVAILABLE");
  const components = await tx.v11FundComponent.findMany({ where: { receiptId }, orderBy: { id: "asc" } });
  if (components.length !== 2 || new Set(components.map(row => row.kind)).size !== 2
    || components.reduce((sum, row) => sum + row.originalCents, 0) !== receipt.amountCents)
    reject(409, 'UNALLOCATED_RECEIPT_REQUIRES_REVIEW');
  const amounts = { F: 0, D: 0 };
  for (const component of components) {
    await tx.$queryRaw`SELECT id FROM "V11FundComponent" WHERE id=${component.id} FOR UPDATE`;
    const rows = await tx.v11Disposition.findMany({ where: { componentId: component.id, state: { not: "RELEASED" } } });
    const refundedOrReserved = rows.filter(row => row.kind === "REFUND").reduce((sum, row) => sum + row.amountCents, 0);
    const otherReserved = rows.filter(row => row.kind !== "REFUND").reduce((sum, row) => sum + row.amountCents, 0);
    const kind = component.kind as "F" | "D";
    const increment = Math.max(0, desired[kind] - refundedOrReserved);
    if (increment + refundedOrReserved + otherReserved > component.originalCents) reject(409, "COMPONENT_BUDGET_RESERVED");
    amounts[kind] = increment;
  }
  if (components.length !== 2) reject(409, "UNALLOCATED_RECEIPT_REQUIRES_REVIEW");
  if (!amounts.F && !amounts.D) return null;
  const instruction = await tx.v11RefundInstruction.create({ data: { registrationId: reg.id, receiptId, businessKey: key, merchantRefundNo: `v11_refund_${randomUUID()}`, serviceFeeCents: amounts.F, depositCents: amounts.D,
    totalCents: amounts.F + amounts.D, requestedServiceFeeCents: desired.F, requestedDepositCents: desired.D,
    channel: binding.channel, merchantScope: binding.merchantScope, providerConfigId: binding.providerConfigId,
    originalTradeNo: receipt.channelTradeNo, state: runAt ? "WAITING_BATCH" : "NEW" } });
  for (const component of components) {
    const amount = amounts[component.kind as "F" | "D"];
    if (amount) await tx.v11Disposition.create({ data: { componentId: component.id, businessKey: `${key}:${component.kind}`, kind: "REFUND", amountCents: amount, state: "RESERVED", sourceRef: instruction.id } });
  }
  await enqueue(tx, binding.channel === 'wechat' ? 'V11_WECHAT_REFUND' : 'V11_REFUND', `v11:refund:${instruction.id}`, instruction.id, runAt);
  return instruction;
}
export async function terminateAndRefund(tx: Tx, reg: V11Registration, key: string, reason: CancellationReason, at: Date, desired?: { F: number; D: number }) {
  await enqueueMerchantClose(tx, reg.id);
  await tx.v11Registration.update({ where: { id: reg.id }, data: { active: false, eligibilityState: "ENDED", cancelAcceptedAt: reg.cancelAcceptedAt ?? at, version: { increment: 1 } } });
  await tx.v11SeatHold.updateMany({ where: { registrationId: reg.id, state: "HELD" }, data: { state: "RELEASED", releasedAt: at, version: { increment: 1 } } });
  const membership = await tx.v11Membership.findUnique({ where: { registrationId: reg.id } });
  if (membership?.active) await tx.v11Membership.update({ where: { id: membership.id }, data: { active: false, leftAt: at } });
  const bindings = await tx.v11ReceiptBinding.findMany({ where: { registrationId: reg.id } });
  for (const binding of bindings) await reserveRefund(tx, reg, binding.receiptId, desired ?? { F: reg.serviceFeeCents, D: reg.depositCents }, `${key}:${binding.receiptId}`);
  await notify(tx, reg.id, reason, `v11:end:${key}`);
  // Individual lawful termination changes the remaining table immediately. Aggregate
  // cancellation/formation failure already owns its complete terminal operation.
  if (membership?.active && !["FORMATION_FAILED", "PLATFORM_CANCEL", "RESTAURANT_CANCEL"].includes(reason)) {
    await refreshTable(tx, membership.tableId, at);
    await promoteWaitlist(tx, reg.activityId, at);
  }
}
export async function acceptCancellation(db: PrismaClient, actor: LocalPrincipal, registrationId: string, key: string) {
  return db.$transaction(async tx => {
    const reg = await registrationLock(tx, registrationId); requireOwner(actor, reg.userId);
    const previous = await tx.v11Request.findUnique({ where: { businessKey: `cancel:${key}` } });
    if (previous) { if (previous.registrationId !== reg.id || previous.userId !== reg.userId) reject(409, "IDEMPOTENCY_CONFLICT"); return previous; }
    const first = await tx.v11Request.findFirst({ where: { registrationId: reg.id, kind: "CANCELLATION" }, orderBy: [{ acceptedAt: "asc" }, { id: "asc" }] });
    if (first) return first;
    const at = await dbNow(tx);
    const member = await tx.v11Membership.findUnique({ where: { registrationId: reg.id }, include: { table: true } });
    const result = evaluateCancellation({ startAt: reg.activity.startsAt.getTime(), acceptedAt: at.getTime(), membership: reg.eligibilityState === "WAITLIST" ? "WAITLIST" : "FORMAL", category: reg.category === "ORDINARY" ? "ORDINARY" : reg.category === "LATE_FORMED" ? "LATE_FORMED" : "UNRESOLVED", tableState: member ? tableState(member.table.state) : "WAITING", funding: { F: reg.serviceFeeCents, D: reg.depositCents }, reason: "VOLUNTARY" });
    const pending = reg.eligibilityState === "PENDING_PAYMENT" || reg.eligibilityState === "WAITLIST";
    const blockers = pending ? [] : [...new Set([...result.blockerIds, "OP-04"])];
    const request = await requestRecord(tx, { businessKey: `cancel:${key}`, kind: "CANCELLATION", userId: reg.userId, registrationId: reg.id,
      payload: { decision: result, category: reg.category, tableState: member?.table.state ?? "WAITING", price: { F: reg.serviceFeeCents, D: reg.depositCents } }, blockers, acceptedAt: at });
    await tx.v11Registration.update({ where: { id: reg.id }, data: { cancelAcceptedAt: reg.cancelAcceptedAt ?? at, version: { increment: 1 } } });
    if (pending && reg.active) {
      await terminateAndRefund(tx, reg, `cancel:${request.id}`, "VOLUNTARY", at);
      await promoteWaitlist(tx,reg.activityId,at);
      await tx.v11Request.update({ where: { id: request.id }, data: { state: "PROCESSING" } });
    }
    await audit(tx, "cancel.accepted", "V11Request", request.id, actor);
    return tx.v11Request.findUniqueOrThrow({ where: { id: request.id } });
  });
}
export async function persistMockEvent(db: PrismaClient, input: { kind: "PAYMENT" | "REFUND"; sourceId: string; channelNo: string; amountCents: number; originalTradeNo?: string }) {
  const payloadHash = sha256(JSON.stringify(input));
  return db.$transaction(async tx => {
    const eventKey = `${input.kind}:${input.channelNo}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`v11:${eventKey}`},0))::text`;
    const prior = await tx.receivedEvent.findUnique({ where: { source_merchantScope_eventKey: { source: "prelaunch-mock-v11", merchantScope: "mock-local", eventKey } } });
    if (prior) {
      if (prior.payloadHash !== payloadHash) {
        const conflict = await tx.receivedEvent.upsert({ where: { source_merchantScope_eventKey: { source:"prelaunch-mock-v11",merchantScope:"mock-local",eventKey:`${eventKey}:conflict:${payloadHash}` } }, update:{}, create:{source:"prelaunch-mock-v11",merchantScope:"mock-local",eventKey:`${eventKey}:conflict:${payloadHash}`,payloadHash,normalizedPayload:json(input),verificationMaterialId:"mock-v1",verifiedAt:await dbNow(tx),state:"MANUAL"} });
        await openCase(tx,"V11_EVENT_CONFLICT",conflict.id,"local-simulation-ops");
      }
      return prior;
    }
    const event = await tx.receivedEvent.create({ data: { source: "prelaunch-mock-v11", merchantScope: "mock-local", eventKey, payloadHash, normalizedPayload: json(input), verificationMaterialId: "mock-v1", verifiedAt: await dbNow(tx) } });
    await applyMockEventTx(tx, event.id);
    await enqueue(tx, "V11_APPLY_EVENT", `v11:event:${event.id}`, event.id);
    return tx.receivedEvent.findUniqueOrThrow({ where: { id: event.id } });
  });
}
export async function applyMockEvent(db: PrismaClient, eventId: string, lease?: Lease) {
  return db.$transaction(tx => applyMockEventTx(tx, eventId, lease));
}
async function applyMockEventTx(tx: Tx, eventId: string, lease?: Lease) {
    const event = await tx.receivedEvent.findUniqueOrThrow({ where: { id: eventId } });
    if (event.source !== "prelaunch-mock-v11" || event.verificationMaterialId !== "mock-v1") reject(409, "INVALID_LOCAL_EVENT_SOURCE");
    if (event.state === "APPLIED") return;
    const data = object(event.normalizedPayload);
    if (data.kind === "PAYMENT") {
      const intent = await tx.v11PaymentIntent.findUnique({ where: { id: String(data.sourceId) } });
      if (!intent) { await openCase(tx, "V11_ORPHAN_PAYMENT_EVENT", event.id, "local-simulation-ops"); await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "MANUAL" } }); return; }
      if (intent.channel !== LOCAL_MOCK_BINDING.channel || intent.merchantScope !== LOCAL_MOCK_BINDING.merchantScope || intent.providerConfigId !== LOCAL_MOCK_BINDING.providerConfigId) { await openCase(tx, "V11_PAYMENT_BINDING_CONFLICT", intent.id, "local-simulation-ops"); await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "MANUAL" } }); return; }
      const reg = await registrationLock(tx, intent.registrationId);
      if (lease) await assertLease(tx, lease);
      if (event.state === "APPLIED") return;
      const at = event.verifiedAt; const channelTradeNo = String(data.channelNo); const amount = Number(data.amountCents);
      const identity = { channel: "mock", merchantScope: "mock-local", channelTradeNo };
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`mock:mock-local:${channelTradeNo}`},0))::text`;
      let receipt = await tx.channelReceipt.findUnique({ where: { channel_merchantScope_channelTradeNo: identity } });
      if (receipt && (receipt.merchantOrderNo !== intent.merchantOrderNo || receipt.amountCents !== amount)) { await openCase(tx, "V11_RECEIPT_CONFLICT", receipt.id, "local-simulation-ops"); await tx.receivedEvent.update({ where:{id:event.id},data:{state:"MANUAL"} }); return; }
      receipt ??= await tx.channelReceipt.create({ data: { ...identity, merchantOrderNo: intent.merchantOrderNo, amountCents: amount, currency: "CNY", evidenceHash: event.payloadHash, verifiedAt: at } });
      const binding = await tx.v11ReceiptBinding.findUnique({ where: { receiptId: receipt.id } });
      if (binding) { await tx.receivedEvent.update({ where: { id: event.id }, data: { state: binding.classification === "AMOUNT_CONFLICT" ? "MANUAL" : "APPLIED" } }); return; }
      const prior = await tx.v11ReceiptBinding.count({ where: { registrationId: reg.id } });
      await tx.v11ReceiptBinding.create({ data: { receiptId: receipt.id, registrationId: reg.id, intentId: intent.id, classification: amount !== intent.totalCents ? "AMOUNT_CONFLICT" : prior ? "EXTRA" : "PRIMARY" } });
      await tx.v11PaymentIntent.update({ where: { id: intent.id }, data: { state: "CONFIRMED", version: { increment: 1 } } });
      if (amount !== intent.totalCents) {
        await openCase(tx, "V11_UNALLOCATED_RECEIPT", receipt.id, "local-simulation-ops");
        await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "MANUAL" } }); return;
      }
      await tx.v11FundComponent.createMany({ data: [{ receiptId: receipt.id, kind: "F", originalCents: reg.serviceFeeCents }, { receiptId: receipt.id, kind: "D", originalCents: reg.depositCents }] });
      await expireHolds(tx, reg.activityId, at);
      const hold = await tx.v11SeatHold.findUnique({ where: { registrationId: reg.id } });
      const current = await tx.v11Registration.findUniqueOrThrow({ where: { id: reg.id } });
      const decision = evaluatePaymentQualification({ reservedAt: reg.acceptedAt.getTime(), confirmedAt: at.getTime(), startAt: reg.activity.startsAt.getTime(), status: "SUCCEEDED", expected: { F: reg.serviceFeeCents, D: reg.depositCents }, received: { F: reg.serviceFeeCents, D: reg.depositCents } });
      if (prior || !current.active || hold?.state !== "HELD" || decision.effect?.refundRequired.F || decision.effect?.refundRequired.D) {
        await reserveRefund(tx, reg, receipt.id, { F: reg.serviceFeeCents, D: reg.depositCents }, `late-extra:${receipt.id}`);
      } else if (decision.status === "BLOCKED_POLICY") {
        await requestRecord(tx, { businessKey: `receipt-blocked:${receipt.id}`, kind: "PAYMENT_QUALIFICATION", userId: reg.userId, registrationId: reg.id, payload: { receiptId: receipt.id }, blockers: decision.blockerIds });
      } else if (reg.category === "WAITLIST" && at.getTime() >= reg.activity.startsAt.getTime() - 24 * 3_600_000) {
        await terminateAndRefund(tx, reg, `waitlist-late:${receipt.id}`, "WAITLIST_EXPIRED", at);
      } else if (reg.category === "WAITLIST") {
        // Synthetic transaction order is explicit engineering evidence; official FIFO remains OP-05.
        const maximum = await tx.v11Registration.aggregate({ where: { activityId: reg.activityId }, _max: { queueOrdinal: true } });
        await tx.v11Registration.update({ where: { id: reg.id }, data: { eligibilityState: "WAITLIST", queueOrdinal: (maximum._max.queueOrdinal ?? 0n) + 1n, paidEffectiveAt: at, version: { increment: 1 } } });
      } else if (reg.category === "ORDINARY" && at.getTime() >= reg.activity.startsAt.getTime() - 24 * 3_600_000) {
        await requestRecord(tx, { businessKey: `receipt-cross-cutoff:${receipt.id}`, kind: "PAYMENT_QUALIFICATION", userId: reg.userId, registrationId: reg.id, payload: { receiptId: receipt.id, acceptedAt: at }, blockers: ["OP-05"] });
      } else {
        try { await assignFormal(tx, reg, at); }
        catch (error) { if (!(error instanceof PrelaunchError) || error.code !== "NO_LEGAL_FORMAL_CAPACITY") throw error; await requestRecord(tx, { businessKey: `receipt-no-capacity:${receipt.id}`, kind: "PAYMENT_QUALIFICATION", userId: reg.userId, registrationId: reg.id, payload: { receiptId: receipt.id }, blockers: ["OP-05"] }); }
      }
      await tx.v11SeatHold.updateMany({ where: { registrationId: reg.id, state: "HELD" }, data: { state: "CONSUMED", releasedAt: at, version: { increment: 1 } } });
      await promoteWaitlist(tx,reg.activityId,at);
      await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "APPLIED" } });
      await audit(tx, "receipt.recorded", "ChannelReceipt", receipt.id);
    } else if (data.kind === "REFUND") {
      const instruction = await tx.v11RefundInstruction.findUnique({ where: { id: String(data.sourceId) } });
      if (!instruction) { await openCase(tx, "V11_ORPHAN_REFUND_EVENT", event.id, "local-simulation-ops"); await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "MANUAL" } }); return; }
      if (instruction.registrationId) await registrationLock(tx, instruction.registrationId);
      await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${instruction.receiptId} FOR UPDATE`;
      if (lease) await assertLease(tx, lease);
      const original = await tx.channelReceipt.findUnique({ where: { id: instruction.receiptId } });
      if (instruction.channel !== LOCAL_MOCK_BINDING.channel || instruction.merchantScope !== LOCAL_MOCK_BINDING.merchantScope || instruction.providerConfigId !== LOCAL_MOCK_BINDING.providerConfigId || !original || original.channel !== instruction.channel || original.merchantScope !== instruction.merchantScope || original.channelTradeNo !== instruction.originalTradeNo) { await openCase(tx, "V11_REFUND_BINDING_CONFLICT", instruction.id, "local-simulation-ops"); await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "MANUAL" } }); return; }
      if (Number(data.amountCents) !== instruction.totalCents || data.originalTradeNo !== instruction.originalTradeNo || (instruction.channelRefundNo && instruction.channelRefundNo !== data.channelNo)) { await openCase(tx, "V11_REFUND_CONFLICT", instruction.id, "local-simulation-ops"); await tx.receivedEvent.update({ where:{id:event.id},data:{state:"MANUAL"} }); return; }
      await tx.v11RefundInstruction.update({ where: { id: instruction.id }, data: { state: "CONFIRMED", channelRefundNo: String(data.channelNo), version: { increment: 1 } } });
      await tx.v11Disposition.updateMany({ where: { sourceRef: instruction.id, kind: "REFUND", state: "RESERVED" }, data: { state: "COMPLETED" } });
      await tx.receivedEvent.update({ where: { id: event.id }, data: { state: "APPLIED" } });
      if (instruction.registrationId) await notify(tx, instruction.registrationId, "REFUND_CONFIRMED", `v11:refund-done:${instruction.id}`);
      await audit(tx, "refund.confirmed", "V11RefundInstruction", instruction.id);
    } else reject(409, "EVENT_PAYLOAD_UNSUPPORTED");
}
export function recoveryHandlers(db: PrismaClient, channel: PersistentMockChannel, onChannelSuccess?: (kind: "PAYMENT" | "REFUND", intentId: string) => Promise<void>) {
  return {
    V11_PAY: async (lease: Lease) => {
      const prepared = await db.$transaction(async tx => {
        const initial = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: lease.refId } });
        const reg = await registrationLock(tx, initial.registrationId); await assertLease(tx, lease);
        const current = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: initial.id } });
        assertSimulationPolicy(reg.policy); channel.assertBinding(current);
        const now = await dbNow(tx); await expireHolds(tx, reg.activityId, now);
        const refreshed = await tx.v11Registration.findUniqueOrThrow({ where: { id: reg.id } });
        const closed = !refreshed.active || refreshed.eligibilityState !== "PENDING_PAYMENT";
        if (current.state === "CONFIRMED") return { intent: current, closed: true, confirmed: true };
        const intent = await tx.v11PaymentIntent.update({ where: { id: current.id }, data: { state: "SUBMITTING", version: { increment: 1 } } });
        return { intent, closed, confirmed: false };
      });
      if (prepared.confirmed) return;
      const { intent } = prepared;
      // Closing the merchant number is atomic against pay in the persistent channel.
      // Recheck after query so a cancellation committed before dispatch cannot start new collection.
      try {
      let fact = await channel.query("PAYMENT", intent.merchantOrderNo);
      if (!fact) {
        const closed = await db.$transaction(async tx => { const reg = await registrationLock(tx, intent.registrationId); await assertLease(tx, lease); await expireHolds(tx, reg.activityId, await dbNow(tx)); const latest = await tx.v11Registration.findUniqueOrThrow({ where: { id: reg.id } }); return prepared.closed || !latest.active || latest.eligibilityState !== "PENDING_PAYMENT"; });
        fact = closed ? await channel.closePayment(intent.merchantOrderNo, intent.totalCents) : await channel.pay(intent.merchantOrderNo, intent.totalCents);
      }
      if (fact.status === "CLOSED") { await db.$transaction(async tx => { await registrationLock(tx, intent.registrationId); await assertLease(tx, lease); await tx.v11PaymentIntent.updateMany({ where: { id: intent.id, state: { not: "CONFIRMED" } }, data: { state: "CLOSED", active: false, version: { increment: 1 } } }); }); return; }
      if (fact.status !== "SUCCEEDED") reject(409, "MOCK_PAYMENT_UNCONFIRMED");
      await onChannelSuccess?.("PAYMENT", intent.id);
      await persistMockEvent(db, { kind: "PAYMENT", sourceId: intent.id, channelNo: fact.channelNo, amountCents: fact.amountCents });
      } catch (error) { await db.$transaction(async tx => { await registrationLock(tx,intent.registrationId); await assertLease(tx,lease); await tx.v11PaymentIntent.updateMany({ where: { id:intent.id, version:intent.version, state:"SUBMITTING" }, data: {state:"UNKNOWN",version:{increment:1}} }); }); throw error; }
    },
    V11_CLOSE_PAYMENT: async (lease: Lease) => {
      const intent = await db.$transaction(async tx => { const row = await tx.v11PaymentIntent.findUniqueOrThrow({ where: { id: lease.refId } }); await registrationLock(tx, row.registrationId); await assertLease(tx, lease); channel.assertBinding(row); return row; });
      const fact = await channel.query("PAYMENT", intent.merchantOrderNo) ?? await channel.closePayment(intent.merchantOrderNo, intent.totalCents);
      if (fact.status === "SUCCEEDED") await persistMockEvent(db, { kind: "PAYMENT", sourceId: intent.id, channelNo: fact.channelNo, amountCents: fact.amountCents });
      else if (fact.status === "CLOSED") await db.$transaction(async tx => { await registrationLock(tx, intent.registrationId); await assertLease(tx, lease); await tx.v11PaymentIntent.updateMany({ where: { id: intent.id, state: { not: "CONFIRMED" } }, data: { state: "CLOSED", active: false, version: { increment: 1 } } }); });
      else reject(409,"MOCK_CLOSE_UNCONFIRMED");
    },
    V11_REFUND: async (lease: Lease) => {
      const initial = await db.v11RefundInstruction.findUniqueOrThrow({ where: { id: lease.refId } });
      if (initial.state === "CONFIRMED") return;
      const instruction = await db.$transaction(async tx => { if (initial.registrationId) await registrationLock(tx, initial.registrationId); await tx.$queryRaw`SELECT id FROM "ChannelReceipt" WHERE id=${initial.receiptId} FOR UPDATE`; await assertLease(tx, lease);
        const current = await tx.v11RefundInstruction.findUniqueOrThrow({ where: { id: initial.id } });
        channel.assertBinding(current); if (current.state === "CONFIRMED") return current;
        return tx.v11RefundInstruction.update({ where: { id: current.id }, data: { state: "SUBMITTING", version: { increment: 1 } } }); });
      if (instruction.state === "CONFIRMED") return;
      try {
        const fact = await channel.query("REFUND", instruction.merchantRefundNo) ?? await channel.refund(instruction.merchantRefundNo, instruction.originalTradeNo, instruction.totalCents);
        if (fact.status !== "SUCCEEDED") reject(409, "MOCK_REFUND_UNCONFIRMED");
        await onChannelSuccess?.("REFUND",instruction.id);
        await persistMockEvent(db, { kind: "REFUND", sourceId: instruction.id, channelNo: fact.channelNo, amountCents: fact.amountCents, originalTradeNo: instruction.originalTradeNo });
      } catch (error) {
        await db.$transaction(async tx => { if (instruction.registrationId) await registrationLock(tx, instruction.registrationId); await assertLease(tx, lease);
          await tx.v11RefundInstruction.updateMany({ where: { id: instruction.id, version: instruction.version, state: "SUBMITTING" }, data: { state: "UNKNOWN", version: { increment: 1 } } }); });
        throw error;
      }
    },
    V11_APPLY_EVENT: async (lease: Lease) => { await applyMockEvent(db, lease.refId, lease); },
    V11_EXPIRE_HOLD: async (lease: Lease) => { await db.$transaction(async tx => { const reg = await registrationLock(tx, lease.refId); await assertLease(tx, lease); await expireHolds(tx, reg.activityId, await dbNow(tx)); }); },
    V11_NOTIFY: async (lease: Lease) => { await db.$transaction(async tx => { await assertLease(tx, lease); await tx.v11DeliveryProof.updateMany({ where: { id: lease.refId, state: "CREATED" }, data: { state: "SENT" } }); }); },
    V11_T24: async (lease: Lease) => { await db.$transaction(async tx => { await activityLock(tx, lease.refId); await assertLease(tx, lease); const activity = await tx.activity.findUniqueOrThrow({ where: { id: lease.refId } }); const cutoff = new Date(activity.startsAt.getTime() - 24 * 3_600_000);
      const tables = await tx.v11Table.findMany({ where: { activityId: activity.id }, orderBy: { ordinal: "asc" } });
      for (const table of tables) {
        const historicalMembers = await tx.v11Membership.findMany({ where: { tableId: table.id, joinedAt: { lte: cutoff }, OR: [{ leftAt: null }, { leftAt: { gt: cutoff } }] }, orderBy: { id: "asc" } });
        const supply = await tx.v11SupplyRevision.findUniqueOrThrow({ where: { id: table.supplyId } });
        const count = historicalMembers.length;
        const recorded = await tx.v11TableEvent.findUnique({ where: { businessKey: `t24:${table.id}` } });
        if (recorded) continue;
        const formed = count >= supply.minSize;
        await tx.v11TableEvent.create({ data: { tableId: table.id, businessKey: `t24:${table.id}`, kind: formed ? "T24_FORMED_SNAPSHOT" : "T24_FAILED_SNAPSHOT", acceptedAt: cutoff, version: table.version, snapshot: json({ count, memberIds: historicalMembers.map(m => m.id), supplyId: table.supplyId, formed }) } });
        if (formed) await tx.v11Table.update({ where: { id: table.id }, data: { t24FormedAt: cutoff } });
        else {
          await tx.v11Table.update({ where: { id: table.id }, data: { state: "FAILED", failedAt: cutoff, version: { increment: 1 } } });
          const current = await tx.v11Membership.findMany({ where: { tableId: table.id, active: true } });
          for (const member of current) { const reg = await tx.v11Registration.findUniqueOrThrow({ where: { id: member.registrationId } }); await terminateAndRefund(tx, reg, `formation:${table.id}:${reg.id}`, "FORMATION_FAILED", cutoff); }
        }
      }
      const waiting = await tx.v11Registration.findMany({ where: { activityId: activity.id, eligibilityState: "WAITLIST", active: true }, orderBy: { id: "asc" } });
      for (const reg of waiting) await terminateAndRefund(tx, reg, `waitlist-expire:${reg.id}`, "WAITLIST_EXPIRED", cutoff); }); },
    V11_T8: async (lease: Lease) => { await db.$transaction(async tx => { await activityLock(tx, lease.refId); await assertLease(tx, lease); const activity = await tx.activity.findUniqueOrThrow({ where: { id: lease.refId } }); const cutoff = new Date(activity.startsAt.getTime() - 8 * 3_600_000); const tables = await tx.v11Table.findMany({ where: { activityId: activity.id } }); for (const table of tables) await refreshTable(tx, table.id, cutoff); }); },
  };
}
export async function registrationDetail(db: PrismaClient, actor: LocalPrincipal, id: string) {
  const reg = await db.v11Registration.findUnique({ where: { id }, include: { activity: { include: { restaurant: true } } } }); if (!reg) reject(404, "RESOURCE_NOT_FOUND"); requireOwner(actor, reg.userId);
  const [hold, member, receipts, refunds, requests, notices, intent, attendance] = await Promise.all([
    db.v11SeatHold.findUnique({ where: { registrationId: id } }), db.v11Membership.findUnique({ where: { registrationId: id }, include: { table: true } }),
    db.v11ReceiptBinding.findMany({ where: { registrationId: id }, include: { receipt: true } }), db.v11RefundInstruction.findMany({ where: { registrationId: id } }),
    db.v11Request.findMany({ where: { registrationId: id }, orderBy: { acceptedAt: "desc" }, take: 50 }), db.v11DeliveryProof.findMany({ where: { registrationId: id }, take: 50 }), db.v11PaymentIntent.findFirst({ where: { registrationId: id, active: true } }), db.v11Attendance.findUnique({ where: { registrationId: id } }) ]);
  // Activity-level intake is a separate read-only projection, never a user's refund parent.
  const responsibilityReviews=await db.v11Request.findMany({where:{kind:'FORMAL_RESPONSIBILITY_CANCELLATION',source:'FORMAL_OPS_INTAKE',state:'AWAITING_FULFILLMENT_RIGHTS_REVIEW',AND:[{payload:{path:['activityId'],equals:reg.activityId}},{payload:{path:['registrationIds'],array_contains:[reg.id]}}]},orderBy:{acceptedAt:'desc'},take:50});
  const visibility = getOwnTableVisibility({ membership: reg.eligibilityState === "FORMAL" ? "FORMAL" : reg.eligibilityState === "WAITLIST" ? "WAITLIST" : "NONE", memberValid: member?.active ?? false, ownTable: !!member, state: member ? tableState(member.table.state) : "WAITING", everFormed: member?.table.everFormed ?? false, terminalAccess: reg.active ? "ACTIVE" : "UNRESOLVED" });
  const beforeFormalAddressUnlock=object(reg.snapshot).priceScope==='FORMAL_QUOTE'&&(await db.$transaction(dbNow)).getTime()<reg.activity.startsAt.getTime()-24*3600000;
  const address=visibility.effect?.showAddress&&!beforeFormalAddressUnlock?reg.activity.restaurant.address:null;
  const rejoinSafety=object(reg.snapshot).priceScope==='FORMAL_QUOTE'?await db.$transaction(async tx=>{await registrationLock(tx,reg.id);return formalRejoinSafety(tx,reg.userId,reg.activityId);}):undefined;
  return { id: reg.id, activityId: reg.activityId, title: reg.activity.title, startsAt: reg.activity.startsAt, state: reg.eligibilityState, category: reg.category, tableState: member?.table.state ?? null, F: reg.serviceFeeCents, D: reg.depositCents, total: reg.serviceFeeCents + reg.depositCents, holdExpiresAt: hold?.expiresAt ?? null,
    policyId: reg.policyId, supplyId: reg.supplyId, acceptedAt: reg.acceptedAt, cancelAcceptedAt: reg.cancelAcceptedAt, queueOrdinal: reg.queueOrdinal?.toString() ?? null,
    table: { state: member?.table.state ?? "WAITING", restaurantName: visibility.effect?.showName ? reg.activity.restaurant.name : null, address },
    restaurantName: visibility.effect?.showName ? reg.activity.restaurant.name : null, address,
    ...(rejoinSafety?{rejoinSafety}:{}),
    responsibilityReviews:responsibilityReviews.map(r=>({id:r.id,state:r.state,originalRequestAcceptedAt:object(r.payload).originalRequestAcceptedAt??r.acceptedAt.toISOString(),reviewOwner:object(r.payload).reviewOwner??null,membershipEnded:false,cancellationAccepted:false})),
    fulfillment: attendance ? {restaurantResult:attendance.restaurantResult,confirmedAt:attendance.confirmedAt} : null,
    payment: intent ? { id: intent.id, state: intent.state } : null, receipts: receipts.map(row => ({ id: row.receipt.id, amountCents: row.receipt.amountCents, classification: row.classification })),
    refunds: refunds.map(row => ({ id: row.id, F: row.serviceFeeCents, D: row.depositCents, total: row.totalCents, state: row.state })), requests: requests.map(publicRequest), notices: notices.map(row => ({ id: row.id, kind: row.kind, state: row.state, receivedAt: row.receivedAt })) };
}
export function publicRequest(row: { id: string; kind: string; acceptedAt: Date; state: string; blockerIds: unknown; registrationId: string | null;payload?:unknown }) {
 const p=object(row.payload),category=p.requestCategory;
 return {id:row.id,kind:row.kind,
  ...(typeof category==='string'&&['ORDINARY_CANCEL','CONSULTATION','EVIDENCE','DISPUTE','APPEAL','SPECIAL_REFUND'].includes(category)?{requestCategory:category}:{}),
  ...(typeof p.linkageState==='string'?{parentRequestId:typeof p.parentRequestId==='string'?p.parentRequestId:null,originalRequestId:typeof p.originalRequestId==='string'?p.originalRequestId:null,originalAcceptedAt:typeof p.originalAcceptedAt==='string'?p.originalAcceptedAt:null,linkageState:p.linkageState}:{}),
  state:row.state,acceptedAt:row.acceptedAt,blockerIds:row.blockerIds,registrationId:row.registrationId};
}
