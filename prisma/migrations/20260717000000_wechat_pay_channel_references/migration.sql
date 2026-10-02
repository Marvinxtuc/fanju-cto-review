-- Keep channel-facing identifiers separate from internal record IDs. Existing
-- mock history receives a non-channel legacy identifier so this migration is
-- reversible without deleting payment or refund records.
ALTER TABLE "Payment" ADD COLUMN "merchantOrderNo" TEXT;
UPDATE "Payment"
SET "merchantOrderNo" = 'legacy_pay_' || "id"
WHERE "merchantOrderNo" IS NULL;
ALTER TABLE "Payment" ALTER COLUMN "merchantOrderNo" SET NOT NULL;
CREATE UNIQUE INDEX "Payment_merchantOrderNo_key" ON "Payment"("merchantOrderNo");
ALTER TABLE "Payment" ADD COLUMN "prepayId" TEXT;
CREATE UNIQUE INDEX "Payment_prepayId_key" ON "Payment"("prepayId");

ALTER TABLE "Refund" ADD COLUMN "merchantRefundNo" TEXT;
UPDATE "Refund"
SET "merchantRefundNo" = 'legacy_refund_' || "id"
WHERE "merchantRefundNo" IS NULL;
ALTER TABLE "Refund" ALTER COLUMN "merchantRefundNo" SET NOT NULL;
CREATE UNIQUE INDEX "Refund_merchantRefundNo_key" ON "Refund"("merchantRefundNo");
