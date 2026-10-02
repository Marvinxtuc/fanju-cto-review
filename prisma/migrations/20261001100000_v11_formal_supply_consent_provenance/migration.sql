CREATE FUNCTION v11_formal_supply_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."status"='FORMAL_APPROVED' OR NEW."status"='FORMAL_APPROVED' THEN
  RAISE EXCEPTION 'Approved formal supply is immutable and cannot be promoted from another source';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v11_formal_supply_immutable BEFORE UPDATE ON "V11SupplyRevision"
FOR EACH ROW EXECUTE FUNCTION v11_formal_supply_immutable();
CREATE FUNCTION v11_formal_supply_provenance_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."status"='FORMAL_APPROVED' AND NOT EXISTS (
  SELECT 1 FROM "V11PolicySnapshot" p JOIN "V11RuntimePolicyBinding" b ON b."policyId"=p.id
   JOIN "V11Request" r ON r.id=NEW."snapshot"->>'proposalId'
   JOIN "AuditLog" a ON a."targetId"=NEW.id AND a.action='supply.v11-platform-approved'
  WHERE p.id=NEW."policyId" AND p.status='FORMAL_RUNTIME'
   AND NEW.snapshot->>'scope'='FORMAL_SUPPLY'
   AND NEW.snapshot->>'environment'=b.environment
   AND NEW.snapshot->>'policyDigest'=p."bundleDigest"
   AND NEW.snapshot->>'parameterDigest'=b."parameterDigest"
   AND r.kind='FORMAL_SUPPLY_PROPOSAL' AND r.source='FORMAL_RESTAURANT' AND r.state='RESOLVED'
   AND r.payload->>'supplyId'=NEW.id
   AND r.payload->>'proposalDigest'=NEW.snapshot->>'proposalDigest'
   AND a.metadata->>'supplyDigest'=NEW.digest
 ) THEN RAISE EXCEPTION 'Formal supply requires restaurant proposal and platform approval provenance'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER v11_formal_supply_provenance_required AFTER INSERT ON "V11SupplyRevision"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v11_formal_supply_provenance_required();

CREATE FUNCTION v11_formal_consent_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.source LIKE 'FORMAL_USER_DELIVERY:%' OR NEW.source LIKE 'FORMAL_USER_DELIVERY:%' THEN
  RAISE EXCEPTION 'Formal consent is immutable and cannot be promoted from another source';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v11_formal_consent_immutable BEFORE UPDATE ON "V11BundleConsent"
FOR EACH ROW EXECUTE FUNCTION v11_formal_consent_immutable();
CREATE FUNCTION v11_formal_consent_provenance_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.source LIKE 'FORMAL_USER_DELIVERY:%' AND NOT EXISTS (
  SELECT 1 FROM "V11Request" r JOIN "V11PolicySnapshot" p ON p.id=NEW."policyId"
   JOIN "AuditLog" a ON a."targetId"=NEW.id AND a.action='policy.v11-formal-consent'
  WHERE r.id=substring(NEW.source FROM length('FORMAL_USER_DELIVERY:')+1)
   AND r.kind='FORMAL_POLICY_DELIVERY' AND r.source='FORMAL_BUSINESS_ROUTE' AND r.state='DELIVERED'
   AND r."userId"=NEW."userId" AND r.payload->>'policyId'=p.id AND p.status='FORMAL_RUNTIME'
   AND r.payload->>'policyDigest'=p."bundleDigest"
   AND r.payload->'fullHashes'=NEW."documentHashesJson" AND r.payload->'publicHashes'=NEW."publicHashesJson"
   AND a.metadata->>'deliveryId'=r.id AND NEW."acceptedAt">=r."acceptedAt"
 ) THEN RAISE EXCEPTION 'Formal consent requires exact authenticated policy delivery'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER v11_formal_consent_provenance_required AFTER INSERT ON "V11BundleConsent"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v11_formal_consent_provenance_required();
-- Down: drop the four named triggers and functions only in an isolated rehearsal
-- after verifying retained formal supply/consent obligations are absent. Do not
-- rewrite or delete historical policy, supply, consent or request rows.
