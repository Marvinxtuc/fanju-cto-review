ALTER TABLE "UserProfile"
ADD COLUMN "acceptableTableSizes" INTEGER[] NOT NULL DEFAULT ARRAY[4, 5, 6, 7, 8];
