import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  installManagedPipeline,
  PipelineInstallError,
  type ManagedPipelineInstallCredentials,
} from "@/lib/pipelines/pipeline-install-service";
import type { PipelineSourceDescriptor } from "@/lib/pipelines/store-sources";

interface InstallRequestBody {
  pipelineId?: unknown;
  version?: unknown;
  replace?: unknown;
  sourceId?: unknown;
  source?: Partial<PipelineSourceDescriptor>;
  credentials?: {
    accessKey?: unknown;
    token?: unknown;
    sha256?: unknown;
  };
  privatePackageUrl?: unknown;
  privateAccessKey?: unknown;
  privateSha256?: unknown;
  autoEnable?: unknown;
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export async function POST(request: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 403 });
  }

  let body: InstallRequestBody;
  try {
    body = (await request.json()) as InstallRequestBody;
  } catch {
    return NextResponse.json(
      { error: "Invalid JSON request body" },
      { status: 400 }
    );
  }

  const credentials: ManagedPipelineInstallCredentials = {
    accessKey:
      trimToUndefined(body.credentials?.accessKey) ||
      trimToUndefined(body.privateAccessKey),
    token: trimToUndefined(body.credentials?.token),
    sha256:
      trimToUndefined(body.credentials?.sha256) ||
      trimToUndefined(body.privateSha256),
  };

  try {
    const result = await installManagedPipeline({
      pipelineId:
        typeof body.pipelineId === "string" ? body.pipelineId : "",
      version: trimToUndefined(body.version),
      replace:
        typeof body.replace === "boolean" ? body.replace : undefined,
      sourceId: trimToUndefined(body.sourceId),
      source: body.source,
      credentials,
      privatePackageUrl: trimToUndefined(body.privatePackageUrl),
      // The browser follows a guided setup flow and activates explicitly at
      // the end. The route-free CLI service defaults to auto-enable when every
      // readiness check already passes.
      autoEnable: body.autoEnable === true,
    });
    return NextResponse.json(result);
  } catch (error) {
    if (error instanceof PipelineInstallError) {
      return NextResponse.json(
        {
          error:
            error.status >= 500
              ? "Failed to install pipeline"
              : error.message,
          details: error.details || error.message,
        },
        { status: error.status }
      );
    }
    console.error("[Pipeline Install] Unexpected error:", error);
    return NextResponse.json(
      {
        error: "Failed to install pipeline",
        details:
          error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
