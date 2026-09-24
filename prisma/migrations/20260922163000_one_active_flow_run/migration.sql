-- Enforce the existing one-active-run contract across processes and tabs.
CREATE UNIQUE INDEX IF NOT EXISTS "ExploreAnalysisRun_one_active_per_analysis"
ON "ExploreAnalysisRun" ("analysisId") WHERE "status" IN ('pending', 'queued', 'running');
