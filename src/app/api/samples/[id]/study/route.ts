import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

// DELETE - unassign sample from its study
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);
    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decision = decideCapability(
      session,
      "samples.manage",
      getServerDeploymentProfile()
    );
    if (!decision.allowed || !decision.grant) {
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

    const { id: sampleId } = await params;

    // Get the sample with its order
    const sample = await db.sample.findUnique({
      where: { id: sampleId },
      include: {
        order: {
          select: { userId: true },
        },
      },
    });

    if (!sample || !sample.order) {
      return NextResponse.json({ error: "Sample not found" }, { status: 404 });
    }

    if (decision.grant.scope !== "installation" && sample.order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Unassign from study
    await db.sample.update({
      where: { id: sampleId },
      data: { studyId: null },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unassigning sample:", error);
    return NextResponse.json(
      { error: "Failed to unassign sample" },
      { status: 500 }
    );
  }
}
