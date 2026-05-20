import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { isDemoSession } from "@/lib/demo/server";
import { getPipelineRunTargetKey } from "@/lib/pipelines/result-files";

async function getSelectableRun(id: string) {
  return db.pipelineRun.findUnique({
    where: { id },
    select: {
      id: true,
      pipelineId: true,
      status: true,
      targetType: true,
      studyId: true,
      orderId: true,
    },
  });
}

function getRunTargetPayload(run: {
  targetType: string | null;
  studyId: string | null;
  orderId: string | null;
}) {
  const targetKey = getPipelineRunTargetKey(run);
  if (!targetKey) return null;
  return {
    targetKey,
    studyId: targetKey.startsWith("study:") ? run.studyId : null,
    orderId: targetKey.startsWith("order:") ? run.orderId : null,
  };
}

export async function PUT(
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
        { error: "Pipeline result selection is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const run = await getSelectableRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    if (run.status !== "completed") {
      return NextResponse.json(
        { error: "Only completed pipeline runs can be selected as final." },
        { status: 400 }
      );
    }

    const target = getRunTargetPayload(run);
    if (!target) {
      return NextResponse.json(
        { error: "Pipeline run does not have a study or order target." },
        { status: 400 }
      );
    }

    const selection = await db.pipelineResultSelection.upsert({
      where: {
        pipelineId_targetKey: {
          pipelineId: run.pipelineId,
          targetKey: target.targetKey,
        },
      },
      create: {
        pipelineId: run.pipelineId,
        targetKey: target.targetKey,
        studyId: target.studyId,
        orderId: target.orderId,
        selectedRunId: run.id,
        selectedById: session.user.id,
        selectedAt: new Date(),
      },
      update: {
        studyId: target.studyId,
        orderId: target.orderId,
        selectedRunId: run.id,
        selectedById: session.user.id,
        selectedAt: new Date(),
      },
      include: {
        selectedBy: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    return NextResponse.json({ success: true, selection });
  } catch (error) {
    console.error("[Pipeline Result Selection API] Error selecting run:", error);
    return NextResponse.json(
      { error: "Failed to select pipeline run as final" },
      { status: 500 }
    );
  }
}

export async function DELETE(
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
        { error: "Pipeline result selection is disabled in the public demo." },
        { status: 403 }
      );
    }

    const { id } = await params;
    const run = await getSelectableRun(id);
    if (!run) {
      return NextResponse.json({ error: "Run not found" }, { status: 404 });
    }

    const target = getRunTargetPayload(run);
    if (!target) {
      return NextResponse.json(
        { error: "Pipeline run does not have a study or order target." },
        { status: 400 }
      );
    }

    const deleted = await db.pipelineResultSelection.deleteMany({
      where: {
        pipelineId: run.pipelineId,
        targetKey: target.targetKey,
        selectedRunId: run.id,
      },
    });

    return NextResponse.json({ success: true, cleared: deleted.count > 0 });
  } catch (error) {
    console.error("[Pipeline Result Selection API] Error clearing run:", error);
    return NextResponse.json(
      { error: "Failed to clear pipeline result selection" },
      { status: 500 }
    );
  }
}
