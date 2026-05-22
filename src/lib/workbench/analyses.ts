import { db } from "@/lib/db";
import {
  DEFAULT_WORKBENCH_CANVAS,
  parseWorkbenchCanvas,
  stringifyWorkbenchCanvas,
  type WorkbenchCanvas,
  type WorkbenchCanvasNode,
} from "@/lib/workbench/canvas";
import { getOrCreateDefaultWorkbenchWorkspace } from "@/lib/workbench/workspaces";

export interface SerializedWorkbenchAnalysis {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  canvas: WorkbenchCanvas;
  revision: number;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface WorkbenchAnalysisUpdateResult {
  ok: boolean;
  conflict: boolean;
  analysis: SerializedWorkbenchAnalysis | null;
}

export function serializeWorkbenchAnalysis(analysis: {
  id: string;
  workspaceId: string;
  name: string;
  description: string | null;
  canvas: string;
  revision: number;
  isDefault: boolean;
  createdAt: Date;
  updatedAt: Date;
}): SerializedWorkbenchAnalysis {
  return {
    id: analysis.id,
    workspaceId: analysis.workspaceId,
    name: analysis.name,
    description: analysis.description,
    canvas: parseWorkbenchCanvas(analysis.canvas),
    revision: analysis.revision,
    isDefault: analysis.isDefault,
    createdAt: analysis.createdAt.toISOString(),
    updatedAt: analysis.updatedAt.toISOString(),
  };
}

export async function getOrCreateDefaultWorkbenchAnalysis(
  userId: string
): Promise<SerializedWorkbenchAnalysis> {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
  const existing = await db.workbenchAnalysis.findFirst({
    where: { workspaceId: workspace.id, isDefault: true },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return serializeWorkbenchAnalysis(existing);

  const created = await db.workbenchAnalysis.create({
    data: {
      workspaceId: workspace.id,
      name: "Untitled analysis",
      description: "Private Workbench canvas",
      canvas: stringifyWorkbenchCanvas(DEFAULT_WORKBENCH_CANVAS),
      isDefault: true,
    },
  });
  return serializeWorkbenchAnalysis(created);
}

export async function listWorkbenchAnalyses(
  userId: string
): Promise<SerializedWorkbenchAnalysis[]> {
  const defaultAnalysis = await getOrCreateDefaultWorkbenchAnalysis(userId);
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
  const analyses = await db.workbenchAnalysis.findMany({
    where: { workspaceId: workspace.id },
    orderBy: [{ isDefault: "desc" }, { updatedAt: "desc" }],
  });
  if (analyses.length === 0) return [defaultAnalysis];
  return analyses.map(serializeWorkbenchAnalysis);
}

export async function createWorkbenchAnalysis(args: {
  userId: string;
  name?: string;
  description?: string | null;
}): Promise<SerializedWorkbenchAnalysis> {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(args.userId);
  const created = await db.workbenchAnalysis.create({
    data: {
      workspaceId: workspace.id,
      name: args.name?.trim() || "Untitled analysis",
      description: args.description ?? null,
      canvas: stringifyWorkbenchCanvas(DEFAULT_WORKBENCH_CANVAS),
      isDefault: false,
    },
  });
  return serializeWorkbenchAnalysis(created);
}

export async function getWorkbenchAnalysisForUser(
  userId: string,
  analysisId: string
): Promise<SerializedWorkbenchAnalysis | null> {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
  const analysis = await db.workbenchAnalysis.findFirst({
    where: { id: analysisId, workspaceId: workspace.id },
  });
  return analysis ? serializeWorkbenchAnalysis(analysis) : null;
}

export async function updateWorkbenchAnalysis(args: {
  userId: string;
  analysisId: string;
  revision: number;
  name?: string;
  description?: string | null;
  canvas?: WorkbenchCanvas;
}): Promise<WorkbenchAnalysisUpdateResult> {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(args.userId);
  const existing = await db.workbenchAnalysis.findFirst({
    where: { id: args.analysisId, workspaceId: workspace.id },
  });
  if (!existing) {
    return { ok: false, conflict: false, analysis: null };
  }

  const data: {
    name?: string;
    description?: string | null;
    canvas?: string;
    revision: { increment: number };
  } = {
    revision: { increment: 1 },
  };
  if (typeof args.name === "string") data.name = args.name.trim() || "Untitled analysis";
  if (args.description !== undefined) data.description = args.description;
  if (args.canvas) data.canvas = stringifyWorkbenchCanvas(args.canvas);

  const updated = await db.workbenchAnalysis.updateMany({
    where: {
      id: args.analysisId,
      workspaceId: workspace.id,
      revision: args.revision,
    },
    data,
  });

  const latest = await db.workbenchAnalysis.findFirst({
    where: { id: args.analysisId, workspaceId: workspace.id },
  });
  if (!latest) return { ok: false, conflict: false, analysis: null };
  return {
    ok: updated.count === 1,
    conflict: updated.count !== 1,
    analysis: serializeWorkbenchAnalysis(latest),
  };
}

function upsertCanvasNode(nodes: WorkbenchCanvasNode[], node: WorkbenchCanvasNode) {
  const index = nodes.findIndex((entry) => entry.id === node.id);
  if (index >= 0) {
    nodes[index] = node;
  } else {
    nodes.push(node);
  }
}

export async function updateWorkbenchAnalysisNodeForImportJob(args: {
  analysisId?: string | null;
  analysisNodeId?: string | null;
  jobId: string;
  status: string;
  phase?: string | null;
  progress?: number | null;
  error?: string | null;
  resultDataset?: {
    id: string;
    name: string;
    description?: string | null;
  } | null;
}): Promise<void> {
  if (!args.analysisId || !args.analysisNodeId) return;
  const analysis = await db.workbenchAnalysis.findUnique({
    where: { id: args.analysisId },
  });
  if (!analysis) return;

  const canvas = parseWorkbenchCanvas(analysis.canvas);
  const sourceNode = canvas.nodes.find((node) => node.id === args.analysisNodeId);
  if (!sourceNode) return;

  sourceNode.data = {
    ...sourceNode.data,
    status: args.status,
    phase: args.phase ?? undefined,
    progress: args.progress ?? undefined,
    jobId: args.jobId,
    error: args.error ?? undefined,
  };

  if (args.resultDataset) {
    const datasetNodeId = `dataset-${args.resultDataset.id}`;
    const datasetNode: WorkbenchCanvasNode = {
      id: datasetNodeId,
      type: "workbench",
      position: {
        x: sourceNode.position.x + 320,
        y: sourceNode.position.y,
      },
      data: {
        kind: "dataset",
        label: args.resultDataset.name,
        description: args.resultDataset.description ?? "Imported Workbench dataset",
        datasetId: args.resultDataset.id,
        status: "ready",
      },
    };
    upsertCanvasNode(canvas.nodes, datasetNode);
    const edgeId = `${sourceNode.id}->${datasetNodeId}`;
    if (!canvas.edges.some((edge) => edge.id === edgeId)) {
      canvas.edges.push({
        id: edgeId,
        source: sourceNode.id,
        target: datasetNodeId,
        label: "creates",
      });
    }
  }

  await db.workbenchAnalysis.update({
    where: { id: analysis.id },
    data: {
      canvas: stringifyWorkbenchCanvas(canvas),
      revision: { increment: 1 },
    },
  });
}
