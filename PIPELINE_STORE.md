# Pipeline Store Concept

## Overview

The Pipeline Store is a centralized catalog of bioinformatics pipelines that SeqDesk instances can browse, install, and update. It provides a modular system where pipelines are hosted on seqdesk.com and can be installed into local SeqDesk installations.

## Goals

1. **Discoverability** - Users can browse available pipelines on seqdesk.com
2. **Easy Installation** - One-click install from the admin panel
3. **Modularity** - Pipelines are self-contained packages
4. **Versioning** - Support multiple versions, updates, and rollbacks
5. **Categorization** - Organize pipelines by type, organism, data type
6. **Quality Assurance** - Verified pipelines with documentation

---

## Decision (MAG-first, extensible contract)

We will keep **only MAG working for now**, but enforce a **minimal integration contract** so new pipelines can be added without rewrites.

Core principles:
- **Single source of truth** for step IDs and process mapping lives in `definition.json`
- **Output resolver** is the only place that writes into the SeqDesk DB
- **Pipeline adapters** encapsulate pipeline-specific logic (samplesheet, output discovery)
- **MAG is the first and only pipeline wired initially**, but all new work must follow the contract

This is explicitly designed to keep MAG stable while making future pipelines additive.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        seqdesk.com                               │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐  │
│  │  Landing Page   │  │  Pipeline Store │  │   Store API     │  │
│  │                 │  │    /pipelines   │  │ /api/pipelines  │  │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘  │
│                              │                      │            │
│                              │    ┌─────────────────┘            │
│                              │    │                              │
│  ┌───────────────────────────▼────▼─────────────────────────┐   │
│  │              Vercel Blob Storage                          │   │
│  │  /pipelines/                                              │   │
│  │    ├── registry.json        (pipeline catalog)            │   │
│  │    ├── mag/                                               │   │
│  │    │   ├── manifest.json    (pipeline metadata)           │   │
│  │    │   ├── 3.0.0/                                         │   │
│  │    │   │   ├── definition.json   (workflow DAG)           │   │
│  │    │   │   ├── registry.json     (SeqDesk integration)    │   │
│  │    │   │   └── README.md         (documentation)          │   │
│  │    │   └── 3.1.0/                                         │   │
│  │    ├── rnaseq/                                            │   │
│  │    └── ampliseq/                                          │   │
│  └──────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
                              │
                              │ API calls
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                     SeqDesk Instance                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Admin Panel > Settings > Pipelines                      │    │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐      │    │
│  │  │ Installed   │  │  Available  │  │  Updates    │      │    │
│  │  │ Pipelines   │  │  (Store)    │  │  Available  │      │    │
│  │  └─────────────┘  └─────────────┘  └─────────────┘      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                              │                                   │
│  ┌───────────────────────────▼─────────────────────────────┐    │
│  │  Local Storage                                           │    │
│  │  /pipelines/                                             │    │
│  │    ├── mag/                                              │    │
│  │    │   ├── manifest.json                                 │    │
│  │    │   └── definition.json                               │    │
│  │    └── rnaseq/                                           │    │
│  │        └── definition.json                               │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Structures

### 1. Pipeline Registry (seqdesk.com/api/pipelines)

Central catalog of all available pipelines:

