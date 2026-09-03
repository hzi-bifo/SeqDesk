import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { getWorkerSpec } from "@/lib/workers/registry";
import { setWorkerPaused } from "@/lib/workers/pause";

export async function POST(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.pipelines.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }
  const { name } = await params;
  const spec = getWorkerSpec(name);
  if (!spec) return NextResponse.json({ error: `Unknown worker: ${name}` }, { status: 404 });
  if (!spec.supportsPause) {
    return NextResponse.json({ error: `${name} does not support pause` }, { status: 400 });
  }
  await setWorkerPaused(name, true);
  return NextResponse.json({ ok: true });
}
