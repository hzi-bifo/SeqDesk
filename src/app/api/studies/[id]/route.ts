import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2022") return true;
  const message = String(maybe.message ?? "");
  return /no such column|unknown column/i.test(message);
}

async function getStudyWithResolvedOrders(id: string) {
  const study = await db.study.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      alias: true,
      description: true,
      checklistType: true,
      studyMetadata: true,
      readyForSubmission: true,
      readyAt: true,
      submitted: true,
      submittedAt: true,
      testRegisteredAt: true,
      createdAt: true,
      updatedAt: true,
      userId: true,
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
      samples: {
        select: {
          id: true,
          sampleId: true,
          sampleAlias: true,
          sampleTitle: true,
          sampleAccessionNumber: true,
          taxId: true,
          scientificName: true,
          checklistData: true,
          customFields: true,
          orderId: true,
          reads: true,
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!study) {
    return null;
  }

  const sampleIds = study.samples.map((sample) => sample.id);

  const preferredAssemblyBySample = new Map<string, string | null>();
  if (sampleIds.length > 0) {
    try {
      const samplePreferenceRows = await db.sample.findMany({
        where: { id: { in: sampleIds } },
        select: {
          id: true,
          preferredAssemblyId: true,
        },
      });
      for (const row of samplePreferenceRows) {
        preferredAssemblyBySample.set(row.id, row.preferredAssemblyId ?? null);
      }
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }
    }
  }

  const assembliesBySample = new Map<
    string,
    Array<{
      id: string;
      assemblyName: string | null;
      assemblyFile: string | null;
      createdByPipelineRunId: string | null;
      createdByPipelineRun: {
        id: string;
        runNumber: string;
        status: string;
        createdAt: Date;
        completedAt: Date | null;
      } | null;
    }>
  >();

  for (const sampleId of sampleIds) {
    assembliesBySample.set(sampleId, []);
  }

  if (sampleIds.length > 0) {
    try {
      const assemblies = await db.assembly.findMany({
        where: { sampleId: { in: sampleIds } },
        select: {
          id: true,
          sampleId: true,
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
      });

      for (const assembly of assemblies) {
        const list = assembliesBySample.get(assembly.sampleId) ?? [];
        list.push({
          id: assembly.id,
          assemblyName: assembly.assemblyName ?? null,
          assemblyFile: assembly.assemblyFile ?? null,
          createdByPipelineRunId: assembly.createdByPipelineRunId ?? null,
          createdByPipelineRun: assembly.createdByPipelineRun
            ? {
                id: assembly.createdByPipelineRun.id,
                runNumber: assembly.createdByPipelineRun.runNumber,
                status: assembly.createdByPipelineRun.status,
                createdAt: assembly.createdByPipelineRun.createdAt,
                completedAt: assembly.createdByPipelineRun.completedAt,
              }
            : null,
        });
        assembliesBySample.set(assembly.sampleId, list);
      }
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }

      try {
        const assemblies = await db.assembly.findMany({
          where: { sampleId: { in: sampleIds } },
          select: {
            id: true,
            sampleId: true,
            assemblyName: true,
            assemblyFile: true,
          },
        });
        for (const assembly of assemblies) {
          const list = assembliesBySample.get(assembly.sampleId) ?? [];
          list.push({
            id: assembly.id,
            assemblyName: assembly.assemblyName ?? null,
            assemblyFile: assembly.assemblyFile ?? null,
            createdByPipelineRunId: null,
            createdByPipelineRun: null,
          });
          assembliesBySample.set(assembly.sampleId, list);
        }
      } catch (fallbackError) {
        if (!isMissingColumnError(fallbackError)) {
          throw fallbackError;
        }
      }
    }
  }

  const orderIds = Array.from(
    new Set(
      study.samples
        .map((sample) => sample.orderId)
        .filter((orderId): orderId is string => typeof orderId === "string" && orderId.length > 0)
    )
  );

  const orders = orderIds.length
    ? await db.order.findMany({
        where: {
          id: {
            in: orderIds,
          },
        },
        select: {
          id: true,
          orderNumber: true,
          name: true,
          status: true,
        },
      })
    : [];

  const orderById = new Map(orders.map((order) => [order.id, order]));

  return {
    ...study,
    user:
      study.user ??
      ({
        id: study.userId,
        firstName: null,
        lastName: null,
        email: "",
      } as const),
    samples: study.samples.map((sample) => ({
      ...sample,
      preferredAssemblyId: preferredAssemblyBySample.get(sample.id) ?? null,
      assemblies: assembliesBySample.get(sample.id) ?? [],
      order: orderById.get(sample.orderId) ?? null,
    })),
  };
}

// GET single study with samples
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    const study = await getStudyWithResolvedOrders(id);

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    // Check ownership (unless facility admin)
    if (!isFacilityAdmin && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    return NextResponse.json(study);
  } catch (error) {
    console.error("Error fetching study:", error);
    return NextResponse.json(
      { error: "Failed to fetch study" },
      { status: 500 }
    );
  }
}

// PUT update study
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const { title, description, alias, checklistType, studyMetadata, readyForSubmission } = body;

    // Check study exists and ownership
    const existing = await db.study.findUnique({
      where: { id },
      select: { userId: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};

    if (title !== undefined) updateData.title = title?.trim() || undefined;
    if (description !== undefined) updateData.description = description?.trim() || null;
    if (alias !== undefined) updateData.alias = alias?.trim() || null;
    if (checklistType !== undefined) updateData.checklistType = checklistType;
    if (studyMetadata !== undefined) {
      updateData.studyMetadata = typeof studyMetadata === 'string'
        ? studyMetadata
        : JSON.stringify(studyMetadata);
    }
    if (readyForSubmission !== undefined) {
      updateData.readyForSubmission = readyForSubmission;
      if (readyForSubmission) {
        updateData.readyAt = new Date();
      } else {
        updateData.readyAt = null;
      }
    }

    await db.study.update({
      where: { id },
      data: updateData,
    });

    const study = await getStudyWithResolvedOrders(id);
    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    return NextResponse.json(study);
  } catch (error) {
    console.error("Error updating study:", error);
    return NextResponse.json(
      { error: "Failed to update study" },
      { status: 500 }
    );
  }
}

// DELETE study
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;

    // Check study exists and ownership
    const existing = await db.study.findUnique({
      where: { id },
      select: { userId: true, submitted: true },
    });

    if (!existing) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    if (!isFacilityAdmin && existing.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Prevent deletion of submitted studies
    if (existing.submitted) {
      return NextResponse.json(
        { error: "Cannot delete a submitted study" },
        { status: 400 }
      );
    }

    // Unassign all samples from this study (set studyId to null)
    await db.sample.updateMany({
      where: { studyId: id },
      data: { studyId: null },
    });

    // Delete the study
    await db.study.delete({ where: { id } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting study:", error);
    return NextResponse.json(
      { error: "Failed to delete study" },
      { status: 500 }
    );
  }
}
