# One SeqDesk application with coexisting input modules

Status: implemented foundation on `codex/modular-deployment-modes`, updated September 8, 2026.
This is the current decision and supersedes the earlier deployment-profile UI/domain split, Canvas-first navigation, and order-independent import landing pages in the other `deployment-profiles-*` documents.

## Product boundary

One codebase, release, installer, login system and original sidebar. Every preset uses **Sequencing data | Studies** and the existing order/study routes. There is no separate Bench application. Legacy Workbench landing/import links redirect into the shared application. Canvas is hidden.

The three saved profile identifiers remain compatibility presets for existing enrollment, data-sharing and role policies, plus initial module defaults. They no longer choose a different UI or exclude input providers. We do not silently convert private workspaces into installation-shared data or give configuration administrators access to everyone's records.

- `sequencing-management`: facility order entry and operational workflows.
- `import-cami`: supported CAMI II/III raw short/long-read selections and their benchmark metadata.
- `import-sra`: public ENA-hosted FASTQ from supported ENA/SRA/DRA run, sample or project accessions, with linked source metadata. This is not an arbitrary SRA Toolkit fallback.

These modules can coexist. Administrators control them in Modules. Research starts with facility management off; center and lab start with it on. Disabling an importer blocks previews/new jobs and queued transfer starts, but does not hide existing data. An already-started import may finish. Disabling facility management blocks new orders and facility write routes; imported containers cannot be turned into instrument runs through those routes.

## Shared records, not a second data application

1. **Sequencing data** is the shared collection containing samples and read sets. The existing Prisma `Order` and `/orders` routes are reused to minimize disruptive migration; `dataOrigin` distinguishes `facility` from `import`. The internal `IMP-…` identifier is a SeqDesk identifier, never a repository accession or a claim that sequencing occurred here. Imported containers have no fabricated instrument run, submission or shipping history.
2. **Sample** represents source sample identity and biological metadata; a sample can have several runs/read sets or technologies.
3. **Read** retains validated file paths, paired/single layout, raw classification, available checksums/counts and provenance. Imported reads are not automatically selected as the facility pipeline's active input set.
4. **Study** is the research question/comparison container. A separate Project level is not introduced now. Importing a BioProject creates sequencing data with repository study metadata as provenance, **not an automatic SeqDesk study**. Users explicitly create/link studies later, without equating an entire repository project with a case/control experiment.
5. **StudySample** links the same sample into several studies with study-specific `role` (`case`, `control`, `reference`, `unassigned`) and optional `groupLabel`. Linking/unlinking does not move or copy the sample or its files, and grants no additional data access. Existing `Sample.studyId` remains the primary/source/archive association until pipeline and archive consumers are migrated deliberately.

Example: facility patient samples and imported public gut metagenomes remain in their own sequencing-data collections. The researcher links both into a comparison study and explicitly assigns groups. Repository labels never automatically establish scientific suitability as a control.

## Import contract and user journey

Sequencing data → Add sequencing data → **name the collection** → facility sequencing or **import module store** → module-specific selection/preview → import progress → **open the named sequencing data** → optionally link samples to studies later.

- Keep Facility sequencing as its own card, including a visible disabled state when administrators turn it off. Its existing order wizard receives the chosen name.
- The store lists loaded, bundled CAMI and SRA/ENA import modules with capabilities, enabled/disabled state and a module search. It is an extensible catalog, not a remote plugin marketplace; do not show unimplemented modules as installable. Adding supported modules should extend the shared client-safe catalog and server provider registry/gates.
- The sidebar's Data source opens the catalog directly. Selecting a module without a named destination first asks for a name. The Add sequencing data button always starts with naming.
- Name validation (trimmed, 1–500 characters) is enforced server-side. The named destination is included in the reviewed preview fingerprint, queued request and worker publication contract, rather than being trusted solely from the browser URL or provider response.
- A random collection key survives module switching/reloads through the current import URL. The server derives owner-scoped collection/sample/read identifiers. Repeating imports in that setup adds data to the same collection; duplicate source sample/read technologies or runs within it are rejected, never overwritten. Starting another collection creates a separate collection/copy, even for the same source data; there is no cross-collection file deduplication yet. Importing more data never overwrites a locally edited collection name.
- The named collection is saved immediately, before source selection. Samples and reads are published only after the whole job succeeds; failed jobs leave the collection and its progress history available, without phantom samples or studies. A multi-run/project import stays in its chosen collection even when source records span multiple repository studies.
- Remove the CAMI destination-study selector and automatic study creation. New samples are owned through their sequencing-data collection and may have a null primary `studyId`; later study membership uses `StudySample`. Preserve existing records/studies and support previously queued explicit study targets without creating new default studies. No database reset or migration is needed for this refinement.
- Completion links open the actual named collection and offer Studies as an optional next step. Older job results with explicit study links continue to work.
- CAMI sample selection supports individual checkboxes, Select all available, and Clear selection. Imported/queued/running samples are excluded for the chosen collection, dataset and read technology. Status is owner-scoped and comes from durable Read records plus active jobs, not the last 50-job history; older successful imports still show as imported.
- Multi-sample CAMI previews sum the archive sizes before confirmation. Every sample has its own reviewed manifest, idempotency key and queued job. Preview/queue failures are shown per sample; retries do not resubmit accepted jobs. Already-active duplicates are blocked transactionally across tabs. Keep the page open while queueing; accepted jobs run independently in the background. Scratch-space checks are per preparation, not aggregate quota reservations.
- Source selection and module forms do not show unrelated job history. Module progress is limited to active transfers for the current collection/provider plus results of jobs started or recovered in that visit. Durable per-sample status remains visible in the CAMI picker after revisiting it.

