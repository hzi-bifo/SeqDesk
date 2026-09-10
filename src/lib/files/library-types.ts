/** Client-safe file library metadata. Original uploads are immutable. */
export const MAX_LIBRARY_FILE_BYTES = 100 * 1024 * 1024;

export interface AnalysisFileBinding {
  alias: string;
  fileId: string;
}

export interface LibraryFileSummary {
  id: string;
  targetKey: string;
  originalName: string;
  mimeType: string;
  sizeBytes: number;
  checksumSha256: string;
  createdAt: string;
  canImportTable: boolean;
  datasets: Array<{ id: string; name: string }>;
  reports: Array<{ id: string; title: string; attached: boolean; usedInReport: boolean }>;
}

export interface LibraryResponse {
  files: LibraryFileSummary[];
  canEdit: boolean;
}

export function canImportFileAsTable(name: string): boolean {
  return /\.(csv|tsv|tab|txt|xlsx|xlsm)$/i.test(name);
}

export function filesHref(scope: string, reportId?: string | null): string {
  return `/files?scope=${encodeURIComponent(scope)}${reportId ? `&report=${encodeURIComponent(reportId)}` : ""}`;
}

export function parseStoredFileBindings(raw: string | null | undefined): AnalysisFileBinding[] {
  try {
    const entries: unknown = JSON.parse(raw || "[]");
    if (!Array.isArray(entries)) return [];
    return entries.filter((entry): entry is AnalysisFileBinding =>
      !!entry && typeof entry === "object" &&
      typeof entry.alias === "string" && /^[a-z][a-z0-9_]{0,39}$/.test(entry.alias) &&
      typeof entry.fileId === "string" && /^[a-zA-Z0-9_-]+$/.test(entry.fileId)
    );
  } catch {
    return [];
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
