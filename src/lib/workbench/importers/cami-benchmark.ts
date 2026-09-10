import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import path from "node:path";
import fs from "node:fs/promises";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { z } from "zod";
import type { WorkbenchImporterProvider } from "./types";
import { camiCatalog } from "./cami-catalog";
import { importCollectionSchema } from "../import-collection";
import type { SourceProcessing } from "../import-processing";

// Module-owned classification; simulated does not establish cleaned/filtered.
export const camiReadProcessing: SourceProcessing = { state: "unknown", evidence: "module_documentation", details: "Synthetic benchmark reads (https://cami-challenge.org/faq/). Trimming/filtering history is not established. Archive extraction and pair splitting are not cleaning." };
import { extractBenchmarkReads, prepareBenchmarkReads } from "../prepare-benchmark-reads";

import { CAMI_MAX_BYTES, estimateCamiPreparationBytes, requireImportStorage } from "../import-storage-capacity";

const LIMIT = CAMI_MAX_BYTES;
const SUBJECT_MAPPING = "https://s3.bi.denbi.de/swift/v1/cami3__human-gut-toy/sample_subject_mapping.tsv";

async function subjectMetadata(sample: number) {
  const response = await fetch(SUBJECT_MAPPING, { redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000) });
  if (!response.ok || !response.body) throw new Error("CAMI subject metadata is unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      size += value.length;
      if (size > 64 * 1024) throw new Error("CAMI subject metadata exceeds size limit");
      chunks.push(value);
    }
  } finally { await reader.cancel(); }
  const buffer = Buffer.concat(chunks);
  const lines = buffer.toString("utf8").trim().split(/\r?\n/);
  if (lines.shift() !== "sample_id\tsubject_id") throw new Error("Unexpected CAMI subject metadata columns");
  const subjects = new Map<string, string>();
  for (const line of lines) {
    const match = /^(sample_(?:[0-9]|1[0-9]))\t(S(?:[1-9]|10))$/.exec(line);
    if (!match || subjects.has(match[1])) throw new Error("Invalid CAMI subject metadata");
    subjects.set(match[1], match[2]);
  }
  if (subjects.size !== 20) throw new Error("Incomplete CAMI subject metadata");
  return { subjectId: subjects.get(`sample_${sample}`), mappingSourceUrl: SUBJECT_MAPPING, mappingSha256: crypto.createHash("sha256").update(buffer).digest("hex") };
}
export const camiInputSchema = z.object({
  // Accept old queued requests, but classification is now exclusively module-owned.
  processingDeclaration: z.unknown().optional().transform(() => undefined),
  collection: importCollectionSchema.optional(), // Optional only for already-queued legacy jobs.
  targetStudyId: z.string().min(1).max(200).optional(),
  dataset: z.enum(["cami2-marine", "cami3-toy-human-gut"]).default("cami3-toy-human-gut"),
  technology: z.enum(["short", "long"]),
  sample: z.number().int().min(0).max(19),
  role: z.literal("reads").default("reads"),
}).strict().refine(input => input.sample < camiCatalog[input.dataset].samples, "Sample is outside this dataset");

export function camiAsset(input: z.infer<typeof camiInputSchema>) {
  const parsed = camiInputSchema.parse(input);
  const catalog = camiCatalog[parsed.dataset];
  const filename = `${parsed.dataset === "cami2-marine" ? "marmgCAMI2_" : ""}sample_${parsed.sample}_reads.tar.gz`;
  const directory = parsed.dataset === "cami2-marine" ? `${parsed.technology}_read` : parsed.technology;
  return { filename, url: `${catalog.root}/${directory}/${filename}` };
}

