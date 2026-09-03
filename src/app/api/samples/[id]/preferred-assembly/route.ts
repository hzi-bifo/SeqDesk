import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const access = decideCapability(
      session,
      "samples.manage",
      getServerDeploymentProfile()
    );
    if (!access.allowed || !access.grant || !access.principal) {
      return NextResponse.json(
        {
          error:
            access.status === 404
              ? "Not found"
              : access.status === 401
                ? "Unauthorized"
                : "Forbidden",
        },
        { status: access.status }
      );
    }

    const { id: sampleId } = await params;
    const body = await request.json();

    const studyId =
      typeof body.studyId === "string" && body.studyId.trim().length > 0
        ? body.studyId.trim()
        : null;
    const rawAssemblyId = body.assemblyId;
    const assemblyId =
      rawAssemblyId === null || rawAssemblyId === undefined || rawAssemblyId === ""
        ? null
        : typeof rawAssemblyId === "string"
          ? rawAssemblyId
          : undefined;

    if (assemblyId === undefined) {
      return NextResponse.json(
        { error: "assemblyId must be a string or null" },
        { status: 400 }
      );
    }

    const sample = await db.sample.findUnique({
      where: { id: sampleId },
      select: {
        id: true,
        sampleId: true,
        studyId: true,
        order: {
          select: {
            userId: true,
          },
        },
        study: {
          select: {
            id: true,
            userId: true,
          },
        },
        assemblies: {
          select: {
            id: true,
            assemblyName: true,
            assemblyFile: true,
            createdByPipelineRunId: true,
            createdByPipelineRun: {
              select: {
                id: true,
                runNumber: true,
                status: true,
                createdAt: true,
                completedAt: true,
              },
            },
          },
        },
      },
    });

    if (!sample) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }

    const ownsSample =
      sample.order.userId === access.principal.id ||
      sample.study?.userId === access.principal.id;

    if (access.grant.scope !== "installation" && !ownsSample) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    if (studyId && sample.studyId !== studyId) {
      return NextResponse.json(
        { error: "Sample is not assigned to the requested study" },
        { status: 400 }
      );
    }

    let selectedAssembly:
      | (typeof sample.assemblies)[number]
      | null = null;

    if (assemblyId) {
      selectedAssembly = sample.assemblies.find((assembly) => assembly.id === assemblyId) || null;
      if (!selectedAssembly) {
        return NextResponse.json(
          { error: "Assembly not found for this sample" },
          { status: 400 }
        );
      }

      if (!selectedAssembly.assemblyFile) {
        return NextResponse.json(
          { error: "Cannot select an assembly without a file path" },
          { status: 400 }
        );
      }
    }

    const updatedSample = await db.sample.update({
      where: { id: sampleId },
      data: { preferredAssemblyId: assemblyId },
      select: {
        id: true,
        preferredAssemblyId: true,
      },
    });

    return NextResponse.json({
      success: true,
      sampleId: updatedSample.id,
      preferredAssemblyId: updatedSample.preferredAssemblyId,
      preferredAssembly: selectedAssembly,
    });
  } catch (error) {
    console.error("Error updating sample preferred assembly:", error);
    return NextResponse.json(
      { error: "Failed to update preferred assembly" },
      { status: 500 }
    );
  }
}
