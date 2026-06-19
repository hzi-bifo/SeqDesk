import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  buildStudyTableData,
  EDITABLE_CORE_COLUMNS,
  EDITABLE_FIELD_TYPES,
} from "@/lib/studies/study-table";
import { loadStudyFormSchema } from "@/lib/studies/schema";
import { loadOrderFormSchema } from "@/lib/orders/order-form";

// GET the read-only "Table overview" model for a study (identity + status + the
// per-sample metadata columns, one row per assigned sample).
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    const data = await buildStudyTableData(id, { isFacilityAdmin });

    if (!data) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }
    if (!isFacilityAdmin && data.study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(data);
  } catch (error) {
    console.error("[Study Table] error:", error);
    return NextResponse.json(
      { error: "Failed to load study table" },
      { status: 500 }
    );
  }
}

function parseJsonObject(value: string | null): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

async function resolveStudy(idOrAlias: string) {
  const byId = await db.study.findUnique({
    where: { id: idOrAlias },
    select: { id: true, userId: true, studyMetadata: true },
  });
  if (byId) return byId;
  try {
    return await db.study.findFirst({
      where: { alias: idOrAlias },
      orderBy: { createdAt: "desc" },
      select: { id: true, userId: true, studyMetadata: true },
    });
  } catch {
    return null;
  }
}

function addedMixsColumnsOf(studyMetadata: string | null): string[] {
  const parsed = parseJsonObject(studyMetadata);
  return Array.isArray(parsed._mixsColumns)
    ? (parsed._mixsColumns as unknown[]).filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
}

// PATCH a single per-sample cell: { sampleId, columnKey, value }. The columnKey
// (checklist:/custom:/core:) decides where the value is written; the field is
// re-validated server-side against the role-filtered schema, so a client can only
// edit fields it is actually allowed to see. Values merge — never replace the blob.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    const body = await request.json().catch(() => null);
    const sampleId = typeof body?.sampleId === "string" ? body.sampleId : null;
    const columnKey = typeof body?.columnKey === "string" ? body.columnKey : null;
    if (!sampleId || !columnKey) {
      return NextResponse.json(
        { error: "sampleId and columnKey are required" },
        { status: 400 }
      );
    }
    const value =
      body.value === null || body.value === undefined ? "" : String(body.value);

    const study = await resolveStudy(id);
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }
    if (!isFacilityAdmin && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const sample = await db.sample.findFirst({
      where: { id: sampleId, studyId: study.id },
      select: { id: true, checklistData: true, customFields: true },
    });
    if (!sample) {
      return NextResponse.json(
        { error: "Sample not found in this study" },
        { status: 404 }
      );
    }

    if (columnKey.startsWith("checklist:")) {
      const name = columnKey.slice("checklist:".length);
      const schema = await loadStudyFormSchema({
        studyId: study.id,
        isFacilityAdmin,
        applyRoleFilter: true,
        applyModuleFilter: true,
      });
      const field = schema.perSampleFields.find((f) => f.name === name);
      const isAddedMixs = addedMixsColumnsOf(study.studyMetadata).includes(name);
      if (field) {
        if (!EDITABLE_FIELD_TYPES.has(field.type)) {
          return NextResponse.json(
            { error: "Field is not editable" },
            { status: 400 }
          );
        }
      } else if (!isAddedMixs) {
        return NextResponse.json(
          { error: "Field is not editable" },
          { status: 400 }
        );
      }
      const merged = { ...parseJsonObject(sample.checklistData) };
      if (value === "") delete merged[name];
      else merged[name] = value;
      await db.sample.update({
        where: { id: sampleId },
        data: { checklistData: JSON.stringify(merged) },
      });
    } else if (columnKey.startsWith("custom:")) {
      const name = columnKey.slice("custom:".length);
      const schema = await loadOrderFormSchema({ isFacilityAdmin });
      const field = schema.perSampleFields.find((f) => f.name === name);
      if (!field || !EDITABLE_FIELD_TYPES.has(field.type)) {
        return NextResponse.json(
          { error: "Field is not editable" },
          { status: 400 }
        );
      }
      const merged = { ...parseJsonObject(sample.customFields) };
      if (value === "") delete merged[name];
      else merged[name] = value;
      await db.sample.update({
        where: { id: sampleId },
        data: { customFields: JSON.stringify(merged) },
      });
    } else if (columnKey.startsWith("core:")) {
      const column = columnKey.slice("core:".length);
      if (!EDITABLE_CORE_COLUMNS.has(column)) {
        return NextResponse.json(
          { error: "Field is not editable" },
          { status: 400 }
        );
      }
      await db.sample.update({
        where: { id: sampleId },
        data: { [column]: value || null },
      });
    } else {
      return NextResponse.json(
        { error: "Column is not editable" },
        { status: 400 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Study Table PATCH] error:", error);
    return NextResponse.json(
      { error: "Failed to update cell" },
      { status: 500 }
    );
  }
}
