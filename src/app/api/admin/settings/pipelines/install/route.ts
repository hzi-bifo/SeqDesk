import { NextRequest, NextResponse } from 'next/server';
import { getServerSession } from 'next-auth';
import { authOptions } from '@/lib/auth';
import fs from 'fs';
import path from 'path';
import { clearPackageCache } from '@/lib/pipelines/package-loader';

// Pipeline templates for store pipelines
// These define the basic structure for nf-core pipelines
const PIPELINE_TEMPLATES: Record<string, {
  name: string;
  description: string;
  version: string;
  category: string;
  website: string;
  requires: Record<string, boolean>;
  samplesheetColumns: Array<{
    name: string;
    source: string;
    required?: boolean;
    default?: string;
    description?: string;
    filters?: Record<string, unknown>;
    transform?: { type: string; mapping?: Record<string, string> };
  }>;
  defaultParams: Record<string, unknown>;
}> = {
  rnaseq: {
    name: 'nf-core/rnaseq',
    description: 'RNA sequencing analysis with differential expression',
    version: '3.14.0',
    category: 'transcriptomics',
    website: 'https://nf-co.re/rnaseq',
    requires: { reads: true },
    samplesheetColumns: [
      { name: 'sample', source: 'sample.sampleId', required: true, description: 'Sample identifier' },
      { name: 'fastq_1', source: 'read.file1', required: true, filters: { paired: true }, description: 'Forward reads' },
      { name: 'fastq_2', source: 'read.file2', filters: { paired: true }, description: 'Reverse reads' },
      { name: 'strandedness', source: '', default: 'auto', description: 'Strandedness (auto, forward, reverse, unstranded)' },
    ],
    defaultParams: {
      skip_bbsplit: true,
      skip_preseq: true,
    },
  },
  ampliseq: {
    name: 'nf-core/ampliseq',
    description: '16S/18S/ITS amplicon sequencing analysis',
    version: '2.8.0',
    category: 'amplicon',
    website: 'https://nf-co.re/ampliseq',
    requires: { reads: true },
    samplesheetColumns: [
      { name: 'sampleID', source: 'sample.sampleId', required: true, description: 'Sample identifier' },
      { name: 'forwardReads', source: 'read.file1', required: true, filters: { paired: true }, description: 'Forward reads' },
      { name: 'reverseReads', source: 'read.file2', filters: { paired: true }, description: 'Reverse reads' },
      { name: 'run', source: 'study.id', description: 'Run identifier for grouping' },
    ],
    defaultParams: {
      FW_primer: 'GTGYCAGCMGCCGCGGTAA',
      RV_primer: 'GGACTACNVGGGTWTCTAAT',
    },
  },
  taxprofiler: {
    name: 'nf-core/taxprofiler',
    description: 'Taxonomic classification and profiling',
    version: '1.1.0',
    category: 'metagenomics',
    website: 'https://nf-co.re/taxprofiler',
    requires: { reads: true },
    samplesheetColumns: [
      { name: 'sample', source: 'sample.sampleId', required: true, description: 'Sample identifier' },
      { name: 'run_accession', source: 'study.id', description: 'Run accession' },
      { name: 'instrument_platform', source: 'order.platform', transform: { type: 'map_value', mapping: { illumina: 'ILLUMINA', ILLUMINA: 'ILLUMINA' } }, description: 'Sequencing platform' },
      { name: 'fastq_1', source: 'read.file1', required: true, filters: { paired: true }, description: 'Forward reads' },
      { name: 'fastq_2', source: 'read.file2', filters: { paired: true }, description: 'Reverse reads' },
      { name: 'fasta', source: '', default: '', description: 'FASTA file (if applicable)' },
    ],
    defaultParams: {
      run_kraken2: true,
      run_bracken: true,
    },
  },
  fetchngs: {
    name: 'nf-core/fetchngs',
    description: 'Download data from public databases',
    version: '1.10.0',
    category: 'utilities',
    website: 'https://nf-co.re/fetchngs',
    requires: {},
    samplesheetColumns: [
      { name: 'id', source: 'sample.sampleId', required: true, description: 'Accession ID or sample name' },
    ],
    defaultParams: {
      nf_core_pipeline: 'rnaseq',
    },
  },
};

