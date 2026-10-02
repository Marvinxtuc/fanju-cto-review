BEGIN;
-- Stop ambiguous legacy cutovers without modifying or deleting financial records.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM "Payment" GROUP BY "orderId" HAVING count(*) > 1) THEN
  RAISE EXCEPTION 'Funding preflight: multiple legacy payments per order require evidence review';
 END IF;
 IF EXISTS (SELECT 1 FROM "Payment" WHERE "amountCents" <= 0)
 OR EXISTS (SELECT 1 FROM "Refund" WHERE "amountCents" <= 0) THEN
  RAISE EXCEPTION 'Funding preflight: invalid legacy financial amount';
 END IF;
END $$;
-- AlterTable
ALTER TABLE "Payment" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "merchantScope" TEXT NOT NULL DEFAULT 'legacy-unverified',
ADD COLUMN     "nextQueryAt" TIMESTAMP(3),
ADD COLUMN     "providerConfigId" TEXT NOT NULL DEFAULT 'legacy-unverified',
ADD COLUMN     "resolutionState" TEXT NOT NULL DEFAULT 'NEW',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Refund" ADD COLUMN     "channel" TEXT NOT NULL DEFAULT 'legacy-unverified',
ADD COLUMN     "merchantScope" TEXT NOT NULL DEFAULT 'legacy-unverified',
ADD COLUMN     "obligationId" TEXT,
ADD COLUMN     "paymentId" TEXT,
ADD COLUMN     "providerConfigId" TEXT NOT NULL DEFAULT 'legacy-unverified',
ADD COLUMN     "receiptId" TEXT,
ADD COLUMN     "resolutionState" TEXT NOT NULL DEFAULT 'NEW',
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "ChannelReceipt" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "merchantScope" TEXT NOT NULL,
    "channelTradeNo" TEXT NOT NULL,
    "merchantOrderNo" TEXT NOT NULL,
    "paymentId" TEXT,
    "orderId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CNY',
    "evidenceHash" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChannelReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundObligation" (
    "id" TEXT NOT NULL,
    "receiptId" TEXT NOT NULL,
    "orderId" TEXT,
    "businessKey" TEXT NOT NULL,
    "cause" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "owner" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "policyVersion" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RefundObligation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReceivedEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "merchantScope" TEXT NOT NULL,
    "eventKey" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "normalizedPayload" JSONB NOT NULL,
    "verificationMaterialId" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'RECEIVED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReceivedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DurableJob" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "payloadVersion" INTEGER NOT NULL DEFAULT 1,
    "refId" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'READY',
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "leaseOwner" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "generation" INTEGER NOT NULL DEFAULT 0,
    "errorClass" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DurableJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReconciliationBatch" (
    "id" TEXT NOT NULL,
    "merchantScope" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "sourceHash" TEXT NOT NULL,
    "coverageState" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReconciliationBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FinancialCase" (
    "id" TEXT NOT NULL,
    "caseKey" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "owner" TEXT NOT NULL,
    "deadline" TIMESTAMP(3) NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FinancialCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MockChannelTransaction" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "businessKey" TEXT NOT NULL,
    "channelNo" TEXT NOT NULL,
    "originalTradeNo" TEXT,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MockChannelTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelReceipt_merchantScope_merchantOrderNo_idx" ON "ChannelReceipt"("merchantScope", "merchantOrderNo");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelReceipt_channel_merchantScope_channelTradeNo_key" ON "ChannelReceipt"("channel", "merchantScope", "channelTradeNo");

-- CreateIndex
CREATE UNIQUE INDEX "RefundObligation_businessKey_key" ON "RefundObligation"("businessKey");

-- CreateIndex
CREATE UNIQUE INDEX "ReceivedEvent_source_merchantScope_eventKey_key" ON "ReceivedEvent"("source", "merchantScope", "eventKey");

-- CreateIndex
CREATE UNIQUE INDEX "DurableJob_businessKey_key" ON "DurableJob"("businessKey");

-- CreateIndex
CREATE INDEX "DurableJob_state_runAt_idx" ON "DurableJob"("state", "runAt");

-- CreateIndex
CREATE UNIQUE INDEX "ReconciliationBatch_merchantScope_period_sourceHash_key" ON "ReconciliationBatch"("merchantScope", "period", "sourceHash");

-- CreateIndex
CREATE UNIQUE INDEX "FinancialCase_caseKey_key" ON "FinancialCase"("caseKey");

-- CreateIndex
CREATE INDEX "FinancialCase_state_deadline_idx" ON "FinancialCase"("state", "deadline");

-- CreateIndex
CREATE UNIQUE INDEX "MockChannelTransaction_businessKey_key" ON "MockChannelTransaction"("businessKey");

