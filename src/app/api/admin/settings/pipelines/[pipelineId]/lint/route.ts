import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { getPackage } from "@/lib/pipelines/package-loader";
import { lintPipelineDescriptor } from "@/lib/pipelines/descriptor-linter";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pipelineId: string }> }
) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.pipelines.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  const { pipelineId } = await params;
  const pkg = getPackage(pipelineId);
  if (!pkg) {
    return NextResponse.json(
      { error: `Pipeline package not found: ${pipelineId}` },
      { status: 404 }
    );
  }

  const result = await lintPipelineDescriptor(pkg.basePath, pipelineId);
  return NextResponse.json({ result });
}
