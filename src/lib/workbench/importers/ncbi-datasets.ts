/**
 * NCBI Datasets genome packages, shared by the taxon and the assembly connectors: one ZIP for a set of versioned
 * assembly accessions, capped while it streams, unpacked safely, and every file checked against the MD5 NCBI lists in
 * the package's md5sum.txt.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { computeFileSha256 } from "@/lib/workbench/storage";
import { extractWorkbenchZip } from "@/lib/workbench/safe-zip";
import { DATASETS_API, ncbiRequest } from "./ncbi-client";
import { formatBytes, recordMaxDownloadBytes } from "./public-record-download";
import type { WorkbenchImportStartContext } from "./types";

export const ASSEMBLY_ACCESSION = /^GC[AF]_\d{9}\.\d{1,3}$/;
export type GenomeFileType = "GENOME_FASTA" | "GENOME_GFF";

/** md5sum.txt of an NCBI Datasets package: "<md5>  <path>" per file. */
export function parseMd5List(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const match = /^([0-9a-f]{32})\s+\*?(.+)$/.exec(line.trim());
    if (match) out.set(match[2].trim(), match[1]);
  }
  return out;
}

async function md5File(filePath: string): Promise<string> {
  const hash = createHash("md5");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk as Buffer);
  return hash.digest("hex");
}

export function genomePackageUrl(accessions: string[], types: GenomeFileType[]): string {
  const url = new URL(`${DATASETS_API}/genome/accession/${accessions.map(encodeURIComponent).join(",")}/download`);
  for (const type of types) url.searchParams.append("include_annotation_type", type);
  url.searchParams.set("hydrated", "FULLY_HYDRATED");
  return url.toString();
}

export interface VerifiedGenomeFile {
  accession: string;
  kind: "genome" | "annotation";
  filename: string;
  /** Path inside the unpacked package. */
  path: string;
  bytes: number;
  md5: string;
  sha256: string;
}

/**
 * Download one package into `<jobDir>/<name>.zip`, unpack it to `destination` and verify it. `limitBytes` caps the
 * download (never above the server-wide limit). Every requested FASTA must be there; a GFF only when `requireGff`.
 */
export async function downloadGenomePackage<T>(context: WorkbenchImportStartContext<T>, options: {
  accessions: string[];
  types: GenomeFileType[];
  destination: string;
  name: string;
  limitBytes?: number;
  progress?: [number, number];
}): Promise<{ url: string; zipPath: string; zipBytes: number; zipSha256: string; files: VerifiedGenomeFile[]; checked: number }> {
  const { accessions, types } = options;
  if (!accessions.length) throw new Error("There is no genome to download.");
  if (accessions.some(accession => !ASSEMBLY_ACCESSION.test(accession)) || new Set(accessions).size !== accessions.length) {
    throw new Error("Import requires distinct, explicitly versioned assembly accessions");
  }
  const limit = Math.min(options.limitBytes ?? Number.MAX_SAFE_INTEGER, recordMaxDownloadBytes());
  const zipPath = path.join(context.storage.jobDir, `${options.name}.zip`);
  const url = genomePackageUrl(accessions, types);
  const [from, to] = options.progress ?? [10, 70];
  await context.update({ status: "running", phase: "downloading", progress: from, targetPath: zipPath });
  await context.log(`Downloading ${accessions.length} genome package(s) from the NCBI Datasets API.`);
  const response = await ncbiRequest(url, {
    source: "NCBI Datasets", accept: "application/zip", timeoutMs: 6 * 60 * 60 * 1000, signal: context.signal,
    notFound: "NCBI Datasets has no package for these assemblies. Preview them again.",
  });
  if (!response.body) throw new Error("NCBI Datasets sent an empty package. Try again later.");
  let bytes = 0;
  let lastProgress = 0;
  const meter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      bytes += chunk.length;
      if (bytes > limit) return callback(new Error(`The NCBI genome package is larger than the ${formatBytes(limit)} allowed for this import.`));
      if (Date.now() - lastProgress > 1000) {
        lastProgress = Date.now();
        void context.update({ phase: `Downloading · ${formatBytes(bytes)}` }).catch(() => undefined);
      }
      callback(null, chunk);
    },
  });
  await pipeline(Readable.fromWeb(response.body as never), meter, createWriteStream(zipPath, { mode: 0o600 }), ...(context.signal ? [{ signal: context.signal }] : []));
  await context.log(`Downloaded ${formatBytes(bytes)}.`);

  await context.update({ phase: "extracting", progress: Math.round((from + to) / 2), targetPath: options.destination });
  await extractWorkbenchZip(zipPath, options.destination);
  const md5s = parseMd5List(await fs.readFile(path.join(options.destination, "md5sum.txt"), "utf8").catch(() => ""));
  if (!md5s.size) throw new Error("The NCBI package has no checksum list (md5sum.txt); import it again.");
  const files: VerifiedGenomeFile[] = [];
  for (const [relative, expected] of md5s) {
    const absolute = path.resolve(options.destination, relative);
    if (!absolute.startsWith(`${options.destination}${path.sep}`)) throw new Error("The NCBI checksum list names a file outside the package.");
    context.signal?.throwIfAborted();
    const actual = await md5File(absolute);
    if (actual !== expected) throw new Error(`${relative} did not match the MD5 NCBI published. Import it again.`);
    const accession = /data\/(GC[AF]_\d+\.\d+)\//.exec(relative)?.[1];
    const kind = relative.endsWith(".fna") ? "genome" : relative.endsWith(".gff") ? "annotation" : null;
    if (accession && kind) {
      files.push({ accession, kind, filename: `${accession}_${path.basename(relative)}`.replace(/^(GC[AF]_\d+\.\d+)_\1_/, "$1_"), path: relative, bytes: (await fs.stat(absolute)).size, md5: actual, sha256: await computeFileSha256(absolute) });
    }
  }
  if (types.includes("GENOME_FASTA") && accessions.some(accession => !files.some(file => file.accession === accession && file.kind === "genome"))) {
    throw new Error("NCBI's checksum list does not cover every genome FASTA; import it again.");
  }
  await context.log(`Verified ${md5s.size} file(s) against NCBI's md5sum.txt.`);
  return { url, zipPath, zipBytes: bytes, zipSha256: await computeFileSha256(zipPath), files, checked: md5s.size };
}
