-- Historical consent and orders remain readable. New registration writes the policy hash and snapshot.
CREATE TABLE "AgreementPolicy" (
  "version" TEXT NOT NULL PRIMARY KEY,
  "text" TEXT NOT NULL,
  "textHash" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "activatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "AgreementPolicy_one_active" ON "AgreementPolicy" ("active") WHERE "active" = true;
ALTER TABLE "ConsentRecord" ADD COLUMN "policyHash" TEXT;
ALTER TABLE "Order" ADD COLUMN "consentRecordId" TEXT;
CREATE INDEX "Order_consentRecordId_idx" ON "Order" ("consentRecordId");
