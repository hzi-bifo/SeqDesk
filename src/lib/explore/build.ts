import { db } from "@/lib/db";
import { buildPipelineTableDataset, type PipelineTableOptions } from "./builders/pipeline-table";
import { buildSamplesDataset } from "./builders/samples";
import { buildSequencingDataset } from "./builders/sequencing";
import type { BuildContext, BuiltDataset } from "./builders/types";
import { createDataset, getDatasetRecord, serializeDatasetSummary, writeDatasetVersion, type WriteVersionResult } from "./datasets";
import { parseJsonObject } from "./schema";
import type { ExploreDatasetSummary } from "./types";

export type BuildableKind = "samples" | "sequencing" | "pipeline-table";

export interface BuildRequest {
  context: BuildContext;
  kind: BuildableKind;
  options?: Record<string, unknown>;
  createdById: string;
  /** Rebuild into this dataset instead of matching by source configuration. */
  datasetId?: string;
}

export interface BuildResult {
  dataset: ExploreDatasetSummary;
  version: WriteVersionResult;
  warnings: string[];
}

export async function runBuilder(kind: BuildableKind, context: BuildContext, options: Record<string, unknown>): Promise<BuiltDataset | null> {
  switch (kind) {
    case "samples":
      return buildSamplesDataset(context);
    case "sequencing":
      return buildSequencingDataset(context);
    case "pipeline-table": {
      const pipelineId = typeof options.pipelineId === "string" ? options.pipelineId : "";
      const outputId = typeof options.outputId === "string" ? options.outputId : "";
      if (!pipelineId || !outputId) throw new Error("pipelineId and outputId are required for a pipeline table");
      const pipelineOptions: PipelineTableOptions = {
        pipelineId,
        outputId,
        runIds: Array.isArray(options.runIds) ? options.runIds.filter((id): id is string => typeof id === "string") : undefined,
        table: options.table && typeof options.table === "object" ? (options.table as PipelineTableOptions["table"]) : undefined,
      };
      return buildPipelineTableDataset(context, pipelineOptions);
    }
    default:
      throw new Error(`Unknown dataset kind: ${kind}`);
  }
}

/**
 * Build (or rebuild) a dataset. A scope has one dataset per builder
 * configuration: building the same source again writes a new version of the
 * existing dataset instead of creating a duplicate.
 */
export async function buildDataset(request: BuildRequest): Promise<BuildResult | null> {
  const built = await runBuilder(request.kind, request.context, request.options ?? {});
  if (!built) return null;

  const sourceConfigJson = JSON.stringify(built.sourceConfig);
  let dataset = request.datasetId ? await getDatasetRecord(request.datasetId) : null;
  if (!dataset) {
    dataset = await db.exploreDataset.findFirst({
      where: { targetKey: request.context.targetKey, kind: built.kind, sourceConfig: sourceConfigJson },
      include: { versions: { orderBy: { number: "desc" }, take: 1 } },
    });
  }
  if (!dataset) {
    const created = await createDataset({
      targetKey: request.context.targetKey,
      kind: built.kind,
      tableKind: built.tableKind,
      name: built.name,
      description: built.description,
      sensitivity: built.sensitivity,
      roles: built.roles,
      sourceConfig: built.sourceConfig,
      createdById: request.createdById,
    });
    dataset = await getDatasetRecord(created.id);
    if (!dataset) throw new Error("Dataset vanished after creation");
  } else {
    // Keep user-set roles; fill in roles the builder knows and the user did not set.
    const existingRoles = parseJsonObject(dataset.roles) ?? {};
    const mergedRoles = { ...built.roles, ...existingRoles };
    await db.exploreDataset.update({
      where: { id: dataset.id },
      data: {
        tableKind: built.tableKind,
        roles: JSON.stringify(mergedRoles),
        sensitivity: dataset.sensitivity === "standard" ? built.sensitivity : dataset.sensitivity,
      },
    });
  }

  const version = await writeDatasetVersion({
    datasetId: dataset.id,
    schema: built.schema,
    rows: built.rows,
    provenance: built.provenance,
    buildSource: request.datasetId ? "manual" : "auto",
    createdById: request.createdById,
    keys: built.keys,
  });
  const refreshed = await getDatasetRecord(dataset.id);
  if (!refreshed) throw new Error("Dataset vanished after writing a version");
  return { dataset: serializeDatasetSummary(refreshed), version, warnings: built.warnings };
}

/** Rebuild an existing dataset from its stored builder configuration. */
export async function rebuildDataset(datasetId: string, context: BuildContext, userId: string): Promise<BuildResult | null> {
  const dataset = await getDatasetRecord(datasetId);
  if (!dataset) return null;
  const sourceConfig = parseJsonObject(dataset.sourceConfig);
  const builder = sourceConfig?.builder;
  if (builder !== "samples" && builder !== "sequencing" && builder !== "pipeline-table") {
    throw new Error("This dataset was imported and cannot be rebuilt from a source");
  }
  return buildDataset({ context, kind: builder, options: sourceConfig ?? {}, createdById: userId, datasetId });
}
