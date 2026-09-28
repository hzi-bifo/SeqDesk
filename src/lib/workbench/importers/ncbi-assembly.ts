/**
 * NCBI assemblies by accession (GCF_/GCA_): the genome FASTA and, where NCBI annotated it, the GFF3, from the NCBI
 * Datasets API, verified against the package's MD5 list. Sizes are estimated in the preview; above the size cap nothing
 * is ticked, so a large genome downloads only after a person ticks its files (the confirmation), and the server-wide
 * download limit applies either way.
 */
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import { buildStableRequestHash, getPathSizeBytes } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import { DATASETS_API, NCBI_LICENCE, NCBI_LICENCE_URL, ncbiJson } from "./ncbi-client";
import { ASSEMBLY_ACCESSION, downloadGenomePackage, type GenomeFileType } from "./ncbi-datasets";
import { parseNcbiGenomeSummaryLines } from "./ncbi-genomes-taxon";
import { formatBytes, isRecord, recordMaxDownloadBytes, splitIdList } from "./public-record-download";
import type { WorkbenchGenomePreviewItem, WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "NCBI Datasets";
const HARD_MAX = 20;
/** Without ticks, genomes up to this size are ticked; anything larger waits for a person to tick it. */
export const DEFAULT_ASSEMBLY_CAP_BYTES = 1024 ** 3;
const UNVERSIONED = /^GC[AF]_\d{9}$/;

export const ncbiAssemblyInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  accessions: z.preprocess(splitIdList, z.array(z.string().trim().toUpperCase()).min(1).max(HARD_MAX))
    .transform((values, ctx) => {
      const bad = values.filter(value => !ASSEMBLY_ACCESSION.test(value) && !UNVERSIONED.test(value));
      if (bad.length) {
        ctx.addIssue({ code: "custom", message: `${bad.slice(0, 3).join(", ")} ${bad.length === 1 ? "is not" : "are not"} an assembly accession (GCF_000005845.2 or GCA_…).` });
        return z.NEVER;
      }
      return [...new Set(values)];
    }),
  annotation: z.boolean().default(true),
  files: z.array(z.string().trim().min(1).max(200)).min(1).max(HARD_MAX * 2)
    .transform(files => [...new Set(files)].sort((a, b) => a.localeCompare(b))).optional(),
});

type NcbiAssemblyInput = z.infer<typeof ncbiAssemblyInputSchema>;

export const fastaName = (accession: string) => `${accession}_genomic.fna`;
export const gffName = (accession: string) => `${accession}_genomic.gff`;
/** On-disk FASTA: 80 bases a line plus a header per sequence; a close estimate before download. */
export const estimateFastaBytes = (length: number) => Math.round(length * 81 / 80) + 200;
/** GFF3 from NCBI runs at about half the genome size for an annotated bacterium (E. coli K-12: 4.6 Mb, 2.2 MiB). */
export const estimateGffBytes = (length: number) => Math.round(length * 0.5);

interface AssemblyReport extends WorkbenchGenomePreviewItem {
  requested: string;
  annotated: boolean;
  releaseDate?: string;
  submitter?: string;
}

export function readAssemblyReports(body: unknown): AssemblyReport[] {
  const reports = isRecord(body) && Array.isArray(body.reports) ? body.reports : isRecord(body) && body.reports === undefined ? [] : null;
  if (!reports) throw new Error("NCBI returned invalid genome metadata");
  const genomes = parseNcbiGenomeSummaryLines(reports.map(report => JSON.stringify(report)).join("\n"), HARD_MAX * 2);
  return genomes.map((genome, index) => {
    const report = reports[index] as Record<string, unknown>;
    const info = isRecord(report.assembly_info) ? report.assembly_info : {};
    return {
      ...genome,
      requested: typeof report.accession === "string" ? report.accession : genome.accession,
      annotated: isRecord(report.annotation_info),
      releaseDate: typeof info.release_date === "string" ? info.release_date : undefined,
      submitter: typeof info.submitter === "string" ? info.submitter : undefined,
    };
  });
}

export function assemblyCitation(genome: AssemblyReport): string {
  return [genome.submitter, genome.releaseDate ? `(${genome.releaseDate.slice(0, 4)})` : undefined, `${genome.organismName ?? "Genome"} ${genome.assemblyName ?? ""}`.trim() + ",", `${genome.sourceDatabase ?? "NCBI"} assembly ${genome.accession}.`, `https://www.ncbi.nlm.nih.gov/datasets/genome/${genome.accession}/`]
    .filter(Boolean).join(" ");
}

