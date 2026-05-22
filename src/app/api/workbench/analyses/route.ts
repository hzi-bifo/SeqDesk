import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  createWorkbenchAnalysis,
  listWorkbenchAnalyses,
} from "@/lib/workbench/analyses";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({ analyses: await listWorkbenchAnalyses(session.user.id) });
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await request.json().catch(() => ({}));
  const analysis = await createWorkbenchAnalysis({
    userId: session.user.id,
    name: typeof body?.name === "string" ? body.name : undefined,
    description: typeof body?.description === "string" ? body.description : null,
  });
  return NextResponse.json({ analysis }, { status: 201 });
}
