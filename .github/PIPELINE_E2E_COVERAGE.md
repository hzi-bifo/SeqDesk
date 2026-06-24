# Pipeline E2E Coverage

CI harnesses that prove SeqDesk's pipelines actually **run and read/write the DB through the app** — not just that the code compiles:

- **SLURM E2E** (`pipeline-slurm-e2e.yml`) — source-boot + a fresh **install**, driven through the HTTP API in **local + SLURM** modes, DB writeback + app-resilience asserted.
- **Alma install E2E** (`install-profile-alma.yml`) — real npm-launcher install + hosted profile, on real ONT data (the Gemma study).
- **submg E2E** (`pipeline-submg-e2e.yml`) — ENA test-server submission round-trip (GitHub-hosted; needs `ENA_USERNAME`/`ENA_PWD`).
- **Update/rollback E2E** (`update-rollback-e2e-ubuntu.yml`) — in-app update to a new release then rollback, data preserved.

> Keep the table in sync when adding a pipeline or an assertion.

## Coverage

`local·SLURM·install` = source-boot local · SLURM · installed-app (Alma). `hard` = hard gate.

| Pipeline | local·SLURM·install | Note |
| --- | --- | --- |
| **fastq-checksum** | ✅·✅·✅ | md5 round-trip (R1 + R2) |
| **study-demo-report** | ✅·✅·✅ | report artifacts + config→output |
| **fastqc** | ✅·✅·✅ | QC artifacts + read-field writeback |
| **reads-qc** | ✅·✅·✅ | `completes` gate |
| **simulate-reads** | ✅·✅·✅ | replace writeback (new active `Read`) |
| **read-cleaning** | ✅·—·✅ hard | detaxizer; spike-count hard gate |
| **metaxpath** | —·✅·✅ hard | 35 taxa; SLURM green (warn-only) |
| **mag** | —·✅·⚠️ | MEGAHIT smoke; SLURM green (warn-only) |
| **submg** | ✅·🚫·✅ | ENA submission round-trip |

Legend: ✅ covered · ⚠️ warn-only · 🔄 in flight · 📋 planned · — n/a (gap, fixable) · 🚫 not possible (by design).

### Per-pipeline detail

