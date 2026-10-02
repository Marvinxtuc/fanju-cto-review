CREATE TABLE "WorkerHeartbeat" (
  "id" TEXT NOT NULL,
  "mode" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "lastPolledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WorkerHeartbeat_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WorkerHeartbeat_mode_instanceId_key" ON "WorkerHeartbeat"("mode", "instanceId");
CREATE INDEX "WorkerHeartbeat_mode_lastPolledAt_idx" ON "WorkerHeartbeat"("mode", "lastPolledAt");
