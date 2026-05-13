import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  hideAdminActivityJob,
  listAdminActivityJobs,
} from "@/lib/admin/activity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  const { id } = await context.params;
  const hidden = await hideAdminActivityJob(id);
  if (!hidden) {
    return NextResponse.json({ error: "Activity job not found" }, { status: 404 });
  }

  return NextResponse.json({
    hidden: true,
    jobs: await listAdminActivityJobs(),
  });
}
