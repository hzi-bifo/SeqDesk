"use client";

import { ChangeEvent, useRef, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import {
  HardDrive,
  Settings2,
  ArrowRight,
  Server,
  Upload,
  FileJson,
  Loader2,
  CheckCircle2,
  AlertCircle,
} from "lucide-react";
import { InfrastructureSetupStatus } from "@/components/admin/infrastructure/InfrastructureSetupStatus";

interface InfrastructureImportResponse {
  success: boolean;
  message?: string;
  applied?: Record<string, string | number | boolean>;
  warnings?: string[];
  error?: string;
}

const EXAMPLE_INFRA_CONFIG = {
  port: 8000,
  pipelinesEnabled: true,
  nextAuthUrl: "http://seqdesk-host:8000",
  databaseUrl:
    "postgresql://seqdesk:replace-with-password@127.0.0.1:5432/seqdesk?schema=public",
  directUrl:
    "postgresql://seqdesk:replace-with-password@127.0.0.1:5432/seqdesk?schema=public",
  anthropicApiKey: "replace-with-anthropic-api-key",
  sequencingDataDir: "/data/sequencing",
  pipelineRunDir: "/data/pipeline_runs",
  useSlurm: true,
  slurmQueue: "cpu",
  slurmCores: 4,
  slurmMemory: "64GB",
  slurmTimeLimit: 12,
  slurmOptions: "--qos=standard",
  condaPath: "/opt/miniconda3",
  condaEnv: "seqdesk-pipelines",
  nextflowProfile: "conda",
  nextflowWeblogUrl: "http://seqdesk-host:8000/api/pipelines/weblog",
  weblogSecret: "replace-with-random-secret",
};

export default function InfrastructureOverviewPage() {
  const [importText, setImportText] = useState("");
  const [validating, setValidating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [statusRefreshKey, setStatusRefreshKey] = useState(0);
  const [loadedFileName, setLoadedFileName] = useState<string | null>(null);
  const [validationResult, setValidationResult] =
    useState<InfrastructureImportResponse | null>(null);
  const [importResult, setImportResult] =
    useState<InfrastructureImportResponse | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const handleLoadExample = () => {
    setImportText(JSON.stringify(EXAMPLE_INFRA_CONFIG, null, 2));
    setValidationResult(null);
    setImportResult(null);
    toast.success("Example setup loaded");
  };

  const handleFileSelected = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const raw = await file.text();
      const parsed = JSON.parse(raw) as unknown;
      setImportText(JSON.stringify(parsed, null, 2));
      setLoadedFileName(file.name);
      setValidationResult(null);
      setImportResult(null);
      toast.success(`Loaded ${file.name}`);
    } catch {
      toast.error("Selected file is not valid JSON");
    } finally {
      event.target.value = "";
    }
  };

  const handleImport = async () => {
    if (!importText.trim()) {
      toast.error("Paste JSON or upload a JSON file first");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      toast.error("Invalid JSON format");
      return;
    }

    setImporting(true);
    setValidationResult(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/infrastructure/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed }),
      });
      const data = (await res.json()) as InfrastructureImportResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "Import failed");
      }

      setImportResult(data);
      setStatusRefreshKey((prev) => prev + 1);
      toast.success(data.message || "Infrastructure settings imported");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to import setup";
      toast.error(message);
      setImportResult({
        success: false,
        error: message,
      });
    } finally {
      setImporting(false);
    }
  };

  const handleValidate = async () => {
    if (!importText.trim()) {
      toast.error("Paste JSON or upload a JSON file first");
      return;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(importText);
    } catch {
      toast.error("Invalid JSON format");
      setValidationResult({
        success: false,
        error: "Invalid JSON format",
      });
      return;
    }

    setValidating(true);
    setValidationResult(null);
    setImportResult(null);
    try {
      const res = await fetch("/api/admin/infrastructure/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config: parsed, dryRun: true }),
      });
      const data = (await res.json()) as InfrastructureImportResponse;

      if (!res.ok || !data.success) {
        throw new Error(data.error || data.message || "Validation failed");
      }

      setValidationResult(data);
      toast.success(data.message || "Configuration is valid");
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to validate setup";
      toast.error(message);
      setValidationResult({
        success: false,
        error: message,
      });
    } finally {
      setValidating(false);
    }
  };

  return (
    <>
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="relative flex items-center justify-center h-[52px] px-6 lg:px-8">
          <span className="text-sm font-medium">Infrastructure</span>
        </div>
      </div>
    <PageContainer>
      <div className="space-y-8">
        <div className="mb-4 mt-6">
          <h1 className="text-xl font-semibold">Infrastructure</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Configure data storage and runtime prerequisites for imports and pipeline execution
          </p>
        </div>

        <InfrastructureSetupStatus key={statusRefreshKey} />

        <div className="grid gap-4 lg:grid-cols-2">
          <GlassCard className="p-6">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-2">
                <h2 className="text-base font-semibold">Data Storage</h2>
                <p className="text-sm text-muted-foreground">
                  Set the sequencing data directory and file extension matching used by the importer.
                </p>
                <Button asChild variant="outline" size="sm" className="bg-white">
                  <Link href="/admin/data-storage">
                    Open Data Storage
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center">
                <Settings2 className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1 space-y-2">
                <h2 className="text-base font-semibold">Pipeline Runtime</h2>
                <p className="text-sm text-muted-foreground">
                  Configure scheduler, conda path, run directory, and webhook diagnostics for Nextflow runs.
                </p>
                <Button asChild variant="outline" size="sm" className="bg-white">
                  <Link href="/admin/pipeline-runtime">
                    Open Pipeline Runtime
                    <ArrowRight className="h-4 w-4 ml-1" />
                  </Link>
                </Button>
              </div>
            </div>
          </GlassCard>
        </div>

        <GlassCard className="p-6">
          <div className="space-y-4">
            <div className="flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-base font-semibold">Import Setup JSON</h2>
                <p className="text-sm text-muted-foreground">
                  Paste setup JSON and validate before saving. Upload is optional.
                </p>
              </div>
              <Badge variant="outline">Optional</Badge>
            </div>

            <input
              ref={fileInputRef}
              type="file"
              accept=".json,application/json"
              className="hidden"
              onChange={handleFileSelected}
            />

            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                className="bg-white"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="h-4 w-4 mr-2" />
                Upload JSON
              </Button>
              <Button
                variant="outline"
                className="bg-white"
                onClick={handleLoadExample}
              >
                <FileJson className="h-4 w-4 mr-2" />
                Load Example
              </Button>
              {loadedFileName && <Badge variant="secondary">{loadedFileName}</Badge>}
            </div>

            <Textarea
              value={importText}
              onChange={(event) => setImportText(event.target.value)}
              placeholder={JSON.stringify(EXAMPLE_INFRA_CONFIG, null, 2)}
              rows={12}
              className="font-mono text-xs leading-relaxed"
            />

            <div className="flex items-center gap-3">
              <Button
                variant="outline"
                className="bg-white"
                onClick={handleValidate}
                disabled={validating || importing || !importText.trim()}
              >
                {validating ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <CheckCircle2 className="h-4 w-4 mr-2" />
                )}
                {validating ? "Validating..." : "Validate JSON"}
              </Button>
              <Button
                variant="outline"
                className="bg-white"
                onClick={handleImport}
                disabled={importing || validating || !importText.trim()}
              >
                {importing ? (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                ) : (
                  <Upload className="h-4 w-4 mr-2" />
                )}
                {importing ? "Saving..." : "Save Infrastructure Setup"}
              </Button>
              <p className="text-xs text-muted-foreground">
                Supports flat keys and `seqdesk.config.json`-style nested keys.
              </p>
            </div>

            {validationResult?.success && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3">
                <p className="text-sm text-blue-900 font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {validationResult.message || "Configuration is valid"}
                </p>
                {validationResult.applied &&
                  Object.keys(validationResult.applied).length > 0 && (
                    <div className="mt-2 grid gap-1 text-xs text-blue-950">
                      {Object.entries(validationResult.applied).map(([key, value]) => (
                        <p key={key}>
                          <span className="font-medium">{key}:</span>{" "}
                          <code>{String(value)}</code>
                        </p>
                      ))}
                    </div>
                  )}
                {validationResult.warnings &&
                  validationResult.warnings.length > 0 && (
                    <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                      {validationResult.warnings.map((warning, index) => (
                        <p key={`${warning}-${index}`}>{warning}</p>
                      ))}
                    </div>
                  )}
              </div>
            )}

            {validationResult &&
              !validationResult.success &&
              validationResult.error && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5" />
                  <p>{validationResult.error}</p>
                </div>
              )}

            {importResult?.success && (
              <div className="rounded-lg border border-green-200 bg-green-50 p-3">
                <p className="text-sm text-green-800 font-medium flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  {importResult.message || "Infrastructure settings imported"}
                </p>
                {importResult.applied &&
                  Object.keys(importResult.applied).length > 0 && (
                    <div className="mt-2 grid gap-1 text-xs text-green-900">
                      {Object.entries(importResult.applied).map(([key, value]) => (
                        <p key={key}>
                          <span className="font-medium">{key}:</span>{" "}
                          <code>{String(value)}</code>
                        </p>
                      ))}
                    </div>
                  )}
                {importResult.warnings && importResult.warnings.length > 0 && (
                  <div className="mt-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-xs text-amber-800">
                    {importResult.warnings.map((warning, index) => (
                      <p key={`${warning}-${index}`}>{warning}</p>
                    ))}
                  </div>
                )}
              </div>
            )}

            {importResult && !importResult.success && importResult.error && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5" />
                <p>{importResult.error}</p>
              </div>
            )}
          </div>
        </GlassCard>

        <div className="rounded-lg border border-border bg-muted/20 px-4 py-3 text-sm text-muted-foreground flex items-center gap-2">
          <Server className="h-4 w-4" />
          Use JSON import for quick bootstrap, then fine-tune Data Storage and Pipeline Runtime fields.
        </div>
      </div>
    </PageContainer>
    </>
  );
}
