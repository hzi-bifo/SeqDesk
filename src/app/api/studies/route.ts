import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET all studies for the current user
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    const studies = await db.study.findMany({
      where: isFacilityAdmin ? {} : { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        description: true,
        checklistType: true,
        submitted: true,
        submittedAt: true,
        studyAccessionId: true,
        createdAt: true,
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
            checklistData: true,
            reads: {
              select: {
                id: true,
                file1: true,
                file2: true,
              },
            },
          },
        },
        _count: {
          select: { samples: true },
        },
      },
    });

    // Transform to include samples with reads count
    const studiesWithReadCounts = studies.map((study) => {
      const samplesWithReads = study.samples.filter(
        (sample) => sample.reads.length > 0 && (sample.reads[0].file1 || sample.reads[0].file2)
      ).length;

      return {
        ...study,
        samplesWithReads,
      };
    });

    return NextResponse.json(studiesWithReadCounts);
  } catch (error) {
    console.error("Error fetching studies:", error);
    return NextResponse.json(
      { error: "Failed to fetch studies" },
      { status: 500 }
    );
  }
}

// POST create new study (standalone, not linked to an order)
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { title, description, checklistType, studyMetadata } = body;

    if (!title || title.trim() === "") {
      return NextResponse.json(
        { error: "Study title is required" },
        { status: 400 }
      );
    }

    const sanitizedChecklist = typeof checklistType === "string" ? checklistType.trim() : "";

    const study = await db.study.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        checklistType: sanitizedChecklist || null,
        userId: session.user.id,
        studyMetadata: studyMetadata !== undefined
          ? (typeof studyMetadata === "string" ? studyMetadata : JSON.stringify(studyMetadata))
          : null,
      },
    });

    return NextResponse.json(study, { status: 201 });
  } catch (error) {
    console.error("Error creating study:", error);
    return NextResponse.json(
      { error: "Failed to create study" },
      { status: 500 }
    );
  }
}
