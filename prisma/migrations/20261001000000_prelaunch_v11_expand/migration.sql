-- Additive V1.1 local domain; no legacy rows rewritten or historical evidence removed.

CREATE TABLE "V11Actor" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "personId" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "userId" TEXT,
  "restaurantId" TEXT,
  "passwordHash" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "V11Actor_personId_idx" ON "V11Actor" ("personId");

CREATE TABLE "V11PolicySnapshot" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "bundleVersion" TEXT NOT NULL,
  "bundleDigest" TEXT NOT NULL,
  "baselineHash" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'LOCAL_DRAFT',
  "docsJson" JSONB NOT NULL,
  "blockersJson" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11PolicySnapshot_bundleDigest_key" ON "V11PolicySnapshot" ("bundleDigest");

CREATE TABLE "V11Profile" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "gender" TEXT,
  "adultConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "availableTimes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "adaptationConfirmed" BOOLEAN NOT NULL DEFAULT false,
  "version" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE UNIQUE INDEX "V11Profile_userId_key" ON "V11Profile" ("userId");

CREATE TABLE "V11BundleConsent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "documentHashesJson" JSONB NOT NULL,
  "publicHashesJson" JSONB NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'SIMULATION_ONLY'
);

CREATE INDEX "V11BundleConsent_userId_policyId_idx" ON "V11BundleConsent" ("userId", "policyId");

CREATE TABLE "V11SupplyRevision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activityId" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "revision" INTEGER NOT NULL,
  "personId" TEXT,
  "minSize" INTEGER NOT NULL,
  "targetSize" INTEGER NOT NULL,
  "maxSize" INTEGER NOT NULL,
  "maxTables" INTEGER NOT NULL,
  "capacity" INTEGER NOT NULL,
  "serviceFeeCents" INTEGER NOT NULL,
  "depositCents" INTEGER NOT NULL,
  "waitlistMax" INTEGER,
  "strategy" TEXT NOT NULL,
  "snapshot" JSONB NOT NULL,
  "digest" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "signedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11SupplyRevision_activityId_revision_key" ON "V11SupplyRevision" ("activityId", "revision");

CREATE TABLE "V11Registration" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "userId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "policyId" TEXT NOT NULL,
  "supplyId" TEXT NOT NULL,
  "consentId" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  "eligibilityState" TEXT NOT NULL DEFAULT 'PENDING_PAYMENT',
  "serviceFeeCents" INTEGER NOT NULL,
  "depositCents" INTEGER NOT NULL,
  "snapshot" JSONB NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "paidEffectiveAt" TIMESTAMPTZ(3),
  "cancelAcceptedAt" TIMESTAMPTZ(3),
  "queueOrdinal" BIGINT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "V11Registration_activityId_eligibilityState_idx" ON "V11Registration" ("activityId", "eligibilityState");

CREATE INDEX "V11Registration_userId_createdAt_id_idx" ON "V11Registration" ("userId", "createdAt", "id");

CREATE TABLE "V11SeatHold" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "registrationId" TEXT NOT NULL,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "releasedAt" TIMESTAMPTZ(3),
  "state" TEXT NOT NULL DEFAULT 'HELD',
  "version" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "V11SeatHold_registrationId_key" ON "V11SeatHold" ("registrationId");

CREATE TABLE "V11Table" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activityId" TEXT NOT NULL,
  "supplyId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'UNFORMED',
  "everFormed" BOOLEAN NOT NULL DEFAULT false,
  "t24FormedAt" TIMESTAMPTZ(3),
  "failedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11Table_activityId_ordinal_key" ON "V11Table" ("activityId", "ordinal");

CREATE TABLE "V11Membership" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "registrationId" TEXT NOT NULL,
  "tableId" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "joinedAt" TIMESTAMPTZ(3) NOT NULL,
  "leftAt" TIMESTAMPTZ(3)
);

CREATE UNIQUE INDEX "V11Membership_registrationId_key" ON "V11Membership" ("registrationId");

