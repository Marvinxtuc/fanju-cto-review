-- Preserve historical coverage records while giving each new decision an exact order.
CREATE SEQUENCE "ReconciliationBatch_decisionOrdinal_seq";
ALTER TABLE "ReconciliationBatch" ADD COLUMN "decisionOrdinal" BIGINT NOT NULL
  DEFAULT nextval('"ReconciliationBatch_decisionOrdinal_seq"');
ALTER SEQUENCE "ReconciliationBatch_decisionOrdinal_seq" OWNED BY "ReconciliationBatch"."decisionOrdinal";
CREATE INDEX "ReconciliationBatch_scope_period_decisionOrdinal_idx"
  ON "ReconciliationBatch"("merchantScope", "period", "decisionOrdinal" DESC);
