import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  listInstalledManagedPipelineStatuses,
  PipelineManagementError,
  updateManagedPipeline,
  type ManagedPipelineStatus,
} from "@/lib/pipelines/pipeline-management-service";
import { parsePipelineCatalog } from "@/lib/pipelines/pipeline-store-service";

function toLegacyPipelineSettingsResponse(
  pipeline: ManagedPipelineStatus
): Omit<ManagedPipelineStatus, "targets"> & {
  targets: { supported: ManagedPipelineStatus["targets"] } | null;
} {
  return {
    ...pipeline,
    targets:
      pipeline.targets.length > 0
        ? { supported: pipeline.targets }
        : null,
  };
}

// GET - List all installed pipeline configurations.
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const catalog = parsePipelineCatalog(searchParams.get("catalog"));
    if (!catalog) {
      return NextResponse.json(
        { error: "Invalid catalog. Expected one of: all, order, study" },
        { status: 400 }
      );
    }

    const pipelines = await listInstalledManagedPipelineStatuses({
      catalog,
      enabledOnly: searchParams.get("enabled") === "true",
    });
    return NextResponse.json({
      pipelines: pipelines.map(toLegacyPipelineSettingsResponse),
    });
  } catch (error) {
    console.error("[Pipelines API] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch pipeline configurations" },
      { status: 500 }
    );
  }
}

// POST - Update a pipeline configuration.
export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
    }

    let body: {
      pipelineId?: unknown;
      config?: unknown;
      enabled?: unknown;
    };
    try {
      body = (await request.json()) as typeof body;
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON request body" },
        { status: 400 }
      );
    }

    if (typeof body.pipelineId !== "string" || !body.pipelineId.trim()) {
      return NextResponse.json(
        { error: "Invalid pipeline ID" },
        { status: 400 }
      );
    }

    const result = await updateManagedPipeline({
      pipelineId: body.pipelineId.trim(),
      config: body.config as Record<string, unknown> | null | undefined,
      enabled:
        typeof body.enabled === "boolean" ? body.enabled : undefined,
      // The browser submits the complete settings form. CLI setup patches use
      // the service default and merge only the supplied keys.
      replaceConfig: true,
      // Preserve the historical API contract: omitting enabled activates after
      // successful readiness validation.
      enableWhenOmitted: true,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineManagementError) {
      return NextResponse.json(
        {
          error: error.message,
          ...(error.details.length > 0 ? { details: error.details } : {}),
        },
        { status: error.status }
      );
    }
    console.error("[Pipelines API] Error:", error);
    return NextResponse.json(
      { error: "Failed to update pipeline configuration" },
      { status: 500 }
    );
  }
}
