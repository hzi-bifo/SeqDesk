import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createWorkbenchAnalysis,
  listWorkbenchAnalyses,
} from "@/lib/workbench/analyses";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session);
  if (!access.allowed) return access.response;

  return NextResponse.json({ analyses: await listWorkbenchAnalyses(access.userId) });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "workbench.run");
  if (!access.allowed) return access.response;

  const body = await request.json().catch(() => ({}));
  const analysis = await createWorkbenchAnalysis({
    userId: access.userId,
    name: typeof body?.name === "string" ? body.name : undefined,
    description: typeof body?.description === "string" ? body.description : null,
  });
  return NextResponse.json({ analysis }, { status: 201 });
}
