import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listAdminActivityJobs } from "@/lib/admin/activity";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }
  if (access.principal?.isDemo) {
    return NextResponse.json({ jobs: [] });
  }

  return NextResponse.json({ jobs: await listAdminActivityJobs() });
}
