import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";

interface ReadinessResponse {
  ready: boolean;
  requiredMissing: string[];
  recommendedMissing: string[];
  missingItems: Array<{
    key: string;
    label: string;
    href: string;
    severity: "required" | "recommended";
  }>;
  firstMissingHref: string;
}

const REQUIRED_CHECKS = {
  dataPath: {
    label: "Data storage path",
    href: "/admin/data-storage#required-data-storage",
  },
  runDir: {
    label: "Pipeline run directory",
    href: "/admin/pipeline-runtime#required-runtime",
  },
} as const;

const RECOMMENDED_CHECKS = {
  condaPath: {
    label: "Conda path",
    href: "/admin/pipeline-runtime#required-runtime",
  },
  weblogUrl: {
    label: "Weblog URL",
    href: "/admin/pipeline-runtime#advanced-runtime",
  },
} as const;

export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [siteSettings, executionSettings] = await Promise.all([
      db.siteSettings.findUnique({
        where: { id: "singleton" },
        select: { dataBasePath: true },
      }),
      getExecutionSettings(),
    ]);

    const dataBasePath = siteSettings?.dataBasePath?.trim() || "";
    const pipelineRunDir = executionSettings.pipelineRunDir?.trim() || "";
    const condaPath = executionSettings.condaPath?.trim() || "";
    const weblogUrl = executionSettings.weblogUrl?.trim() || "";

    const requiredMissing: string[] = [];
    const recommendedMissing: string[] = [];
    const missingItems: ReadinessResponse["missingItems"] = [];

    if (!dataBasePath) {
      requiredMissing.push(REQUIRED_CHECKS.dataPath.label);
      missingItems.push({
        key: "dataPath",
        label: REQUIRED_CHECKS.dataPath.label,
        href: REQUIRED_CHECKS.dataPath.href,
        severity: "required",
      });
    }

    if (!pipelineRunDir || pipelineRunDir === "/") {
      requiredMissing.push(REQUIRED_CHECKS.runDir.label);
      missingItems.push({
        key: "runDir",
        label: REQUIRED_CHECKS.runDir.label,
        href: REQUIRED_CHECKS.runDir.href,
        severity: "required",
      });
    }

    if (!condaPath) {
      recommendedMissing.push(RECOMMENDED_CHECKS.condaPath.label);
      missingItems.push({
        key: "condaPath",
        label: RECOMMENDED_CHECKS.condaPath.label,
        href: RECOMMENDED_CHECKS.condaPath.href,
        severity: "recommended",
      });
    }

    if (!weblogUrl) {
      recommendedMissing.push(RECOMMENDED_CHECKS.weblogUrl.label);
      missingItems.push({
        key: "weblogUrl",
        label: RECOMMENDED_CHECKS.weblogUrl.label,
        href: RECOMMENDED_CHECKS.weblogUrl.href,
        severity: "recommended",
      });
    }

    const firstMissingHref =
      requiredMissing.length > 0
        ? !dataBasePath
          ? REQUIRED_CHECKS.dataPath.href
          : REQUIRED_CHECKS.runDir.href
        : !condaPath
        ? RECOMMENDED_CHECKS.condaPath.href
        : !weblogUrl
        ? RECOMMENDED_CHECKS.weblogUrl.href
        : "/admin/data-compute";

    const response: ReadinessResponse = {
      ready: requiredMissing.length === 0,
      requiredMissing,
      recommendedMissing,
      missingItems,
      firstMissingHref,
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("[Infrastructure Readiness] Error:", error);
    return NextResponse.json(
      { error: "Failed to evaluate infrastructure readiness" },
      { status: 500 }
    );
  }
}
