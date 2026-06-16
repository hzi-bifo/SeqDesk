# Pipeline E2E Coverage

CI harnesses that prove SeqDesk's pipelines actually **run and read/write the DB through the app** — not just that the code compiles:

- **SLURM E2E** (`pipeline-slurm-e2e.yml`) — source-boot + a fresh **install**, driven through the HTTP API in **local + SLURM** modes, DB writeback + app-resilience asserted.
- **Alma install E2E** (`install-profile-alma.yml`) — real npm-launcher install + hosted profile, on real ONT data (the Gemma study).
- **submg E2E** (`pipeline-submg-e2e.yml`) — ENA test-server submission round-trip (GitHub-hosted; needs `ENA_USERNAME`/`ENA_PWD`).
- **Update/rollback E2E** (`update-rollback-e2e-ubuntu.yml`) — in-app update to a new release then rollback, data preserved.

> Keep the table in sync when adding a pipeline or an assertion.

## Coverage

| Pipeline | Source-boot (local / SLURM) | Installed app | Status / TODO |
| --- | --- | --- | --- |
| **fastq-checksum** | ✅ / ✅ | ✅ SLURM + local | `Read.checksum1/2` md5 round-trip (R1 + R2) |
| **study-demo-report** | ✅ / ✅ | ✅ SLURM | report artifacts + config→output |
| **fastqc** | ✅ / ✅ | ✅ SLURM | QC artifacts + read-field writeback |
| **reads-qc** | ✅ / ✅ | ✅ SLURM | `completes` gate |
| **simulate-reads** | ✅ / ✅ | ✅ SLURM + local | replace writeback (new active `Read`) |
| **read-cleaning** | ⚠️ / — | ⚠️ Alma | detaxizer 1.3.0 on raw minigut reads (`DEV-MAG-ILMN-001`), kraken2-DB-gated (`SLURM_SHARED_KRAKEN2_DB`; absent → skipped). Needs `NXF_SYNTAX_PARSER=v1` (Nextflow 24.10 v2 parser rejects detaxizer's subworkflow); asserts the `/cleaned-reads` API ingested ≥1 candidate. **TODO:** promote to hard; hosted spiked dataset (`scripts/build-read-cleaning-fixture.mjs`) for a deterministic contamination-removal *count* |
| **metaxpath** | — | ✅ Alma (hard) | `completes` + trace shows real classification. **TODO:** enforce taxonomy-content once metaxpath (private pkg) curates a `combined_report` artifact |
| **mag** | — | ⚠️ Alma | MEGAHIT-only smoke (skips SPAdes/CONCOCT/Prokka/bin-QC/GTDB-Tk to fit the runner); assembly written back. **TODO:** promote to hard; full run needs GTDB staged (`gtdbDb` config) + in-app DB download |
| **submg** | ✅ local (own wf) / — | ✅ installed (own wf) | SeqDesk builds the ENA submission from its data **and ingests the response** (`Sample` ERS/SAMEA writeback). SLURM n/a (network). A warn-only leg does the full **samples→reads→assembly** round-trip from a simulated mag assembly (writes back ERS/ERR/ERZ); the runner normalizes `order.instrumentModel` → ENA vocab. **TODO:** promote reads+assembly to hard once stable |

Legend: ✅ covered · ⚠️ warn-only · 🔄 in flight · 📋 planned (blocked) · — n/a.

## TODO — what "well-integrated" requires end-to-end

"The pipeline ran" is not enough. Each pipeline should prove, **through the app**, every dimension below. This is the plan to get the whole matrix there.

1. **Runs through the app, both modes** — local + SLURM via the HTTP API (#SBATCH directives + real `sacct` job id for SLURM). — ✅ all source-boot pipelines (submg: SLURM n/a).
2. **DB writeback ingested** — outputs land on the right rows (checksums / read fields / artifacts / accessions), re-read after a `/sync` to ride out the dual-writer race. — ✅ where covered.
3. **Output-content correctness** — download the produced file through the app and match a real marker (report `<h1>`, TSV header, accession), not just "a row exists". — ✅ fastqc, study-demo-report, submg, read-cleaning (cleaned-reads API). **TODO:** metaxpath taxonomy-content (needs curated `combined_report`); read-cleaning contamination-removal *count* (needs spiked dataset).
4. **Installed-app (facility) flow** — install via npm launcher, apply a profile, run the same matrix on the installed instance. — ✅ SLURM matrix + submg. **TODO:** read-cleaning / mag full runs.
5. **Managed config flows** — install profile / in-app DB manager writes `PipelineConfig.config.<key>`, asserted persisted **and** applied at run time. — ✅ `kraken2Db`. **TODO:** `gtdbDb` (mag); in-app DB-download button.
6. **App-feature resilience** — failure→`failed`, cancel→`cancelled`, stuck-run reconcile via `/sync`, empty input→clean 400, owner/permission 403·401, `pipeline.completed` notification, artifact/log retrieval. — ✅ source-boot **and** installed app (the resilience scripts run against both).
7. **Promote warn-only → hard gates** once green across a few scheduled runs — read-cleaning, mag, submg (reads+assembly).
8. **Researcher data lifecycle** — order → samples → file → study via the installed app's API. — **TODO** (uncovered).
9. **Software update + rollback** — install-unique. — ✅ `update-rollback-e2e-ubuntu.yml` drives `/api/admin/updates/install` + `/rollback` (data preserved).

### Adding a pipeline to the matrix

Add it to `STUDY_SCOPED_PIPELINES` (if study-scoped) + a `WRITEBACK_SPEC` entry (`checksum`/`replace`/`artifacts`/`completes`) in `scripts/run-pipeline-runtime-e2e.mjs`; add a workflow step + a `run_installed` line; enable it in the install profile; stage any external DB and point the profile at it; flip its row to covered once green.

### Known flake (mitigated)

When the pipeline-monitor (not `/sync`) finalizes a run, the run-scoped summary row + per-read `readCount/avgQuality` merge sometimes don't ingest — those checks **warn+skip** on a wholesale miss rather than red the suite.
