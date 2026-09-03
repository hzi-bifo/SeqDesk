import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import {
  authorizationErrorResponse,
  decideServerCapability,
} from "@/lib/authorization/api";
import { getResolvedDataBasePath } from "@/lib/files/data-base-path";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import { loadConfig } from "@/lib/config/loader";
import { getServerDeploymentProfile } from "@/lib/deployment-profile/server";

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
  workflowExecution: {
    label: "Workflow execution",
    href: "/admin/settings/pipelines",
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
    const access = decideServerCapability(session, "system.settings.manage");
    if (!access.allowed) {
      return authorizationErrorResponse(access);
    }
    if (access.principal?.isDemo) {
      return NextResponse.json({
        ready: true,
        requiredMissing: [],
        recommendedMissing: [],
        missingItems: [],
        firstMissingHref: "/admin/data-compute",
      } satisfies ReadinessResponse);
    }

    const deploymentProfile = getServerDeploymentProfile();
    const pipelinesEnabled = loadConfig().config.pipelines?.enabled === true;
    const [resolvedDataBasePath, executionSettings] = await Promise.all([
      getResolvedDataBasePath(),
      getExecutionSettings(),
    ]);

    const dataBasePath = resolvedDataBasePath.dataBasePath?.trim() || "";
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

    if (deploymentProfile.experience === "workbench" && !pipelinesEnabled) {
      requiredMissing.push(REQUIRED_CHECKS.workflowExecution.label);
      missingItems.push({
        key: "workflowExecution",
        label: REQUIRED_CHECKS.workflowExecution.label,
        href: REQUIRED_CHECKS.workflowExecution.href,
        severity: "required",
      });
    }

    if (pipelinesEnabled && (!pipelineRunDir || pipelineRunDir === "/")) {
      requiredMissing.push(REQUIRED_CHECKS.runDir.label);
      missingItems.push({
        key: "runDir",
        label: REQUIRED_CHECKS.runDir.label,
        href: REQUIRED_CHECKS.runDir.href,
        severity: "required",
      });
    }

    if (pipelinesEnabled && !condaPath) {
      recommendedMissing.push(RECOMMENDED_CHECKS.condaPath.label);
      missingItems.push({
        key: "condaPath",
        label: RECOMMENDED_CHECKS.condaPath.label,
        href: RECOMMENDED_CHECKS.condaPath.href,
        severity: "recommended",
      });
    }

    if (pipelinesEnabled && !weblogUrl) {
      recommendedMissing.push(RECOMMENDED_CHECKS.weblogUrl.label);
      missingItems.push({
        key: "weblogUrl",
        label: RECOMMENDED_CHECKS.weblogUrl.label,
        href: RECOMMENDED_CHECKS.weblogUrl.href,
        severity: "recommended",
      });
    }

    const firstMissingHref =
      missingItems.find((item) => item.severity === "required")?.href ||
      missingItems[0]?.href ||
      "/admin/data-compute";

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
