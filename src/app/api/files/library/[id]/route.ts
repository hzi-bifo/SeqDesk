import { NextRequest, NextResponse } from "next/server";
import { listLibraryFiles, readLibraryFile } from "@/lib/files/library";
import { fileErrorResponse, loadAccessibleFile } from "../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    const file = await loadAccessibleFile(id);
    if (request.nextUrl.searchParams.get("download") === "1") {
      const bytes = await readLibraryFile(file);
      return new NextResponse(new Uint8Array(bytes), { headers: {
        "Content-Type": "application/octet-stream",
        "Content-Length": String(bytes.length),
        "Content-Disposition": `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
        "X-Content-Type-Options": "nosniff",
        "Cache-Control": "private, no-store",
      } });
    }
    const files = await listLibraryFiles(file.targetKey);
    return NextResponse.json({ file: files.find((entry) => entry.id === id) });
  } catch (error) { return fileErrorResponse(error); }
}
