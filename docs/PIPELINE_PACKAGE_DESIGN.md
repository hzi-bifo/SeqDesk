# Pipeline Package Design (Scope-Aware, Self-Contained)

> **Note:** The pipeline registry/store (for browsing and installation) now lives in the **landing-page repo** (`hzi-bifo/SeqDesk.com`).
> This repo only loads **local packages** from `pipelines/`. The public registry is at `seqdesk.com/api/registry`.

A SeqDesk pipeline should be **self-contained**, but that does **not** mean "one file".
Instead, each pipeline lives in its **own folder** with a small manifest and
optional supporting files (DAG, samplesheet rules, parsers, scripts). The manifest
is the source of truth and declares **how the pipeline reads from SeqDesk and
writes back** across **scope levels** (sample, study, order, run).

---

## Folder-Based Package Structure

Each pipeline lives in `pipelines/<id>/`:

```
seqdesk/
└── pipelines/
    └── mag/
        ├── manifest.json          # REQUIRED: source of truth
        ├── definition.json        # DAG + process matchers
        ├── registry.json          # UI config + requirements
        ├── samplesheet.yaml       # declarative samplesheet rules (optional)
        ├── parsers/
        │   ├── checkm.yaml
        │   └── gtdbtk.yaml
        ├── scripts/
        │   ├── samplesheet.ts      # optional override
        │   └── discover-outputs.ts # optional override
        ├── README.md
        └── checksums.json          # optional
```

**Goal:** a pipeline package is fully portable and installable without touching core code.

---

## Core Principle: Scope-Aware IO

Pipelines interact with SeqDesk at **different scopes**:

- **sample**: per-sample reads, assemblies, bins, annotations
- **study**: overall QC reports, summary tables
- **order**: delivery reports, invoices, customer-facing outputs
- **run**: logs, runtime metadata, audit trail

The package **must declare** the **scope** for every input and output so SeqDesk
can route data correctly.

---

## Manifest (Source of Truth)

The manifest declares *what* the pipeline needs and *where* it writes data.
It references other files but keeps all logic discoverable.

### Example (abridged)

```json
{
  "package": {
    "id": "mag",
    "name": "nf-core/mag",
    "version": "3.0.0",
    "description": "Metagenome assembly and binning",
    "website": "https://nf-co.re/mag"
  },
  "files": {
    "definition": "definition.json",
    "registry": "registry.json",
    "samplesheet": "samplesheet.yaml",
    "parsers": ["parsers/checkm.yaml", "parsers/gtdbtk.yaml"],
    "scripts": {
      "samplesheet": "scripts/samplesheet.ts",
      "discoverOutputs": "scripts/discover-outputs.ts"
    }
  },
  "inputs": [
    {
      "id": "paired_reads",
      "scope": "sample",
      "source": "sample.reads",
      "required": true,
      "filters": { "paired": true }
    },
    {
      "id": "platform",
      "scope": "order",
      "source": "order.platform",
      "required": true,
      "transform": {
        "type": "map_value",
        "mapping": {
          "illumina": "ILLUMINA",
          "ILLUMINA": "ILLUMINA",
          "ont": "OXFORD"
        }
      }
    }
  ],
  "execution": {
    "type": "nextflow",
    "pipeline": "nf-core/mag",
    "version": "3.0.0",
    "profiles": ["conda"],
    "defaultParams": {
      "skip_spades": true
    }
  },
  "outputs": [
    {
      "id": "assemblies",
      "scope": "sample",
      "destination": "sample_assemblies",
      "discovery": {
        "pattern": "Assembly/*/*.contigs.fa.gz",
        "matchSampleBy": "filename"
      }
    },
    {
      "id": "multiqc",
      "scope": "study",
      "destination": "study_report",
      "discovery": {
        "pattern": "multiqc/multiqc_report.html"
      }
    }
  ],
  "schema_requirements": {
    "tables": ["Assembly", "Bin", "PipelineArtifact"]
  }
}
```

---

## Definition File (DAG)

`definition.json` contains:

- `steps[]` (id, name, dependsOn, category)
- `processMatchers[]` for each step (map Nextflow process → step)
- optional `inputs[]`, `outputs[]` for visualization

This enables the **same DAG view** in the admin UI and on the website.

---

## Registry File (UI + Validation)

`registry.json` defines:

- pipeline name/description/icon
- required input scopes
- config schema for UI
- default settings
- visibility / permissions

This is used by the admin pipeline settings UI.
It is **not** the public pipeline store registry (that lives in the landing-page repo).

---

## Samplesheet Rules (Declarative or Scripted)

There are **two supported modes**:

1. **Declarative** (`samplesheet.yaml`)
2. **Scripted** (`scripts/samplesheet.ts`)

If a script exists, it overrides the declarative rules.

Declarative rules must be **scope-aware** and may include transforms:

```yaml
samplesheet:
  format: csv
  filename: samplesheet.csv
  rows:
    scope: sample
  columns:
    - name: sample
      source: sample.sampleId
    - name: short_reads_1
      source: read.file1
      transform:
        type: prepend_path
        base: "${DATA_BASE_PATH}"
```

---

## Outputs (Scope + Destination)

Each output declares:

- **scope**: sample / study / order / run
- **destination**: a SeqDesk destination enum (not Prisma tables)
- **discovery**: how to find artifacts
- **optional parser outputs**

