import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";

// GET all samples for the current user (for study assignment)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
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

    const { searchParams } = new URL(request.url);
    const unassignedOnly = searchParams.get("unassigned") === "true";
    const orderId = searchParams.get("orderId");

    const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

    const where: Record<string, unknown> = {};

    if (decision.grant.scope !== "installation") {
      where.order = { userId: session.user.id };
    } else if (demoWsUserIds) {
      where.order = { userId: { in: demoWsUserIds } };
    }

    // Filter by specific order
    if (orderId) {
      where.orderId = orderId;
    }

    // Filter to unassigned samples only
    if (unassignedOnly) {
      where.studyId = null;
    }

    const samples = await db.sample.findMany({
      where,
      select: {
        id: true,
        sampleId: true,
        sampleTitle: true,
        studyId: true,
        order: {
          select: {
            id: true,
            orderNumber: true,
            name: true,
            status: true,
            user: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        study: {
          select: {
            id: true,
            title: true,
          },
        },
        reads: {
          select: {
            id: true,
            file1: true,
            file2: true,
          },
        },
      },
      orderBy: [
        { order: { orderNumber: "desc" } },
        { sampleId: "asc" },
      ],
    });

    return NextResponse.json(samples);
  } catch (error) {
    console.error("Error fetching samples:", error);
    return NextResponse.json(
      { error: "Failed to fetch samples" },
      { status: 500 }
    );
  }
}
