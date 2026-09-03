import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";
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

function toRunnablePipelineResponse(pipeline: ManagedPipelineStatus) {
  const properties = Object.fromEntries(
    Object.entries(pipeline.configSchema.properties).filter(([key, property]) => {
      const ui = property["x-seqdesk"];
      if (ui?.placement === "admin" || ui?.placement === "hidden") return false;
      if (
        ui?.hideWhenServerConfigured &&
        Object.prototype.hasOwnProperty.call(pipeline.config, key)
      ) {
        return false;
      }
      return true;
    })
  );
  const allowedKeys = new Set(Object.keys(properties));
  const filterConfig = (config: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(config).filter(([key]) => allowedKeys.has(key))
    );

  return {
    pipelineId: pipeline.pipelineId,
    name: pipeline.name,
    description: pipeline.description,
    category: pipeline.category,
    version: pipeline.version,
    icon: pipeline.icon,
    enabled: pipeline.enabled,
    targets: pipeline.targets.length > 0 ? { supported: pipeline.targets } : null,
    config: filterConfig(pipeline.config),
    defaultConfig: filterConfig(pipeline.defaultConfig),
    configSchema: {
      ...pipeline.configSchema,
      properties,
      required: pipeline.configSchema.required?.filter((key) => allowedKeys.has(key)),
    },
    input: pipeline.input,
    sampleResult: pipeline.sampleResult,
    visibility: pipeline.visibility,
    requires: pipeline.requires,
    outputs: pipeline.outputs,
    executionPolicy: {
      mode: pipeline.executionPolicy.mode,
      source: pipeline.executionPolicy.source,
    },
    runtimeWarnings: [],
  };
}

// GET - List all installed pipeline configurations.
export async function GET(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const profile = getServerDeploymentProfile();
    const managementAccess = decideCapability(
      session,
      "system.pipelines.manage",
      profile
    );
    const runAccess = decideCapability(session, "analysis.run", profile);
    const enabledOnly = searchParams.get("enabled") === "true";
    if (!managementAccess.allowed && (!runAccess.allowed || !enabledOnly)) {
      return NextResponse.json(
        { error: runAccess.status === 404 ? "Not found" : "Forbidden" },
        { status: runAccess.status === 404 ? 404 : 403 }
      );
    }

    const catalog = parsePipelineCatalog(searchParams.get("catalog"));
    if (!catalog) {
      return NextResponse.json(
        { error: "Invalid catalog. Expected one of: all, order, study" },
        { status: 400 }
      );
    }

    const pipelines = await listInstalledManagedPipelineStatuses({
      catalog,
      enabledOnly,
    });
    return NextResponse.json({
      pipelines: managementAccess.allowed
        ? pipelines.map(toLegacyPipelineSettingsResponse)
        : pipelines.map(toRunnablePipelineResponse),
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
    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const decision = decideCapability(
      session,
      "system.pipelines.manage",
      getServerDeploymentProfile()
    );
    if (!decision.allowed) {
      return NextResponse.json(
        { error: decision.status === 404 ? "Not found" : "Forbidden" },
        { status: decision.status === 404 ? 404 : 403 }
      );
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
