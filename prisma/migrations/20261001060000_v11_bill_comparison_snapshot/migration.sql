CREATE TABLE "V11BillComparisonSnapshot" (
 "id" UUID PRIMARY KEY,
 "identityHash" TEXT NOT NULL CHECK ("identityHash" ~ '^[a-f0-9]{64}$'),
 "merchantScope" TEXT NOT NULL CHECK ("merchantScope" ~ '^[a-f0-9]{64}$'),
 "providerConfigId" TEXT NOT NULL CHECK (length(btrim("providerConfigId")) BETWEEN 1 AND 160),
 "billDate" TEXT NOT NULL CHECK ("billDate" ~ '^\d{4}-\d{2}-\d{2}$'),
 "sourceSha256" TEXT NOT NULL CHECK ("sourceSha256" ~ '^[a-f0-9]{64}$'),
 "owner" TEXT NOT NULL CHECK (length(btrim("owner")) BETWEEN 1 AND 160),
 "releaseVersion" TEXT NOT NULL CHECK (length(btrim("releaseVersion")) BETWEEN 1 AND 160),
 "totalRows" INTEGER NOT NULL CHECK ("totalRows" BETWEEN 0 AND 100000),
 "outsideRows" INTEGER NOT NULL CHECK ("outsideRows" BETWEEN 0 AND "totalRows"),
 "snapshot" JSONB NOT NULL CHECK (jsonb_typeof("snapshot")='object' AND octet_length("snapshot"::text)<=33554432),
 "snapshotHash" TEXT NOT NULL CHECK ("snapshotHash" ~ '^[a-f0-9]{64}$'),
 "capturedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE FUNCTION "v11_bill_snapshot_immutable"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Bill comparison snapshot is immutable'; END $$;
CREATE TRIGGER "v11_bill_snapshot_no_update" BEFORE UPDATE ON "V11BillComparisonSnapshot"
 FOR EACH ROW EXECUTE FUNCTION "v11_bill_snapshot_immutable"();
-- Rollback after stopping snapshot/batch consumers and preserving required evidence:
-- DROP TABLE "V11BillComparisonSnapshot"; DROP FUNCTION "v11_bill_snapshot_immutable"();
-- This does not remove receipts, intents, refunds, cases, jobs or old bill audits.
