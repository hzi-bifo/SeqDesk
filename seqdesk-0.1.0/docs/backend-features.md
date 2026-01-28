# Backend Features from V1 to Implement in V2

This document describes the pipeline execution system from V1 (Django) that needs to be implemented in V2 (Next.js). The immediate focus is **MAG pipeline integration**, while keeping the architecture extensible for future pipelines (e.g., SubMG submission).

**Current scope (V2 now):**
- Implement MAG pipeline end-to-end (run, track, parse outputs, show results).
- Provide a minimal DAG visualization for MAG runs (steps + artifacts).

**Later scope (future):**
- Add SubMG submission pipeline and other analyses.

---

## 1. Pipeline System Concepts

### 1.1 Pipeline Categories & Output Types

Pipelines serve different purposes and produce different types of outputs:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        PIPELINE CATEGORIES                                   │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  ANALYSIS PIPELINES                                                  │   │
│  │  Purpose: Generate data from raw sequencing files                    │   │
│  │  Examples: MAG (assemblies, bins), QC pipelines                      │   │
│  │                                                                      │   │
│  │  Outputs:                                                            │   │
│  │  • Data files (assemblies, bins, alignments) → stored, reusable     │   │
│  │  • Reports (QC, statistics) → viewable by admin/user                │   │
│  │  • Metrics (quality scores) → stored in database                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                      │                                      │
│                                      ▼                                      │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  SUBMISSION PIPELINES (Future)                                       │   │
│  │  Purpose: Submit data to external archives (ENA, NCBI, etc.)        │   │
│  │  Examples: SubMG (ENA metagenome submission)                         │   │
│  │                                                                      │   │
│  │  Requires: Outputs from analysis pipelines                          │   │
│  │                                                                      │   │
│  │  Outputs:                                                            │   │
│  │  • Accession numbers → stored on samples, reads, assemblies, bins   │   │
│  │  • Submission receipts → stored for audit trail                     │   │
│  │  • Validation reports → viewable                                    │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  QC PIPELINES (Future)                                               │   │
│  │  Purpose: Quality control and validation                             │   │
│  │  Examples: FastQC, MultiQC, CheckM                                   │   │
│  │                                                                      │   │
│  │  Outputs:                                                            │   │
│  │  • Quality reports (HTML, PDF) → viewable by admin/user             │   │
│  │  • Metrics → stored in database, shown in UI                        │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 1.2 Pipeline Dependencies & Data Flow

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           DATA FLOW                                           │
│                                                                               │
│   SEQUENCING                                                                  │
│   ┌─────────┐                                                                │
│   │ FASTQ   │ ─── Uploaded/Discovered by facility                            │
│   │ Files   │                                                                │
│   └────┬────┘                                                                │
│        │                                                                      │
│        ▼                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  MAG PIPELINE (Analysis)                                             │   │
│   │  Input:  Read files (R1, R2 FASTQ)                                  │   │
│   │  Output: Assemblies, Bins, Alignment files                          │   │
│   └────┬────────────────────────────────────────────────────────────────┘   │
│        │                                                                      │
│        │ Creates database records:                                           │
│        │ • Assembly records (linked to samples)                              │
│        │ • Bin records (linked to assemblies)                                │
│        │ • Alignment files (future DB model or artifact records)             │
│        │                                                                      │
│        ▼                                                                      │
│   ┌─────────────────────────────────────────────────────────────────────┐   │
│   │  SUBMG PIPELINE (Submission)                                         │   │
│   │  Input:  Reads + Assemblies (+ optional Bins)                        │   │
│   │          (from MAG or manual upload)                                 │   │
│   │  Output: ENA Accession Numbers                                      │   │
│   │                                                                      │   │
│   │  Requires:                                                          │   │
│   │  • Study must have ENA study accession (PRJEB...)                   │   │
│   │  • Samples must have metadata                                       │   │
│   │  • Reads must have checksums                                        │   │
│   │  • Assemblies required (MAG or manual upload)                       │   │
│   │  • Bins optional (MAG or manual upload)                             │   │
│   └────┬────────────────────────────────────────────────────────────────┘   │
│        │                                                                      │
│        │ Updates existing records with accessions:                           │
│        │ • Sample.sampleAccessionNumber (ERS...)                             │
│        │ • Sample.biosampleNumber (SAMEA...)                                 │
│        │ • Read.experimentAccessionNumber (ERX...)                           │
│        │ • Read.runAccessionNumber (ERR...)                                  │
│        │ • Assembly.assemblyAccession                                        │
│        │ • Bin.binAccession (if bins submitted)                              │
│        │                                                                      │
│        ▼                                                                      │
│   ┌─────────┐                                                                │
│   │ ENA     │ ─── Data publicly available                                    │
│   │ Archive │                                                                │
│   └─────────┘                                                                │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 1.3 Output Visibility & Access Control

Different outputs have different visibility levels:

| Output Type | Admin | Researcher | Notes |
|-------------|-------|------------|-------|
| Pipeline run status | ✓ | ✓ (own studies) | Users can see runs on their studies |
| Pipeline logs | ✓ | ✗ | Technical logs are admin-only |
| QC Reports (HTML) | ✓ | ✓ | Users can view/download |
| Data files (assemblies, bins) | ✓ | ✓ (paths only) | Users see metadata, admins see full paths |
| Accession numbers | ✓ | ✓ | Visible once submitted |
| Submission receipts | ✓ | ✗ | Internal audit trail |
| Error details | ✓ | Partial | Users see summary, admins see full trace |

### 1.4 Pipeline Output Storage

```
dataBasePath/
├── pipeline_runs/
│   ├── MAG-20240126-001/
│   │   ├── script.sh                    # Generated execution script
│   │   ├── samplesheet.csv              # Input samplesheet
│   │   ├── cluster_config.cfg           # Nextflow config
│   │   ├── output/                      # stdout
│   │   ├── error/                       # stderr
│   │   ├── Assembly/
│   │   │   └── MEGAHIT/
│   │   │       └── MEGAHIT-sample1.contigs.fa.gz
│   │   ├── GenomeBinning/
│   │   │   ├── MaxBin2/
│   │   │   │   └── Assembly_1/
│   │   │   │       └── Maxbin2_bins/
│   │   │   │           ├── MEGAHIT-MaxBin2-sample1.001.fa
│   │   │   │           └── MEGAHIT-MaxBin2-sample1.002.fa
│   │   │   └── QC/
│   │   │       └── checkm_summary.tsv
│   │   └── sample1.sorted.bam           # Alignments
│   │
│   └── SubMG-20240127-001/           # Future (after SubMG integration)
│       ├── script.sh
│       ├── config_0.yaml                # SubMG config
│       ├── staging/                     # Temp files during submission
│       └── logging/
│           ├── biological_samples/
│           │   └── sample_preliminary_accessions.txt
│           ├── reads/
│           │   └── webin-cli.report
│           └── bins/
│               └── bin_to_preliminary_accession.tsv
│
└── sequencing_files/                    # Raw FASTQ files (existing)
    └── study_xxx/
        ├── sample1_R1.fastq.gz
        └── sample1_R2.fastq.gz
```

---

## 2. Modular Pipeline Architecture

### 2.1 Overview

The pipeline system should be modular and configurable:

