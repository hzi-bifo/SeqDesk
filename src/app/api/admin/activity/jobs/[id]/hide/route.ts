import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
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
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
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