```json
{
  "version": "1.0",
  "lastUpdated": "2026-01-28",
  "pipelines": [
    {
      "id": "mag",
      "name": "MAG Pipeline",
      "shortDescription": "Metagenome-assembled genome analysis",
      "category": "metagenomics",
      "tags": ["nf-core", "assembly", "binning", "metagenomics"],
      "author": "nf-core",
      "latestVersion": "3.0.0",
      "versions": ["3.0.0", "2.5.0", "2.4.0"],
      "downloads": 1250,
      "rating": 4.8,
      "verified": true,
      "icon": "dna",
      "featured": true
    },
    {
      "id": "rnaseq",
      "name": "RNA-seq Pipeline",
      "shortDescription": "RNA sequencing analysis",
      "category": "transcriptomics",
      "tags": ["nf-core", "rna-seq", "differential-expression"],
      "author": "nf-core",
      "latestVersion": "3.14.0",
      "versions": ["3.14.0", "3.13.0"],
      "downloads": 3420,
      "rating": 4.9,
      "verified": true,
      "icon": "rna",
      "featured": true
    }
  ],
  "categories": [
    { "id": "metagenomics", "name": "Metagenomics", "description": "Microbial community analysis" },
    { "id": "transcriptomics", "name": "Transcriptomics", "description": "Gene expression analysis" },
    { "id": "genomics", "name": "Genomics", "description": "Genome assembly and annotation" },
    { "id": "amplicon", "name": "Amplicon", "description": "16S/ITS analysis" },
    { "id": "variant-calling", "name": "Variant Calling", "description": "SNP/Indel detection" },
    { "id": "qc", "name": "Quality Control", "description": "Data quality assessment" }
  ]
}
```

### 2. Pipeline Manifest (per pipeline)

Detailed information about a specific pipeline:

```json
{
  "id": "mag",
  "name": "MAG Pipeline",
  "fullDescription": "The nf-core/mag pipeline...",
  "category": "metagenomics",
  "author": {
    "name": "nf-core",
    "url": "https://nf-co.re",
    "email": "contact@nf-co.re"
  },
  "repository": "https://github.com/nf-core/mag",
  "documentation": "https://nf-co.re/mag",
  "license": "MIT",
  "versions": [
    {
      "version": "3.0.0",
      "releaseDate": "2026-01-15",
      "minNextflowVersion": "23.04.0",
      "minSeqDeskVersion": "0.1.5",
      "changelog": [
        "Added GTDB-Tk v2 support",
        "Improved binning algorithms",
        "Bug fixes"
      ],
      "downloadUrl": "https://seqdesk.com/api/pipelines/mag/3.0.0/download"
    }
  ],
  "requirements": {
    "minMemory": "16GB",
    "recommendedMemory": "64GB",
    "tools": ["nextflow", "conda"],
    "databases": ["GTDB", "CheckM"]
  },
  "screenshots": [
    "/pipelines/mag/screenshots/dag.png",
    "/pipelines/mag/screenshots/results.png"
  ],
  "relatedPipelines": ["ampliseq", "taxprofiler"]
}
```

### 3. Pipeline Package (downloadable)

What gets installed to a SeqDesk instance:

```
mag-3.0.0/
├── definition.json      # Workflow DAG (steps, dependencies)
├── registry.json        # SeqDesk integration (inputs, outputs, config)
├── README.md            # Documentation
└── meta.json            # Version info, checksums

---

## Integration Contract (Required to add a pipeline)

### A. Package files (store payload)
- `definition.json`
- `registry.json`
- `README.md`
- `meta.json` (version/checksums)

### B. definition.json (required fields)
This file is the **single source of truth** for steps and process mapping.

Required:
- `pipeline` (string, pipeline ID)
- `steps[]` with:
  - `id`, `name`, `category`, `dependsOn[]`
  - **`processMatchers[]`** (strings used to match Nextflow processes)
- `inputs[]` (list of input nodes)
- `outputs[]` with:
  - `id`, `fromStep`, `destination` (where it writes in SeqDesk)

Recommended:
- `version`, `authors`, `minNextflowVersion`, `parameterGroups`

**Example (step with process mapping):**
```json
{
  "id": "bin_qc",
  "name": "Bin Quality",
  "category": "qc",
  "dependsOn": ["bin_refinement"],
  "processMatchers": ["CHECKM", "BUSCO", "GUNC"]
}
```

### C. registry.json (required fields)
Pipeline configuration, requirements, and settings schema.

Required:
- `id`, `name`, `description`, `category`
- `requires` (reads/assemblies/bins/etc.)
- `input` (supportedScopes, minSamples, perSample requirements)
- `samplesheet.generator` (function name in adapter)
- `configSchema` and `defaultConfig`
- `outputs[]` (what the pipeline produces; maps to resolver)

### D. Pipeline adapter (code)
Each pipeline must provide:
- `validateInputs(studyId, sampleIds?)`
- `generateSamplesheet(studyId, sampleIds?, dataBasePath)`
- `discoverOutputs(runId, outputDir, samples)` → returns files + metadata

The adapter **does NOT write to the DB**. It only discovers output artifacts.

### E. Output resolver (code, shared)
Centralized mapping of `manifest.json.outputs[].destination` → DB writes.

Examples (initial support for MAG only):
- `sample_assemblies` → create `Assembly` records
- `sample_bins` → create `Bin` records
- `order_report`, `sample_qc`, `sample_metadata` → create `PipelineArtifact` rows

Future pipelines can add new destinations without changing adapters.
```

