import { z } from "zod";

export const WORKBENCH_CANVAS_VERSION = 1;

export const WORKBENCH_SOURCE_DEFAULT_CONFIG = {
  taxon: "Escherichia coli",
  cap: 25,
  assemblySource: "refseq",
  mag: "exclude",
  excludeAtypical: true,
  referenceOnly: false,
  assemblyLevels: ["complete", "chromosome"],
};

const positionSchema = z.object({
  x: z.number().finite(),
  y: z.number().finite(),
});

const viewportSchema = positionSchema.extend({
  zoom: z.number().finite().positive().default(1),
});

const canvasNodeDataSchema = z
  .object({
    kind: z.enum(["source.importer", "dataset", "note", "placeholder"]),
    label: z.string().min(1).max(160),
    description: z.string().max(500).optional(),
    providerId: z.string().max(120).optional(),
    storeItemId: z.string().max(120).optional(),
    status: z.string().max(40).optional(),
    phase: z.string().max(80).optional(),
    progress: z.number().int().min(0).max(100).optional(),
    jobId: z.string().max(120).optional(),
    datasetId: z.string().max(120).optional(),
    error: z.string().max(1000).optional(),
    note: z.string().max(5000).optional(),
    config: z.unknown().optional(),
  })
  .passthrough();

export const workbenchCanvasNodeSchema = z.object({
  id: z.string().min(1).max(120),
  type: z.string().max(80).default("workbench"),
  position: positionSchema,
  data: canvasNodeDataSchema,
});

export const workbenchCanvasEdgeSchema = z.object({
  id: z.string().min(1).max(160),
  source: z.string().min(1).max(120),
  target: z.string().min(1).max(120),
  label: z.string().max(120).optional(),
});

export const workbenchCanvasSchema = z.object({
  version: z.literal(WORKBENCH_CANVAS_VERSION),
  nodes: z.array(workbenchCanvasNodeSchema).default([]),
  edges: z.array(workbenchCanvasEdgeSchema).default([]),
  viewport: viewportSchema.default({ x: 0, y: 0, zoom: 1 }),
});

export type WorkbenchCanvas = z.infer<typeof workbenchCanvasSchema>;
export type WorkbenchCanvasNode = z.infer<typeof workbenchCanvasNodeSchema>;
export type WorkbenchCanvasEdge = z.infer<typeof workbenchCanvasEdgeSchema>;

export const DEFAULT_WORKBENCH_CANVAS: WorkbenchCanvas = {
  version: WORKBENCH_CANVAS_VERSION,
  nodes: [],
  edges: [],
  viewport: { x: 0, y: 0, zoom: 1 },
};

export function parseWorkbenchCanvas(value: unknown): WorkbenchCanvas {
  if (typeof value === "string") {
    try {
      return workbenchCanvasSchema.parse(JSON.parse(value));
    } catch {
      return DEFAULT_WORKBENCH_CANVAS;
    }
  }
  const parsed = workbenchCanvasSchema.safeParse(value);
  return parsed.success ? parsed.data : DEFAULT_WORKBENCH_CANVAS;
}

export function stringifyWorkbenchCanvas(canvas: unknown): string {
  return JSON.stringify(workbenchCanvasSchema.parse(canvas));
}

export function createReferenceGenomeSourceNode(args?: {
  id?: string;
  x?: number;
  y?: number;
}): WorkbenchCanvasNode {
  return {
    id: args?.id || `source-${Date.now()}`,
    type: "workbench",
    position: { x: args?.x ?? 120, y: args?.y ?? 120 },
    data: {
      kind: "source.importer",
      label: "Reference genomes",
      description: "NCBI Genomes by Taxon",
      providerId: "ncbi-genomes-taxon",
      storeItemId: "ncbi-datasets-cli",
      status: "draft",
      config: { ...WORKBENCH_SOURCE_DEFAULT_CONFIG },
    },
  };
}

export function createTextNoteNode(args?: {
  id?: string;
  x?: number;
  y?: number;
  note?: string;
}): WorkbenchCanvasNode {
  return {
    id: args?.id || `note-${Date.now()}`,
    type: "workbench",
    position: { x: args?.x ?? 180, y: args?.y ?? 240 },
    data: {
      kind: "note",
      label: "Text note",
      note: args?.note || "Add analysis context here.",
    },
  };
}
