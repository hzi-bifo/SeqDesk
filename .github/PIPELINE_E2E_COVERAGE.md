# Pipeline E2E Coverage

CI harnesses that prove SeqDesk's pipelines actually **run and read/write the DB through the app** — not just that the code compiles:

- **SLURM E2E** (`pipeline-slurm-e2e.yml`) — the required private-mirror gate. A mirrored `main` push (plus manual dispatch) validates the matching commit by booting source, performing a fresh **install**, and driving the required lightweight pipelines through the HTTP API in local + real outer-SLURM modes. The public `mirror-to-private` workflow waits for that exact private run and propagates its conclusion; a green public source workflow by itself is not evidence of a green private gate. The install leg boots the exact candidate version from persisted settings, clears the source checkout's pipeline-directory override, and proves each generated launcher targets the installed package tree. If pushes arrive faster than the gate completes, GitHub retains the active run and newest pending state.
- **Alma install E2E** (`install-profile-alma.yml`) — manual extended diagnostics for hosted profiles, private packages, external databases, and real ONT data (the Gemma study).
- **submg E2E** (`pipeline-submg-e2e.yml`) — ENA test-server submission round-trip (GitHub-hosted; needs `ENA_USERNAME`/`ENA_PWD`).
- **Update/rollback E2E** (`update-rollback-e2e-ubuntu.yml`) — in-app update to a new release then rollback, data preserved.

> Keep the table in sync when adding a pipeline or an assertion.

## Coverage

`local·SLURM·install` = canonical source-boot local · real outer-SLURM · installed-app. The canonical workflow uses `SEQDESK_SLURM_INLINE_EXECUTOR=1`: it proves a real `sbatch` allocation with Nextflow running inside it, not native per-process Nextflow SLURM scheduling. Every required SLURM run must also have an accounting row for the exact job id with a `seqdesk-*` name, a WorkDir beneath that run, state `COMPLETED`, exit `0:0`, and a non-empty allocated node.

| Pipeline | local·SLURM·install | Note |
| --- | --- | --- |
| **fastq-checksum** | ✅·✅·✅ hard | md5 round-trip (R1 + R2) |
| **study-demo-report** | ✅·✅·✅ hard | report artifacts + config→output |
| **fastqc** | ✅·✅·✅ hard | summary artifact/content + complete read-field writeback |
| **multiqc** | ✅·✅·✅ hard | prior FastQC/NanoPlot artifacts staged into a combined report |
| **nanoplot** | ✅·✅·✅ hard | long-read statistics artifact/content |
| **reads-qc** | ✅·✅·✅ hard | completion + output gate |
| **simulate-reads** | ✅·✅·✅ hard | summary/config assertion + replace writeback |
| **read-cleaning** | ⚠️·⚠️·— | conditional on DB/node capacity; failures surface as an optional-step warning |
| **metaxpath** | —·—·— | extended manual Alma matrix |
| **mag** | —·—·— | extended manual Alma matrix |
| **submg** | —·🚫·— | separate ENA test-server workflow |

Legend: ✅ covered · ⚠️ warn-only · 🔄 in flight · 📋 planned · — n/a (gap, fixable) · 🚫 not possible (by design).

### Per-pipeline detail

- **read-cleaning** — a manual dispatch of the canonical workflow conditionally runs detaxizer 1.3.0 on `DEV-RC-SPIKE-001` when the external kraken2 DB and ≥24 GB nodes are available. It asserts deterministic contamination removal and runs local + outer-SLURM. The step is explicitly optional because those prerequisites are runner infrastructure, not repository assets; an attempted failure is reported as an optional-step warning.
- **metaxpath** — **Local (extended install): hard gate** — `completes` + trace + taxonomy-content (≥1 taxon from the curated `combined_report`; `SEQDESK_METAXPATH_EXPECT_TAXON` adds a per-organism check). **SLURM (extended install): warn-only, manual-dispatch** (`scripts/metaxpath-slurm-leg.sh`, inline executor). A disabled pipeline is `SKIPPED`, not `OK`; success requires a captured `PipelineRun` with the expected pipeline id, numeric job id, run folder, and resolved Slurm mode. The monitor no longer finalizes from an early completed trace wave: declared steps and the live scheduler/exit marker govern terminal state.
- **mag** — MEGAHIT-only smoke (skips SPAdes/CONCOCT/Prokka/bin-QC/GTDB-Tk to fit the runner); assembly written back. **SLURM: warn-only, manual-dispatch** (`scripts/mag-slurm-leg.sh`, inline executor) — same smoke through Slurm, reusing the metaxpath playbook: caps every process via nf-core's own `--max_cpus 4 --max_memory 40.GB` (inline path skips `resourceLimits`), `-t 2:0:0`, finalizes from the scheduler since the smoke skips steps. It reports `SKIPPED` when disabled and `OK` only for a validated real Slurm `PipelineRun`. **TODO:** promote local to hard; full run needs GTDB staged (`gtdbDb` config) + in-app DB download.
- **submg** — builds the ENA submission from SeqDesk's data **and ingests the response** (`Sample` ERS/SAMEA writeback). SLURM **not possible** (🚫) by design — it is a network submission to ENA from the login/head node; the offline compute nodes cannot reach the internet and there is nothing to pre-build. Synthetic contract legs explicitly label their assembly source. The real public-read leg runs MEGAHIT and now fails if the binary fails or no valid contig is produced; it never silently substitutes a synthetic FASTA or records synthetic output as a completed MAG run. Credentialed reads/assembly submission remains warn-only until stable. Run with `-f submit_reads=true -f submit_assembly=true`. **TODO:** promote reads+assembly to hard once stable.