export function mapAssemblyPreview(input: NcbiAssemblyInput, reports: AssemblyReport[], capBytes = DEFAULT_ASSEMBLY_CAP_BYTES): WorkbenchImportPreview {
  const found = new Map<string, AssemblyReport>();
  for (const accession of input.accessions) {
    const match = reports.find(report => report.accession === accession || (UNVERSIONED.test(accession) && report.accession.startsWith(`${accession}.`)));
    if (match) found.set(match.accession, match);
  }
  const missing = input.accessions.filter(accession => ![...found.values()].some(report => report.accession === accession || report.accession.startsWith(`${accession}.`)));
  const genomes = [...found.values()];
  const all: { filename: string; bytes: number; accession: string; kind: "genome" | "annotation" }[] = genomes.flatMap(genome => {
    const length = genome.totalSequenceLength ?? 0;
    return [
      { filename: fastaName(genome.accession), bytes: estimateFastaBytes(length), accession: genome.accession, kind: "genome" as const },
      ...(input.annotation && genome.annotated ? [{ filename: gffName(genome.accession), bytes: estimateGffBytes(length), accession: genome.accession, kind: "annotation" as const }] : []),
    ];
  });
  if (input.files) {
    const unknown = input.files.filter(name => !all.some(file => file.filename === name));
    if (unknown.length) throw new Error(`These assemblies have no file named ${unknown.slice(0, 3).join(", ")}. Preview them again.`);
  }
  const total = all.reduce((sum, file) => sum + file.bytes, 0);
  const cap = Math.min(capBytes, recordMaxDownloadBytes());
  const overCap = total > cap;
  const selected = input.files ? all.filter(file => input.files!.includes(file.filename)) : overCap ? [] : all;
  const selectedBytes = selected.reduce((sum, file) => sum + file.bytes, 0);
  const warnings: string[] = [];
  if (missing.length) warnings.push(`NCBI has no current assembly ${missing.join(", ")}.`);
  if (overCap && !input.files) warnings.push(`Together these files come to about ${formatBytes(total)}, above the ${formatBytes(cap)} SeqDesk downloads without asking. Tick the files you want to confirm the download.`);
  if (selectedBytes > recordMaxDownloadBytes()) warnings.push(`The ticked files (about ${formatBytes(selectedBytes)}) exceed this server's download limit of ${formatBytes(recordMaxDownloadBytes())}.`);
  const unannotated = genomes.filter(genome => !genome.annotated);
  if (input.annotation && unannotated.length) warnings.push(`NCBI has no annotation (GFF) for ${unannotated.map(genome => genome.accession).join(", ")}; only the genome FASTA is offered.`);
  if (genomes.some(genome => genome.accession.startsWith("GCA_") && genome.annotated)) warnings.push("GenBank (GCA_) annotation is the submitter's own; the RefSeq (GCF_) version, where there is one, carries NCBI's annotation.");
  warnings.push("Sizes are estimates from the genome length; the download is checked against NCBI's MD5 list.");
  const upgraded = genomes.filter(genome => genome.requested !== genome.accession || !input.accessions.includes(genome.accession));
  if (upgraded.length) warnings.push(`Unversioned accessions were resolved to the current version: ${upgraded.map(genome => genome.accession).join(", ")}.`);
  return {
    providerId: "ncbi-assembly",
    summary: { label: `NCBI assembly ${genomes.map(genome => genome.accession).join(", ") || input.accessions.join(", ")}`, totalFound: genomes.length, selectedCount: selected.length, capped: false, cap: HARD_MAX, hardMax: HARD_MAX },
    genomes,
    assets: selected.map(file => ({ url: `${DATASETS_API}/genome/accession/${file.accession}/download`, filename: file.filename, bytes: file.bytes, etag: "", role: file.kind })),
    choices: all.map(file => ({ filename: file.filename, bytes: file.bytes, selected: selected.includes(file), table: false })),
    records: genomes.map(genome => ({
      id: genome.accession,
      title: [genome.organismName, genome.assemblyName].filter(Boolean).join(" · ") || genome.accession,
      detail: [genome.sourceDatabase, genome.assemblyLevel, genome.totalSequenceLength ? `${(genome.totalSequenceLength / 1e6).toFixed(2)} Mb` : undefined, genome.annotated ? "annotated" : "no annotation", genome.releaseDate?.slice(0, 4)].filter(Boolean).join(" · "),
    })),
    sampleMetadata: {
      licence: NCBI_LICENCE, licenceUrl: NCBI_LICENCE_URL,
      citation: genomes.map(assemblyCitation).join(" "),
      capBytes: String(cap),
    },
    ...(warnings.length ? { warnings } : {}),
  };
}

export async function fetchAssemblyReports(accessions: string[]): Promise<AssemblyReport[]> {
  const url = new URL(`${DATASETS_API}/genome/accession/${accessions.map(encodeURIComponent).join(",")}/dataset_report`);
  url.searchParams.set("filters.assembly_version", "current");
  url.searchParams.set("page_size", String(HARD_MAX * 2));
  const body = await ncbiJson(url.toString(), { source: SOURCE, timeoutMs: 60_000, notFound: `NCBI has no assembly ${accessions.join(", ")}.` });
  return readAssemblyReports(body);
}