Provider-specific navigation (CAMI dataset/sample/technology or an SRA accession) is contained inside the shared section. Publication, ownership checks, atomic job completion, duplicate protection, storage validation and destination links are shared services. Providers may return multiple scientific entries for project/run imports.

Metadata is part of the import, not an optional later download:

- Preserve source study/sample/experiment/run identifiers and original ENA report fields.
- Retrieve bounded original ENA XML records with URL, timestamp and SHA-256; store as inert text. Do not resolve XML entities or render source HTML.
- Preserve CAMI dataset/sample/technology mapping, synthetic status, source metadata, provenance and citation when provided by the adapter.
- Keep local editable titles/descriptions separate from retained repository metadata. Missing fields stay missing; no invented accessions, organisms, preprocessing history, facility dates or subject groups.
- Validate FASTQ structure and checksums. Paired inputs require complete mates and matching ordered read identifiers/counts; unsupported layouts fail explicitly. A repository-origin file is not automatically proof of untouched instrument output.
- Imports are capped and resumable at the queued-job level; a failed/interrupted transfer is not falsely marked successful. Multi-file publication is transactional. Existing imported technologies/runs are not overwritten.

## Import processing and file evidence

- Processing classification is module-owned, not an import-form option. Each adapter supplies processing state and evidence on its scientific read-set result, allowing future modules to distinguish datasets and runs. CAMI remains explicitly synthetic, with cleaning history unknown; SRA/ENA remains unknown where metadata does not establish processing. Simulation, extraction, pair splitting and FASTQ validation are not cleaning evidence.
- The user-facing selector and evidence prompt have been removed from both modules. New imports cannot use caller-supplied processing declarations; old CAMI request fields are accepted but discarded for queue compatibility. Already saved declarations remain historical provenance, and existing reads are not overwritten.
- Publication maps unprocessed to the existing `raw` data class, cleaned to `cleaned`, and unknown to `unknown`. Origin remains Imported even for user-declared classifications. Imports remain inactive pipeline inputs. Legacy records are not retroactively relabeled; missing processing provenance is displayed as unknown/not recorded.
- Expandable file details show safe HTTP/HTTPS/FTP URLs, host/protocol, size, source MD5 when provided, and local SHA-256 after transfer. Repository MD5 matching is distinct from calculating a local digest. ETags are source versions, never assumed to be MD5 checksums. CAMI archive details and prepared files remain distinct.
- Covered by processing/schema/publication and UI tests plus isolated PostgreSQL worker tests using internal local read fixtures. Full external CAMI transfer remains a separate acceptance gate.

## Collection-first import progress

Files now includes per-import cancellation: queued work cancels immediately; running work enters a durable `cancelling` phase while retaining its worker slot. Workers check every two seconds, abort cooperative transfers/preparation, remove their private partial cache, and only then mark cancelled. Progress updates and publication cannot overwrite a cancellation request; completed records remain untouched. The UI requires confirmation and explains that this is cancellation, not byte-resumable pause. Cleanup failures remain visible for administrator attention.

The user-facing section is now **Files** (the existing `/samples-files` URL is retained for compatibility). Its sidebar active state and page title explicitly recognize that route; it must not highlight Metadata. Import queueing opens Files, which refreshes progress and validated read sets. Successful publication stores associated sample/source metadata transactionally without replacing the user's collection name or edited sample metadata.

