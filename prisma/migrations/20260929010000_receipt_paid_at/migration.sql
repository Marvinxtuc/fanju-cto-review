-- Preserve verified channel payment time independently from inbox consumption time.
ALTER TABLE "ChannelReceipt" ADD COLUMN "paidAt" TIMESTAMP(3);
CREATE FUNCTION protect_receipt_paid_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."paidAt" IS DISTINCT FROM OLD."paidAt" THEN RAISE EXCEPTION 'Verified receipt payment time is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER receipt_paid_at_immutable BEFORE UPDATE ON "ChannelReceipt"
FOR EACH ROW EXECUTE FUNCTION protect_receipt_paid_at();
