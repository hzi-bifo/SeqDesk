# STUB SLURM commands — for tests only

These are **not** SLURM. `sbatch`, `squeue` and `sacct` here print canned output chosen by
`SLURM_STUB_STATE` so the status and failure parsing of pipeline runs (queued, running, failed)
can be exercised without a cluster (`src/lib/pipelines/slurm-stubs.test.ts`). Never put this
folder on the PATH of a real server.

States: `pending-priority`, `pending-resources`, `pending-qos`, `running`, `completed`,
`oom`, `timeout`, `node-fail`.
