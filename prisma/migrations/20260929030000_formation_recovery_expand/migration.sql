-- Preserve every historical draft and notification. NULL means unverified legacy metadata.
ALTER TABLE "TableGroup" ADD COLUMN "generation" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "TableGroup" ADD COLUMN "ordinal" INTEGER;
ALTER TABLE "TableGroup" ADD COLUMN "candidateDigest" TEXT;
ALTER TABLE "Notification" ADD COLUMN "businessKey" TEXT;

ALTER TABLE "TableGroup" ADD CONSTRAINT "TableGroup_generation_nonnegative" CHECK ("generation" >= 0);
ALTER TABLE "TableGroup" ADD CONSTRAINT "TableGroup_ordinal_positive" CHECK ("ordinal" IS NULL OR "ordinal" > 0);
CREATE UNIQUE INDEX "TableGroup_activityId_generation_ordinal_key"
  ON "TableGroup"("activityId", "generation", "ordinal");
CREATE UNIQUE INDEX "Notification_businessKey_key" ON "Notification"("businessKey");
