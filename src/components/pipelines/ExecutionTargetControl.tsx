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
  return mode === "slurm" ? "SLURM" : "Local";
}

function formatSource(source: ExecutionPolicySource | undefined): string {
  switch (source) {
    case "pipeline":
      return "pipeline policy";
    case "run":
      return "run override";
    case "global":
    default:
      return "global policy";
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
    return "Checking SLURM availability before starting this run.";
  }

  if (slurmAvailabilityError) {
    return `Could not verify SLURM: ${slurmAvailabilityError}. Choose Local to run on this host.`;
  }

  if (!slurmAvailability?.success) {
    const reason = slurmAvailability?.message || "SLURM is not available on this host.";
    return `SLURM unavailable: ${reason}. Choose Local to run on this host.`;
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
  label = "Execution Target",
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
  const slurmDisabledReason =
    slurmAvailabilityError ||
    slurmAvailability?.message ||
    (slurmAvailabilityLoading ? "Checking SLURM availability..." : null);

  const options: Array<{
    value: ExecutionModeRequest;
    label: string;
    disabled?: boolean;
    title?: string | null;
  }> = [
    {
      value: "default",
      label: `Default (${formatMode(defaultMode)})`,
      title: `Uses ${sourceLabel}.`,
    },
    { value: "local", label: "Local" },
    {
      value: "slurm",
      label: "SLURM",
      disabled: slurmDisabled,
      title: slurmDisabledReason,
    },
  ];

  return (
    <div className={cn("rounded-xl border border-border bg-card p-4", className)}>
      <div className="flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div>
          <div id={`${id}-label`} className="text-xs font-medium text-foreground">
            {label}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            Default resolves to {formatMode(defaultMode)} from {sourceLabel}.
          </p>
        </div>

        <div
          role="radiogroup"
          aria-labelledby={`${id}-label`}
          className="inline-flex w-full max-w-full overflow-hidden rounded-lg border border-border bg-background p-0.5 md:w-auto"
        >
          {options.map((option) => {
            const selected = value === option.value;
            return (
              <button
                key={option.value}
                type="button"
                role="radio"
                aria-checked={selected}
                disabled={option.disabled}
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

      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        {slurmAvailabilityLoading ? (
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
        ) : blockMessage ? (
          <AlertCircle className="h-3.5 w-3.5 text-destructive" />
        ) : null}
        <span className={cn(blockMessage && "text-destructive")}>
          {blockMessage ||
            `Selected target: ${
              value === "default" ? `Default (${formatMode(effectiveMode)})` : formatMode(effectiveMode)
            }.`}
        </span>
      </div>
    </div>
  );
}