**definition.json** - Current format in `pipelines/mag/definition.json`

**registry.json** - Current format in `pipelines/mag/registry.json`

```json
{
  "id": "mag",
  "name": "MAG Pipeline",
  "description": "Metagenome assembly and binning",
  "category": "analysis",
  "version": "3.0.0",
  "website": "https://nf-co.re/mag",
  "requires": ["reads"],
  "outputs": [
    { "type": "data", "name": "assemblies" },
    { "type": "data", "name": "bins" },
    { "type": "report", "name": "multiqc" }
  ],
  "visibility": {
    "showToUsers": true,
    "userCanStart": true
  },
  "input": {
    "scope": "study",
    "minSamples": 1,
    "requiredData": ["reads"]
  },
  "configSchema": { /* JSON Schema for settings */ },
  "defaultConfig": { /* Default values */ },
  "icon": "dna"
}
```

---

## API Endpoints

### seqdesk.com API (Store)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/pipelines` | GET | List all pipelines (registry) |
| `/api/pipelines?category=metagenomics` | GET | Filter by category |
| `/api/pipelines?search=assembly` | GET | Search pipelines |
| `/api/pipelines/[id]` | GET | Get pipeline manifest |
| `/api/pipelines/[id]/[version]` | GET | Get specific version info |
| `/api/pipelines/[id]/[version]/download` | GET | Download pipeline package |
| `/api/pipelines/featured` | GET | Get featured pipelines |
| `/api/pipelines/categories` | GET | List categories |

### SeqDesk Instance API (Local)

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/admin/pipelines/installed` | GET | List installed pipelines |
| `/api/admin/pipelines/available` | GET | Fetch from store, show installable |
| `/api/admin/pipelines/install` | POST | Install a pipeline |
| `/api/admin/pipelines/uninstall` | POST | Remove a pipeline |
| `/api/admin/pipelines/update` | POST | Update to newer version |
| `/api/admin/pipelines/check-updates` | GET | Check for available updates |

---

## UI Components

### 1. Landing Page - Pipeline Store (`seqdesk.com/pipelines`)

```
┌────────────────────────────────────────────────────────────────┐
│  SeqDesk Pipeline Store                              [Search]  │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Featured Pipelines                                            │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐           │
│  │ [DNA icon]   │ │ [RNA icon]   │ │ [16S icon]   │           │
│  │ MAG Pipeline │ │ RNA-seq      │ │ Ampliseq     │           │
│  │ Metagenomics │ │ Transcriptom │ │ Amplicon     │           │
│  │ v3.0.0  ★4.8 │ │ v3.14 ★4.9  │ │ v2.8.0 ★4.7 │           │
│  └──────────────┘ └──────────────┘ └──────────────┘           │
│                                                                │
│  Categories                                                    │
│  [Metagenomics] [Transcriptomics] [Genomics] [Amplicon] [QC]  │
│                                                                │
│  All Pipelines                                    Sort: [Pop ▼]│
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ MAG Pipeline                              [View Details] │  │
│  │ Metagenome assembly and binning              v3.0.0     │  │
│  │ ★★★★★ 4.8 · 1,250 installs · nf-core                    │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ RNA-seq Pipeline                          [View Details] │  │
│  │ RNA sequencing analysis                      v3.14.0    │  │
│  │ ★★★★★ 4.9 · 3,420 installs · nf-core                    │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 2. Pipeline Detail Page (`seqdesk.com/pipelines/mag`)