function generateManifest(pipelineId: string, template: typeof PIPELINE_TEMPLATES[string]) {
  return {
    package: {
      id: pipelineId,
      name: template.name,
      version: template.version,
      description: template.description,
      website: template.website,
      provider: 'nf-core',
    },
    files: {
      definition: 'definition.json',
      registry: 'registry.json',
      samplesheet: 'samplesheet.yaml',
      parsers: [],
      readme: 'README.md',
    },
    inputs: [
      {
        id: 'paired_reads',
        scope: 'sample',
        source: 'sample.reads',
        required: true,
        filters: { paired: true },
      },
    ],
    execution: {
      type: 'nextflow',
      pipeline: template.name,
      version: template.version,
      profiles: ['conda'],
      defaultParams: template.defaultParams,
    },
    outputs: [
      {
        id: 'multiqc_report',
        scope: 'study',
        destination: 'study_report',
        discovery: {
          pattern: 'multiqc/multiqc_report.html',
        },
      },
    ],
    schema_requirements: {
      tables: ['PipelineArtifact'],
    },
  };
}

function generateDefinition(pipelineId: string, template: typeof PIPELINE_TEMPLATES[string]) {
  return {
    pipeline: pipelineId,
    name: template.name,
    description: template.description,
    url: template.website,
    version: template.version,
    minNextflowVersion: '23.04.0',
    authors: ['nf-core community'],
    samplesheet: {
      description: `Samplesheet for ${template.name}`,
      columns: template.samplesheetColumns.map(col => ({
        name: col.name,
        source: col.source || '',
        required: col.required,
        default: col.default,
        description: col.description,
      })),
    },
    inputs: [
      {
        id: 'reads',
        name: 'FASTQ Reads',
        description: 'Sequencing reads',
        fileTypes: ['fastq.gz', 'fq.gz'],
        source: 'order_reads',
        sourceDescription: 'Sequencing files from Order',
      },
    ],
    outputs: [
      {
        id: 'multiqc_report',
        name: 'MultiQC Report',
        description: 'Aggregated QC metrics',
        fromStep: 'multiqc',
        fileTypes: ['html'],
        destination: 'study_report',
        destinationDescription: 'Linked as Study Report',
        integrationStatus: 'implemented',
      },
    ],
    steps: [
      {
        id: 'input',
        name: 'Input Validation',
        description: 'Validate input files',
        category: 'qc',
        dependsOn: [],
        processMatchers: ['SAMPLESHEET_CHECK', 'INPUT_CHECK'],
      },
      {
        id: 'preprocessing',
        name: 'Preprocessing',
        description: 'Read preprocessing and QC',
        category: 'preprocessing',
        dependsOn: ['input'],
        processMatchers: ['FASTQC', 'FASTP', 'TRIMGALORE'],
      },
      {
        id: 'analysis',
        name: 'Analysis',
        description: 'Main analysis step',
        category: 'analysis',
        dependsOn: ['preprocessing'],
        processMatchers: [],
      },
      {
        id: 'multiqc',
        name: 'MultiQC Report',
        description: 'Aggregate QC metrics',
        category: 'reporting',
        dependsOn: ['analysis'],
        processMatchers: ['MULTIQC'],
      },
    ],
  };
}

function generateRegistry(pipelineId: string, template: typeof PIPELINE_TEMPLATES[string]) {
  return {
    id: pipelineId,
    name: template.name.replace('nf-core/', '').toUpperCase() + ' Pipeline',
    description: template.description,
    category: template.category === 'transcriptomics' ? 'analysis' :
              template.category === 'amplicon' ? 'analysis' :
              template.category === 'metagenomics' ? 'analysis' :
              template.category === 'utilities' ? 'qc' : 'analysis',
    version: template.version,
    website: template.website,
    requires: template.requires,
    outputs: [
      {
        type: 'report',
        name: 'qc_report',
        description: 'MultiQC report',
        visibility: 'both',
        downloadable: true,
      },
    ],
    visibility: {
      showToUser: true,
      userCanStart: false,
    },
    input: {
      supportedScopes: ['study', 'samples'],
      minSamples: 1,
      perSample: {
        reads: true,
        pairedEnd: true,
      },
    },
    samplesheet: {
      format: 'csv',
      generator: `generate${pipelineId.charAt(0).toUpperCase() + pipelineId.slice(1)}Samplesheet`,
    },
    configSchema: {
      type: 'object',
      properties: {
        stubMode: {
          type: 'boolean',
          title: 'Stub Mode',
          description: 'Run in stub mode (for testing)',
          default: false,
        },
      },
    },
    defaultConfig: {
      stubMode: false,
    },
    icon: template.category === 'transcriptomics' ? 'Dna' :
          template.category === 'amplicon' ? 'Microscope' :
          template.category === 'utilities' ? 'Download' : 'FlaskConical',
  };
}

