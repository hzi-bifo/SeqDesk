import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { inspectSmokeArtifactZip } from "@/lib/pipelines/smoke-artifact";

export const runtime = "nodejs";

const MAX_SMOKE_ARTIFACT_BYTES = 50 * 1024 * 1024;

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = decideServerCapability(session, "system.pipelines.manage");
  if (!access.allowed) {
    return authorizationErrorResponse(access);
  }

  try {
    const formData = await request.formData();
    const file = formData.get("artifact");
    if (!(file instanceof File)) {
      return NextResponse.json(
        { error: "Smoke artifact ZIP file is required." },
        { status: 400 }
      );
    }
    if (file.size > MAX_SMOKE_ARTIFACT_BYTES) {
      return NextResponse.json(
        { error: "Smoke artifact is too large. Maximum size is 50 MB." },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const inspection = inspectSmokeArtifactZip(buffer);

    return NextResponse.json({
      success: true,
      fileName: file.name,
      ...inspection,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: "Failed to inspect smoke artifact",
        details: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 400 }
    );
  }
}
