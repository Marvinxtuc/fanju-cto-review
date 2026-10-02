import { describe, expect, it, vi } from "vitest";
import type { PrismaClient } from "../generated/prisma/client.js";
import { assertOriginalRecoveryTargetAddress, assertOriginalRecoveryTargetIdentity } from "./original-recovery-target.js";
const target = { reference: "synthetic-target", host: "127.0.0.1", port: 5433, database: "synthetic-db", user: "synthetic-user", systemIdentifier: "123" };
describe("signed recovery target identity", () => {
  it("rejects arbitrary address, database and account before connection", () => {
    expect(() => assertOriginalRecoveryTargetAddress("postgresql://synthetic-user@127.0.0.1:5433/synthetic-db", target)).not.toThrow();
    for (const url of ["postgresql://synthetic-user@127.0.0.1:5432/synthetic-db", "postgresql://synthetic-user@127.0.0.1:5433/other", "postgresql://other@127.0.0.1:5433/synthetic-db"])
      expect(() => assertOriginalRecoveryTargetAddress(url, target)).toThrow("signed recovery target");
  });
  it("rejects decoded query target overrides and repeats before any client IO while preserving TLS", () => {
    const connect = vi.fn(), base = "postgresql://synthetic-user@127.0.0.1:5433/synthetic-db";
    for (const query of ["host=other", "user=other", "port=5432", "database=other", "dbname=other", "hostaddr=other", "h%6fst=other", "%75ser=other", "host=127.0.0.1&host=other", "sslmode=require&sslmode=disable", "options=-c%20role%3Dother", "application_name=other"]) {
      expect(() => {assertOriginalRecoveryTargetAddress(base + "?" + query, target);connect();}).toThrow("signed recovery target");
    }
    expect(connect).not.toHaveBeenCalled();
    expect(() => assertOriginalRecoveryTargetAddress(base + "?sslmode=verify-full&sslrootcert=%2Fexternal%2Fca.pem", target)).not.toThrow();
  });
  it("rejects cloned IDs on a different PostgreSQL system before channel assembly runs", async () => {
    const query = vi.fn().mockResolvedValue([{ database: "synthetic-db", user: "synthetic-user", systemIdentifier: "456" }]);
    await expect(assertOriginalRecoveryTargetIdentity({ $queryRaw: query } as unknown as PrismaClient, target)).rejects.toThrow("identity");
    query.mockResolvedValue([{ database: "synthetic-db", user: "synthetic-user", systemIdentifier: "123" }]);
    await expect(assertOriginalRecoveryTargetIdentity({ $queryRaw: query } as unknown as PrismaClient, target)).resolves.toBeUndefined();
  });
  it("uses least-privilege identity checks when no instance control access is signed", async () => {
    const query = vi.fn().mockResolvedValue([{ database: "synthetic-db", user: "synthetic-user" }]);
    await expect(assertOriginalRecoveryTargetIdentity({ $queryRaw: query } as unknown as PrismaClient, { ...target, systemIdentifier: undefined })).resolves.toBeUndefined();
    expect(query).toHaveBeenCalledTimes(1);
  });
});
