import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadStudyFormSchema } from "@/lib/studies/schema";

function isMissingColumnError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const maybe = error as { code?: string; message?: string };
  if (maybe.code === "P2022") return true;
  const message = String(maybe.message ?? "");
  return /no such column|unknown column/i.test(message);
}

function parseJsonObject(value: unknown): Record<string, unknown> {
  if (!value) return {};
  if (typeof value === "object" && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return {};

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON and fall back to an empty object.
  }

  return {};
}

const studyUserSelect = {
  id: true,
  firstName: true,
  lastName: true,
  email: true,
} as const;

const studySampleSelect = {
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
} as const;

const studyBaseSelect = {
  id: true,
  title: true,
  alias: true,
  description: true,
  checklistType: true,
  studyMetadata: true,
  readyForSubmission: true,
  readyAt: true,
  studyAccessionId: true,
  submitted: true,
  submittedAt: true,
  testRegisteredAt: true,
  createdAt: true,
  updatedAt: true,
  userId: true,
  user: {
    select: studyUserSelect,
  },
  samples: {
    select: studySampleSelect,
    orderBy: { createdAt: "asc" as const },
  },
} as const;

async function fetchStudyWithNotes(studyId: string) {
  return db.study.findUnique({
    where: { id: studyId },
    select: {
      ...studyBaseSelect,
      notes: true,
      notesEditedAt: true,
      notesEditedById: true,
      notesEditedBy: {
        select: studyUserSelect,
      },
    },
  });
}

async function fetchStudyWithoutNotes(studyId: string) {
  return db.study.findUnique({
    where: { id: studyId },
    select: studyBaseSelect,
  });
}

