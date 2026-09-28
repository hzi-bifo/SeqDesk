import crypto from "crypto";
import { DelimitedParseError } from "./parsers/delimited";
import { db } from "@/lib/db";
import { requireTargetAccess, type SessionLike } from "@/lib/explore/authorization";
import { getTableKind, suggestRoles } from "@/lib/explore/dataset-kinds";
import { createDataset, deleteDataset, freeImportName, getDatasetRecord, serializeDatasetSummary, writeDatasetVersion } from "@/lib/explore/datasets";
import { createImportJob, finishImportJob, serializeImportJob } from "@/lib/explore/import-jobs";
import { ImportCancelled, writeDatasetVersionStream } from "@/lib/explore/table-store";
import { readFailureWords } from "@/lib/explore/import-words";
import { importRoles, isStreamableTable, parseImportFile, prepareImport, previewDelimitedFile, streamDelimitedFile } from "@/lib/explore/importers/file";
import { ExploreRouteError } from "@/lib/explore/route-error";
import { EXPLORE_ROLES, EXPLORE_SENSITIVITIES, SENSITIVITY_RANK, type ExploreRole, type ExploreRoleMap, type ExploreSensitivity } from "@/lib/explore/types";
import { fileSensitivity, getLibraryFile, libraryFilePath, readLibraryFile, storeLibraryFile } from "@/lib/files/library";
import { canImportFileAsTable, MAX_LIBRARY_FILE_BYTES } from "@/lib/files/library-types";

const PREVIEW_ROWS = 25;

function formString(form: FormData, key: string, maxLength = 200): string | null {
  const value = form.get(key);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, maxLength) : null;
}

function parseRoles(raw: string | null): ExploreRoleMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const roles: ExploreRoleMap = {};
    for (const [role, column] of Object.entries(parsed)) {
      if (EXPLORE_ROLES.includes(role as ExploreRole) && typeof column === "string") {
        roles[role as ExploreRole] = column.trim().slice(0, 120);
      }
    }
    return roles;
  } catch {
    return {};
  }
}

/** Parser and size problems that a caller should report as a bad request. */
export function isImportInputError(error: unknown): boolean {
  return error instanceof DelimitedParseError || error instanceof Error && !(error instanceof ExploreRouteError) && /limit|Unsupported file type/i.test(error.message);
}

/**
 * Import an XLSX, CSV or TSV file as an external dataset, from the file
 * library (`fileId`) or from uploaded bytes (`file`). Used by the browser
 * route and by the Analysis integration API.
 *
 * multipart/form-data fields: file | fileId, targetKey, name?, tableKind?,
 * sensitivity?, roles? (JSON role -> column), sheet?, reportId?, idGrammar?
 * ("indivo"), idColumn?, sampleTypeColumn?, depletionColumn?, isolateColumn?.
 * With `preview` the file is parsed and the columns, first rows and suggested
 * roles are returned without creating anything.
 */
