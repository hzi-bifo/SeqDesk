import { createHash } from "node:crypto";

import { loadConfig } from "@/lib/config/loader";
import {
  getExecutionSettings,
  type ExecutionSettings,
} from "@/lib/pipelines/execution-settings";
import { inspectManagedLocalPath } from "@/lib/pipelines/pipeline-readiness-service";
import {
  checkPipelineRuntimePrerequisites,
  type PrerequisiteCheck,
} from "@/lib/pipelines/prerequisite-check";

export type WorkflowRuntimeExecutor = "local" | "slurm";

export const WORKFLOW_RUNTIME_READINESS_VERSION = 1 as const;

export type WorkflowRuntimeReadinessCheckStatus =
  | "ready"
  | "warning"
  | "missing";

export interface WorkflowRuntimeReadinessCheck {
  id: string;
  label: string;
  status: WorkflowRuntimeReadinessCheckStatus;
  blocking: boolean;
  detail: string;
  href: string;
}

export interface WorkflowRuntimeReadiness {
  status: "ready" | "missing" | "error";
  ready: boolean;
  summary: string;
  checks: WorkflowRuntimeReadinessCheck[];
  checkedAt: string;
  executor: WorkflowRuntimeExecutor;
  fingerprint: string;
}

interface WorkflowRuntimeContext {
  pipelinesEnabled: boolean;
  executionSettings: ExecutionSettings;
  executor: WorkflowRuntimeExecutor;
  fingerprint: string;
}

const PIPELINE_SETTINGS_HREF = "/admin/settings/pipelines";
const PIPELINE_RUNTIME_HREF = "/admin/pipeline-runtime#required-runtime";

function normalizeString(value: string | null | undefined): string {
  return value?.trim() ?? "";
}

function createWorkflowRuntimeFingerprint(args: {
  pipelinesEnabled: boolean;
  executionSettings: ExecutionSettings;
}): string {
  const executor: WorkflowRuntimeExecutor = args.executionSettings.useSlurm
    ? "slurm"
    : "local";
  const normalizedConfiguration = {
    version: WORKFLOW_RUNTIME_READINESS_VERSION,
    pipelinesEnabled: args.pipelinesEnabled,
    executor,
    slurmQueue:
      executor === "slurm"
        ? normalizeString(args.executionSettings.slurmQueue)
        : "",
    runtimeMode: "conda",
    condaPath: normalizeString(args.executionSettings.condaPath),
    condaEnv: normalizeString(args.executionSettings.condaEnv),
    pipelineRunDir: normalizeString(args.executionSettings.pipelineRunDir),
  };

  return createHash("sha256")
    .update(JSON.stringify(normalizedConfiguration), "utf8")
    .digest("hex");
}

async function resolveWorkflowRuntimeContext(): Promise<WorkflowRuntimeContext> {
  const pipelinesEnabled = loadConfig().config.pipelines?.enabled === true;
  const executionSettings = await getExecutionSettings();
  const executor: WorkflowRuntimeExecutor = executionSettings.useSlurm
    ? "slurm"
    : "local";

  return {
    pipelinesEnabled,
    executionSettings,
    executor,
    fingerprint: createWorkflowRuntimeFingerprint({
      pipelinesEnabled,
      executionSettings,
    }),
  };
}

/**
 * Resolve the non-secret configuration identity used to validate stored runtime
 * readiness evidence. This reads configuration and database-backed execution
 * settings, but deliberately performs no child-process or filesystem probes.
 */
export async function resolveWorkflowRuntimeFingerprint(): Promise<string> {
  return (await resolveWorkflowRuntimeContext()).fingerprint;
}

function mapPrerequisiteStatus(
  status: PrerequisiteCheck["status"]
): WorkflowRuntimeReadinessCheckStatus {
  if (status === "pass") return "ready";
  if (status === "warning") return "warning";
  return "missing";
}

function mapPrerequisiteCheck(
  check: PrerequisiteCheck
): WorkflowRuntimeReadinessCheck {
  return {
    id: check.id,
    label: check.name,
    status: mapPrerequisiteStatus(check.status),
    blocking: check.required,
    detail: check.message.trim() || "The runtime check did not return a result.",
    href: PIPELINE_RUNTIME_HREF,
  };
}

function missingBlockingLabels(
  checks: WorkflowRuntimeReadinessCheck[]
): string[] {
  return checks
    .filter((check) => check.blocking && check.status !== "ready")
    .map((check) => check.label);
}

/**
 * Verify the workflow runtime when pipeline execution is enabled.
 * The check does not install software, create the configured run
 * directory, submit a workflow, or persist onboarding evidence.
 */
export async function checkWorkflowRuntimeReadiness(): Promise<WorkflowRuntimeReadiness> {
  const context = await resolveWorkflowRuntimeContext();

  if (!context.pipelinesEnabled) {
    return {
      status: "missing",
      ready: false,
      summary: "Workflow execution is disabled for this installation.",
      checks: [
        {
          id: "pipelines-enabled",
          label: "Workflow execution",
          status: "missing",
          blocking: true,
          detail: "Enable workflow execution before verifying the runtime.",
          href: PIPELINE_SETTINGS_HREF,
        },
      ],
      checkedAt: new Date().toISOString(),
      executor: context.executor,
      fingerprint: context.fingerprint,
    };
  }

  try {
    const [runDirectory, prerequisites] = await Promise.all([
      inspectManagedLocalPath({
        targetPath: context.executionSettings.pipelineRunDir,
        writable: true,
      }),
      checkPipelineRuntimePrerequisites(context.executionSettings, {
        nextflowOffline: true,
      }),
    ]);
    const checks: WorkflowRuntimeReadinessCheck[] = [
      {
        id: "pipeline-run-directory",
        label: "Pipeline run directory",
        status: runDirectory.status,
        blocking: true,
        detail: runDirectory.detail,
        href: PIPELINE_RUNTIME_HREF,
      },
      ...prerequisites.map(mapPrerequisiteCheck),
    ];
    const missingLabels = missingBlockingLabels(checks);

    if (missingLabels.length > 0) {
      return {
        status: "missing",
        ready: false,
        summary: `Workflow runtime needs attention: ${missingLabels.join(", ")}.`,
        checks,
        checkedAt: new Date().toISOString(),
        executor: context.executor,
        fingerprint: context.fingerprint,
      };
    }

    return {
      status: "ready",
      ready: true,
      summary: "Workflow runtime is ready.",
      checks,
      checkedAt: new Date().toISOString(),
      executor: context.executor,
      fingerprint: context.fingerprint,
    };
  } catch {
    return {
      status: "error",
      ready: false,
      summary: "SeqDesk could not complete the workflow runtime check.",
      checks: [
        {
          id: "workflow-runtime-check",
          label: "Workflow runtime verification",
          status: "missing",
          blocking: true,
          detail: "Try the check again or review the workflow runtime settings.",
          href: PIPELINE_RUNTIME_HREF,
        },
      ],
      checkedAt: new Date().toISOString(),
      executor: context.executor,
      fingerprint: context.fingerprint,
    };
  }
}