```
┌────────────────────────────────────────────────────────────────┐
│  ← Back to Store                                               │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  [DNA Icon]  MAG Pipeline                                      │
│              Metagenome assembly and binning                   │
│              by nf-core · v3.0.0 · MIT License                 │
│                                                                │
│  ★★★★★ 4.8 (156 reviews) · 1,250 installs                     │
│                                                                │
│  [Install in SeqDesk]  [View on GitHub]  [Documentation]       │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  Overview │ Workflow │ Requirements │ Changelog │ Versions     │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Description                                                   │
│  The nf-core/mag pipeline assembles and bins metagenomes...   │
│                                                                │
│  [Workflow DAG Visualization]                                  │
│                                                                │
│  Key Features                                                  │
│  • Multiple assemblers (MEGAHIT, SPAdes, MetaSPAdes)          │
│  • Binning with MetaBAT2, MaxBin2                             │
│  • Bin quality assessment with CheckM, BUSCO                  │
│  • Taxonomic classification with GTDB-Tk                      │
│                                                                │
│  Requirements                                                  │
│  • Memory: 16GB minimum, 64GB recommended                     │
│  • Tools: Nextflow 23.04+, Conda                              │
│  • Databases: GTDB (optional), CheckM                         │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

### 3. Admin Panel - Pipelines (`/admin/settings/pipelines`)

```
┌────────────────────────────────────────────────────────────────┐
│  Pipelines                                                     │
├────────────────────────────────────────────────────────────────┤
│  [Installed] [Available] [Updates (2)]                         │
├────────────────────────────────────────────────────────────────┤
│                                                                │
│  Installed Pipelines                                           │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ ● MAG Pipeline                              [Enabled ✓]  │  │
│  │   v3.0.0 · Metagenomics                                  │  │
│  │   [Configure] [View DAG] [Update Available: 3.1.0]       │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
│  ─────────────────────────────────────────────────────────────│
│                                                                │
│  Available from Store                        [Browse Store →]  │
│  ┌─────────────────────────────────────────────────────────┐  │
│  │ RNA-seq Pipeline                           [Install]     │  │
│  │ v3.14.0 · Transcriptomics · nf-core                      │  │
│  ├─────────────────────────────────────────────────────────┤  │
│  │ Ampliseq                                   [Install]     │  │
│  │ v2.8.0 · Amplicon · nf-core                              │  │
│  └─────────────────────────────────────────────────────────┘  │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Installation Flow

```
1. User clicks "Install" on a pipeline
                │
                ▼
2. SeqDesk calls: POST /api/admin/pipelines/install
   { pipelineId: "rnaseq", version: "3.14.0" }
                │
                ▼
3. Server fetches from: seqdesk.com/api/pipelines/rnaseq/3.14.0/download
                │
                ▼
4. Server extracts to: pipelines/rnaseq/
   (manifest + definition + registry + samplesheet)
                │
                ▼
5. Server reloads pipeline definitions
                │
                ▼
6. Pipeline appears in admin panel as "Installed (Disabled)"
                │
                ▼
7. Admin enables and configures the pipeline
```

---

## File Structure Changes

### SeqDesk Instance

```
seqdesk/
├── pipelines/
│   ├── mag/
│   │   ├── manifest.json
│   │   ├── definition.json
│   │   ├── registry.json
│   │   └── samplesheet.yaml
│   └── rnaseq/
│       ├── manifest.json
│       ├── definition.json
│       ├── registry.json
│       └── samplesheet.yaml
```

### Landing Page (seqdesk.com)

