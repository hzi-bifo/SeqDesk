import crypto from "node:crypto";
import fs from "node:fs/promises";
import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import { UNIPROT_ACCESSION, uniprotAccessionList } from "./alphafold-model";
import {
  downloadRecordAssets,
  fetchSourceJson,
  isRecord,
  manifestEntry,
  mapWithLimit,
  num,
  sizeWarnings,
  text,
  type RecordAsset,
} from "./public-record-download";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "UniProt";
const HARD_MAX = 50;
const BASE = "https://rest.uniprot.org/uniprotkb/";
const ENTRY_FILE = /^https:\/\/rest\.uniprot\.org\/uniprotkb\/([A-Z0-9]{6,10})\.(fasta|json)$/;

export const uniprotEntryInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  accessions: uniprotAccessionList(HARD_MAX, "UniProt entries"),
});

type UniprotEntryInput = z.infer<typeof uniprotEntryInputSchema>;

export interface UniprotEntrySummary {
  requested: string;
  accession: string;
  sequenceMd5: string;
  entryVersion?: number;
  record: { id: string; title: string; detail: string };
}

export function uniprotProteinName(description: unknown): string | undefined {
  if (!isRecord(description)) return undefined;
  const named = (value: unknown) => isRecord(value) && isRecord(value.fullName) ? text(value.fullName.value) : undefined;
  return named(description.recommendedName)
    ?? (Array.isArray(description.submissionNames) ? named(description.submissionNames[0]) : undefined);
}

export function uniprotGene(genes: unknown): string | undefined {
  if (!Array.isArray(genes)) return undefined;
  const first = genes.find(isRecord);
  if (!first) return undefined;
  if (isRecord(first.geneName)) return text(first.geneName.value);
  const locus = Array.isArray(first.orderedLocusNames) ? first.orderedLocusNames.find(isRecord) : undefined;
  return locus ? text(locus.value) : undefined;
}

/** Map a /uniprotkb/{accession}.json entry (or a search result, which has the same fields). */
export function mapUniprotEntry(requested: string, body: unknown): UniprotEntrySummary {
  if (!isRecord(body)) throw new Error(`UniProt returned details for ${requested} that could not be read. Try again later.`);
  const accession = text(body.primaryAccession) ?? "";
  const type = text(body.entryType) ?? "";
  if (type === "Inactive") {
    const inactive = isRecord(body.inactiveReason) ? body.inactiveReason : {};
    const reason = text(inactive.inactiveReasonType);
    const targets = (Array.isArray(inactive.mergeDemergeTo) ? inactive.mergeDemergeTo : []).filter((value): value is string => typeof value === "string" && UNIPROT_ACCESSION.test(value));
    if (reason === "MERGED" && targets.length) throw new Error(`UniProt entry ${requested} was merged into ${targets[0]}. Use ${targets[0]} instead.`);
    if (reason === "DEMERGED" && targets.length) throw new Error(`UniProt entry ${requested} was split into ${targets.join(", ")}. Use one of those instead.`);
    throw new Error(`UniProt entry ${requested} is no longer active${reason === "DELETED" ? " (it was deleted)" : ""}.`);
  }
  if (!UNIPROT_ACCESSION.test(accession)) throw new Error(`UniProt returned details for ${requested} that could not be read. Try again later.`);
  const sequence = isRecord(body.sequence) ? body.sequence : {};
  const sequenceMd5 = text(sequence.md5)?.toUpperCase() ?? "";
  const organism = isRecord(body.organism) ? text(body.organism.scientificName) : undefined;
  const length = num(sequence.length);
  const reviewed = type.includes("unreviewed") ? false : type.includes("reviewed") ? true : undefined;
  const audit = isRecord(body.entryAudit) ? body.entryAudit : {};
  return {
    requested,
    accession,
    sequenceMd5,
    entryVersion: num(audit.entryVersion),
    record: {
      id: accession,
      title: uniprotProteinName(body.proteinDescription) ?? accession,
      detail: [uniprotGene(body.genes), organism, length !== undefined ? `${length} aa` : undefined,
        reviewed === true ? "reviewed (Swiss-Prot)" : reviewed === false ? "unreviewed (TrEMBL)" : undefined].filter(Boolean).join(" · "),
    },
  };
}

