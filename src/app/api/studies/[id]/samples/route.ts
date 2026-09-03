import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { loadStudyFormSchema } from "@/lib/studies/schema";

function sampleAccess(session: Parameters<typeof decideCapability>[0]) {
  const profile = getServerDeploymentProfile();
  return {
    profile,
    access: decideCapability(session, "samples.manage", profile),
    canManageUnfilteredMetadata: decideCapability(
      session,
      "system.settings.manage",
      profile
    ).allowed,
  };
}

function deniedSampleResponse(decision: ReturnType<typeof decideCapability>) {
  return NextResponse.json(
    {
      error:
        decision.status === 404
          ? "Not found"
          : decision.status === 401
            ? "Unauthorized"
            : "Forbidden",
    },
    { status: decision.status }
  );
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

function stringifyOrNull(value: Record<string, unknown>): string | null {
  return Object.keys(value).length > 0 ? JSON.stringify(value) : null;
}

// POST assign samples to study
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { access, canManageUnfilteredMetadata } = sampleAccess(session);
    if (!access.allowed || !access.grant) return deniedSampleResponse(access);

    const { id: studyId } = await params;
    const body = await request.json();
    const { sampleIds, perSampleData } = body;

    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return NextResponse.json(
        { error: "sampleIds array is required" },
        { status: 400 }
      );
    }

    // Check study exists and ownership
    const study = await db.study.findUnique({
      where: { id: studyId },
      select: { userId: true },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    if (access.grant.scope !== "installation" && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Verify all samples exist and belong to the user
    const samples = await db.sample.findMany({
      where: {
        id: { in: sampleIds },
      },
      select: {
        id: true,
        checklistData: true,
        order: {
          select: { userId: true },
        },
      },
    });

    // Check ownership of all samples
    if (access.grant.scope !== "installation") {
      const unauthorized = samples.filter(
        (s) => s.order.userId !== session.user.id
      );
      if (unauthorized.length > 0) {
        return NextResponse.json(
          { error: "Cannot assign samples you don't own" },
          { status: 403 }
        );
      }
    }

    // Assign samples to study
    await db.sample.updateMany({
      where: {
        id: { in: sampleIds },
      },
      data: {
        studyId: studyId,
      },
    });

    // Save per-sample metadata (collection_date, geographic_location, etc.)
    if (perSampleData && typeof perSampleData === "object") {
      const schema = await loadStudyFormSchema({
        isFacilityAdmin: canManageUnfilteredMetadata,
        applyRoleFilter: true,
        applyModuleFilter: true,
        studyId,
      });
      const allowedFieldNames = new Set(schema.perSampleFields.map((field) => field.name));
      const checklistDataBySampleId = new Map(
        samples.map((sample) => [sample.id, sample.checklistData])
      );

      for (const sampleId of sampleIds) {
        const submitted = parseJsonObject(
          (perSampleData as Record<string, unknown>)[sampleId]
        );

        if (canManageUnfilteredMetadata) {
          await db.sample.update({
            where: { id: sampleId },
            data: { checklistData: stringifyOrNull(submitted) },
          });
          continue;
        }

        const merged = {
          ...parseJsonObject(checklistDataBySampleId.get(sampleId)),
        };

        // Preserve answers for fields absent from this submission: a partial
        // post or a shrunk per-study questionnaire must not wipe previously
        // captured metadata. Clearing a field is expressed as an empty value
        // (present in `submitted`), not by omission.
        for (const fieldName of allowedFieldNames) {
          if (fieldName in submitted) {
            merged[fieldName] = submitted[fieldName];
          }
        }

        await db.sample.update({
          where: { id: sampleId },
          data: { checklistData: stringifyOrNull(merged) },
        });
      }
    }

    return NextResponse.json({
      success: true,
      assignedCount: sampleIds.length,
    });
  } catch (error) {
    console.error("Error assigning samples:", error);
    return NextResponse.json(
      { error: "Failed to assign samples" },
      { status: 500 }
    );
  }
}

// PUT update samples and their metadata for a study
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { access, canManageUnfilteredMetadata } = sampleAccess(session);
    if (!access.allowed || !access.grant) return deniedSampleResponse(access);

    const { id: studyId } = await params;
    const body = await request.json();
    const { sampleIds, perSampleData } = body;

    if (!Array.isArray(sampleIds)) {
      return NextResponse.json(
        { error: "sampleIds array is required" },
        { status: 400 }
      );
    }

    // Check study exists and ownership
    const study = await db.study.findUnique({
      where: { id: studyId },
      select: { userId: true },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    if (access.grant.scope !== "installation" && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Get samples currently in this study
    const currentSamples = await db.sample.findMany({
      where: { studyId },
      select: { id: true },
    });
    const currentSampleIds = currentSamples.map((s) => s.id);

    // Determine samples to add and remove
    const samplesToAdd = sampleIds.filter(
      (id: string) => !currentSampleIds.includes(id)
    );
    const samplesToRemove = currentSampleIds.filter(
      (id) => !sampleIds.includes(id)
    );

    // Verify ownership of samples to add
    if (samplesToAdd.length > 0) {
      const newSamples = await db.sample.findMany({
        where: { id: { in: samplesToAdd } },
        include: { order: { select: { userId: true } } },
      });

      if (access.grant.scope !== "installation") {
        const unauthorized = newSamples.filter(
          (s) => s.order.userId !== session.user.id
        );
        if (unauthorized.length > 0) {
          return NextResponse.json(
            { error: "Cannot assign samples you don't own" },
            { status: 403 }
          );
        }
      }
    }

    // Remove samples that are no longer selected
    if (samplesToRemove.length > 0) {
      await db.sample.updateMany({
        where: { id: { in: samplesToRemove }, studyId },
        data: { studyId: null },
      });
    }

    // Add new samples
    if (samplesToAdd.length > 0) {
      await db.sample.updateMany({
        where: { id: { in: samplesToAdd } },
        data: { studyId },
      });
    }

    // Update per-sample metadata (checklistData)
    if (perSampleData && typeof perSampleData === "object") {
      const schema = await loadStudyFormSchema({
        isFacilityAdmin: canManageUnfilteredMetadata,
        applyRoleFilter: true,
        applyModuleFilter: true,
        studyId,
      });
      const allowedFieldNames = new Set(schema.perSampleFields.map((field) => field.name));
      const metadataSamples = await db.sample.findMany({
        where: { id: { in: sampleIds } },
        select: {
          id: true,
          checklistData: true,
        },
      });
      const checklistDataBySampleId = new Map(
        metadataSamples.map((sample) => [sample.id, sample.checklistData])
      );

      for (const sampleId of sampleIds) {
        const submitted = parseJsonObject(
          (perSampleData as Record<string, unknown>)[sampleId]
        );

        if (canManageUnfilteredMetadata) {
          await db.sample.update({
            where: { id: sampleId },
            data: { checklistData: stringifyOrNull(submitted) },
          });
          continue;
        }

        const merged = {
          ...parseJsonObject(checklistDataBySampleId.get(sampleId)),
        };

        // Preserve answers for fields absent from this submission: a partial
        // post or a shrunk per-study questionnaire must not wipe previously
        // captured metadata. Clearing a field is expressed as an empty value
        // (present in `submitted`), not by omission.
        for (const fieldName of allowedFieldNames) {
          if (fieldName in submitted) {
            merged[fieldName] = submitted[fieldName];
          }
        }

        await db.sample.update({
          where: { id: sampleId },
          data: { checklistData: stringifyOrNull(merged) },
        });
      }
    }

    return NextResponse.json({
      success: true,
      added: samplesToAdd.length,
      removed: samplesToRemove.length,
    });
  } catch (error) {
    console.error("Error updating samples:", error);
    return NextResponse.json(
      { error: "Failed to update samples" },
      { status: 500 }
    );
  }
}

// DELETE remove samples from study (unassign)
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { access } = sampleAccess(session);
    if (!access.allowed || !access.grant) return deniedSampleResponse(access);

    const { id: studyId } = await params;
    const body = await request.json();
    const { sampleIds } = body;

    if (!Array.isArray(sampleIds) || sampleIds.length === 0) {
      return NextResponse.json(
        { error: "sampleIds array is required" },
        { status: 400 }
      );
    }

    // Check study exists and ownership
    const study = await db.study.findUnique({
      where: { id: studyId },
      select: { userId: true },
    });

    if (!study) {
      return NextResponse.json({ error: "Study not found" }, { status: 404 });
    }

    if (access.grant.scope !== "installation" && study.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Unassign samples (set studyId to null)
    await db.sample.updateMany({
      where: {
        id: { in: sampleIds },
        studyId: studyId, // Only unassign samples that are in this study
      },
      data: {
        studyId: null,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error removing samples:", error);
    return NextResponse.json(
      { error: "Failed to remove samples" },
      { status: 500 }
    );
  }
}
