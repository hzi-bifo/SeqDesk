# Adding New nf-core Pipelines

This guide explains how to add support for new nf-core pipelines to Broker4Microbiota.

## Quick Start

```bash
# 1. Generate initial definition from nf-core
npx ts-node scripts/generate-pipeline-def.ts <pipeline-name>

# 2. Edit the generated JSON to fix workflow dependencies
# 3. Done! The app automatically loads it
```

## Directory Structure

```
data/pipeline-definitions/
├── mag.json           # nf-core/mag - Metagenome assembly
├── rnaseq.json        # nf-core/rnaseq - RNA sequencing
├── ampliseq.json      # nf-core/ampliseq - Amplicon analysis
└── taxprofiler.json   # nf-core/taxprofiler - Taxonomic profiling
```

## JSON Schema

Each pipeline definition file follows this structure:

```json
{
  "pipeline": "mag",
  "name": "nf-core/mag",
  "description": "Assembly and binning of metagenomes",
  "url": "https://nf-co.re/mag",
  "version": "3.0.0",
  "minNextflowVersion": "23.04.0",
  "authors": ["Author Name"],
  "inputs": [
    { "id": "reads", "name": "FASTQ Reads", "description": "Paired-end reads", "fileTypes": ["fastq.gz"] }
  ],
  "outputs": [
    { "id": "assemblies", "name": "Assemblies", "fromStep": "assembly", "fileTypes": ["fasta.gz"] }
  ],
  "parameterGroups": [
    {
      "name": "Input/Output",
      "description": "Define input data and output locations",
      "parameters": [
        { "name": "input", "type": "path", "description": "Path to samplesheet", "required": true },
        { "name": "outdir", "type": "path", "description": "Output directory", "default": "./results" }
      ]
    }
  ],
  "steps": [
    {
      "id": "input",
      "name": "Input Validation",
      "description": "Validate samplesheet and input files",
      "category": "qc",
      "dependsOn": [],
      "tools": ["nf-validation"],
      "outputs": ["fastq.gz"],
      "docs": "https://nf-co.re/mag/usage",
      "parameters": ["input", "single_end"]
    }
  ]
}
```

### Step Fields

| Field | Required | Description |
|-------|----------|-------------|
| `id` | Yes | Unique identifier for the step |
| `name` | Yes | Display name shown in the DAG |
| `description` | Yes | Short description (shown in node) |
| `category` | Yes | Category for color-coding (see below) |
| `dependsOn` | Yes | Array of step IDs that must complete before this step |
| `tools` | No | Array of tools/software used (e.g., `["FastQC v0.12.1"]`) |
| `outputs` | No | Array of output file formats (e.g., `["fastq.gz", "html"]`) |
| `docs` | No | URL to documentation for this step |
| `parameters` | No | Array of parameter names relevant to this step |

### Parameter Fields

| Field | Required | Description |
|-------|----------|-------------|
| `name` | Yes | Parameter name (without `--` prefix) |
| `type` | Yes | Type: `string`, `integer`, `number`, `boolean`, `path`, `file` |
| `description` | Yes | Description shown in the UI |
| `default` | No | Default value |
| `required` | No | Whether the parameter is required |
| `enum` | No | Array of allowed values for dropdowns |
| `minimum` / `maximum` | No | Range constraints for numbers |

### Categories

Categories determine the color of nodes in the DAG visualization:

| Category | Color | Use for |
|----------|-------|---------|
| `qc` | Blue | FastQC, MultiQC, QUAST, CheckM, BUSCO |
| `preprocessing` | Blue | Trimming, filtering, host removal |
| `assembly` | Green | Genome/transcriptome assembly |
| `alignment` | Green | Read mapping (BWA, STAR, Bowtie2) |
| `binning` | Purple | Genome binning (MetaBAT2, MaxBin2) |
| `annotation` | Orange | Gene prediction, taxonomy, functional annotation |
| `quantification` | Orange | Read counting, abundance estimation |
| `variant_calling` | Purple | SNP/variant calling |
| `reporting` | Gray | Final reports and summaries |

