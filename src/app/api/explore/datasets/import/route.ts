import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { getTableKind, suggestRoles } from "@/lib/explore/dataset-kinds";
import { createDataset, getDatasetRecord, serializeDatasetSummary, writeDatasetVersion } from "@/lib/explore/datasets";
import { parseImportFile, prepareImport } from "@/lib/explore/importers/file";
import { EXPLORE_ROLES, EXPLORE_SENSITIVITIES, type ExploreRole, type ExploreRoleMap, type ExploreSensitivity } from "@/lib/explore/types";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../_shared";
import { db } from "@/lib/db";
import { getLibraryFile, readLibraryFile, storeLibraryFile } from "@/lib/files/library";
import { canImportFileAsTable, MAX_LIBRARY_FILE_BYTES } from "@/lib/files/library-types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

/**
 * Import an XLSX, CSV or TSV file as an external dataset.
 *
 * multipart/form-data fields: file, targetKey, name?, tableKind?, sensitivity?,
 * roles? (JSON role -> column), sheet?, idGrammar? ("indivo"), idColumn?,
 * sampleTypeColumn?, depletionColumn?, isolateColumn?.
 * With `?preview=1` the file is parsed and the columns, first rows and
 * suggested roles are returned without creating anything.
 */
export async function POST(request: NextRequest) {
  try {
    const session = await requireExploreSession();
    if (session.user.isDemo) throw new ExploreRouteError(403, "Imports are disabled in the public demo.");
    const form = await request.formData();
    const targetKey = formString(form, "targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "write");

    const sourceFileId = formString(form, "fileId");
    let storedFile = sourceFileId ? await getLibraryFile(sourceFileId) : null;
    if (storedFile && storedFile.targetKey !== targetKey) throw new ExploreRouteError(404, "File not found");
    const file = form.get("file");
    if (!storedFile && !(file instanceof File)) throw new ExploreRouteError(400, "Choose a source file from Files.");
    const fileName = storedFile?.originalName ?? (file as File).name;
    if (!canImportFileAsTable(fileName)) throw new ExploreRouteError(400, "This file can be kept as a reference or used by a custom analysis. Table import supports CSV, TSV, TXT and Excel files.");
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

    const isPreview = request.nextUrl.searchParams.get("preview") === "1";
    if (isPreview) {
      return NextResponse.json({
        fileName,
        columns: parsed.columns,
        rows: parsed.rows.slice(0, PREVIEW_ROWS),
        rowCount: parsed.rows.length,
        sheets: parsed.sheets,
        sheet: parsed.sheet,
        suggestedRoles: suggestRoles(parsed.columns, tableKind ?? "sample-summary"),
        warnings: parsed.warnings,
      });
    }

    if (parsed.rows.length === 0) throw new ExploreRouteError(400, "The file has no data rows");
    const prepared = prepareImport(parsed, {
      tableKind,
      roles: parseRoles(formString(form, "roles", 5000)),
      fileName,
      checksum,
    });
    const requestedSensitivity = formString(form, "sensitivity", 40) as ExploreSensitivity | null;
    const sensitivity =
      requestedSensitivity && EXPLORE_SENSITIVITIES.includes(requestedSensitivity) ? requestedSensitivity : prepared.sensitivity;

    if (!storedFile) storedFile = await storeLibraryFile({ targetKey, file: file as File, createdById: session.user.id });
    prepared.provenance.sources = [{ type: "file", id: storedFile.id, label: storedFile.originalName, checksum }];
    const created = await createDataset({
      targetKey,
      kind: "external",
      tableKind,
      name: formString(form, "name") ?? fileName.replace(/\.[^.]+$/, ""),
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
    return NextResponse.json(
      { dataset: record ? serializeDatasetSummary(record) : null, version, warnings: prepared.warnings },
      { status: 201 }
    );
  } catch (error) {
    if (error instanceof Error && !(error instanceof ExploreRouteError) && /limit|Unsupported file type/i.test(error.message)) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    return exploreErrorResponse(error);
  }
}
