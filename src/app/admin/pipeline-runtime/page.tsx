"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { notifyPanel } from "@/lib/notifications/client";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  HardDrive,
  Loader2,
  CheckCircle2,
  XCircle,
  Server,
  ChevronDown,
  ChevronUp,
  Check,
} from "lucide-react";
import { InfrastructureSetupStatus } from "@/components/admin/infrastructure/InfrastructureSetupStatus";

type PipelineOverrideMode = "inherit" | "local" | "slurm";

interface SlurmOverrideSettings {
  queue?: string;
  cores?: number;
  memory?: string;
  timeLimit?: number;
  options?: string;
}

interface PipelineExecutionOverride {
  mode?: PipelineOverrideMode;
  slurm?: SlurmOverrideSettings;
  nextflowProfile?: string;
}

interface ExecutionSettings {
  useSlurm: boolean;
  slurmQueue: string;
  slurmCores: number;
  slurmMemory: string;
  slurmTimeLimit: number;
  slurmOptions: string;
  pipelineOverrides: Record<string, PipelineExecutionOverride>;
  runtimeMode: "conda";
  condaPath: string;
  condaEnv: string;
  nextflowProfile: string;
  pipelineRunDir: string;
  weblogUrl: string;
  weblogSecret: string;
}

interface PipelineSummary {
  pipelineId: string;
  name: string;
  category?: string;
  enabled: boolean;
  download?: {
    status?: string;
  };
  readiness?: {
    items?: Array<{
      id: string;
      status: "ready" | "warning" | "missing";
    }>;
  };
  executionPolicy?: {
    mode: "local" | "slurm";
    source: "global" | "pipeline" | "run";
  };
}

interface TestResult {
  success: boolean;
  message: string;
  testing?: boolean;
}

function isInstalledPipeline(pipeline: PipelineSummary): boolean {
  if (pipeline.download?.status === "downloaded") return true;
  return (
    pipeline.readiness?.items?.some(
      (item) => item.id === "package" && item.status === "ready"
    ) || false
  );
}

