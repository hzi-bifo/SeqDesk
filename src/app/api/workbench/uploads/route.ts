import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";

import { authOptions } from "@/lib/auth";
import { authorizeWorkbenchRequest } from "@/lib/workbench/server";
import {
  storeWorkbenchUpload,
  WorkbenchUploadError,
} from "@/lib/workbench/uploads";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  const access = authorizeWorkbenchRequest(session, "workbench.import");
  if (!access.allowed) return access.response;

  const filename = request.headers.get("x-seqdesk-filename") || "";
  const contentLengthHeader = request.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : null;
  if (!request.body) {
    return NextResponse.json({ error: "Upload body is required" }, { status: 400 });
  }

  try {
    const dataset = await storeWorkbenchUpload({
      userId: access.userId,
      filename,
      contentType: request.headers.get("content-type"),
      contentLength: Number.isFinite(contentLength) ? contentLength : null,
      body: request.body,
    });
    return NextResponse.json({ dataset }, { status: 201 });
  } catch (error) {
    if (error instanceof WorkbenchUploadError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to upload Workbench data:", error);
    return NextResponse.json(
      { error: "Failed to upload Workbench data" },
      { status: 500 }
    );
  }
}