```
┌─────────────────────────────────────────────────────────────────────┐
│                         ADMIN SETTINGS                              │
│  Admin > Settings > Pipelines                                       │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Available Pipelines                                          │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│  │ │ [✓] MAG Pipeline (nf-core/mag)                          │ │   │
│  │ │     Metagenome assembly and binning                     │ │   │
│  │ │     [Configure]                                         │ │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│  │ │ [ ] SubMG Pipeline (ENA Submission)                     │ │   │
│  │ │     (Future)                                             │ │   │
│  │ │     [Configure]                                         │ │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│  │ │ [ ] Custom Pipeline (Future)                            │ │   │
│  │ │     Add your own analysis pipeline                      │ │   │
│  │ │     [Configure]                                         │ │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                         STUDY PAGE                                   │
│  When pipelines are enabled, show "Run Analysis" options            │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Study: My Metagenome Study                                   │   │
│  │ Samples: 10 | Reads: 20 files                                │   │
│  │                                                              │   │
│  │ Available Analyses:              [MAG only for now]          │   │
│  │ ┌──────────────┐                                           │   │
│  │ │ Run MAG      │                                           │   │
│  │ │ Pipeline     │                                           │   │
│  │ └──────────────┘                                           │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│                    SIDEBAR: ANALYSIS                                 │
│  New sidebar item showing all pipeline runs                         │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │ Analysis Runs                                     [+ New]    │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│  │ │ MAG-2024-01-26-001          Running   ████░░░░  45%     │ │   │
│  │ │ Study: My Metagenome Study                              │ │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  │ ┌─────────────────────────────────────────────────────────┐ │   │
│  │ │ MAG-2024-01-24-002          Failed    ✗                 │ │   │
│  │ │ Study: Test Study           [View Logs] [Retry]         │ │   │
│  │ └─────────────────────────────────────────────────────────┘ │   │
│  └─────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────┘
```

### 2.2 Pipeline Registry

Define pipelines in a registry that can be extended:

```typescript
// src/lib/pipelines/registry.ts

export type PipelineCategory = 'analysis' | 'submission' | 'qc';

// Output types determine how results are handled
export type OutputType =
  | 'data'           // Creates new records (assemblies, bins, alignment files)
  | 'accession'      // Updates existing records with accession numbers
  | 'report'         // Generates viewable reports (HTML, PDF)
  | 'metric';        // Stores metrics in database

export interface PipelineOutput {
  type: OutputType;
  name: string;                    // 'assemblies', 'bins', 'qc_report', etc.
  description: string;
  model?: string;                  // Prisma model name if creates/updates records
  visibility: 'admin' | 'user' | 'both';  // Who can see this output
  downloadable?: boolean;          // Can be downloaded as file
}

export interface PipelineDefinition {
  id: string;                      // Unique identifier: 'mag', 'submg', etc.
  name: string;                    // Display name: 'MAG Pipeline'
  description: string;             // Short description
  version: string;                 // Pipeline version
  category: PipelineCategory;

  // What this pipeline requires
  requires: {
    reads?: boolean;               // Needs sequencing reads
    assemblies?: boolean;          // Needs assemblies
    bins?: boolean;                // Needs bins
    checksums?: boolean;           // Needs file checksums calculated
    studyAccession?: boolean;      // Needs ENA study accession
    sampleMetadata?: boolean;      // Needs MIxS metadata filled
  };

  // Pipeline dependencies - must run after these pipelines
  dependsOn?: string[];            // e.g., ['mag'] for submg

  // What this pipeline produces (detailed)
  outputs: PipelineOutput[];

  // User visibility settings
  visibility: {
    showToUser: boolean;           // Show run status to researchers
    userCanStart: boolean;         // Can researchers start this pipeline?
  };

  // Configuration schema (JSON Schema format)
  configSchema: object;

  // Default configuration
  defaultConfig: object;

  // Icon for UI (lucide icon name)
  icon: string;
}

export const PIPELINE_REGISTRY: Record<string, PipelineDefinition> = {
  mag: {
    id: 'mag',
    name: 'MAG Pipeline',
    description: 'Metagenome assembly and genomic binning using nf-core/mag',
    version: '3.4.0',
    category: 'analysis',
    requires: {
      reads: true,
    },
    dependsOn: [],  // No dependencies - can run first
    outputs: [
      {
        type: 'data',
        name: 'assemblies',
        description: 'Assembled contigs from MEGAHIT',
        model: 'Assembly',
        visibility: 'both',
        downloadable: true,
      },
      {
        type: 'data',
        name: 'bins',
        description: 'Genome bins from MaxBin2',
        model: 'Bin',
        visibility: 'both',
        downloadable: true,
      },
      {
        type: 'data',
        name: 'alignments',
        description: 'Read alignments (BAM files) stored as files (no DB model yet)',
        visibility: 'admin',  // Admin only - large files
        downloadable: false,
      },
      {
        type: 'metric',
        name: 'bin_quality',
        description: 'CheckM completeness and contamination scores',
        model: 'Bin',
        visibility: 'both',
      },
      {
        type: 'report',
        name: 'checkm_report',
        description: 'CheckM quality assessment report',
        visibility: 'both',
        downloadable: true,
      },
    ],
    visibility: {
      showToUser: true,   // Users can see MAG run status
      userCanStart: false, // Only admin can start MAG
    },
    configSchema: {
      type: 'object',
      properties: {
        stubMode: { type: 'boolean', title: 'Test Mode (Stub)', default: false },
        skipProkka: { type: 'boolean', title: 'Skip Prokka', default: true },
        skipConcoct: { type: 'boolean', title: 'Skip CONCOCT', default: true },
      }
    },
    defaultConfig: {
      stubMode: false,
      skipProkka: true,
      skipConcoct: true,
    },
    icon: 'Dna',
  },
  // Future pipelines (SubMG, FastQC, etc.) can be added later
};
```

### 2.3 Tracking Pipeline Outputs

Track which pipeline run created or updated each record:

```typescript
// When MAG pipeline completes and creates an Assembly:
await db.assembly.create({
  data: {
    file: assemblyPath,
    assemblySoftware: 'MEGAHIT',
    sampleId: sample.id,
    // Track the source pipeline run
    createdByPipelineRunId: pipelineRun.id,
  },
});

// When SubMG pipeline completes and updates a Sample with accession:
await db.sample.update({
  where: { id: sample.id },
  data: {
    sampleAccessionNumber: 'ERS12345678',
    biosampleNumber: 'SAMEA12345678',
    // Track which pipeline run added this
    accessionAddedByPipelineRunId: pipelineRun.id,
  },
});
```

This allows:
- Showing "Created by MAG-20240126-001" on assembly details
- Re-running a pipeline and cleaning up old outputs
- Auditing what each pipeline run produced
- Rolling back a failed pipeline's partial outputs

---

### 2.4 Database Models for Pipeline Registry

```prisma
// Pipeline configuration (which pipelines are enabled)
model PipelineConfig {
  id          String   @id @default(cuid())
  pipelineId  String   @unique  // 'mag', 'submg', etc.
  enabled     Boolean  @default(false)
  config      String?  // JSON: pipeline-specific settings

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Generic pipeline run (works for any pipeline type)
model PipelineRun {
  id          String    @id @default(cuid())
  runNumber   String    @unique  // AUTO: MAG-2024-01-26-001
  pipelineId  String    // 'mag', 'submg', etc.
  status      String    @default("pending")  // pending, queued, running, completed, failed

  // Configuration used for this run
  config      String?   // JSON: snapshot of config at run time

  // Input references
  studyId     String?
  study       Study?    @relation(fields: [studyId], references: [id])

  // Execution details
  runFolder   String?   // Path to run output
  queueJobId  String?   // Task queue job ID

  // Progress tracking
  progress    Int?      // 0-100
  currentStep String?   // "Running MEGAHIT...", "Submitting to ENA..."

  // Timing
  queuedAt    DateTime?
  startedAt   DateTime?
  completedAt DateTime?

  // Logs (stored as paths for large outputs)
  outputPath  String?   // Path to stdout file
  errorPath   String?   // Path to stderr file
  outputTail  String?   // Last 100 lines of output (for quick preview)
  errorTail   String?   // Last 100 lines of error

  // Results summary (JSON)
  results     String?   // { assembliesCreated: 5, binsCreated: 20, accessions: {...} }

  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // Who started this run
  userId      String
  user        User      @relation(fields: [userId], references: [id])

  // Track outputs created by this run
  assembliesCreated  Assembly[]
  binsCreated        Bin[]
  // Alignment files can be tracked via a generic artifact model (see Section 2.5)
}

// Update Assembly to track source pipeline
model Assembly {
  // ... existing fields ...

  // Track which pipeline created this
  createdByPipelineRunId String?
  createdByPipelineRun   PipelineRun? @relation(fields: [createdByPipelineRunId], references: [id])
}

// Update Bin to track source pipeline
model Bin {
  // ... existing fields ...

  // Track which pipeline created this
  createdByPipelineRunId String?
  createdByPipelineRun   PipelineRun? @relation(fields: [createdByPipelineRunId], references: [id])
}

// Update Sample to track which pipeline added accessions
model Sample {
  // ... existing fields ...

  // Track which pipeline added the accession
  accessionAddedByPipelineRunId String?
}

// Update Read to track which pipeline added accessions
model Read {
  // ... existing fields ...

  // Track which pipeline added the accession
  accessionAddedByPipelineRunId String?
}
```

