# SeqDesk Figure 1

Publication-ready four-panel overview captured from the live SeqDesk demo on
2026-08-03. The screenshots use the disposable researcher and facility demo
workspaces at <https://demo.seqdesk.org>.

## Capture provenance

- Capture date: **2026-08-03**.
- Researcher demo entry point: <https://demo.seqdesk.org/demo>.
- Facility demo entry point: <https://demo.seqdesk.org/demo/admin>.
- Displayed application release: **v1.1.126**, visible in the source captures.
- The seven files under `screenshots/` are the original 1280 × 720 browser
  captures used by `build-figure.mjs`; the script embeds those bytes in the SVG
  and performs the documented crops and annotations.
- The workspaces were disposable demo sessions. No stable workspace key or
  source commit SHA was recorded with the captures, so the source screenshots
  and their hashes below—not the changing live demo—are the provenance anchors
  for this figure.
- The composition does not alter displayed values or manufacture enabled
  controls, accessions, pipeline results, or external-service responses.

## Files

- `seqdesk-figure-1.svg` — editable master with embedded screenshots
- `seqdesk-figure-1.png` — 4200 × 3150 px, 600 ppi manuscript raster
- `seqdesk-figure-1.tiff` — 4200 × 3150 px, LZW-compressed, 600 ppi
- `seqdesk-figure-1-preview.png` — 1600 × 1200 px review copy
- `seqdesk-figure-1-panel-a.png` through `panel-d.png` — separate panels
- `screenshots/` — uncropped live-demo captures
- `build-figure.mjs` — reproducible SVG and raster export script

## SHA-256 integrity record

These hashes describe the source captures, build script, and exports present in
this directory on 2026-08-04. Verify them from the repository root with
`shasum -a 256 -c <checksum-file>` after copying the block to a checksum file.

```text
fbd4cdcaedae4938d878f206d1a312490291736296ebdb3cd1072631d00c3da1  artifacts/figure-1/screenshots/panel-a-study-workflow.jpg
33c86963cc63c92c6e7a29d8bb7cb7f04d984bbb3b68f5e9758e26c26445e56b  artifacts/figure-1/screenshots/panel-b-checklist-selected.jpg
79e2c80ff14f0c5fb6a84f9a9b7cde4addbfbbddb95eb6eccf0bd158f1a3a2ad  artifacts/figure-1/screenshots/panel-b-field-search.jpg
69bddef05beceb5b4e99d3c5fcdc57fa0b2b142ef4d9713e0b8f71765a7fb3aa  artifacts/figure-1/screenshots/panel-c-mixs-table.jpg
079cdbdc5bde854e7cc5687666f428e479652109f640e61bee009d69fe5911c8  artifacts/figure-1/screenshots/panel-d-ena.jpg
8d2193296d6135667ebd5592cdb17b749c4634ed932ef5137e972f4b1d30b8db  artifacts/figure-1/screenshots/panel-d-facility-orders.jpg
2491d174fcd189d5857e4e7b711316e9bc3de4af00b1680113c6c790e191d79f  artifacts/figure-1/screenshots/panel-d-pipeline.jpg
5a15edacda6704a84ca48d2036ec2845e97ff75c7a0dcdf54d94de7795560c8f  artifacts/figure-1/build-figure.mjs
6707e97a1f7967d3c1e010ee51b774e7b338127fed970bf91ea52be2aa7659ec  artifacts/figure-1/seqdesk-figure-1.svg
b390d5b434a70e39667146360209b1ec1cfd1a94daaadadb5da4a39741481775  artifacts/figure-1/seqdesk-figure-1.png
9eaab7b3ffafbd3d9149966a6b7a8fda2dea49881aac777838b79f0aa1279eb6  artifacts/figure-1/seqdesk-figure-1.tiff
2b22801334f834deb7cc637e55a5bbd26138723421ae2f871f66a4aebfddc2b6  artifacts/figure-1/seqdesk-figure-1-preview.png
01758d44dd947aefc6e90d7573bb2eea5c65d3c3e38aef441d55fa8c37c7f4c0  artifacts/figure-1/seqdesk-figure-1-panel-a.png
90420dcc2f5f6b81e8d10a6fb992480b2c15dbb6e68185414701aefadae1658d  artifacts/figure-1/seqdesk-figure-1-panel-b.png
e83eca32bd288a31a523a7fc35ca0d7fbcf2dbbdd5da71fc45e71c5d1ede3e2f  artifacts/figure-1/seqdesk-figure-1-panel-c.png
2c4a3c6a4d0c86c95d529b9ce56522efdf3757dede929d681fd53ad37b1a3f1b  artifacts/figure-1/seqdesk-figure-1-panel-d.png
```

## Revised caption

**Figure 1. SeqDesk platform overview and key interfaces.** (A) A five-step
study workflow guides users from sample selection and study details through MIxS
environment selection, per-sample metadata entry, and final review. (B) The
registry-driven MIxS selector presents environment-specific checklists and
distinguishes required from optional fields, with field search and a live
selection count. (C) The spreadsheet-like metadata table supports keyboard
editing, XLSX import and export, and cell-level validation; required fields are
marked with asterisks. (D) The facility workspace links order and study tracking
with Nextflow analyses and ENA registration and data submission through SubMG.

## Alt text

Four-panel overview of SeqDesk showing the five-step study workflow, selection
of a MIxS environmental checklist and metadata fields, spreadsheet-style cohort
metadata editing, and the facility workspace for order tracking, Nextflow
analysis, and ENA registration.

## Manuscript accuracy notes

- The current table uses TanStack React Table and should be described as
  “spreadsheet-like,” not as Handsontable-powered.
- The MIxS interface provides searchable metadata fields after checklist
  selection; the checklist-card grid itself is not searched.
- The operational facility view is a workspace spanning orders, analysis, and
  publishing rather than a single admin dashboard.

Rebuild the exports from the repository root with:

```bash
node artifacts/figure-1/build-figure.mjs
```
