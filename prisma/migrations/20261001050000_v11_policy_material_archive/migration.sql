-- Expand only. This archive cannot activate or replace the existing draft policy.
CREATE TABLE "V11PolicyMaterialArchive" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "materialSha256" TEXT NOT NULL,
  "bundleId" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "releaseVersion" TEXT NOT NULL,
  "inheritedBaselineHash" TEXT NOT NULL,
  "rawMaterial" TEXT NOT NULL,
  "scope" TEXT NOT NULL DEFAULT 'MATERIAL_ONLY',
  "submittedBy" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "V11PolicyMaterialArchive_material_only" CHECK ("scope" = 'MATERIAL_ONLY'),
  CONSTRAINT "V11PolicyMaterialArchive_digest_format" CHECK ("materialSha256" ~ '^[a-f0-9]{64}$' AND "inheritedBaselineHash" ~ '^[a-f0-9]{64}$'),
  CONSTRAINT "V11PolicyMaterialArchive_size_limit" CHECK (octet_length("rawMaterial") BETWEEN 1 AND 4194304),
  CONSTRAINT "V11PolicyMaterialArchive_submittedBy_fkey" FOREIGN KEY ("submittedBy") REFERENCES "V11Actor"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "V11PolicyMaterialArchive_materialSha256_key" ON "V11PolicyMaterialArchive"("materialSha256");
CREATE UNIQUE INDEX "V11PolicyMaterialArchive_bundleId_version_releaseVersion_key" ON "V11PolicyMaterialArchive"("bundleId", "version", "releaseVersion");
CREATE FUNCTION v11_policy_material_archive_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Policy material archive is immutable' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER v11_policy_material_archive_immutable
  BEFORE UPDATE OR DELETE ON "V11PolicyMaterialArchive"
  FOR EACH ROW EXECUTE FUNCTION v11_policy_material_archive_immutable();
