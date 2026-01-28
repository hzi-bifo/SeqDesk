#!/usr/bin/env npx ts-node

/**
 * Generate Pipeline Definition from nf-core
 *
 * Usage:
 *   npx ts-node scripts/generate-pipeline-def.ts mag
 *   npx ts-node scripts/generate-pipeline-def.ts rnaseq
 *
 * This script:
 * 1. Fetches the pipeline's modules.json from nf-core GitHub
 * 2. Fetches the pipeline's metro map / workflow description
 * 3. Generates a JSON definition file
 *
 * Output is saved to: data/pipeline-definitions/{pipeline}.json
 */

import fs from 'fs';
import path from 'path';

const NFCORE_RAW_URL = 'https://raw.githubusercontent.com/nf-core';
const NFCORE_API_URL = 'https://nf-co.re/api';

interface ModuleInfo {
  name: string;
  path: string;
}

interface StepDef {
  id: string;
  name: string;
  description: string;
  category: string;
  dependsOn: string[];
  modules?: string[];
}

// Category mappings based on common nf-core module patterns
const CATEGORY_PATTERNS: Record<string, RegExp[]> = {
  qc: [/fastqc/i, /multiqc/i, /quast/i, /busco/i, /checkm/i, /nanoplot/i, /pycoqc/i],
  preprocessing: [/fastp/i, /trimgalore/i, /cutadapt/i, /trimmomatic/i, /porechop/i, /filtlong/i, /bbmap/i, /bowtie2.*remove/i],
  alignment: [/bowtie2/i, /bwa/i, /star/i, /hisat2/i, /minimap2/i, /samtools/i],
  assembly: [/megahit/i, /spades/i, /flye/i, /canu/i, /unicycler/i, /dada2/i],
  binning: [/metabat/i, /maxbin/i, /concoct/i, /dastool/i, /comebin/i],
  annotation: [/prokka/i, /bakta/i, /gtdb/i, /kraken/i, /metaphlan/i, /diamond/i, /eggnog/i, /cat_bat/i],
  quantification: [/salmon/i, /kallisto/i, /featurecounts/i, /htseq/i, /rsem/i, /deseq2/i],
  variant_calling: [/gatk/i, /bcftools/i, /freebayes/i, /deepvariant/i, /snpeff/i],
  reporting: [/multiqc/i, /custom.*report/i],
};

function categorizeModule(moduleName: string): string {
  const lowerName = moduleName.toLowerCase();

  for (const [category, patterns] of Object.entries(CATEGORY_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(lowerName)) {
        return category;
      }
    }
  }

  return 'processing';
}

function formatModuleName(moduleName: string): string {
  // Convert module path to readable name
  // e.g., "nf-core/fastqc" -> "FastQC"
  // e.g., "local/megahit" -> "MEGAHIT"
  const name = moduleName.split('/').pop() || moduleName;

  // Handle known names
  const knownNames: Record<string, string> = {
    fastqc: 'FastQC',
    multiqc: 'MultiQC',
    megahit: 'MEGAHIT',
    spades: 'SPAdes',
    metabat2: 'MetaBAT2',
    maxbin2: 'MaxBin2',
    concoct: 'CONCOCT',
    dastool: 'DAS Tool',
    checkm: 'CheckM',
    gtdbtk: 'GTDB-Tk',
    prokka: 'Prokka',
    bakta: 'BAKTA',
    kraken2: 'Kraken2',
    bowtie2: 'Bowtie2',
    bwa: 'BWA',
    star: 'STAR',
    hisat2: 'HISAT2',
    salmon: 'Salmon',
    fastp: 'fastp',
    trimgalore: 'Trim Galore',
    samtools: 'SAMtools',
    busco: 'BUSCO',
    quast: 'QUAST',
  };

  return knownNames[name.toLowerCase()] || name.toUpperCase();
}

async function fetchModulesJson(pipeline: string, version: string = 'master'): Promise<Record<string, unknown> | null> {
  const url = `${NFCORE_RAW_URL}/${pipeline}/${version}/modules.json`;

  try {
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`Failed to fetch modules.json: ${response.status}`);
      return null;
    }
    return await response.json();
  } catch (error) {
    console.error(`Error fetching modules.json:`, error);
    return null;
  }
}

async function fetchPipelineInfo(pipeline: string): Promise<Record<string, unknown> | null> {
  // Try nf-core API
  const url = `https://nf-co.re/pipelines/${pipeline}/releases`;

  try {
    const response = await fetch(url, {
      headers: { 'Accept': 'application/json' }
    });
    if (!response.ok) {
      return null;
    }
    return await response.json();
  } catch {
    return null;
  }
}

function extractModules(modulesJson: Record<string, unknown>): ModuleInfo[] {
  const modules: ModuleInfo[] = [];

  // Parse the repos.nf-core.modules.nf-core section
  const repos = modulesJson.repos as Record<string, unknown> | undefined;
  if (!repos) return modules;

  // nf-core modules
  const nfcoreModules = repos['https://github.com/nf-core/modules.git'] as Record<string, unknown> | undefined;
  if (nfcoreModules?.modules) {
    const mods = (nfcoreModules.modules as Record<string, unknown>)['nf-core'] as Record<string, unknown> | undefined;
    if (mods) {
      for (const modName of Object.keys(mods)) {
        modules.push({ name: modName, path: `nf-core/${modName}` });
      }
    }
  }

  return modules;
}

