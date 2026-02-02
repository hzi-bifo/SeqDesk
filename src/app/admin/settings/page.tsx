"use client";

import { useState, useEffect } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Settings, Settings2, Users, Loader2, Database, AlertTriangle, FileText, Check, HardDrive, FolderOpen, CheckCircle2, XCircle, FileJson, RefreshCw, Download, ArrowUpCircle, Server } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";

const DEFAULT_POST_SUBMISSION_INSTRUCTIONS = `## Thank you for your submission!

Your sequencing order has been received and is now being processed.

### Next Steps

1. **Prepare your samples** according to the guidelines provided
2. **Label each sample** with the Sample ID shown in your order
3. **Ship samples to:**

   Sequencing Facility
   123 Science Drive
   Lab Building, Room 456
   City, State 12345

4. **Include a printed copy** of your order summary in the package

### Important Notes

- Samples should be shipped on dry ice for overnight delivery
- Please notify us when samples are shipped by emailing sequencing@example.com
- Processing typically begins within 3-5 business days of sample receipt

### Questions?

Contact us at sequencing@example.com or call (555) 123-4567.`;

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

interface TestFilesResult {
  success: boolean;
  error?: string;
  createdPath?: string;
  folderName?: string;
  filesCreated?: number;
  pairedCount?: number;
  singleEndCount?: number;
  extension?: string;
}

