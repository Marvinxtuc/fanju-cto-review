CREATE TABLE "V11BillComparisonPage" (
 "snapshotId" UUID NOT NULL REFERENCES "V11BillComparisonSnapshot"(id) ON DELETE RESTRICT,
 "phase" TEXT NOT NULL CHECK (phase IN ('FORWARD','REVERSE_RECEIPTS','REVERSE_REFUNDS')),
 "start" INTEGER NOT NULL CHECK ("start">=0 AND "start"%500=0),
 "end" INTEGER NOT NULL CHECK ("end">"start" AND "end"-"start"<=500 AND "end"<=100000),
 "snapshotHash" TEXT NOT NULL CHECK ("snapshotHash" ~ '^[a-f0-9]{64}$'),
 "result" JSONB NOT NULL CHECK (jsonb_typeof(result)='object'),
 "caseIds" TEXT[] NOT NULL,
 "contentHash" TEXT NOT NULL CHECK ("contentHash" ~ '^[a-f0-9]{64}$'),
 "committedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY ("snapshotId",phase,"start")
);
CREATE TRIGGER "v11_bill_page_no_update" BEFORE UPDATE ON "V11BillComparisonPage"
 FOR EACH ROW EXECUTE FUNCTION "v11_bill_snapshot_immutable"();
-- Rollback after stopping consumers and preserving checkpoint evidence:
-- DROP TABLE "V11BillComparisonPage";
-- Original financial facts/cases/jobs/snapshots are retained. Snapshot rollback
-- must drop this dependent page table first; never use DROP ... CASCADE.
