# Taxonomic pipeline verification — September 8, 2026

Branch: `codex/modular-deployment-modes`. Local work only; not pushed or released.

## Automated checks

- Final expanded suite: **2,124 tests across 131 files passed** with
  `--maxWorkers=4`. This includes **73 resource setup/API/contract cases**, the
  original pipeline UI, imports, authorization and sidebar tests. One UI test
  hit its timeout while a production build was also running; it passed alone
  and in the final suite. A separate trace-watcher failure exposed a real race:
  late reads could notify after stop. The watcher now serializes checks, drops
  late callbacks and retries transient read errors; deterministic tests cover it.
- Initial focused suite: **1,827 tests across 110 files passed**, including the
  existing order/study pipeline UI components. The Python subprocess now covers
  20 internal contract cases. Both package descriptors passed the linter with
  zero errors/warnings; production TypeScript, targeted ESLint and `git diff --check`
  also passed.
- Package loading, manifest/registry contracts, configuration validation,
  administrator-only paths, exact sample mapping, taxonomy checks, complete
  prediction coverage, source-neutral access, active-read selection and existing
  run/viewer behavior are covered by focused Vitest tests.
- `pipelines/cami-opal/workflow/bin/test_taxonomic_runners.py` covers the Python
  contracts using explicitly internal fixtures, without pretending to call an
  external service. These fixtures do not establish biological accuracy.
- A real `npm run build -- --webpack` production app build passed, including
  TypeScript and static-page generation. It used a build-only PostgreSQL URL,
  not the user's development database, and normal fonts (no font-response mocks).
  This is not the release installation/update/rollback gate, whole-repository
  coverage gate, or production/SLURM certification.

## Package-managed database setup

The existing Admin → Pipelines setup now reads `manifest.resources`. MetaPhlAn
and OPAL remain local bundled packages on this branch, not public registry releases.
The MetaPhlAn card offers **Set up DB**, with Download & set up, Link existing
directory, disk preflight, progress, checksums and cancellation. OPAL does not
need this marker database; its matching taxonomic reference is a separate input.

Checks cover incorrect checksums, truncated/oversized downloads, missing/empty
and partial linked files, duplicate names, traversal, symlinks, extraction bounds,
positive base-256 tar sizes, gzip/MD5 support, failed config persistence,
concurrent starts, cancellation before/after the commit boundary, stale cancel
tokens, dead-process recovery and corrupt job state. Unknown or foreign-host
owners fail closed. A killed process's staging directory is retained for explicit
administrator cleanup; retry is fresh, not an automatic byte-level resume.

The resource API tests cover authenticated administrator access, dispatch through
the existing routes, no process killing by saved PID, path/index binding as one
configuration update, preservation of enabled state and unrelated edits, bounded
compare-and-swap retries, and removal/definition changes during setup. Setup no
longer treats the database index as a filesystem path or demands OPAL's per-run
sample/reference declarations before enabling it. Invalid exports/signatures in
two previously added API routes were also corrected for Next.js build checking.

Live upstream inspection used only **6,144 bytes** of HTTP range responses. All
six Bowtie2 index headers and all four metadata-archive headers were enumerated;
the seven required regular files were found, including the >8 GiB base-256 index
entries. Exact file sizes are now in the manifest and enforced for linked and
downloaded installations. Ancillary sequence/viral files are drained, not installed.
Archive sizes and publisher MD5 checksums were checked separately. This verifies
the pinned layout and metadata, **not** the full archive bytes or successful
biological profiling. The full 44.5 GiB transfer was not performed.

Full-download acceptance must still check disk exhaustion during extraction,
real sustained transfer/cancellation, available RAM on the intended execution
host, real MetaPhlAn execution and the user's matching CAMI Ground Truth. Runtime
resource state is excluded from Git and release copies; no release was created.

Reproduce the focused suite from this branch with Node 24:

```sh
npm test -- src/lib/pipelines src/lib/authorization src/app/api/pipelines \
  src/app/api/admin/settings/pipelines src/app/api/workbench/imports \
  'src/app/api/orders/[id]/pipeline-input' src/components/layout/sidebar \
  src/components/orders/OrderPipelineView.test.tsx \
  src/components/pipelines/StudyPipelinesSection.test.tsx \
  src/components/pipelines/RunPipelineSection.test.tsx \
  src/app/admin/settings/pipelines/client-utils.test.ts --silent --maxWorkers=4
```

## Existing local order execution

Command: `bash scripts/run-order-pipeline-e2e.sh --keep-temp`.
This branch's `pipeline:e2e:*` scripts replace the old smoke command names.

- `simulate-reads`: passed, including the template mode.
- `fastq-checksum`: passed.
- FastQC: passed.
- The first sandboxed attempt stopped at FastQC because Conda could not fetch
  its environment/cache. Retrying with the necessary local test permissions
  completed the whole chain.
- Outputs were retained and their file inventory inspected at
  `/var/folders/m5/fd9___z57vs85pf6nlyqzmlm0000gr/T/tmp.BsfMC0C3Yn`.

This proves the existing local packaged execution chain, not UI-triggered runs,
database writeback for the new packages, or scientific benchmark accuracy.

## New packages

Both new Nextflow DSL2 workflows compiled in `-preview` mode. Preview mode does
not execute their processes or establish successful profiling.

A real isolated OPAL 1.0.12 / Python 3.10 environment ran against the project's
[official reference](https://github.com/CAMI-challenge/OPAL/blob/master/data/goldstandard_low_1.bin)
and [official prediction example](https://github.com/CAMI-challenge/OPAL/blob/master/data/focused_archimedes_13).
The example prediction is from another profiler, not a fabricated MetaPhlAn run.
`results.html` and `results.tsv` were present and nonempty. The runtime, inputs
and outputs are retained under `/private/tmp/seqdesk-taxonomic-runtime.RMwFRd`.

This verified the real OPAL executable and pinned report layout, not the full
SeqDesk MetaPhlAn-to-OPAL chain. The package intentionally accepts canonical
rank-position CAMI lineages; older compact-lineage prediction formats need an
explicit conversion, not guessed taxonomy. Official CAMI suffixed strain IDs
are accepted in references but excluded from this species-level benchmark.

MetaPhlAn command construction was checked against its
[pinned 4.2.5 implementation](https://github.com/biobakery/MetaPhlAn/blob/4.2.5/metaphlan/metaphlan.py).
That version requires a nonexisting `--mapout` argument even when the input is
an existing mapping file. The export invocation supplies a distinct unused
destination, never `--force`, so the original mapping cannot be deleted.

## Still required for scientific acceptance

1. Provision the exact compatible MetaPhlAn database on a supported execution host.
2. Complete a real CAMI sample import and select its validated read set.
3. Run MetaPhlAn and verify all three per-sample output artifacts and database provenance.
4. Link samples to a primary study and supply the matching taxonomic Ground Truth.
5. Check exact sample IDs, reference/taxonomy snapshots and abundance definitions.
6. Run OPAL through SeqDesk; verify artifact staging, output discovery, report
   retrieval and metrics against agreed per-rank acceptance criteria.

No reference files are invented; no automatic large database download or new
CAMI bulk import was started for this implementation.
