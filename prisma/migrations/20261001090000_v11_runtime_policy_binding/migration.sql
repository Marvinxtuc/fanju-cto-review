CREATE TABLE "V11RuntimePolicyBinding" (
 "id" TEXT NOT NULL PRIMARY KEY,
 "policyId" TEXT NOT NULL REFERENCES "V11PolicySnapshot"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "archiveId" TEXT NOT NULL REFERENCES "V11PolicyMaterialArchive"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
 "environment" TEXT NOT NULL CHECK ("environment" IN ('PRODUCTION','ISOLATED_TEST')),
 "releaseVersion" TEXT NOT NULL,
 "parameterRaw" TEXT NOT NULL,
 "parameterDigest" TEXT NOT NULL CHECK ("parameterDigest" ~ '^[a-f0-9]{64}$'),
 "authorityRaw" TEXT NOT NULL,
 "authoritySignature" TEXT NOT NULL,
 "authorityDigest" TEXT NOT NULL CHECK ("authorityDigest" ~ '^[a-f0-9]{64}$'),
 "issuerId" TEXT NOT NULL,
 "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "V11RuntimePolicyBinding_policyId_key" ON "V11RuntimePolicyBinding"("policyId");
CREATE FUNCTION v11_runtime_policy_binding_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Runtime policy binding is immutable'; END; $$;
CREATE TRIGGER v11_runtime_policy_binding_immutable BEFORE UPDATE OR DELETE ON "V11RuntimePolicyBinding"
FOR EACH ROW EXECUTE FUNCTION v11_runtime_policy_binding_immutable();
-- Keep the draft boundary, add a new provenance-bound runtime record rather than
-- promoting any existing draft. Migration alone creates no runtime policies.
ALTER TABLE "V11PolicySnapshot" DROP CONSTRAINT "V11PolicySnapshot_no_activation";
ALTER TABLE "V11PolicySnapshot" ADD CONSTRAINT "V11PolicySnapshot_no_activation" CHECK (
 "status"='LOCAL_DRAFT' OR ("status"='FORMAL_RUNTIME'
 AND "docsJson"->>'scope'='FORMAL_RUNTIME_POLICY'
 AND "docsJson"->>'environment' IN ('PRODUCTION','ISOLATED_TEST')
 AND "bundleVersion" NOT LIKE 'SIMULATION_ONLY:%') IS TRUE);
CREATE FUNCTION v11_runtime_policy_snapshot_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD."status"='FORMAL_RUNTIME' OR NEW."status" IS DISTINCT FROM OLD."status" THEN
  RAISE EXCEPTION 'Existing policy cannot be promoted or changed after runtime assembly';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER v11_runtime_policy_snapshot_guard BEFORE UPDATE ON "V11PolicySnapshot"
FOR EACH ROW EXECUTE FUNCTION v11_runtime_policy_snapshot_guard();
CREATE FUNCTION v11_runtime_policy_binding_required() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW."status"='FORMAL_RUNTIME' AND NOT EXISTS (
  SELECT 1 FROM "V11RuntimePolicyBinding" b WHERE b."policyId"=NEW."id"
   AND b."environment"=NEW."docsJson"->>'environment'
   AND b."authorityRaw"::jsonb->>'scope'='FORMAL_ACTION_AUTHORITY'
   AND b."authorityRaw"::jsonb->>'policyDigest'=NEW."bundleDigest"
   AND b."authorityRaw"::jsonb->>'parameterDigest'=b."parameterDigest"
   AND b."authorityRaw"::jsonb->'actions' ? 'POLICY_RUNTIME'
 ) THEN RAISE EXCEPTION 'Runtime policy requires independent action provenance'; END IF;
 RETURN NEW;
END; $$;
CREATE CONSTRAINT TRIGGER v11_runtime_policy_binding_required AFTER INSERT ON "V11PolicySnapshot"
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION v11_runtime_policy_binding_required();
-- Isolated rollback: only after confirming no retained runtime policy/obligation
-- depends on these records. Restore draft-only constraint only when no runtime
-- snapshots remain. Drop the three named snapshot trigger/functions before
-- dropping binding table/function. No CASCADE; see implementation note.
