# Pipeline outputs in Explore

SeqDesk's results library is generated from pipeline packages and saved artifacts.
It does not select components by pipeline ID. Adding a pipeline that writes the
supported interchange formats requires no changes to the library's React code.

## Package-owned declarations

Keep discovery, normalization and scientific descriptions in the pipeline package.
`outputs[].result.preview` supplies a label, description and optional
`previewable: false`. The existing result kind and writeback policy still control
pipeline behavior; display metadata does not grant permissions or change inputs.

Declare an analyzable table using `outputs[].table`, for example:

```json
{
  "id": "measurements",
  "scope": "sample",
  "destination": "run_artifact",
  "type": "artifact",
  "discovery": { "pattern": "measurements/*.tsv", "matchSampleBy": "filename" },
  "table": {
    "label": "Measured abundance",
    "description": "Per-taxon percentages from this sample.",
    "tableKind": "taxon-abundance-long",
    "format": "tsv",
    "schemaId": "example.abundance",
    "schemaVersion": "1",
    "rowEntity": "sample-taxon",
    "roles": { "taxon": "organism", "value": "abundance" },
    "columns": {
      "organism": { "type": "string", "label": "Organism", "required": true },
      "abundance": {
        "type": "number", "label": "Relative abundance", "unit": "percent",
        "required": true, "nullable": false
      }
    }
  }
}
```

- Formats: TSV, CSV and JSON arrays of row objects. Existing comment and marked
  header options remain available for delimited files.
- Types: `string`, `number`, `boolean`, `date`, `json`. Numeric taxonomy IDs should
  normally be declared as strings: identifiers are not measurements.
- `required` concerns column presence; `nullable` concerns missing values. Missing
  measurements are never invented or treated as zero. An absent optional mate is valid.
- Units are explicit strings, compared exactly. `fraction`, `percent`, `reads` and
  `Phred` have different meanings; no automatic conversion or inference is performed.
- `schemaId`, `schemaVersion`, `rowEntity`, and table kinds use open identifiers,
  not a list of pipeline names. The producer owns schema versioning.
- `sampleColumn` identifies samples in a combined table. SeqDesk resolves and
  protects the actual sample record and cohort memberships itself.
- Small metric summaries are ordinary typed tables (often one row per sample or
  run). They use the same contract, not a separate pipeline-specific metrics UI.

For BAM, HDF5, AnnData, binary indexes or another tool-specific representation,
retain the original as a downloadable artifact. The package can add a normalization
step that writes a standard table/image/report. The manifest never executes a
renderer or parser inside the web server; no arbitrary frontend code is loaded.
Extend shared format handling only when a genuinely new interchange format is needed.

## Shared viewers

The library groups outputs by producer, with search and output-type filters:

- Declared tables: bounded preview, download and add to Explore.
- HTML/PDF reports: preview and download.
- PNG/JPEG/WebP/GIF images: preview and download.
- Everything else, including SVG/scripts: download only.

Preview requests use artifact IDs and an authorized scope, not caller-supplied
filesystem paths. Every request repeats access and realpath containment checks.
Table previews are bounded to 1 MiB, 10 rows and 30 columns. Large JSON tables are
download/add-only. HTML runs in an opaque sandbox with external network access
disabled; externally hosted assets may therefore require downloading the original.

## Template compatibility

Templates describe requirements independently of producer IDs:

```json
{
  "alias": "profiles",
  "label": "Abundance profiles",
  "requiredRoles": ["sample", "taxon", "value"],
  "requiredRoleTypes": { "value": { "type": "number", "unit": "percent" } }
}
```

Use `requiredColumns` for scripts that read literal column names. Optional
`schemaId`, `schemaVersions` and `rowEntity` constrain templates that rely on a
specific structure. Role-based templates work with different column names.

The library suggests installed templates from declarations; the newly built
dataset's actual schema is checked in the analysis wizard. The server checks the
same requirements, scope, versions, required bindings and empty tables **before**
creating a run or starting any process. Suggestions do not run a pipeline or an
analysis. A selected source is carried into the wizard for review, never silently
replaced with a different table.

The Python helper also accepts `save_table(..., columns=..., schema_id=...,
schema_version=..., row_entity=...)`. The same validation and column metadata
apply to derived tables, preserving labels and units through later analyses.

## Versioning and compatibility

- New table artifacts store their output declaration in `metadata.seqdeskOutput`
  at registration. A package update cannot reinterpret that saved declaration.
