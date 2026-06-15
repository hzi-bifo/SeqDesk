# Pipeline E2E Coverage

Two self-hosted CI harnesses prove SeqDesk's pipelines actually **run and read/write the DB** — not just that the code compiles:

- **SLURM E2E** (`.github/workflows/pipeline-slurm-e2e.yml`) — boots the app from source against a local Postgres, drives pipelines through the HTTP API in **local + SLURM** modes, asserts DB writeback. It then **installs SeqDesk fresh** (own DB on the shared FS, profile applied) and re-runs the matrix on that *installed* app — the realistic facility flow.
- **Alma install E2E** (`install-profile-alma.yml`) — real install via the npm launcher + hosted profile, runs pipelines on real ONT data (the Gemma study).

> Keep the table below in sync when adding a pipeline or an assertion.

## Coverage

| Pipeline | Source-boot (local / SLURM) | Installed app | Status / blocker |
| --- | --- | --- | --- |
| **fastq-checksum** | ✅ / ✅ | ✅ SLURM + local | covered — `Read.checksum1/2` md5 round-trip (R1 + R2) |
| **study-demo-report** | ✅ / ✅ | ✅ SLURM | covered — report `PipelineArtifact` rows + config→output |
| **fastqc** | ✅ / ✅ | ✅ SLURM | covered — QC artifacts + read-field writeback |
| **reads-qc** | ✅ / ✅ | ✅ SLURM | covered — `completes` gate (the `completed→running` flip is fixed, `a7186aa`) |
| **simulate-reads** | ✅ / ✅ | ✅ SLURM + local | covered — new active `Read` (replace); fixed a fragile entry-point guard that skipped `main()` under symlinked installs |
| read-cleaning | ⚠️ / — | 📋 planned | managed kraken2 DB **asserted applied** on the installed app; full run needs a **hosted raw spiked dataset** (`scripts/build-read-cleaning-fixture.mjs`) |
| metaxpath | — | ✅ Alma (**hard** `completes`) | private package; ~3-min classification on the Gemma study (skips if not enabled). A **taxonomy-content** proof (≥3 taxa in the top-50 report; + `SEQDESK_METAXPATH_EXPECT_TAXON` for the known organism) is wired but **warns** for now — metaxpath exposes no curated run artifacts, so its report isn't reachable via the app; enforces automatically once it curates `combined_report` |
| mag | — | 📋 planned | needs **GTDB** staged on the shared FS |
| submg | — | 📋 planned | needs **ENA test-server** credentials |

Legend: ✅ covered · ⚠️ warn-only · 🔄 fix in flight · 📋 planned (blocked) · — n/a.

## Key details

- **What every run asserts:** the pipeline completes and produces outputs; DB state `status=completed` / `completedAt` / `progress=100` (re-fetched after a sync to ride out the dual-writer race); and the DB **writeback** appropriate to the pipeline (checksums / read fields / artifacts) — *ingested*, not just on disk. SLURM also asserts `#SBATCH` directives + a real `sacct` job id.
- **Install-once, run-many:** the SLURM E2E installs a fresh release (own DB created as the `postgres` superuser, data/run dirs on `/net/broker`, SLURM + conda configured), applies an install profile via `apply-install-profile.mjs` (the managed `kraken2Db` is **asserted persisted** on the installed app), then runs the matrix on the installed app. **Warn-only** (`continue-on-error`) until stable across a few scheduled runs, then promote to a hard gate.
- **Managed config = one key:** `PipelineConfig.config.<key>` (e.g. `kraken2Db` → `--kraken2db`), written by **either** the install profile **or** the in-app pipeline DB manager, merged as `registry default < PipelineConfig row < per-run override` (the per-run field auto-hides once a facility pins it). The E2E drives it via the profile, not the per-run `--config-json` override production hides.
- **SLURM topology (CI):** runner + compute nodes share **only** a cluster FS (`/home` is per-node), so run dir / data / conda env / pipelines all live there; the conda env is referenced by **full prefix path**. QOS caps the user to **1 job**, so runs use the **inline executor** (`SEQDESK_SLURM_INLINE_EXECUTOR=1` — Nextflow's local executor inside one sbatch). No weblog (compute nodes can't reach the app), so output resolves via the **`/sync` API**.
- **App-feature coverage (beyond "the pipeline ran"):** failure → DB `failed`; stop/cancel → `scancel` → `cancelled`; stuck-run reconciliation via `/sync`; no-data/empty-order rejected with a clean 400; run visibility/permissions (403/401 for non-owners); `pipeline.completed` notifications; artifact/log retrieval (real bytes); output-content correctness (report `<h1>`, TSV headers).

## Roadmap — install-harness, "everything a user can do"

Grow the install-once/run-many step across the full user workflow (each phase accumulates into the warn-only step):

1. **Every pipeline, both modes** on the installed app — *in progress (5/6; simulate-reads pending)*.
2. **In-app pipeline DB manager** — link/download a kraken2 DB (the post-install config write surface).
3. **Software update + rollback** — install-*unique*; uncovered anywhere today.
4. **Pipeline-ops resilience** (failure / cancel / stuck) on the installed app.
5. **Researcher data lifecycle** (order → samples → file → study) via the installed app's API.

## Adding a pipeline to the matrix

1. If study-scoped, add it to `STUDY_SCOPED_PIPELINES` in `scripts/run-pipeline-runtime-e2e.mjs`.
2. Add a `WRITEBACK_SPEC` entry: `checksum` / `replace` / `artifacts` / `completes` (or extend the run-GET select for read-field writebacks).
3. Add a workflow step (`npm run pipeline:e2e:runtime -- --ensure-dummy-data --pipeline-id <id>`) and a `run_installed` line in the install step; enable it in the install profile's `pipelines.enable`.
4. Stage any external DB on the shared FS and point the install profile at it; flip its row to covered once green.

## Real bugs this suite has caught

Config loader dropping `SEQDESK_CONDA_ENV`; a non-relocatable pipelines dir; `simpleGlob` ignoring literal discovery patterns; the pipeline-monitor not resolving outputs; terminal-run resurrection on trace re-sync; the `completed→running` demote (`forceRunningFromQueue`, fixed `a7186aa`); three install bugs (2G disk preflight, prefix-path conda env `-n`→`-p`, `postgres`-superuser DB create); a nextflow `report.html` abort on run-folder reuse (fixed with `report.overwrite` in the generated config); **simulate-reads producing no reads on every installed app** — its `generate-reads.mjs` entry-point guard string-compared `process.argv[1]`'s URL to `import.meta.url`, which diverge under the symlinked `releases/<version>/` layout, so `main()` silently never ran (now a `realpathSync` compare); and the **Alma E2E running out of disk** on the runner's ~98%-full `/home`, which killed the heavy metaxpath run (`No space left`) — its heavy work dirs now root on the shared `/net/broker` (~138G).

**Known flake (mitigated):** when the pipeline-monitor finalizes a run (not the `/sync` path), the run-scoped summary row + per-read `readCount/avgQuality` merge sometimes don't ingest — so those checks **warn+skip** on a wholesale miss rather than red the suite.
