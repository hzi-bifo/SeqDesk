import crypto from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { requireTargetAccess } from "@/lib/explore/authorization";
import { getTableKind, suggestRoles } from "@/lib/explore/dataset-kinds";
import { createDataset, getDatasetRecord, serializeDatasetSummary, writeDatasetVersion } from "@/lib/explore/datasets";
import { parseImportFile, prepareImport } from "@/lib/explore/importers/file";
import { EXPLORE_ROLES, EXPLORE_SENSITIVITIES, type ExploreRole, type ExploreRoleMap, type ExploreSensitivity } from "@/lib/explore/types";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../_shared";

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
      if (EXPLORE_ROLES.includes(role as ExploreRole) && typeof column === "string" && column.trim()) {
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
    const form = await request.formData();
    const targetKey = formString(form, "targetKey") ?? "";
    await requireTargetAccess(session, targetKey, "write");

    const file = form.get("file");
    if (!(file instanceof File)) throw new ExploreRouteError(400, "A file is required");
    const buffer = Buffer.from(await file.arrayBuffer());
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    const tableKind = formString(form, "tableKind", 80);
    if (tableKind && !getTableKind(tableKind)) throw new ExploreRouteError(400, "Unknown table kind");
    const idGrammar = formString(form, "idGrammar", 40);
    const idColumn = formString(form, "idColumn", 120);
    const parsed = await parseImportFile(buffer, {
      fileName: file.name,
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
        fileName: file.name,
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
      fileName: file.name,
      checksum,
    });
    const requestedSensitivity = formString(form, "sensitivity", 40) as ExploreSensitivity | null;
    const sensitivity =
      requestedSensitivity && EXPLORE_SENSITIVITIES.includes(requestedSensitivity) ? requestedSensitivity : prepared.sensitivity;

    const created = await createDataset({
      targetKey,
      kind: "external",
      tableKind,
      name: formString(form, "name") ?? file.name.replace(/\.[^.]+$/, ""),
      description: `Imported from ${file.name}`,
      sensitivity,
      roles: prepared.roles,
      sourceConfig: { builder: "import", fileName: file.name, checksum, idGrammar: idGrammar ?? null, idColumn },
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
