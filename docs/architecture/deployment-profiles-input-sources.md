# Modular input sources and unified discovery

> Superseded where it describes separate application views, mutually exclusive input paths or Canvas-first navigation. The current implementation and remaining TODOs are in [One SeqDesk with coexisting input modules](unified-input-modules.md). Existing enrollment/ownership protections remain compatibility policy, not separate products.

Status: source federation remains a researched proposal; existing importer
hardening is partially implemented (checkpoint below). Reviewed 2026-09-07.
Companion to `deployment-profiles-plan.md` and Milestones 8–9 of
`deployment-profiles-todo.md`. This is follow-on scope, not a reason to delay
finishing the profile/security/installation foundations.

## Decision in brief

Use one **Add data** experience and one typed dataset/import pipeline, with
small, first-party source adapters. Separate discovery, metadata enrichment,
file resolution, transfer, and format validation. A source may implement some
of these capabilities without implementing all of them.

Do not create one page, queue, downloader, or installer per database. Do not
build an installable third-party plugin marketplace initially. Server-side
adapters ship in the same application; administrators enable them and configure
optional dependencies. Members use them without infrastructure privileges.

## Sources worth supporting

| Source | Useful role | Proposed priority and limits |
| --- | --- | --- |
| Local upload | Bring existing files from the user's computer | First: resumable uploads, sample pairing, manifests, common dataset finalization |
| Approved server folders | Copy data already on the lab server | First follow-on: administrator-approved roots only, not arbitrary paths |
| ENA / SRA / DRA accessions | Discover sequencing studies/runs and import reads | First: extend existing ENA-backed accession importer with search and explicit run/file selection; native NCBI transport later |
| NCBI Datasets | Reference genomes and associated data packages | First: generalize existing taxon importer and support explicit assembly versions |
| MGnify | Metagenomics discovery, processed analyses, genome resources, links to reads | Next: study/analysis discovery, selected supported outputs, raw-read resolution through ENA |
| BioStudies | Study discovery, supplementary files and related repository records | Next: selective files and cross-references, not unconditional study-wide download |
| BioSamples / BioProject | Sample/project metadata and relationships | Enrichment alongside core sources; metadata records are not themselves FASTQ files |
| GEO | Functional-genomics studies, processed data and links to raw reads | Later: build on the shared read resolver and add typed processed-data support |
| PRIDE / MetaboLights | Proteomics / metabolomics discovery and files | Later only with corresponding dataset types and usable workflows |
| Institution object storage | Browse/import authorized S3-compatible buckets | Later: credential scope, prefix policies, transfer costs and private-data handling |

Repository support does not imply that every file format is runnable. Mark
metadata-only, downloadable-but-unsupported, and pipeline-compatible results
separately. Reference databases installed for a pipeline remain a separate
admin-managed catalog; do not confuse downloading one reference genome with
installing an entire classifier database.

### Evidence and integration details

