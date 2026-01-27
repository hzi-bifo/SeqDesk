// Pipeline Definitions Loader
// Loads pipeline DAG definitions from JSON files in data/pipeline-definitions/
//
// To add a new pipeline:
// 1. Run: npx ts-node scripts/generate-pipeline-def.ts <pipeline-name>
// 2. Edit the generated JSON in data/pipeline-definitions/<pipeline>.json
// 3. The app will automatically load it

import fs from 'fs';
import path from 'path';

export type StepCategory =
  | 'qc'
  | 'preprocessing'
  | 'assembly'
  | 'binning'
  | 'annotation'
  | 'quantification'
  | 'alignment'
  | 'variant_calling'
  | 'reporting';

export interface PipelineStepDef {
  id: string;
  name: string;
  description: string;
  category: StepCategory;
  dependsOn: string[];
  tools?: string[];           // Tools/software used in this step
  outputs?: string[];         // File types produced by this step
  docs?: string;              // URL to documentation
  parameters?: string[];      // Parameter names relevant to this step
}

export interface PipelineParameter {
  name: string;
  type: 'string' | 'integer' | 'number' | 'boolean' | 'file' | 'path';
  description: string;
  default?: string | number | boolean;
  required?: boolean;
  enum?: (string | number)[];
  pattern?: string;
  minimum?: number;
  maximum?: number;
  group?: string;
  hidden?: boolean;
}

export interface PipelineParameterGroup {
  name: string;
  description?: string;
  parameters: PipelineParameter[];
}

export type SeqDeskSource =
  | 'order_reads'        // FASTQ files from order
  | 'order_files'        // Any files attached to order
  | 'sample_reads'       // Per-sample read files
  | 'samplesheet'        // Generated samplesheet
  | 'reference_genome'   // Reference from settings
  | 'manual';            // User provides manually

export type SeqDeskDestination =
  | 'sample_qc'          // Updates sample QC status
  | 'sample_metadata'    // Updates sample metadata fields
  | 'order_files'        // Stored as order output files
  | 'order_report'       // Linked as order report
  | 'sample_assemblies'  // Stored as sample assemblies
  | 'sample_bins'        // Stored as sample genome bins
  | 'sample_annotations' // Stored as sample annotations
  | 'download_only';     // Available for download only

export interface PipelineInput {
  id: string;
  name: string;
  description?: string;
  fileTypes?: string[];
  source?: SeqDeskSource;        // Where this input comes from in SeqDesk
  sourceDescription?: string;    // Human-readable description
}

export interface PipelineOutput {
  id: string;
  name: string;
  description?: string;
  fromStep: string;
  fileTypes?: string[];
  destination?: SeqDeskDestination;  // Where this output goes in SeqDesk
  destinationField?: string;         // Specific field it updates (e.g., "qc_status")
  destinationDescription?: string;   // Human-readable description
}

export interface PipelineDefinition {
  pipeline: string;
  name?: string;
  description?: string;
  url?: string;
  version?: string;
  minNextflowVersion?: string;
  authors?: string[];
  inputs?: PipelineInput[];
  outputs?: PipelineOutput[];
  steps: PipelineStepDef[];
  parameterGroups?: PipelineParameterGroup[];
}

export interface DagNode {
  id: string;
  name: string;
  description?: string;
  category?: string;
  order: number;
  nodeType: 'step' | 'input' | 'output';
  fileTypes?: string[];
  tools?: string[];           // Tools/software used (for steps)
  outputs?: string[];         // File types produced (for steps)
  docs?: string;              // URL to documentation
  parameters?: string[];      // Parameter names relevant to this step
  // SeqDesk integration
  source?: SeqDeskSource;
  sourceDescription?: string;
  destination?: SeqDeskDestination;
  destinationField?: string;
  destinationDescription?: string;
}

export interface DagEdge {
  from: string;
  to: string;
  label?: string;  // File types flowing through this edge
}

export interface DagData {
  nodes: DagNode[];
  edges: DagEdge[];
  pipeline?: {
    name?: string;
    description?: string;
    url?: string;
    version?: string;
    minNextflowVersion?: string;
    authors?: string[];
    parameterGroups?: PipelineParameterGroup[];
  };
}

// Cache for loaded definitions
const definitionCache = new Map<string, PipelineDefinition>();

/**
 * Get the path to pipeline definitions directory
 */
function getDefinitionsDir(): string {
  // In Next.js, we need to handle both dev and production
  const possiblePaths = [
    path.join(process.cwd(), 'data', 'pipeline-definitions'),
    path.join(process.cwd(), '..', 'data', 'pipeline-definitions'),
  ];

  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      return p;
    }
  }

  return possiblePaths[0];
}

/**
 * Load a pipeline definition from JSON file
 */