- Confirming the name immediately saves an empty owner-scoped collection via `/api/workbench/collections`, before source selection. Save failures stay visible and retries reuse the same key. Queueing still ensures the collection atomically as a compatibility fallback. Concurrent submissions share one collection; existing names and ownership are preserved. Failures leave it available for review.
- Successful queueing opens `/orders/:id/samples-files`; partial CAMI batch failures stay in the selection UI. Sidebar navigation retains the collection key when adding another source.
- Collection-scoped job history refreshes every three seconds without the global 50-job limit. Loading skeletons respect reduced motion. Available read sets retain metadata and file evidence.
- CAMI shows bytes, download percentage, measured average speed and a download-only estimate after ten seconds. Extraction/validation are indeterminate stages. Existing running workers may keep their prior progress format until the current job ends.
- Deduplicated in-app success/failure notifications link to the collection. Navigation does not cancel imports; local servers/computers must stay running. Notification failure cannot downgrade successful publication.
- Follow-ups: bounded FASTQ content previews, per-file retry/cancel controls, SRA byte-rate estimates and an Importing badge in the collection list. Legacy collections without a saved collection key retain files but may lack linked job history; no destructive backfill was performed.

## Installation and upgrade

The guided installer now explains shared UI, access-policy presets and coexisting modules. Its standalone compatibility table recognizes the same three input module switches as the app. The first-login setup page describes modules rather than separate editions. Runtime prerequisites and access-policy checks remain separate from input-module availability.

Use additive migrations, not a reset:

- `20260907160000_unified_input_modules`: origin/provenance fields and study membership, backfilled from primary studies.
- `20260907170000_shared_legacy_import_containers`: attach provenance-backed, orderless CAMI/ENA samples from the earlier branch implementation to deterministic, owner-preserving data collections. No files move. Invalid/unsupported legacy provenance is left unchanged; legacy sample detail URLs remain available for review.

The public installer copy in the website repository has **not** been changed/deployed. Synchronizing it and passing the packaged release gates are required before describing this behavior as publicly released. All current work remains local to the feature branch.

## Source-neutral pipelines and CAMI benchmarking

The original order-level pipeline components now also serve imported sequencing
data at `/orders/:id/pipelines`. The sidebar exposes enabled order-level packages;
study-level pipelines remain in the existing study Analysis section. Facility
module activation does not gate these analysis pages.

- Researchers can run pipelines on their own accessible collections and studies
  and inspect/cancel their own runs. Configuration management, installation-wide
  operations, output resolution and destructive purge remain separate capabilities.
  There is no implicit access to another researcher's targets or unpublished runs.
- Imported reads must be explicitly selected as active inputs. The server accepts
  only an existing, nonsuperseded read belonging to that sample and collection;
  it rechecks ownership under a transaction lock. Inactive fallback reads are not
  counted as pipeline-ready. Facility read selection stays in its existing workflow.
- New package [MetaPhlAn](../../pipelines/metaphlan/README.md): version-pinned
  short-read shotgun profiling, order or study scope, single or paired reads,
  native and CAMI profiles plus per-sample database/run provenance. Read-length
  compatibility uses import evidence or sequencing metadata; single-end is not
  assumed to mean long-read. No cleaning label is changed.
- New package [CAMI OPAL](../../pipelines/cami-opal/README.md): study-level
  benchmarking of completed MetaPhlAn profiles against a separately supplied
  taxonomic Ground Truth. The reference never enters the profiler. Outputs are
  an HTML report, metrics, provenance and a ZIP with report assets and exact
  selected input snapshots.
- MetaPhlAn 4.2.5 and OPAL 1.0.12 / Python 3.10 are pinned. An administrator
  uses the existing pipeline setup UI to install or link the package-declared
  MetaPhlAn database/index, and separately provisions the matching reference file
  on the execution host, then enables the packages. Runs never download a large
  database or choose `latest`. Administrative paths and executor-owned staging
  parameters cannot be overridden by an ordinary run request.
- Package `resources` declare archive sets, pinned versions, public HTTPS sources,
  exact sizes/checksums, required files, extraction bounds and admin config bindings.
  The generic installer handles preflight, progress, cancellation, exclusive worker
  claims, verification and immutable installs. Path/index bindings change together
  after successful installation; existing configurations and databases survive
  failed updates. Resource job state is excluded from Git and release archives.
- New strict packages declare their permitted run parameters and per-run
  requirements in `registry.json.configSchema`; `runRequirements` are separate
  from installation prerequisites. Admin/derived/hidden values are filtered by
  schema, not by pipeline ID. `sequencingCompatibility.requireReadLengthEvidence`
  expresses the short-read evidence gate generically. Legacy packages retain
  their existing configuration behavior.
