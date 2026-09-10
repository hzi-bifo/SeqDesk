"use client";

import useSWR from "swr";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type ExecutionMode = "local" | "slurm";
export type ExecutionModeRequest = "default" | ExecutionMode;
export type ExecutionPolicySource = "global" | "pipeline" | "run";

export interface ExecutionPolicySummary {
  mode: ExecutionMode;
  source: ExecutionPolicySource;
}

export interface SlurmAvailability {
  success: boolean;
  message: string;
  details?: string;
}

const SLURM_AVAILABILITY_KEY = "/api/admin/settings/pipelines/test-setting:slurm";

function formatMode(mode: ExecutionMode): string {
  return mode === "slurm" ? "Compute cluster (SLURM)" : "SeqDesk server (local)";
}

function formatSource(source: ExecutionPolicySource | undefined): string {
  switch (source) {
    case "pipeline":
      return "this pipeline's default setting";
    case "run":
      return "the setting saved for this run";
    case "global":
    default:
      return "the SeqDesk default setting";
  }
}

async function fetchSlurmAvailability(): Promise<SlurmAvailability> {
  const res = await fetch("/api/admin/settings/pipelines/test-setting", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ setting: "slurm" }),
  });

  const payload = (await res.json().catch(() => null)) as
    | Partial<SlurmAvailability>
    | null;

  if (!res.ok) {
    throw new Error(payload?.message || `SLURM check failed with HTTP ${res.status}`);
  }

  return {
    success: Boolean(payload?.success),
    message: payload?.message || "SLURM check completed.",
    details: payload?.details,
  };
}

export function useSlurmAvailability(enabled: boolean) {
  const { data, error, isLoading, mutate } = useSWR<SlurmAvailability>(
    enabled ? SLURM_AVAILABILITY_KEY : null,
    fetchSlurmAvailability,
    {
      dedupingInterval: 30_000,
      revalidateOnFocus: false,
    }
  );

  return {
    slurmAvailability: data ?? null,
    slurmAvailabilityLoading: Boolean(enabled && isLoading),
    slurmAvailabilityError:
      error instanceof Error
        ? error.message
        : error
          ? "Failed to check SLURM availability."
          : null,
    refreshSlurmAvailability: mutate,
  };
}

export function getEffectiveExecutionMode(
  executionMode: ExecutionModeRequest,
  executionPolicy?: ExecutionPolicySummary | null
): ExecutionMode {
  if (executionMode === "local" || executionMode === "slurm") {
    return executionMode;
  }
  return executionPolicy?.mode ?? "local";
}

export function getExecutionTargetBlockMessage({
  executionMode,
  executionPolicy,
  slurmAvailability,
  slurmAvailabilityLoading,
  slurmAvailabilityError,
}: {
  executionMode: ExecutionModeRequest;
  executionPolicy?: ExecutionPolicySummary | null;
  slurmAvailability?: SlurmAvailability | null;
  slurmAvailabilityLoading?: boolean;
  slurmAvailabilityError?: string | null;
}): string | null {
  const effectiveMode = getEffectiveExecutionMode(executionMode, executionPolicy);
  if (effectiveMode !== "slurm") return null;

  if (slurmAvailabilityLoading) {
    return "Checking the compute cluster before starting this run.";
  }

  if (slurmAvailabilityError) {
    return `Could not check the compute cluster: ${slurmAvailabilityError}. Choose SeqDesk server to run without the cluster.`;
  }

  if (!slurmAvailability?.success) {
    const reason = slurmAvailability?.message || "No SLURM connection is available.";
    return `Compute cluster unavailable: ${reason}. Choose SeqDesk server to run without the cluster.`;
  }

  return null;
}

export function isExecutionTargetBlocked(
  args: Parameters<typeof getExecutionTargetBlockMessage>[0]
): boolean {
  return getExecutionTargetBlockMessage(args) !== null;
}

interface ExecutionTargetControlProps {
  value: ExecutionModeRequest;
  onChange: (value: ExecutionModeRequest) => void;
  executionPolicy?: ExecutionPolicySummary | null;
  slurmAvailability?: SlurmAvailability | null;
  slurmAvailabilityLoading?: boolean;
  slurmAvailabilityError?: string | null;
  id?: string;
  label?: string;
  className?: string;
}