function generateSteps(modules: ModuleInfo[], pipeline: string): StepDef[] {
  // Group modules by category
  const categoryGroups = new Map<string, ModuleInfo[]>();

  for (const mod of modules) {
    const category = categorizeModule(mod.name);
    if (!categoryGroups.has(category)) {
      categoryGroups.set(category, []);
    }
    categoryGroups.get(category)!.push(mod);
  }

  // Define step order
  const categoryOrder = [
    'qc',
    'preprocessing',
    'alignment',
    'assembly',
    'binning',
    'annotation',
    'quantification',
    'variant_calling',
    'reporting',
  ];

  const steps: StepDef[] = [];
  const prevCategory: string[] = [];

  // Always start with input validation
  steps.push({
    id: 'input',
    name: 'Input Validation',
    description: 'Validate samplesheet and input files',
    category: 'qc',
    dependsOn: [],
  });
  prevCategory.push('input');

  // Create steps from categories that have modules
  for (const category of categoryOrder) {
    const mods = categoryGroups.get(category);
    if (!mods || mods.length === 0) continue;

    // Skip if it's just multiqc (will be added at end)
    if (category === 'reporting' && mods.every(m => m.name.toLowerCase().includes('multiqc'))) {
      continue;
    }

    // Create a step for this category
    const stepId = category;
    const moduleNames = mods.map(m => formatModuleName(m.name));

    // Category display names
    const categoryNames: Record<string, string> = {
      qc: 'Quality Control',
      preprocessing: 'Preprocessing',
      alignment: 'Alignment',
      assembly: 'Assembly',
      binning: 'Genome Binning',
      annotation: 'Annotation',
      quantification: 'Quantification',
      variant_calling: 'Variant Calling',
      reporting: 'Reporting',
    };

    steps.push({
      id: stepId,
      name: categoryNames[category] || category,
      description: moduleNames.slice(0, 3).join(', ') + (moduleNames.length > 3 ? '...' : ''),
      category,
      dependsOn: [...prevCategory],
      modules: mods.map(m => m.name),
    });

    prevCategory.length = 0;
    prevCategory.push(stepId);
  }

  // Always end with MultiQC if present
  if (categoryGroups.has('reporting')) {
    steps.push({
      id: 'multiqc',
      name: 'MultiQC Report',
      description: 'Aggregate all QC metrics',
      category: 'reporting',
      dependsOn: [...prevCategory],
    });
  }

  return steps;
}

async function main() {
  const pipeline = process.argv[2];

  if (!pipeline) {
    console.log(`
Usage: npx ts-node scripts/generate-pipeline-def.ts <pipeline-name>

Examples:
  npx ts-node scripts/generate-pipeline-def.ts mag
  npx ts-node scripts/generate-pipeline-def.ts rnaseq
  npx ts-node scripts/generate-pipeline-def.ts ampliseq
`);
    process.exit(1);
  }

  console.log(`\nFetching nf-core/${pipeline} pipeline info...\n`);

  // Fetch modules.json
  const modulesJson = await fetchModulesJson(pipeline);

  if (!modulesJson) {
    console.error(`Could not fetch pipeline info for: ${pipeline}`);
    console.log('\nTry checking if the pipeline exists: https://nf-co.re/pipelines');
    process.exit(1);
  }

  // Extract modules
  const modules = extractModules(modulesJson);
  console.log(`Found ${modules.length} modules:\n`);

  // Group and display
  const byCategory = new Map<string, string[]>();
  for (const mod of modules) {
    const cat = categorizeModule(mod.name);
    if (!byCategory.has(cat)) byCategory.set(cat, []);
    byCategory.get(cat)!.push(mod.name);
  }

  for (const [cat, mods] of byCategory) {
    console.log(`  ${cat}: ${mods.join(', ')}`);
  }

  // Generate steps
  const steps = generateSteps(modules, pipeline);

  console.log(`\nGenerated ${steps.length} workflow steps:\n`);
  for (const step of steps) {
    console.log(`  ${step.id}: ${step.name} (${step.category})`);
    if (step.dependsOn.length > 0) {
      console.log(`    depends on: ${step.dependsOn.join(', ')}`);
    }
  }

  // Create output
  const output = {
    pipeline,
    generatedAt: new Date().toISOString(),
    source: `https://github.com/nf-core/${pipeline}`,
    steps,
  };

  // Save to file
  const outDir = path.join(process.cwd(), 'data', 'pipeline-definitions');
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  const outPath = path.join(outDir, `${pipeline}.json`);
  fs.writeFileSync(outPath, JSON.stringify(output, null, 2));

  console.log(`\nSaved to: ${outPath}`);

  // Also output TypeScript format for copy-paste
  console.log(`\n${'='.repeat(60)}`);
  console.log('TypeScript format (copy to src/lib/pipelines/definitions/index.ts):');
  console.log('='.repeat(60));
  console.log(`
const ${pipeline.toUpperCase()}_STEPS: PipelineStepDef[] = [
${steps.map(s => `  { id: '${s.id}', name: '${s.name}', description: '${s.description}', category: '${s.category}', dependsOn: [${s.dependsOn.map(d => `'${d}'`).join(', ')}] },`).join('\n')}
];
`);
}

main().catch(console.error);
