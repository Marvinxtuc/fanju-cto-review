ALTER TABLE "ReceivedEvent" DROP CONSTRAINT "ReceivedEvent_state_valid";
ALTER TABLE "ReceivedEvent" ADD CONSTRAINT "ReceivedEvent_state_valid"
  CHECK ("state" IN ('RECEIVED','RECEIPT_RECORDED','APPLIED','MANUAL'));
-- Rollback only when no RECEIPT_RECORDED events remain; do not relabel them APPLIED
-- to force rollback because monetary recording does not prove business processing.
-- ALTER TABLE "ReceivedEvent" DROP CONSTRAINT "ReceivedEvent_state_valid";
-- ALTER TABLE "ReceivedEvent" ADD CONSTRAINT "ReceivedEvent_state_valid"
-- CHECK ("state" IN ('RECEIVED','APPLIED','MANUAL'));
