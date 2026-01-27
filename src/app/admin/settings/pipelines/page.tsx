"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Loader2, Dna, FlaskConical, Settings2, Server, HardDrive, Save, CheckCircle2, Eye, RefreshCw, XCircle } from "lucide-react";
import { PipelineDagViewer, DagNode, DagEdge, PipelineInfo } from "@/components/pipelines/PipelineDagViewer";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface ExecutionSettings {
  useSlurm: boolean;
  slurmQueue: string;
  slurmCores: number;
  slurmMemory: string;
  slurmTimeLimit: number;
  slurmOptions: string;
  runtimeMode: "conda";
  condaPath: string;
  condaEnv: string;
  nextflowProfile: string;
  pipelineRunDir: string;
  weblogUrl: string;
  weblogSecret: string;
}


interface PipelineConfig {
  pipelineId: string;
  name: string;
  description: string;
  category: string;
  version?: string;
  icon: string;
  enabled: boolean;
  config: Record<string, unknown>;
  configSchema: {
    properties: Record<string, {
      type: string;
      title: string;
      description?: string;
      default?: unknown;
    }>;
  };
  defaultConfig: Record<string, unknown>;
}

function getPipelineIcon(icon: string) {
  switch (icon) {
    case "Dna":
      return <Dna className="h-6 w-6" />;
    default:
      return <FlaskConical className="h-6 w-6" />;
  }
}

function getCategoryBadge(category: string) {
  switch (category) {
    case "analysis":
      return <Badge variant="default">Analysis</Badge>;
    case "submission":
      return <Badge variant="secondary">Submission</Badge>;
    case "qc":
      return <Badge variant="outline">QC</Badge>;
    default:
      return <Badge variant="outline">{category}</Badge>;
  }
}