---

### 2.5 Pipeline Graph (Steps + Artifacts) and Visualization

To keep the system modular and extensible, represent pipelines as a DAG of steps
with typed inputs/outputs (artifacts). This enables:
- Reuse: the same step can be used across pipelines.
- Partial re-runs: retry only the failed step.
- Mix-and-match inputs: MAG outputs or manually uploaded assemblies/bins.
- A clean visualization surface (step graph + artifact nodes).

**Core concepts** (start with MAG steps only; keep data model generic for later pipelines)

```prisma
model PipelineRunStep {
  id            String   @id @default(cuid())
  pipelineRunId String
  stepId        String   // e.g., "assemble", "bin", "submit_reads"
  status        String   // pending, running, completed, failed, skipped
  startedAt     DateTime?
  completedAt   DateTime?
  outputPath    String?
  errorPath     String?
  outputTail    String?
  errorTail     String?
}

model PipelineArtifact {
  id              String   @id @default(cuid())
  type            String   // "reads", "assembly", "bins", "qc_report", ...
  path            String   // Absolute or relative path
  checksum        String?
  studyId         String?
  sampleId        String?
  producedByStepId String?
  metadata        String?  // JSON for tool-specific info
  createdAt       DateTime @default(now())
}
```

**Pipeline definition shape (conceptual)**

```ts
type PipelineStep = {
  id: string;
  name: string;
  inputs: string[];   // artifact types
  outputs: string[];  // artifact types
};

type PipelineDefinition = {
  id: string;
  steps: PipelineStep[]; // forms a DAG
  // ... existing fields
};
```

**Visualization idea**

- Render a graph for each run: steps as nodes, artifacts as edges or nodes.
- Show status colors (running/completed/failed), click to open logs or artifacts.
- Use a simple auto-layout; store layout hints in run metadata if needed.

---

## 3. Pipeline Specifications

### 3.1 Input Scope Options

Users/admins should be able to run pipelines on:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                        INPUT SCOPE OPTIONS                                   │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  WHOLE STUDY                                                         │  │
│   │  "Run MAG on all samples in this study"                             │  │
│   │                                                                      │  │
│   │  Study: My Metagenome Project                                       │  │
│   │  └── Sample 1 (reads: R1, R2) ──► Included                         │  │
│   │  └── Sample 2 (reads: R1, R2) ──► Included                         │  │
│   │  └── Sample 3 (reads: R1, R2) ──► Included                         │  │
│   │                                                                      │  │
│   │  Use case: Standard workflow, process everything                    │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  SELECTED SAMPLES                                                    │  │
│   │  "Run MAG on samples 1 and 3 only"                                  │  │
│   │                                                                      │  │
│   │  Study: My Metagenome Project                                       │  │
│   │  └── [✓] Sample 1 (reads: R1, R2) ──► Included                     │  │
│   │  └── [ ] Sample 2 (reads: R1, R2) ──► Excluded                     │  │
│   │  └── [✓] Sample 3 (reads: R1, R2) ──► Included                     │  │
│   │                                                                      │  │
│   │  Use case: Re-run failed samples, test on subset                    │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
│   ┌─────────────────────────────────────────────────────────────────────┐  │
│   │  SINGLE SAMPLE                                                       │  │
│   │  "Run FastQC on this sample"                                        │  │
│   │                                                                      │  │
│   │  Sample: Sample 1                                                   │  │
│   │  └── Read 1: sample1_R1.fastq.gz ──► Included                      │  │
│   │  └── Read 2: sample1_R2.fastq.gz ──► Included                      │  │
│   │                                                                      │  │
│   │  Use case: Quick QC check, debugging                                │  │
│   └─────────────────────────────────────────────────────────────────────┘  │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 3.2 Pipeline Input Interface

```typescript
// src/lib/pipelines/types.ts

export type InputScope = 'study' | 'samples' | 'sample';

export interface PipelineInput {
  scope: InputScope;
  studyId?: string;           // For 'study' scope
  sampleIds?: string[];       // For 'samples' scope (selected samples)
  sampleId?: string;          // For 'sample' scope (single sample)
}

// Extended pipeline definition
export interface PipelineDefinition {
  // ... existing fields ...

  // Input specification
  input: {
    // What scopes does this pipeline support?
    supportedScopes: InputScope[];

    // Minimum/maximum samples
    minSamples?: number;      // e.g., 1 for FastQC, 2 for co-assembly
    maxSamples?: number;      // e.g., 100 for large pipelines

    // What data is needed per sample?
    perSample: {
      reads: boolean;         // Needs FASTQ files
      pairedEnd: boolean;     // Requires paired-end reads
      assemblies?: boolean;   // Needs existing assemblies
      bins?: boolean;         // Needs existing bins
    };
  };

  // Samplesheet generation
  samplesheet: {
    format: 'csv' | 'tsv' | 'yaml' | 'filelist';
    generator: string;        // Function name to generate samplesheet
  };
}
```

### 3.3 nf-core Pipeline Specifications

#### MAG Pipeline (nf-core/mag) — Current Scope

```yaml
Pipeline: nf-core/mag
Version: 3.0.0+
Purpose: Metagenome assembly and binning
Website: https://nf-co.re/mag

Input:
  scope: study | samples
  minSamples: 1
  perSample:
    reads: true
    pairedEnd: true  # Can also handle single-end, but paired preferred

Samplesheet Format (CSV):
  columns:
    - sample       # Sample ID (unique)
    - group        # Group for co-assembly (optional)
    - short_reads_1  # Path to R1 FASTQ
    - short_reads_2  # Path to R2 FASTQ (empty for single-end)
    - long_reads     # Path to long reads (optional)

Example Samplesheet:
  sample,group,short_reads_1,short_reads_2,long_reads
  sample1,group1,/data/sample1_R1.fastq.gz,/data/sample1_R2.fastq.gz,
  sample2,group1,/data/sample2_R1.fastq.gz,/data/sample2_R2.fastq.gz,
  sample3,group2,/data/sample3_R1.fastq.gz,/data/sample3_R2.fastq.gz,

Outputs:
  - Assembly/MEGAHIT/{sample}.contigs.fa.gz
  - GenomeBinning/MaxBin2/{sample}/*.fa
  - GenomeBinning/QC/checkm_summary.tsv

Key Parameters:
  --input           # Samplesheet path
  --outdir          # Output directory
  --skip_spades     # Skip SPAdes assembler
  --skip_megahit    # Skip MEGAHIT assembler
  --skip_prokka     # Skip annotation
  --skip_binqc      # Skip bin QC
```

#### Future: FastQC Pipeline (standalone or nf-core/fetchngs)

```yaml
Pipeline: FastQC
Version: 0.12.1
Purpose: Quality control of raw sequencing data
Website: https://www.bioinformatics.babraham.ac.uk/projects/fastqc/

Input:
  scope: study | samples | sample
  minSamples: 1
  perSample:
    reads: true
    pairedEnd: false  # Works with any read type

Samplesheet Format (simple file list):
  # One file per line, or can process directory
  /data/sample1_R1.fastq.gz
  /data/sample1_R2.fastq.gz

Outputs:
  - {sample}_R1_fastqc.html
  - {sample}_R1_fastqc.zip
  - {sample}_R2_fastqc.html
  - {sample}_R2_fastqc.zip

Key Parameters:
  --threads         # Number of threads
  --outdir          # Output directory
```

