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

const SOURCE = "AlphaFold DB";
const HARD_MAX = 20;
/** UniProtKB accession (canonical, no isoform suffix): https://www.uniprot.org/help/accession_numbers */
export const UNIPROT_ACCESSION = /^(?:[OPQ][0-9][A-Z0-9]{3}[0-9]|[A-NR-Z][0-9](?:[A-Z][A-Z0-9]{2}[0-9]){1,2})$/;
const MODEL_FILE = /^https:\/\/alphafold\.ebi\.ac\.uk\/files\/(AF-[A-Z0-9]{6,10}-F\d{1,3}-model_v\d{1,3}\.cif)$/;
const PAE_FILE = /^https:\/\/alphafold\.ebi\.ac\.uk\/files\/AF-[A-Z0-9]{6,10}-F\d{1,3}-predicted_aligned_error_v\d{1,3}\.json$/;

export function uniprotAccessionList(max: number, what: string) {
  return z.preprocess(splitIdList, z.array(
    z.string().trim().toUpperCase().regex(UNIPROT_ACCESSION, "Use UniProt accessions such as P69905."),
  ).min(1, "Name at least one UniProt accession.").max(200)
    .transform(uniqueInOrder)
    .pipe(z.array(z.string()).max(max, `Import at most ${max} ${what} at a time.`)));
}

export const alphafoldModelInputSchema = z.object({
  collection: importCollectionSchema.optional(),
  accessions: uniprotAccessionList(HARD_MAX, "AlphaFold models"),
});

type AlphafoldModelInput = z.infer<typeof alphafoldModelInputSchema>;

export interface AlphafoldModel {
  accession: string;
  modelId: string;
  cifUrl: string;
  filename: string;
  paeDocUrl?: string;
  version?: number;
  record: { id: string; title: string; detail: string };
}

/** Pick the canonical model for `accession` from /api/prediction/{accession} (which also lists isoforms). */
export function mapAlphafoldPrediction(accession: string, body: unknown): AlphafoldModel {
  const entries = Array.isArray(body) ? body.filter(isRecord) : [];
  const entry = entries.find(item => text(item.uniprotAccession) === accession && /-F1$/.test(text(item.modelEntityId) ?? ""))
    ?? entries.find(item => text(item.uniprotAccession) === accession);
  if (!entry) throw new Error(`AlphaFold DB has no model for ${accession}.`);
  const cifUrl = text(entry.cifUrl) ?? "";
  const filename = MODEL_FILE.exec(cifUrl)?.[1];
  if (!filename || !filename.startsWith(`AF-${accession}-`)) throw new Error(`AlphaFold DB returned an unexpected download address for ${accession}.`);
  const paeDocUrl = text(entry.paeDocUrl);
  const version = num(entry.latestVersion);
  const plddt = num(entry.globalMetricValue);
  return {
    accession,
    modelId: text(entry.modelEntityId) ?? filename.replace(/-model_v\d+\.cif$/, ""),
    cifUrl,
    filename,
    paeDocUrl: paeDocUrl && PAE_FILE.test(paeDocUrl) ? paeDocUrl : undefined,
    version,
    record: {
      id: accession,
      title: text(entry.uniprotDescription) ?? accession,
      detail: [text(entry.gene), text(entry.organismScientificName), version !== undefined ? `model v${version}` : undefined, plddt !== undefined ? `mean pLDDT ${plddt.toFixed(1)}` : undefined]
        .filter(Boolean).join(" · "),
    },
  };
}

export function buildAlphafoldPreview(input: AlphafoldModelInput, models: AlphafoldModel[]): WorkbenchImportPreview {
  const assets: RecordAsset[] = models.map(model => ({ url: model.cifUrl, filename: model.filename, bytes: 0, etag: model.modelId + (model.version !== undefined ? `-v${model.version}` : ""), role: "model" }));
  const label = models.length === 1 ? `AlphaFold ${models[0].accession} · ${models[0].record.title}` : `AlphaFold · ${models.length} models`;
  const warnings = sizeWarnings(assets, SOURCE);
  return {
    providerId: "alphafold-model",
    summary: { label, totalFound: models.length, selectedCount: assets.length, capped: false, cap: HARD_MAX, hardMax: HARD_MAX },
    genomes: [],
    assets,
    records: models.map(model => model.record),
    ...(warnings.length ? { warnings } : {}),
  };
}

export const alphafoldModelImporter: WorkbenchImporterProvider<AlphafoldModelInput> = {
  id: "alphafold-model",
  label: "AlphaFold models",
  description: "Preview and download predicted structure models (mmCIF) from the AlphaFold Protein Structure Database.",
  category: "structures",
  inputSchema: alphafoldModelInputSchema,
  async preflight() {
    return { ok: true, message: "Uses the public AlphaFold DB API and HTTPS downloads." };
  },
  async preview(input) {
    const models = await mapWithLimit(input.accessions, 6, async accession => {
      const found = await fetchSourceJson(`https://alphafold.ebi.ac.uk/api/prediction/${accession}`, { source: SOURCE, notFound: `AlphaFold DB has no model for ${accession}.` });
      return mapAlphafoldPrediction(accession, found?.body);
    });
    return buildAlphafoldPreview(input, models);
  },
  getCacheKey(input, preview) {
    return buildStableRequestHash("alphafold-model", { accessions: input.accessions, models: preview.assets?.map(asset => asset.url) });
  },
  async start(context) {
    const assets = context.preview.assets ?? [];
    const { accessions } = context.input;
    if (assets.length !== accessions.length || assets.some((asset, index) => !asset.filename.startsWith(`AF-${accessions[index]}-`))) {
      throw new Error("The AlphaFold preview does not match the requested accessions. Preview it again.");
    }
    const result = await downloadRecordAssets(context, {
      source: SOURCE,
      assets,
      allowUrl: url => MODEL_FILE.test(url),
      storedFilename: asset => asset.filename,
      async check(asset, filePath) {
        if (!(await readHead(filePath)).startsWith("data_")) throw new Error(`AlphaFold DB sent something other than an mmCIF file for ${asset.filename}.`);
      },
    });
    return {
      cacheKey: context.cacheKey,
      name: context.preview.summary.label,
      description: `${result.files.length} predicted structure model(s) downloaded from AlphaFold DB.`,
      sourceType: "alphafold-model",
      sourceMetadata: {
        source: "AlphaFold Protein Structure Database",
        accessions,
        records: context.preview.records,
        format: "mmCIF",
        // Predicted aligned error per model, not downloaded; same naming scheme as the model file.
        paeDocUrls: assets.map(asset => asset.url.replace(/-model_(v\d+)\.cif$/, "-predicted_aligned_error_$1.json")),
        citation: "Jumper et al. Nature 596, 583–589 (2021); Varadi et al. Nucleic Acids Research 52, D368–D375 (2024).",
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