- OPAL requires exact sample-code → reference SampleID mapping, complete coverage
  by each selected prediction run and an explicit reference/taxonomy declaration.
  Multiple runs require explicit selection. Conflicting shared taxon lineages,
  missing provenance, invalid percentages and ambiguous samples fail clearly.
  Normalization defaults off. Evaluation is superkingdom through species; CAMI
  strain rows are explicitly excluded because this MetaPhlAn export has none.
- A completed process is not proof of scientific accuracy. Reference snapshot,
  novelty, taxonomy changes, abundance definitions and subsampling affect scores.
  Agree on per-rank/dataset acceptance thresholds before interpreting results.

Current scope limits: the runtime still uses primary `Sample.studyId` links, not
cohort-only `StudySample` memberships. For a comparison spanning several data
collections, link samples through the primary study relationship and make a
common study-level MetaPhlAn run; partial runs are not silently stitched together.
Graphical reference-file selection/sample mapping, cohort-native execution,
long-read profiling and a Kraken2/Bracken → CAMI conversion are follow-ups.

Verification on September 8: focused package/API/authorization/sidebar tests and
production TypeScript checking passed. The new Python runner contracts have
internal fixtures (not external API simulations or scientific evidence). Both
Nextflow workflows preview-compiled. The existing order execution chain passed
with simulate-reads, fastq-checksum and FastQC. Real OPAL 1.0.12 generated a report
from its official example reference/prediction files; this caught and fixed its
`results.html` output contract. This is not a completed MetaPhlAn → imported CAMI
benchmark: the real MetaPhlAn database and the user's matching Ground Truth still
need to be configured. See [verification notes](taxonomic-pipeline-verification.md).

## Remaining work / acceptance gates

Earlier foundation verification: 453 focused tests across 65 files and guided-installer assertions passed. After the name-first/store/study-free refinement: **222 focused tests across 34 files**, **11 isolated PostgreSQL import/migration tests**, and production TypeScript checking passed. A real 72.8 MiB ENA import of `ERR164407` completed through the new browser flow into “Public marine controls — UI check”, with the chosen name, source metadata, and no new study; its sequencing-data result link opened successfully. The earlier import and its study remain untouched. This is single-accession live evidence, not large-project or full CAMI download acceptance.

CAMI multi-selection/status refinement: **246 focused tests across 36 files** and **12 isolated PostgreSQL tests** passed. Coverage includes selection exclusions, partial previews/queue retries, a 20-sample UI batch, per-technology status, owner isolation, durable imported records and simultaneous duplicate submissions. A real browser preview of all 10 CAMI II Marine short-read archives succeeded and showed **51.68 GiB** combined; no bulk download was started. Full CAMI transfer acceptance remains outstanding.

- [x] One active sidebar and original shared data/study screens; no Canvas navigation.
- [x] Coexisting facility/CAMI/SRA modules and server-side input gates.
- [x] CAMI and ENA scientific publication into named shared data/sample/read records; study creation/linking is optional and separate.
- [x] Name-first Add sequencing data flow, visible bundled import-module catalog, and study-free completion links.
- [x] Retained source metadata and separate local metadata editing for imports.
- [x] Study-specific groups and access-scoped membership API without destructive reassignment.
- [x] Additive schema/legacy-record transition; no reset of the development database.
- [x] Focused unit/API/UI tests, isolated database invariants, bounded real ENA transfer and browser publication check.
- [ ] Local raw-read upload module, file-pairing UX and storage quota reservations. The old genome/archive uploader is deliberately unavailable.
- [ ] Federated source search, complete large-project selection/pagination and metadata mapping/validation UX. Current accession imports have explicit limits; they are not guaranteed whole-project imports.
- [x] Shared source-neutral pipeline UI, owner-scoped execution/progress, explicit imported read selection, and focused authorization/readiness tests.
- [x] MetaPhlAn short-read profiling and OPAL taxonomic benchmark packages with pinned tools and reference/provenance safeguards.
- [x] Manifest-declared database resources, existing-store setup/link/cancel UI, schema-driven parameter access and read-evidence gates; 2,124 focused checks passed.
- [ ] Cohort-native `StudySample` pipeline/report inputs, graphical benchmark reference/sample selection, and a complete real MetaPhlAn → imported CAMI acceptance run.
- [ ] Decouple the remaining legacy operational-role/data-sharing presets from capability assignment with an explicit migration. Module activation alone must never silently broaden data access. Existing research-private presets do not acquire center-wide operator authority.
- [ ] Module-derived onboarding checks throughout the entire checklist (older runtime checks are still preset-based), packaged first-use acceptance, updater/rollback verification and public installer synchronization.
- [ ] Full release build, complete repository test/coverage gates and large CAMI dataset transfer acceptance before release. Focused checks are not a claim that every repository test passes or that imported reads already run through all pipelines.