#### Future: MultiQC (aggregation)

```yaml
Pipeline: MultiQC
Version: 1.21+
Purpose: Aggregate QC reports from multiple tools
Website: https://multiqc.info/

Input:
  scope: study
  # Runs on output directories from other pipelines
  requires:
    - FastQC outputs
    - Or other tool outputs (Kraken, CheckM, etc.)

Outputs:
  - multiqc_report.html
  - multiqc_data/

Key Parameters:
  --outdir          # Output directory
  --title           # Report title
```

#### Future: SubMG (ENA Submission)

Note: This pipeline is planned after MAG integration. The architecture below should remain compatible.

```yaml
Pipeline: SubMG
Version: 1.0.0
Purpose: Submit metagenome data to ENA
Website: https://github.com/ttubb/submg

Input:
  scope: study | samples
  minSamples: 1
  perSample:
    reads: true
    pairedEnd: true
    assemblies: true
    bins: false  # Optional but recommended

Config Format (YAML):
  STUDY:
    STUDY_ACCESSION: "PRJEB12345"

  SAMPLES:
    - SAMPLE_ID: "sample1"
      SCIENTIFIC_NAME: "metagenome"
      TAX_ID: "256318"
      # MIxS fields...

  READS:
    - SAMPLE_ID: "sample1"
      NAME: "sample1_reads"
      FILE_R1: "/data/sample1_R1.fastq.gz"
      FILE_R2: "/data/sample1_R2.fastq.gz"
      LIBRARY_SOURCE: "METAGENOMIC"
      LIBRARY_SELECTION: "RANDOM"
      LIBRARY_STRATEGY: "WGS"
      INSTRUMENT_MODEL: "Illumina NovaSeq 6000"

  ASSEMBLY:
    ASSEMBLY_NAME: "study_assembly"
    ASSEMBLY_SOFTWARE: "MEGAHIT"
    FASTA_FILE: "/data/assembly.fa.gz"

  BINS:
    BINS_DIRECTORY: "/data/bins/"
    COMPLETENESS_SOFTWARE: "CheckM"
    QUALITY_FILE: "/data/checkm_summary.tsv"

Outputs:
  - Accession numbers (stored in DB)
  - Submission receipts (XML)
  - Validation reports

Key Parameters:
  --config          # YAML config path
  --staging_dir     # Temp directory
  --logging_dir     # Log directory
  --submit_samples  # Submit sample metadata
  --submit_reads    # Submit read files
  --submit_assembly # Submit assembly
  --submit_bins     # Submit bins
```

### 3.4 Samplesheet Generation

```typescript
// src/lib/pipelines/samplesheet.ts

import { db } from '@/lib/db';
import { PipelineInput } from './types';

/**
 * Generate samplesheet for MAG pipeline
 */
export async function generateMagSamplesheet(
  input: PipelineInput,
  dataBasePath: string
): Promise<string> {
  // Get samples based on scope
  const samples = await getSamplesForInput(input);

  // CSV header
  const lines = ['sample,group,short_reads_1,short_reads_2,long_reads'];

  for (const sample of samples) {
    const reads = sample.reads[0]; // Assuming one read pair per sample
    if (!reads?.file1 || !reads?.file2) {
      throw new Error(`Sample ${sample.sampleId} is missing read files`);
    }

    // Convert relative paths to absolute
    const r1Path = path.join(dataBasePath, reads.file1);
    const r2Path = path.join(dataBasePath, reads.file2);

    // Group by study for co-assembly (or use sample ID)
    const group = sample.studyId || sample.sampleId;

    lines.push(`${sample.sampleId},${group},${r1Path},${r2Path},`);
  }

  return lines.join('\n');
}

/**
 * Generate config for SubMG pipeline
 */
export async function generateSubmgConfig(
  input: PipelineInput,
  dataBasePath: string
): Promise<string> {
  const samples = await getSamplesForInput(input);
  const study = await db.study.findUnique({
    where: { id: input.studyId },
  });

  if (!study?.studyAccessionId) {
    throw new Error('Study must have ENA accession before submission');
  }

  const config = {
    STUDY: {
      STUDY_ACCESSION: study.studyAccessionId,
    },
    SAMPLES: [],
    READS: [],
    ASSEMBLY: null,
    BINS: null,
  };

  for (const sample of samples) {
    // Add sample metadata
    const metadata = JSON.parse(sample.checklistData || '{}');
    config.SAMPLES.push({
      SAMPLE_ID: sample.sampleId,
      SCIENTIFIC_NAME: sample.scientificName || 'metagenome',
      TAX_ID: sample.taxId || '256318',
      ...metadata,
    });

    // Add reads
    for (const read of sample.reads) {
      config.READS.push({
        SAMPLE_ID: sample.sampleId,
        NAME: `${sample.sampleId}_reads`,
        FILE_R1: path.join(dataBasePath, read.file1),
        FILE_R2: path.join(dataBasePath, read.file2),
        CHECKSUM_METHOD: 'MD5',
        FILE_CHECKSUM_R1: read.checksum1,
        FILE_CHECKSUM_R2: read.checksum2,
        // From order metadata
        LIBRARY_SOURCE: 'METAGENOMIC',
        LIBRARY_SELECTION: sample.order.librarySelection || 'RANDOM',
        LIBRARY_STRATEGY: sample.order.libraryStrategy || 'WGS',
        INSTRUMENT_MODEL: sample.order.instrumentModel || 'Illumina NovaSeq 6000',
      });
    }

    // Add assemblies
    for (const assembly of sample.assemblies) {
      if (!config.ASSEMBLY) {
        config.ASSEMBLY = {
          ASSEMBLY_NAME: `${study.title}_assembly`,
          ASSEMBLY_SOFTWARE: assembly.assemblySoftware || 'MEGAHIT',
          FASTA_FILE: path.join(dataBasePath, assembly.file),
        };
      }
    }

    // Add bins
    if (sample.bins.length > 0) {
      const binDir = path.dirname(path.join(dataBasePath, sample.bins[0].file));
      config.BINS = {
        BINS_DIRECTORY: binDir,
        COMPLETENESS_SOFTWARE: sample.bins[0].completenessSoftware || 'CheckM',
        QUALITY_FILE: sample.bins[0].qualityFile
          ? path.join(dataBasePath, sample.bins[0].qualityFile)
          : null,
      };
    }
  }

  return yaml.stringify(config);
}

/**
 * Helper: Get samples based on input scope
 */
async function getSamplesForInput(input: PipelineInput) {
  let whereClause = {};

  switch (input.scope) {
    case 'study':
      whereClause = { studyId: input.studyId };
      break;
    case 'samples':
      whereClause = { id: { in: input.sampleIds } };
      break;
    case 'sample':
      whereClause = { id: input.sampleId };
      break;
  }

  return db.sample.findMany({
    where: whereClause,
    include: {
      reads: true,
      assemblies: true,
      bins: true,
      order: true,
    },
  });
}
```

### 3.5 Pipeline Registry with Input Specs

Update the registry to include input specifications (MAG only for now):

```typescript
export const PIPELINE_REGISTRY: Record<string, PipelineDefinition> = {
  mag: {
    id: 'mag',
    name: 'MAG Pipeline',
    // ... other fields ...

    input: {
      supportedScopes: ['study', 'samples'],
      minSamples: 1,
      maxSamples: 500,
      perSample: {
        reads: true,
        pairedEnd: true,
      },
    },

    samplesheet: {
      format: 'csv',
      generator: 'generateMagSamplesheet',
    },
  },
};

// Future pipelines (FastQC, SubMG, etc.) can add their own input specs later.
```

### 3.6 UI: Sample Selection for Pipeline Run