export function buildUniprotPreview(input: UniprotEntryInput, entries: UniprotEntrySummary[]): WorkbenchImportPreview {
  const warnings: string[] = [];
  for (const entry of entries) {
    if (entry.accession !== entry.requested) warnings.push(`${entry.requested} is a secondary accession; UniProt now files it as ${entry.accession}.`);
    if (!/^[0-9A-F]{32}$/.test(entry.sequenceMd5)) throw new Error(`UniProt did not publish a sequence checksum for ${entry.accession}. Try again later.`);
  }
  const seen = new Map<string, string>();
  for (const entry of entries) {
    const earlier = seen.get(entry.accession);
    if (earlier) throw new Error(`${earlier} and ${entry.requested} are the same UniProt entry (${entry.accession}). Remove one of them.`);
    seen.set(entry.accession, entry.requested);
  }
  const assets: RecordAsset[] = entries.flatMap(entry => [
    { url: `${BASE}${entry.accession}.fasta`, filename: `${entry.accession}.fasta`, bytes: 0, etag: `sequence-md5:${entry.sequenceMd5}`, role: "sequence" },
    { url: `${BASE}${entry.accession}.json`, filename: `${entry.accession}.json`, bytes: 0, etag: entry.entryVersion !== undefined ? `entry-version:${entry.entryVersion}` : "", role: "metadata" },
  ]);
  warnings.push(...sizeWarnings(assets, SOURCE));
  const label = entries.length === 1 ? `UniProt ${entries[0].accession} · ${entries[0].record.title}` : `UniProt · ${entries.length} entries`;
  return {
    providerId: "uniprot-entry",
    summary: { label, totalFound: entries.length, selectedCount: entries.length, capped: false, cap: HARD_MAX, hardMax: HARD_MAX },
    genomes: [],
    assets,
    records: entries.map(entry => entry.record),
    ...(warnings.length ? { warnings } : {}),
  };
}

/** Sequence of a single-record FASTA file, checked against the accession in its header. */
export function uniprotFastaSequence(fasta: string, accession: string): string {
  const lines = fasta.split(/\r?\n/).filter(Boolean);
  const header = lines.shift() ?? "";
  if (!new RegExp(`^>(?:sp|tr)\\|${accession}\\|`).test(header) || lines.some(line => line.startsWith(">"))) {
    throw new Error(`UniProt sent an unexpected FASTA file for ${accession}.`);
  }
  return lines.join("").trim();
}

export const uniprotEntryImporter: WorkbenchImporterProvider<UniprotEntryInput> = {
  id: "uniprot-entry",
  label: "UniProt entries",
  description: "Preview and download protein sequences (FASTA) and their UniProtKB entries (JSON).",
  category: "proteins",
  inputSchema: uniprotEntryInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public UniProt REST API and HTTPS downloads." };
  },
  async preview(input) {
    const entries = await mapWithLimit(input.accessions, 6, async accession => {
      const found = await fetchSourceJson(`${BASE}${accession}.json`, { source: SOURCE, notFound: `UniProt has no entry ${accession}.`, readRedirectBody: true });
      return mapUniprotEntry(accession, found?.body);
    });
    return buildUniprotPreview(input, entries);
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("uniprot-entry", { accessions: input.accessions, assets: preview.assets?.map(asset => ({ url: asset.url, version: asset.etag })) });
  },
  async start(context) {
    const assets = context.preview.assets ?? [];
    if (assets.length !== (context.preview.records?.length ?? 0) * 2 || assets.length === 0) {
      throw new Error("The UniProt preview is incomplete. Preview it again.");
    }
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets,
      allowUrl: url => ENTRY_FILE.test(url),
      storedFilename: asset => asset.filename,
      async check(asset, filePath) {
        const accession = ENTRY_FILE.exec(asset.url)?.[1] ?? "";
        const content = await fs.readFile(filePath, "utf8");
        if (asset.role === "sequence") {
          const digest = crypto.createHash("md5").update(uniprotFastaSequence(content, accession)).digest("hex").toUpperCase();
          if (`sequence-md5:${digest}` !== asset.etag) throw new Error(`The ${accession} sequence changed since the preview. Preview it again.`);
          return;
        }
        let entry: unknown;
        try { entry = JSON.parse(content); } catch { throw new Error(`UniProt sent an unreadable entry for ${accession}.`); }
        if (!isRecord(entry) || entry.primaryAccession !== accession) throw new Error(`UniProt sent a different entry for ${accession}.`);
      },
    });
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length / 2} protein sequence(s) with UniProtKB entries downloaded from UniProt.`,
      sourceType: "uniprot-entry",
      sourceMetadata: {
        source: "UniProtKB",
        accessions: context.input.accessions,
        records: context.preview.records,
        license: "CC-BY-4.0",
        retrievedAt: new Date().toISOString(),
        checksumRepresentation: "sha256-of-canonical-asset-manifest",
        files: result.files.map(manifestEntry),
      },
      storagePath: result.directory,
      sizeBytes: result.sizeBytes,
      checksumSha256: result.checksumSha256,
    };
  },
};
