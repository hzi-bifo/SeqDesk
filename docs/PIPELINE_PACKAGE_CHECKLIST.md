# Pipeline Package Validation Checklist

Use this checklist before shipping or installing a pipeline package.
You can also run the validator script:

```
npx tsx scripts/validate-pipeline-package.ts
```

## Required Files

- `pipelines/<id>/manifest.json` (required)
- `pipelines/<id>/definition.json` (required)
- `pipelines/<id>/registry.json` (required)
- `pipelines/<id>/samplesheet.yaml` (required)
- `pipelines/<id>/README.md` (recommended)

## Manifest Contract

- `manifestVersion` exists and is >= 1
- `package.id` matches the folder name `<id>`
- `files.*` paths are correct and exist
- `execution.pipeline` + `execution.version` are set
- `execution.paramMap` covers all UI config keys that must map to Nextflow flags
- `outputs[].destination` is one of the allowed destination enums
- `outputs[].discovery.pattern` is present for every output
- If `outputs[].parsed` exists, `parsed.from` matches a parser ID in `parsers/*.yaml`

## Cross-File Consistency

- `definition.pipeline` == `manifest.package.id`
- `registry.id` == `manifest.package.id`
- Any outputs listed in `registry.outputs` are present in `manifest.outputs`
- DAG steps in `definition.json` have `processMatchers[]` where tracking is needed

## Samplesheet Rules

- Required columns are present in `samplesheet.yaml`
- `read.file1`/`read.file2` sources map to required read types
- Any `transform` rules are valid for the samplesheet generator

## Output Parsing

- All parser YAML files declare `parser.id`
- `parser.type` is `tsv`, `csv`, or `json`
- `columns[].index` matches the actual file structure

## Runtime Expectations

- Pipelines should write outputs to `${runFolder}/output`
- Output discovery patterns match actual Nextflow output layout
- When unsure, start with `run_artifact` or `study_report` destinations

## Validator Output

- **Errors** must be fixed before install
- **Warnings** should be reviewed and justified in README
