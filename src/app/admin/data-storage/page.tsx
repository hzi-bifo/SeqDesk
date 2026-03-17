"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  HardDrive,
  FolderOpen,
  Loader2,
  Check,
  CheckCircle2,
  XCircle,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { InfrastructureSetupStatus } from "@/components/admin/infrastructure/InfrastructureSetupStatus";

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

export default function DataStoragePage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const [dataBasePath, setDataBasePath] = useState("");
  const [dataBasePathSource, setDataBasePathSource] = useState<string>("none");
  const [dataBasePathIsImplicit, setDataBasePathIsImplicit] = useState(false);
  const [seqFilesConfig, setSeqFilesConfig] = useState<SequencingFilesConfig>({
    allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
    scanDepth: 2,
    ignorePatterns: [],
    allowSingleEnd: true,
    autoAssign: false,
  });
  const [testingPath, setTestingPath] = useState(false);
  const [pathTestResult, setPathTestResult] = useState<PathTestResult | null>(null);

  useEffect(() => {
    void fetchSettings();
  }, []);

  const fetchSettings = async () => {
    try {
      const res = await fetch("/api/admin/settings/sequencing-files");
      if (!res.ok) {
        throw new Error("Failed to load settings");
      }
      const data = await res.json();
      setDataBasePath(data.dataBasePath || "");
      setDataBasePathSource(typeof data.dataBasePathSource === "string" ? data.dataBasePathSource : "none");
      setDataBasePathIsImplicit(Boolean(data.dataBasePathIsImplicit));
      if (data.config) {
        setSeqFilesConfig({
          ...data.config,
          allowSingleEnd: true,
        });
      }
    } catch (error) {
      console.error("Failed to load sequencing files settings:", error);
      toast.error("Failed to load data storage settings");
    } finally {
      setLoading(false);
    }
  };

  const handleTestPath = async () => {
    if (!dataBasePath.trim()) {
      toast.error("Please enter a directory path first");
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
      if (!res.ok) {
        setPathTestResult({
          valid: false,
          error: result.error || "Path test failed",
        });
        return;
      }
      setPathTestResult(result);
    } catch (error) {
      console.error("Failed to test path:", error);
      setPathTestResult({ valid: false, error: "Failed to test path" });
    } finally {
      setTestingPath(false);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);

    try {
      const configToSave = {
        ...seqFilesConfig,
        allowSingleEnd: true,
      };

      const res = await fetch("/api/admin/settings/sequencing-files", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          dataBasePath,
          config: configToSave,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || "Failed to save settings");
      }

      setSaved(true);
      setPathTestResult(null);
      toast.success("Data storage settings saved");
      setTimeout(() => setSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save sequencing files settings:", error);
      toast.error(error instanceof Error ? error.message : "Failed to save settings");
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
          <h1 className="text-xl font-semibold">Data Storage</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure where sequencing files are discovered and how they are matched
          </p>
        </div>

        <div className="sticky top-16 z-30">
          <div className="rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              Set and validate the base directory before enabling imports.
            </p>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href="/admin/data-compute">Overview</Link>
              </Button>
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href="/admin/pipeline-runtime">Pipeline Runtime</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => jumpToSection("required-data-storage")}
              >
                Required
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => jumpToSection("advanced-data-storage")}
              >
                Advanced
              </Button>
            </div>
          </div>
        </div>

        <InfrastructureSetupStatus
          fixLinks={{
            dataPath: "#required-data-storage",
            runDir: "/admin/pipeline-runtime#required-runtime",
            conda: "/admin/pipeline-runtime#required-runtime",
            weblog: "/admin/pipeline-runtime#advanced-runtime",
          }}
        />

        <div id="required-data-storage" className="scroll-mt-28">
          <div className="flex items-center gap-3 mb-2">
            <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
              <HardDrive className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Required Configuration</h2>
            <Badge variant="secondary">Required</Badge>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Define the server directory used for sequencing file discovery and verify access.
          </p>

          <GlassCard className="p-6">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="data-base-path" className="text-base font-medium">
                  Sequencing Data Directory
                </Label>
                <p className="text-sm text-muted-foreground">
                  Absolute path to the directory where sequencing files are stored (for example: /data/sequencing)
                </p>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <FolderOpen className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                    <Input
                      id="data-base-path"
                      value={dataBasePath}
                      onChange={(e) => {
                        setDataBasePath(e.target.value);
                        setDataBasePathSource("manual");
                        setDataBasePathIsImplicit(false);
                        setPathTestResult(null);
                      }}
                      placeholder="/data/sequencing"
                      className="pl-10"
                      disabled={saving}
                    />
                  </div>
                  <Button
                    variant="outline"
                    className="bg-white"
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

                {dataBasePathIsImplicit && dataBasePathSource === "local-dev" && dataBasePath.trim() && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    Using the local macOS development fallback path <span className="font-mono">{dataBasePath}</span>.
                    Save this form if you want to persist it in Site Settings.
                  </div>
                )}

                {pathTestResult && (
                  <div
                    className={`mt-2 p-3 rounded-lg text-sm flex items-start gap-2 border ${
                      pathTestResult.valid
                        ? "bg-green-50 text-green-800 border-green-200"
                        : "bg-red-50 text-red-800 border-red-200"
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
            </div>
          </GlassCard>
        </div>

        <div id="advanced-data-storage" className="scroll-mt-28">
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
              <div className="space-y-2">
                <Label className="text-base font-medium">Allowed File Extensions</Label>
                <p className="text-sm text-muted-foreground">
                  Comma-separated list used for matching sequencing files (for example: .fastq.gz, .fq.gz)
                </p>
                <Input
                  value={seqFilesConfig.allowedExtensions.join(", ")}
                  onChange={(e) =>
                    setSeqFilesConfig({
                      ...seqFilesConfig,
                      allowedExtensions: Array.from(
                        new Set(
                          e.target.value
                            .split(",")
                            .map((s) => s.trim())
                            .filter((s) => s.length > 0)
                            .map((ext) => (ext.startsWith(".") ? ext : `.${ext}`))
                        )
                      ),
                    })
                  }
                  placeholder=".fastq.gz, .fq.gz, .fastq, .fq"
                  disabled={saving}
                />
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
            {saved ? "Saved!" : "Save Data Settings"}
          </Button>
        </div>
      </div>
    </PageContainer>
  );
}