CREATE TABLE "V11TableEvent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "tableId" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "snapshot" JSONB NOT NULL,
  "version" INTEGER NOT NULL
);

CREATE UNIQUE INDEX "V11TableEvent_businessKey_key" ON "V11TableEvent" ("businessKey");

CREATE TABLE "V11PaymentIntent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "registrationId" TEXT NOT NULL,
  "merchantOrderNo" TEXT NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "channel" TEXT NOT NULL DEFAULT 'mock',
  "merchantScope" TEXT NOT NULL DEFAULT 'mock-local',
  "providerConfigId" TEXT NOT NULL DEFAULT 'mock-v1',
  "totalCents" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'NEW',
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE UNIQUE INDEX "V11PaymentIntent_merchantOrderNo_key" ON "V11PaymentIntent" ("merchantOrderNo");

CREATE TABLE "V11ReceiptBinding" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "receiptId" TEXT NOT NULL,
  "intentId" TEXT,
  "registrationId" TEXT,
  "classification" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11ReceiptBinding_receiptId_key" ON "V11ReceiptBinding" ("receiptId");

CREATE TABLE "V11FundComponent" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "receiptId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "originalCents" INTEGER NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "V11FundComponent_receiptId_kind_key" ON "V11FundComponent" ("receiptId", "kind");

CREATE TABLE "V11Disposition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "componentId" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "state" TEXT NOT NULL,
  "sourceRef" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE UNIQUE INDEX "V11Disposition_businessKey_key" ON "V11Disposition" ("businessKey");

CREATE INDEX "V11Disposition_componentId_state_idx" ON "V11Disposition" ("componentId", "state");

CREATE TABLE "V11RefundInstruction" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "registrationId" TEXT,
  "receiptId" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "merchantRefundNo" TEXT NOT NULL,
  "serviceFeeCents" INTEGER NOT NULL,
  "depositCents" INTEGER NOT NULL,
  "totalCents" INTEGER NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'mock',
  "merchantScope" TEXT NOT NULL DEFAULT 'mock-local',
  "providerConfigId" TEXT NOT NULL DEFAULT 'mock-v1',
  "originalTradeNo" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'NEW',
  "channelRefundNo" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE UNIQUE INDEX "V11RefundInstruction_businessKey_key" ON "V11RefundInstruction" ("businessKey");

CREATE UNIQUE INDEX "V11RefundInstruction_merchantRefundNo_key" ON "V11RefundInstruction" ("merchantRefundNo");

CREATE UNIQUE INDEX "V11RefundInstruction_channelRefundNo_key" ON "V11RefundInstruction" ("channelRefundNo");

CREATE TABLE "V11Request" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "businessKey" TEXT NOT NULL,
  "registrationId" TEXT,
  "userId" TEXT,
  "kind" TEXT NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "source" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'ACCEPTED',
  "blockerIds" JSONB NOT NULL,
  "payload" JSONB NOT NULL,
  "ownerActorId" TEXT,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11Request_businessKey_key" ON "V11Request" ("businessKey");

CREATE INDEX "V11Request_state_kind_idx" ON "V11Request" ("state", "kind");

CREATE TABLE "V11Decision" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "actorId" TEXT NOT NULL,
  "personId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "V11DeliveryProof" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT,
  "registrationId" TEXT,
  "noticeKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "state" TEXT NOT NULL,
  "receivedAt" TIMESTAMPTZ(3),
  "proofType" TEXT NOT NULL DEFAULT 'SIMULATED',
  "personId" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11DeliveryProof_noticeKey_key" ON "V11DeliveryProof" ("noticeKey");

CREATE TABLE "V11Attendance" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "registrationId" TEXT NOT NULL,
  "checkinAt" TIMESTAMPTZ(3),
  "qrDigest" TEXT,
  "restaurantActorId" TEXT,
  "restaurantResult" TEXT,
  "confirmedAt" TIMESTAMPTZ(3),
  "version" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "V11Attendance_registrationId_key" ON "V11Attendance" ("registrationId");