```
seqdesk.com/
├── src/app/
│   ├── pipelines/
│   │   ├── page.tsx                 # Pipeline store listing
│   │   └── [id]/
│   │       └── page.tsx             # Pipeline detail page
│   └── api/
│       └── pipelines/
│           ├── route.ts             # GET /api/pipelines
│           └── [id]/
│               ├── route.ts         # GET /api/pipelines/[id]
│               └── [version]/
│                   ├── route.ts     # GET version info
│                   └── download/
│                       └── route.ts # GET download package
```

---

## Publishing Pipeline Flow (for maintainers)

```bash
# In SeqDesk repo, after adding/updating a pipeline:

npx tsx scripts/publish-pipeline.ts mag \
  --version 3.0.0 \
  --changelog "Added feature X" "Fixed bug Y"

# This will:
# 1. Validate definition.json and registry.json
# 2. Package into downloadable format
# 3. Upload to seqdesk.com via API
# 4. Update the central registry
```

---

## Migration Plan

### Phase 1: Foundation
1. Store pipeline packages in `pipelines/<id>/`
2. Load manifest/definition/registry/samplesheet from packages
3. Remove legacy definition loaders

---

## Implementation Status (MAG-first)

- Package files live in `pipelines/mag/` (manifest, definition, registry, samplesheet, parsers).
- Step mapping uses `processMatchers` in `pipelines/mag/definition.json` via `findStepByProcess`.
- Adapter: `src/lib/pipelines/adapters/mag.ts` (validation, samplesheet, output discovery).
- Output resolver: `src/lib/pipelines/output-resolver.ts` writes DB records based on manifest outputs.
- Completion flow uses adapter + resolver (see `src/lib/pipelines/mag/executor.ts` and the weblog route).

---

## Acceptance Criteria (for MAG)

- Progress tracking and step names still work (no regressions)
- MAG writes Assemblies and Bins via output resolver (no direct writes)
- All step IDs in `pipelines/mag/definition.json` match runtime step IDs
- `PipelineRun.results` contains a summary from the resolver

### Phase 2: Store API
1. Create `/api/pipelines` on seqdesk.com
2. Upload MAG pipeline to Blob storage
3. Create pipeline manifest format
4. Implement download endpoint

### Phase 3: Landing Page
1. Create `/pipelines` page on seqdesk.com
2. Create pipeline detail page
3. Add search and filtering

### Phase 4: SeqDesk Integration
1. Add "Available" tab to admin pipelines page
2. Implement install/uninstall API
3. Add update checking
4. Add pipeline version management

### Phase 5: Publishing
1. Create `publish-pipeline.ts` script
2. Add validation for pipeline packages
3. Documentation for contributors

---

## Security Considerations

1. **Signed Packages** - Pipeline packages should include checksums
2. **Version Pinning** - Allow admins to pin specific versions
3. **Source Verification** - Show whether pipeline is from nf-core or community
4. **Review System** - Pipelines marked as "verified" after review
5. **Sandboxing** - Pipelines run in isolated Nextflow environments

---

## Future Enhancements

1. **Private Pipelines** - Organizations can host private pipelines
2. **Pipeline Forks** - Users can create modified versions
3. **Dependency Management** - Auto-install required databases
4. **Usage Analytics** - Track which pipelines are popular
5. **Community Reviews** - Users can rate and review pipelines
6. **Auto-updates** - Option to automatically update pipelines

---

## Questions to Resolve

1. Should pipeline registry be in TypeScript or JSON?
   - **Decision**: JSON for flexibility and dynamic loading

2. How to handle breaking changes between pipeline versions?
   - **Recommendation**: Semantic versioning, migration guides

3. Should we support custom (non-nf-core) pipelines?
   - **Recommendation**: Yes, with "community" vs "verified" badges

4. How to handle large databases required by some pipelines?
   - **Recommendation**: Separate "database store" or documentation links

5. Offline installation support?
   - **Recommendation**: Allow manual upload of pipeline packages

6. Where are DB writes specified?
   - **Decision**: Output resolver is the single point of DB writes, driven by `definition.json.outputs[].destination`.