export function camiObjectHeaders(headers: Headers) {
  const raw = headers.get("content-length") || "";
  const bytes = Number(raw);
  const etag = headers.get("etag") || "";
  if (!/^\d+$/.test(raw) || !Number.isSafeInteger(bytes) || bytes <= 0 || bytes > LIMIT) {
    throw new Error("CAMI archive size is missing, invalid, or exceeds the 100 GiB import limit");
  }
  if (!etag || /[\r\n]/.test(etag)) throw new Error("CAMI did not supply an object version (ETag)");
  if (headers.get("content-encoding") && headers.get("content-encoding") !== "identity") {
    throw new Error("CAMI returned an unexpected content encoding");
  }
  return { bytes, etag };
}

export const camiBenchmarkImporter: WorkbenchImporterProvider<z.infer<typeof camiInputSchema>> = {
  id: "cami-benchmark",
  label: "CAMI benchmark samples",
  description: "Import CAMI II Marine and CAMI III toy human-gut raw reads and sample metadata into sequencing data.",
  category: "benchmarks",
  inputSchema: camiInputSchema,
  async preflight() { return { ok: true }; },
  async preview(input) {
    const asset = camiAsset(input);
    const response = await fetch(asset.url, {
      method: "HEAD", redirect: "error", cache: "no-store",
      headers: { "accept-encoding": "identity" }, signal: AbortSignal.timeout(30_000),
    });
    if (response.status !== 200) throw new Error(`CAMI archive unavailable (${response.status})`);
    const metadata = camiObjectHeaders(response.headers);
    const catalog = camiCatalog[input.dataset];
    const sampleMetadata = { environment: catalog.environment, ...catalog.technologies[input.technology],
      ...(input.dataset === "cami3-toy-human-gut" ? await subjectMetadata(input.sample) : { sourceSampleName: `marmgCAMI2_${input.technology}_read_sample_${input.sample}` }),
    };
    return {
      providerId: "cami-benchmark",
      contractVersion: 2,
      processing: camiReadProcessing,
      sampleMetadata,
      summary: { label: `${camiCatalog[input.dataset].title} · ${input.technology} · sample ${input.sample}`, totalFound: 1, selectedCount: 1, capped: false, cap: 1, hardMax: 1 },
      genomes: [], assets: [{ ...asset, ...metadata, role: input.role }],
      warnings: [
        `Imports sample “sample_${input.sample}” into sequencing data${input.collection ? ` “${input.collection.name}”` : ""}. No SeqDesk study is created. Reads are extracted and validated before publication.`,
        "Short reads are validated as interleaved pairs and split into R1/R2. Long reads stay single-end. Benchmark truth files are excluded.",
        "Downloads wait automatically until enough storage is available. One sample/technology per import; repeat to add more. Existing technology imports are rejected, not overwritten.",
        "ETag identifies the source object, not a verified source checksum. A local SHA-256 is recorded after transfer.",
      ],
    };
  },
  getCacheKey(input, preview) {
    return crypto.createHash("sha256").update(JSON.stringify({ input, assets: preview.assets })).digest("hex");
  },
  async start(context) {
    if (context.preview.contractVersion !== 2) throw new Error("CAMI importer changed from archive-only downloads to sample imports. Preview a new import before continuing.");
    const expected = camiAsset(context.input);
    const asset = context.preview.assets?.[0];
    if (context.preview.assets?.length !== 1 || !asset || asset.url !== expected.url || asset.filename !== expected.filename || asset.role !== context.input.role) {
      throw new Error("CAMI preview does not match the requested archive");
    }
    camiObjectHeaders(new Headers({ "content-length": String(asset.bytes), etag: asset.etag }));
    await requireImportStorage(context.storage.cacheDir, estimateCamiPreparationBytes(asset.bytes));
    const signal = AbortSignal.any([AbortSignal.timeout(6 * 60 * 60 * 1000), ...(context.signal ? [context.signal] : [])]);
    signal.throwIfAborted();
    const response = await fetch(expected.url, {
      redirect: "error", cache: "no-store", signal,
      headers: { "accept-encoding": "identity", "if-match": asset.etag.startsWith('"') ? asset.etag : `"${asset.etag}"` },
    });
    if (response.status !== 200 || !response.body) {
      await response.body?.cancel();
      throw new Error(`CAMI download unavailable or changed (${response.status}); preview again`);
    }
    try {
      const current = camiObjectHeaders(response.headers);
      if (current.bytes !== asset.bytes || current.etag !== asset.etag) throw new Error("CAMI archive changed since preview; preview again");
    } catch (error) { await response.body.cancel(); throw error; }
    const destination = path.join(context.storage.cacheDir, expected.filename);
    await context.update({ phase: "downloading", progress: 0, targetPath: destination });
    await context.log(`Downloading CAMI reads ${expected.filename}; ${asset.bytes} bytes.`);
    let bytes = 0;
    const downloadStarted = Date.now();
    let lastProgress = 0;
    const hash = crypto.createHash("sha256");
    const meter = new Transform({ transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > asset.bytes || bytes > LIMIT) return callback(new Error("CAMI download exceeded its declared size"));
      hash.update(chunk);
      if (Date.now() - lastProgress > 1000) {
        lastProgress = Date.now();
        const elapsed = (Date.now() - downloadStarted) / 1000;
        const speed = elapsed > 0 ? bytes / elapsed : 0;
        const estimate = elapsed >= 10 && speed > 0 ? ` · ${(speed / 1024 ** 2).toFixed(1)} MiB/s · ~${Math.max(1, Math.ceil((asset.bytes - bytes) / speed / 60))} min download remaining` : " · estimating speed…";
        context.update({ phase: `Downloading · ${(bytes / 1024 ** 2).toFixed(0)} MiB / ${(asset.bytes / 1024 ** 3).toFixed(2)} GiB · ${(bytes / asset.bytes * 100).toFixed(1)}%${estimate}`, progress: Math.floor(bytes / asset.bytes * 60) }).then(() => callback(null, chunk), error => callback(error));
      } else callback(null, chunk);
    } });
    await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(destination, { flags: "wx" }), { signal });
    if (bytes !== asset.bytes) throw new Error("CAMI archive download is truncated");
    signal.throwIfAborted();
    const sha256 = hash.digest("hex");
    await context.update({ phase: "extracting read inputs", progress: 65 });
    const inputFile = await extractBenchmarkReads(destination, path.join(context.storage.cacheDir, "reads"), signal);
    // Free the outer archive before producing split read files. Its digest and
    // source object version remain in provenance.
    await fs.unlink(destination);
    await context.update({ phase: "validating reads and pairing", progress: 80 });
    const reads = await prepareBenchmarkReads(inputFile, context.input.technology, signal);
    await context.update({ phase: "creating sequencing data and sample", progress: 95 });
    const catalog = camiCatalog[context.input.dataset];
    return {
      cacheKey: context.cacheKey, name: context.preview.summary.label, sourceType: "cami-benchmark",
      description: "Validated synthetic CAMI benchmark read inputs",
      scientificImport: { targetStudyId: context.input.targetStudyId, synthetic: true, metadata: context.preview.sampleMetadata, studyKey: context.input.dataset, studyTitle: catalog.title,
        sampleKey: `sample_${context.input.sample}`, sampleTitle: `sample_${context.input.sample}`,
        technology: context.input.technology, processing: camiReadProcessing, reads },
      storagePath: context.storage.cacheDir, sizeBytes: reads.reduce((sum, file) => sum + file.bytes, 0),
      sourceMetadata: { ...context.input, sourcePage: catalog.sourcePage, citation: catalog.citation, synthetic: true, retrievedAt: new Date().toISOString(),
        sampleMetadata: context.preview.sampleMetadata,
        moduleVersion: 2, validation: context.input.technology === "short" ? "four-line-fastq-and-pairing" : "four-line-fastq-single-end", pipelineReady: true,
        sourceArchive: { ...asset, sha256 },
        pipelineInputSelected: false,
        files: reads.map(file => ({ storedFilename: path.relative(context.storage.cacheDir, file.path), sha256: file.sha256, md5: file.md5, bytes: file.bytes, records: file.records })),
      },
    };
  },
};
