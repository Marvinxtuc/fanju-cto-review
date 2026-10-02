ALTER TABLE "V11BillComparisonPage"
 ADD COLUMN "paymentQueryRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
 ADD COLUMN "refundQueryRefs" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
-- Empty defaults do not grant recovery: page checksum and recorded query counts
-- must match the references, and every referenced durable query must exist.
-- Rollback after stopping page consumers/preserving evidence:
-- ALTER TABLE "V11BillComparisonPage" DROP COLUMN "paymentQueryRefs", DROP COLUMN "refundQueryRefs";
-- No money or durable query jobs are deleted.