CREATE TABLE "V11CoreChange" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "activityId" TEXT NOT NULL,
  "supplyId" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "originalSnapshot" JSONB NOT NULL,
  "proposedSnapshot" JSONB NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'PROPOSED',
  "extraCompensationCents" INTEGER,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX "V11CoreChange_businessKey_key" ON "V11CoreChange" ("businessKey");

CREATE TABLE "V11ChangeChoice" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "changeId" TEXT NOT NULL,
  "registrationId" TEXT NOT NULL,
  "choice" TEXT NOT NULL,
  "acceptedAt" TIMESTAMPTZ(3) NOT NULL
);

CREATE UNIQUE INDEX "V11ChangeChoice_changeId_registrationId_key" ON "V11ChangeChoice" ("changeId", "registrationId");

CREATE TABLE "V11SettlementObligation" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "registrationId" TEXT NOT NULL,
  "componentId" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'BLOCKED_POLICY',
  "mockAccountRef" TEXT,
  "channelNo" TEXT,
  "sourceRef" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11SettlementObligation_businessKey_key" ON "V11SettlementObligation" ("businessKey");

CREATE TABLE "V11PrivacyDisposition" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "requestId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "businessKey" TEXT NOT NULL,
  "fields" TEXT[] NOT NULL,
  "state" TEXT NOT NULL,
  "appliedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX "V11PrivacyDisposition_businessKey_key" ON "V11PrivacyDisposition" ("businessKey");

ALTER TABLE "V11Actor" ADD CONSTRAINT "V11Actor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Actor" ADD CONSTRAINT "V11Actor_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Profile" ADD CONSTRAINT "V11Profile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11BundleConsent" ADD CONSTRAINT "V11BundleConsent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11BundleConsent" ADD CONSTRAINT "V11BundleConsent_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "V11PolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11SupplyRevision" ADD CONSTRAINT "V11SupplyRevision_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11SupplyRevision" ADD CONSTRAINT "V11SupplyRevision_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11SupplyRevision" ADD CONSTRAINT "V11SupplyRevision_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "V11PolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Registration" ADD CONSTRAINT "V11Registration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Registration" ADD CONSTRAINT "V11Registration_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Registration" ADD CONSTRAINT "V11Registration_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "V11PolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Registration" ADD CONSTRAINT "V11Registration_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "V11SupplyRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Registration" ADD CONSTRAINT "V11Registration_consentId_fkey" FOREIGN KEY ("consentId") REFERENCES "V11BundleConsent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11SeatHold" ADD CONSTRAINT "V11SeatHold_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Table" ADD CONSTRAINT "V11Table_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Table" ADD CONSTRAINT "V11Table_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "V11SupplyRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Membership" ADD CONSTRAINT "V11Membership_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Membership" ADD CONSTRAINT "V11Membership_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "V11Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11TableEvent" ADD CONSTRAINT "V11TableEvent_tableId_fkey" FOREIGN KEY ("tableId") REFERENCES "V11Table"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11PaymentIntent" ADD CONSTRAINT "V11PaymentIntent_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11ReceiptBinding" ADD CONSTRAINT "V11ReceiptBinding_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ChannelReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11ReceiptBinding" ADD CONSTRAINT "V11ReceiptBinding_intentId_fkey" FOREIGN KEY ("intentId") REFERENCES "V11PaymentIntent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11ReceiptBinding" ADD CONSTRAINT "V11ReceiptBinding_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11FundComponent" ADD CONSTRAINT "V11FundComponent_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ChannelReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Disposition" ADD CONSTRAINT "V11Disposition_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "V11FundComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11RefundInstruction" ADD CONSTRAINT "V11RefundInstruction_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11RefundInstruction" ADD CONSTRAINT "V11RefundInstruction_receiptId_fkey" FOREIGN KEY ("receiptId") REFERENCES "ChannelReceipt"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Request" ADD CONSTRAINT "V11Request_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Request" ADD CONSTRAINT "V11Request_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Request" ADD CONSTRAINT "V11Request_ownerActorId_fkey" FOREIGN KEY ("ownerActorId") REFERENCES "V11Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Decision" ADD CONSTRAINT "V11Decision_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "V11Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Decision" ADD CONSTRAINT "V11Decision_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "V11Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11DeliveryProof" ADD CONSTRAINT "V11DeliveryProof_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "V11Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11DeliveryProof" ADD CONSTRAINT "V11DeliveryProof_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Attendance" ADD CONSTRAINT "V11Attendance_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11Attendance" ADD CONSTRAINT "V11Attendance_restaurantActorId_fkey" FOREIGN KEY ("restaurantActorId") REFERENCES "V11Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11CoreChange" ADD CONSTRAINT "V11CoreChange_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11CoreChange" ADD CONSTRAINT "V11CoreChange_supplyId_fkey" FOREIGN KEY ("supplyId") REFERENCES "V11SupplyRevision"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11ChangeChoice" ADD CONSTRAINT "V11ChangeChoice_changeId_fkey" FOREIGN KEY ("changeId") REFERENCES "V11CoreChange"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11ChangeChoice" ADD CONSTRAINT "V11ChangeChoice_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11SettlementObligation" ADD CONSTRAINT "V11SettlementObligation_registrationId_fkey" FOREIGN KEY ("registrationId") REFERENCES "V11Registration"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11SettlementObligation" ADD CONSTRAINT "V11SettlementObligation_componentId_fkey" FOREIGN KEY ("componentId") REFERENCES "V11FundComponent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11PrivacyDisposition" ADD CONSTRAINT "V11PrivacyDisposition_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "V11Request"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "V11PrivacyDisposition" ADD CONSTRAINT "V11PrivacyDisposition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE UNIQUE INDEX "V11Registration_active_user_activity_key" ON "V11Registration" ("userId", "activityId") WHERE "active" = true;