```tsx
// Component for selecting samples when starting a pipeline

function PipelineSampleSelector({
  study,
  pipeline,
  onSelectionChange,
}: {
  study: Study;
  pipeline: PipelineDefinition;
  onSelectionChange: (sampleIds: string[]) => void;
}) {
  const [scope, setScope] = useState<InputScope>('study');
  const [selectedSamples, setSelectedSamples] = useState<Set<string>>(new Set());

  const canSelectSamples = pipeline.input.supportedScopes.includes('samples');
  const canSelectSingle = pipeline.input.supportedScopes.includes('sample');

  return (
    <div>
      {/* Scope selector */}
      <div className="mb-4">
        <Label>Run on:</Label>
        <RadioGroup value={scope} onValueChange={setScope}>
          <RadioGroupItem value="study">
            All samples in study ({study.samples.length})
          </RadioGroupItem>
          {canSelectSamples && (
            <RadioGroupItem value="samples">
              Selected samples only
            </RadioGroupItem>
          )}
        </RadioGroup>
      </div>

      {/* Sample selector (if scope is 'samples') */}
      {scope === 'samples' && (
        <div className="border rounded-lg p-4">
          <div className="flex justify-between mb-2">
            <span>{selectedSamples.size} selected</span>
            <Button variant="link" onClick={selectAll}>Select all</Button>
          </div>

          <div className="max-h-64 overflow-y-auto">
            {study.samples.map(sample => (
              <div key={sample.id} className="flex items-center gap-2 py-1">
                <Checkbox
                  checked={selectedSamples.has(sample.id)}
                  onCheckedChange={(checked) => toggleSample(sample.id, checked)}
                />
                <span>{sample.sampleId}</span>
                {!sample.reads?.length && (
                  <Badge variant="outline" className="text-amber-600">
                    No reads
                  </Badge>
                )}
              </div>
            ))}
          </div>

          {selectedSamples.size < pipeline.input.minSamples && (
            <p className="text-destructive text-sm mt-2">
              Minimum {pipeline.input.minSamples} sample(s) required
            </p>
          )}
        </div>
      )}

      {/* Validation warnings */}
      <PipelineInputValidation
        samples={scope === 'study' ? study.samples : getSelectedSamples()}
        requirements={pipeline.input.perSample}
      />
    </div>
  );
}
```

---

## 4. ENA Integration & Submission Flow (Future)

This section documents the planned SubMG submission flow. It is not part of the initial MAG-only implementation.

### 4.1 How Pipelines Communicate with ENA

The SubMG pipeline handles all ENA communication:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                      ENA SUBMISSION FLOW                                      │
│                                                                               │
│   USER ACTIONS                          SYSTEM ACTIONS                        │
│   ─────────────                         ──────────────                        │
│                                                                               │
│   1. Create Study  ──────────────────►  Store in DB                          │
│                                                                               │
│   2. Add Samples   ──────────────────►  Store with MIxS metadata             │
│                                                                               │
│   3. Upload/Discover Reads ──────────►  Link to samples, calc checksums      │
│                                                                               │
│   4. (Admin) Run MAG Pipeline ───────►  Creates assemblies, bins             │
│                                                                               │
│   5. Mark Study "Ready for            ┌─────────────────────────────────┐   │
│      Submission" ────────────────────►│ Validate all requirements:      │   │
│                                       │ • Study has ENA accession?      │   │
│                                       │ • All samples have metadata?    │   │
│                                       │ • All reads have checksums?     │   │
│                                       │ • Assemblies present?           │   │
│                                       │ • Bins present? (optional)      │   │
│                                       └─────────────────────────────────┘   │
│                                                                               │
│   6. (Admin) Run SubMG Pipeline                                              │
│      ┌────────────────────────────────────────────────────────────────────┐ │
│      │  SubMG Execution:                                                   │ │
│      │  • Reads ENA credentials from settings                             │ │
│      │  • Generates YAML config from DB data                              │ │
│      │  • Calls SubMG CLI tool                                            │ │
│      │  • SubMG submits to ENA API                                        │ │
│      │  • Parses response for accession numbers                           │ │
│      │  • Updates Sample, Read, Assembly, Bin records                     │ │
│      └────────────────────────────────────────────────────────────────────┘ │
│                                                                               │
│   7. View Accessions  ◄──────────────  Accessions displayed on study page   │
│                                                                               │
└──────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Prerequisites Check Before Submission

Before SubMG pipeline can run, validate:

```typescript
// src/lib/pipelines/submg/prerequisites.ts

export interface SubmissionPrerequisites {
  studyAccession: boolean;      // Study must have PRJEB... accession
  samplesHaveMetadata: boolean; // All samples have required MIxS fields
  samplesHaveTaxId: boolean;    // ENA requires TAX_ID for each sample
  readsHaveChecksums: boolean;  // MD5 calculated for all FASTQ files
  assembliesExist: boolean;     // At least one assembly per sample
  binsExist: boolean;           // Bins generated (optional for some)
  issues: string[];             // List of blocking issues
}

export async function checkSubmissionPrerequisites(
  studyId: string
): Promise<SubmissionPrerequisites> {
  const study = await db.study.findUnique({
    where: { id: studyId },
    include: {
      samples: {
        include: {
          reads: true,
          assemblies: true,
          bins: true,
        },
      },
    },
  });

  const issues: string[] = [];

  if (!study.studyAccessionId) {
    issues.push('Study must be registered with ENA first (needs PRJEB accession)');
  }

  // Check each sample
  for (const sample of study.samples) {
    if (!sample.checklistData) {
      issues.push(`Sample ${sample.sampleId} is missing metadata`);
    }
    if (!sample.taxId) {
      issues.push(`Sample ${sample.sampleId} is missing TAX_ID`);
    }

    for (const read of sample.reads) {
      if (!read.checksum1 || !read.checksum2) {
        issues.push(`Sample ${sample.sampleId} has reads without checksums`);
      }
    }

    if (sample.assemblies.length === 0) {
      issues.push(`Sample ${sample.sampleId} has no assembly`);
    }
  }

  return {
    studyAccession: !!study.studyAccessionId,
    samplesHaveMetadata: study.samples.every(s => s.checklistData),
    samplesHaveTaxId: study.samples.every(s => s.taxId),
    readsHaveChecksums: study.samples.every(s =>
      s.reads.every(r => r.checksum1 && r.checksum2)
    ),
    assembliesExist: study.samples.every(s => s.assemblies.length > 0),
    binsExist: study.samples.some(s => s.bins.length > 0),
    issues,
  };
}
```

### 4.3 Accession Number Storage

After successful submission, accessions are stored on existing records:

```typescript
// Update records with accession numbers from SubMG output

// Sample accessions
await db.sample.update({
  where: { id: sampleId },
  data: {
    sampleAccessionNumber: 'ERS12345678',      // Sample accession
    biosampleNumber: 'SAMEA12345678',          // BioSample accession
    accessionAddedByPipelineRunId: runId,
  },
});

// Read/Experiment accessions
await db.read.update({
  where: { id: readId },
  data: {
    experimentAccessionNumber: 'ERX12345678',  // Experiment
    runAccessionNumber: 'ERR12345678',         // Run
    accessionAddedByPipelineRunId: runId,
  },
});

// Assembly accession
await db.assembly.update({
  where: { id: assemblyId },
  data: {
    assemblyAccession: 'GCA_12345678',
    submitted: true,
  },
});

// Bin accessions
await db.bin.update({
  where: { id: binId },
  data: {
    binAccession: 'SAMEA87654321',
    submitted: true,
  },
});
```

---

## 5. User-Facing Features

Some items below (ENA submission status/accessions) are future and will apply after SubMG is added.

### 5.1 Researcher View