function generateSamplesheetYaml(pipelineId: string, template: typeof PIPELINE_TEMPLATES[string]) {
  const columns = template.samplesheetColumns.map(col => {
    const lines = [`    - name: ${col.name}`];
    lines.push(`      source: ${col.source || 'null'}`);
    if (col.description) lines.push(`      description: ${col.description}`);
    if (col.required) lines.push(`      required: true`);
    if (col.default !== undefined) lines.push(`      default: "${col.default}"`);
    if (col.filters) {
      lines.push(`      filters:`);
      for (const [key, value] of Object.entries(col.filters)) {
        lines.push(`        ${key}: ${value}`);
      }
    }
    if (col.transform) {
      lines.push(`      transform:`);
      lines.push(`        type: ${col.transform.type}`);
      if (col.transform.mapping) {
        lines.push(`        mapping:`);
        for (const [key, value] of Object.entries(col.transform.mapping)) {
          lines.push(`          ${key}: ${value}`);
        }
      }
    }
    return lines.join('\n');
  }).join('\n\n');

  return `samplesheet:
  format: csv
  filename: samplesheet.csv
  rows:
    scope: sample
  columns:
${columns}
`;
}

function generateReadme(pipelineId: string, template: typeof PIPELINE_TEMPLATES[string]) {
  return `# ${template.name}

${template.description}

## Version

${template.version}

## Documentation

For full documentation, see: ${template.website}

## SeqDesk Integration

This pipeline package provides SeqDesk integration for ${template.name}.

### Inputs

- Paired-end FASTQ reads from samples

### Outputs

- MultiQC aggregated report

## Installation

This pipeline was installed via the SeqDesk Pipeline Store.
`;
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== 'admin') {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await req.json();
    const { pipelineId } = body;

    if (!pipelineId) {
      return NextResponse.json({ error: 'Pipeline ID required' }, { status: 400 });
    }

    const template = PIPELINE_TEMPLATES[pipelineId];
    if (!template) {
      return NextResponse.json({ error: `Unknown pipeline: ${pipelineId}` }, { status: 400 });
    }

    // Create pipeline directory
    const pipelinesDir = path.join(process.cwd(), 'pipelines');
    const pipelineDir = path.join(pipelinesDir, pipelineId);

    if (fs.existsSync(pipelineDir)) {
      return NextResponse.json({ error: `Pipeline ${pipelineId} already installed` }, { status: 400 });
    }

    // Create directories
    fs.mkdirSync(pipelineDir, { recursive: true });
    fs.mkdirSync(path.join(pipelineDir, 'parsers'), { recursive: true });

    // Generate and write files
    fs.writeFileSync(
      path.join(pipelineDir, 'manifest.json'),
      JSON.stringify(generateManifest(pipelineId, template), null, 2)
    );

    fs.writeFileSync(
      path.join(pipelineDir, 'definition.json'),
      JSON.stringify(generateDefinition(pipelineId, template), null, 2)
    );

    fs.writeFileSync(
      path.join(pipelineDir, 'registry.json'),
      JSON.stringify(generateRegistry(pipelineId, template), null, 2)
    );

    fs.writeFileSync(
      path.join(pipelineDir, 'samplesheet.yaml'),
      generateSamplesheetYaml(pipelineId, template)
    );

    fs.writeFileSync(
      path.join(pipelineDir, 'README.md'),
      generateReadme(pipelineId, template)
    );

    // Clear package cache so new pipeline is discovered
    clearPackageCache();

    return NextResponse.json({
      success: true,
      message: `Pipeline ${pipelineId} installed successfully`,
      pipelineId,
    });
  } catch (error) {
    console.error('Failed to install pipeline:', error);
    return NextResponse.json(
      { error: 'Failed to install pipeline', details: error instanceof Error ? error.message : 'Unknown error' },
      { status: 500 }
    );
  }
}
