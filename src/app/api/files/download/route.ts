import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { safeJoin, hasAllowedExtension } from "@/lib/files/paths";
import { getSequencingFilesConfig } from "@/lib/files/sequencing-config";
import { isDemoSession } from "@/lib/demo/server";
import * as fs from "fs";
import * as path from "path";
import { Readable } from "stream";

const ALLOWED_ASSEMBLY_EXTENSIONS = [
  ".fa",
  ".fasta",
  ".fna",
  ".fa.gz",
  ".fasta.gz",
  ".fna.gz",
  ".contigs.fa",
  ".contigs.fa.gz",
];

export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (isDemoSession(session)) {
      return NextResponse.json(
        { error: "Downloads are disabled in the public demo." },
        { status: 403 }
      );
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

    const [readRecord, assemblyRecord] = await Promise.all([
      db.read.findFirst({
        where: {
          OR: [{ file1: filePath }, { file2: filePath }],
        },
        select: {
          sample: {
            select: {
              order: {
                select: {
                  userId: true,
                  status: true,
                },
              },
              study: {
                select: {
                  userId: true,
                },
              },
            },
          },
        },
      }),
      db.assembly.findFirst({
        where: {
          assemblyFile: filePath,
        },
        select: {
          sample: {
            select: {
              order: {
                select: {
                  userId: true,
                  status: true,
                },
              },
              study: {
                select: {
                  userId: true,
                },
              },
            },
          },
        },
      }),
    ]);

    const isRegisteredAssemblyFile = Boolean(assemblyRecord);
    const hasValidExtension = isRegisteredAssemblyFile
      ? hasAllowedExtension(filePath, ALLOWED_ASSEMBLY_EXTENSIONS)
      : hasAllowedExtension(filePath, config.allowedExtensions);

    if (!hasValidExtension) {
      return NextResponse.json(
        { error: "File type not allowed" },
        { status: 400 }
      );
    }

    // Permission check
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";
    const siteSettings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true },
    });
    let extraSettings: Record<string, unknown> = {};
    if (siteSettings?.extraSettings) {
      try {
        extraSettings = JSON.parse(siteSettings.extraSettings);
      } catch {
        extraSettings = {};
      }
    }
    const allowUserAssemblyDownload =
      extraSettings.allowUserAssemblyDownload === true;

    if (!isFacilityAdmin) {
      if (assemblyRecord && !allowUserAssemblyDownload) {
        return NextResponse.json(
          { error: "Assembly downloads are disabled by the facility administrator." },
          { status: 403 }
        );
      }

      const hasReadAccess = Boolean(
        readRecord &&
          readRecord.sample.order.userId === session.user.id &&
          readRecord.sample.order.status === "COMPLETED"
      );
      const hasAssemblyAccess = Boolean(
        assemblyRecord &&
          allowUserAssemblyDownload &&
          (assemblyRecord.sample.order.userId === session.user.id ||
            assemblyRecord.sample.study?.userId === session.user.id) &&
          assemblyRecord.sample.order.status === "COMPLETED"
      );

      if (!hasReadAccess && !hasAssemblyAccess) {
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
