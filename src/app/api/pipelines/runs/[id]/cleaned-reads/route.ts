import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { isDemoSession } from "@/lib/demo/server";
import {
  listReadCleaningCandidates,
  promoteReadCleaningCandidates,
} from "@/lib/pipelines/read-cleaning-results";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { id } = await params;
    const summary = await listReadCleaningCandidates(id);
    return NextResponse.json(summary);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to list cleaned read candidates";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "Read cleaning promotion is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const body = (await request.json().catch(() => ({}))) as {
      sampleIds?: unknown;
    };
    const sampleIds = Array.isArray(body.sampleIds)
      ? body.sampleIds.filter((value): value is string => typeof value === "string")
      : undefined;

    const result = await promoteReadCleaningCandidates({
      runId: id,
      sampleIds,
      userId: session.user.id,
    });

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to promote cleaned reads";
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }
}
