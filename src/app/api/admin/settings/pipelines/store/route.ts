import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  loadPipelineStoreCatalog,
  parsePipelineCatalog,
} from "@/lib/pipelines/pipeline-store-service";

export async function GET(request: NextRequest) {
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

  const result = await loadPipelineStoreCatalog({ catalog });

  if (result.successfulRegistryCount === 0 && result.registryErrors.length > 0) {
    return NextResponse.json(
      {
        error: "Failed to fetch pipeline registry",
        details: result.registryErrors
          .map((entry) => `${entry.registryUrl}: ${entry.error}`)
          .join("; "),
        ...result,
      },
      { status: 500 }
    );
  }

  return NextResponse.json(result);
}
