<!--
  Pipeline contribution PR.
  This template captures the contribution questionnaire for adding a new
  `pipelines/<id>/` package. Fill in every field and check every box before
  requesting review. Incomplete submissions will be returned.

  To use this template, append `?template=pipeline.md` to the compare URL, e.g.
  https://github.com/hzi-bifo/SeqDesk/compare/main...your-branch?template=pipeline.md
-->

## Pipeline package

- **Package id** (`pipelines/<id>/`, matches `manifest.package.id`): `<id>`
- **Display name** (`manifest.package.name`): ``
- **Version** (`manifest.package.version`, semver): ``
- **Provider / authors**: ``
- **Upstream pipeline repo** (`execution.pipeline`): ``

## Targets

Where can this pipeline be started from?

- [ ] **Order** (per-order / per-sample)
- [ ] **Study** (cross-sample / co-assembly)

## Engine

Nextflow is the only supported engine.

- [ ] `execution.type` is `nextflow`
- **Profiles** (`execution.profiles`) — at least one required:
  - [ ] `conda`
  - [ ] `container` (Docker/Singularity/Apptainer)

## Inputs

Describe the data the pipeline consumes (reads, platform, references, params).
Confirm `manifest.inputs` / `registry.input` reflect this.

- Read layout: `single` / `paired` / `long`
- Platform families: ``
- Notes: ``

## Outputs and writeback

List `manifest.outputs` and where each is written (`destination` + `scope`).
This is the writeback policy applied to SeqDesk after a successful run.

| output id | scope (sample/study) | destination | type |
| --------- | -------------------- | ----------- | ---- |
|           |                      |             |      |

- [ ] Every output `fromStep` matches a `definition.steps[].id`
- [ ] Parsers referenced by outputs exist under `parsers/`

## License

- **SPDX identifier** (e.g. `MIT`, `Apache-2.0`, `GPL-3.0-only`): ``
- Availability:
  - [ ] **Public** — freely usable, redistributable
  - [ ] **Private / licensed** — restricted; describe the terms below
- License notes (links, attribution, restrictions): ``
- [ ] A `LICENSE` (or equivalent) is declared for the pipeline package

## Test-data fixture (required)

Contributed pipelines must ship a minimal dummy fixture so CI can run them on
dummy data.

- [ ] A minimal `test-data/` fixture is included in the package
- [ ] The fixture is small (tiny/truncated inputs, no real/sensitive data)
- [ ] CI can run the pipeline end-to-end against this fixture

## Validation

- [ ] `npm run pipeline:validate pipelines/<id>` passes locally
- [ ] Folder name matches `manifest.package.id`; all referenced files exist
- [ ] Ran the pipeline **locally** on the bundled test-data fixture
- [ ] Ran the pipeline on a **Slurm** cluster

## Checklist

- [ ] Package follows the `pipelines/_example/` scaffold (manifest, definition,
      registry, samplesheet, README; optional `scripts/`, `parsers/`)
- [ ] No real credentials, datasets, or PII committed
- [ ] README documents what the pipeline does and how to configure it