## TODO — what "well-integrated" requires end-to-end

"The pipeline ran" is not enough. Each pipeline should prove, **through the app**, every dimension below. This is the plan to get the whole matrix there.

1. **Runs through the app, both modes** — local + outer-SLURM via the HTTP API (#SBATCH directives + real `sacct` job id). — ✅ the five canonical core pipelines; external/private pipelines are listed separately above.
2. **DB writeback ingested** — outputs land on the right rows (checksums / read fields / artifacts / accessions), re-read after a `/sync` to ride out the dual-writer race. — ✅ where covered.
3. **Output-content correctness** — download the produced file through the app and match a real marker (report `<h1>`, TSV header, accession), not just "a row exists". — ✅ fastqc, study-demo-report, submg, read-cleaning (cleaned-reads API **+ deterministic contamination-removal count** on the spiked `DEV-RC-SPIKE-001`: raw 60 → cleaned ~30, removed ~30/sample), metaxpath (**taxonomy-content** — ≥1 taxon from the curated `combined_report`).
4. **Installed-app (facility) flow** — build a candidate tarball, pack/install the npm launcher, create and migrate a fresh DB, assert the persisted enable/data/run/database/direct-URL/port/Conda/SLURM settings, apply a local facility profile, boot/authenticate, and run the core matrix from the installed pipeline packages. — ✅ required on each mirrored `main`. The installed leg starts with an empty per-install Nextflow Conda cache; Conda-backed pipelines run locally once to populate it before the offline compute node performs the outer-SLURM run. This validates the facility warm-up path, not an unprimed first SLURM run. It uses `--no-pm2` and a local release endpoint, so PM2/system-service wiring and the public download endpoint remain separate release checks.
5. **Managed config flows** — install profile / in-app DB manager writes `PipelineConfig.config.<key>`. — ✅ profile application is asserted, and `kraken2Db` persistence is checked when the external database is staged. **TODO:** prove that an installed pipeline consumes the managed `kraken2Db` at run time; `gtdbDb` (mag); in-app DB-download button.
6. **App-feature resilience** — failure→`failed`, cancel→`cancelled`, stuck-run reconcile via `/sync`, empty input→clean 400, owner/permission 403·401, `pipeline.completed` notification, artifact/log retrieval. — ✅ source-boot **and** installed app (the resilience scripts run against both).
7. **Promote optional → hard gates** only after their runner prerequisites are guaranteed — read-cleaning, mag, submg, and the MetaxPath/MAG extended legs are exercised manually until then.
8. **Researcher data lifecycle** — order → samples → file → study via the installed app's API. — ⚠️ warn-only (`scripts/researcher-lifecycle-e2e.mjs`, install-with-profile job — the file upload needs the configured sequencing `dataBasePath`). Two-actor: a RESEARCHER creates an order, adds samples, submits it, creates a study and joins the samples; a FACILITY_ADMIN attaches a reads file (the `sequencing/*` surface is admin-only) via the resumable upload trio — then the file rolls up into the study (`samplesWithReads ≥ 1`). Read-back asserted through the app API at every step. **TODO:** promote to hard once green across a few runs.
9. **Software update + rollback** — install-unique. — ✅ `update-rollback-e2e-ubuntu.yml` drives `/api/admin/updates/install` + `/rollback` (data preserved).

### Adding a pipeline to the matrix

Add it to `STUDY_SCOPED_PIPELINES` (if study-scoped) + a `WRITEBACK_SPEC` entry (`checksum`/`replace`/`artifacts`/`completes`) in `scripts/run-pipeline-runtime-e2e.mjs`; add a workflow step + a `run_installed` line; enable it in the install profile; stage any external DB and point the profile at it; flip its row to covered once green.

### Finalization invariant

A run cannot become `completed` until all declared run-scoped outputs are discovered and output resolution succeeds. Missing summaries or failed DB writebacks leave the run in `Finalizing outputs...` for an idempotent retry. The canonical FastQC and simulate-reads assertions are hard failures; they never warn-and-skip missing integration data.

### Runner isolation invariant

Cleanup resolves every non-empty queue id from each temporary CI database regardless of the recorded terminal status, then verifies the exact local `run.sh` process-group identity or exact SLURM `JobName` + `WorkDir` before signalling. Process-table, scheduler, and controller query failures are an explicit unknown state, never evidence that a process or allocation ended. Startup drains all active states from prior canonical runs only after snapshotting and revalidating their canonical run-folder identity. The source pipeline packages and manual canary directories are run-unique, no extended Alma leg uses account-wide or before/after queue cancellation, and shared Alma roots are never pruned by age. Cleanup waits for every database-recorded job and monitor before deleting that run's trees; if identity or termination cannot be proven, a guard preserves the database and trees and fails cleanup. Uploaded diagnostics remain restricted to `seqdesk-*` accounting records under this run's source or installed run root.
