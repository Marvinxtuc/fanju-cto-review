CREATE TYPE "UserStatus" AS ENUM ('NORMAL', 'RESTRICTED', 'BLACKLISTED');
CREATE TYPE "AdminRole" AS ENUM ('OPS', 'SUPER_ADMIN');
CREATE TYPE "RestaurantStatus" AS ENUM ('ACTIVE', 'INACTIVE');
CREATE TYPE "ActivityStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'REGISTRATION_OPEN', 'LOCKING', 'GROUPED', 'GROUP_FAILED', 'ADDRESS_UNLOCKED', 'IN_PROGRESS', 'COMPLETED', 'CANCELED');
CREATE TYPE "OrderStatus" AS ENUM ('PENDING_PAYMENT', 'PAYMENT_FAILED', 'CLOSED', 'PAID_PENDING_GROUP', 'GROUPED', 'GROUP_FAILED', 'REFUND_REQUESTED', 'REFUND_REVIEWING', 'REFUNDING', 'REFUNDED', 'CANCELED', 'COMPLETED');
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');
CREATE TYPE "RefundStatus" AS ENUM ('REVIEWING', 'REFUNDING', 'SUCCEEDED', 'FAILED', 'REJECTED');
CREATE TYPE "TableGroupStatus" AS ENUM ('PENDING_CONFIRMATION', 'CONFIRMED', 'CANCELED');
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'RESOLVED', 'REJECTED');
CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "wechatOpenid" TEXT NOT NULL,
  "wechatUnionid" TEXT,
  "phone" TEXT,
  "status" "UserStatus" NOT NULL DEFAULT 'NORMAL',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserProfile" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "preferredAreas" TEXT[],
  "availableTimes" TEXT[],
  "tastePreferences" TEXT[],
  "dietaryRestrictions" TEXT[],
  "budgetRange" TEXT NOT NULL,
  "tableVibe" TEXT NOT NULL,
  "note" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UserProfile_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConsentRecord" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "agreementVersion" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AdminUser" (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "role" "AdminRole" NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Restaurant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "businessArea" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "contactName" TEXT NOT NULL,
  "contactPhone" TEXT NOT NULL,
  "budgetCents" INTEGER NOT NULL,
  "cuisineTags" TEXT[],
  "capacity" INTEGER NOT NULL,
  "status" "RestaurantStatus" NOT NULL DEFAULT 'ACTIVE',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Restaurant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Activity" (
  "id" TEXT NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "theme" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "district" TEXT NOT NULL,
  "businessArea" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "endsAt" TIMESTAMP(3) NOT NULL,
  "registrationEndsAt" TIMESTAMP(3) NOT NULL,
  "serviceFeeCents" INTEGER NOT NULL,
  "mealFeeIncluded" BOOLEAN NOT NULL DEFAULT false,
  "mealFeePolicyText" TEXT NOT NULL,
  "minSize" INTEGER NOT NULL DEFAULT 4,
  "targetSize" INTEGER NOT NULL DEFAULT 6,
  "maxSize" INTEGER NOT NULL DEFAULT 8,
  "capacity" INTEGER NOT NULL,
  "status" "ActivityStatus" NOT NULL DEFAULT 'DRAFT',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Order" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "OrderStatus" NOT NULL DEFAULT 'PENDING_PAYMENT',
  "agreementVersion" TEXT NOT NULL,
  "profileSnapshot" JSONB,
  "inventoryLockedUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Payment" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
  "channel" TEXT NOT NULL DEFAULT 'mock',
  "channelTradeNo" TEXT,
  "callbackNonce" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Refund" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "status" "RefundStatus" NOT NULL DEFAULT 'REVIEWING',
  "reason" TEXT NOT NULL,
  "requestedBy" TEXT NOT NULL,
  "channelRefundNo" TEXT,
  "callbackNonce" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Refund_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TableGroup" (
  "id" TEXT NOT NULL,
  "activityId" TEXT NOT NULL,
  "status" "TableGroupStatus" NOT NULL DEFAULT 'PENDING_CONFIRMATION',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "TableGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TableMember" (
  "id" TEXT NOT NULL,
  "tableGroupId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TableMember_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Report" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Blacklist" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Blacklist_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "actorId" TEXT,
  "actorRole" "AdminRole",
  "action" TEXT NOT NULL,
  "targetType" TEXT NOT NULL,
  "targetId" TEXT NOT NULL,
  "reason" TEXT,
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
  "payload" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "User_wechatOpenid_key" ON "User"("wechatOpenid");
CREATE UNIQUE INDEX "UserProfile_userId_key" ON "UserProfile"("userId");
CREATE INDEX "ConsentRecord_userId_agreementVersion_idx" ON "ConsentRecord"("userId", "agreementVersion");
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
CREATE INDEX "Activity_status_startsAt_idx" ON "Activity"("status", "startsAt");
CREATE UNIQUE INDEX "Order_userId_activityId_key" ON "Order"("userId", "activityId");
CREATE INDEX "Order_status_idx" ON "Order"("status");
CREATE UNIQUE INDEX "Payment_channelTradeNo_key" ON "Payment"("channelTradeNo");
CREATE UNIQUE INDEX "Payment_callbackNonce_key" ON "Payment"("callbackNonce");
CREATE INDEX "Payment_orderId_status_idx" ON "Payment"("orderId", "status");
CREATE UNIQUE INDEX "Refund_channelRefundNo_key" ON "Refund"("channelRefundNo");
CREATE UNIQUE INDEX "Refund_callbackNonce_key" ON "Refund"("callbackNonce");
CREATE INDEX "Refund_orderId_status_idx" ON "Refund"("orderId", "status");
CREATE UNIQUE INDEX "TableMember_tableGroupId_orderId_key" ON "TableMember"("tableGroupId", "orderId");
CREATE UNIQUE INDEX "Blacklist_userId_key" ON "Blacklist"("userId");
CREATE INDEX "AuditLog_targetType_targetId_idx" ON "AuditLog"("targetType", "targetId");

ALTER TABLE "UserProfile" ADD CONSTRAINT "UserProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ConsentRecord" ADD CONSTRAINT "ConsentRecord_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Activity" ADD CONSTRAINT "Activity_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "Restaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableGroup" ADD CONSTRAINT "TableGroup_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TableMember" ADD CONSTRAINT "TableMember_tableGroupId_fkey" FOREIGN KEY ("tableGroupId") REFERENCES "TableGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TableMember" ADD CONSTRAINT "TableMember_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Report" ADD CONSTRAINT "Report_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Blacklist" ADD CONSTRAINT "Blacklist_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "AdminUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
