import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { safeJoin, hasAllowedExtension } from "@/lib/files/paths";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const filePath = request.nextUrl.searchParams.get("path");
    if (!filePath) {
      return NextResponse.json(
        { error: "Missing path parameter" },
        { status: 400 }
      );
    }

    const { dataBasePath, config } = await getSequencingFilesConfig();

    if (!dataBasePath) {
      return NextResponse.json(
        { error: "Data base path not configured" },
        { status: 400 }
      );
    }

    // Validate path safety (rejects absolute paths and traversal)
    let absolutePath: string;
    try {
      absolutePath = safeJoin(dataBasePath, filePath);
    } catch {
      return NextResponse.json(
        { error: "Invalid file path" },
        { status: 400 }
      );
    }

    // Validate file extension
    if (!hasAllowedExtension(filePath, config.allowedExtensions)) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 400 }
      );
    }

    // Permission check
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    if (!isFacilityAdmin) {
      // Researcher: verify the file belongs to one of their COMPLETED orders
      const read = await db.read.findFirst({
        where: {
          OR: [{ file1: filePath }, { file2: filePath }],
          sample: {
            order: {
              userId: session.user.id,
              status: "COMPLETED",
            },
          },
        },
      });

      if (!read) {
        return NextResponse.json(
          { error: "Access denied" },
          { status: 403 }
        );
      }
    }

    // Check file exists and get size
    let stat: fs.Stats;
    try {
      stat = fs.statSync(absolutePath);
    } catch {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    if (!stat.isFile()) {
      return NextResponse.json(
        { error: "Not a file" },
        { status: 400 }
      );
    }

    // Stream the file
    const fileStream = fs.createReadStream(absolutePath);
    const webStream = Readable.toWeb(fileStream) as ReadableStream;
    const filename = path.basename(absolutePath);

    return new Response(webStream, {
      headers: {
        "Content-Type": "application/octet-stream",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Content-Length": String(stat.size),
      },
    });
  } catch (error) {
    console.error("Error downloading file:", error);
    return NextResponse.json(
      { error: "Failed to download file" },
      { status: 500 }
    );
  }
}
