import crypto from "crypto";
import fs from "fs/promises";
import path from "path";

import { db } from "@/lib/db";
import { importDatasetFromForm } from "@/lib/explore/dataset-import";
import { ensureVersionProfile, getDatasetRecord, serializeDatasetSummary } from "@/lib/explore/datasets";
import { readProfile } from "@/lib/explore/table-profile";
import { requireTargetAccess, type SessionLike } from "@/lib/explore/authorization";
import { ExploreRouteError } from "@/lib/explore/route-error";
import { storeLibraryFile } from "@/lib/files/library";
import { canImportFileAsTable, MAX_LIBRARY_FILE_BYTES } from "@/lib/files/library-types";
import { assertPathInsideBase } from "@/lib/workbench/storage";
import { getOrCreateDefaultWorkbenchWorkspace } from "@/lib/workbench/workspaces";

/**
 * Downloaded first, analysed second: a finished connector import (Zenodo, figshare-like records) holds verified
 * files in SeqDesk's import store; this turns one of them into an Analysis table in a study. The bytes are
 * re-checked against the SHA-256 recorded at download time, and the table carries where it came from
 * (source, record, DOI, version, licence, file checksums, retrieval time) in its description and sourceConfig.
 */

export interface ImportedFile {
  filename: string;
  storedFilename: string;
  bytes: number;
  md5?: string;
  sha256?: string;
  sourceUrl?: string;
  /**
   * What the download was checked against: the MD5 or SHA-256 the source published, UniProt's sequence digest, or
   * nothing but size ("none": SeqDesk's own SHA-256 is recorded, not compared with anything the source published).
   */
  checked: "md5" | "sha256" | "sequence" | "none";
  asTable: boolean;
}

function checkedAgainst(providerId: string, sourceVersion: unknown): ImportedFile["checked"] {
  if (providerId === "ena-fastq-accession") return "md5";
  const version = typeof sourceVersion === "string" ? sourceVersion : "";
  return version.startsWith("md5:") ? "md5" : version.startsWith("sha256:") ? "sha256" : version.startsWith("sequence-md5:") ? "sequence" : "none";
}

export interface ImportProvenance {
  source: string;
  record?: string;
  title?: string;
  detail?: string;
  sourcePage?: string;
  retrievedAt?: string;
  checksumSha256?: string | null;
  /** Reference resources: pinned release, licence and citation, so a table read by a step names its source. */
  kind?: string;
  version?: string;
  licence?: string;
  licenceUrl?: string;
  citation?: string;
  sourceUrls?: string[];
}

async function successfulImport(userId: string, jobId: string) {
  const workspace = await getOrCreateDefaultWorkbenchWorkspace(userId);
  const job = await db.workbenchImportJob.findFirst({ where: { id: jobId, workspaceId: workspace.id }, include: { resultDataset: true } });
  if (!job) throw new ExploreRouteError(404, "Import not found.");
  if (job.status !== "success" || !job.resultDataset?.storagePath) throw new ExploreRouteError(409, "This import has not finished.");
  const meta = (() => { try { return JSON.parse(job.resultDataset!.sourceMetadata ?? "{}") as Record<string, unknown>; } catch { return {}; } })();
  const files = (Array.isArray(meta.files) ? meta.files : []).flatMap((entry): ImportedFile[] => {
    if (!entry || typeof entry !== "object") return [];
    const file = entry as Record<string, unknown>;
    if (typeof file.filename !== "string" || typeof file.storedFilename !== "string") return [];
    return [{
      filename: file.filename, storedFilename: file.storedFilename, bytes: Number(file.bytes) || 0,
      ...(typeof file.md5 === "string" ? { md5: file.md5 } : {}), ...(typeof file.sha256 === "string" ? { sha256: file.sha256 } : {}),
      ...(typeof file.sourceUrl === "string" ? { sourceUrl: file.sourceUrl } : {}),
      checked: checkedAgainst(job.providerId, file.sourceVersion),
      asTable: canImportFileAsTable(file.filename) && (Number(file.bytes) || 0) <= MAX_LIBRARY_FILE_BYTES,
    }];
  });
  const text = (key: string) => typeof meta[key] === "string" ? meta[key] as string : undefined;
  const provenance: ImportProvenance = {
    source: text("source") ?? (job.providerId === "ena-fastq-accession" ? "ENA" : job.providerId), record: text("record") ?? text("accession"), title: text("title"), detail: text("detail"),
    sourcePage: text("sourcePage"), retrievedAt: text("retrievedAt"), checksumSha256: job.resultDataset.checksumSha256,
    ...(text("kind") ? { kind: text("kind") } : {}), ...(text("version") ? { version: text("version") } : {}),
    ...(text("licence") ? { licence: text("licence"), licenceUrl: text("licenceUrl"), citation: text("citation") } : {}),
    ...(Array.isArray(meta.sourceUrls) ? { sourceUrls: meta.sourceUrls.filter((url): url is string => typeof url === "string") } : {}),
  };
  return { job, storagePath: job.resultDataset.storagePath, files, provenance };
}

