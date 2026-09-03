import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { isActiveSession } from "@/lib/auth-session";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";
import { getActiveMixsConfig } from "@/lib/mixs/config";

// GET all studies for the current user
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const deploymentProfile = getServerDeploymentProfile();
    const readAll = decideCapability(session, "studies.read_all", deploymentProfile);
    const readOwn = decideCapability(session, "studies.read", deploymentProfile);
    const readGrant = readAll.allowed ? readAll.grant : readOwn.grant;
    if (!readGrant) {
      const status = readOwn.status;
      return NextResponse.json(
        {
          error:
            status === 404
              ? "Not found"
              : status === 401
                ? "Unauthorized"
                : "Forbidden",
        },
        { status }
      );
    }
    const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

    const studies = await db.study.findMany({
      where:
        readGrant.scope === "installation"
          ? demoWsUserIds
            ? { userId: { in: demoWsUserIds } }
            : {}
          : { userId: session.user.id },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        alias: true,
        title: true,
        description: true,
        checklistType: true,
        submitted: true,
        readyForSubmission: true,
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

    if (!isActiveSession(session)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const decision = decideCapability(
      session,
      "studies.create",
      getServerDeploymentProfile()
    );
    if (!decision.allowed) {
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

    const body = await request.json();
    const generatedByE2E = request.headers.get("x-seqdesk-e2e") === "playwright";
    const { title, description, checklistType, studyMetadata } = body;

    if (!title || title.trim() === "") {
      return NextResponse.json(
        { error: "Study title is required" },
        { status: 400 }
      );
    }

    const sanitizedChecklist = typeof checklistType === "string" ? checklistType.trim() : "";

    // Pin the study to the MIxS checklist version it is authored against, so a
    // later registry update never retroactively changes its fields. Only
    // stamped when the study actually uses a MIxS checklist.
    let mixsVersion: number | null = null;
    if (sanitizedChecklist) {
      try {
        mixsVersion = (await getActiveMixsConfig(db)).version;
      } catch (error) {
        console.error("Could not resolve active MIxS version for study:", error);
      }
    }

    const study = await db.study.create({
      data: {
        title: title.trim(),
        description: description?.trim() || null,
        checklistType: sanitizedChecklist || null,
        mixsVersion,
        userId: session.user.id,
        generatedByE2E,
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