async function resolveStudyId(idOrAliasOrOrderId: string): Promise<string | null> {
  const byId = await db.study.findUnique({
    where: { id: idOrAliasOrOrderId },
    select: { id: true },
  });
  if (byId) {
    return byId.id;
  }

  try {
    const byAlias = await db.study.findFirst({
      where: { alias: idOrAliasOrOrderId },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (byAlias) {
      return byAlias.id;
    }
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
  }

  try {
    const byOrderRelation = await db.study.findFirst({
      where: {
        samples: {
          some: {
            orderId: idOrAliasOrOrderId,
          },
        },
      },
      select: { id: true },
      orderBy: { createdAt: "desc" },
    });
    if (byOrderRelation) {
      return byOrderRelation.id;
    }
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
  }

  return null;
}

async function getStudyWithResolvedOrders(idOrAliasOrOrderId: string) {
  const resolvedStudyId = await resolveStudyId(idOrAliasOrOrderId);
  if (!resolvedStudyId) {
    return null;
  }

  let notesSupported = true;
  let study:
    | NonNullable<Awaited<ReturnType<typeof fetchStudyWithNotes>>>
    | NonNullable<Awaited<ReturnType<typeof fetchStudyWithoutNotes>>>
    | null;

  try {
    study = await fetchStudyWithNotes(resolvedStudyId);
  } catch (error) {
    if (!isMissingColumnError(error)) {
      throw error;
    }
    notesSupported = false;
    study = await fetchStudyWithoutNotes(resolvedStudyId);
  }

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

  const notes = "notes" in study ? study.notes ?? null : null;
  const notesEditedAt = "notesEditedAt" in study ? study.notesEditedAt ?? null : null;
  const notesEditedById = "notesEditedById" in study ? study.notesEditedById ?? null : null;
  const notesEditedBy = "notesEditedBy" in study ? study.notesEditedBy ?? null : null;

  return {
    ...study,
    notes,
    notesEditedAt,
    notesEditedById,
    notesEditedBy,
    notesSupported,
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
    const resolvedStudyId = await resolveStudyId(id);
    if (!resolvedStudyId) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    const body = await request.json();
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    }

    const { title, description, alias, checklistType, studyMetadata, readyForSubmission, notes } = body as {
      title?: unknown;
      description?: unknown;
      alias?: unknown;
      checklistType?: unknown;
      studyMetadata?: unknown;
      readyForSubmission?: unknown;
      notes?: unknown;
    };

    if (title !== undefined && typeof title !== "string") {
      return NextResponse.json({ error: "Title must be a string" }, { status: 400 });
    }
    if (description !== undefined && description !== null && typeof description !== "string") {
      return NextResponse.json({ error: "Description must be a string or null" }, { status: 400 });
    }
    if (alias !== undefined && alias !== null && typeof alias !== "string") {
      return NextResponse.json({ error: "Alias must be a string or null" }, { status: 400 });
    }
    if (checklistType !== undefined && checklistType !== null && typeof checklistType !== "string") {
      return NextResponse.json({ error: "Checklist type must be a string or null" }, { status: 400 });
    }
    if (readyForSubmission !== undefined && typeof readyForSubmission !== "boolean") {
      return NextResponse.json({ error: "readyForSubmission must be a boolean" }, { status: 400 });
    }
    if (notes !== undefined && notes !== null && typeof notes !== "string") {
      return NextResponse.json({ error: "Notes must be a string or null" }, { status: 400 });
    }

    // Check study exists and ownership
    const existing = await db.study.findUnique({
      where: { id: resolvedStudyId },
      select: { userId: true, studyMetadata: true },
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

    if (typeof title === "string") updateData.title = title.trim() || undefined;
    if (description !== undefined) updateData.description = typeof description === "string" ? description.trim() || null : null;
    if (alias !== undefined) updateData.alias = typeof alias === "string" ? alias.trim() || null : null;
    if (checklistType !== undefined) updateData.checklistType = checklistType;
    if (studyMetadata !== undefined) {
      if (isFacilityAdmin) {
        updateData.studyMetadata =
          typeof studyMetadata === "string"
            ? studyMetadata
            : JSON.stringify(studyMetadata);
      } else {
        const schema = await loadStudyFormSchema({
          isFacilityAdmin: false,
          applyRoleFilter: true,
          applyModuleFilter: true,
        });
        const allowedFieldNames = new Set(schema.studyFields.map((field) => field.name));
        const currentMetadata = parseJsonObject(existing.studyMetadata);
        const submittedMetadata = parseJsonObject(studyMetadata);
        const mergedMetadata = { ...currentMetadata };

        for (const fieldName of allowedFieldNames) {
          if (fieldName in submittedMetadata) {
            mergedMetadata[fieldName] = submittedMetadata[fieldName];
          } else {
            delete mergedMetadata[fieldName];
          }
        }

        updateData.studyMetadata = JSON.stringify(mergedMetadata);
      }
    }
    if (readyForSubmission !== undefined) {
      updateData.readyForSubmission = readyForSubmission;
      if (readyForSubmission) {
        updateData.readyAt = new Date();
      } else {
        updateData.readyAt = null;
      }
    }
    if (notes !== undefined) {
      updateData.notes = notes;
      updateData.notesEditedAt = new Date();
      updateData.notesEditedById = session.user.id;
    }

    try {
      await db.study.update({
        where: { id: resolvedStudyId },
        data: updateData,
      });
    } catch (error) {
      if (!isMissingColumnError(error)) {
        throw error;
      }

      const hadNotesFields =
        "notes" in updateData ||
        "notesEditedAt" in updateData ||
        "notesEditedById" in updateData;

      if (!hadNotesFields) {
        throw error;
      }

      const updateDataWithoutNotes: Record<string, unknown> = { ...updateData };
      delete updateDataWithoutNotes.notes;
      delete updateDataWithoutNotes.notesEditedAt;
      delete updateDataWithoutNotes.notesEditedById;

      if (Object.keys(updateDataWithoutNotes).length > 0) {
        await db.study.update({
          where: { id: resolvedStudyId },
          data: updateDataWithoutNotes,
        });
      }
    }

    const study = await getStudyWithResolvedOrders(resolvedStudyId);
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
    const resolvedStudyId = await resolveStudyId(id);
    if (!resolvedStudyId) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    // Check study exists and ownership
    const existing = await db.study.findUnique({
      where: { id: resolvedStudyId },
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
      where: { studyId: resolvedStudyId },
      data: { studyId: null },
    });

    // Delete the study
    await db.study.delete({ where: { id: resolvedStudyId } });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting study:", error);
    return NextResponse.json(
      { error: "Failed to delete study" },
      { status: 500 }
    );
  }
}
