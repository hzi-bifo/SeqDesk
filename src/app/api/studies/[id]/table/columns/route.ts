import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

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

// Add/remove a MIxS checklist field as a Table Overview column. The selection is
// stored on the study (studyMetadata._mixsColumns); the field's checklistData stays
// the single source of truth, so it's in sync with the per-sample MIxS editor.
async function mutate(
  request: Request,
  params: Promise<{ id: string }>,
  op: "add" | "remove"
) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

  const body = await request.json().catch(() => null);
  const fieldName =
    typeof body?.fieldName === "string" ? body.fieldName.trim() : "";
  if (!fieldName) {
    return NextResponse.json(
      { error: "fieldName is required" },
      { status: 400 }
    );
  }

  const study = await resolveStudy(id);
  if (!study) {
    return NextResponse.json({ error: "Study not found" }, { status: 404 });
  }
  if (!isFacilityAdmin && study.userId !== session.user.id) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const metadata = parseJsonObject(study.studyMetadata);
  const current = Array.isArray(metadata._mixsColumns)
    ? (metadata._mixsColumns as unknown[]).filter(
        (entry): entry is string => typeof entry === "string"
      )
    : [];
  const next =
    op === "add"
      ? current.includes(fieldName)
        ? current
        : [...current, fieldName]
      : current.filter((entry) => entry !== fieldName);

  metadata._mixsColumns = next;
  await db.study.update({
    where: { id: study.id },
    data: { studyMetadata: JSON.stringify(metadata) },
  });

  return NextResponse.json({ success: true, mixsColumns: next });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await mutate(request, params, "add");
  } catch (error) {
    console.error("[Study Table Columns POST] error:", error);
    return NextResponse.json({ error: "Failed to add column" }, { status: 500 });
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    return await mutate(request, params, "remove");
  } catch (error) {
    console.error("[Study Table Columns DELETE] error:", error);
    return NextResponse.json(
      { error: "Failed to remove column" },
      { status: 500 }
    );
  }
}
