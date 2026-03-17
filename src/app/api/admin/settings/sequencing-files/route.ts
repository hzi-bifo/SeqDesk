import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";

export interface SequencingFilesConfig {
  allowedExtensions: string[];
  scanDepth: number;
  ignorePatterns: string[];
  allowSingleEnd: boolean;
  autoAssign: boolean;
  simulationMode: "auto" | "synthetic" | "template";
  simulationTemplateDir: string;
}

const DEFAULT_CONFIG: SequencingFilesConfig = {
  allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
  scanDepth: 2,
  ignorePatterns: ["**/tmp/**", "**/undetermined/**"],
  allowSingleEnd: true,
  autoAssign: false,
  simulationMode: "auto",
  simulationTemplateDir: "",
};

// GET - retrieve sequencing files settings
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true, extraSettings: true },
    });

    let config: SequencingFilesConfig = { ...DEFAULT_CONFIG };
    if (settings?.extraSettings) {
      try {
        const extra = JSON.parse(settings.extraSettings);
        if (extra.sequencingFiles) {
          config = {
            ...DEFAULT_CONFIG,
            ...extra.sequencingFiles,
            allowSingleEnd: true,
          };
        }
      } catch {
        // ignore parse errors
      }
    }

    const resolvedDataBasePath = resolveDataBasePathFromStoredValue(settings?.dataBasePath);

    return NextResponse.json({
      dataBasePath: resolvedDataBasePath.dataBasePath || "",
      configuredDataBasePath: settings?.dataBasePath || "",
      dataBasePathSource: resolvedDataBasePath.source,
      dataBasePathIsImplicit: resolvedDataBasePath.isImplicit,
      config,
    });
  } catch {
    return NextResponse.json({
      dataBasePath: "",
      configuredDataBasePath: "",
      dataBasePathSource: "none",
      dataBasePathIsImplicit: false,
      config: DEFAULT_CONFIG,
    });
  }
}

// PUT - update sequencing files settings
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { dataBasePath, config } = body;

    // Get current settings
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    let extraSettings: Record<string, unknown> = {};
    if (settings?.extraSettings) {
      try {
        extraSettings = JSON.parse(settings.extraSettings);
      } catch {
        extraSettings = {};
      }
    }

    // Update sequencing files config in extraSettings
    if (config !== undefined) {
      const existingSequencingFiles =
        typeof extraSettings.sequencingFiles === "object" &&
        extraSettings.sequencingFiles !== null
          ? (extraSettings.sequencingFiles as Record<string, unknown>)
          : {};
      extraSettings.sequencingFiles = {
        ...DEFAULT_CONFIG,
        ...existingSequencingFiles,
        ...config,
        allowSingleEnd: true,
      };
    }

    // Build update object
    const updateData: { dataBasePath?: string | null; extraSettings: string } = {
      extraSettings: JSON.stringify(extraSettings),
    };
    if (dataBasePath !== undefined) {
      updateData.dataBasePath = dataBasePath.trim() || null;
    }

    // Upsert the settings
    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: {
        id: "singleton",
        ...updateData,
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Sequencing Files Settings] Error saving:", error);
    return NextResponse.json({ error: "Failed to save settings" }, { status: 500 });
  }
}
