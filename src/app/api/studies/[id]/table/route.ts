import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { buildStudyTableData } from "@/lib/studies/study-table";

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
