-- Promote only provenance-backed imports from this branch's earlier schema.
-- No files, primary study assignments, access rules, or facility orders move.
DO $$
DECLARE
  entry RECORD;
  provenance JSONB;
  container_id TEXT;
  container_owner TEXT;
  container_origin TEXT;
BEGIN
  FOR entry IN
    SELECT s."id", s."customFields", st."userId", st."title"
    FROM "Sample" s JOIN "Study" st ON st."id" = s."studyId"
    WHERE s."orderId" IS NULL AND s."id" LIKE 'imported-sample-%'
      AND s."facilityStatus" = 'NOT_APPLICABLE'
      AND EXISTS (SELECT 1 FROM "Read" r WHERE r."sampleId" = s."id" AND r."dataClassSource" = 'external_import')
  LOOP
    BEGIN
      provenance := entry."customFields"::JSONB;
    EXCEPTION WHEN invalid_text_representation THEN
      RAISE NOTICE 'Import % has invalid provenance; left unchanged', entry."id";
      CONTINUE;
    END;
    IF provenance->>'sourceType' NOT IN ('cami-benchmark', 'ena-fastq-accession')
       OR COALESCE(provenance->>'dataset', '') = '' THEN
      CONTINUE;
    END IF;
    IF provenance->>'sourceType' IS NULL THEN CONTINUE; END IF;
    -- Matches scientificRecordId("data", userId, sourceType, dataset) exactly.
    container_id := 'imported-data-' || LEFT(encode(sha256(convert_to(
      '[' || to_json(entry."userId")::TEXT || ',' || to_json(provenance->>'sourceType')::TEXT || ',' || to_json(provenance->>'dataset')::TEXT || ']', 'UTF8'
    )), 'hex'), 40);
    INSERT INTO "Order" ("id", "orderNumber", "name", "userId", "dataOrigin", "status", "sourceMetadata", "updatedAt")
      VALUES (container_id, 'IMP-' || RIGHT(container_id, 40), entry."title", entry."userId", 'import', 'COMPLETED',
        jsonb_build_object('sourceType', provenance->>'sourceType', 'sourceKey', provenance->>'dataset', 'imported', true)::TEXT, CURRENT_TIMESTAMP)
      ON CONFLICT ("id") DO NOTHING;
    SELECT "userId", "dataOrigin" INTO container_owner, container_origin FROM "Order" WHERE "id" = container_id;
    IF container_owner IS DISTINCT FROM entry."userId" OR container_origin IS DISTINCT FROM 'import' THEN
      RAISE EXCEPTION 'Legacy import container ownership conflict';
    END IF;
    UPDATE "Sample" SET "orderId" = container_id WHERE "id" = entry."id" AND "orderId" IS NULL;
  END LOOP;
END $$;
