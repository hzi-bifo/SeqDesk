# Workbench Integration Test Baseline

Every Workbench integration must ship the same minimum test surface before it is
treated as usable in SeqDesk. This applies to importers, Store tools, pipelines,
and analysis modules.

## Required Layers

- **Contract tests**: registry entry, schema validation, default options,
  preflight behavior, and unknown-provider handling.
- **Execution tests**: mocked or fixture-backed run path, job progress/status,
  logs, result records, duplicate cache reuse, and failure reporting.
- **Security tests**: user/workspace scoping, cross-user denial, path
  containment, read-only shared cache behavior, and no raw user-controlled
  filesystem writes.
- **UI/API tests**: unauthorized access, regular-user workspace actions,
  admin-only setup actions, and queued/running/success/error states.

Use `src/lib/workbench/testing.ts` for temp storage roots, fake importer
contexts, path containment assertions, mock command runners, and serialized
dataset/job checks.

## Integration Spec Convention

Each integration should declare a `WorkbenchIntegrationTestSpec` with:

- integration id and kind (`importer`, `store-tool`, `pipeline`, or `analysis`)
- fixture mode (`mocked`, `fixture`, `fixture-and-live`, or `live`)
- required test layers
- expected outputs
- allowed write roots
- max runtime and optional max download size
- optional live-smoke command and tiny capped input

Importer specs live next to the provider. Pipeline and analysis specs should be
declared in package/manifest metadata when Workbench-native package loading is
added.

## Minimum By Type

- **Importer**: input schema, preflight missing-tool state, preview parser,
  capped selection, start-job path, cache key stability, shared-cache reuse, and
  workspace link creation.
- **Store tool**: admin-only install access, install status rendering,
  command/path resolution, log/status persistence, and safe failure when Conda
  or container prerequisites are missing.
- **Pipeline**: package/manifest validation, fixture samplesheet generation,
  expected outputs, run status mapping, output discovery, and workspace-scoped
  result linking.
- **Analysis module**: parameter schema, execution plan generation, artifact
  registration, rerun behavior, and no access outside the workspace/run
  directory.

## Commands

Fast baseline:

```bash
npm run test:workbench
```

Manual live source checks:

```bash
npm run test:workbench:live
```

Live tests must use tiny public data, strict caps, clear timeouts, and
actionable triage output. They are explicit integration/release checks, not
default PR CI.