- Old artifacts without a snapshot use the installed manifest, then the existing
  legacy compatibility mapping. Do not expand that mapping for new pipelines.
- Different schema identities, versions, row meanings or units are not combined
  silently. The catalog separates those contracts; a mixed build is rejected.
- Library actions select an explicit producing run. Analysis creation from the
  wizard pins the dataset version. Existing reports are not rewritten by browsing,
  previewing or upgrading a package.
- New analysis revisions retain a copy of the template's requirements inside the
  versioned `inputs` JSON envelope. Legacy array-form bindings remain readable.
  Legacy analyses without a contract snapshot use the installed template's current
  requirements when run; they may need a freshly built, typed table.
- A missing or uninstalled package does not erase saved artifacts. Snapshotted
  tables remain usable; unknown legacy files remain downloadable.

No database schema migration, data reset, pipeline rerun or reference-database
download is needed for this feature.

## Editor-first data picker

Use **Edit → Browse data** in the page editor, or **Add data** on the canvas.
The same picker groups metadata, pipeline outputs, saved analysis results and
uploaded files. Pipeline-specific branches are not added to this interface.

- **Add table to page** inserts one table block into the page's existing draft;
  it uses the normal autosave/undo path instead of a competing report save.
- **Create chart** opens the table-first chart controls with the chosen source,
  readable labels, units and a preview. Confirming adds one editable chart;
  it never creates or runs an Explore analysis or a sequencing pipeline.
- **Values by sample** draws saved measurements. It does not sum duplicate labels
  or turn missing values into zeros. A distinguishing colour column can separate
  mates or repeated measurements. Category counts remains a separate chart type.
- Metadata and pipeline tables can be added to the page from their canvas cards,
  just like derived tables. Existing table settings and dashboard metrics survive
  canvas edits. Saves check the report version and never retry conflicts silently.
- A saved analysis figure can be reused without rerunning its analysis. Source
  run identities remain visible. Preview/download remain available for native files.
- Uploads use the existing file-import API inside the picker; the report editor
  stays mounted, preserving unsaved edits. Imported files appear under Your files.
- Analysis templates remain an optional **Use in an analysis** action. They open
  the normal setup page; execution still requires an explicit run action.

Chart setup holds the source schema/version seen when opened. A changed table
requires review rather than silently changing the selection. Charts themselves
retain the existing live-table behavior after they are added to the page. Previews
are bounded and disclose truncation; basic charts are not a substitute for a full
cohort analysis.

### Data-aware chart suggestions

The chart picker offers up to three suggested views using column roles, types,
units and the first 2,000 saved rows. It does not branch on pipeline names or table
kinds. The package's existing table declaration is enough; no new chart manifest
or frontend plugin is needed.

- Suggestions prefill axes and a readable, editable title. **Customize chart**
  retains the manual controls; manual choices survive background refreshes.
  Data-picker dialogs remain mounted when the sidebar changes between desktop
  and mobile layouts, preserving an open preview and its settings.
- Numeric identifiers are not measurements. Empty measurements are skipped,
  zero stays zero, and units are displayed without conversion.
- Repeated labels need a real distinguishing column for a values chart. Box
  plots are suggested only with multiple groups and at least two measured rows
  per group. These are table-row summaries, not assumptions about independent
  biological samples or statistical significance.
- Metadata category counts explicitly count rows, not samples or reads. Missing
  numeric measurements are not automatically reinterpreted as category counts.
- The picker shows declared row meaning and warns when suggestions use a partial
  table. It uses the same chart renderer for preview and the saved page.
- Choosing a suggestion changes only the preview. Only **Add chart to page**
  changes the report; browsing never starts a pipeline or analysis.

### Visual page layout

In edit mode, drag a block's handle to a highlighted insertion line, or use the
handle's arrow keys / existing move buttons. Hovering does not change the report;
only dropping commits a move. Full- and half-width blocks retain their settings.

The **+** controls add text, open chart setup, or open the same saved-data picker
at a chosen position. Insertion uses a block ID anchor, so an asynchronous preview
cannot mistake a shifted array index for the intended position. Missing anchors
are reported rather than silently appending elsewhere. Cancelling adds nothing.
These changes use the existing draft, autosave, conflict protection and Undo path;
they neither create new output formats nor run an analysis.

`playwright/tests/explore-report-composer.spec.ts` is an opt-in local save/Undo
test (`EXPLORE_LAYOUT_WRITE_TEST=1`, plus an existing `EXPLORE_LAYOUT_REPORT_ID`
to select a scope). It changes only a newly created scratch report, checks its
identity before deleting it, and preserves the scope's datasets and other reports.

