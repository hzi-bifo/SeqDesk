import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET all samples for the current user (for study assignment)
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const unassignedOnly = searchParams.get("unassigned") === "true";
    const orderId = searchParams.get("orderId");

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    const where: Record<string, unknown> = {};

    // Filter by user ownership (unless facility admin)
    if (!isFacilityAdmin) {
      where.order = { userId: session.user.id };
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
