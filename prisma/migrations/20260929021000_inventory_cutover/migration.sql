-- Apply only with code that reads the active-registration predicate.
DROP INDEX "Order_userId_activityId_key";
CREATE INDEX "Order_userId_activityId_idx" ON "Order"("userId", "activityId");
