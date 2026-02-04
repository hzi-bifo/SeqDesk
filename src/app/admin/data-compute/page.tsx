"use client";

import { useState, useEffect } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import {
  HardDrive,
  FolderOpen,
  Loader2,
  Check,
  CheckCircle2,
  XCircle,
  Server,
  Settings2,
} from "lucide-react";

interface SequencingFilesConfig {
  allowedExtensions: string[];
  scanDepth: number;
  ignorePatterns: string[];
  allowSingleEnd: boolean;
  autoAssign: boolean;
}

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

interface PathTestResult {
  valid: boolean;
  error?: string;
  resolvedPath?: string;
  totalFiles?: number;
  matchingFiles?: number;
  message?: string;
}

export default function DataComputePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Sequencing files settings
  const [dataBasePath, setDataBasePath] = useState("");
  const [seqFilesConfig, setSeqFilesConfig] = useState<SequencingFilesConfig>({
    allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
    scanDepth: 2,
    ignorePatterns: [],
    allowSingleEnd: true,
    autoAssign: false,
  });
  const [seqFilesSaved, setSeqFilesSaved] = useState(false);
  const [testingPath, setTestingPath] = useState(false);
  const [pathTestResult, setPathTestResult] = useState<PathTestResult | null>(null);

  // Pipeline execution settings
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
  const [testResults, setTestResults] = useState<Record<string, { success: boolean; message: string; testing?: boolean }>>({});
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectResult, setAutoDetectResult] = useState<{ success: boolean; message: string } | null>(null);

  useEffect(() => {
    fetchSequencingFilesSettings();
    fetchExecSettings();
  }, []);

  // Sequencing files settings
  const fetchSequencingFilesSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings/sequencing-files");
      const data = await res.json();
      setDataBasePath(data.dataBasePath || "");
      if (data.config) {
        setSeqFilesConfig({ ...data.config, allowSingleEnd: true });
      }
    } catch (error) {
      console.error("Failed to load sequencing files settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleSaveSequencingFiles = async () => {
    setSaving(true);
    setSeqFilesSaved(false);

    try {
      const configToSave = { ...seqFilesConfig, allowSingleEnd: true };
      await fetch("/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataBasePath,
          config: configToSave,
        }),
      });
      setSeqFilesSaved(true);
      setPathTestResult(null);
      setTimeout(() => setSeqFilesSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save sequencing files settings:", error);
      toast.error("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  const handleTestPath = async () => {
    if (!dataBasePath.trim()) {
      toast.error("Please enter a path first");
      return;
    }

    setTestingPath(true);
    setPathTestResult(null);

    try {
      const res = await fetch("/api/admin/settings/sequencing-files/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          basePath: dataBasePath,
          allowedExtensions: seqFilesConfig.allowedExtensions,
        }),
      });
      const result = await res.json();
      setPathTestResult(result);
    } catch (error) {
      console.error("Failed to test path:", error);
      setPathTestResult({ valid: false, error: "Failed to test path" });
    } finally {
      setTestingPath(false);
    }
  };

  // Pipeline execution settings
  const fetchExecSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings/pipelines/execution");
      if (res.ok) {
        const data = await res.json();
        if (data?.settings) {
          setExecSettings(data.settings);
        }
      }
    } catch (error) {
      console.error("Failed to load pipeline execution settings:", error);
    }
  };

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

  const handleSaveExecSettings = async () => {
    setSavingExec(true);
    setExecSaved(false);
    try {
      await fetch("/api/admin/settings/pipelines/execution", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(execSettings),
      });
      setExecSaved(true);
      setTimeout(() => setExecSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save execution settings:", error);
    }
    setSavingExec(false);
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
      <div className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight flex items-center gap-2">
          <Server className="h-6 w-6" />
          Data & Compute
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure data storage and pipeline execution settings
        </p>
      </div>

      {/* Sequencing Files Section */}
      <div>
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
            <HardDrive className="h-4 w-4 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Sequencing Files</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure where raw sequencing files are stored on the server
        </p>

        <GlassCard className="p-6">
          <div className="space-y-4">
            {/* Base Path */}
            <div className="space-y-2">
              <Label htmlFor="data-base-path" className="text-base font-medium">
                Data Base Path
              </Label>
              <p className="text-sm text-muted-foreground">
                Absolute path to the directory where sequencing files are stored (e.g., /data/sequencing)
              </p>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                  <Input
                    id="data-base-path"
                    value={dataBasePath}
                    onChange={(e) => {
                      setDataBasePath(e.target.value);
                      setPathTestResult(null);
                    }}
                    placeholder="/data/sequencing"
                    className="pl-10"
                    disabled={saving}
                  />
                </div>
                <Button
                  variant="outline"
                  onClick={handleTestPath}
                  disabled={saving || testingPath || !dataBasePath.trim()}
                >
                  {testingPath ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    "Test Path"
                  )}
                </Button>
              </div>

              {/* Test Result */}
              {pathTestResult && (
                <div
                  className={`mt-2 p-3 rounded-lg text-sm flex items-start gap-2 ${
                    pathTestResult.valid
                      ? "bg-green-50 text-green-800"
                      : "bg-red-50 text-red-800"
                  }`}
                >
                  {pathTestResult.valid ? (
                    <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  ) : (
                    <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                  )}
                  <div>
                    {pathTestResult.valid ? (
                      <>
                        <p className="font-medium">{pathTestResult.message}</p>
                        {pathTestResult.resolvedPath && (
                          <p className="text-xs mt-1 opacity-70">
                            Resolved path: {pathTestResult.resolvedPath}
                          </p>
                        )}
                      </>
                    ) : (
                      <p>{pathTestResult.error}</p>
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Allowed Extensions */}
            <div className="space-y-2">
              <Label className="text-base font-medium">Allowed File Extensions</Label>
              <p className="text-sm text-muted-foreground">
                File extensions to scan for (comma-separated)
              </p>
              <Input
                value={seqFilesConfig.allowedExtensions.join(", ")}
                onChange={(e) =>
                  setSeqFilesConfig({
                    ...seqFilesConfig,
                    allowedExtensions: e.target.value
                      .split(",")
                      .map((s) => s.trim())
                      .filter((s) => s),
                  })
                }
                placeholder=".fastq.gz, .fq.gz, .fastq, .fq"
                disabled={saving}
              />
            </div>

            {/* Save Button */}
            <div className="flex items-center gap-2 pt-2">
              <Button onClick={handleSaveSequencingFiles} disabled={saving}>
                {saving ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : seqFilesSaved ? (
                  <Check className="h-4 w-4 mr-2 text-green-500" />
                ) : null}
                {seqFilesSaved ? "Saved!" : "Save Settings"}
              </Button>
            </div>
          </div>
        </GlassCard>
      </div>

      {/* Compute & Pipelines Section */}
      <div className="mt-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <h2 className="text-lg font-semibold">Compute & Pipelines</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure Nextflow runtime, scheduler, and diagnostics for pipeline execution
        </p>

        <GlassCard className="p-6">
          <div className="space-y-6">
            {/* Scheduler */}
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
                    ? "Jobs will be submitted to the SLURM queue"
                    : "Pipelines will run directly on this server"}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <Switch
                    id="compute-use-slurm"
                    checked={execSettings.useSlurm}
                    onCheckedChange={(checked) =>
                      setExecSettings((prev) => ({ ...prev, useSlurm: checked }))
                    }
                  />
                  <Label htmlFor="compute-use-slurm">Use SLURM</Label>
                  {execSettings.useSlurm && (
                    <Button
                      variant="outline"
                      size="sm"
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
                {execSettings.useSlurm && testResults.slurm && !testResults.slurm.testing && (
                  <p className={`text-xs flex items-center gap-1 mt-2 ${testResults.slurm.success ? "text-green-600" : "text-red-600"}`}>
                    {testResults.slurm.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {testResults.slurm.message}
                  </p>
                )}
              </div>
            </div>

            {/* Runtime */}
            <div className="flex items-start gap-4 pb-4 border-b">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Settings2 className="h-5 w-5" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <h3 className="font-semibold">Runtime</h3>
                  <Badge variant="secondary">Conda</Badge>
                </div>
                <p className="text-sm text-muted-foreground">
                  SeqDesk runs nf-core pipelines using conda environments for tool resolution.
                </p>
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
                      setExecSettings((prev) => ({ ...prev, slurmQueue: e.target.value }))
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
                      setExecSettings((prev) => ({ ...prev, slurmCores: parseInt(e.target.value) || 4 }))
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="slurm-memory">Memory</Label>
                  <Input
                    id="slurm-memory"
                    value={execSettings.slurmMemory}
                    onChange={(e) =>
                      setExecSettings((prev) => ({ ...prev, slurmMemory: e.target.value }))
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
                      setExecSettings((prev) => ({ ...prev, slurmTimeLimit: parseInt(e.target.value) || 12 }))
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="slurm-options">Additional SLURM Options</Label>
                  <Input
                    id="slurm-options"
                    value={execSettings.slurmOptions}
                    onChange={(e) =>
                      setExecSettings((prev) => ({ ...prev, slurmOptions: e.target.value }))
                    }
                    placeholder="--constraint=avx2 --account=mylab"
                  />
                </div>
              </div>
            )}

            {/* Paths */}
            <div className="space-y-4 pb-4 border-b">
              <div className="space-y-2">
                <Label htmlFor="compute-run-dir">Pipeline Run Directory</Label>
                <div className="flex gap-2">
                  <Input
                    id="compute-run-dir"
                    value={execSettings.pipelineRunDir}
                    onChange={(e) =>
                      setExecSettings((prev) => ({ ...prev, pipelineRunDir: e.target.value }))
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
                    {testResults.pipelineRunDir?.testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
                  </Button>
                </div>
                {testResults.pipelineRunDir && !testResults.pipelineRunDir.testing && (
                  <p className={`text-xs flex items-center gap-1 ${testResults.pipelineRunDir.success ? "text-green-600" : "text-red-600"}`}>
                    {testResults.pipelineRunDir.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {testResults.pipelineRunDir.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="compute-conda-path">Conda Installation Path</Label>
                <div className="flex gap-2">
                  <Input
                    id="compute-conda-path"
                    value={execSettings.condaPath}
                    onChange={(e) =>
                      setExecSettings((prev) => ({ ...prev, condaPath: e.target.value }))
                    }
                    placeholder="/opt/homebrew/Caskroom/miniconda/base"
                    className="flex-1"
                  />
                  <Button variant="outline" size="sm" onClick={handleAutoDetectConda} disabled={autoDetecting}>
                    {autoDetecting ? <Loader2 className="h-4 w-4 animate-spin" /> : "Auto"}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => testSettingValue("condaPath", execSettings.condaPath)}
                    disabled={testResults.condaPath?.testing}
                  >
                    {testResults.condaPath?.testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
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
              </div>
              <div className="space-y-2">
                <Label htmlFor="compute-conda-env">Conda Environment Name</Label>
                <Input
                  id="compute-conda-env"
                  value={execSettings.condaEnv}
                  onChange={(e) =>
                    setExecSettings((prev) => ({ ...prev, condaEnv: e.target.value }))
                  }
                  placeholder="seqdesk-pipelines"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="compute-nextflow-profile">Nextflow Profile Override</Label>
                <Input
                  id="compute-nextflow-profile"
                  value={execSettings.nextflowProfile}
                  onChange={(e) =>
                    setExecSettings((prev) => ({ ...prev, nextflowProfile: e.target.value }))
                  }
                  placeholder="e.g. slurm,conda"
                />
              </div>
            </div>

            {/* Weblog Settings */}
            <div className="space-y-4 pb-4 border-b">
              <div className="space-y-2">
                <Label htmlFor="compute-weblog-url">Nextflow Weblog URL</Label>
                <div className="flex gap-2">
                  <Input
                    id="compute-weblog-url"
                    value={execSettings.weblogUrl}
                    onChange={(e) =>
                      setExecSettings((prev) => ({ ...prev, weblogUrl: e.target.value }))
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
                        JSON.stringify({ url: execSettings.weblogUrl, secret: execSettings.weblogSecret })
                      )
                    }
                    disabled={testResults.weblogUrl?.testing}
                  >
                    {testResults.weblogUrl?.testing ? <Loader2 className="h-4 w-4 animate-spin" /> : "Test"}
                  </Button>
                </div>
                {testResults.weblogUrl && !testResults.weblogUrl.testing && (
                  <p className={`text-xs flex items-center gap-1 ${testResults.weblogUrl.success ? "text-green-600" : "text-red-600"}`}>
                    {testResults.weblogUrl.success ? <CheckCircle2 className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
                    {testResults.weblogUrl.message}
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="compute-weblog-secret">Weblog Secret</Label>
                <Input
                  id="compute-weblog-secret"
                  type="password"
                  value={execSettings.weblogSecret}
                  onChange={(e) =>
                    setExecSettings((prev) => ({ ...prev, weblogSecret: e.target.value }))
                  }
                  placeholder="shared secret token"
                />
              </div>
            </div>

            {/* Save Button */}
            <div className="flex items-center gap-3">
              <Button onClick={handleSaveExecSettings} disabled={savingExec}>
                {savingExec ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : null}
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
    </PageContainer>
  );
}
