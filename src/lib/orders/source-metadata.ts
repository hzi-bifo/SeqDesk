import { importModuleCatalog } from "@/lib/modules/import-catalog";
import { camiCatalog } from "@/lib/workbench/importers/cami-catalog";

type Metadata = Record<string, unknown>;
export interface SourceImportSnapshot {
  id: string;
  providerId: string;
  status: string;
  createdAt: string;
  sourceKey: string;
  title: string;
  metadata: Metadata;
}

export interface SourceMetadataOrder {
  dataOrigin?: string;
  sourceMetadata?: string | null;
  sourceImports?: SourceImportSnapshot[];
  samples: Array<{
    id: string;
    sampleId: string;
    sampleTitle?: string | null;
    customFields?: string | null;
    reads?: Array<{
      id: string;
      file1?: string | null;
      file2?: string | null;
      dataClass?: string;
      pipelineSources?: string | null;
      runAccessionNumber?: string | null;
    }>;
  }>;
}

export interface SourceMetadataEntry {
  id: string;
  sampleId: string;
  sampleLabel: string;
  readId?: string;
  details: Array<{ label: string; value: string }>;
  original: Metadata;
}

export interface SequencingSourceGroup {
  id: string;
  providerId: string;
  moduleName: string;
  kind: "Import module" | "File source" | "Facility module" | "Source";
  theme?: "cami" | "sra";
  title: string;
  sourceKey: string;
  synthetic: boolean;
  links: Array<{ label: string; url: string }>;
  hosts: string[];
  entries: SourceMetadataEntry[];
  imports: SourceImportSnapshot[];
}