-- CreateIndex
CREATE UNIQUE INDEX "MockChannelTransaction_channelNo_key" ON "MockChannelTransaction"("channelNo");

-- CreateIndex
CREATE UNIQUE INDEX "Refund_obligationId_key" ON "Refund"("obligationId");

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ChannelReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_obligationId_fkey" FOREIGN KEY ("obligationId") REFERENCES "RefundObligation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelReceipt" ADD CONSTRAINT "ChannelReceipt_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "Payment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelReceipt" ADD CONSTRAINT "ChannelReceipt_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundObligation" ADD CONSTRAINT "RefundObligation_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ChannelReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundObligation" ADD CONSTRAINT "RefundObligation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- All legacy intents retain their funds and channel ambiguity until evidence is reviewed.
UPDATE "Payment" SET "resolutionState" = 'MANUAL';
UPDATE "Refund" SET "resolutionState" = 'MANUAL';
CREATE UNIQUE INDEX "Payment_one_active_per_order" ON "Payment"("orderId") WHERE "active";
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_amount_positive" CHECK ("amountCents" > 0),
 ADD CONSTRAINT "Payment_resolution_valid" CHECK ("resolutionState" IN ('NEW','UNKNOWN','CONFIRMED','CLOSED','MANUAL')),
 ADD CONSTRAINT "Payment_version_valid" CHECK ("version" >= 0);
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_amount_positive" CHECK ("amountCents" > 0),
 ADD CONSTRAINT "Refund_resolution_valid" CHECK ("resolutionState" IN ('NEW','UNKNOWN','CONFIRMED','REJECTED','MANUAL')),
 ADD CONSTRAINT "Refund_version_valid" CHECK ("version" >= 0);
ALTER TABLE "ChannelReceipt" ADD CONSTRAINT "ChannelReceipt_amount_currency" CHECK ("amountCents" > 0 AND "currency" = 'CNY'),
 ADD CONSTRAINT "ChannelReceipt_identity" CHECK (length("merchantScope") > 0 AND length("channelTradeNo") > 0 AND length("evidenceHash") > 0);
ALTER TABLE "RefundObligation" ADD CONSTRAINT "RefundObligation_amount_state" CHECK ("amountCents" > 0 AND "state" IN ('OPEN','PROCESSING','SATISFIED','MANUAL'));
ALTER TABLE "ReceivedEvent" ADD CONSTRAINT "ReceivedEvent_state_valid" CHECK ("state" IN ('RECEIVED','APPLIED','MANUAL'));
ALTER TABLE "DurableJob" ADD CONSTRAINT "DurableJob_state_valid" CHECK ("state" IN ('READY','RUNNING','RETRY','DONE','MANUAL')),
 ADD CONSTRAINT "DurableJob_counter_valid" CHECK ("attempts" >= 0 AND "generation" >= 0 AND "payloadVersion" > 0),
 ADD CONSTRAINT "DurableJob_lease_valid" CHECK (("state" = 'RUNNING') = ("leaseOwner" IS NOT NULL AND "leaseUntil" IS NOT NULL));
ALTER TABLE "FinancialCase" ADD CONSTRAINT "FinancialCase_state_valid" CHECK ("state" IN ('OPEN','RESOLVED')),
 ADD CONSTRAINT "FinancialCase_review_required" CHECK ("state" <> 'RESOLVED' OR ("resolution" IS NOT NULL AND "reviewedBy" IS NOT NULL AND "reviewedAt" IS NOT NULL));
ALTER TABLE "ReconciliationBatch" ADD CONSTRAINT "ReconciliationBatch_coverage_valid" CHECK ("coverageState" IN ('COMPLETE','INCOMPLETE','UNAVAILABLE'));
ALTER TABLE "MockChannelTransaction" ADD CONSTRAINT "MockChannelTransaction_valid" CHECK ("amountCents" > 0 AND "kind" IN ('PAYMENT','REFUND') AND "status" IN ('PENDING','SUCCEEDED','CLOSED','FAILED'));
-- Financial evidence is append-only; correcting a conflict requires another evidence record.
CREATE FUNCTION protect_receipt_fact() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW."channel", NEW."merchantScope", NEW."channelTradeNo", NEW."merchantOrderNo", NEW."amountCents", NEW."currency", NEW."evidenceHash", NEW."verifiedAt")
 IS DISTINCT FROM ROW(OLD."channel", OLD."merchantScope", OLD."channelTradeNo", OLD."merchantOrderNo", OLD."amountCents", OLD."currency", OLD."evidenceHash", OLD."verifiedAt") THEN
  RAISE EXCEPTION 'Receipt facts are immutable';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER receipt_fact_guard BEFORE UPDATE ON "ChannelReceipt" FOR EACH ROW EXECUTE FUNCTION protect_receipt_fact();
COMMIT;
