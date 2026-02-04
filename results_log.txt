# Manifest-Driven Pipeline Contract Implementation Results

## Overview

Implemented generic manifest-driven pipeline execution that allows new pipelines to be added without writing custom TypeScript code. The manifest.json becomes the single source of truth for execution, parameter handling, and output discovery.

---

## New Files Created

### 1. src/lib/pipelines/parser-runtime.ts
- `runParser()` - Executes a single parser on pipeline output
- `runAllParsers()` - Executes all parsers for a package
- Supports TSV, CSV, and JSON formats with type conversion (int, float, boolean, string)

### 2. src/lib/pipelines/generic-adapter.ts
- `createGenericAdapter()` - Creates a PipelineAdapter from manifest configuration
- Validates inputs based on manifest.inputs
- Generates samplesheets using declarative config
- Discovers outputs using manifest.outputs patterns
- Applies parsed metadata from parsers to discovered files

### 3. src/lib/pipelines/generic-executor.ts
- `prepareGenericRun()` - Prepares pipeline runs using manifest configuration
- `buildPipelineFlags()` - Converts UI config to Nextflow flags using paramMap/paramRules
- Generates SLURM or local execution scripts
- Handles run number generation, directory creation, samplesheet writing

### 4. pipelines/_example/ (Template Package)
- `manifest.json` - Complete example with paramMap/paramRules
- `definition.json` - Minimal 3-step DAG (input_check -> processing -> reporting)
- `registry.json` - UI config (hidden visibility so it doesn't appear in UI)
- `samplesheet.yaml` - Declarative samplesheet rules
- `parsers/example.yaml` - TSV parser example
- `README.md` - Documentation for package authors

---

## Modified Files

### 1. src/lib/pipelines/package-loader.ts
- Added `validatePackageManifest()` function with:
  - Schema validation using ManifestSchema
  - Folder name == manifest.package.id check
  - Definition/registry ID consistency checks
  - File existence verification
  - Parser ID reference validation
- Updated `scanPackages()` to filter folders starting with `_` or `.`
- Updated `loadPackage()` to call validation and fail fast on errors
- Added `fromStep` and `type` fields to `PackageOutput` interface

### 2. src/app/api/pipelines/runs/[id]/start/route.ts
- Replaced `prepareMagRun()` import with `prepareGenericRun()`
- Added `getPackage()` import for package verification
- Added package existence check before execution
- Updated prepareGenericRun call with pipelineId parameter

### 3. pipelines/mag/manifest.json
- Added `manifestVersion: 1`
- Added `paramMap` section:
  - skipMegahit -> --skip_megahit
  - skipSpades -> --skip_spades
  - skipProkka -> --skip_prokka
  - skipBinQc -> --skip_binqc
  - skipQuast -> --skip_quast
  - skipGtdbtk -> --skip_gtdbtk
  - gtdbDb -> --gtdb_db
- Added `paramRules` section:
  - When skipBinQc=true: adds --skip_quast, --skip_gtdbtk, --run_busco false, etc.
- Simplified defaultParams (removed redundant false values)

### 4. src/lib/pipelines/manifest-schema.ts
- Fixed Zod v4 compatibility: z.record() now takes two arguments (key type, value type)

### 5. PIPELINE_STORE.md
- Added "Manifest as Source of Truth for Execution" section
- Documented key components (Package Loader, Generic Executor, Generic Adapter, Parser Runtime)
- Added paramMap and paramRules documentation with examples

### 6. docs/PIPELINE_PACKAGE_DESIGN.md
- Added "Generic Execution System" section
- Documented execution configuration structure
- Added paramMap and paramRules documentation
- Added implementation files table
- Added "Adding a New Pipeline" guide

---

## Key Features

### paramMap
Maps UI configuration keys to Nextflow command-line flags:
```json
{
  "paramMap": {
    "skipBinQc": "--skip_binqc",
    "gtdbDb": "--gtdb_db"
  }
}
```
- Boolean true: Adds the flag (e.g., `skipBinQc: true` -> `--skip_binqc`)
- Boolean false/null/undefined: Skips the flag
- Other values: Adds flag with value (e.g., `gtdbDb: "/path"` -> `--gtdb_db /path`)

### paramRules
Conditional parameter logic applied after paramMap:
```json
{
  "paramRules": [
    {
      "when": { "skipBinQc": true },
      "add": [
        "--skip_quast",
        "--skip_gtdbtk",
        "--run_busco false"
      ]
    }
  ]
}
```

### Package Validation
- Schema validation against ManifestSchema (Zod)
- ID consistency checks (folder name, definition, registry)
- File existence verification
- Parser reference validation
- Warnings logged for drift, errors fail fast

### Template Filtering
- Folders starting with `_` are ignored by package loader
- Allows template packages like `_example` to exist without being loaded

---

## Verification

1. TypeScript compilation: `npx tsc --noEmit` - PASSED (no errors)
2. ESLint: `npm run lint` - PASSED (only pre-existing warnings)
3. MAG manifest JSON validation - PASSED
4. Example manifest JSON validation - PASSED

---

## How to Add a New Pipeline

1. Create `pipelines/<id>/` directory
2. Add required files:
   - `manifest.json` - Package metadata, inputs, execution, outputs
   - `definition.json` - DAG steps and process matchers
   - `registry.json` - UI configuration
   - `samplesheet.yaml` - Samplesheet generation rules
3. Add parser files in `parsers/` if needed
4. Run validation (when available): `npm run pipeline:validate`
5. Restart the dev server - pipeline is automatically loaded

---

## Files Summary

| File | Action | Purpose |
|------|--------|---------|
| src/lib/pipelines/package-loader.ts | Modified | Add validation |
| src/lib/pipelines/parser-runtime.ts | Created | Parser execution |
| src/lib/pipelines/generic-adapter.ts | Created | Manifest-driven adapter |
| src/lib/pipelines/generic-executor.ts | Created | Manifest-driven executor |
| src/app/api/pipelines/runs/[id]/start/route.ts | Modified | Use generic executor |
| pipelines/mag/manifest.json | Modified | Add paramMap/paramRules |
| pipelines/_example/* | Created | Template package |
| src/lib/pipelines/manifest-schema.ts | Modified | Fix Zod v4 compatibility |
| PIPELINE_STORE.md | Modified | Add documentation |
| docs/PIPELINE_PACKAGE_DESIGN.md | Modified | Add documentation |

---

## Bug Fixes (Review Feedback)

### 1. Critical: execution.version and profiles ignored
**Files:** `src/lib/pipelines/generic-executor.ts`
- Added `-r ${execution.version}` to pin pipeline version in Nextflow command
- Added `mergeProfiles()` function to combine manifest profiles with admin-configured profile
- Both SLURM and local scripts now use merged profiles and pinned version

### 2. High: Weblog handler adapter fallback
**File:** `src/app/api/pipelines/weblog/route.ts`
- Added fallback to `createGenericAdapter()` when no custom adapter is registered
- Ensures output resolution works for pipelines without custom adapters after server restart

### 3. High: Parsed metadata not persisted in artifacts
**File:** `src/lib/pipelines/output-resolver.ts`
- Added `metadata: file.metadata ? JSON.stringify(file.metadata) : null` to createArtifact
- Parsed values from outputs[].parsed now persisted in PipelineArtifact.metadata

### 4. Medium: output.parsed.matchBy ignored
**File:** `src/lib/pipelines/generic-adapter.ts`
- Updated `applyParsedMetadata()` to use `output.parsed.matchBy` when looking up rows
- Now searches rows where `row[matchBy] === matchKey` instead of always using first column as key

### 5. Medium: simpleGlob brace expansion broken
**Files:** `src/lib/pipelines/generic-adapter.ts`, `src/lib/pipelines/parser-runtime.ts`
- Fixed `.replace(/\{([^}]+)\}/g, ...)` to use callback function
- Now correctly expands `{A,B}` to regex `(A|B)` for patterns like `{MetaBAT2,MaxBin2}`

### 6. Medium: Duplicate flags from paramMap + defaultParams
**File:** `pipelines/mag/manifest.json`
- Changed defaultParams from snake_case (`skip_spades`) to camelCase (`skipSpades`)
- Now matches paramMap keys so they're properly processed and removed from merged dict

### 7. Low: Missing example.yaml parser
**Status:** Already existed - `pipelines/_example/parsers/example.yaml` was created correctly