export default function SettingsPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [departmentSharing, setDepartmentSharing] = useState(false);
  const [allowDeleteSubmittedOrders, setAllowDeleteSubmittedOrders] = useState(false);
  const [postSubmissionInstructions, setPostSubmissionInstructions] = useState("");
  const [instructionsSaved, setInstructionsSaved] = useState(false);

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
  const [generatingTestFiles, setGeneratingTestFiles] = useState(false);
  const [testFilesResult, setTestFilesResult] = useState<TestFilesResult | null>(null);

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
  const [detectedVersions, setDetectedVersions] = useState<{ nextflow?: string; nfcore?: string; conda?: string; java?: string; condaEnv?: string }>({});
  const [detectingVersions, setDetectingVersions] = useState(false);
  const [autoDetecting, setAutoDetecting] = useState(false);
  const [autoDetectResult, setAutoDetectResult] = useState<{ success: boolean; message: string } | null>(null);

  // Config status
  const [configStatus, setConfigStatus] = useState<{
    config: Record<string, unknown>;
    sources: Record<string, string>;
    filePath?: string;
    loadedAt?: string;
  } | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(false);

  // Update system
  const [updateInfo, setUpdateInfo] = useState<{
    currentVersion: string;
    updateAvailable: boolean;
    latest?: {
      version: string;
      releaseNotes?: string;
      downloadUrl?: string;
    };
    error?: string;
  } | null>(null);
  const [checkingUpdate, setCheckingUpdate] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [updateProgress, setUpdateProgress] = useState<string | null>(null);

  useEffect(() => {
    fetchSettings();
    fetchSequencingFilesSettings();
    fetchExecSettings();
    detectInstalledVersions();
    fetchConfigStatus();
    checkForUpdates();
  }, []);

  const fetchConfigStatus = async () => {
    setLoadingConfig(true);
    try {
      const res = await fetch("/api/admin/config/status");
      if (res.ok) {
        const data = await res.json();
        setConfigStatus(data);
      }
    } catch (error) {
      console.error("Failed to load config status:", error);
    } finally {
      setLoadingConfig(false);
    }
  };

  const checkForUpdates = async () => {
    setCheckingUpdate(true);
    try {
      const res = await fetch("/api/admin/updates");
      if (res.ok) {
        const data = await res.json();
        setUpdateInfo(data);
      }
    } catch (error) {
      console.error("Failed to check for updates:", error);
    } finally {
      setCheckingUpdate(false);
    }
  };

  const performUpdate = async () => {
    if (!updateInfo?.updateAvailable || !updateInfo.latest) return;

    const confirmed = window.confirm(
      `Update to v${updateInfo.latest.version}?\n\n` +
      `This will:\n` +
      `1. Download the new version\n` +
      `2. Backup your database\n` +
      `3. Install the update\n` +
      `4. Restart the server\n\n` +
      `The app will be unavailable for a few seconds during restart.`
    );

    if (!confirmed) return;

    setUpdating(true);
    setUpdateProgress("Starting update...");

    try {
      const res = await fetch("/api/admin/updates/install", {
        method: "POST",
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Update failed");
      }

      setUpdateProgress("Update installed! Restarting server...");
      toast.success("Update installed! The page will reload shortly.");

      // Wait for server to restart, then reload
      setTimeout(() => {
        window.location.reload();
      }, 5000);
    } catch (error) {
      console.error("Update failed:", error);
      toast.error(error instanceof Error ? error.message : "Update failed");
      setUpdateProgress(null);
      setUpdating(false);
    }
  };

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings/access");
      const data = await res.json();
      setDepartmentSharing(data.departmentSharing ?? false);
      setAllowDeleteSubmittedOrders(data.allowDeleteSubmittedOrders ?? false);
      setPostSubmissionInstructions(data.postSubmissionInstructions ?? DEFAULT_POST_SUBMISSION_INSTRUCTIONS);
    } catch (error) {
      console.error("Failed to load settings:", error);
    } finally {
      setLoading(false);
    }
  };

  const handleDepartmentSharingChange = async (enabled: boolean) => {
    setSaving(true);
    setDepartmentSharing(enabled);

    try {
      await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ departmentSharing: enabled }),
      });
    } catch (error) {
      console.error("Failed to save setting:", error);
      // Revert on error
      setDepartmentSharing(!enabled);
    } finally {
      setSaving(false);
    }
  };

  const handleAllowDeleteSubmittedChange = async (enabled: boolean) => {
    setSaving(true);
    setAllowDeleteSubmittedOrders(enabled);

    try {
      await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowDeleteSubmittedOrders: enabled }),
      });
    } catch (error) {
      console.error("Failed to save setting:", error);
      // Revert on error
      setAllowDeleteSubmittedOrders(!enabled);
    } finally {
      setSaving(false);
    }
  };

  const handleSaveInstructions = async () => {
    setSaving(true);
    setInstructionsSaved(false);

    try {
      await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postSubmissionInstructions }),
      });
      setInstructionsSaved(true);
      setTimeout(() => setInstructionsSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save instructions:", error);
    } finally {
      setSaving(false);
    }
  };

  const handleResetInstructions = () => {
    setPostSubmissionInstructions(DEFAULT_POST_SUBMISSION_INSTRUCTIONS);
  };

  // Sequencing files settings
  const fetchSequencingFilesSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings/sequencing-files");
      const data = await res.json();
      setDataBasePath(data.dataBasePath || "");
      if (data.config) {
        setSeqFilesConfig(data.config);
      }
    } catch (error) {
      console.error("Failed to load sequencing files settings:", error);
    }
  };

  const handleSaveSequencingFiles = async () => {
    setSaving(true);
    setSeqFilesSaved(false);

    try {
      await fetch("/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataBasePath,
          config: seqFilesConfig,
        }),
      });
      setSeqFilesSaved(true);
      setPathTestResult(null); // Clear test result after save
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

  const handleGenerateTestFiles = async () => {
    if (!dataBasePath.trim()) {
      toast.error("Please configure a data base path first");
      return;
    }

    setGeneratingTestFiles(true);
    setTestFilesResult(null);

    try {
      const res = await fetch("/api/admin/settings/sequencing-files/simulate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const result = await res.json();

      if (!res.ok) {
        throw new Error(result.error || "Failed to create test files");
      }

      setTestFilesResult({ success: true, ...result });
      toast.success(`Created ${result.filesCreated} test files`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to create test files";
      setTestFilesResult({ success: false, error: message });
      toast.error(message);
    } finally {
      setGeneratingTestFiles(false);
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
      detectInstalledVersions();
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
          <Settings className="h-6 w-6" />
          General Settings
        </h1>
        <p className="text-muted-foreground mt-1">
          Configure platform-wide settings
        </p>
      </div>

      {/* Access & Sharing */}
      <GlassCard className="p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-blue-100 flex items-center justify-center">
            <Users className="h-5 w-5 text-blue-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Access & Sharing</h2>
            <p className="text-sm text-muted-foreground">
              Control how users can access and share orders
            </p>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="department-sharing" className="text-base font-medium">
                Department Sharing
              </Label>
              <p className="text-sm text-muted-foreground">
                Allow users in the same department to view and edit each other&apos;s orders.
                When disabled, users can only see their own orders.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                id="department-sharing"
                checked={departmentSharing}
                onCheckedChange={handleDepartmentSharingChange}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Data Handling */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-amber-100 flex items-center justify-center">
            <Database className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Data Handling</h2>
            <p className="text-sm text-muted-foreground">
              Control data deletion and modification policies
            </p>
          </div>
        </div>

        <div className="border-t pt-4">
          <div className="flex items-center justify-between">
            <div className="space-y-1">
              <Label htmlFor="allow-delete-submitted" className="text-base font-medium flex items-center gap-2">
                Allow Deletion of Submitted Orders
                <AlertTriangle className="h-4 w-4 text-amber-500" />
              </Label>
              <p className="text-sm text-muted-foreground">
                When enabled, facility admins can delete orders even after they have been submitted.
                This is useful for testing but should be disabled in production to prevent data loss.
              </p>
            </div>
            <div className="flex items-center gap-2">
              {saving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
              <Switch
                id="allow-delete-submitted"
                checked={allowDeleteSubmittedOrders}
                onCheckedChange={handleAllowDeleteSubmittedChange}
                disabled={saving}
              />
            </div>
          </div>
        </div>
      </GlassCard>

      {/* Post-Submission Instructions */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center">
            <FileText className="h-5 w-5 text-green-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Post-Submission Instructions</h2>
            <p className="text-sm text-muted-foreground">
              Instructions shown to users after they submit an order (supports Markdown)
            </p>
          </div>
        </div>

        <div className="border-t pt-4 space-y-4">
          <div>
            <Textarea
              value={postSubmissionInstructions}
              onChange={(e) => setPostSubmissionInstructions(e.target.value)}
              placeholder="Enter instructions shown to users after order submission..."
              className="min-h-[300px] font-mono text-sm"
              disabled={saving}
            />
            <p className="text-xs text-muted-foreground mt-2">
              Use Markdown formatting: **bold**, *italic*, ## headings, - lists, etc.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <Button onClick={handleSaveInstructions} disabled={saving}>
              {saving ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : instructionsSaved ? (
                <Check className="h-4 w-4 mr-2 text-green-500" />
              ) : null}
              {instructionsSaved ? "Saved!" : "Save Instructions"}
            </Button>
            <Button variant="outline" onClick={handleResetInstructions} disabled={saving}>
              Reset to Default
            </Button>
          </div>
        </div>
      </GlassCard>

      {/* Sequencing Files Settings */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="h-10 w-10 rounded-lg bg-violet-100 flex items-center justify-center">
            <HardDrive className="h-5 w-5 text-violet-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold">Sequencing Files</h2>
            <p className="text-sm text-muted-foreground">
              Configure where raw sequencing files are stored on the server
            </p>
          </div>
        </div>

        <div className="border-t pt-4 space-y-4">
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

          {/* Options */}
          <div className="space-y-3 pt-2">
            <div className="flex items-center justify-between">
              <div className="space-y-1">
                <Label className="text-sm font-medium">Allow Single-End Files</Label>
                <p className="text-xs text-muted-foreground">
                  Allow files without R2 pair to be assigned as single-end reads
                </p>
              </div>
              <Switch
                checked={seqFilesConfig.allowSingleEnd}
                onCheckedChange={(checked) =>
                  setSeqFilesConfig({ ...seqFilesConfig, allowSingleEnd: checked })
                }
                disabled={saving}
              />
            </div>
          </div>

          {/* Test Files */}
          <div className="space-y-2 pt-2">
            <Label className="text-base font-medium">Test Data</Label>
            <p className="text-sm text-muted-foreground">
              Create dummy FASTQ files in a new subfolder for testing auto-detect and the file browser.
            </p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                onClick={handleGenerateTestFiles}
                disabled={saving || generatingTestFiles || !dataBasePath.trim()}
              >
                {generatingTestFiles ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : null}
                Generate Test Files
              </Button>
            </div>

            {testFilesResult && (
              <div
                className={`mt-2 p-3 rounded-lg text-sm flex items-start gap-2 ${
                  testFilesResult.success
                    ? "bg-green-50 text-green-800"
                    : "bg-red-50 text-red-800"
                }`}
              >
                {testFilesResult.success ? (
                  <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
                ) : (
                  <XCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                )}
                <div>
                  {testFilesResult.success ? (
                    <>
                      <p className="font-medium">
                        Created {testFilesResult.filesCreated} file(s)
                        {typeof testFilesResult.pairedCount === "number"
                          ? ` (${testFilesResult.pairedCount} paired, ${testFilesResult.singleEndCount} single-end)`
                          : ""}
                      </p>
                      {testFilesResult.folderName && (
                        <p className="text-xs mt-1 opacity-70">
                          Folder: {testFilesResult.folderName}
                        </p>
                      )}
                      {testFilesResult.extension && (
                        <p className="text-xs mt-1 opacity-70">
                          Extension: {testFilesResult.extension}
                        </p>
                      )}
                    </>
                  ) : (
                    <p>{testFilesResult.error}</p>
                  )}
                </div>
              </div>
            )}
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

      {/* Compute & Pipelines */}
      <section id="compute">
        <GlassCard className="p-6 mt-6">
          <div className="flex items-center gap-3 mb-4">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <Server className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Compute & Pipelines</h2>
              <p className="text-sm text-muted-foreground">
                Configure Nextflow runtime, scheduler, and diagnostics for pipeline execution
              </p>
            </div>
          </div>

          <div className="border-t pt-4 space-y-6">
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
                <div className="flex items-center gap-2">
                  <Switch
                    id="compute-use-slurm"
                    checked={execSettings.useSlurm}
                    onCheckedChange={(checked) =>
                      setExecSettings((prev) => ({ ...prev, useSlurm: checked }))
                    }
                  />
                  <Label htmlFor="compute-use-slurm">Use SLURM</Label>
                </div>
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
                  Using: <span className="font-mono font-medium">{detectedVersions.condaEnv}</span>
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
      </section>

      {/* Software Updates */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className={`h-10 w-10 rounded-lg flex items-center justify-center ${
              updateInfo?.updateAvailable ? "bg-blue-100" : "bg-slate-100"
            }`}>
              <ArrowUpCircle className={`h-5 w-5 ${
                updateInfo?.updateAvailable ? "text-blue-600" : "text-slate-600"
              }`} />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Software Updates</h2>
              <p className="text-sm text-muted-foreground">
                Check for and install SeqDesk updates
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={checkForUpdates}
            disabled={checkingUpdate || updating}
          >
            {checkingUpdate ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="border-t pt-4">
          {updateInfo ? (
            <div className="space-y-4">
              {/* Current Version */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Current version</span>
                <Badge variant="outline">v{updateInfo.currentVersion}</Badge>
              </div>

              {/* Latest Version */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Latest version</span>
                <Badge variant={updateInfo.updateAvailable ? "default" : "outline"}>
                  v{updateInfo.latest?.version || updateInfo.currentVersion}
                </Badge>
              </div>

              {/* Update Status */}
              {updateInfo.updateAvailable && updateInfo.latest ? (
                <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Download className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div className="flex-1">
                      <p className="font-medium text-blue-900">
                        Update available: v{updateInfo.latest.version}
                      </p>
                      {updateInfo.latest.releaseNotes && (
                        <p className="text-sm text-blue-700 mt-1">
                          {updateInfo.latest.releaseNotes}
                        </p>
                      )}
                      <div className="mt-3">
                        <Button
                          onClick={performUpdate}
                          disabled={updating}
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          {updating ? (
                            <>
                              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              {updateProgress || "Updating..."}
                            </>
                          ) : (
                            <>
                              <Download className="h-4 w-4 mr-2" />
                              Install Update
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="bg-green-50 border border-green-200 rounded-lg p-4">
                  <div className="flex items-center gap-3">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                    <p className="text-green-900">
                      SeqDesk is up to date
                    </p>
                  </div>
                </div>
              )}

              {/* Warning */}
              <p className="text-xs text-muted-foreground">
                Updates will backup your database before installing.
                The server will restart automatically after the update.
              </p>
            </div>
          ) : checkingUpdate ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Failed to check for updates. Click refresh to try again.
            </p>
          )}
        </div>
      </GlassCard>

      {/* Configuration Status */}
      <GlassCard className="p-6 mt-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-lg bg-slate-100 flex items-center justify-center">
              <FileJson className="h-5 w-5 text-slate-600" />
            </div>
            <div>
              <h2 className="text-lg font-semibold">Configuration Status</h2>
              <p className="text-sm text-muted-foreground">
                View current configuration and sources
              </p>
            </div>
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={fetchConfigStatus}
            disabled={loadingConfig}
          >
            {loadingConfig ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
          </Button>
        </div>

        <div className="border-t pt-4">
          {configStatus ? (
            <div className="space-y-4">
              {/* Config File Info */}
              <div className="flex items-center gap-2 text-sm">
                <span className="text-muted-foreground">Config file:</span>
                {configStatus.filePath ? (
                  <code className="bg-muted px-2 py-0.5 rounded text-xs">
                    {configStatus.filePath}
                  </code>
                ) : (
                  <span className="text-muted-foreground italic">
                    No config file found (using defaults)
                  </span>
                )}
              </div>

              {/* Source Legend */}
              <div className="flex items-center gap-4 text-xs">
                <span className="text-muted-foreground">Sources:</span>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-blue-50 text-blue-700 border-blue-200">ENV</Badge>
                  <span>Environment</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-green-50 text-green-700 border-green-200">FILE</Badge>
                  <span>Config file</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-violet-50 text-violet-700 border-violet-200">DB</Badge>
                  <span>Database</span>
                </div>
                <div className="flex items-center gap-1">
                  <Badge variant="outline" className="bg-slate-50 text-slate-700 border-slate-200">DEFAULT</Badge>
                  <span>Built-in</span>
                </div>
              </div>

              {/* Config Overview */}
              <div className="space-y-3">
                <ConfigSection
                  title="Site"
                  config={configStatus.config.site as Record<string, unknown>}
                  sources={configStatus.sources}
                  prefix="site"
                />
                <ConfigSection
                  title="Pipelines"
                  config={configStatus.config.pipelines as Record<string, unknown>}
                  sources={configStatus.sources}
                  prefix="pipelines"
                />
                <ConfigSection
                  title="ENA"
                  config={configStatus.config.ena as Record<string, unknown>}
                  sources={configStatus.sources}
                  prefix="ena"
                />
                <ConfigSection
                  title="Sequencing Files"
                  config={configStatus.config.sequencingFiles as Record<string, unknown>}
                  sources={configStatus.sources}
                  prefix="sequencingFiles"
                />
              </div>

              {/* Docs Link */}
              <p className="text-xs text-muted-foreground pt-2">
                See{" "}
                <a
                  href="https://github.com/hzi-bifo/SeqDesk/blob/main/docs/configuration.md"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary hover:underline"
                >
                  docs/configuration.md
                </a>{" "}
                for configuration options.
              </p>
            </div>
          ) : loadingConfig ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Failed to load configuration status.
            </p>
          )}
        </div>
      </GlassCard>
    </PageContainer>
  );
}

function ConfigSection({
  title,
  config,
  sources,
  prefix,
}: {
  title: string;
  config: Record<string, unknown> | undefined;
  sources: Record<string, string>;
  prefix: string;
}) {
  if (!config) return null;

  const getSourceBadge = (path: string) => {
    const source = sources[path] || "default";
    const styles: Record<string, string> = {
      env: "bg-blue-50 text-blue-700 border-blue-200",
      file: "bg-green-50 text-green-700 border-green-200",
      database: "bg-violet-50 text-violet-700 border-violet-200",
      default: "bg-slate-50 text-slate-700 border-slate-200",
    };
    return (
      <Badge variant="outline" className={`text-[10px] px-1 py-0 ${styles[source] || styles.default}`}>
        {source.toUpperCase()}
      </Badge>
    );
  };

  const renderValue = (value: unknown): string => {
    if (value === null || value === undefined) return "-";
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (Array.isArray(value)) return value.join(", ");
    if (typeof value === "object") return JSON.stringify(value);
    return String(value);
  };

  const flattenConfig = (
    obj: Record<string, unknown>,
    parentKey: string = ""
  ): Array<{ key: string; path: string; value: unknown }> => {
    const items: Array<{ key: string; path: string; value: unknown }> = [];

    for (const [key, value] of Object.entries(obj)) {
      const fullPath = parentKey ? `${parentKey}.${key}` : key;
      const displayKey = parentKey ? key : key;

      if (value && typeof value === "object" && !Array.isArray(value)) {
        items.push(...flattenConfig(value as Record<string, unknown>, fullPath));
      } else {
        items.push({ key: displayKey, path: fullPath, value });
      }
    }

    return items;
  };

  const items = flattenConfig(config, prefix);

  return (
    <div className="border rounded-lg overflow-hidden">
      <div className="bg-muted/50 px-3 py-2 border-b">
        <h3 className="text-sm font-medium">{title}</h3>
      </div>
      <div className="divide-y">
        {items.map(({ key, path, value }) => (
          <div key={path} className="flex items-center justify-between px-3 py-2 text-sm">
            <div className="flex items-center gap-2">
              <code className="text-xs text-muted-foreground">{key}</code>
              {getSourceBadge(path)}
            </div>
            <span className="text-right truncate max-w-[50%]" title={renderValue(value)}>
              {renderValue(value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