Researchers can see pipeline activity on their own studies:

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  STUDY: My Metagenome Project                                                │
│  ─────────────────────────────────────────────────────────────────────────   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Analysis Status                                                     │   │
│  │                                                                      │   │
│  │  ┌─────────────────────┬───────────┬────────────────────────────┐  │   │
│  │  │ Pipeline            │ Status    │ Details                    │  │   │
│  │  ├─────────────────────┼───────────┼────────────────────────────┤  │   │
│  │  │ MAG Assembly        │ Completed │ 10 assemblies, 45 bins     │  │   │
│  │  │                     │ Jan 25    │ [View Report]              │  │   │
│  │  ├─────────────────────┼───────────┼────────────────────────────┤  │   │
│  │  │ ENA Submission      │ Running   │ Submitting reads...        │  │   │
│  │  │                     │ 65%       │ Started 10 min ago         │  │   │
│  │  └─────────────────────┴───────────┴────────────────────────────┘  │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
│  ┌─────────────────────────────────────────────────────────────────────┐   │
│  │  Accession Numbers (after submission)                                │   │
│  │                                                                      │   │
│  │  Study: PRJEB12345                                                  │   │
│  │  Samples: ERS111, ERS112, ERS113 ... (10 total)                     │   │
│  │  Reads: ERR111, ERR112, ERR113 ... (10 total)                       │   │
│  │  Assemblies: GCA_001, GCA_002 ... (10 total)                        │   │
│  │                                                        [Export CSV] │   │
│  └─────────────────────────────────────────────────────────────────────┘   │
│                                                                              │
└─────────────────────────────────────────────────────────────────────────────┘
```

### 5.2 What Users Can vs Cannot Do

| Action | Researcher | Facility Admin |
|--------|------------|----------------|
| View pipeline status on own studies | Yes | Yes (all) |
| View pipeline logs | No | Yes |
| Start MAG pipeline | No | Yes |
| Start ENA submission | No | Yes |
| Download QC reports | Yes | Yes |
| Download assemblies/bins | Yes (metadata) | Yes (full paths) |
| View accession numbers | Yes | Yes |
| Export accessions as CSV | Yes | Yes |
| Cancel running pipeline | No | Yes |
| Retry failed pipeline | No | Yes |

### 5.3 Notifications

Users should be notified when:
- Pipeline starts on their study
- Pipeline completes (success or failure)
- Accession numbers are available

```typescript
// Example notification triggers
interface PipelineNotification {
  type: 'pipeline_started' | 'pipeline_completed' | 'pipeline_failed' | 'accessions_ready';
  userId: string;
  studyId: string;
  pipelineRunId: string;
  message: string;
}
```

---

## 6. Admin Settings: Pipelines Page

### 6.1 Route Structure

```
/admin/settings/pipelines     - Pipeline configuration page
```

### 6.2 UI Components

**Pipeline Settings Page** (`/admin/settings/pipelines/page.tsx`):

```tsx
export default function PipelineSettingsPage() {
  return (
    <PageContainer>
      <h1>Pipeline Configuration</h1>
      <p>Enable and configure analysis pipelines</p>

      {/* Global Settings */}
      <GlassCard>
        <h2>Execution Settings</h2>
        <form>
          <Checkbox label="Use SLURM for job submission" />
          <Input label="SLURM Queue/Partition" placeholder="cpu" />
          <Input label="CPU Cores" type="number" placeholder="4" />
          <Input label="Memory" placeholder="64GB" />
          <Input label="Time Limit (hours)" type="number" placeholder="12" />
          <Input label="Conda Path" placeholder="/net/conda" />
        </form>
      </GlassCard>

      {/* Pipeline List */}
      <GlassCard>
        <h2>Available Pipelines</h2>
        {Object.values(PIPELINE_REGISTRY).map(pipeline => (
          <PipelineConfigCard key={pipeline.id} pipeline={pipeline} />
        ))}
      </GlassCard>
    </PageContainer>
  );
}

