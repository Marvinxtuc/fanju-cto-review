-- Expand first. Preserve historical responsibility until its channel facts are reviewed.
ALTER TABLE "Order" ADD COLUMN "registrationActive" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Order" ADD COLUMN "capacityHeld" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Order" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Order" ADD CONSTRAINT "Order_version_nonnegative" CHECK ("version" >= 0);
ALTER TABLE "Order" ADD CONSTRAINT "Order_paid_capacity_held" CHECK (
  "status" NOT IN ('PAID_PENDING_GROUP', 'GROUPED', 'REFUND_REVIEWING', 'REFUNDING', 'COMPLETED')
  OR ("registrationActive" AND "capacityHeld")
);

CREATE UNIQUE INDEX "Order_one_active_registration_key"
  ON "Order"("userId", "activityId") WHERE "registrationActive";
