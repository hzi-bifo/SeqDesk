import { z } from "zod";

import { buildStableRequestHash } from "@/lib/workbench/storage";
import { importCollectionSchema } from "../import-collection";
import {
  downloadRecordAssets,
  fetchSourceJson,
  isRecord,
  manifestEntry,
  mapWithLimit,
  num,
  readHead,
  sizeWarnings,
  splitIdList,
  text,
  uniqueInOrder,
  type RecordAsset,
} from "./public-record-download";
import type { WorkbenchImporterProvider, WorkbenchImportPreview } from "./types";

const SOURCE = "PDB";
const HARD_MAX = 20;
export const PDB_ID = /^[0-9][A-Z0-9]{3}$/;

export const pdbEntryInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  ids: z.preprocess(splitIdList, z.array(
    z.string().trim().toUpperCase().regex(PDB_ID, "Use four-character PDB IDs such as 1LM8."),
  ).min(1, "Name at least one PDB ID.").max(100)
    .transform(uniqueInOrder)
    .pipe(z.array(z.string()).max(HARD_MAX, `Import at most ${HARD_MAX} PDB entries at a time.`))),
});

type PdbEntryInput = z.infer<typeof pdbEntryInputSchema>;

export function pdbFileUrl(id: string): string {
  return `https://files.rcsb.org/download/${id}.cif`;
}

function titleCase(method: string): string {
  return method.toLowerCase().replace(/(^|[\s-])([a-z])/g, (_match, gap: string, letter: string) => gap + letter.toUpperCase())
    .replace(/\bX-Ray\b/, "X-ray").replace(/\bNmr\b/, "NMR").replace(/\bEm\b/, "EM");
}

/** One record line from a data.rcsb.org core entry document. */
export function mapPdbEntry(id: string, body: unknown): { id: string; title: string; detail: string } {
  if (!isRecord(body)) throw new Error(`PDB returned details for ${id} that could not be read. Try again later.`);
  const returned = text(body.rcsb_id)?.toUpperCase();
  if (returned && returned !== id) throw new Error(`PDB returned a different entry for ${id}. Try again later.`);
  const struct = isRecord(body.struct) ? body.struct : {};
  const methods = (Array.isArray(body.exptl) ? body.exptl : []).map(entry => isRecord(entry) ? text(entry.method) : undefined).filter((value): value is string => Boolean(value));
  const info = isRecord(body.rcsb_entry_info) ? body.rcsb_entry_info : {};
  const resolution = Array.isArray(info.resolution_combined) ? num(info.resolution_combined[0]) : undefined;
  const accession = isRecord(body.rcsb_accession_info) ? body.rcsb_accession_info : {};
  const year = text(accession.initial_release_date)?.slice(0, 4);
  return {
    id,
    title: text(struct.title) ?? id,
    detail: [methods.map(titleCase).join(", ") || undefined, resolution !== undefined ? `${resolution.toFixed(2)} Å` : undefined, year ? `released ${year}` : undefined]
      .filter(Boolean).join(" · "),
  };
}

export function buildPdbPreview(input: PdbEntryInput, records: { id: string; title: string; detail: string }[]): WorkbenchImportPreview {
  const assets: RecordAsset[] = input.ids.map(id => ({ url: pdbFileUrl(id), filename: `${id}.cif`, bytes: 0, etag: "", role: "structure" }));
  const label = input.ids.length === 1 ? `PDB ${input.ids[0]} · ${records[0]?.title ?? input.ids[0]}` : `PDB · ${input.ids.length} structures`;
  const warnings = sizeWarnings(assets, SOURCE);
  return {
    providerId: "pdb-entry",
    summary: { label, totalFound: records.length, selectedCount: assets.length, capped: false, cap: HARD_MAX, hardMax: HARD_MAX },
    genomes: [],
    assets,
    records,
    ...(warnings.length ? { warnings } : {}),
  };
}

export const pdbEntryImporter: WorkbenchImporterProvider<PdbEntryInput> = {
  id: "pdb-entry",
  label: "PDB structures",
  description: "Preview and download mmCIF structure files for PDB entries from RCSB.",
  category: "structures",
  inputSchema: pdbEntryInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public RCSB PDB Data API and HTTPS downloads." };
  },
  async preview(input) {
    const missing: string[] = [];
    const records = await mapWithLimit(input.ids, 6, async id => {
      try {
        const found = await fetchSourceJson(`https://data.rcsb.org/rest/v1/core/entry/${id}`, { source: SOURCE, notFound: "missing" });
        return mapPdbEntry(id, found?.body);
      } catch (error) {
        if (error instanceof Error && error.message === "missing") { missing.push(id); return null; }
        throw error;
      }
    });
    if (missing.length) {
      const ordered = input.ids.filter(id => missing.includes(id));
      throw new Error(ordered.length === 1 ? `PDB has no entry ${ordered[0]}.` : `PDB has no entries ${ordered.join(", ")}.`);
    }
    return buildPdbPreview(input, records.filter((record): record is NonNullable<typeof record> => Boolean(record)));
  },
  getCacheKey(input) {
    return buildStableRequestHash("pdb-entry", { ids: input.ids, format: "mmcif" });
  },
  async start(context) {
    const ids = context.input.ids;
    const assets = context.preview.assets ?? [];
    if (assets.length !== ids.length || assets.some((asset, index) => asset.url !== pdbFileUrl(ids[index]))) {
      throw new Error("The PDB preview does not match the requested entries. Preview it again.");
    }
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets,
      allowUrl: url => /^https:\/\/files\.rcsb\.org\/download\/[0-9][A-Z0-9]{3}\.cif$/.test(url),
      storedFilename: asset => asset.filename,
      async check(asset, filePath) {
        const head = await readHead(filePath);
        if (!head.startsWith(`data_${asset.filename.slice(0, 4)}`)) throw new Error(`PDB sent something other than an mmCIF file for ${asset.filename.slice(0, 4)}.`);
      },
    });
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} mmCIF structure file(s) downloaded from the RCSB PDB.`,
      sourceType: "pdb-entry",
      sourceMetadata: {
        source: "RCSB PDB",
        ids,
        records: context.preview.records,
        format: "mmCIF",
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
