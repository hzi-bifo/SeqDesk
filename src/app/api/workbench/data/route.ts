import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listWorkbenchDatasets } from "@/lib/workbench/workspaces";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session);
  if (!access.allowed) return access.response;

  return NextResponse.json({ datasets: await listWorkbenchDatasets(access.userId) });
}
