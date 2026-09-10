import { NextRequest, NextResponse } from "next/server";
import { ExploreAuthorizationError, requireTargetAccess, resolveTargetAccess } from "@/lib/explore/authorization";
import { FileLibraryError, listLibraryFiles, storeLibraryFile } from "@/lib/files/library";
import { MAX_LIBRARY_FILE_BYTES } from "@/lib/files/library-types";
import { fileErrorResponse, requireFileSession } from "./_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const session = await requireFileSession();
    const targetKey = request.nextUrl.searchParams.get("targetKey") ?? "";
    const access = await resolveTargetAccess(session, targetKey);
    if (!access.target || access.level === "none") throw new ExploreAuthorizationError(404, "Not found");
    return NextResponse.json({ files: await listLibraryFiles(targetKey), canEdit: access.level === "write" && !session.user.isDemo });
  } catch (error) { return fileErrorResponse(error); }
}

export async function POST(request: NextRequest) {
  try {
    const session = await requireFileSession(true);
    if (Number(request.headers.get("content-length")) > MAX_LIBRARY_FILE_BYTES + 1024 * 1024) throw new FileLibraryError(413, "Files must be 100 MB or smaller.");
    const form = await request.formData();
    const targetKey = String(form.get("targetKey") ?? "");
    await requireTargetAccess(session, targetKey, "write");
    const file = form.get("file");
    if (!(file instanceof File)) throw new FileLibraryError(400, "Choose a file to upload.");
    const stored = await storeLibraryFile({ file, targetKey, createdById: session.user.id });
    return NextResponse.json({ file: { id: stored.id, originalName: stored.originalName } }, { status: 201 });
  } catch (error) { return fileErrorResponse(error); }
}
