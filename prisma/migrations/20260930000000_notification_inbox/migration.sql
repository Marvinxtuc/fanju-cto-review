ALTER TABLE "Notification" ADD COLUMN "orderId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "activityId" TEXT;
ALTER TABLE "Notification" ADD COLUMN "readAt" TIMESTAMP(3);

-- Only keys written by the formation flow can establish an unambiguous order link.
UPDATE "Notification" AS n
SET "orderId" = o."id", "activityId" = o."activityId"
FROM "Order" AS o
WHERE n."userId" = o."userId"
  AND (
    (n."type" = 'GROUP_CONFIRMED' AND n."businessKey" = 'group:' || o."activityId" || ':' || split_part(n."businessKey", ':', 3) || ':' || o."id"
      AND split_part(n."businessKey", ':', 3) ~ '^[0-9]+$')
    OR (n."type" IN ('GROUP_FAILED', 'ACTIVITY_CANCELED')
      AND n."businessKey" = n."type" || ':' || o."activityId" || ':' || o."id")
  );

ALTER TABLE "Notification" ADD CONSTRAINT "Notification_orderId_fkey"
  FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_activityId_fkey"
  FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "Notification_userId_status_createdAt_id_idx"
  ON "Notification"("userId", "status", "createdAt", "id");
