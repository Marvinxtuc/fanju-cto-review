import type { PrismaClient } from "../generated/prisma/client.js";
export type RecoveryTarget = { reference: string; host: string; port: number; database: string; user: string; systemIdentifier?: string | undefined };
export function assertOriginalRecoveryTargetAddress(databaseUrl: string, target: RecoveryTarget) {
  const url = new URL(databaseUrl);
  // pg-connection-string gives query fields precedence over URL authority.
  // Preserve TLS options but reject every other parameter before constructing a client.
  const allowed = new Set(["sslmode", "sslcert", "sslkey", "sslrootcert", "ssl", "uselibpqcompat"]);
  const seen = new Set<string>();
  for (const [name] of url.searchParams) {
    if (!allowed.has(name) || seen.has(name)) throw Error("Database address outside signed recovery target");
    seen.add(name);
  }
  if (url.hash || !["postgresql:", "postgres:"].includes(url.protocol) || url.hostname !== target.host
    || Number(url.port || "5432") !== target.port || decodeURIComponent(url.pathname.slice(1)) !== target.database
    || decodeURIComponent(url.username) !== target.user) throw Error("Database address outside signed recovery target");
}
export async function assertOriginalRecoveryTargetIdentity(db: PrismaClient, target: RecoveryTarget) {
  const rows = await db.$queryRaw<{ database: string; user: string }[]>`
    SELECT current_database() AS database, current_user AS "user"`;
  if (rows.length !== 1 || rows[0]!.database !== target.database || rows[0]!.user !== target.user)
    throw Error("Database identity outside signed recovery target");
  if (target.systemIdentifier) {
    const system = await db.$queryRaw<{ systemIdentifier: string }[]>`SELECT system_identifier::text AS "systemIdentifier" FROM pg_control_system()`;
    if (system.length !== 1 || system[0]!.systemIdentifier !== target.systemIdentifier) throw Error("Database instance identity outside signed recovery target");
  }
}