export function ExecutionTargetControl({
  value,
  onChange,
  executionPolicy,
  slurmAvailability,
  slurmAvailabilityLoading = false,
  slurmAvailabilityError = null,
  id = "execution-target",
  label = "Where to run",
  className,
}: ExecutionTargetControlProps) {
  const effectiveMode = getEffectiveExecutionMode(value, executionPolicy);
  const defaultMode = executionPolicy?.mode ?? "local";
  const sourceLabel = formatSource(executionPolicy?.source);
  const blockMessage = getExecutionTargetBlockMessage({
    executionMode: value,
    executionPolicy,
    slurmAvailability,
    slurmAvailabilityLoading,
    slurmAvailabilityError,
  });
  const slurmDisabled =
    slurmAvailabilityLoading ||
    Boolean(slurmAvailabilityError) ||
    slurmAvailability?.success !== true;
  const slurmDisabledReason = slurmAvailabilityLoading
    ? "Checking whether a compute cluster is available…"
    : slurmAvailabilityError
      ? `Could not check the compute cluster: ${slurmAvailabilityError}`
      : /Missing required SLURM command/i.test(slurmAvailability?.details ?? "")
        ? "SLURM is not set up on this SeqDesk server: required cluster tools are missing or unavailable. An administrator can check the cluster setup."
        : slurmAvailability?.message
          ? `Compute cluster unavailable: ${slurmAvailability.message}`
          : "No available SLURM connection has been confirmed. An administrator can check the cluster setup.";
  // Keep the saved request as "default"; only simplify its presentation when
  // local is the default and the cluster is confirmed unavailable.
  const localOnly = defaultMode === "local" && effectiveMode === "local" &&
    slurmAvailability?.success === false && !slurmAvailabilityLoading && !slurmAvailabilityError;

  if (localOnly) {
    return <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <p className="text-xs font-medium">{label}</p>
      <p className="mt-1 text-sm">Runs on the SeqDesk server</p>
      <p className="mt-1 text-xs text-muted-foreground">The computer where SeqDesk is installed.</p>
      <details className="mt-3 text-xs text-muted-foreground">
        <summary className="cursor-pointer">Compute cluster unavailable</summary>
        <p className="mt-2">{slurmDisabledReason}</p>
        {slurmAvailability?.details && <p className="mt-1 whitespace-pre-wrap break-words">{slurmAvailability.details}</p>}
      </details>
    </div>;
  }

  const options: Array<{
    value: ExecutionModeRequest;
    label: string;
    disabled?: boolean;
    title?: string | null;
  }> = [
    ...(!localOnly ? [{
      value: "default",
      label: "Use default",
      title: `Uses ${sourceLabel}: ${formatMode(defaultMode)}.`,
    } as const] : []),
    { value: "local", label: formatMode("local") },
    {
      value: "slurm",
      label: formatMode("slurm"),
      disabled: slurmDisabled,
      title: slurmDisabled ? slurmDisabledReason : "Runs on the configured compute cluster (SLURM).",
    },
  ];

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div id={`${id}-label`} className="text-xs font-medium text-foreground">
            {label}
          </div>
          <p id={`${id}-description`} className="mt-1 text-xs text-muted-foreground">
            {effectiveMode === "local"
              ? "Runs on the computer where SeqDesk is installed."
              : "Runs on the configured compute cluster (SLURM)."}
          </p>
        </div>

        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          aria-describedby={`${id}-description`}
          className="inline-flex w-full max-w-full flex-wrap gap-0.5 rounded-lg border border-border bg-background p-0.5 sm:w-auto"
        >
          {options.map((option) => {
            const selected = value === option.value || (localOnly && value === "default" && option.value === "local");
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={option.disabled}
                aria-describedby={option.value === "slurm" && slurmDisabled ? `${id}-cluster-status` : undefined}
                title={option.title || undefined}
                onClick={() => onChange(option.value)}
                className={cn(
                  "h-8 min-w-0 flex-1 whitespace-nowrap px-3 text-xs font-medium transition-colors md:flex-none",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2",
                  selected
                    ? "rounded-md bg-primary text-primary-foreground shadow-sm"
                    : "rounded-md text-muted-foreground hover:bg-muted hover:text-foreground",
                  option.disabled && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted-foreground"
                )}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      {slurmDisabled && <div id={`${id}-cluster-status`} className={cn("mt-3 space-y-1 text-xs", blockMessage ? "text-destructive" : "text-muted-foreground")} role="status">
        <p>{blockMessage || slurmDisabledReason}</p>
        {slurmAvailability?.details && !slurmAvailabilityLoading && !slurmAvailabilityError && <details>
          <summary className="cursor-pointer underline underline-offset-4">Technical details</summary>
          <p className="mt-1 whitespace-pre-wrap break-words">{slurmAvailability.details}</p>
        </details>}
      </div>}

      {!(slurmDisabled && blockMessage) && <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        {slurmAvailabilityLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : blockMessage ? (
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
        ) : null}
        <span className={cn(blockMessage && "text-destructive")}>
          {blockMessage ||
            (value === "default"
              ? `Using ${sourceLabel}.`
              : "This choice applies only to this run.")}
        </span>
      </div>}
    </div>
  );
}