export default function PipelineSettingsPage() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/settings/pipelines",
    fetcher
  );

  const { data: execData, mutate: mutateExec } = useSWR(
    "/api/admin/settings/pipelines/execution",
    fetcher
  );

  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [dagDialogOpen, setDagDialogOpen] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineConfig | null>(null);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [dagData, setDagData] = useState<{ nodes: DagNode[]; edges: DagEdge[]; pipeline?: PipelineInfo } | null>(null);
  const [loadingDag, setLoadingDag] = useState(false);

  // Execution settings state
  const [execSettings, setExecSettings] = useState<ExecutionSettings>({
    useSlurm: false,
    slurmQueue: "cpu",
    slurmCores: 4,
    slurmMemory: "64GB",
    slurmTimeLimit: 12,
    slurmOptions: "",
    runtimeMode: "conda",
    condaPath: "",
    condaEnv: "seqdesk-pipelines",
    nextflowProfile: "",
    pipelineRunDir: "/data/pipeline_runs",
    weblogUrl: "",
    weblogSecret: "",
  });
  const [savingExec, setSavingExec] = useState(false);
  const [execSaved, setExecSaved] = useState(false);

  // Test results state
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; testing?: boolean }>>({});
  const [detectedVersions, setDetectedVersions] = useState<{ nextflow?: string; nfcore?: string; conda?: string; java?: string; condaEnv?: string }>({});
  const [detectingVersions, setDetectingVersions] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectResult, setAutoDetectResult] = useState<{ success: boolean; message: string } | null>(null);

  // Test a specific setting
  const testSettingValue = async (setting: string, value?: string) => {
    setTestResults((prev) => ({ ...prev, [setting]: { success: false, message: "Testing...", testing: true } }));
    try {
      const res = await fetch("/api/admin/settings/pipelines/test-setting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ setting, value }),
      });
      const data = await res.json();
      setTestResults((prev) => ({ ...prev, [setting]: { success: data.success, message: data.message, testing: false } }));
    } catch {
      setTestResults((prev) => ({ ...prev, [setting]: { success: false, message: "Test failed", testing: false } }));
    }
  };

  // Detect installed versions
  const detectInstalledVersions = async () => {
    setDetectingVersions(true);
    try {
      const res = await fetch("/api/admin/settings/pipelines/test-setting");
      if (res.ok) {
        const data = await res.json();
        setDetectedVersions(data.versions || {});
      }
    } catch {
      // Ignore
    }
    setDetectingVersions(false);
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
          message: data?.message || "No conda environment detected in the server process.",
        });
        return;
      }

      setExecSettings((prev) => ({
        ...prev,
        condaPath: data.condaBase || prev.condaPath,
        condaEnv: data.condaEnv || prev.condaEnv,
      }));
      setAutoDetectResult({
        success: true,
        message: `Detected ${data.condaEnv || "conda env"} at ${data.condaBase || "unknown path"}`,
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

  // Detect versions on mount
  useEffect(() => {
    detectInstalledVersions();
  }, []);

  
  // Sync execution settings from API
  useEffect(() => {
    if (execData?.settings) {
      setExecSettings(execData.settings);
    }
  }, [execData]);

  const handleSaveExecSettings = async () => {
    setSavingExec(true);
    setExecSaved(false);
    try {
      await fetch("/api/admin/settings/pipelines/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(execSettings),
      });
      mutateExec();
      setExecSaved(true);
      setTimeout(() => setExecSaved(false), 3000);
      // Refresh detected versions after saving
      detectInstalledVersions();
    } catch (err) {
      console.error("Failed to save execution settings:", err);
    }
    setSavingExec(false);
  };

  const handleToggleEnabled = async (pipeline: PipelineConfig) => {
    setSaving(true);
    try {
      await fetch("/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: pipeline.pipelineId,
          enabled: !pipeline.enabled,
          config: pipeline.config,
        }),
      });
      mutate();
    } catch (err) {
      console.error("Failed to toggle pipeline:", err);
    }
    setSaving(false);
  };

  const openConfigDialog = (pipeline: PipelineConfig) => {
    setSelectedPipeline(pipeline);
    setLocalConfig({ ...pipeline.config });
    setConfigDialogOpen(true);
  };

  const openDagDialog = async (pipeline: PipelineConfig) => {
    setSelectedPipeline(pipeline);
    setDagData(null);
    setDagDialogOpen(true);
    setLoadingDag(true);

    try {
      const res = await fetch(`/api/admin/settings/pipelines/${pipeline.pipelineId}/dag`);
      if (res.ok) {
        const data = await res.json();
        setDagData(data);
      }
    } catch (err) {
      console.error("Failed to load pipeline DAG:", err);
    }
    setLoadingDag(false);
  };

  const handleSaveConfig = async () => {
    if (!selectedPipeline) return;

    setSaving(true);
    try {
      await fetch("/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: selectedPipeline.pipelineId,
          enabled: selectedPipeline.enabled,
          config: localConfig,
        }),
      });
      mutate();
      setConfigDialogOpen(false);
    } catch (err) {
      console.error("Failed to save config:", err);
    }
    setSaving(false);
  };

  const handleResetToDefaults = () => {
    if (selectedPipeline) {
      setLocalConfig({ ...selectedPipeline.defaultConfig });
    }
  };

  return (
    <PageContainer maxWidth="medium">
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Pipeline Configuration</h1>
        <p className="text-muted-foreground">
          Enable and configure analysis pipelines
        </p>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : error ? (
        <div className="text-center py-12 text-destructive">
          Failed to load pipeline configurations
        </div>
      ) : (
        <div className="space-y-4">
          {data?.pipelines?.map((pipeline: PipelineConfig) => (
            <GlassCard key={pipeline.pipelineId}>
              <div className="flex items-start gap-4">
                <div className="p-3 bg-muted rounded-lg">
                  {getPipelineIcon(pipeline.icon)}
                </div>
                <div className="flex-1">
                  <div className="flex items-center gap-3 mb-1">
                    <h3 className="font-semibold">{pipeline.name}</h3>
                    {getCategoryBadge(pipeline.category)}
                    {pipeline.version && (
                      <span className="text-xs text-muted-foreground">
                        v{pipeline.version}
                      </span>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground mb-3">
                    {pipeline.description}
                  </p>
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Switch
                        id={`enable-${pipeline.pipelineId}`}
                        checked={pipeline.enabled}
                        onCheckedChange={() => handleToggleEnabled(pipeline)}
                        disabled={saving}
                      />
                      <Label htmlFor={`enable-${pipeline.pipelineId}`}>
                        {pipeline.enabled ? "Enabled" : "Disabled"}
                      </Label>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openDagDialog(pipeline)}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View Pipeline
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => openConfigDialog(pipeline)}
                    >
                      <Settings2 className="h-4 w-4 mr-2" />
                      Configure
                    </Button>
                  </div>
                </div>
              </div>
            </GlassCard>
          ))}

          {(!data?.pipelines || data.pipelines.length === 0) && (
            <div className="text-center py-12 text-muted-foreground">
              No pipelines available
            </div>
          )}
        </div>
      )}

      {/* Compute Settings Section */}
      <div className="mt-8">
        <div className="mb-4">
          <h2 className="text-xl font-semibold">Compute Settings</h2>
          <p className="text-sm text-muted-foreground">
            Configure how pipelines are executed on your infrastructure
          </p>
        </div>

        <GlassCard>
          <div className="space-y-6">
            {/* Scheduler */}
            <div className="flex items-start gap-4 pb-4 border-b">
              <div className="p-3 bg-muted rounded-lg">
                {execSettings.useSlurm ? (
                  <Server className="h-6 w-6" />
                ) : (
                  <HardDrive className="h-6 w-6" />
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
                    ? "Jobs will be submitted to the SLURM queue"
                    : "Pipelines will run directly on this server"}
                </p>
                <div className="flex items-center gap-2">
                  <Switch
                    id="use-slurm"
                    checked={execSettings.useSlurm}
                    onCheckedChange={(checked) =>
                      setExecSettings((prev) => ({ ...prev, useSlurm: checked }))
                    }
                  />
                  <Label htmlFor="use-slurm">Use SLURM</Label>
                </div>
              </div>
            </div>

            {/* Runtime */}
            <div className="flex items-start gap-4 pb-4 border-b">
              <div className="p-3 bg-muted rounded-lg">
                <Settings2 className="h-6 w-6" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold">Runtime</h3>
                  <Badge variant="secondary">Conda</Badge>
                </div>
                <p className="text-sm text-muted-foreground mb-3">
                  SeqDesk runs nf-core pipelines using conda environments for tool resolution.
                </p>
                <div className="text-xs text-muted-foreground">
                  Default Nextflow profile: <span className="font-medium">conda</span>
                </div>
              </div>
            </div>

            {/* SLURM Settings */}
            {execSettings.useSlurm && (
              <div className="grid gap-4 sm:grid-cols-2 pb-4 border-b">
                <div className="space-y-2">
                  <Label htmlFor="slurm-queue">Queue/Partition</Label>
                  <Input
                    id="slurm-queue"
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
                <div className="space-y-2">
                  <Label htmlFor="slurm-cores">CPU Cores</Label>
                  <Input
                    id="slurm-cores"
                    type="number"
                    min={1}
                    value={execSettings.slurmCores}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        slurmCores: parseInt(e.target.value) || 4,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slurm-memory">Memory</Label>
                  <Input
                    id="slurm-memory"
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
                  <Label htmlFor="slurm-time">Time Limit (hours)</Label>
                  <Input
                    id="slurm-time"
                    type="number"
                    min={1}
                    value={execSettings.slurmTimeLimit}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        slurmTimeLimit: parseInt(e.target.value) || 12,
                      }))
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="slurm-options">Additional SLURM Options</Label>
                  <Input
                    id="slurm-options"
                    value={execSettings.slurmOptions}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        slurmOptions: e.target.value,
                      }))
                    }
                    placeholder="--constraint=avx2 --account=mylab"
                  />
                  <p className="text-xs text-muted-foreground">
                    Extra sbatch flags (optional)
                  </p>
                </div>
              </div>
            )}

            {/* Paths */}
            <div className="space-y-4 pb-4 border-b">
              <div className="space-y-2">
                <Label htmlFor="run-dir">Pipeline Run Directory</Label>
                <div className="flex gap-2">
                  <Input
                    id="run-dir"
                    value={execSettings.pipelineRunDir}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        pipelineRunDir: e.target.value,
                      }))
                    }
                    placeholder="/data/pipeline_runs"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testSettingValue("pipelineRunDir", execSettings.pipelineRunDir)}
                    disabled={testResults.pipelineRunDir?.testing}
                  >
                    {testResults.pipelineRunDir?.testing ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      "Test"
                    )}
                  </Button>
                </div>
                {testResults.pipelineRunDir && !testResults.pipelineRunDir.testing && (
                  <p className={`text-xs flex items-center gap-1 ${testResults.pipelineRunDir.success ? "text-green-600" : "text-red-600"}`}>
                    {testResults.pipelineRunDir.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {testResults.pipelineRunDir.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Base directory where pipeline outputs will be stored
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="conda-path">Conda/Mamba Installation Path (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    id="conda-path"
                    value={execSettings.condaPath}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        condaPath: e.target.value,
                      }))
                    }
                    placeholder="/opt/homebrew/Caskroom/miniconda/base"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
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
                  <p className={`text-xs flex items-center gap-1 ${autoDetectResult.success ? "text-green-600" : "text-red-600"}`}>
                    {autoDetectResult.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {autoDetectResult.message}
                  </p>
                )}
                {testResults.condaPath && !testResults.condaPath.testing && (
                  <p className={`text-xs flex items-center gap-1 ${testResults.condaPath.success ? "text-green-600" : "text-red-600"}`}>
                    {testResults.condaPath.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {testResults.condaPath.message}
                  </p>
                )}
                <p className="text-xs text-muted-foreground">
                  Path to conda/mamba base directory (e.g., /opt/homebrew/Caskroom/miniconda/base)
                </p>
                {!execSettings.condaPath && (
                  <p className="text-xs text-amber-600">
                    Conda path is not set - add the path or click Auto.
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="conda-env">Conda Environment Name</Label>
                <Input
                  id="conda-env"
                  value={execSettings.condaEnv}
                  onChange={(e) =>
                    setExecSettings((prev) => ({
                      ...prev,
                      condaEnv: e.target.value,
                    }))
                  }
                  placeholder="seqdesk-pipelines"
                />
                <p className="text-xs text-muted-foreground">
                  Environment activated when a conda path is configured
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="nextflow-profile">Nextflow Profile Override (optional)</Label>
                <Input
                  id="nextflow-profile"
                  value={execSettings.nextflowProfile}
                  onChange={(e) =>
                    setExecSettings((prev) => ({
                      ...prev,
                      nextflowProfile: e.target.value,
                    }))
                  }
                  placeholder="e.g. slurm,conda"
                />
                <p className="text-xs text-muted-foreground">
                  Overrides the default conda profile (comma-separated). Leave blank to use conda.
                </p>
              </div>
            </div>

            {/* Weblog Settings */}
            <div className="space-y-4 pb-4 border-b">
              <div className="space-y-2">
                <Label htmlFor="weblog-url">Nextflow Weblog URL (optional)</Label>
                <div className="flex gap-2">
                  <Input
                    id="weblog-url"
                    value={execSettings.weblogUrl}
                    onChange={(e) =>
                      setExecSettings((prev) => ({
                        ...prev,
                        weblogUrl: e.target.value,
                      }))
                    }
                    placeholder="https://your-app.domain/api/pipelines/weblog"
                    className="flex-1"
                  />
                  <Button
                    variant="outline"
                    size="sm"
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
                <p className="text-xs text-muted-foreground">
                  Used for real-time pipeline progress updates from Nextflow
                </p>
              </div>
              <div className="space-y-2">
                <Label htmlFor="weblog-secret">Weblog Secret (optional)</Label>
                <Input
                  id="weblog-secret"
                  type="password"
                  value={execSettings.weblogSecret}
                  onChange={(e) =>
                    setExecSettings((prev) => ({
                      ...prev,
                      weblogSecret: e.target.value,
                    }))
                  }
                  placeholder="shared secret token"
                />
                <p className="text-xs text-muted-foreground">
                  If set, the webhook will require this token
                </p>
              </div>
            </div>

            {/* Detected Versions */}
            <div className="space-y-3 pb-4 border-b">
              <div className="flex items-center justify-between">
                <Label className="flex items-center gap-2">
                  Detected Tool Versions
                  {detectingVersions && <Loader2 className="h-3 w-3 animate-spin" />}
                </Label>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={detectInstalledVersions}
                  disabled={detectingVersions}
                  className="h-7 text-xs"
                >
                  <RefreshCw className={`h-3 w-3 mr-1 ${detectingVersions ? "animate-spin" : ""}`} />
                  Refresh
                </Button>
              </div>
              {detectedVersions.condaEnv && (
                <p className="text-xs text-muted-foreground mb-2">
                  Using conda environment: <span className="font-mono font-medium">{detectedVersions.condaEnv}</span>
                </p>
              )}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                <div className={`p-2 rounded ${detectedVersions.nextflow ? "bg-green-50" : "bg-muted"}`}>
                  <p className="text-xs text-muted-foreground">Nextflow</p>
                  <p className="font-mono">{detectedVersions.nextflow || "Not found"}</p>
                </div>
                <div className={`p-2 rounded ${detectedVersions.java ? "bg-green-50" : "bg-muted"}`}>
                  <p className="text-xs text-muted-foreground">Java</p>
                  <p className="font-mono">{detectedVersions.java ? `Java ${detectedVersions.java}` : "Not found"}</p>
                </div>
                <div className={`p-2 rounded ${detectedVersions.nfcore ? "bg-green-50" : "bg-muted"}`}>
                  <p className="text-xs text-muted-foreground">nf-core</p>
                  <p className="font-mono">{detectedVersions.nfcore || "Not found"}</p>
                </div>
                <div className={`p-2 rounded ${detectedVersions.conda ? "bg-green-50" : "bg-muted"}`}>
                  <p className="text-xs text-muted-foreground">Conda</p>
                  <p className="font-mono">{detectedVersions.conda || "Not found"}</p>
                </div>
              </div>
            </div>

            {/* Save Button */}
            <div className="flex items-center gap-3 pt-4 border-t">
              <Button onClick={handleSaveExecSettings} disabled={savingExec}>
                {savingExec ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save Settings
              </Button>
              {execSaved && (
                <span className="text-sm text-green-600 flex items-center gap-1">
                  <CheckCircle2 className="h-4 w-4" />
                  Saved
                </span>
              )}
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Configuration Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              Configure {selectedPipeline?.name}
            </DialogTitle>
            <DialogDescription>
              Adjust pipeline-specific settings
            </DialogDescription>
          </DialogHeader>

          {selectedPipeline && (
            <div className="space-y-4 py-4">
              {Object.entries(selectedPipeline.configSchema.properties).map(
                ([key, schema]) => (
                  <div key={key} className="space-y-2">
                    {schema.type === "boolean" ? (
                      <div className="flex items-start gap-3">
                        <Checkbox
                          id={key}
                          checked={localConfig[key] as boolean}
                          onCheckedChange={(checked) =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              [key]: checked,
                            }))
                          }
                        />
                        <div className="grid gap-1.5 leading-none">
                          <Label htmlFor={key}>{schema.title}</Label>
                          {schema.description && (
                            <p className="text-sm text-muted-foreground">
                              {schema.description}
                            </p>
                          )}
                        </div>
                      </div>
                    ) : (
                      <div className="space-y-1">
                        <Label htmlFor={key}>{schema.title}</Label>
                        <input
                          id={key}
                          type={schema.type === "number" ? "number" : "text"}
                          value={String(localConfig[key] || "")}
                          onChange={(e) =>
                            setLocalConfig((prev) => ({
                              ...prev,
                              [key]:
                                schema.type === "number"
                                  ? Number(e.target.value)
                                  : e.target.value,
                            }))
                          }
                          className="w-full px-3 py-2 border rounded-md bg-background"
                        />
                        {schema.description && (
                          <p className="text-sm text-muted-foreground">
                            {schema.description}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                )
              )}
            </div>
          )}

          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={handleResetToDefaults}>
              Reset to Defaults
            </Button>
            <Button onClick={handleSaveConfig} disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save Changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline DAG Dialog */}
      <Dialog open={dagDialogOpen} onOpenChange={setDagDialogOpen}>
        <DialogContent className="max-w-6xl w-[95vw] h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedPipeline && getPipelineIcon(selectedPipeline.icon)}
              {selectedPipeline?.name} Workflow
            </DialogTitle>
            <DialogDescription>
              {selectedPipeline?.description}
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 min-h-0 py-4">
            {loadingDag ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : dagData ? (
              <PipelineDagViewer
                nodes={dagData.nodes}
                edges={dagData.edges}
                pipeline={dagData.pipeline}
                className="h-full"
              />
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                Pipeline workflow not available
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDagDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
