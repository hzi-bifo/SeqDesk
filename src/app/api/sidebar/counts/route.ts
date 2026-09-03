import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getDemoFacilityWorkspaceUserIds } from "@/lib/demo/server";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

// GET /api/sidebar/counts - Get counts for sidebar badges
export async function GET() {
  const session = await getServerSession(authOptions);
  const ordersAccess = decideServerCapability(session, "orders.read");
  if (!ordersAccess.allowed) {
    return authorizationErrorResponse(ordersAccess);
  }

  try {
    const userId = ordersAccess.principal!.id;
    const isDemoUser = ordersAccess.principal?.isDemo;
    const canReadAllOrders = decideServerCapability(
      session,
      "orders.read_all"
    ).allowed;
    const canReadAllStudies = decideServerCapability(
      session,
      "studies.read_all"
    ).allowed;
    const canManageSequencingFiles = decideServerCapability(
      session,
      "sequencing.files.manage"
    ).allowed;
    const canSubmit = decideServerCapability(session, "publishing.submit").allowed;
    const canReadAllAnalysis = decideServerCapability(
      session,
      "analysis.read_all"
    ).allowed;
    const canReadOwnAnalysis = decideServerCapability(
      session,
      "analysis.read_own"
    ).allowed;
    const demoWsUserIds = await getDemoFacilityWorkspaceUserIds(session);

    const [ordersCount, studiesCount, filesCount, submissionsCount, analysisCount] = await Promise.all([
      // Orders count
      db.order.count({
        where: canReadAllOrders
          ? (demoWsUserIds ? { userId: { in: demoWsUserIds } } : {})
          : { userId },
      }),
      // Studies count
      db.study.count({
        where: canReadAllStudies
          ? (demoWsUserIds ? { userId: { in: demoWsUserIds } } : {})
          : { userId },
      }),
      // Files count is visible to sequencing operators, including Shared Lab members.
      canManageSequencingFiles
        ? db.read.count(demoWsUserIds ? { where: { sample: { order: { userId: { in: demoWsUserIds } } } } } : undefined)
        : Promise.resolve(0),
      // Submission visibility follows publishing authority rather than account type.
      canSubmit
        ? (demoWsUserIds ? 0 : db.submission.count())
        : Promise.resolve(0),
      // Analysis runs count (running or queued)
      isDemoUser || !canReadOwnAnalysis
        ? Promise.resolve(0)
        : db.pipelineRun.count({
            where: {
              status: { in: ['pending', 'queued', 'running'] },
              ...(canReadAllAnalysis ? {} : { study: { userId } }),
            },
          }),
    ]);

    return NextResponse.json({
      orders: ordersCount,
      studies: studiesCount,
      files: filesCount,
      submissions: submissionsCount,
      analysis: analysisCount,
    });
  } catch (error) {
    console.error("Error fetching sidebar counts:", error);
    return NextResponse.json(
      { error: "Failed to fetch counts" },
      { status: 500 }
    );
  }
}