function loadDefinition(pipelineId: string): PipelineDefinition | null {
  // Check cache first
  if (definitionCache.has(pipelineId)) {
    return definitionCache.get(pipelineId)!;
  }

  const defDir = getDefinitionsDir();
  const filePath = path.join(defDir, `${pipelineId}.json`);

  try {
    if (!fs.existsSync(filePath)) {
      return null;
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const definition = JSON.parse(content) as PipelineDefinition;

    // Cache it
    definitionCache.set(pipelineId, definition);

    return definition;
  } catch (error) {
    console.error(`Failed to load pipeline definition for ${pipelineId}:`, error);
    return null;
  }
}

/**
 * Convert pipeline definition to DAG data with proper ordering
 */
function definitionToDag(definition: PipelineDefinition): DagData {
  const steps = definition.steps;
  const inputs = definition.inputs || [];
  const outputs = definition.outputs || [];

  // Assign order based on topological sort
  const order = new Map<string, number>();
  const inDegree = new Map<string, number>();
  const adj = new Map<string, string[]>();

  steps.forEach((s) => {
    inDegree.set(s.id, 0);
    adj.set(s.id, []);
  });

  steps.forEach((s) => {
    s.dependsOn.forEach((dep) => {
      adj.get(dep)?.push(s.id);
      inDegree.set(s.id, (inDegree.get(s.id) || 0) + 1);
    });
  });

  const queue: string[] = [];
  inDegree.forEach((deg, id) => {
    if (deg === 0) queue.push(id);
  });

  let orderNum = 1;
  while (queue.length > 0) {
    const current = queue.shift()!;
    order.set(current, orderNum++);
    adj.get(current)?.forEach((next) => {
      const newDeg = (inDegree.get(next) || 1) - 1;
      inDegree.set(next, newDeg);
      if (newDeg === 0) queue.push(next);
    });
  }

  const maxOrder = Math.max(...Array.from(order.values()), 0);

  const nodes: DagNode[] = [];
  const edges: DagEdge[] = [];

  // Build a map of step outputs for edge labels
  const stepOutputs = new Map<string, string[]>();
  steps.forEach((s) => {
    if (s.outputs) {
      stepOutputs.set(s.id, s.outputs);
    }
  });

  // Add input nodes (order 0, before all steps)
  inputs.forEach((input, idx) => {
    nodes.push({
      id: `input_${input.id}`,
      name: input.name,
      description: input.description,
      category: 'input',
      order: 0,
      nodeType: 'input',
      fileTypes: input.fileTypes,
      source: input.source,
      sourceDescription: input.sourceDescription,
    });
    // Connect input to the first step (input validation)
    const firstStep = steps.find((s) => s.dependsOn.length === 0);
    if (firstStep) {
      const label = input.fileTypes?.join(', ');
      edges.push({ from: `input_${input.id}`, to: firstStep.id, label });
    }
  });

  // Add step nodes
  steps.forEach((s) => {
    nodes.push({
      id: s.id,
      name: s.name,
      description: s.description,
      category: s.category,
      order: order.get(s.id) || 0,
      nodeType: 'step',
      tools: s.tools,
      outputs: s.outputs,
      docs: s.docs,
      parameters: s.parameters,
    });
  });

  // Add step edges with labels from source step outputs
  steps.forEach((s) => {
    s.dependsOn.forEach((dep) => {
      const depOutputs = stepOutputs.get(dep);
      const label = depOutputs?.join(', ');
      edges.push({ from: dep, to: s.id, label });
    });
  });

  // Add output nodes (after their source steps)
  outputs.forEach((output, idx) => {
    const sourceStep = steps.find((s) => s.id === output.fromStep);
    const sourceOrder = sourceStep ? (order.get(sourceStep.id) || 0) : maxOrder;

    nodes.push({
      id: `output_${output.id}`,
      name: output.name,
      description: output.description,
      category: 'output',
      order: maxOrder + 1,
      nodeType: 'output',
      fileTypes: output.fileTypes,
      destination: output.destination,
      destinationField: output.destinationField,
      destinationDescription: output.destinationDescription,
    });
    // Connect from source step with file types as label
    if (output.fromStep) {
      const label = output.fileTypes?.join(', ');
      edges.push({ from: output.fromStep, to: `output_${output.id}`, label });
    }
  });

  return {
    nodes,
    edges,
    pipeline: {
      name: definition.name,
      description: definition.description,
      url: definition.url,
      version: definition.version,
      minNextflowVersion: definition.minNextflowVersion,
      authors: definition.authors,
      parameterGroups: definition.parameterGroups,
    },
  };
}

/**
 * Get DAG data for a pipeline
 */
export function getPipelineDag(pipelineId: string): DagData | null {
  const definition = loadDefinition(pipelineId);
  if (!definition) return null;
  return definitionToDag(definition);
}

/**
 * Get full pipeline definition
 */
export function getPipelineDefinition(pipelineId: string): PipelineDefinition | null {
  return loadDefinition(pipelineId);
}

/**
 * Get list of all available pipeline definitions
 */
export function getAvailablePipelineDefinitions(): string[] {
  const defDir = getDefinitionsDir();

  try {
    if (!fs.existsSync(defDir)) {
      return [];
    }

    const files = fs.readdirSync(defDir);
    return files
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.replace('.json', ''));
  } catch {
    return [];
  }
}

/**
 * Check if a pipeline has a definition
 */
export function hasPipelineDefinition(pipelineId: string): boolean {
  const defDir = getDefinitionsDir();
  const filePath = path.join(defDir, `${pipelineId}.json`);
  return fs.existsSync(filePath);
}