function PipelineConfigCard({ pipeline }: { pipeline: PipelineDefinition }) {
  const [enabled, setEnabled] = useState(false);
  const [configOpen, setConfigOpen] = useState(false);

  return (
    <div className="border rounded-lg p-4 mb-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Switch checked={enabled} onCheckedChange={setEnabled} />
          <div>
            <h3 className="font-medium">{pipeline.name}</h3>
            <p className="text-sm text-muted-foreground">{pipeline.description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={pipeline.category === 'analysis' ? 'default' : 'secondary'}>
            {pipeline.category}
          </Badge>
          <Button variant="outline" size="sm" onClick={() => setConfigOpen(true)}>
            Configure
          </Button>
        </div>
      </div>

      {/* Configuration Dialog */}
      <Dialog open={configOpen} onOpenChange={setConfigOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Configure {pipeline.name}</DialogTitle>
          </DialogHeader>
          {/* Render form based on pipeline.configSchema */}
          <PipelineConfigForm schema={pipeline.configSchema} />
        </DialogContent>
      </Dialog>
    </div>
  );
}
```

### 6.3 API Endpoints

```
GET  /api/admin/settings/pipelines
     Returns all pipeline configs with enabled status

POST /api/admin/settings/pipelines/[pipelineId]
     Enable/disable and configure a pipeline
     Body: { enabled: boolean, config: object }
```

---

## 7. Study Page Integration

### 7.1 Show Available Analyses

On the study detail page, show enabled pipelines as action buttons:

```tsx
// In study detail page
function StudyAnalysisSection({ study }: { study: Study }) {
  const { data: enabledPipelines } = useSWR('/api/admin/settings/pipelines?enabled=true');

  // Filter pipelines that can run on this study
  const availablePipelines = enabledPipelines?.filter(p => {
    const def = PIPELINE_REGISTRY[p.pipelineId];
    if (def.requires.reads && !study.hasReads) return false;
    if (def.requires.assemblies && !study.hasAssemblies) return false;
    if (def.requires.studyAccession && !study.studyAccessionId) return false;
    return true;
  });

  if (!availablePipelines?.length) return null;

  return (
    <GlassCard>
      <h2>Run Analysis</h2>
      <p className="text-muted-foreground mb-4">
        Select an analysis pipeline to run on this study's data
      </p>

      <div className="grid grid-cols-2 gap-4">
        {availablePipelines.map(pipeline => {
          const def = PIPELINE_REGISTRY[pipeline.pipelineId];
          return (
            <Button
              key={pipeline.pipelineId}
              variant="outline"
              className="h-auto p-4 flex flex-col items-start"
              onClick={() => openRunDialog(pipeline.pipelineId)}
            >
              <div className="flex items-center gap-2 mb-2">
                <Icon name={def.icon} className="h-5 w-5" />
                <span className="font-medium">{def.name}</span>
              </div>
              <span className="text-sm text-muted-foreground text-left">
                {def.description}
              </span>
            </Button>
          );
        })}
      </div>
    </GlassCard>
  );
}
```

### 7.2 Run Dialog

When clicking a pipeline button, show a dialog to configure and start the run:

```tsx
function RunPipelineDialog({
  pipeline,
  study,
  open,
  onOpenChange
}: {
  pipeline: PipelineDefinition;
  study: Study;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [config, setConfig] = useState(pipeline.defaultConfig);
  const [running, setRunning] = useState(false);

  const handleStart = async () => {
    setRunning(true);
    try {
      const res = await fetch(`/api/pipelines/${pipeline.id}/runs`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          studyId: study.id,
          config,
        }),
      });
      const run = await res.json();
      // Redirect to analysis page
      router.push(`/dashboard/analysis/${run.id}`);
    } catch (err) {
      // Handle error
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Run {pipeline.name}</DialogTitle>
          <DialogDescription>
            Configure and start the analysis for "{study.title}"
          </DialogDescription>
        </DialogHeader>

        {/* Study Summary */}
        <div className="bg-muted/50 rounded-lg p-3 mb-4">
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Samples: <strong>{study.sampleCount}</strong></div>
            <div>Read Files: <strong>{study.readCount}</strong></div>
            {study.assemblyCount > 0 && (
              <div>Assemblies: <strong>{study.assemblyCount}</strong></div>
            )}
          </div>
        </div>

        {/* Pipeline Options */}
        <PipelineConfigForm
          schema={pipeline.configSchema}
          value={config}
          onChange={setConfig}
        />

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleStart} disabled={running}>
            {running ? <Loader2 className="animate-spin mr-2" /> : null}
            Start Analysis
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
```

---

## 8. Sidebar: Analysis Page

### 8.1 Add to Sidebar

Add new sidebar item for facility admins:

```tsx
// In sidebar component
const sidebarItems = [
  // ... existing items
  {
    title: "Analysis",
    href: "/dashboard/analysis",
    icon: FlaskConical,
    adminOnly: true,  // Only show for facility admins
  },
];
```

### 8.2 Analysis Dashboard Page

Create `/dashboard/analysis/page.tsx`:

```tsx
export default function AnalysisDashboardPage() {
  const { data: runs, isLoading } = useSWR('/api/pipelines/runs');

  return (
    <PageContainer>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1>Analysis Runs</h1>
          <p className="text-muted-foreground">
            Monitor and manage pipeline executions
          </p>
        </div>
        <Button>
          <Plus className="mr-2 h-4 w-4" />
          New Analysis
        </Button>
      </div>

      {/* Filters */}
      <div className="flex gap-4 mb-6">
        <Select defaultValue="all">
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Pipeline" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Pipelines</SelectItem>
            <SelectItem value="mag">MAG Pipeline</SelectItem>
          </SelectContent>
        </Select>

        <Select defaultValue="all">
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="Status" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Status</SelectItem>
            <SelectItem value="running">Running</SelectItem>
            <SelectItem value="completed">Completed</SelectItem>
            <SelectItem value="failed">Failed</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {/* Runs Table */}
      <GlassCard className="p-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Run ID</TableHead>
              <TableHead>Pipeline</TableHead>
              <TableHead>Study</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Started</TableHead>
              <TableHead>Duration</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs?.map(run => (
              <TableRow key={run.id}>
                <TableCell className="font-mono">{run.runNumber}</TableCell>
                <TableCell>
                  <div className="flex items-center gap-2">
                    <Icon name={PIPELINE_REGISTRY[run.pipelineId]?.icon} />
                    {PIPELINE_REGISTRY[run.pipelineId]?.name}
                  </div>
                </TableCell>
                <TableCell>
                  <Link href={`/dashboard/studies/${run.studyId}`}>
                    {run.study?.title}
                  </Link>
                </TableCell>
                <TableCell>
                  <PipelineStatusBadge status={run.status} />
                </TableCell>
                <TableCell>{formatDate(run.startedAt)}</TableCell>
                <TableCell>{formatDuration(run.startedAt, run.completedAt)}</TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="sm">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent>
                      <DropdownMenuItem>
                        <Eye className="mr-2 h-4 w-4" /> View Details
                      </DropdownMenuItem>
                      <DropdownMenuItem>
                        <FileText className="mr-2 h-4 w-4" /> View Logs
                      </DropdownMenuItem>
                      {run.status === 'failed' && (
                        <DropdownMenuItem>
                          <RefreshCw className="mr-2 h-4 w-4" /> Retry
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </GlassCard>
    </PageContainer>
  );
}
```

### 8.3 Analysis Run Detail Page

Create `/dashboard/analysis/[id]/page.tsx`:

```tsx
export default function AnalysisRunDetailPage({ params }: { params: { id: string } }) {
  const { data: run } = useSWR(`/api/pipelines/runs/${params.id}`);

  if (!run) return <Loading />;

  const pipeline = PIPELINE_REGISTRY[run.pipelineId];

  return (
    <PageContainer maxWidth="medium">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
          <Icon name={pipeline.icon} className="h-6 w-6 text-primary" />
        </div>
        <div>
          <h1 className="text-2xl font-bold">{run.runNumber}</h1>
          <p className="text-muted-foreground">{pipeline.name}</p>
        </div>
        <div className="ml-auto">
          <PipelineStatusBadge status={run.status} size="lg" />
        </div>
      </div>

      {/* Progress (if running) */}
      {run.status === 'running' && (
        <GlassCard className="mb-6">
          <h2>Progress</h2>
          <Progress value={run.progress || 0} className="mt-2" />
          <p className="text-sm text-muted-foreground mt-2">
            {run.currentStep || 'Processing...'}
          </p>
        </GlassCard>
      )}

      {/* Study Info */}
      <GlassCard className="mb-6">
        <h2>Study</h2>
        <Link href={`/dashboard/studies/${run.studyId}`} className="text-primary">
          {run.study?.title}
        </Link>
        <div className="grid grid-cols-3 gap-4 mt-4 text-sm">
          <div>Samples: {run.study?.sampleCount}</div>
          <div>Reads: {run.study?.readCount}</div>
          <div>Started by: {run.user?.email}</div>
        </div>
      </GlassCard>

      {/* Configuration */}
      <GlassCard className="mb-6">
        <h2>Configuration</h2>
        <pre className="bg-muted p-3 rounded text-xs overflow-auto">
          {JSON.stringify(JSON.parse(run.config || '{}'), null, 2)}
        </pre>
      </GlassCard>

      {/* Results (if completed) */}
      {run.status === 'completed' && run.results && (
        <GlassCard className="mb-6">
          <h2>Results</h2>
          <PipelineResults run={run} />
        </GlassCard>
      )}

      {/* Logs */}
      <GlassCard>
        <div className="flex items-center justify-between mb-4">
          <h2>Logs</h2>
          <Button variant="outline" size="sm">
            <Download className="mr-2 h-4 w-4" /> Download
          </Button>
        </div>
        <Tabs defaultValue="output">
          <TabsList>
            <TabsTrigger value="output">Output</TabsTrigger>
            <TabsTrigger value="error">Error</TabsTrigger>
          </TabsList>
          <TabsContent value="output">
            <LogViewer content={run.output} />
          </TabsContent>
          <TabsContent value="error">
            <LogViewer content={run.error} />
          </TabsContent>
        </Tabs>
      </GlassCard>
    </PageContainer>
  );
}
```

---

## 9. API Endpoints

### 9.1 Pipeline Configuration

```
GET  /api/admin/settings/pipelines
     Returns: { pipelines: [{ pipelineId, enabled, config }] }

POST /api/admin/settings/pipelines/[pipelineId]
     Body: { enabled: boolean, config: object }
     Returns: { success: true }
```

### 9.2 Pipeline Runs

```
GET  /api/pipelines/runs
     Query: ?pipelineId=mag&status=running&studyId=xxx
     Returns: { runs: PipelineRun[] }

GET  /api/pipelines/runs/[id]
     Returns: PipelineRun with full details

POST /api/pipelines/[pipelineId]/runs
     Body: { studyId, config }
     Creates a new run and queues it
     Returns: { id, runNumber, status: 'queued' }

POST /api/pipelines/runs/[id]/cancel
     Cancels a running pipeline

POST /api/pipelines/runs/[id]/retry
     Retries a failed pipeline
```

### 9.3 Execution Settings

```
GET  /api/admin/settings/pipelines/execution
     Returns: { useSlurm, slurmQueue, slurmCores, ... }

POST /api/admin/settings/pipelines/execution
     Body: { useSlurm, slurmQueue, ... }
```

---

## 10. File Structure

```
v2/src/
├── lib/
│   └── pipelines/
│       ├── registry.ts           # Pipeline definitions
│       ├── types.ts              # TypeScript types
│       ├── executor.ts           # Base executor class
│       ├── mag/
│       │   ├── executor.ts       # MAG-specific execution logic
│       │   ├── samplesheet.ts    # Samplesheet generation
│       │   └── results.ts        # Result parsing
│       └── future/
│           └── submg/            # Placeholder for future SubMG integration
│
├── app/
│   ├── admin/
│   │   └── settings/
│   │       └── pipelines/
│   │           └── page.tsx      # Pipeline config UI
│   │
│   ├── dashboard/
│   │   └── analysis/
│   │       ├── page.tsx          # Analysis dashboard
│   │       └── [id]/
│   │           └── page.tsx      # Run detail page
│   │
│   └── api/
│       ├── admin/
│       │   └── settings/
│       │       └── pipelines/
│       │           ├── route.ts              # List/update configs
│       │           ├── [pipelineId]/
│       │           │   └── route.ts          # Single pipeline config
│       │           └── execution/
│       │               └── route.ts          # Execution settings
│       │
│       └── pipelines/
│           ├── runs/
│           │   ├── route.ts                  # List runs
│           │   └── [id]/
│           │       ├── route.ts              # Get run details
│           │       ├── cancel/route.ts       # Cancel run
│           │       └── retry/route.ts        # Retry run
│           │
│           └── [pipelineId]/
│               └── runs/
│                   └── route.ts              # Create pipeline run
```

---

## 11. Updated Database Schema

```prisma
// Add to schema.prisma

// Pipeline configuration (enabled/disabled + settings)
model PipelineConfig {
  id          String   @id @default(cuid())
  pipelineId  String   @unique  // 'mag', 'submg'
  enabled     Boolean  @default(false)
  config      String?  // JSON: pipeline-specific settings

  createdAt   DateTime @default(now())
  updatedAt   DateTime @updatedAt
}

// Generic pipeline run record (canonical shape)
model PipelineRun {
  id          String    @id @default(cuid())
  runNumber   String    @unique  // MAG-20240126-001
  pipelineId  String    // 'mag', 'submg'
  status      String    @default("pending")  // pending, queued, running, completed, failed, cancelled

  // Configuration snapshot
  config      String?   // JSON

  // Input
  studyId     String?
  study       Study?    @relation(fields: [studyId], references: [id])

  // Execution
  runFolder   String?
  queueJobId  String?
  progress    Int?      // 0-100
  currentStep String?   // "Running MEGAHIT..."

  // Timing
  queuedAt    DateTime?
  startedAt   DateTime?
  completedAt DateTime?

  // Logs (stored as paths for large outputs)
  outputPath  String?   // Path to stdout file
  errorPath   String?   // Path to stderr file
  outputTail  String?   // Last 100 lines of output (for quick preview)
  errorTail   String?   // Last 100 lines of error

  // Results summary (JSON)
  results     String?   // JSON summary

  // Metadata
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
  userId      String
  user        User      @relation(fields: [userId], references: [id])
}

// Update SiteSettings to include pipeline execution settings
// (already has extraSettings which can store this as JSON)
```

---

## 12. Implementation Phases

### Phase 1: MAG Pipeline (Current Scope)
1. Add `PipelineConfig` and `PipelineRun` models to schema
2. Create pipeline registry (`src/lib/pipelines/registry.ts`) with MAG only
3. Implement MAG executor (samplesheet, run, parse outputs)
4. Add analysis pages and MAG run UI on study page
5. Add basic DAG visualization for MAG run (steps + artifacts)

### Phase 2: Operational Hardening
1. Task queue (BullMQ or polling)
2. Log streaming + output tails
3. Retry/cancel functionality
4. Result visualization polish

### Phase 3: Future Pipelines (Post‑MAG)
1. Add SubMG submission pipeline
2. Add QC pipelines (FastQC/MultiQC)
3. Expand DAG visualization for multi‑pipeline graphs

---

## 13. V1 Pipeline Details (Reference)

The following sections contain detailed technical information from V1 for implementation reference.

### 13.1 MAG Pipeline

**Input**: Paired-end FASTQ files
**Output**: Assemblies (MEGAHIT), Bins (MaxBin2), Alignment files (BWA)

**Samplesheet format**:
```csv
sample,group,short_reads_1,short_reads_2,long_reads
sample1,group1,/path/R1.fastq.gz,/path/R2.fastq.gz,
```

**SLURM script** (generated):
```bash
#!/bin/bash
#SBATCH -p cpu
#SBATCH -c 4
#SBATCH --mem='64GB'
#SBATCH -t 12:0:0

source /net/conda/bin/activate broker
nextflow run hzi-bifo/mag -w /tmp \
  --input samplesheet.csv \
  -profile conda \
  -c cluster_config.cfg \
  --outdir /path/to/output
```

**Result files to parse**:
- `Assembly/MEGAHIT/MEGAHIT-{sample}.contigs.fa.gz` → Assembly records
- `GenomeBinning/MaxBin2/Assembly_*/MEGAHIT-MaxBin2-{sample}.*.fa` → Bin records
- `GenomeBinning/QC/checkm_summary_assembly_*.tsv` → Quality metrics
- `{sample}.sorted.bam` → Alignment files

### 13.2 SubMG Pipeline

**Input**: Study with reads, assemblies, optional bins
**Output**: ENA accession numbers

**YAML config** (generated per assembly):
```yaml
STUDY_ACCESSION: "PRJEB12345"
SAMPLES:
  - SAMPLE_ID: "sample1"
    TAX_ID: "256318"
READS:
  - FILE_R1: "/path/R1.fastq.gz"
    FILE_R2: "/path/R2.fastq.gz"
ASSEMBLY:
  ASSEMBLY_NAME: "study_coasm"
  FASTA_FILE: "/path/assembly.fa.gz"
BINS:
  BINS_DIRECTORY: "/path/bins/"
```

**Result files to parse**:
- `biological_samples/sample_preliminary_accessions.txt` → Sample accessions
- `reads/reads_*/webin-cli.report` → Read accessions (ERX, ERR)
- `assembly_fasta/webin-cli.report` → Assembly accession
- `bins/bin_to_preliminary_accession.tsv` → Bin accessions

---

## 14. Configuration Reference

### Environment Variables

```env
# SLURM execution
USE_SLURM=false
SLURM_QUEUE=cpu
SLURM_CORES=4
SLURM_MEMORY=64GB
SLURM_TIME_LIMIT=12
SLURM_OPTIONS=--qos=broker

# Paths
CONDA_PATH=/net/conda
CHECKM_REFDATA_DIR=/net/broker/checkm_refdata
PIPELINE_RUN_DIR=/data/pipeline_runs

# MAG specific
MAG_VERSION=3.4.0
MAG_STUB_MODE=false

# ENA (existing)
ENA_USERNAME=Webin-XXXXX
ENA_PASSWORD=***
```

### SiteSettings.extraSettings JSON

```json
{
  "pipelines": {
    "execution": {
      "useSlurm": false,
      "slurmQueue": "cpu",
      "slurmCores": 4,
      "slurmMemory": "64GB",
      "slurmTimeLimit": 12,
      "slurmOptions": "--qos=broker",
      "condaPath": "/net/conda",
      "runDirectory": "/data/pipeline_runs"
    },
    "mag": {
      "enabled": true,
      "stubMode": false,
      "version": "3.4.0",
      "checkmRefDataDir": "/net/broker/checkm_refdata"
    },
    "submg": {
      "enabled": true,
      "skipChecks": false
    }
  }
}
```

---

## TODO (MAG‑First Implementation)

**Core**
- [x] Add `PipelineConfig` + `PipelineRun` models (canonical shape) and migrate DB.
- [x] Create MAG pipeline registry entry (enabled/disabled + config schema).
- [x] Implement MAG samplesheet generation.
- [x] Implement MAG executor (run, log capture, status updates).
- [x] Parse MAG outputs into Assembly + Bin records (alignment files as artifacts).

**UI**
- [x] Add MAG "Run Analysis" action on study page (admin only).
- [x] Build Analysis dashboard (list runs, status, basic filters).
- [x] Build Run detail page (logs, config, results).
- [x] Add MAG DAG visualization (steps + artifact nodes).

**Ops**
- [x] Add execution settings (run directory, slurm/local toggle).
- [x] Add retry/cancel endpoints and UI.
- [x] Add log tails and basic progress updates.
- [ ] Wire up background task queue (polling or BullMQ) to actually execute pipelines.
- [x] Add pipeline settings link to Platform Settings sidebar.
