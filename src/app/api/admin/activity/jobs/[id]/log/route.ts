import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getAdminActivityLogExcerpt } from "@/lib/admin/activity";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.settings.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  const { id } = await context.params;
  return NextResponse.json({ id, lines: await getAdminActivityLogExcerpt(id) });
}