## Step-by-Step Guide

### 1. Generate Initial Definition

The generator script fetches module information from nf-core GitHub:

```bash
npx ts-node scripts/generate-pipeline-def.ts rnaseq
```

This creates `data/pipeline-definitions/rnaseq.json` with:
- All modules found in the pipeline
- Auto-categorized steps (may need manual adjustment)
- Linear dependencies (needs manual correction)

### 2. Edit the JSON

The auto-generated dependencies are usually too linear. Edit the JSON to reflect the actual workflow:

```json
// Before (auto-generated - too linear)
{ "id": "alignment", "dependsOn": ["trimming"] },
{ "id": "quantification", "dependsOn": ["alignment"] }

// After (corrected - shows parallel steps)
{ "id": "alignment", "dependsOn": ["trimming"] },
{ "id": "quantification", "dependsOn": ["alignment"] },
{ "id": "qc_aligned", "dependsOn": ["alignment"] }  // runs in parallel with quantification
```

### 3. Verify in the UI

1. Go to Admin → Settings → Pipelines
2. Click "View Pipeline" on your new pipeline
3. Check that the DAG looks correct
4. Adjust the JSON if needed

## Tips

### Finding the Correct Workflow Structure

1. **Check nf-core docs**: https://nf-co.re/{pipeline}/usage
2. **Look at the metro map**: Most nf-core pipelines have a visual workflow diagram
3. **Check the main.nf**: Look at the workflow definition in the pipeline's GitHub repo

### Common Patterns

**QC runs in parallel with main workflow:**
```json
{ "id": "fastqc", "dependsOn": ["input"] },
{ "id": "trimming", "dependsOn": ["input"] }
```

**Multiple tools for same step (alternatives):**
```json
{
  "id": "assembly",
  "name": "Assembly",
  "description": "MEGAHIT / SPAdes / Flye",  // List alternatives in description
  "dependsOn": ["preprocessing"]
}
```

**Parallel branches that merge:**
```json
{ "id": "taxonomy", "dependsOn": ["bin_qc"] },
{ "id": "annotation", "dependsOn": ["bin_qc"] },
{ "id": "report", "dependsOn": ["taxonomy", "annotation"] }  // waits for both
```

## Example: Adding nf-core/taxprofiler

```bash
# Generate
npx ts-node scripts/generate-pipeline-def.ts taxprofiler
```

Edit `data/pipeline-definitions/taxprofiler.json`:

```json
{
  "pipeline": "taxprofiler",
  "name": "nf-core/taxprofiler",
  "description": "Taxonomic classification and profiling",
  "url": "https://nf-co.re/taxprofiler",
  "steps": [
    { "id": "input", "name": "Input Check", "description": "Validate inputs", "category": "qc", "dependsOn": [] },
    { "id": "preprocessing", "name": "Preprocessing", "description": "fastp / AdapterRemoval", "category": "preprocessing", "dependsOn": ["input"] },
    { "id": "host_removal", "name": "Host Removal", "description": "Remove host reads", "category": "preprocessing", "dependsOn": ["preprocessing"] },
    { "id": "profiling", "name": "Profiling", "description": "Kraken2, MetaPhlAn, Kaiju...", "category": "annotation", "dependsOn": ["host_removal"] },
    { "id": "standardization", "name": "Standardization", "description": "Taxpasta merging", "category": "quantification", "dependsOn": ["profiling"] },
    { "id": "visualization", "name": "Visualization", "description": "Krona charts", "category": "reporting", "dependsOn": ["standardization"] },
    { "id": "multiqc", "name": "MultiQC", "description": "QC report", "category": "reporting", "dependsOn": ["profiling"] }
  ]
}
```

## Troubleshooting

### DAG not showing
- Check the JSON is valid (use a JSON validator)
- Check the file is in `data/pipeline-definitions/`
- Restart the dev server

### Nodes not connected properly
- Make sure `dependsOn` arrays reference valid step IDs
- Check for typos in step IDs

### Wrong colors
- Verify the `category` is one of the valid options (see table above)
