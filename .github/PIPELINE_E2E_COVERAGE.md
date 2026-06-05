# Pipeline E2E Coverage

What the **Pipeline SLURM E2E** (`.github/workflows/pipeline-slurm-e2e.yml`, self-hosted runner on the private `hzi-bifo/SeqDesk-ci` mirror) actually exercises. The workflow boots a real SeqDesk app against an ephemeral Postgres, seeds dummy data, and drives pipelines through the app's HTTP API in **local** and **SLURM** execution modes, then asserts the database writeback.

> Keep this in sync when adding a pipeline or an assertion. It's the quick answer to "is X tested, and how?"

## Pipeline coverage


| Pipeline              | Local | SLURM | Target | DB writeback asserted                                                        | Failure path | External DB / dataset                        | Status                               |
| --------------------- | ----- | ----- | ------ | ---------------------------------------------------------------------------- | ------------ | -------------------------------------------- | ------------------------------------ |
| **fastq-checksum**    | ✅     | ✅     | order  | `Read.checksum1/2` (merge) **+ md5 round-trip**                              | ✅            | —                                            | **covered**                          |
| **simulate-reads**    | ✅     | ✅     | order  | new active `Read` (replace) + checksum/readCount                             | —            | —                                            | **covered** (runtime local+SLURM; also SLURM smoke) |
| **study-demo-report** | ✅     | ✅     | study  | `PipelineArtifact` rows (`html_report`, `markdown_report`, `sample_summary`) | —            | —                                            | **covered**                          |
| fastqc                | ✅     | 🚫    | order  | `PipelineArtifact` (`summary`, `sample_qc_reports`)                          | —            | per-process `fastqc` conda (compute node has no network) | **local covered**; SLURM blocked |
| reads-qc              | —     | 🚫    | study  | `Read.readCount/avgQuality` + artifacts                                      | —            | per-process `seqkit`/`python` conda (compute node has no network) | planned (local); SLURM blocked |
| read-cleaning         | —     | —     | order  | cleaned reads + artifacts                                                    | —            | **kraken2 DB**                               | planned (needs DB staged)            |
| mag                   | —     | —     | study  | assemblies/bins + artifacts                                                  | —            | **GTDB** (large)                             | planned (needs DB staged)            |
| submg                 | —     | —     | study  | ENA submission result                                                        | —            | ENA upload credentials                       | planned                              |
| metaxpath             | —     | —     | study  | taxonomy/path results                                                        | —            | **MetaXpath DB** (private pipeline)          | planned (needs DB staged)            |


Legend: ✅ asserted · 🚫 blocked by infra (compute node has no conda network) · — not covered yet.

**Open follow-ups:**

