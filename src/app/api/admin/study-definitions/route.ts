import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { seedStudyFormConfig } from "@/lib/studies/per-study-config";

// GET - list studies for the admin "Define Studies" surface, with sample counts
// and whether each study has its own questionnaire (StudyFormConfig).
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const studies = await db.study.findMany({
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        title: true,
        alias: true,
        checklistType: true,
        submitted: true,
        createdAt: true,
        user: { select: { firstName: true, lastName: true, email: true } },
        _count: { select: { samples: true } },
        studyFormConfig: { select: { id: true } },
      },
    });

    return NextResponse.json(
      studies.map(({ studyFormConfig, ...study }) => ({
        ...study,
        sampleCount: study._count.samples,
        hasFormConfig: studyFormConfig !== null,
      }))
    );
  } catch (error) {
    console.error("Error listing study definitions:", error);
    return NextResponse.json(
      { error: "Failed to list studies" },
      { status: 500 }
    );
  }
}

// POST - create a new study and seed its questionnaire (blank or cloned).
export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { title, seedMode, cloneFromStudyId } = body as {
      title?: string;
      seedMode?: "blank" | "clone";
      cloneFromStudyId?: string;
    };

    if (!title || title.trim() === "") {
      return NextResponse.json(
        { error: "Study title is required" },
        { status: 400 }
      );
    }

    const study = await db.study.create({
      data: { title: title.trim(), userId: session.user.id },
    });

    const seed =
      seedMode === "clone" && cloneFromStudyId
        ? ({ mode: "clone", sourceStudyId: cloneFromStudyId } as const)
        : ({ mode: "blank" } as const);
    await seedStudyFormConfig(study.id, seed);

    return NextResponse.json(study, { status: 201 });
  } catch (error) {
    console.error("Error creating study definition:", error);
    return NextResponse.json(
      { error: "Failed to create study" },
      { status: 500 }
    );
  }
}
