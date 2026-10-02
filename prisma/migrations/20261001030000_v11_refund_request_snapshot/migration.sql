-- Nullable history: never infer a past cumulative request from its incremental refund.
ALTER TABLE "V11RefundInstruction" ADD COLUMN "requestedServiceFeeCents" INTEGER,
  ADD COLUMN "requestedDepositCents" INTEGER;
ALTER TABLE "V11RefundInstruction" ADD CONSTRAINT "v11_refund_request_pair"
  CHECK (("requestedServiceFeeCents" IS NULL AND "requestedDepositCents" IS NULL)
    OR ("requestedServiceFeeCents" IS NOT NULL AND "requestedDepositCents" IS NOT NULL
      AND "requestedServiceFeeCents" >= 0 AND "requestedDepositCents" >= 0));
-- Rollback only after exporting request snapshots securely and checking no active
-- instructions depend on exact target comparison. Do not delete refund obligations.
-- ALTER TABLE "V11RefundInstruction" DROP CONSTRAINT "v11_refund_request_pair",
-- DROP COLUMN "requestedServiceFeeCents", DROP COLUMN "requestedDepositCents";
