// MAG Pipeline Steps Definition
// Based on nf-core/mag workflow structure
// https://nf-co.re/mag

export type StepCategory = 'qc' | 'assembly' | 'binning' | 'annotation' | 'reporting';

export interface PipelineStepDefinition {
  id: string;
  name: string;
  description: string;
  category: StepCategory;
  order: number;
  // Process names from Nextflow that map to this step
  nextflowProcesses: string[];
  // Dependencies - which steps must complete before this one
  dependsOn: string[];
}

// For DAG visualization
export interface DagNode {
  id: string;
  name: string;
  description?: string;
  category?: string;
  order: number;
}

export interface DagEdge {
  from: string;
  to: string;
}

// Define the MAG pipeline steps in execution order
export const MAG_PIPELINE_STEPS: PipelineStepDefinition[] = [
  {
    id: 'input_check',
    name: 'Input Validation',
    description: 'Validate samplesheet and input files',
    category: 'qc',
    order: 1,
    nextflowProcesses: ['SAMPLESHEET_CHECK', 'INPUT_CHECK'],
    dependsOn: [],
  },
  {
    id: 'fastqc_raw',
    name: 'Raw Read QC',
    description: 'Quality control of raw reads with FastQC',
    category: 'qc',
    order: 2,
    nextflowProcesses: ['FASTQC', 'FASTQC_RAW'],
    dependsOn: ['input_check'],
  },
  {
    id: 'read_trimming',
    name: 'Read Trimming',
    description: 'Adapter trimming and quality filtering',
    category: 'qc',
    order: 3,
    nextflowProcesses: ['FASTP', 'ADAPTERREMOVAL'],
    dependsOn: ['input_check'],
  },
  {
    id: 'host_removal',
    name: 'Host Removal',
    description: 'Remove host and PhiX contamination',
    category: 'qc',
    order: 4,
    nextflowProcesses: ['BOWTIE2_HOST_REMOVAL', 'BOWTIE2_PHIX_REMOVAL', 'BBMAP_BBSPLIT'],
    dependsOn: ['read_trimming'],
  },
  {
    id: 'fastqc_trimmed',
    name: 'Trimmed Read QC',
    description: 'Quality control after trimming',
    category: 'qc',
    order: 5,
    nextflowProcesses: ['FASTQC_TRIMMED'],
    dependsOn: ['host_removal'],
  },
  {
    id: 'assembly',
    name: 'Assembly',
    description: 'Metagenome assembly with MEGAHIT/SPAdes',
    category: 'assembly',
    order: 6,
    nextflowProcesses: ['MEGAHIT', 'SPADES', 'SPADESHYBRID'],
    dependsOn: ['host_removal'],
  },
  {
    id: 'assembly_qc',
    name: 'Assembly QC',
    description: 'Assembly quality assessment with QUAST',
    category: 'assembly',
    order: 7,
    nextflowProcesses: ['QUAST', 'QUAST_BINS', 'QUAST_BINS_SUMMARY'],
    dependsOn: ['assembly'],
  },
  {
    id: 'gene_prediction',
    name: 'Gene Prediction',
    description: 'Predict protein-coding genes with Prodigal',
    category: 'annotation',
    order: 8,
    nextflowProcesses: ['PRODIGAL'],
    dependsOn: ['assembly'],
  },
  {
    id: 'binning_prep',
    name: 'Binning Preparation',
    description: 'Map reads back to assembly for coverage',
    category: 'binning',
    order: 9,
    nextflowProcesses: ['BOWTIE2_ASSEMBLY_BUILD', 'BOWTIE2_ASSEMBLY_ALIGN', 'MINIMAP2_ALIGN'],
    dependsOn: ['assembly'],
  },
  {
    id: 'binning',
    name: 'Genome Binning',
    description: 'Bin contigs into MAGs (MetaBAT2, MaxBin2, CONCOCT)',
    category: 'binning',
    order: 10,
    nextflowProcesses: ['METABAT2', 'MAXBIN2', 'CONCOCT'],
    dependsOn: ['binning_prep'],
  },
  {
    id: 'bin_refinement',
    name: 'Bin Refinement',
    description: 'Refine bins with DAS Tool',
    category: 'binning',
    order: 11,
    nextflowProcesses: ['DASTOOL', 'DASTOOL_SCAFFOLDS2BIN'],
    dependsOn: ['binning'],
  },
  {
    id: 'bin_qc',
    name: 'Bin Quality Check',
    description: 'Assess bin quality with CheckM/BUSCO',
    category: 'binning',
    order: 12,
    nextflowProcesses: ['CHECKM', 'CHECKM_QA', 'BUSCO'],
    dependsOn: ['bin_refinement'],
  },
  {
    id: 'bin_taxonomy',
    name: 'Taxonomic Classification',
    description: 'Classify bins with GTDB-Tk/CAT',
    category: 'annotation',
    order: 13,
    nextflowProcesses: ['GTDBTK', 'GTDBTK_CLASSIFY', 'CAT', 'CAT_SUMMARY'],
    dependsOn: ['bin_qc'],
  },
  {
    id: 'bin_annotation',
    name: 'Genome Annotation',
    description: 'Annotate bins with Prokka/BAKTA',
    category: 'annotation',
    order: 14,
    nextflowProcesses: ['PROKKA', 'BAKTA', 'METAEUK'],
    dependsOn: ['bin_qc'],
  },
  {
    id: 'multiqc',
    name: 'MultiQC Report',
    description: 'Aggregate QC metrics into final report',
    category: 'reporting',
    order: 15,
    nextflowProcesses: ['MULTIQC', 'CUSTOM_DUMPSOFTWAREVERSIONS'],
    dependsOn: ['bin_qc'],
  },
];

// Get step by ID
export function getStepById(stepId: string): PipelineStepDefinition | undefined {
  return MAG_PIPELINE_STEPS.find((s) => s.id === stepId);
}

// Get step by Nextflow process name
export function getStepByProcess(processName: string): PipelineStepDefinition | undefined {
  // Process names in trace file are like "NFCORE_MAG:MAG:FASTQC_RAW (sample1)"
  // Extract just the process name part
  const cleanName = processName.split(':').pop()?.split(' ')[0] || processName;

  return MAG_PIPELINE_STEPS.find((step) =>
    step.nextflowProcesses.some((p) =>
      cleanName.toUpperCase().includes(p.toUpperCase())
    )
  );
}

// Get all steps for initial creation
export function getAllMagSteps(): PipelineStepDefinition[] {
  return [...MAG_PIPELINE_STEPS].sort((a, b) => a.order - b.order);
}

// Build DAG edges from step definitions
export function buildDagEdges(): DagEdge[] {
  const edges: DagEdge[] = [];

  for (const step of MAG_PIPELINE_STEPS) {
    for (const dep of step.dependsOn) {
      edges.push({ from: dep, to: step.id });
    }
  }

  return edges;
}

// Get DAG data for visualization
export function getMagDagData(): { nodes: DagNode[]; edges: DagEdge[] } {
  const nodes: DagNode[] = MAG_PIPELINE_STEPS.map((step) => ({
    id: step.id,
    name: step.name,
    description: step.description,
    category: step.category,
    order: step.order,
  }));

  const edges = buildDagEdges();

  return { nodes, edges };
}
