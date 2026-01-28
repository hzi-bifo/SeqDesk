# Adding Pipelines

SeqDesk pipelines are packaged as self-contained folders under `pipelines/<id>/`.
The package folder is the single source of truth for the pipeline definition,
UI metadata, samplesheet rules, and output integration.

For full schema details, see `docs/PIPELINE_PACKAGE_DESIGN.md`.

## Package Structure

```
pipelines/
  <id>/
    manifest.json
    definition.json
    registry.json
    samplesheet.yaml
    parsers/            # optional
    scripts/            # optional
```

## Step-by-Step

1. **Create the package folder**
   - `mkdir -p pipelines/<id>`

2. **Generate the initial workflow definition**
   - `npx ts-node scripts/generate-pipeline-def.ts <id>`
   - This creates `pipelines/<id>/definition.json`.
   - Edit it to fix step dependencies, categories, and process matchers.

3. **Create `manifest.json`**
   - Declare package metadata, inputs, execution config, and outputs.
   - Include file paths for `definition.json`, `registry.json`, `samplesheet.yaml`, and any parsers.

4. **Create `registry.json`**
   - UI configuration: name, description, category, config schema, default config, etc.

5. **Create `samplesheet.yaml`**
   - Declarative samplesheet columns and transforms.
   - The generator reads from this file directly.

6. **Add parsers (optional)**
   - If you need to parse TSV/CSV/JSON outputs, add YAML parser configs under `parsers/`.

7. **Add an adapter (only if needed)**
   - If output discovery is non-trivial, add `src/lib/pipelines/adapters/<id>.ts`.
   - Implement `PipelineAdapter` and register it in the adapter registry.

8. **Verify in the UI**
   - Admin → Settings → Pipelines should show the new pipeline.
   - The “View” page should render the DAG from `definition.json`.

## Notes

- `manifest.json` is the source of truth for inputs, outputs, and destinations.
- Output resolution is handled by `src/lib/pipelines/output-resolver.ts`.
- Avoid adding legacy definitions under `data/pipeline-definitions` (no longer used).
