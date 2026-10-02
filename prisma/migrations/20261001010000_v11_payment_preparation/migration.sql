-- Existing intents remain NOT_STARTED, never inferred paid.
-- Preserve exact mock identity; admit explicitly bound real intents for later formal assembly.
ALTER TABLE "V11PaymentIntent" DROP CONSTRAINT "V11PaymentIntent_mock_only";
ALTER TABLE "V11PaymentIntent" ADD CONSTRAINT "V11PaymentIntent_channel_binding_check"
  CHECK ("totalCents" > 0 AND (("channel" = 'mock' AND "merchantScope" = 'mock-local' AND "providerConfigId" = 'mock-v1')
    OR ("channel" = 'wechat' AND "merchantScope" ~ '^[a-f0-9]{64}$' AND length("providerConfigId") BETWEEN 1 AND 160)));
ALTER TABLE "V11PaymentIntent"
  ADD COLUMN "prepayId" TEXT,
  ADD COLUMN "preparationState" TEXT NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "preparationVersion" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "V11PaymentIntent" ADD CONSTRAINT "v11_preparation_state_check"
  CHECK ("preparationState" IN ('NOT_STARTED','SUBMITTING','PREPARED','UNKNOWN'));
ALTER TABLE "V11PaymentIntent" ADD CONSTRAINT "v11_preparation_value_check"
  CHECK (("preparationState" = 'PREPARED') = ("prepayId" IS NOT NULL));
-- Rollback requires checking that there are no SUBMITTING/UNKNOWN intents and that
-- all PREPARED merchant orders are closed or reconciled. Export retained preparation
-- references securely before dropping columns; dropping them destroys recovery data.
-- Restoring the old channel constraint also requires zero wechat intents; do not
-- delete them to force rollback. Keep this expansion until obligations are reconciled.
-- ALTER TABLE "V11PaymentIntent" DROP CONSTRAINT "v11_preparation_value_check",
-- DROP CONSTRAINT "v11_preparation_state_check", DROP COLUMN "prepayId",
-- DROP COLUMN "preparationState", DROP COLUMN "preparationVersion";
-- ALTER TABLE "V11PaymentIntent" DROP CONSTRAINT "V11PaymentIntent_channel_binding_check";
-- ALTER TABLE "V11PaymentIntent" ADD CONSTRAINT "V11PaymentIntent_mock_only"
-- CHECK ("channel"='mock' AND "merchantScope"='mock-local' AND "providerConfigId"='mock-v1' AND "totalCents">0);
