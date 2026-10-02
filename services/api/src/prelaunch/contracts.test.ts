import { describe, expect, it } from "vitest";
import { assertSimulationEnvironment, errorResponse, parse, profileInput, requireOwner, requireRole, simulationNextDay, type LocalPrincipal } from "./contracts.js";

const environment = { APP_ENV: "ci", NODE_ENV: "test", PRELAUNCH_MODE: "SIMULATION_ONLY", AUTH_PROVIDER: "mock", PHONE_PROVIDER: "mock", PAYMENT_PROVIDER: "mock", REFUND_PROVIDER: "mock", PRELAUNCH_OWNER_MARKER: "synthetic_owned_20261001", PRELAUNCH_DATABASE_NAME: "fanju_prelaunch_unit", PRELAUNCH_SESSION_SECRET: "synthetic-local-test-only-secret-20261001" };
const owner: LocalPrincipal = { id: "user_actor", personId: "user_person", userId: "user_one", role: "USER", restaurantId: null, version: 1 };
describe("prelaunch isolated contracts", () => {
  it("allows explicitly isolated all-mock runtime", () => expect(() => assertSimulationEnvironment(environment)).not.toThrow());
  for (const key of ["AUTH_PROVIDER", "PHONE_PROVIDER", "PAYMENT_PROVIDER", "REFUND_PROVIDER"]) it(`rejects real ${key}`, () => expect(() => assertSimulationEnvironment({ ...environment, [key]: "wechat" })).toThrow());
  it("rejects production even with simulation marker", () => expect(() => assertSimulationEnvironment({ ...environment, NODE_ENV: "production" })).toThrow());
  it("requires an owned database", () => expect(() => assertSimulationEnvironment({ ...environment, PRELAUNCH_DATABASE_NAME: "timeleft_shanghai" })).toThrow());
  it("requires explicit owner marker", () => expect(() => assertSimulationEnvironment({ ...environment, PRELAUNCH_OWNER_MARKER: undefined })).toThrow());
  it("permits empty optional preferences without historical profile", () => expect(parse(profileInput, { gender: "MALE", adultDeclaration: true, serviceCompatible: true }).timePreferences).toEqual([]));
  it("rejects old profile and approval injection", () => expect(() => parse(profileInput, { gender: "MALE", adultDeclaration: true, serviceCompatible: true, approved: true, budgetRange: "legacy" })).toThrow());
  it("rejects incompatible service without collecting health reasons", () => expect(() => parse(profileInput, { gender: "MALE", adultDeclaration: true, serviceCompatible: false })).toThrow());
  it("rejects IDOR and role spoofing", () => { expect(() => requireOwner(owner, "user_other")).toThrow(); expect(() => requireRole(owner, "OPS")).toThrow(); });
  it("does not reflect private exception contents", () => expect(JSON.stringify(errorResponse(new Error("synthetic_private_value")))).not.toContain("synthetic_private_value"));
  it("computes next natural day across Shanghai midnight", () => expect(simulationNextDay(new Date("2026-10-01T15:59:59Z"), 10).toISOString()).toBe("2026-10-02T02:00:00.000Z"));
  it("computes a different day after Shanghai midnight", () => expect(simulationNextDay(new Date("2026-10-01T16:00:00Z"), 10).toISOString()).toBe("2026-10-03T02:00:00.000Z"));
});
