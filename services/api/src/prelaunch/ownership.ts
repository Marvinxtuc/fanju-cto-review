import type { PrismaClient } from "../generated/prisma/client.js";
import { assertSimulationEnvironment, reject } from "./contracts.js";

export const TASK_ID = "FJ-PRELAUNCH-MASTER-V1.1-20261001-01";
export async function verifyOwnedDatabase(db: PrismaClient, env: Record<string, string | undefined>) {
  assertSimulationEnvironment(env);
  const names = await db.$queryRaw<{ name: string }[]>`SELECT current_database() AS name`;
  if (names.length !== 1 || names[0]?.name !== env.PRELAUNCH_DATABASE_NAME) reject(503, "DATABASE_IDENTITY_MISMATCH");
  const rows = await db.$queryRaw<{ task_id: string; owner_id: string; purpose: string }[]>`SELECT task_id, owner_id, purpose FROM prelaunch_control.owner`;
  if (rows.length !== 1 || rows[0]?.task_id !== TASK_ID || rows[0]?.owner_id !== env.PRELAUNCH_OWNER_MARKER || rows[0]?.purpose !== "synthetic-local-prelaunch") reject(503, "DATABASE_OWNER_MISMATCH");
}