/** The files of a finished import, and which of them can become a table. */
export async function listImportFiles(userId: string, jobId: string) {
  const { files, provenance } = await successfulImport(userId, jobId);
  // Tables already made from these files (this import, or an earlier one of the very same bytes), so the page shows
  // them as done instead of offering a duplicate.
  const hashes = files.map((file) => file.sha256).filter((sha): sha is string => Boolean(sha));
  const made = await db.exploreDataset.findMany({ where: { OR: [{ sourceConfig: { contains: `"importJobId":"${jobId}"` } }, ...hashes.map((sha) => ({ sourceConfig: { contains: `"sha256":"${sha}"` } }))] }, select: { id: true, name: true, targetKey: true, sourceConfig: true, currentVersionId: true } });
  const tables = (await Promise.all(made.map(async (dataset) => {
    try {
      const file = (JSON.parse(dataset.sourceConfig ?? "{}") as { origin?: { importJobId?: string; file?: { filename?: string; sha256?: string } } }).origin;
      const match = files.find((entry) => entry.filename === file?.file?.filename && (file?.importJobId === jobId || (entry.sha256 && entry.sha256 === file?.file?.sha256)));
      const filename = match?.filename;
      if (!filename) return [];
      // The provenance check of the table ("normalised, not raw counts"), made once per version.
      const profile = dataset.currentVersionId ? readProfile(await ensureVersionProfile(dataset.currentVersionId)) : null;
      return [{ filename, datasetId: dataset.id, name: dataset.name, targetKey: dataset.targetKey, profile: profile ? { verdict: profile.verdict, sentence: profile.sentence, why: profile.why } : null }];
    } catch { return []; }
  }))).flat();
  // The same verified bytes already added to a study as a file (for a step's file input, e.g. FASTQ for a shell step).
  const added = hashes.length ? await db.managedFile.findMany({ where: { checksumSha256: { in: hashes }, removedAt: null }, select: { id: true, targetKey: true, checksumSha256: true } }) : [];
  return { files: files.map((file) => ({ ...file, tables: tables.filter((t) => t.filename === file.filename).map(({ filename: _f, ...t }) => t),
    studyFiles: added.filter((entry) => entry.checksumSha256 === file.sha256).map((entry) => ({ fileId: entry.id, targetKey: entry.targetKey })) })), provenance };
}

/** One line a person can read: "Zenodo 15152686 · 10.5281/zenodo.15152686 · v1 · cc-by-4.0 · 2025". */
export function provenanceLine(p: ImportProvenance): string {
  return [p.record ? `${p.source} ${p.record}` : p.source, p.detail].filter(Boolean).join(" · ");
}

/**
 * A finished import's file (FASTQ, BAM, ...) added to a study's files as it is, so a step can read it as a file input.
 * Same checks as a table: re-hashed against the download-time SHA-256, and the file's description names the source.
 */
export async function importFileToStudy(session: SessionLike & { user: { id: string } }, jobId: string, input: { targetKey: string; storedFilename: string }) {
  await requireTargetAccess(session, input.targetKey, "write");
  const { storagePath, files, provenance } = await successfulImport(session.user.id, jobId);
  const file = files.find((entry) => entry.storedFilename === input.storedFilename);
  if (!file) throw new ExploreRouteError(404, "That file is not part of this import.");
  if (file.bytes > MAX_LIBRARY_FILE_BYTES) throw new ExploreRouteError(400, `${file.filename} is larger than 100 MB; a study file holds at most 100 MB.`);
  const root = path.basename(storagePath) === "files" ? path.dirname(storagePath) : storagePath;
  const absolute = path.resolve(root, file.storedFilename);
  assertPathInsideBase(absolute, storagePath, "Imported file");
  const bytes = await fs.readFile(absolute);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (file.sha256 && file.sha256 !== sha256) throw new ExploreRouteError(409, `${file.filename} changed since it was downloaded (SHA-256 mismatch). Import it again.`);
  const origin = { importJobId: jobId, ...provenance, file: { filename: file.filename, bytes: file.bytes, md5: file.md5, sha256, sourceUrl: file.sourceUrl } };
  const existing = await db.managedFile.findFirst({ where: { targetKey: input.targetKey, checksumSha256: sha256, removedAt: null }, orderBy: { createdAt: "asc" } });
  if (existing) return { status: 200, body: { file: { id: existing.id, name: existing.originalName, sizeBytes: Number(existing.sizeBytes), checksumSha256: sha256 }, origin, existing: true } };
  const stored = await storeLibraryFile({ targetKey: input.targetKey, file: new File([bytes], file.filename), createdById: session.user.id });
  const description = `From ${provenanceLine(provenance)} · ${file.filename}${file.md5 ? ` · md5 ${file.md5}` : ""} · sha256 ${sha256.slice(0, 12)}…${provenance.retrievedAt ? ` · retrieved ${provenance.retrievedAt.slice(0, 10)}` : ""}`.slice(0, 1000);
  await db.managedFile.update({ where: { id: stored.id }, data: { description } });
  return { status: 201, body: { file: { id: stored.id, name: file.filename, sizeBytes: bytes.length, checksumSha256: sha256 }, origin } };
}

