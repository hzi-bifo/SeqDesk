# Pipeline E2E Coverage

What the **Pipeline SLURM E2E** (`.github/workflows/pipeline-slurm-e2e.yml`, self-hosted runner on the private `hzi-bifo/SeqDesk-ci` mirror) actually exercises. The workflow boots a real SeqDesk app against an ephemeral Postgres, seeds dummy data, and drives pipelines through the app's HTTP API in **local** and **SLURM** execution modes, then asserts the database writeback.

> Keep this in sync when adding a pipeline or an assertion. It's the quick answer to "is X tested, and how?"

## Pipeline coverage

| Pipeline | Local | SLURM | Target | DB writeback asserted | Failure path | External DB / dataset | Status |
|---|:---:|:---:|---|---|:---:|---|---|
| **fastq-checksum** | ✅ | ✅ | order | `Read.checksum1/2` (merge) **+ md5 round-trip** | ✅ | — | **covered** |
| **simulate-reads** | — | ✅ | order | new active `Read` (replace) + checksum/readCount | — | — | **covered** (SLURM smoke) |
| **study-demo-report** | ✅ | ✅ | study | `PipelineArtifact` rows (`html_report`, `markdown_report`, `sample_summary`) | — | — | **covered** |
| fastqc | — | — | order | `Read.fastqcReport/readCount/avgQuality` + artifacts | — | — (needs `fastqc` conda tool at runtime) | planned |
| reads-qc | — | — | study | `Read.readCount/avgQuality` + artifacts | — | — (needs `seqkit`/`python` conda at runtime) | planned |
| read-cleaning | — | — | order | cleaned reads + artifacts | — | **kraken2 DB** | planned (needs DB staged) |
| mag | — | — | study | assemblies/bins + artifacts | — | **GTDB** (large) | planned (needs DB staged) |
| submg | — | — | study | ENA submission result | — | ENA upload credentials | planned |
| metaxpath | — | — | study | taxonomy/path results | — | **MetaXpath DB** (private pipeline) | planned (needs DB staged) |

Legend: ✅ asserted · — not covered yet.

### What every covered run asserts
- The pipeline **runs to completion** on the compute node (SLURM) / runner (local) and produces its output files.
- DB run state: `status='completed'`, `completedAt` set, `progress=100` (re-fetched after a sync + settle to ride out the dual-writer race).
- DB **writeback** appropriate to the pipeline (see table) — i.e. results are *ingested into the database*, not just written to disk.
- SLURM runs additionally: `#SBATCH` directives present, a numeric `sacct` job id, and the node-local SLURM capture logs copied back (NFS-lag tolerant).

### Failure-path coverage
`run-slurm-failure-e2e.mjs` deliberately fails a **fastq-checksum** SLURM run (moves the sample FASTQ aside) and asserts the DB reconciles to `status='failed'` with `completedAt` + a `Failed` marker — the status-reconciliation path that previously got stuck at 99%.

## App-feature coverage (beyond "the pipeline ran")

| Feature | What it proves | Status |
|---|---|---|
| Local **and** SLURM execution | both execution modes through the app | ✅ covered |
| DB writeback (checksums / reads / artifacts) | results ingested, not just files written | ✅ covered |
| md5 round-trip correctness | stored checksum == real md5 of the input | ✅ covered (fastq-checksum) |
| Failure → DB `failed` | status reconciliation on a real process failure | ✅ covered |
| **Stop / cancel** | `DELETE` → `scancel` → DB `cancelled`; job gone from `squeue` | planned |
| **Artifact + log retrieval** | produced files/logs downloadable via the app's `file`/`logs` endpoints | planned |
| **statusSource** | which path finalized the run (weblog vs monitor) — does live UI progress work on this topology | planned |
| **Step-level progress** | `PipelineRunStep` rows + `currentStep` transitions | planned |

## Execution / topology notes (CI-specific)
- The runner and SLURM compute nodes share **only a dedicated cluster filesystem**; `/home` is per-node. The run dir, input data, conda env, and pipeline packages all live on the shared filesystem (configured via the `SLURM_SHARED_*` Actions variables on the private mirror). The conda env is referenced by **full prefix path** (names don't resolve across nodes here).
- QOS caps the user to **1 submitted job**, so pipelines run as a **single SLURM job** with Nextflow's local executor inside (`SEQDESK_SLURM_INLINE_EXECUTOR=1`) rather than one job per process. Real multi-node parallelism (e.g. MAG at scale) needs the admin to raise the QOS limit.
- There is **no weblog block** in the generated `nextflow.config` (compute nodes can't reach the app's loopback), so output resolution runs via the **`/sync` API** and the **pipeline-monitor**, not weblog callbacks.

## Real bugs this E2E has caught
The suite exists to find app issues, not just to be green. So far it surfaced and fixed:
1. **Config loader dropped `SEQDESK_CONDA_ENV`** — a configured conda env name was silently ignored (default-config `trackSources` gap).
2. **Pipeline packages dir was not relocatable** — Nextflow ran against a path the compute node couldn't see.
3. **`simpleGlob` ignored literal (wildcard-free) discovery patterns** — script-less pipelines ingested **zero artifacts**.
4. **The pipeline-monitor never resolved outputs** — runs finalized by the safety-net daemon (vs the `/sync` API) were marked completed but had **no artifacts/writebacks** persisted.

## Adding a pipeline to the matrix
1. If study-scoped, add it to `STUDY_SCOPED_PIPELINES` in `scripts/run-pipeline-runtime-e2e.mjs`.
2. Add a `WRITEBACK_SPEC` entry (`checksum` / `artifacts` / extend for read-field writebacks).
3. If its read-field writebacks aren't exposed by the run-GET select (`pipeline-run-ops-service.ts`), extend that select.
4. Add a workflow step: `npm run pipeline:e2e:runtime -- --ensure-dummy-data --pipeline-id <id>` (runs local + SLURM).
5. If the pipeline needs an external DB, stage it on the shared cluster filesystem and point the install profile / env at it; only then flip its row to covered.