- **fastqc — LOCAL covered; SLURM blocked by infra.** fastqc runs **early** (right after the merge-mode fastq-checksum step, so the order still has its original intact reads) with `--skip-slurm`. Resolved along the way:
  - **Fixed (app bug #5):** completed→running resurrection (`runWasTerminal` guard in `pipeline-run-ops-service.ts` + regression test).
  - **Fixed (test robustness):** failure-path restore is now unconditional; `**/work/conda/**` excluded from the artifact upload.
  - **Resolved (data isolation):** the earlier "input didn't exist" failures were contamination from running fastqc *after* simulate-reads (replace) + the failure test churned the shared order. Running fastqc **first**, on intact reads, fixed it — local fastqc now passes and ingests its artifacts.
  - **🚫 Hard infra limit (SLURM):** the per-process `conda create` for `bioconda::fastqc` **hangs on the compute node** (`Collecting package metadata…` → fail) — the compute node has **no outbound network** to conda-forge/bioconda. So SLURM coverage for any conda-tool pipeline is blocked. **Fix:** a shared `conda.cacheDir` on the cluster FS that the runner pre-populates (it has network), so the compute node reuses the prebuilt env instead of fetching — needs app support for a conda-cache-dir setting. Until then, conda-tool pipelines are **local-only** in CI.
- **reads-qc** — same shape (study target; per-process `seqkit`/`python` conda). Local-coverable like fastqc once wired; SLURM blocked by the same compute-node-network limit.

### What every covered run asserts

- The pipeline **runs to completion** on the compute node (SLURM) / runner (local) and produces its output files.
- DB run state: `status='completed'`, `completedAt` set, `progress=100` (re-fetched after a sync + settle to ride out the dual-writer race).
- DB **writeback** appropriate to the pipeline (see table) — i.e. results are *ingested into the database*, not just written to disk.
- SLURM runs additionally: `#SBATCH` directives present, a numeric `sacct` job id, and the node-local SLURM capture logs copied back (NFS-lag tolerant).

### Failure-path coverage

`run-slurm-failure-e2e.mjs` deliberately fails a **fastq-checksum** SLURM run (moves the sample FASTQ aside) and asserts the DB reconciles to `status='failed'` with `completedAt` + a `Failed` marker — the status-reconciliation path that previously got stuck at 99%.

## App-feature coverage (beyond "the pipeline ran")


| Feature                                      | What it proves                                                                                 | Status                     |
| -------------------------------------------- | ---------------------------------------------------------------------------------------------- | -------------------------- |
| Local **and** SLURM execution                | both execution modes through the app                                                           | ✅ covered                  |
| DB writeback (checksums / reads / artifacts) | results ingested, not just files written                                                       | ✅ covered                  |
| md5 round-trip correctness                   | stored checksum == real md5 of the input                                                       | ✅ covered (fastq-checksum) |
| Failure → DB `failed`                        | status reconciliation on a real process failure                                                | ✅ covered                  |
| **Stop / cancel**                            | `DELETE` → `scancel` → DB `cancelled`; `sacct` shows the job CANCELLED                          | ✅ covered                  |
| **Artifact + log retrieval**                 | produced files/logs downloadable via the app's `file`/`logs` endpoints (real bytes)            | ✅ covered                  |
| **statusSource**                             | which path finalized the run — on this cluster it is `queue` (the `/sync` API), not weblog      | ✅ covered                  |
| **Step-level progress**                      | run exposes Nextflow trace steps; every step terminal once completed                            | ✅ covered                  |


## Execution / topology notes (CI-specific)

- The runner and SLURM compute nodes share **only a dedicated cluster filesystem**; `/home` is per-node. The run dir, input data, conda env, and pipeline packages all live on the shared filesystem (configured via the `SLURM_SHARED_*` Actions variables on the private mirror). The conda env is referenced by **full prefix path** (names don't resolve across nodes here).
- QOS caps the user to **1 submitted job**, so pipelines run as a **single SLURM job** with Nextflow's local executor inside (`SEQDESK_SLURM_INLINE_EXECUTOR=1`) rather than one job per process. Real multi-node parallelism (e.g. MAG at scale) needs the admin to raise the QOS limit.
- There is **no weblog block** in the generated `nextflow.config` (compute nodes can't reach the app's loopback), so output resolution runs via the **`/sync` API** and the **pipeline-monitor**, not weblog callbacks. (Confirmed at runtime: `statusSource=queue`.)

## Real bugs this E2E has caught

The suite exists to find app issues, not just to be green. So far it surfaced and fixed:

1. **Config loader dropped `SEQDESK_CONDA_ENV`** — a configured conda env name was silently ignored (default-config `trackSources` gap).
2. **Pipeline packages dir was not relocatable** — Nextflow ran against a path the compute node couldn't see.
3. **`simpleGlob` ignored literal (wildcard-free) discovery patterns** — script-less pipelines ingested **zero artifacts**.
4. **The pipeline-monitor never resolved outputs** — runs finalized by the safety-net daemon (vs the `/sync` API) were marked completed but had **no artifacts/writebacks** persisted.
5. **A terminal run could be resurrected on trace re-sync** — `syncPipelineRunForOperator`'s with-trace branch had no terminal guard, so a re-sync that saw a stale trace task still reading RUNNING (or a momentarily-active queue) flipped a `completed` run back to `running` and nulled its `completedAt`. Same class as the original stuck-at-99% bug.

## Adding a pipeline to the matrix

1. If study-scoped, add it to `STUDY_SCOPED_PIPELINES` in `scripts/run-pipeline-runtime-e2e.mjs`.
2. Add a `WRITEBACK_SPEC` entry: `checksum` (md5 merged onto reads), `replace` (new active read attributed to the run), or `artifacts` (PipelineArtifact rows by outputId) — or extend for read-field writebacks.
3. If its read-field writebacks aren't exposed by the run-GET select (`pipeline-run-ops-service.ts`), extend that select.
4. Add a workflow step: `npm run pipeline:e2e:runtime -- --ensure-dummy-data --pipeline-id <id>` (runs local + SLURM).
5. If the pipeline needs an external DB, stage it on the shared cluster filesystem and point the install profile / env at it; only then flip its row to covered.