export async function importFileAsTable(session: SessionLike & { user: { id: string } }, jobId: string, input: { targetKey: string; storedFilename: string; name?: string; roles?: Record<string, string> }) {
  await requireTargetAccess(session, input.targetKey, "write");
  const { storagePath, files, provenance } = await successfulImport(session.user.id, jobId);
  const file = files.find((entry) => entry.storedFilename === input.storedFilename);
  if (!file) throw new ExploreRouteError(404, "That file is not part of this import.");
  if (!file.asTable) throw new ExploreRouteError(400, "Only CSV, TSV, TXT and Excel files up to 100 MB can become a table.");
  // Manifest paths are relative to the import's cache folder ("files/0001-…"); storagePath is its files/ folder.
  const root = path.basename(storagePath) === "files" ? path.dirname(storagePath) : storagePath;
  const absolute = path.resolve(root, file.storedFilename);
  assertPathInsideBase(absolute, storagePath, "Imported file");
  const bytes = await fs.readFile(absolute);
  const sha256 = crypto.createHash("sha256").update(bytes).digest("hex");
  if (file.sha256 && file.sha256 !== sha256) throw new ExploreRouteError(409, `${file.filename} changed since it was downloaded (SHA-256 mismatch). Import it again.`);

  // The same verified bytes already made a table in this study: return it instead of a duplicate.
  const candidates = await db.exploreDataset.findMany({ where: { targetKey: input.targetKey, sourceConfig: { contains: `"sha256":"${sha256}"` } }, orderBy: { createdAt: "asc" }, select: { id: true, sourceConfig: true, currentVersionId: true } });
  const existing = candidates.find((dataset) => {
    try { return (JSON.parse(dataset.sourceConfig ?? "{}") as { origin?: { file?: { filename?: string; sha256?: string } } }).origin?.file?.sha256 === sha256; } catch { return false; }
  });
  if (existing) {
    const record = await getDatasetRecord(existing.id);
    const found = existing.currentVersionId ? readProfile(await ensureVersionProfile(existing.currentVersionId)) : null;
    const origin = (JSON.parse(existing.sourceConfig ?? "{}") as { origin?: unknown }).origin;
    return { status: 200, body: { dataset: record ? serializeDatasetSummary(record) : null, origin, existing: true, profile: found ? { verdict: found.verdict, sentence: found.sentence, why: found.why } : null } };
  }

  const stored = await storeLibraryFile({ targetKey: input.targetKey, file: new File([bytes], file.filename), createdById: session.user.id });
  const form = new FormData();
  form.set("targetKey", input.targetKey);
  form.set("fileId", stored.id);
  if (input.name) form.set("name", input.name);
  if (input.roles) form.set("roles", JSON.stringify(input.roles));
  const result = await importDatasetFromForm(session, form, false);
  const created = result.body.dataset as { id?: string } | undefined;
  if (!created?.id) return result;

  const record = await db.exploreDataset.findUnique({ where: { id: created.id }, select: { sourceConfig: true } });
  const config = (() => { try { return JSON.parse(record?.sourceConfig ?? "{}") as Record<string, unknown>; } catch { return {}; } })();
  const origin = { importJobId: jobId, ...provenance, file: { filename: file.filename, bytes: file.bytes, md5: file.md5, sha256, sourceUrl: file.sourceUrl } };
  await db.exploreDataset.update({
    where: { id: created.id },
    data: {
      description: `From ${provenanceLine(provenance)} · ${file.filename} · sha256 ${sha256.slice(0, 12)}…${provenance.retrievedAt ? ` · retrieved ${provenance.retrievedAt.slice(0, 10)}` : ""}`.slice(0, 1000),
      sourceConfig: JSON.stringify({ ...config, origin }),
    },
  });
  const version = await db.exploreDataset.findUnique({ where: { id: created.id }, select: { currentVersionId: true } });
  const found = version?.currentVersionId ? readProfile(await ensureVersionProfile(version.currentVersionId)) : null;
  const profile = found ? { verdict: found.verdict, sentence: found.sentence, why: found.why } : null;
  return { status: result.status, body: { ...result.body, origin, profile } };
}