- ENA exposes typed result sets, searchable/returnable fields, JSON responses,
  and file metadata. Its documentation distinguishes host taxonomy from the
  organism/metagenome taxonomy: a useful warning against a single ambiguous
  “species” filter. Use bounded pages, not an unlimited query.
  [ENA advanced-search documentation](https://ena-docs.readthedocs.io/en/latest/retrieval/programmatic-access/advanced-search.html).
- Native SRA retrieval can involve `prefetch` followed by `fasterq-dump`, rather
  than a simple FASTQ download. Treat conversion as a separate, versioned job
  stage with scratch-space budgeting and derived-file provenance. An ENA lookup
  that lacks downloadable files must not claim the SRA record does not exist.
  [NCBI SRA Toolkit guide](https://github.com/ncbi/sra-tools/wiki/08.-prefetch-and-fasterq-dump).
- NCBI publishes a Datasets v2 API specification. Keep this assembly/reference
  adapter distinct from raw-read retrieval.
  [NCBI Datasets API](https://www.ncbi.nlm.nih.gov/datasets/docs/v2/api/).
- MGnify documents API v2, pagination, limited search filters, related study/
  sample/run/analysis records, and analysis-detail downloads. API v1 was
  deprecated in June 2026 and serves frozen data. Target v2; do not build on old
  JSON:API examples or assume rich filters exist on every endpoint. Import
  processed results separately from underlying reads and preserve analysis
  version information.
  [MGnify API documentation](https://docs.mgnify.org/src/docs/api.html).
- BioStudies provides paged search, study detail, and a separate `/info` endpoint
  for storage details. Resolve file locations from current metadata rather than
  guessing paths. Cross-references need explicit relationship handling.
  [BioStudies API help](https://www.ebi.ac.uk/biostudies/SourceData/help).
- BioSamples supports programmatic sample search; use it for metadata lookup
  and enrichment, preserving the source attributes and provenance.
  [BioSamples search guide](https://www.ebi.ac.uk/biosamples/docs/guides/search).
- GEO sequences link raw data to SRA; keep processed GEO assets distinct from
  those reads. [GEO sequencing-data guide](https://www.ncbi.nlm.nih.gov/geo/info/seq.html).
- PRIDE has project search and file APIs; MetaboLights covers metabolomics
  experiments. Their modality-specific import contracts need a separate spike
  before implementation.
  [PRIDE API](https://www.ebi.ac.uk/pride/ws/archive/v2/docs/api-guide.html),
  [MetaboLights](https://www.ebi.ac.uk/metabolights/).
- EBI Search offers cross-resource discovery/navigation and is worth evaluating
  as an optional discovery backend. It does not replace source-specific file
  resolution or establish complete coverage of all repositories.
  [EBI Search programmatic guide](https://www.ebi.ac.uk/training/online/courses/embl-ebi-programmatically/ebi-search-programmatically/).

These findings are documentation research, not successful live import tests.
Validate current schemas, limits, availability and terms when implementing each
adapter; do not promise full source coverage based on documentation alone.

## User experience

The common **Add data** entry point offers **Search public data**, **Upload
files**, and **From lab storage** when enabled. Existing authorized datasets get
a separate **Use existing data** choice. File uploads should not masquerade as
search providers.

Public search accepts keywords, an accession, a recognized repository URL, or a
list of accessions. Recognized URLs are parsed into provider identifiers, not
fetched as arbitrary URLs. Exact identifiers route to relevant resolvers;
ambiguous identifiers produce explicit choices. Keyword search is submitted
deliberately, with the external sources visible before the query is sent.

The default search source set follows selected data kind and enabled providers.
Show source chips and a simple kind filter: reads, assemblies/references,
processed results, studies, or samples. Offer assay, organism, host organism,
and other filters only where supported. Do not claim an upstream filter worked
when it was ignored or applied only to a fetched page. No generative query
interpretation or sequence-similarity search is needed for the first version.

Results share a compact row/card format: title, accession, source badges, entity
kind, available data kinds, relevant organism/assay, and file/size availability.
Unknown file counts and sizes remain unknown, not zero. Group studies above
their samples/runs so one large study cannot flood the results.

One search box does not require one misleading relevance score: initially use
source-grouped results with independent pagination, exact accession hits first,
and explicit source status. Do not sum overlapping source totals into a unique
dataset count. A failed source shows a retryable error while others remain usable.

Selection opens a detail view and a shared **import basket**:

1. Expand the study into bounded sample/run/file choices.
2. Select raw reads, processed outputs, or metadata only where supported.
3. Review sample grouping, paired ends/lanes, format, version, bytes, unknown
   size warnings, expected conversions, and supported workflow compatibility.
4. Choose the authorized destination and confirm the frozen import manifest.
5. Follow one background Imports view; results become ordinary typed datasets.

Never download a whole study just because its search result was selected.
“Select all” must state its scope, resolve a bounded complete selection, and
freeze exact identifiers before execution. Cancel, retry failed assets, and
resume should not lose successful transfers. Incomplete required pairs cannot
be marked ready for a paired-read workflow.

## Internal boundaries

Keep these as modules in one application, not new network services:

| Component | Responsibility |
| --- | --- |
| Source registry | Stable ID, adapter version, supported operations/kinds, filter schema, host policy, credentials, dependencies and health |
| Discovery coordinator | Route identifiers; bounded parallel source queries; per-source pagination, errors, caching and rate budgets |
| Source adapter | Map native records, resolve relationships and exact selectable assets; retain source-specific metadata |
| Import planner | Authorize destination, freeze selection, validate kinds and permissions, reserve storage, produce reviewed manifest |
| Transfer worker | Shared durable queue, leases, retries, cancellation, streaming transfer, integrity checks and safe staging |
| Dataset finalizer | Validate bytes/collections, atomically publish immutable assets and provenance into authorized datasets |

Proposed capability contract (design sketch, not current API):

```ts
interface DataSourceAdapter {
  manifest: SourceCapabilities;
  recognize(input: string): SourceReference[];
  search?: (query: SearchQuery, context: SourceContext) => Promise<SearchPage>;
  resolve: (ref: SourceReference, context: SourceContext) => Promise<SourceRecord>;
  listChildren?: (ref: SourceReference, cursor: string | undefined,
    context: SourceContext) => Promise<RecordPage>;
  planAssets?: (selection: SourceSelection,
    context: SourceContext) => Promise<ResolvedAssetManifest>;
  enrich?: (ref: SourceReference, context: SourceContext) => Promise<MetadataPatch>;
}
```

Context carries scoped credentials, deadlines, cancellation and the shared HTTP
policy. Adapters resolve assets; they do not choose arbitrary output paths or
spawn arbitrary tools. Native SRA conversion is an explicitly approved transfer
strategy, not a provider-defined shell command. Optional capabilities let a
metadata source join discovery without pretending it supports file downloads.

### Records, relationships and deduplication

Normalize the small common envelope, not every biological attribute:
`sourceId`, native accession and optional version, record kind, title, typed
relationships, data kinds, access state, source URL, retrieval time, and original
metadata snapshot. Keep unknown values and field-level enrichment provenance;
external metadata must not silently overwrite user edits.

Keep `sameAs`, `partOf`, `derivedFrom`, and `describesSample` distinct. A MGnify
analysis and its ENA run are related, not duplicates. Group explicitly matched
read accessions across discovery sources, but do not equate two files merely
because they describe the same sample/run. Submitted FASTQ and converted FASTQ
can differ. Byte deduplication requires verified content identity; logical
workspace authorization remains independent of physical storage reuse.

Record both **discovered through** and **downloaded from**, source accessions,
asset identity/version, metadata snapshot, source checksums, locally calculated
SHA-256, adapter/tool version, retrieval time, citations, and available reuse
terms. URLs can change and are not permanent scientific identifiers. Metadata
refreshes never silently replace previously imported bytes.

## Reliability, privacy and policy

- Apply installation-wide provider concurrency/rate budgets across workers;
  honor throttling and retry hints with bounded backoff. NCBI E-utilities has
  distinct published per-IP/key limits; do not apply them indiscriminately to
  NCBI Datasets or downloads.
  [NCBI usage guidance](https://eutilities.github.io/site/API_Key/usageandkey/).
- Set request/page/response limits and separate metadata search from large
  transfer capacity. Cache only public metadata globally; private queries and
  credentials require principal-scoped handling. Do not send local workspace
  names or sensitive research descriptions to providers automatically.
- Re-resolve/validate assets before queueing; a client preview is not trusted.
  If source version, files or cost materially change, require a renewed review.
- Shared transfer policy enforces approved HTTPS hosts, redirect/DNS validation,
  internal-address blocking, timeouts, quota reservations and maximum bytes even
  when size is unknown. Never treat a public API's returned URL as automatically
  safe. Credentials stay server-side and must not follow cross-origin redirects.
- Use protected staging, archive expansion/path limits and content validation.
  Render upstream text as untrusted content. Do not execute imported code or
  serve uploaded active content as trusted application HTML.
- Default to public, unrestricted sources. Controlled human-data repositories
  remain outside the first release; discoverability is not download permission
  or a compliance claim. Missing credentials/access produce honest errors.
- Disabling a provider stops new searches/imports and defines drain/cancel
  behavior for queued work; it must not delete existing data or provenance.

## Reuse across profiles and installation

Workbench exposes Add data prominently in a workspace. Shared Lab uses the same
flow within shared projects. Sequencing Center can offer it for authorized
reference/control/reanalysis work without creating fake orders. Destination
adapters handle profile-specific scope; providers do not hard-code workspaces
or infer admin rights. Rollout outside Workbench waits for those scope checks.

The installer should not ask users to understand ten repository APIs. Ship
lightweight public adapters, expose recommended sources after login, and show
each source as ready, optional dependency missing, disabled, or unavailable.
Search-only functionality should work without an SRA Toolkit installation.
Install large tools only with administrator approval when their transport is
enabled. Optional provider outages never block local upload or base onboarding.

## Incremental implementation and acceptance

The branch already has `src/lib/workbench/importers/{types,registry}.ts`, ENA
accession and NCBI taxon providers, and `import-jobs.ts`. Its preview/result types
are genome-biased; jobs select a default workspace and datasets use global cache
keys. Evolve those seams rather than adding a parallel importer subsystem.
Keep existing jobs readable through versioned legacy payload handling; new
providers must not inherit the default-workspace/global-cache authorization model.

1. Finish workspace-owned typed assets, durable imports and resumable uploads;
   extract shared transfer/finalization policy and explicit destination scope.
2. Add the source capability registry, accession routing, ENA search, NCBI
   assembly selection, common results, basket and import manifest. Preserve
   existing accession-only entry points during migration.
3. Add MGnify v2 and BioStudies adapters plus BioSamples enrichment. Prove a
   linked-study-to-read journey and a processed-output journey independently.
4. Add native SRA conversion only after measured scratch-space/resume tests;
   evaluate GEO, EBI Search and further modalities based on actual user demand.

Acceptance must include partial source outage, stale metadata, duplicate
cross-references, unknown size, paired/multilane data, huge-study selection,
worker restart, cancel/resume, expired credentials, source disable, and denied
cross-workspace access. Use opt-in bounded real-provider contract tests and
operator-approved small public datasets; no fabricated external responses or
successful fake imports. Pure internal normalization/policy tests are separate
from live-service evidence. Keep a provider compatibility matrix with last
verified API version and journey, without pretending a live outage is a pass.

Default recommendation for a solo developer: federation with a small metadata
cache first, not a locally mirrored search index of every archive. A full index,
third-party SDK/marketplace, cross-source semantic ranking and automatic cohort
construction are explicitly deferred.

## Edge-case test matrix

These are planned tests and failure hypotheses, not validated bugs or completed
checks. P0 blocks enabling an affected import capability; P1 blocks describing
the unified discovery experience as complete. Prioritize silent scientific
errors over cosmetic polish.

| Priority | Scenario to exercise | Required outcome |
| --- | --- | --- |
| P0 | Two samples share a name; one sample has multiple runs, lanes, replicates, paired reads or index reads | Stable sample/run/asset identifiers preserve distinctions; never infer all relationships from filenames or collapse biological replicates |
| P0 | Missing mate, mismatched record counts, truncated gzip, malformed FASTQ, or a mixed-layout collection | Validation explains the offending asset; never publish it as valid paired reads or silently discard orphan reads |
| P0 | Raw reads and an analysis derived from them appear through different sources | Link provenance, but do not merge them into one dataset; workflow compatibility uses semantic type, not just file extension |
| P0 | Assembly accession resolves to a newer version, or files change between preview and import | Pin resolved versions/assets; materially changed selection requires new review, never silent substitution |
| P0 | User edits provider ID, destination, file URL, size, checksum or manifest in a request | Server authorizes and resolves the selection independently; client previews cannot grant access or redirect transfers |
| P0 | User loses destination access, is disabled, or the destination is deleted while a job is queued/running | Recheck authorization on execution, resume and publication; stop/quarantine safely and do not recreate deleted destinations |
| P0 | Two users import identical bytes; one deletes their dataset or guesses the other's job/asset ID | No cross-scope metadata/download/progress access; reference accounting prevents deletion of still-referenced bytes |
| P0 | Double-click, request retry, two workers claim one job, or a stale worker finishes after lease expiry | Scoped idempotency and fenced leases produce one logical publication; stale workers cannot overwrite success or release another worker's reservation |
| P0 | Crash after file rename but before DB commit, or after DB commit before queue acknowledgement | Recovery reconciles exact job-owned staging and publication state; no duplicate dataset and no ready record pointing to absent bytes |
| P0 | Cancel races with completion; retry races with cleanup | A defined atomic terminal-state transition wins; cleanup cannot remove successful/referenced assets and reservations are released once |
| P0 | Disk fills mid-write, network mount disappears, or several unknown-size imports exhaust capacity together | Bound actual bytes and temporary expansion with shared reservations; fail safely without writing to a fallback mount or corrupting other datasets |
| P0 | Resume offset is accepted incorrectly or remote object changes between attempts | Resume only against verified identity/range behavior; otherwise restart safely, verify final integrity, and never concatenate incompatible versions |
| P0 | Response contains HTML/error content under a data filename, or checksum covers compressed bytes but is compared against decompressed bytes | Validate content and track checksum algorithm plus byte representation; missing upstream checksums remain explicitly unverified at source |
| P0 | URL redirect targets an internal service; archive contains traversal, absolute paths, symlinks, duplicate paths or excessive expansion | Shared transfer/extraction policy rejects it; no writes outside private staging and no credentials leaked to a new origin |
| P0 | Colliding filenames, case-only differences, Unicode variants or names too long for the target filesystem | Generate safe internal asset paths without overwriting; preserve original names as metadata |
| P1 | Mixed/duplicate accession list, whitespace, recognized URL with tracking parameters, or ambiguous identifier | Normalize only provider-defined syntax, identify duplicates and report unresolved items; do not import only the valid subset without disclosure |
| P1 | Search A is slow, user submits B, then A completes | Results remain associated with the current query; stale responses cannot replace B or contaminate its basket |
| P1 | One provider fails, throttles or changes pagination while others succeed | Show per-source status; no false zero-result result, repeated pages, endless loop or misleading global unique total |
| P1 | Huge study, unsupported filter, capped results, or Select all across pages | Explicit limits and selection scope; complete bounded manifest or a clear refusal, never silently truncated scientific input |
| P1 | Cross-reference cycle or many-to-many sample/project mapping | Bounded graph expansion with visited identifiers; no recursion loop or invented one-to-one mapping |
| P1 | Metadata field is absent, explicitly zero, conflicting across providers, or subsequently corrected by a user | Preserve unknown versus zero, source attribution and user edits; enrichment does not silently rewrite scientific meaning |
| P1 | Provider/API version or adapter changes while old jobs remain queued | Versioned payload handling or an actionable migration failure; old jobs never execute with silently changed interpretation |
| P1 | Provider disabled or credentials revoked during work | Apply documented drain/cancel policy; keep imported datasets, redact errors, and do not bypass disablement by retrying through another adapter |
| P1 | Browser reloads during import, user opens another workspace, or runtime setup is deferred | Durable progress reconnects to the authorized job; destination stays explicit; upload remains independent of analysis-runtime readiness |

### Test layers and minimum release evidence

1. **Pure internal tests on every change:** identifier handling, capability
   selection, typed collection validation, query-state ordering, manifest
   versioning, permission predicates and state transitions. Construct internal
   values directly; do not claim they are responses from a public service.
2. **Integration tests against an isolated disposable database and storage:**
   race workers, terminate them at publication boundaries, retry identical
   requests, revoke access, and assert dataset/storage/reservation invariants.
   Use explicitly local test assets and local fault injection, not simulated
   ENA/MGnify/SRA services. Never reset a shared development database.
3. **Opt-in provider contract tests:** exercise real search, detail, pagination,
   cross-references and metadata resolution with recorded real accessions and
   bounded requests. Mark unavailable dependencies as unavailable, not success;
   retain sanitized evidence of schema/adapter versions and retrieval time.
4. **Small real end-to-end imports before provider enablement:** test selected
   files through resolution, transfer, integrity checks, dataset publication and
   an appropriate approved workflow. Independently test raw-read versus
   processed-result journeys. No large-download tests in default developer runs.
5. **Shared UI journeys:** keyboard-only search/selection, clear pairing errors,
   unknown-size confirmation, partial failure and retry, reload/reconnect, and
   destination visibility. Run the authorization matrix across profiles when
   making the feature available outside Workbench.

Maintain a short provider evidence record: adapter/API version, tested operation
and asset kind, real accession/version, date, result and remaining limitation.
Generalized importer tests do not certify every provider, and passing metadata
search does not certify downloading or pipeline compatibility. Avoid brittle
assertions about exact live hit counts or ranking.

Before implementation, specify the job transition table, cancellation winner,
lease/fencing rules, import idempotency scope, staging reconciliation, and
checksum representation explicitly. These are core correctness contracts, not
details to decide independently in each provider.

## Implementation checkpoint — 2026-09-07

Existing ENA/NCBI/upload paths now have private per-job import storage, atomic
job admission and publication, locked publication authorization, request-key
idempotency in Add data, reviewed-preview change detection, stale-response
protection, whole-run ENA caps, bounded FASTQ/gzip validation, per-file SHA-256,
and bounded NCBI ZIP extraction. The default-workspace creation race was found
and fixed using real PostgreSQL tests, not just database doubles.

Workbench startup reconciliation recovers queued jobs and marks running jobs
interrupted after three minutes without a heartbeat. Workers heartbeat every
30 seconds and abort transfers on heartbeat failure where supported. New
attempts use new directories; expired jobs cannot publish later. The shared
database admission limit defaults to two running imports and can be set to
1–16 with `SEQDESK_WORKBENCH_IMPORT_CONCURRENCY`. Reconciliation follows the
existing Node instrumentation autostart policy: disabling worker autostart also
disables this recovery worker. Fully supported operation requires autostart;
serverless/external-worker configurations still need their own deployment gate.

Verified in this checkout:

- 131 Workbench/instrumentation regression tests passed.
- Six isolated PostgreSQL tests passed for request/runner races, independent
  storage, deactivation, publication rollback, interrupted work and admission.
- A real ENA `ERR164407` metadata/download check passed: 76,311,859 compressed
  bytes, source MD5/size checks, local SHA-256 and FASTQ structural validation.
  Its downloaded files were removed after the test. This is not a workflow-run
  compatibility test or evidence for other providers.
- Production TypeScript check and `git diff --check` passed.

Repeat real DB checks only with `SEQDESK_TEST_TIER=live` and
`SEQDESK_IMPORT_TEST_DATABASE_URL` pointing to a deliberately created local
database named `seqdesk_import_verify_*`, using
`src/lib/workbench/import-jobs.database.live.test.ts`. They insert and remove
internal test records, so never point them at an application database. Real ENA
verification is opt-in with `SEQDESK_WORKBENCH_ENA_LIVE=1`; its test rejects a
source selection above 100 MiB before downloading. Budget enough expanded-read
validation capacity with `SEQDESK_WORKBENCH_ENA_MAX_BYTES` (512 MiB was used).

Still open, and not covered by a claim that all bugs are fixed: complete
filesystem capacity reservations and mount-loss checks; NCBI download scratch
limits before extraction; cross-file pairing and semantic collection checks;
non-FASTQ content validation; resumable transfer checkpoints; process-crash
staging reclamation; versioned provider job migration; full real workflow and
packaged restart/termination tests. ZIP64 and byte-level resume are explicitly
unsupported. ZIP extraction currently caps expanded bytes at 20 GiB, entries at
10,000 and expansion ratio at 2,000. Generalized source federation and the future
provider-specific matrix remain separate unimplemented scope.

### CAMI benchmark source (2026-09-07)

The bundled `cami-benchmark` Store importer has a dedicated navigation form for
[CAMI II Marine](https://frl.publisso.de/data/frl:6425521/marine/) (samples 0–9)
and [CAMI III toy human gut](https://cami-challenge.org/datasets/toy-human-gut/)
(samples 0–19), with short/long read selection. One sample/technology per job is
deliberate: reads can be multiple GB even for one sample. Repeat to add samples
or another technology to the same study. No separate installer, external CLI or
third-party executable plugin installation is introduced. This is a curated
catalog, not federated search. The shared job system supplies private storage,
preview fingerprints, idempotency, queued cancellation and worker recovery.

Preview uses real HEAD metadata from the current dataset-page links, not the
older paths still present in the bulk download list. Fixed source URLs prevent
arbitrary URL imports. Downloads forbid redirects, require stable ETag and byte
length, stream with a 100 GiB per-job ceiling and six-hour timeout, and record a
local SHA-256 plus source URL, selected role and retrieval date. Multipart ETags
are object-version identifiers, **not** MD5 checksums.

Contract version 2 supersedes the earlier archive-only provider; queued legacy
previews fail with a request to preview again rather than silently creating
scientific records under an old authorization.

Implemented publication and validation:

- Safe streaming extraction accepts regular tar files/directories only, rejects
  traversal, links, GNU/PAX extensions and unsupported size encodings before
  metadata buffering, limits entries to 1,000 and expanded tar bytes to 100 GiB.
  Only `anonymous_reads.fq.gz` / `anonymous_reads.fastq.gz` is materialized;
  embedded answer mappings and other ancillary entries are discarded.
- Four-line FASTQ and gzip integrity are checked with a 100 GiB expanded-read
  bound. Short-read adjacent `/1` and `/2` identities must match before splitting
  to R1/R2. Long reads remain single-end. Other layouts fail explicitly.
- Source archive SHA-256/ETag and output SHA-256/MD5 are retained. MD5, not SHA-256,
  populates the existing Read checksum fields. No accessions, taxa, collection
  dates or subject mappings are invented. CAMI III's current subject TSV is
  fetched within a 64 KiB limit, validated and pinned by SHA-256 in the preview;
  a conflicting mapping on an existing sample requires review. Platform,
  published read-length metadata and source environment are catalogued.
  Citation, dataset and original sample
  identifiers remain in provenance; benchmark records are marked synthetic.
- One transaction publishes Study, Sample, Read, WorkbenchDataset and job
  success. Owner-specific deterministic IDs serialize duplicate additions.
  Existing sample/technology reads are never overwritten. Adding long reads
  reuses the same sample as short reads. Imports do not create Orders or fake
  instrument SequencingRuns. `Sample.orderId` is nullable with a database
  constraint requiring either an order or an owning study.
- Imported Read records are available but `isActive=false`: this field means
  the pipeline-selected input set in the existing schema, which enforces one
  active set per sample. Neither imported technology is selected implicitly.
  Output metadata says `pipelineReady=true` for validated files and
  `pipelineInputSelected=false`. Pipeline input selection/execution is later work.
- Progress shows transfer bytes and extraction/validation/publication stages.
  Success links to `/workbench/studies/<id>#<sample-id>`. The owner-only imported
  study list/details show samples, read sets and provenance. Order-only endpoints
  guard absent orders; unassigning the owning study is rejected.

Remaining acceptance criteria and explicit limits:

- CAMI I, non-marine CAMI II and full CAMI III, pooled truth, BAMs, taxonomic
  profiles, source genomes and unspecified longitudinal timepoints are not imported.
  Add versioned catalog entries with verified source contracts, citations and
  licensing/access guidance; do not infer subject mappings from sample numbers.
- 200 GiB free scratch-space preflight is intentionally conservative; it is not
  a cross-worker reservation. General storage reservations, resumable downloads,
  running cancellation, bulk sample selection, persistent module preferences
  and federation remain open. Existing running-cancellation limitations apply.
- Workbench-only entry points currently expose this importer. Cross-profile
  import UX, full browser E2E and pipeline integration still need separate work.
- Live metadata tests use `SEQDESK_TEST_TIER=live SEQDESK_CAMI_METADATA_LIVE=1`.
  The opt-in full read test uses `SEQDESK_WORKBENCH_CAMI_LIVE=1`, defaults to CAMI
  II Marine sample 0 short reads, and caps source download at 6 GiB. Override
  `SEQDESK_CAMI_DATASET` / `SEQDESK_CAMI_TECHNOLOGY` for other supported choices.
  It removes only its own temporary files. Database tests use the disposable
  database gate above; never migrate/reset the user's application database for
  verification. Apply the new migration through normal deployment before use.

Verification checkpoint for this implementation:

- 394 focused Workbench, study/sample/file, delivery and related API tests passed.
- All 30 migrations applied to a disposable PostgreSQL database; eight real DB
  tests passed, including complete local-read worker publication, rollback,
  duplicate technology rejection, ownership and the no-orphan constraint.
- Four real metadata cases passed for CAMI II/III and short/long reads, including
  CAMI III subject metadata. This is not full-download proof for all combinations.
- A real CAMI II Marine sample-0 archive of 5,550,020,311 bytes was downloaded.
  Final preparation code safely extracted and validated 16,647,395 read pairs,
  producing R1/R2 in 182 seconds. The superseded slower full-download probe was
  stopped after this replacement check passed. Temporary archives, read outputs
  and the disposable DB were removed; the application DB was not changed.
- Production TypeScript and diff whitespace checks passed. A whole-branch fast
  run was not green: 14 failures remained in installer/invitation tests and
  sandbox-dependent checks (5,264 passed, two skipped). These are not evidence
  against the focused CAMI results, nor a basis to claim release readiness.