export function sourceMetadataRecord(value: unknown): Metadata {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch { return {}; }
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

export function safeSourceUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

function sourceIdentity(providerId: string) {
  const sourceModule = importModuleCatalog.find(item => item.providerId === providerId);
  if (sourceModule) return { moduleName: sourceModule.name, kind: "Import module" as const, theme: sourceModule.source };
  if (providerId === "facility") return { moduleName: "Facility sequencing", kind: "Facility module" as const };
  if (providerId === "local_files") return { moduleName: "Files from server storage", kind: "File source" as const };
  if (["upload", "local-upload"].includes(providerId)) return { moduleName: "Local file upload", kind: "File source" as const };
  return { moduleName: providerId === "unknown" ? "Source not recorded" : providerId, kind: "Source" as const };
}

function sourceTitle(providerId: string, key: string, title?: unknown) {
  if (providerId === "cami-benchmark" && Object.hasOwn(camiCatalog, key)) {
    return camiCatalog[key as keyof typeof camiCatalog].title;
  }
  return text(title) || key || sourceIdentity(providerId).moduleName;
}

function metadataDetails(metadata: Metadata, read?: NonNullable<SourceMetadataOrder["samples"][number]["reads"]>[number]) {
  const values = { ...sourceMetadataRecord(metadata.originalMetadata), ...metadata, ...sourceMetadataRecord(metadata.sampleMetadata) };
  const result: SourceMetadataEntry["details"] = [];
  const add = (label: string, ...candidates: unknown[]) => {
    const value = candidates.map(text).find(Boolean);
    if (value) result.push({ label, value });
  };
  add("Source sample", values.sampleAccession, values.sample_accession, values.sourceKey);
  add("Source sample name", values.sourceSampleName);
  add("Source project / study", values.study_accession, values.studyAccession, values.dataset);
  add("Run accession", read?.runAccessionNumber, values.runAccession, values.run_accession);
  add("Experiment accession", values.experimentAccession, values.experiment_accession);
  add("Environment", values.environment);
  add("Subject", values.subjectId);
  add("Organism", values.scientificName, values.scientific_name);
  add("Taxonomy ID", values.taxId, values.tax_id);
  add("Platform", values.platform, values.instrument_platform);
  add("Instrument", values.instrumentModel, values.instrument_model);
  add("Library strategy", values.library_strategy);
  add("Library source", values.library_source);
  const technology = text(values.technology);
  const layout = text(values.layout || values.libraryLayout || values.library_layout).toLowerCase();
  add("Read layout", read?.file2 || ["paired", "paired-end"].includes(layout) || technology === "short"
    ? "Paired-end" : read?.file1 || layout === "single" || ["single", "long"].includes(technology) ? "Single-end" : "");
  add("Read technology", technology === "long" ? "Long reads" : values.sourceType === "cami-benchmark" && technology === "short" ? "Short reads" : "");
  if (read && [read.file1, read.file2].some(file => file && /\.(fastq|fq)(\.gz)?$/i.test(file))) add("File format", "FASTQ");
  add("Read length (bp)", values.readLengthBp);
  add("Average read length (bp)", values.averageReadLengthBp);
  const processing = sourceMetadataRecord(values.processing);
  const processingSource = sourceMetadataRecord(processing.source);
  const state = text(read?.dataClass || processing.effectiveState || processingSource.state);
  const processingLabels: Record<string, string> = { raw: "Unprocessed reads", unprocessed: "Unprocessed reads", cleaned: "Cleaned / filtered reads", unknown: "Processing unknown" };
  if (read || state) add("Read processing", processingLabels[state] || "Processing unknown");
  add("Processing evidence", processingSource.details);
  add("User processing note", sourceMetadataRecord(processing.userDeclaration).details);
  add("Import module version", values.moduleVersion);
  const date = text(values.retrievedAt || values.linkedAt || values.uploadedAt);
  if (date && Number.isFinite(Date.parse(date))) add("Recorded at", new Date(date).toISOString());
  return result;
}

/** Use persisted provenance, independently of whether its source module is still enabled. */
export function buildSequencingSourceGroups(order: SourceMetadataOrder): SequencingSourceGroup[] {
  const groups = new Map<string, SequencingSourceGroup>();
  const container = sourceMetadataRecord(order.sourceMetadata);
  function groupFor(providerId: string, key = "", title?: unknown) {
    const id = JSON.stringify([providerId, key]);
    if (!groups.has(id)) groups.set(id, {
      id, providerId, ...sourceIdentity(providerId), sourceKey: key,
      title: sourceTitle(providerId, key, title), synthetic: false,
      links: [], hosts: [], entries: [], imports: [],
    });
    return groups.get(id)!;
  }
  function addOrigin(group: SequencingSourceGroup, metadata: Metadata) {
    if (metadata.synthetic === true) group.synthetic = true;
    for (const [label, value] of [["Source dataset", metadata.sourcePage], ["Citation", metadata.citation]]) {
      const url = safeSourceUrl(value);
      if (url && !group.links.some(link => link.url === url)) group.links.push({ label: String(label), url });
    }
    const files = [metadata.sourceArchive, ...(Array.isArray(metadata.sourceFiles) ? metadata.sourceFiles : []), ...(Array.isArray(metadata.files) ? metadata.files : [])];
    for (const rawFile of files) {
      const file = sourceMetadataRecord(rawFile);
      const url = safeSourceUrl(file.url || file.sourceUrl);
      if (!url) continue;
      const parsed = new URL(url);
      const host = `${parsed.protocol.slice(0, -1).toUpperCase()} · ${parsed.host}`;
      if (!group.hosts.includes(host)) group.hosts.push(host);
    }
  }
  const indexed = Array.isArray(container.sources) ? container.sources : container.sourceType ? [container] : [];
  for (const value of indexed) {
    const source = sourceMetadataRecord(value);
    if (!text(source.sourceType)) continue;
    addOrigin(groupFor(text(source.sourceType), text(source.sourceKey), source.title), source);
  }
  if (order.dataOrigin === "facility") groupFor("facility");
  for (const sample of order.samples) {
    const sampleMetadata = sourceMetadataRecord(sample.customFields);
    const reads = sample.reads?.length ? sample.reads : [undefined];
    for (const read of reads) {
      const readMetadata = sourceMetadataRecord(read?.pipelineSources);
      const metadata = { ...sourceMetadataRecord(sampleMetadata.originalMetadata), ...sampleMetadata, ...readMetadata };
      const providerId = text(readMetadata.sourceType || sampleMetadata.sourceType) || (order.dataOrigin !== "import" ? "facility" : "unknown");
      const key = text(metadata.dataset || metadata.study_accession || metadata.studyAccession);
      const group = groupFor(providerId, key, metadata.study_title);
      addOrigin(group, metadata);
      group.entries.push({
        id: `${sample.id}:${read?.id || "sample"}`, sampleId: sample.id,
        sampleLabel: sample.sampleTitle || sample.sampleId, readId: read?.id,
        details: metadataDetails(metadata, read),
        original: { ...(Object.keys(sampleMetadata).length ? { sample: sampleMetadata } : {}), ...(Object.keys(readMetadata).length ? { read: readMetadata } : {}) },
      });
    }
  }
  for (const pending of order.sourceImports ?? []) {
    const group = groupFor(pending.providerId, pending.sourceKey, pending.title);
    addOrigin(group, pending.metadata);
    group.imports.push(pending);
  }
  return [...groups.values()];
}

export function sourceImportDetails(job: SourceImportSnapshot) {
  return metadataDetails(job.metadata);
}
