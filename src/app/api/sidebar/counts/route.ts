import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";

// GET /api/sidebar/counts - Get counts for sidebar badges
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    const userId = session.user.id;
    const isDemoUser = session.user.isDemo;

    // Get counts based on user role
    const [ordersCount, studiesCount, filesCount, submissionsCount, analysisCount] = await Promise.all([
      // Orders count
      db.order.count({
        where: isFacilityAdmin ? {} : { userId },
      }),
      // Studies count
      db.study.count({
        where: isFacilityAdmin ? {} : { userId },
      }),
      // Files count (sequencing files) - admin only
      isFacilityAdmin
        ? db.read.count()
        : Promise.resolve(0),
      // Submissions count - admin only
      isFacilityAdmin
        ? db.submission.count()
        : Promise.resolve(0),
      // Analysis runs count (running or queued)
      isDemoUser
        ? Promise.resolve(0)
        : db.pipelineRun.count({
            where: {
              status: { in: ['pending', 'queued', 'running'] },
              ...(isFacilityAdmin ? {} : { study: { userId } }),
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
