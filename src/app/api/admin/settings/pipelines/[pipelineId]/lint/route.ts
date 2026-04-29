import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { getPackage } from "@/lib/pipelines/package-loader";
import { lintPipelineDescriptor } from "@/lib/pipelines/descriptor-linter";

export const runtime = "nodejs";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ pipelineId: string }> }
) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
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