Example:

```yaml
outputs:
  - id: assemblies
    scope: sample
    destination: sample_assemblies
    discovery:
      pattern: "Assembly/*/*.contigs.fa.gz"
      matchSampleBy: filename

  - id: qc_report
    scope: study
    destination: study_report
    discovery:
      pattern: "multiqc/multiqc_report.html"
```

The **output resolver** maps destinations to DB writes. Pipelines never touch Prisma directly.

### Standard destinations

- `sample_reads`
- `sample_assemblies`
- `sample_bins`
- `sample_annotations`
- `sample_qc`
- `study_report`
- `order_report`
- `run_artifact`
- `download_only`

---

## Per-Scope Writes (Examples)

- **sample scope**: create Assembly/Bin rows, attach to sample
- **study scope**: store MultiQC report artifact linked to study
- **order scope**: delivery reports or customer-facing summaries
- **run scope**: logs, trace files, metadata

This makes it explicit **where data is written** and how it can be displayed.

---

## Optional Scripts (Self-Contained Extensions)

A package can include scripts for complex pipelines:

- `scripts/samplesheet.ts` – custom samplesheet generation
- `scripts/discover-outputs.ts` – custom output discovery
- `scripts/parse-*.ts` – custom parsers

**Constraints:**
- Must run with a **scoped context** (studyId, sampleIds, runId)
- Must not access the DB directly
- All writes go through the output resolver

---

## Schema Requirements (DB Extensions)

If a pipeline needs extra fields/tables, it should declare them:

```yaml
schema_requirements:
  tables:
    - name: Assembly
      required_fields: [assemblyFile, sampleId, createdByPipelineRunId]
    - name: Bin
      required_fields: [binFile, sampleId, createdByPipelineRunId]
```

This keeps the package portable but allows SeqDesk to extend its schema when needed.

---

## Why This Makes Sense

- **Self-contained**: everything lives in one folder
- **Declarative**: most pipelines need no code
- **Scope-aware**: unambiguous read/write semantics
- **Extensible**: scripts allow special cases without breaking the model
- **Validatable**: manifest can be checked against schema + execution config

---

## Migration Path

1. Create `pipelines/mag/` with manifest + definition + registry
2. Add a loader that reads `pipelines/*/manifest.json`
3. Implement output resolver using destination enums
4. Move MAG samplesheet + output parsing into package
5. Repeat for future pipelines

---

## Open Questions

1. **Format**: JSON vs YAML for manifest? (JSON is strict; YAML is readable)
2. **Parser library**: which built-in parsers are allowed?
3. **Schema updates**: are we comfortable auto-migrating for new pipeline fields?
4. **Execution profiles**: should packages enforce allowed profiles strictly?

---

## Generic Execution System

The manifest is now the source of truth for pipeline execution. New pipelines can be added without writing custom TypeScript code.

### Execution Configuration

The `execution` section in manifest.json controls Nextflow command generation:

```json
{
  "execution": {
    "type": "nextflow",
    "pipeline": "nf-core/mag",
    "version": "3.0.0",
    "profiles": ["conda"],
    "defaultParams": {
      "skip_spades": true,
      "skip_prokka": true
    },
    "paramMap": {
      "skipMegahit": "--skip_megahit",
      "skipBinQc": "--skip_binqc",
      "gtdbDb": "--gtdb_db"
    },
    "paramRules": [
      {
        "when": { "skipBinQc": true },
        "add": [
          "--skip_quast",
          "--skip_gtdbtk",
          "--run_busco false",
          "--run_checkm false"
        ]
      }
    ]
  }
}
```

### paramMap

Maps UI configuration keys to Nextflow flags:

- **Boolean true**: Adds the flag (e.g., `skipBinQc: true` → `--skip_binqc`)
- **Boolean false/null/undefined**: Skips the flag
- **Other values**: Adds flag with value (e.g., `gtdbDb: "/path"` → `--gtdb_db /path`)

### paramRules

Conditional parameter logic applied after paramMap:

```json
{
  "when": { "keyName": expectedValue },
  "add": [
    "--simple_flag",
    { "flag": "--with_value", "value": "something" }
  ]
}
```

Rules are evaluated in order. All matching rules are applied.

### Implementation Files

| File | Purpose |
|------|---------|
| `src/lib/pipelines/generic-executor.ts` | Command building, script generation |
| `src/lib/pipelines/generic-adapter.ts` | Validation, samplesheet, output discovery |
| `src/lib/pipelines/parser-runtime.ts` | Execute YAML-defined parsers |
| `src/lib/pipelines/package-loader.ts` | Load and validate packages |

### Adding a New Pipeline

1. Create `pipelines/<id>/` directory
2. Add required files:
   - `manifest.json` - Package metadata, inputs, execution, outputs
   - `definition.json` - DAG steps and process matchers
   - `registry.json` - UI configuration
   - `samplesheet.yaml` - Samplesheet generation rules
3. Add parser files in `parsers/` if needed
4. Run `npm run pipeline:validate` to check configuration
5. Restart the dev server - pipeline is automatically loaded

### Template Package

See `pipelines/_example/` for a complete example with all configuration options. This folder is not loaded (folders starting with `_` are ignored).
