-- AlterTable
ALTER TABLE "ExploreAnalysis" ADD COLUMN "slug" TEXT;

-- Every step gets the slug the page would have derived from its name; duplicates within a report get _2, _3, ...
WITH ranked AS (
  SELECT
    "id",
    coalesce(nullif(trim(both '_' from regexp_replace(lower("name"), '[^a-z0-9]+', '_', 'g')), ''), 'step') AS base,
    row_number() OVER (
      PARTITION BY "reportId", coalesce(nullif(trim(both '_' from regexp_replace(lower("name"), '[^a-z0-9]+', '_', 'g')), ''), 'step')
      ORDER BY "createdAt"
    ) AS n
  FROM "ExploreAnalysis"
)
UPDATE "ExploreAnalysis" a
SET "slug" = CASE WHEN r.n = 1 THEN r.base ELSE r.base || '_' || r.n END
FROM ranked r
WHERE a."id" = r."id";
