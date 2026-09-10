import type { PipelineTableSource } from "./builders/pipeline-table";

export type OutputViewKind = "table" | "report" | "image" | "file";
export interface PipelineOutputFile {
  id: string;
  name: string;
  kind: OutputViewKind;
  size: number | null;
  sample: string | null;
  previewable: boolean;
}
export interface PipelineOutputSource {
  id: string;
  pipelineId: string;
  pipelineName: string;
  outputId: string | null;
  label: string;
  description?: string;
  kind: OutputViewKind;
  table?: PipelineTableSource;
  runs: Array<{ id: string; runNumber: string; completedAt: string | null; files: PipelineOutputFile[]; usage?: { datasetId: string; state: "workspace" | "report" } }>;
  templates: Array<{ id: string; name: string; inputAlias: string; description?: string; outputSummary?: string }>;
}

/** Viewer selection is based on supported formats, never pipeline names. Unknown files are download-only. */
export function outputFileView(name: string): { kind: OutputViewKind; contentType: string | null } {
  const extension = name.split(".").pop()?.toLowerCase() ?? "";
  if (["html", "htm", "pdf"].includes(extension)) return { kind: "report", contentType: extension === "pdf" ? "application/pdf" : "text/html; charset=utf-8" };
  const imageTypes: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", webp: "image/webp", gif: "image/gif" };
  if (imageTypes[extension]) return { kind: "image", contentType: imageTypes[extension] };
  return { kind: "file", contentType: null };
}

export function pipelineOutputFileUrl(scope: string, artifactId: string, mode: "preview" | "download" | "table" = "preview") {
  return `/api/explore/pipeline-outputs/${encodeURIComponent(artifactId)}/file?targetKey=${encodeURIComponent(scope)}&mode=${mode}`;
}
