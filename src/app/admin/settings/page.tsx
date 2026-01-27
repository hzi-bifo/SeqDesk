"use client";

import { useState, useEffect } from "react";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Settings, Users, Loader2, Database, AlertTriangle, FileText, Check, HardDrive, FolderOpen, CheckCircle2, XCircle } from "lucide-react";
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

  useEffect(() => {
    fetchSettings();
    fetchSequencingFilesSettings();
  }, []);

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
    <PageContainer maxWidth="medium">
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
    </PageContainer>
  );
}