export async function importDatasetFromForm(session: SessionLike & { user: { id: string } }, form: FormData, preview: boolean, options: { background?: boolean } = {}): Promise<{ status: number; body: Record<string, unknown> }> {
  const targetKey = formString(form, "targetKey") ?? "";
  await requireTargetAccess(session, targetKey, "write");

  const sourceFileId = formString(form, "fileId");
  let storedFile = sourceFileId ? await getLibraryFile(sourceFileId) : null;
  if (storedFile && (storedFile.targetKey !== targetKey || storedFile.removedAt)) throw new ExploreRouteError(404, "File not found");
  const file = form.get("file");
  if (!storedFile && !(file instanceof File)) throw new ExploreRouteError(400, "Choose a source file from Files.");
  const fileName = storedFile?.originalName ?? (file as File).name;
  if (!canImportFileAsTable(fileName)) throw new ExploreRouteError(400, "This file can be kept as a reference or used by a custom analysis. Table import supports CSV, TSV, TXT and Excel files.");
  const idGrammarRequested = formString(form, "idGrammar", 40);
  // A stored CSV/TSV is read as a stream: any size, memory bounded by a batch of rows.
  if (storedFile && isStreamableTable(fileName) && !idGrammarRequested) {
    return importStreamed(session, form, storedFile, targetKey, fileName, preview, options.background === true);
  }
  if (storedFile && Number(storedFile.sizeBytes) > MAX_LIBRARY_FILE_BYTES) throw new ExploreRouteError(413, "Excel files over 100 MB cannot be imported; save the sheet as CSV or TSV.");
  if (file instanceof File && file.size > MAX_LIBRARY_FILE_BYTES) throw new ExploreRouteError(413, "Files must be 100 MB or smaller.");
  const buffer = storedFile ? await readLibraryFile(storedFile) : Buffer.from(await (file as File).arrayBuffer());
  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const reportId = formString(form, "reportId");
  if (reportId) {
    const report = await db.exploreReport.findUnique({ where: { id: reportId }, select: { targetKey: true } });
    if (!report || report.targetKey !== targetKey) throw new ExploreRouteError(404, "Report not found");
  }

  const tableKind = formString(form, "tableKind", 80);
  if (tableKind && !getTableKind(tableKind)) throw new ExploreRouteError(400, "Unknown table kind");
  const idGrammar = formString(form, "idGrammar", 40);
  const idColumn = formString(form, "idColumn", 120);
  const parsed = await parseImportFile(buffer, {
    fileName,
    sheet: formString(form, "sheet", 120),
    idGrammar:
      idGrammar === "indivo" && idColumn
        ? {
            kind: "indivo",
            idColumn,
            sampleTypeColumn: formString(form, "sampleTypeColumn", 120),
            depletionColumn: formString(form, "depletionColumn", 120),
            isolateColumn: formString(form, "isolateColumn", 120),
          }
        : null,
  });

  if (preview) {
    return { status: 200, body: {
      fileName,
      columns: parsed.columns,
      rows: parsed.rows.slice(0, PREVIEW_ROWS),
      rowCount: parsed.rows.length,
      sheets: parsed.sheets,
      sheet: parsed.sheet,
      suggestedRoles: suggestRoles(parsed.columns, tableKind ?? "sample-summary"),
      warnings: parsed.warnings,
    } };
  }

  if (parsed.rows.length === 0) throw new ExploreRouteError(400, "The file has no data rows");
  const prepared = prepareImport(parsed, {
    tableKind,
    roles: parseRoles(formString(form, "roles", 5000)),
    fileName,
    checksum,
  });
  const requestedSensitivity = formString(form, "sensitivity", 40) as ExploreSensitivity | null;
  const chosen =
    requestedSensitivity && EXPLORE_SENSITIVITIES.includes(requestedSensitivity) ? requestedSensitivity : prepared.sensitivity;
  // A table read from a sensitive file is at least as sensitive as the file.
  const inherited = storedFile ? fileSensitivity(storedFile) : "standard";
  const sensitivity = SENSITIVITY_RANK[inherited] > SENSITIVITY_RANK[chosen] ? inherited : chosen;

  if (!storedFile) storedFile = await storeLibraryFile({ targetKey, file: file as File, createdById: session.user.id });
  prepared.provenance.sources = [{ type: "file", id: storedFile.id, label: storedFile.originalName, checksum }];
  const created = await createDataset({
    targetKey,
    kind: "external",
    tableKind,
    name: await freeImportName(targetKey, formString(form, "name") ?? fileName.replace(/\.[^.]+$/, "")),
    description: `Imported from ${fileName}`,
    sensitivity,
    roles: prepared.roles,
    sourceFileId: storedFile.id,
    sourceConfig: { builder: "import", fileId: storedFile.id, fileName, checksum, idGrammar: idGrammar ?? null, idColumn },
    createdById: session.user.id,
  });
  const version = await writeDatasetVersion({
    datasetId: created.id,
    schema: prepared.schema,
    rows: prepared.rows,
    provenance: prepared.provenance,
    buildSource: "import",
    createdById: session.user.id,
    keys: prepared.keys,
  });
  const record = await getDatasetRecord(created.id);
  if (reportId) await db.exploreReportFile.upsert({
    where: { reportId_fileId: { reportId, fileId: storedFile.id } },
    create: { reportId, fileId: storedFile.id }, update: {},
  });
  return { status: 201, body: { dataset: record ? serializeDatasetSummary(record) : null, version, warnings: prepared.warnings } };
}

type StoredFile = NonNullable<Awaited<ReturnType<typeof getLibraryFile>>>;

/**
 * Import (or preview) a stored delimited file as a stream. The preview reads the first few MB and estimates the
 * row count. The import writes the table in one pass (see writeDatasetVersionStream); with `background` it
 * returns a job at once (202) whose progress the caller polls, and which it can cancel.
 */