## Legacy guided generations

The earlier report-generation wizard and reader progress panel are no longer
entry points in the UI. Their stored analyses, snapshots and report blocks are
preserved; finished figures/tables can be reused in the normal editor. Existing
analysis execution is not cancelled or restarted by this UI change. The underlying
compatibility code and optional template hints remain documented below.

Templates keep their existing `outputs` list. Optional presentation hints are
backward-compatible and declarative:

```json
{
  "outputs": [
    { "name": "distribution", "label": "Value distribution", "kind": "figure", "report": { "span": 1 } },
    { "name": "measurements", "label": "Measurements", "kind": "table" },
    { "name": "optional_comparison", "kind": "figure", "optional": true },
    { "name": "debug", "kind": "report", "report": { "include": false } }
  ],
  "report": {
    "introduction": "How to interpret these measurements.",
    "metrics": [{ "key": "sample_count", "label": "Samples", "digits": 0 }]
  }
}
```

Without hints, labels come from output names, declared figures and tables are
offered in declaration order, and blocks use full width. Metric keys must be
actual numeric run metrics; missing values are omitted, never fabricated as zero.
An optional absent output is skipped; missing required outputs show warnings.
Analysis notes and limitations can be included alongside the output blocks.
HTML/report files become authenticated download links, not executable components.

The first analysis revision snapshots the output hints as well as input contracts.
Inputs are version-pinned. An idempotency key scoped to the report and author gives
analysis creation and execution stable database identities. Retrying a lost
response reuses the request; changing its inputs requires a new key. Generation
progress is loaded from persisted analysis/run records on returning to the report;
GET requests never start or resume execution.

Completed generations offer a selection of **actual** finished items. Adding them
appends only missing block identities and checks `expectedUpdatedAt` atomically.
It does not replace existing text, block layout, filters or sharing settings.
A conflicting edit asks the user to review the refreshed report; it is never
silently retried. An edited or manually rerun analysis is handled through the
regular editor, not reapplied using its original guided selection.

The library separately shows **Available to add**, **In workspace**, and **On
report**. Membership is matched against actual current-version artifact and run
provenance. A mixed-run or partial dataset is not claimed as the selected run's
table. A table being available for analysis does not imply it is on the report
page. Report blocks retain the existing live-analysis behavior on later manual
reruns; pinned input versions do not make a report itself an immutable publication.

## Regression checks

The tests cover a user-contributed pipeline name, shared template matching,
FastQC's optional R2 values, differing units/schema versions, malformed values,
JSON tables, removed packages/files, pinned inputs, linked control samples,
foreign aggregates, duplicate sample labels, sandboxed previews and path escapes.
FastQC, MetaPhlAn, Bracken, NanoPlot and Read Cleaning demonstrate declarations
in their own manifests. They are examples, not branches in the shared viewer or
compatibility code. Tests load NanoPlot and Read Cleaning declarations under an
unregistered pipeline ID and a different output ID, then exercise source discovery,
sample mapping, provenance and chart rendering through the same shared code.

## Adding another pipeline without extending the report application

1. Keep the original outputs available as artifacts. Declare reportable standard
   tables using `outputs[].table`, including sample identity, row meaning, types,
   readable labels and units. Do not register pipeline names in Explore code.
2. If the source format is tool-specific, normalize it inside the pipeline
   package into TSV, CSV or JSON rows and declare that additional artifact.
   Read Cleaning's small discovery adapter demonstrates this; NanoPlot already
   writes a standard TSV and needs only a declaration. The report server does
   not invoke these scripts when a user browses or previews data.
3. Add package tests with clearly internal fixtures matching the real producer's
   output format, including missing values and invalid or ambiguous sample IDs.
   Validate the package with `npm run pipeline:validate -- pipelines/<id>`.
4. Verify discovery → preview → table/chart with the shared report tools. New
   table kinds and schema identifiers are allowed; unfamiliar binary formats
   remain downloadable rather than gaining an improvised parser or renderer.

Chart choices use column types and roles rather than a pipeline-ID switch.
Package descriptions must distinguish sample summaries from per-read or per-taxon
rows, and classification counts from removed-read counts. Missing denominators
must not become invented percentages. Optional analysis templates may require
specific roles, units and schemas, but adding a table or chart does not run them.

New pipelines should use this existing contract before proposing another plugin
layer, renderer API or report generator. Extend shared formats or chart capabilities
only for a demonstrated data shape that the current components cannot represent.