export const ncbiAssemblyImporter: WorkbenchImporterProvider<NcbiAssemblyInput> = {
  id: "ncbi-assembly",
  label: "NCBI assembly",
  description: "Genome FASTA and GFF3 annotation of NCBI assemblies by accession (GCF_/GCA_), from the NCBI Datasets API, checked against NCBI's MD5 list.",
  category: "genomes",
  inputSchema: ncbiAssemblyInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public NCBI Datasets API." };
  },
  async preview(input) {
    return mapAssemblyPreview(input, await fetchAssemblyReports(input.accessions));
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("ncbi-assembly", {
      accessions: preview.genomes.map(genome => genome.accession),
      files: (preview.assets ?? []).map(asset => asset.filename).sort(),
    });
  },
  async start(context) {
    const assets = context.preview.assets ?? [];
    if (!assets.length) throw new Error("No file is ticked. Tick the genome files to import.");
    const cap = Number(context.preview.sampleMetadata?.capBytes) || DEFAULT_ASSEMBLY_CAP_BYTES;
    const declared = assets.reduce((sum, asset) => sum + asset.bytes, 0);
    // Above the cap only an explicit tick list (the person's confirmation) may start a download.
    if (declared > cap && !context.input.files) throw new Error(`These genomes come to about ${formatBytes(declared)}; tick their files to confirm the download.`);
    // One package per set of file types, so a GFF-only tick never downloads the genome.
    const byTypes = new Map<string, { accessions: string[]; types: GenomeFileType[] }>();
    for (const accession of [...new Set(assets.map(asset => /^(GC[AF]_\d+\.\d+)_/.exec(asset.filename)?.[1] ?? ""))]) {
      if (!ASSEMBLY_ACCESSION.test(accession)) throw new Error("The NCBI preview is incomplete. Preview it again.");
      const types: GenomeFileType[] = [
        ...(assets.some(asset => asset.filename === fastaName(accession)) ? ["GENOME_FASTA" as const] : []),
        ...(assets.some(asset => asset.filename === gffName(accession)) ? ["GENOME_GFF" as const] : []),
      ];
      const key = types.join("+");
      byTypes.set(key, { accessions: [...(byTypes.get(key)?.accessions ?? []), accession], types });
    }
    const root = path.join(context.storage.cacheDir, "dataset");
    await fs.mkdir(root, { recursive: true });
    const limit = Math.max(declared * 2, 64 * 1024 ** 2);
    const packages = [];
    let index = 0;
    for (const group of byTypes.values()) {
      const step = 80 / byTypes.size;
      packages.push(await downloadGenomePackage(context, { ...group, destination: path.join(root, `package-${index + 1}`), name: `ncbi_assembly_${index + 1}`, limitBytes: limit, progress: [10 + step * index, 10 + step * (index + 1)] }));
      index += 1;
    }
    const wanted = new Set(assets.map(asset => asset.filename));
    const files = packages.flatMap((pack, packIndex) => pack.files.map(file => ({ file, pack, packIndex })))
      .filter(({ file }) => wanted.has(file.kind === "genome" ? fastaName(file.accession) : gffName(file.accession)));
    for (const asset of assets) {
      if (!files.some(({ file }) => (file.kind === "genome" ? fastaName(file.accession) : gffName(file.accession)) === asset.filename)) throw new Error(`NCBI's package did not include ${asset.filename}. Preview it again.`);
    }
    await context.update({ phase: "indexing", progress: 92 });
    const genomes = context.preview.genomes;
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${files.length} file(s) of ${genomes.length} NCBI assembl${genomes.length === 1 ? "y" : "ies"}, checked against NCBI's MD5 list.`,
      sourceType: "ncbi-assembly",
      sourceMetadata: {
        source: "NCBI Datasets",
        record: genomes.map(genome => genome.accession).join(", "),
        requested: context.input.accessions,
        accessions: genomes.map(genome => genome.accession),
        title: context.preview.records?.map(record => record.title).join("; "),
        detail: context.preview.records?.map(record => record.detail).join("; "),
        ...(context.preview.sampleMetadata ?? {}),
        sourcePage: `https://www.ncbi.nlm.nih.gov/datasets/genome/${genomes[0]?.accession ?? ""}/`,
        sourceUrls: packages.map(pack => pack.url),
        retrievedAt: new Date().toISOString(),
        checksums: "Each file checked against the MD5 in NCBI's md5sum.txt; SHA-256 recorded.",
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        files: files.map(({ file, pack, packIndex }) => ({ role: file.kind, filename: file.kind === "genome" ? fastaName(file.accession) : gffName(file.accession), storedFilename: `package-${packIndex + 1}/${file.path}`, sourceUrl: pack.url, sourceVersion: `md5:${file.md5}`, bytes: file.bytes, md5: file.md5, sha256: file.sha256 })),
      },
      storagePath: root,
      sizeBytes: await getPathSizeBytes(root),
      checksumSha256: crypto.createHash("sha256").update(JSON.stringify(files.map(({ file }) => [file.accession, file.kind, file.sha256]))).digest("hex"),
      genomeCount: genomes.length,
    };
  },
};