- **read-cleaning** — detaxizer 1.3.0 on raw minigut reads (`DEV-MAG-ILMN-001`), kraken2-DB-gated (`SLURM_SHARED_KRAKEN2_DB`; absent → skipped). The full detaxizer run lives on the install path (the 20 GB kraken2 DB is staged only there), so source-boot SLURM is `—`. The `/cleaned-reads` API ingests ≥1 candidate. Three SeqDesk fixes: (1) `NXF_SYNTAX_PARSER=v1` (Nextflow 24.10 v2 parser rejects detaxizer's older subworkflow); (2) **kraken2 DB as a `.tar`** — detaxizer untars `--kraken2db`, so the harness packs the staged DB dir into a cached `.tar` (the path-validation that wrongly required a *directory* is corrected to require the archive); (3) the `/cleaned-reads` ingestion assertion. **Hard gate** = the deterministic spike-count proof on `DEV-RC-SPIKE-001` (3 samples × 30 human-mt + 30 E. coli → raw 60 → cleaned ~30, removed ~30; `SEQDESK_RUNTIME_E2E_RC_SPIKE_CHECK`, PR #33); the real-data minigut leg (≥1 candidate) stays warn-only. Manual-dispatch `subsample_reads=0.1` shrinks the matrix to ~1 h for fast iteration.
- **metaxpath** — **Local (install): hard gate** — `completes` + trace + taxonomy-content (≥1 taxon from the curated `combined_report`; `SEQDESK_METAXPATH_EXPECT_TAXON` adds a per-organism check). **SLURM (install): green, warn-only, manual-dispatch** (`scripts/metaxpath-slurm-leg.sh`, inline executor) — full 13-step DAG on the cluster (36 tasks, 35 taxa, finalized via the scheduler). Three SeqDesk fixes got it green: (1) the SLURM time limit is in **HOURS** (inline wrapper writes `#SBATCH -t <N>:0:0`), so `60` meant 60 h → PENDING with `(PartitionTimeLimit)`; use `2`. (2) the inline executor skips `process.resourceLimits`, so raw `cpus` hits the sbatch cgroup — `cpus={params.threads}=20` was rejected in a `-c 2` job; cap via `-c 4` + `--config-json {"threads":4,…}`. (3) the pipeline-monitor false-completed after the 2-of-13 input-prep wave; fixed by requiring all defined steps for SLURM runs (`completedSteps>=totalSteps`, scoped to SLURM so local runs keep their ingesting path). Warn-only because the inline job is single-node over the network FS; the local run stays canonical.
- **mag** — MEGAHIT-only smoke (skips SPAdes/CONCOCT/Prokka/bin-QC/GTDB-Tk to fit the runner); assembly written back. **SLURM: green, warn-only, manual-dispatch** (`scripts/mag-slurm-leg.sh`, inline executor) — same smoke through SLURM, reusing the metaxpath playbook: caps every process via nf-core's own `--max_cpus 4 --max_memory 40.GB` (inline path skips `resourceLimits`), `-t 2:0:0`, finalizes from the scheduler since the smoke skips steps. **TODO:** promote local to hard; full run needs GTDB staged (`gtdbDb` config) + in-app DB download.
- **submg** — builds the ENA submission from SeqDesk's data **and ingests the response** (`Sample` ERS/SAMEA writeback). SLURM **not possible** (🚫) by design — it's a network submission to ENA from the login/head node; the offline compute nodes can't reach the internet and there's nothing to pre-build. A warn-only leg does the full **samples→reads→assembly** round-trip from a simulated mag assembly (writes back ERS/ERR/ERZ). **TODO:** promote reads+assembly to hard once stable.

## TODO — what "well-integrated" requires end-to-end

"The pipeline ran" is not enough. Each pipeline should prove, **through the app**, every dimension below. This is the plan to get the whole matrix there.

1. **Runs through the app, both modes** — local + SLURM via the HTTP API (#SBATCH directives + real `sacct` job id for SLURM). — ✅ all source-boot pipelines (submg: SLURM n/a).
2. **DB writeback ingested** — outputs land on the right rows (checksums / read fields / artifacts / accessions), re-read after a `/sync` to ride out the dual-writer race. — ✅ where covered.
3. **Output-content correctness** — download the produced file through the app and match a real marker (report `<h1>`, TSV header, accession), not just "a row exists". — ✅ fastqc, study-demo-report, submg, read-cleaning (cleaned-reads API **+ deterministic contamination-removal count** on the spiked `DEV-RC-SPIKE-001`: raw 60 → cleaned ~30, removed ~30/sample), metaxpath (**taxonomy-content** — ≥1 taxon from the curated `combined_report`).
4. **Installed-app (facility) flow** — install via npm launcher, apply a profile, run the same matrix on the installed instance. — ✅ SLURM matrix + submg; the **Alma install** runs metaxpath + mag + read-cleaning on the installed app (hosted profile, real + spiked data).
5. **Managed config flows** — install profile / in-app DB manager writes `PipelineConfig.config.<key>`, asserted persisted **and** applied at run time. — ✅ `kraken2Db`. **TODO:** `gtdbDb` (mag); in-app DB-download button.
6. **App-feature resilience** — failure→`failed`, cancel→`cancelled`, stuck-run reconcile via `/sync`, empty input→clean 400, owner/permission 403·401, `pipeline.completed` notification, artifact/log retrieval. — ✅ source-boot **and** installed app (the resilience scripts run against both).
7. **Promote warn-only → hard gates** once green across a few scheduled runs — read-cleaning's real-data minigut leg (its spike count proof is already hard), mag (local), submg (reads+assembly), and the new **metaxpath + mag SLURM legs** (both green on the install path; keep warn-only until stable across several manual dispatches, then gate).
8. **Researcher data lifecycle** — order → samples → file → study via the installed app's API. — **TODO** (uncovered).
9. **Software update + rollback** — install-unique. — ✅ `update-rollback-e2e-ubuntu.yml` drives `/api/admin/updates/install` + `/rollback` (data preserved).

### Adding a pipeline to the matrix

Add it to `STUDY_SCOPED_PIPELINES` (if study-scoped) + a `WRITEBACK_SPEC` entry (`checksum`/`replace`/`artifacts`/`completes`) in `scripts/run-pipeline-runtime-e2e.mjs`; add a workflow step + a `run_installed` line; enable it in the install profile; stage any external DB and point the profile at it; flip its row to covered once green.

### Known flake (mitigated)

When the pipeline-monitor (not `/sync`) finalizes a run, the run-scoped summary row + per-read `readCount/avgQuality` merge sometimes don't ingest — those checks **warn+skip** on a wholesale miss rather than red the suite.