async function importStreamed(session: SessionLike & { user: { id: string } }, form: FormData, storedFile: StoredFile, targetKey: string, fileName: string, preview: boolean, background: boolean): Promise<{ status: number; body: Record<string, unknown> }> {
  const filePath = await libraryFilePath(storedFile);
  const tableKind = formString(form, "tableKind", 80);
  if (tableKind && !getTableKind(tableKind)) throw new ExploreRouteError(400, "Unknown table kind");
  const head = await previewDelimitedFile(filePath, fileName, PREVIEW_ROWS);
  const sizeBytes = Number(storedFile.sizeBytes);
  if (preview) {
    return { status: 200, body: {
      fileName, columns: head.columns, rows: head.rows, rowCount: head.rowCount, rowCountApproximate: head.approximate, sizeBytes,
      sheets: [], sheet: null, suggestedRoles: suggestRoles(head.columns, tableKind ?? "sample-summary"), warnings: [],
    } };
  }
  if (head.rowCount === 0) throw new ExploreRouteError(400, "The file has no data rows");
  const reportId = formString(form, "reportId");
  if (reportId) {
    const report = await db.exploreReport.findUnique({ where: { id: reportId }, select: { targetKey: true } });
    if (!report || report.targetKey !== targetKey) throw new ExploreRouteError(404, "Report not found");
  }
  const { roles, warnings } = importRoles(head.columns, tableKind, parseRoles(formString(form, "roles", 5000)));
  const requestedSensitivity = formString(form, "sensitivity", 40) as ExploreSensitivity | null;
  const chosen = requestedSensitivity && EXPLORE_SENSITIVITIES.includes(requestedSensitivity) ? requestedSensitivity : roles.subject ? "pseudonymous" : "standard";
  const inherited = fileSensitivity(storedFile);
  const sensitivity = SENSITIVITY_RANK[inherited] > SENSITIVITY_RANK[chosen] ? inherited : chosen;
  const checksum = storedFile.checksumSha256;
  const created = await createDataset({
    targetKey, kind: "external", tableKind, name: await freeImportName(targetKey, formString(form, "name") ?? fileName.replace(/(\.[^.]+)?\.gz$|\.[^.]+$/i, "")),
    description: `Imported from ${fileName}`, sensitivity, roles, sourceFileId: storedFile.id,
    sourceConfig: { builder: "import", fileId: storedFile.id, fileName, checksum, idGrammar: null, idColumn: null },
    createdById: session.user.id,
  });
  const job = createImportJob({ targetKey, userId: session.user.id, fileName, sizeBytes, expectedRows: head.rowCount });
  job.datasetId = created.id;
  const run = async () => {
    const { rows } = streamDelimitedFile(filePath, fileName, { verify: { checksum } });
    const version = await writeDatasetVersionStream({
      datasetId: created.id, columns: head.columns, rows, buildSource: "import", createdById: session.user.id, roles,
      keys: { sample: roles.sample, subject: roles.subject, key: roles.taxon_id ?? roles.taxon },
      provenance: { builtAt: new Date().toISOString(), builder: "import@1", sources: [{ type: "file", id: storedFile.id, label: storedFile.originalName, checksum }], notes: [] },
      expectedRows: head.rowCount, signal: job.controller.signal, onProgress: (count) => { job.rows = count; },
    });
    if (version.rowCount === 0) throw new ExploreRouteError(400, "The file has no data rows");
    if (reportId) await db.exploreReportFile.upsert({ where: { reportId_fileId: { reportId, fileId: storedFile.id } }, create: { reportId, fileId: storedFile.id }, update: {} });
    return version;
  };
  const settle = run().then((version) => {
    job.rows = version.rowCount;
    finishImportJob(job, { state: "done", datasetId: created.id, warnings });
    return version;
  }, async (error: unknown) => {
    await deleteDataset(created.id).catch(() => {});
    const cancelled = error instanceof ImportCancelled;
    finishImportJob(job, { state: cancelled ? "cancelled" : "failed", datasetId: null, error: cancelled ? null : readFailureWords(error) ?? (error instanceof Error ? error.message : String(error)) });
    throw error;
  });
  if (background) {
    settle.catch(() => { /* Recorded on the job. */ });
    return { status: 202, body: { job: serializeImportJob(job) } };
  }
  const version = await settle;
  const record = await getDatasetRecord(created.id);
  return { status: 201, body: { dataset: record ? serializeDatasetSummary(record) : null, version: { versionId: version.versionId, number: version.number, rowCount: version.rowCount, contentHash: version.contentHash, unchanged: version.unchanged }, warnings } };
}