CREATE UNIQUE INDEX "V11PaymentIntent_active_registration_key" ON "V11PaymentIntent" ("registrationId") WHERE "active" = true;

ALTER TABLE "V11SupplyRevision" ADD CONSTRAINT "V11SupplyRevision_valid_bounds" CHECK ("minSize" >= 4 AND "minSize" <= "targetSize" AND "targetSize" <= "maxSize" AND "maxSize" <= 8 AND "maxTables" > 0 AND "capacity" > 0 AND "capacity" <= "maxTables" * "maxSize" AND "serviceFeeCents" >= 0 AND "depositCents" >= 0 AND ("waitlistMax" IS NULL OR "waitlistMax" >= 0));

ALTER TABLE "V11FundComponent" ADD CONSTRAINT "V11FundComponent_nonnegative" CHECK ("originalCents" >= 0 AND "kind" IN ('F', 'D'));

ALTER TABLE "V11Disposition" ADD CONSTRAINT "V11Disposition_nonnegative" CHECK ("amountCents" >= 0);

ALTER TABLE "V11RefundInstruction" ADD CONSTRAINT "V11RefundInstruction_components" CHECK ("serviceFeeCents" >= 0 AND "depositCents" >= 0 AND "totalCents" > 0 AND "totalCents" = "serviceFeeCents" + "depositCents");

ALTER TABLE "V11PaymentIntent" ADD CONSTRAINT "V11PaymentIntent_mock_only" CHECK ("channel" = 'mock' AND "merchantScope" = 'mock-local' AND "providerConfigId" = 'mock-v1' AND "totalCents" > 0);

ALTER TABLE "V11RefundInstruction" ADD CONSTRAINT "V11RefundInstruction_mock_only" CHECK ("channel" = 'mock' AND "merchantScope" = 'mock-local' AND "providerConfigId" = 'mock-v1');

ALTER TABLE "V11Actor" ADD CONSTRAINT "V11Actor_valid_role" CHECK ("role" IN ('USER', 'OPS', 'REVIEWER', 'RESTAURANT'));

ALTER TABLE "V11PolicySnapshot" ADD CONSTRAINT "V11PolicySnapshot_no_activation" CHECK ("status" = 'LOCAL_DRAFT');
