import { createHash } from "node:crypto";
import type { AgreementPolicy, Prisma } from "../generated/prisma/client.js";

export function agreementHash(text: string) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

export async function currentAgreement(tx: Prisma.TransactionClient, lock = false) {
  const rows = lock
    ? await tx.$queryRaw<AgreementPolicy[]>`SELECT * FROM "AgreementPolicy" WHERE "active" = true AND "activatedAt" <= clock_timestamp() FOR UPDATE`
    : await tx.$queryRaw<AgreementPolicy[]>`SELECT * FROM "AgreementPolicy" WHERE "active" = true AND "activatedAt" <= clock_timestamp()`;
  const policy = rows[0];
  if (!policy || !policy.text.trim() || !policy.source.trim() || agreementHash(policy.text) !== policy.textHash) return null;
  return policy;
}
