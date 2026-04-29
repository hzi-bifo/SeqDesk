export interface SmokeArtifactEntry {
  path: string;
  sizeBytes: number;
  type: "report" | "qc" | "dag" | "log" | "data" | "artifact";
}

export interface SmokeArtifactSuggestion {
  id: string;
  label: string;
  pattern: string;
  destination: "run_artifact" | "study_report" | "sample_qc";
  type: "report" | "qc" | "artifact";
  count: number;
}

export interface SmokeArtifactInspection {
  summary: {
    totalFiles: number;
    publishedFiles: number;
    ignoredWorkFiles: number;
    suggestedOutputs: number;
  };
  entries: SmokeArtifactEntry[];
  suggestions: SmokeArtifactSuggestion[];
}

interface ZipEntry {
  path: string;
  sizeBytes: number;
  isDirectory: boolean;
}

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_DIRECTORY_SIGNATURE = 0x02014b50;
const MAX_EOCD_SEARCH = 65_557;

function normalizeZipPath(value: string): string {
  return value.replace(/\\/g, "/").replace(/^\/+/, "");
}

function findEndOfCentralDirectory(buffer: Buffer): number {
  const searchStart = Math.max(0, buffer.length - MAX_EOCD_SEARCH);
  for (let offset = buffer.length - 22; offset >= searchStart; offset -= 1) {
    if (buffer.readUInt32LE(offset) === EOCD_SIGNATURE) {
      return offset;
    }
  }
  throw new Error("Invalid ZIP file: central directory not found.");
}

export function listZipEntries(buffer: Buffer): ZipEntry[] {
  const eocdOffset = findEndOfCentralDirectory(buffer);
  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirectoryOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries: ZipEntry[] = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (offset + 46 > buffer.length) {
      throw new Error("Invalid ZIP file: central directory entry is truncated.");
    }
    if (buffer.readUInt32LE(offset) !== CENTRAL_DIRECTORY_SIGNATURE) {
      throw new Error("Invalid ZIP file: central directory entry is malformed.");
    }

    const compressedSize = buffer.readUInt32LE(offset + 20);
    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    const fileNameLength = buffer.readUInt16LE(offset + 28);
    const extraFieldLength = buffer.readUInt16LE(offset + 30);
    const commentLength = buffer.readUInt16LE(offset + 32);
    const fileNameStart = offset + 46;
    const fileNameEnd = fileNameStart + fileNameLength;
    if (fileNameEnd > buffer.length) {
      throw new Error("Invalid ZIP file: filename is truncated.");
    }

    const entryPath = normalizeZipPath(
      buffer.subarray(fileNameStart, fileNameEnd).toString("utf8")
    );
    entries.push({
      path: entryPath,
      sizeBytes: uncompressedSize || compressedSize,
      isDirectory: entryPath.endsWith("/"),
    });

    offset = fileNameEnd + extraFieldLength + commentLength;
  }

  return entries;
}

function classifyEntry(path: string): SmokeArtifactEntry["type"] {
  const lower = path.toLowerCase();
  const fileName = lower.split("/").pop() || lower;
  if (fileName === "dag.dot" || lower.endsWith(".dot")) return "dag";
  if (lower.endsWith(".html") || lower.endsWith(".pdf")) return "report";
  if (lower.includes("/qc/")) return "qc";
  if (
    lower.endsWith(".log") ||
    lower.endsWith(".out") ||
    lower.endsWith(".err") ||
    fileName === "trace.txt"
  ) {
    return "log";
  }
  if (
    lower.endsWith(".txt") ||
    lower.endsWith(".tsv") ||
    lower.endsWith(".csv") ||
    lower.endsWith(".json") ||
    lower.endsWith(".yaml") ||
    lower.endsWith(".yml")
  ) {
    return "data";
  }
  return "artifact";
}

function isPublishedResultPath(path: string): boolean {
  const lower = path.toLowerCase();
  return lower.startsWith("results/") || !lower.includes("/");
}

function isWorkPath(path: string): boolean {
  return path.toLowerCase().startsWith("work/");
}

function countMatches(entries: SmokeArtifactEntry[], predicate: (path: string) => boolean): number {
  return entries.filter((entry) => predicate(entry.path.toLowerCase())).length;
}

function buildSuggestions(entries: SmokeArtifactEntry[]): SmokeArtifactSuggestion[] {
  const candidates: Array<Omit<SmokeArtifactSuggestion, "count"> & {
    match: (path: string) => boolean;
  }> = [
    {
      id: "final-html-reports",
      label: "Combined HTML reports",
      pattern: "results/**/final/**/*.html",
      destination: "study_report",
      type: "report",
      match: (path) => path.startsWith("results/") && path.includes("/final/") && path.endsWith(".html"),
    },
    {
      id: "final-pdf-reports",
      label: "Combined PDF reports",
      pattern: "results/**/final/**/*.pdf",
      destination: "study_report",
      type: "report",
      match: (path) => path.startsWith("results/") && path.includes("/final/") && path.endsWith(".pdf"),
    },
    {
      id: "final-text-reports",
      label: "Combined text reports",
      pattern: "results/**/final/**/*.txt",
      destination: "run_artifact",
      type: "artifact",
      match: (path) => path.startsWith("results/") && path.includes("/final/") && path.endsWith(".txt"),
    },
    {
      id: "profiling-tables",
      label: "Profiling tables",
      pattern: "results/**/profiling/**/*.txt",
      destination: "run_artifact",
      type: "artifact",
      match: (path) => path.startsWith("results/") && path.includes("/profiling/") && path.endsWith(".txt"),
    },
    {
      id: "amr-summaries",
      label: "AMR summaries",
      pattern: "results/**/amr/**/predict_amrs_summary.txt",
      destination: "run_artifact",
      type: "artifact",
      match: (path) => path.startsWith("results/") && path.includes("/amr/") && path.endsWith("/predict_amrs_summary.txt"),
    },
    {
      id: "virulence-summaries",
      label: "Virulence summaries",
      pattern: "results/**/virulence/**/blast_vfs_summary.txt",
      destination: "run_artifact",
      type: "artifact",
      match: (path) => path.startsWith("results/") && path.includes("/virulence/") && path.endsWith("/blast_vfs_summary.txt"),
    },
    {
      id: "qc-artifacts",
      label: "QC artifacts",
      pattern: "results/**/qc/**/*",
      destination: "sample_qc",
      type: "qc",
      match: (path) => path.startsWith("results/") && path.includes("/qc/"),
    },
  ];

  return candidates
    .map(({ match, ...candidate }) => ({
      ...candidate,
      count: countMatches(entries, match),
    }))
    .filter((candidate) => candidate.count > 0);
}

export function inspectSmokeArtifactZip(buffer: Buffer): SmokeArtifactInspection {
  const zipEntries = listZipEntries(buffer);
  const files = zipEntries.filter((entry) => !entry.isDirectory);
  const ignoredWorkFiles = files.filter((entry) => isWorkPath(entry.path)).length;
  const entries = files
    .filter((entry) => !isWorkPath(entry.path) && isPublishedResultPath(entry.path))
    .map((entry) => ({
      path: entry.path,
      sizeBytes: entry.sizeBytes,
      type: classifyEntry(entry.path),
    }))
    .sort((a, b) => a.path.localeCompare(b.path));
  const suggestions = buildSuggestions(entries);

  return {
    summary: {
      totalFiles: files.length,
      publishedFiles: entries.length,
      ignoredWorkFiles,
      suggestedOutputs: suggestions.length,
    },
    entries,
    suggestions,
  };
}
