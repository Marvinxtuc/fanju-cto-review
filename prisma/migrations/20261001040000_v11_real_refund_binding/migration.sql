ALTER TABLE "V11RefundInstruction" DROP CONSTRAINT "V11RefundInstruction_mock_only";
ALTER TABLE "V11RefundInstruction" ADD CONSTRAINT "V11RefundInstruction_channel_binding_check"
  CHECK (("channel"='mock' AND "merchantScope"='mock-local' AND "providerConfigId"='mock-v1')
    OR ("channel"='wechat' AND "merchantScope" ~ '^[a-f0-9]{64}$' AND length("providerConfigId") BETWEEN 1 AND 160));
-- Rollback requires no wechat instructions. Preserve active obligations rather than
-- deleting them or relabeling the channel to force the old constraint.
-- ALTER TABLE "V11RefundInstruction" DROP CONSTRAINT "V11RefundInstruction_channel_binding_check";
-- ALTER TABLE "V11RefundInstruction" ADD CONSTRAINT "V11RefundInstruction_mock_only"
-- CHECK ("channel"='mock' AND "merchantScope"='mock-local' AND "providerConfigId"='mock-v1');
