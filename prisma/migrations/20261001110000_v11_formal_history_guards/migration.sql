-- Protect accepted history and monetary authority without promoting any record.
CREATE FUNCTION v11_formal_delete_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_TABLE_NAME='V11SupplyRevision' AND to_jsonb(OLD)->>'status'='FORMAL_APPROVED' THEN
  RAISE EXCEPTION 'Formal supply history cannot be deleted';
 ELSIF TG_TABLE_NAME='V11BundleConsent' AND to_jsonb(OLD)->>'source' LIKE 'FORMAL_USER_DELIVERY:%' THEN
  RAISE EXCEPTION 'Formal consent history cannot be deleted';
 END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER v11_formal_supply_delete_guard BEFORE DELETE ON "V11SupplyRevision"
FOR EACH ROW EXECUTE FUNCTION v11_formal_delete_guard();
CREATE TRIGGER v11_formal_consent_delete_guard BEFORE DELETE ON "V11BundleConsent"
FOR EACH ROW EXECUTE FUNCTION v11_formal_delete_guard();
CREATE FUNCTION v11_formal_request_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.source IN ('FORMAL_USER_INTAKE','FORMAL_BUSINESS_ROUTE','FORMAL_RESTAURANT') THEN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Formal accepted history cannot be deleted'; END IF;
  IF (NEW."businessKey",NEW."registrationId",NEW."userId",NEW.kind,NEW."acceptedAt",NEW.source)
   IS DISTINCT FROM (OLD."businessKey",OLD."registrationId",OLD."userId",OLD.kind,OLD."acceptedAt",OLD.source)
   THEN RAISE EXCEPTION 'Formal original acceptance and source are immutable'; END IF;
  IF NEW.payload IS DISTINCT FROM OLD.payload AND NOT (
    OLD.kind='FORMAL_SUPPLY_PROPOSAL' AND OLD.state='PENDING_PLATFORM_APPROVAL' AND NEW.state='RESOLVED'
    AND NEW.payload->'body'=OLD.payload->'body'
    AND NEW.payload->'proposalDigest'=OLD.payload->'proposalDigest'
    AND NEW.payload->>'supplyId' IS NOT NULL AND NEW.payload->>'approvalDigest' IS NOT NULL
  ) THEN RAISE EXCEPTION 'Formal accepted material is immutable'; END IF;
 ELSIF TG_OP='UPDATE' AND NEW.source IN ('FORMAL_USER_INTAKE','FORMAL_BUSINESS_ROUTE','FORMAL_RESTAURANT') THEN
  RAISE EXCEPTION 'Another source cannot be promoted to formal acceptance';
 END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v11_formal_request_history_guard BEFORE UPDATE OR DELETE ON "V11Request"
FOR EACH ROW EXECUTE FUNCTION v11_formal_request_history_guard();
CREATE FUNCTION v11_formal_decision_history_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.kind='FORMAL_REFUND_DECISION' THEN RAISE EXCEPTION 'Formal monetary decision is immutable'; END IF;
 IF TG_OP='UPDATE' AND NEW.kind='FORMAL_REFUND_DECISION' THEN RAISE EXCEPTION 'Another decision cannot be promoted to formal'; END IF;
 IF TG_OP='DELETE' THEN RETURN OLD; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v11_formal_decision_history_guard BEFORE UPDATE OR DELETE ON "V11Decision"
FOR EACH ROW EXECUTE FUNCTION v11_formal_decision_history_guard();
