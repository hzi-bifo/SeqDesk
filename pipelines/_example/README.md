# Example Pipeline Package

This is a template pipeline package for documentation purposes. It demonstrates the
structure and configuration required for a SeqDesk pipeline package.

**This package is not loaded** - directories starting with `_` are ignored by the
package loader.

## Package Structure

```
_example/
  manifest.json      # Source of truth - package metadata, inputs, execution, outputs
  definition.json    # DAG steps and process matchers for UI visualization
  registry.json      # UI configuration, schema, visibility settings
  samplesheet.yaml   # Declarative samplesheet generation rules
  parsers/
    example.yaml     # Output file parser definitions
  README.md          # This file
```

## Key Concepts

### manifest.json

The manifest is the source of truth for pipeline execution. It defines:

- **package**: Metadata (id, name, version, description)
- **files**: Paths to other package files
- **inputs**: What data the pipeline needs (reads, platform, etc.)
- **execution**: How to run Nextflow (pipeline name, version, profiles)
  - **defaultParams**: Base parameters always applied
  - **paramMap**: Maps UI config keys to Nextflow flags
  - **paramRules**: Conditional parameter logic
- **outputs**: What the pipeline produces and how to find it

### paramMap

The `paramMap` translates UI configuration keys to Nextflow command-line flags:

```json
{
  "paramMap": {
    "skipStep1": "--skip_step1",
    "minQuality": "--min_quality"
  }
}
```

When a user sets `skipStep1: true` in the UI, the generic executor adds
`--skip_step1` to the Nextflow command.

### paramRules

For complex conditional logic, use `paramRules`:

```json
{
  "paramRules": [
    {
      "when": { "skipStep1": true },
      "add": ["--skip_step1_dependency"]
    },
    {
      "when": { "outputFormat": "compressed" },
      "add": [{ "flag": "--compression", "value": "gzip" }]
    }
  ]
}
```

### Output Discovery

Outputs are discovered using glob patterns:

```json
{
  "outputs": [
    {
      "id": "assemblies",
      "discovery": {
        "pattern": "output/**/*.fa.gz",
        "fallbackPattern": "output/**/*.fasta",
        "matchSampleBy": "filename"
      }
    }
  ]
}
```

The `matchSampleBy` strategy determines how to associate files with samples:
- `filename`: Sample ID appears in the filename
- `parent_dir`: Sample ID appears in the parent directory name
- `path`: Sample ID appears anywhere in the path

### Parsers

Parsers extract metadata from pipeline output files (TSV, CSV, JSON):

```yaml
parser:
  id: example_parser
  type: tsv
  trigger:
    filePattern: "qc/metrics.tsv"
  skipHeader: true
  columns:
    - name: sample_name
      index: 0
    - name: quality
      index: 1
      type: float
```

Parsed data can be mapped to discovered outputs:

```json
{
  "parsed": {
    "from": "example_parser",
    "matchBy": "sample_name",
    "map": {
      "quality_score": "quality"
    }
  }
}
```

## Creating a New Pipeline Package

1. Copy this `_example` directory to a new name (e.g., `my-pipeline`)
2. Remove the `_` prefix so it gets loaded
3. Update all files with your pipeline's configuration
4. Test with `npm run pipeline:validate`

## Validation

The package loader validates:
- Manifest schema compliance
- Folder name matches `manifest.package.id`
- All referenced files exist
- Parser IDs referenced in outputs exist
- Definition and registry IDs match manifest

Warnings are logged for:
- ID mismatches between manifest/definition/registry (drift)
