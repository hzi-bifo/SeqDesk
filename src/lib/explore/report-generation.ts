/** Shared, client-safe contracts for guided report creation. */
import { z } from "zod";
import { KitOutputSchema, KitReportSchema } from "./kits/schema";
import { figureBlockId, tableBlockId, type ReportBlock } from "./report-blocks";

export const GenerationSnapshotSchema = z.object({
  version: z.literal(1),
  requestHash: z.string(),
  name: z.string(),
  description: z.string(),
  outputs: z.array(KitOutputSchema),
  report: KitReportSchema.optional(),
  citation: z.string().optional(),
});
export type GenerationSnapshot = z.infer<typeof GenerationSnapshotSchema>;

export function generationSnapshot(raw: string | null | undefined): GenerationSnapshot | null {
  try { return GenerationSnapshotSchema.parse(JSON.parse(raw ?? "null")?.generation); } catch { return null; }
}

export function outputLabel(output: { name: string; label?: string }) {
  return output.label ?? output.name.replace(/[_-]+/g, " ").replace(/^./, char => char.toUpperCase());
}

export function outputSummary(outputs: Array<{ kind: string; report?: { include?: boolean } }>) {
  const counts = new Map<string, number>();
  for (const output of outputs.filter(output => output.report?.include !== false)) {
    const label = output.kind === "figure" ? "chart" : output.kind === "table" ? "table" : "report file";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => `${count} ${label}${count === 1 ? "" : "s"}`).join(" · ") || "Outputs depend on the available data";
}

export interface GeneratedArtifact { id: string; name: string; kind: string; format: string; derivedDatasetId: string | null }
export interface GenerationItem { label: string; block: ReportBlock }
export interface ReportGeneration {
  analysisId: string;
  name: string;
  status: string;
  runId: string | null;
  runNumber: string | null;
  createdAt: string;
  items: GenerationItem[];
  warnings: string[];
  notes: string[];
  addedIds: string[];
}

const escapeMarkdown = (text: string) => text.replace(/[\\`*_[\]<>#]/g, "\\$&");

/** Only actual, finalized outputs become blocks. Missing/optional output never becomes a fabricated figure or table. */
export function generationItems(input: {
  analysisId: string; runId: string; runNumber: string; snapshot: GenerationSnapshot;
  artifacts: GeneratedArtifact[]; metrics: Record<string, unknown>; notes?: string[];
}): { items: GenerationItem[]; warnings: string[] } {
  const { snapshot, analysisId } = input;
  const items: GenerationItem[] = [];
  const warnings: string[] = [];
  const metrics = snapshot.report?.metrics?.filter(metric => typeof input.metrics[metric.key] === "number" && Number.isFinite(input.metrics[metric.key])) ?? [];
  if (metrics.length) items.push({ label: "Summary metrics", block: {
    id: `generation:${analysisId}:metrics`, type: "run-metric", analysisId, metrics: metrics.map(metric => metric.key),
    labels: Object.fromEntries(metrics.map(metric => [metric.key, metric.label])),
    units: Object.fromEntries(metrics.filter(metric => metric.unit).map(metric => [metric.key, metric.unit!])),
    digits: Object.fromEntries(metrics.filter(metric => metric.digits !== undefined).map(metric => [metric.key, metric.digits!])),
    columns: Math.min(metrics.length, 4), span: 2,
  } });
  for (const output of snapshot.outputs) {
    if (output.report?.include === false) continue;
    const candidates = input.artifacts.filter(artifact => artifact.name === output.name && artifact.kind === output.kind);
    const label = outputLabel(output);
    const span = output.report?.span ?? 2;
    if (output.kind === "figure") {
      const artifact = candidates.find(artifact => ["plotly-json", "png", "svg"].includes(artifact.format));
      if (artifact) items.push({ label, block: { id: figureBlockId(analysisId, output.name), type: "figure", analysisId, figureName: output.name, caption: label, span } });
      else if (!output.optional) warnings.push(`${label} was not produced as a supported chart.`);
    } else if (output.kind === "table") {
      const artifact = candidates.find(artifact => artifact.derivedDatasetId);
      if (artifact?.derivedDatasetId) items.push({ label, block: { id: tableBlockId(artifact.derivedDatasetId), type: "table", datasetId: artifact.derivedDatasetId, caption: label, download: true, search: true, span } });
      else if (!output.optional) warnings.push(`${label} was not produced as a usable table.`);
    } else {
      const artifact = candidates[0];
      if (artifact) items.push({ label, block: { id: `generation:${analysisId}:file:${items.length}`, type: "text", markdown: `[${escapeMarkdown(label)}](/api/explore/runs/${encodeURIComponent(input.runId)}/artifacts/${encodeURIComponent(artifact.id)}?download=1)`, span } });
      else if (!output.optional) warnings.push(`${label} was not produced.`);
    }
  }
  if (items.length && (input.notes?.length || warnings.length)) items.push({ label: "Analysis notes and limitations", block: {
    id: `generation:${analysisId}:notes`, type: "text", span: 2,
    markdown: `### Analysis notes\n\n${[...(input.notes ?? []), ...warnings].map(note => `- ${escapeMarkdown(note)}`).join("\n")}`.slice(0, 20000),
  } });
  if (items.length) items.unshift({ label: snapshot.name, block: {
    id: `generation:${analysisId}:intro`, type: "text", span: 2,
    markdown: `## ${escapeMarkdown(snapshot.name)}\n\n${snapshot.report?.introduction ?? escapeMarkdown(snapshot.description)}\n\nFrom analysis run [${escapeMarkdown(input.runNumber)}](/explore/analyses/${encodeURIComponent(analysisId)}). Uses saved results; the sequencing pipeline was not rerun.${snapshot.citation ? `\n\n${escapeMarkdown(snapshot.citation)}` : ""}`,
  } });
  return { items, warnings };
}