export default function PipelineRuntimePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectResult, setAutoDetectResult] = useState<{
    success: boolean;
    message: string;
  } | null>(null);
  const [installedPipelines, setInstalledPipelines] = useState<PipelineSummary[]>([]);

  const [testResults, setTestResults] = useState<Record<string, TestResult>>({});
  const [execSettings, setExecSettings] = useState<ExecutionSettings>({
    useSlurm: false,
    slurmQueue: "cpu",
    slurmCores: 4,
    slurmMemory: "64GB",
    slurmTimeLimit: 12,
    slurmOptions: "",
    pipelineOverrides: {},
    runtimeMode: "conda",
    condaPath: "",
    condaEnv: "seqdesk-pipelines",
    nextflowProfile: "",
    pipelineRunDir: "/data/pipeline_runs",
    weblogUrl: "",
    weblogSecret: "",
  });

  const parseIntOrFallback = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const clearTestResult = (setting: string) => {
    setTestResults((prev) => {
      if (!(setting in prev)) return prev;
      const next = { ...prev };
      delete next[setting];
      return next;
    });
  };

  const updatePipelineOverride = (
    pipelineId: string,
    updater: (current: PipelineExecutionOverride) => PipelineExecutionOverride
  ) => {
    setExecSettings((prev) => {
      const current = prev.pipelineOverrides[pipelineId] || { mode: "inherit" };
      const nextOverride = updater(current);
      const nextOverrides = { ...prev.pipelineOverrides };
      const mode = nextOverride.mode || "inherit";
      const slurm = nextOverride.slurm || {};
      const hasSlurm = Object.values(slurm).some(
        (value) => value !== undefined && value !== ""
      );
      const hasProfile = Boolean(nextOverride.nextflowProfile?.trim());

      if (mode === "inherit" && !hasSlurm && !hasProfile) {
        delete nextOverrides[pipelineId];
      } else {
        nextOverrides[pipelineId] = {
          ...nextOverride,
          mode,
          ...(hasSlurm ? { slurm } : {}),
          ...(hasProfile
            ? { nextflowProfile: nextOverride.nextflowProfile?.trim() }
            : {}),
        };
      }

      return {
        ...prev,
        pipelineOverrides: nextOverrides,
      };
    });
  };

  const updatePipelineSlurmOverride = (
    pipelineId: string,
    field: keyof SlurmOverrideSettings,
    value: string | number | undefined
  ) => {
    updatePipelineOverride(pipelineId, (current) => ({
      ...current,
      slurm: {
        ...(current.slurm || {}),
        [field]: value,
      },
    }));
  };

  const fetchSettings = useCallback(async () => {
    try {
      const [settingsRes, pipelinesRes] = await Promise.all([
        fetch("/api/admin/settings/pipelines/execution"),
        fetch("/api/admin/settings/pipelines"),
      ]);
      if (!settingsRes.ok) {
        throw new Error("Failed to load settings");
      }
      const data = await settingsRes.json();
      if (data?.settings) {
        setExecSettings((prev) => ({
          ...prev,
          ...data.settings,
          pipelineOverrides: data.settings.pipelineOverrides || {},
        }));
      }
      if (pipelinesRes.ok) {
        const pipelinesData = await pipelinesRes.json();
        setInstalledPipelines(
          Array.isArray(pipelinesData?.pipelines)
            ? pipelinesData.pipelines.filter(isInstalledPipeline)
            : []
        );
      }
    } catch (error) {
      console.error("Failed to load pipeline execution settings:", error);
      notifyPanel.error("Failed to load pipeline runtime settings");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchSettings();
  }, [fetchSettings]);

  const testSettingValue = async (setting: string, value?: string) => {
    setTestResults((prev) => ({
      ...prev,
      [setting]: { success: false, message: "Testing...", testing: true },
    }));
    try {
      const res = await fetch("/api/admin/settings/pipelines/test-setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting, value }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.error || "Test failed");
      }
      setTestResults((prev) => ({
        ...prev,
        [setting]: {
          success: data.success,
          message: data.message,
          testing: false,
        },
      }));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Test failed";
      setTestResults((prev) => ({
        ...prev,
        [setting]: { success: false, message, testing: false },
      }));
    }
  };

  const handleAutoDetectConda = async () => {
    setAutoDetecting(true);
    setAutoDetectResult(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/auto-detect");
      const data = await res.json();
      if (!res.ok || !data?.detected) {
        setAutoDetectResult({
          success: false,
          message:
            data?.message || "No conda environment detected in the server process.",
        });
        return;
      }

      setExecSettings((prev) => ({
        ...prev,
        condaPath: data.condaBase || prev.condaPath,
        condaEnv: data.condaEnv || prev.condaEnv,
      }));
      clearTestResult("condaPath");
      setAutoDetectResult({
        success: true,
        message: `Detected ${data.condaEnv || "conda env"} at ${
          data.condaBase || "unknown path"
        }`,
      });
    } catch {
      setAutoDetectResult({
        success: false,
        message: "Auto-detect failed. Check server logs.",
      });
    } finally {
      setAutoDetecting(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const res = await fetch("/api/admin/settings/pipelines/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(execSettings),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save runtime settings");
      }

      setSaved(true);
      notifyPanel.success("Pipeline runtime settings saved");
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save execution settings:", error);
      notifyPanel.error(error instanceof Error ? error.message : "Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const jumpToSection = (sectionId: string) => {
    const section = document.getElementById(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-8">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Pipeline Runtime</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure scheduler, paths, and webhook diagnostics for Nextflow execution
          </p>
        </div>

        <div className="sticky top-16 z-30">
          <div className="rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Start with required runtime settings, then enable advanced tuning if needed.
            </p>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href="/admin/data-compute">Overview</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href="/admin/data-storage">Data Storage</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => jumpToSection("required-runtime")}
              >
                Required
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => jumpToSection("advanced-runtime")}
              >
                Advanced
              </Button>
            </div>
          </div>
        </div>

        <InfrastructureSetupStatus
          fixLinks={{
            dataPath: "/admin/data-storage#required-data-storage",
            runDir: "#required-runtime",
            conda: "#required-runtime",
            weblog: "#advanced-runtime",
          }}
        />

        <div id="required-runtime" className="scroll-mt-28">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <Server className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Required Configuration</h2>
            <Badge variant="secondary">Required</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Set scheduler mode, run directory, and conda environment used by pipeline runs.
          </p>

          <GlassCard className="p-6">
            <div className="space-y-6">
              <div className="flex items-start gap-4 pb-4 border-b">
                <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                  {execSettings.useSlurm ? (
                    <Server className="h-5 w-5" />
                  ) : (
                    <HardDrive className="h-5 w-5" />
                  )}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-2">
                    <h3 className="font-semibold">Scheduler</h3>
                    <Badge variant={execSettings.useSlurm ? "default" : "secondary"}>
                      {execSettings.useSlurm ? "SLURM Cluster" : "Local"}
                    </Badge>
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {execSettings.useSlurm
                      ? "Jobs will be submitted to the SLURM queue."
                      : "Pipelines will run directly on this server."}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Switch
                      id="runtime-use-slurm"
                      checked={execSettings.useSlurm}
                      onCheckedChange={(checked) => {
                        setExecSettings((prev) => ({ ...prev, useSlurm: checked }));
                        clearTestResult("slurm");
                      }}
                    />
                    <Label htmlFor="runtime-use-slurm">Use SLURM</Label>
                    {execSettings.useSlurm && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white"
                        onClick={() => testSettingValue("slurm")}
                        disabled={testResults.slurm?.testing}
                      >
                        {testResults.slurm?.testing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Test"
                        )}
                      </Button>
                    )}
                  </div>
                  {execSettings.useSlurm &&
                    testResults.slurm &&
                    !testResults.slurm.testing && (
                      <p
                        className={`text-xs flex items-center gap-1 mt-2 ${
                          testResults.slurm.success ? "text-green-600" : "text-red-600"
                        }`}
                      >
                        {testResults.slurm.success ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        {testResults.slurm.message}
                      </p>
                    )}
                </div>
              </div>

              {execSettings.useSlurm && (
                <div className="space-y-2 pb-4 border-b">
                  <Label htmlFor="runtime-slurm-queue">Queue/Partition</Label>
                  <Input
                    id="runtime-slurm-queue"
                    value={execSettings.slurmQueue}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        slurmQueue: e.target.value,
                      }))
                    }
                    placeholder="cpu"
                  />
                </div>
              )}

              <div className="space-y-4 pb-4 border-b">
                <div className="space-y-2">
                  <Label htmlFor="runtime-run-dir">Pipeline Run Directory</Label>
                  <div className="flex gap-2">
                    <Input
                      id="runtime-run-dir"
                      value={execSettings.pipelineRunDir}
                      onChange={(e) => {
                        setExecSettings((prev) => ({
                          ...prev,
                          pipelineRunDir: e.target.value,
                        }));
                        clearTestResult("pipelineRunDir");
                      }}
                      placeholder="/data/pipeline_runs"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-white"
                      onClick={() =>
                        testSettingValue("pipelineRunDir", execSettings.pipelineRunDir)
                      }
                      disabled={testResults.pipelineRunDir?.testing}
                    >
                      {testResults.pipelineRunDir?.testing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Test"
                      )}
                    </Button>
                  </div>
                  {testResults.pipelineRunDir &&
                    !testResults.pipelineRunDir.testing && (
                      <p
                        className={`text-xs flex items-center gap-1 ${
                          testResults.pipelineRunDir.success
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {testResults.pipelineRunDir.success ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        {testResults.pipelineRunDir.message}
                      </p>
                    )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="runtime-conda-path">Conda Installation Path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="runtime-conda-path"
                      value={execSettings.condaPath}
                      onChange={(e) => {
                        setExecSettings((prev) => ({
                          ...prev,
                          condaPath: e.target.value,
                        }));
                        clearTestResult("condaPath");
                      }}
                      placeholder="/opt/homebrew/Caskroom/miniconda/base"
                      className="flex-1"
                    />
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-white"
                      onClick={handleAutoDetectConda}
                      disabled={autoDetecting}
                    >
                      {autoDetecting ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Auto"
                      )}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="bg-white"
                      onClick={() => testSettingValue("condaPath", execSettings.condaPath)}
                      disabled={testResults.condaPath?.testing}
                    >
                      {testResults.condaPath?.testing ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        "Test"
                      )}
                    </Button>
                  </div>
                  {autoDetectResult && (
                    <p
                      className={`text-xs flex items-center gap-1 ${
                        autoDetectResult.success ? "text-green-600" : "text-red-600"
                      }`}
                    >
                      {autoDetectResult.success ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      {autoDetectResult.message}
                    </p>
                  )}
                  {testResults.condaPath && !testResults.condaPath.testing && (
                    <p
                      className={`text-xs flex items-center gap-1 ${
                        testResults.condaPath.success
                          ? "text-green-600"
                          : "text-red-600"
                      }`}
                    >
                      {testResults.condaPath.success ? (
                        <CheckCircle2 className="h-3 w-3" />
                      ) : (
                        <XCircle className="h-3 w-3" />
                      )}
                      {testResults.condaPath.message}
                    </p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="runtime-conda-env">Conda Environment Name</Label>
                  <Input
                    id="runtime-conda-env"
                    value={execSettings.condaEnv}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        condaEnv: e.target.value,
                      }))
                    }
                    placeholder="seqdesk-pipelines"
                  />
                </div>
              </div>
            </div>
          </GlassCard>
        </div>

        <div id="advanced-runtime" className="scroll-mt-28">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-base font-semibold">Advanced Configuration</h2>
              <Badge variant="outline">Optional</Badge>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="bg-white"
              onClick={() => setShowAdvanced((prev) => !prev)}
            >
              {showAdvanced ? (
                <>
                  <ChevronUp className="h-4 w-4 mr-1" />
                  Hide
                </>
              ) : (
                <>
                  <ChevronDown className="h-4 w-4 mr-1" />
                  Show
                </>
              )}
            </Button>
          </div>

          {showAdvanced && (
            <GlassCard className="p-6">
              <div className="space-y-4">
                {execSettings.useSlurm && (
                  <div className="grid gap-4 sm:grid-cols-2 pb-4 border-b">
                    <div className="space-y-2">
                      <Label htmlFor="runtime-slurm-cores">CPU Cores</Label>
                      <Input
                        id="runtime-slurm-cores"
                        type="number"
                        min={1}
                        value={execSettings.slurmCores}
                        onChange={(e) =>
                          setExecSettings((prev) => ({
                            ...prev,
                            slurmCores: parseIntOrFallback(e.target.value, 4),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="runtime-slurm-memory">Memory</Label>
                      <Input
                        id="runtime-slurm-memory"
                        value={execSettings.slurmMemory}
                        onChange={(e) =>
                          setExecSettings((prev) => ({
                            ...prev,
                            slurmMemory: e.target.value,
                          }))
                        }
                        placeholder="64GB"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="runtime-slurm-time">Time Limit (hours)</Label>
                      <Input
                        id="runtime-slurm-time"
                        type="number"
                        min={1}
                        value={execSettings.slurmTimeLimit}
                        onChange={(e) =>
                          setExecSettings((prev) => ({
                            ...prev,
                            slurmTimeLimit: parseIntOrFallback(e.target.value, 12),
                          }))
                        }
                      />
                    </div>
                    <div className="space-y-2 sm:col-span-2">
                      <Label htmlFor="runtime-slurm-options">
                        Additional SLURM Options
                      </Label>
                      <Input
                        id="runtime-slurm-options"
                        value={execSettings.slurmOptions}
                        onChange={(e) =>
                          setExecSettings((prev) => ({
                            ...prev,
                            slurmOptions: e.target.value,
                          }))
                        }
                        placeholder="--constraint=avx2 --account=mylab"
                      />
                    </div>
                  </div>
                )}

                <div className="space-y-2 pb-4 border-b">
                  <Label htmlFor="runtime-nextflow-profile">
                    Nextflow Profile Override
                  </Label>
                  <Input
                    id="runtime-nextflow-profile"
                    value={execSettings.nextflowProfile}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        nextflowProfile: e.target.value,
                      }))
                    }
                    placeholder="e.g. slurm,conda"
                  />
                </div>

                <div className="space-y-3 pb-4 border-b">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-medium">Per-Pipeline Defaults</h3>
                      <p className="text-xs text-muted-foreground">
                        Global target: {execSettings.useSlurm ? "SLURM" : "Local"}
                      </p>
                    </div>
                    <Badge variant="outline">
                      {installedPipelines.length} installed
                    </Badge>
                  </div>

                  {installedPipelines.length === 0 ? (
                    <div className="rounded-lg border border-dashed px-4 py-3 text-sm text-muted-foreground">
                      No pipeline packages are installed.
                    </div>
                  ) : (
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="min-w-[980px] w-full text-sm">
                        <thead className="border-b bg-muted/50 text-xs text-muted-foreground">
                          <tr>
                            <th className="px-3 py-2 text-left font-medium">Pipeline</th>
                            <th className="px-3 py-2 text-left font-medium">Target</th>
                            <th className="px-3 py-2 text-left font-medium">Queue</th>
                            <th className="px-3 py-2 text-left font-medium">Cores</th>
                            <th className="px-3 py-2 text-left font-medium">Memory</th>
                            <th className="px-3 py-2 text-left font-medium">Hours</th>
                            <th className="px-3 py-2 text-left font-medium">Options</th>
                            <th className="px-3 py-2 text-left font-medium">Profile</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y">
                          {installedPipelines.map((pipeline) => {
                            const override =
                              execSettings.pipelineOverrides[pipeline.pipelineId] || {};
                            const mode = override.mode || "inherit";
                            const slurm = override.slurm || {};
                            const slurmFieldsDisabled = mode === "local";

                            return (
                              <tr key={pipeline.pipelineId}>
                                <td className="px-3 py-2 align-top">
                                  <div className="font-medium">{pipeline.name}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {pipeline.pipelineId}
                                    {pipeline.category ? ` · ${pipeline.category}` : ""}
                                  </div>
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <select
                                    value={mode}
                                    onChange={(event) =>
                                      updatePipelineOverride(
                                        pipeline.pipelineId,
                                        (current) => ({
                                          ...current,
                                          mode: event.target.value as PipelineOverrideMode,
                                        })
                                      )
                                    }
                                    className="h-9 w-[128px] rounded-md border bg-background px-2 text-sm"
                                    aria-label={`Execution target for ${pipeline.name}`}
                                  >
                                    <option value="inherit">
                                      Inherit ({execSettings.useSlurm ? "SLURM" : "Local"})
                                    </option>
                                    <option value="local">Local</option>
                                    <option value="slurm">SLURM</option>
                                  </select>
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <Input
                                    value={slurm.queue || ""}
                                    disabled={slurmFieldsDisabled}
                                    onChange={(event) =>
                                      updatePipelineSlurmOverride(
                                        pipeline.pipelineId,
                                        "queue",
                                        event.target.value
                                      )
                                    }
                                    placeholder={execSettings.slurmQueue}
                                    className="h-9 w-[110px]"
                                  />
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <Input
                                    type="number"
                                    min={1}
                                    value={slurm.cores ?? ""}
                                    disabled={slurmFieldsDisabled}
                                    onChange={(event) =>
                                      updatePipelineSlurmOverride(
                                        pipeline.pipelineId,
                                        "cores",
                                        event.target.value
                                          ? parseIntOrFallback(event.target.value, execSettings.slurmCores)
                                          : undefined
                                      )
                                    }
                                    placeholder={String(execSettings.slurmCores)}
                                    className="h-9 w-[84px]"
                                  />
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <Input
                                    value={slurm.memory || ""}
                                    disabled={slurmFieldsDisabled}
                                    onChange={(event) =>
                                      updatePipelineSlurmOverride(
                                        pipeline.pipelineId,
                                        "memory",
                                        event.target.value
                                      )
                                    }
                                    placeholder={execSettings.slurmMemory}
                                    className="h-9 w-[100px]"
                                  />
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <Input
                                    type="number"
                                    min={1}
                                    value={slurm.timeLimit ?? ""}
                                    disabled={slurmFieldsDisabled}
                                    onChange={(event) =>
                                      updatePipelineSlurmOverride(
                                        pipeline.pipelineId,
                                        "timeLimit",
                                        event.target.value
                                          ? parseIntOrFallback(event.target.value, execSettings.slurmTimeLimit)
                                          : undefined
                                      )
                                    }
                                    placeholder={String(execSettings.slurmTimeLimit)}
                                    className="h-9 w-[84px]"
                                  />
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <Input
                                    value={slurm.options || ""}
                                    disabled={slurmFieldsDisabled}
                                    onChange={(event) =>
                                      updatePipelineSlurmOverride(
                                        pipeline.pipelineId,
                                        "options",
                                        event.target.value
                                      )
                                    }
                                    placeholder={execSettings.slurmOptions || "--account=lab"}
                                    className="h-9 w-[160px]"
                                  />
                                </td>
                                <td className="px-3 py-2 align-top">
                                  <Input
                                    value={override.nextflowProfile || ""}
                                    onChange={(event) =>
                                      updatePipelineOverride(
                                        pipeline.pipelineId,
                                        (current) => ({
                                          ...current,
                                          nextflowProfile: event.target.value,
                                        })
                                      )
                                    }
                                    placeholder={execSettings.nextflowProfile || "conda"}
                                    className="h-9 w-[130px]"
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>

                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="runtime-weblog-url">Nextflow Weblog URL</Label>
                    <div className="flex gap-2">
                      <Input
                        id="runtime-weblog-url"
                        value={execSettings.weblogUrl}
                        onChange={(e) => {
                          setExecSettings((prev) => ({
                            ...prev,
                            weblogUrl: e.target.value,
                          }));
                          clearTestResult("weblogUrl");
                        }}
                        placeholder="https://your-app.domain/api/pipelines/weblog"
                        className="flex-1"
                      />
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white"
                        onClick={() =>
                          testSettingValue(
                            "weblogUrl",
                            JSON.stringify({
                              url: execSettings.weblogUrl,
                              secret: execSettings.weblogSecret,
                            })
                          )
                        }
                        disabled={testResults.weblogUrl?.testing}
                      >
                        {testResults.weblogUrl?.testing ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          "Test"
                        )}
                      </Button>
                    </div>
                    {testResults.weblogUrl && !testResults.weblogUrl.testing && (
                      <p
                        className={`text-xs flex items-center gap-1 ${
                          testResults.weblogUrl.success
                            ? "text-green-600"
                            : "text-red-600"
                        }`}
                      >
                        {testResults.weblogUrl.success ? (
                          <CheckCircle2 className="h-3 w-3" />
                        ) : (
                          <XCircle className="h-3 w-3" />
                        )}
                        {testResults.weblogUrl.message}
                      </p>
                    )}
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="runtime-weblog-secret">Weblog Secret</Label>
                    <Input
                      id="runtime-weblog-secret"
                      type="password"
                      value={execSettings.weblogSecret}
                      onChange={(e) => {
                        setExecSettings((prev) => ({
                          ...prev,
                          weblogSecret: e.target.value,
                        }));
                        clearTestResult("weblogUrl");
                      }}
                      placeholder="shared secret token"
                    />
                  </div>
                </div>
              </div>
            </GlassCard>
          )}
        </div>

        <div className="flex items-center gap-3 pt-2">
          <Button
            onClick={handleSave}
            disabled={saving}
            variant="outline"
            className="bg-white"
          >
            {saving ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : saved ? (
              <Check className="h-4 w-4 mr-2 text-green-500" />
            ) : null}
            {saved ? "Saved!" : "Save Runtime Settings"}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
