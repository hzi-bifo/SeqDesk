"use client";

import Link from "next/link";
import { useState } from "react";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
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
import { Input } from "@/components/ui/input";
import {
  Loader2,
  Dna,
  FlaskConical,
  Settings2,
  Eye,
  RefreshCw,
  XCircle,
  Download,
  Upload,
  ExternalLink,
  Package,
  Microscope,
  FileBarChart,
  Layers,
} from "lucide-react";
import { PipelineDagViewer, DagNode, DagEdge, PipelineInfo } from "@/components/pipelines/PipelineDagViewer";
import { PipelineIntegrationDetails } from "@/components/pipelines/PipelineIntegrationDetails";

const fetcher = (url: string) => fetch(url).then((r) => r.json());

interface PipelineInput {
  id: string;
  name: string;
  description: string;
  fileTypes: string[];
  source: string;
  sourceDescription: string;
}

interface PipelineOutput {
  id: string;
  name: string;
  description: string;
  fromStep: string;
  fileTypes: string[];
  destination: string;
  destinationField?: string;
  destinationDescription: string;
}

interface SamplesheetColumn {
  name: string;
  source: string | null;
  required?: boolean;
  default?: string;
  filters?: Record<string, unknown>;
  transform?: {
    type: string;
    base?: string;
    mapping?: Record<string, string>;
  };
  description?: string;
}

interface SamplesheetConfig {
  format: "csv" | "tsv";
  filename: string;
  rows: {
    scope: string;
  };
  columns: SamplesheetColumn[];
}

interface PipelineDefinitionData {
  name: string;
  inputs: PipelineInput[];
  outputs: PipelineOutput[];
  samplesheet?: SamplesheetConfig;
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
  download?: PipelineDownloadInfo;
  databaseDownloads?: PipelineDatabaseDownloadInfo[];
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

interface PipelineDatabaseDownloadInfo {
  id: string;
  label: string;
  description?: string;
  version?: string;
  configKey: string;
  status: "downloaded" | "missing";
  path?: string;
  expectedPath?: string;
  configuredPath?: string;
  sourceUrl?: string;
  sizeBytes?: number;
  lastUpdated?: string;
  detail?: string;
  job?: {
    state: "running" | "success" | "error";
    sourceUrl?: string;
    targetPath?: string;
    pid?: number;
    bytesDownloaded?: number;
    totalBytes?: number;
    progressPercent?: number | null;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    logPath?: string;
  } | null;
}

interface PipelineDownloadInfo {
  status: "downloaded" | "missing" | "unsupported";
  version?: string;
  expectedVersion?: string;
  path?: string;
  lastUpdated?: string;
  detail?: string;
  job?: {
    state: "running" | "success" | "error";
    pipelineRef?: string;
    requestedVersion?: string;
    resolvedVersion?: string;
    source?: string;
    pid?: number;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    logPath?: string;
  };
}

interface StorePipeline {
  id: string;
  name: string;
  description: string;
  category: string;
  version: string;
  latestVersion?: string;
  author?: string;
  downloads?: number;
  icon?: string;
}

interface StoreCategory {
  id: string;
  name: string;
  description?: string;
}

function getPipelineIcon(icon: string) {
  switch (icon) {
    case "Dna":
    case "dna":
    case "rna":
      return <Dna className="h-6 w-6" />;
    case "taxonomy":
    case "amplicon":
      return <Microscope className="h-6 w-6" />;
    case "download":
      return <Download className="h-6 w-6" />;
    case "Upload":
    case "upload":
      return <Upload className="h-6 w-6" />;
    default:
      return <FlaskConical className="h-6 w-6" />;
  }
}

function getCategoryColor(category: string): string {
  switch (category) {
    case "metagenomics":
      return "bg-emerald-100 text-emerald-700 border-emerald-200";
    case "transcriptomics":
      return "bg-blue-100 text-blue-700 border-blue-200";
    case "amplicon":
      return "bg-purple-100 text-purple-700 border-purple-200";
    case "utilities":
      return "bg-gray-100 text-gray-700 border-gray-200";
    case "analysis":
      return "bg-amber-100 text-amber-700 border-amber-200";
    case "submission":
      return "bg-rose-100 text-rose-700 border-rose-200";
    case "qc":
      return "bg-cyan-100 text-cyan-700 border-cyan-200";
    default:
      return "bg-gray-100 text-gray-700 border-gray-200";
  }
}

function isSameConfigValue(a: unknown, b: unknown) {
  if (a === b) return true;
  if (a === undefined && b === undefined) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'\"'\"'`)}'`;
}

function getParentDir(targetPath: string): string {
  const normalized = targetPath.trim();
  if (!normalized) return ".";
  const lastSlash = normalized.lastIndexOf("/");
  if (lastSlash <= 0) return ".";
  return normalized.slice(0, lastSlash);
}

function getManualDbDownloadCommands(database: PipelineDatabaseDownloadInfo): string[] | null {
  const targetPath =
    database.expectedPath ||
    database.job?.targetPath ||
    database.path ||
    database.configuredPath;
  const sourceUrl = database.sourceUrl || database.job?.sourceUrl;

  if (!targetPath || !sourceUrl) return null;

  const targetDir = getParentDir(targetPath);
  return [
    `mkdir -p ${shellQuote(targetDir)}`,
    `curl -L -C - --fail --retry 8 --retry-delay 5 --retry-all-errors --connect-timeout 30 --speed-time 60 --speed-limit 1024 --output ${shellQuote(targetPath)} ${shellQuote(sourceUrl)}`,
  ];
}

export default function PipelineSettingsPage() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/settings/pipelines",
    fetcher,
    {
      refreshInterval: (latestData) =>
        latestData?.pipelines?.some((pipeline: PipelineConfig) =>
          pipeline.download?.job?.state === "running" ||
          pipeline.databaseDownloads?.some((database) => database.job?.state === "running")
        )
          ? 3000
          : 0,
    }
  );

  const {
    data: storeData,
    error: storeError,
    isLoading: storeLoading,
    mutate: mutateStore,
  } = useSWR("/api/admin/settings/pipelines/store", fetcher);

  const [selectedCategory, setSelectedCategory] = useState("all");
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [dagDialogOpen, setDagDialogOpen] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineConfig | null>(null);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
  const [configError, setConfigError] = useState<string | null>(null);
  const [dagData, setDagData] = useState<{ nodes: DagNode[]; edges: DagEdge[]; pipeline?: PipelineInfo } | null>(null);
  const [loadingDag, setLoadingDag] = useState(false);
  const [pipelineDefinition, setPipelineDefinition] = useState<PipelineDefinitionData | null>(null);
  const [dialogViewTab, setDialogViewTab] = useState<"integration" | "workflow">("integration");

  // Install state
  const [installingPipeline, setInstallingPipeline] = useState<string | null>(null);
  const [installAction, setInstallAction] = useState<"install" | "update" | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);
  const [downloadingPipeline, setDownloadingPipeline] = useState<string | null>(null);
  const [downloadAction, setDownloadAction] = useState<"download" | "update" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingDatabase, setDownloadingDatabase] = useState<string | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [togglingPipeline, setTogglingPipeline] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

  const compareVersions = (a?: string, b?: string) => {
    if (!a || !b) return 0;
    const partsA = a.replace(/^v/, "").split(".").map(Number);
    const partsB = b.replace(/^v/, "").split(".").map(Number);
    const length = Math.max(partsA.length, partsB.length);
    for (let i = 0; i < length; i += 1) {
      const numA = partsA[i] || 0;
      const numB = partsB[i] || 0;
      if (Number.isNaN(numA) || Number.isNaN(numB)) return 0;
      if (numA > numB) return 1;
      if (numA < numB) return -1;
    }
    return 0;
  };

  const formatStoreDate = (value?: string) => {
    if (!value) return "Unknown";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
  };

  const formatBytes = (bytes?: number) => {
    if (typeof bytes !== "number" || !Number.isFinite(bytes) || bytes < 0) {
      return "Unknown";
    }
    if (bytes < 1024) return `${bytes} B`;
    const units = ["KB", "MB", "GB", "TB"];
    let value = bytes;
    let unitIndex = -1;
    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex += 1;
    }
    return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unitIndex]}`;
  };

  // Install a pipeline from the store
  const handleInstallPipeline = async (pipelineId: string, version?: string) => {
    setInstallingPipeline(pipelineId);
    setInstallAction("install");
    setInstallError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallError(data.error || "Installation failed");
        return;
      }
      // Refresh pipeline list
      mutate();
    } catch (err) {
      setInstallError("Installation failed. Check console for details.");
      console.error("Install error:", err);
    } finally {
      setInstallingPipeline(null);
      setInstallAction(null);
    }
  };

  const handleUpdatePipeline = async (pipelineId: string, version?: string) => {
    setInstallingPipeline(pipelineId);
    setInstallAction("update");
    setInstallError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, version, replace: true }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallError(data.error || "Update failed");
        return;
      }
      mutate();
    } catch (err) {
      setInstallError("Update failed. Check console for details.");
      console.error("Update error:", err);
    } finally {
      setInstallingPipeline(null);
      setInstallAction(null);
    }
  };

  const handleDownloadPipelineCode = async (pipelineId: string, version?: string, action: "download" | "update" = "download") => {
    setDownloadingPipeline(pipelineId);
    setDownloadAction(action);
    setDownloadError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/download", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, version }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDownloadError(data.error || "Download failed");
        return;
      }
      mutate();
    } catch (err) {
      setDownloadError("Download failed. Check console for details.");
      console.error("Download error:", err);
    } finally {
      setDownloadingPipeline(null);
      setDownloadAction(null);
    }
  };

  const handleDownloadPipelineDatabase = async (
    pipelineId: string,
    databaseId: string,
    replace = false
  ) => {
    const key = `${pipelineId}:${databaseId}`;
    setDownloadingDatabase(key);
    setDatabaseError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/download-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, databaseId, replace }),
      });
      const data = await res.json();
      if (!res.ok) {
        setDatabaseError(data.error || "Database download failed");
        return;
      }
      mutate();
    } catch (err) {
      setDatabaseError("Database download failed. Check console for details.");
      console.error("Database download error:", err);
    } finally {
      setDownloadingDatabase(null);
    }
  };

  const openConfigDialog = (pipeline: PipelineConfig) => {
    setSelectedPipeline(pipeline);
    setLocalConfig({ ...pipeline.config });
    setConfigError(null);
    setConfigDialogOpen(true);
  };

  const openDagDialog = async (pipeline: PipelineConfig) => {
    setSelectedPipeline(pipeline);
    setDagData(null);
    setPipelineDefinition(null);
    setDialogViewTab("integration");
    setDagDialogOpen(true);
    setLoadingDag(true);

    try {
      // Fetch both DAG and definition in parallel
      const [dagRes, defRes] = await Promise.all([
        fetch(`/api/admin/settings/pipelines/${pipeline.pipelineId}/dag`),
        fetch(`/api/admin/settings/pipelines/${pipeline.pipelineId}/definition`),
      ]);

      if (dagRes.ok) {
        const data = await dagRes.json();
        setDagData(data);
      }

      if (defRes.ok) {
        const data = await defRes.json();
        setPipelineDefinition(data);
      }
    } catch (err) {
      console.error("Failed to load pipeline data:", err);
    }
    setLoadingDag(false);
  };

  const handleSaveConfig = async () => {
    if (!selectedPipeline) return;

    setConfigError(null);
    setSaving(true);
    try {
      const res = await fetch("/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: selectedPipeline.pipelineId,
          enabled: selectedPipeline.enabled,
          config: localConfig,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof payload.error === "string" &&
            payload.error) ||
            "Failed to save pipeline configuration"
        );
      }
      mutate();
      setConfigDialogOpen(false);
    } catch (err) {
      setConfigError(
        err instanceof Error ? err.message : "Failed to save pipeline configuration"
      );
    }
    setSaving(false);
  };

  const handleTogglePipelineEnabled = async (pipeline: PipelineConfig) => {
    setTogglingPipeline(pipeline.pipelineId);
    setToggleError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: pipeline.pipelineId,
          enabled: !pipeline.enabled,
          config: pipeline.config,
        }),
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          (payload &&
            typeof payload === "object" &&
            "error" in payload &&
            typeof payload.error === "string" &&
            payload.error) ||
            "Failed to update pipeline state"
        );
      }
      mutate();
    } catch (err) {
      setToggleError(
        err instanceof Error ? err.message : "Failed to update pipeline state"
      );
    } finally {
      setTogglingPipeline(null);
    }
  };

  const handleResetToDefaults = () => {
    if (selectedPipeline) {
      setLocalConfig({ ...selectedPipeline.defaultConfig });
    }
  };

  const installedPipelines: PipelineConfig[] = data?.pipelines || [];
  const installedPipelineIds = new Set(installedPipelines.map((p) => p.pipelineId));
  const storePipelines: StorePipeline[] = storeData?.pipelines || [];
  const storePipelineMap = new Map(storePipelines.map((pipeline) => [pipeline.id, pipeline]));
  const storeCategories: StoreCategory[] = storeData?.categories || [];
  const filteredInstalledPipelines = installedPipelines.filter(
    (pipeline) => selectedCategory === "all" || pipeline.category === selectedCategory
  );
  const availablePipelines = storePipelines.filter(
    (pipeline) => !installedPipelineIds.has(pipeline.id) && (selectedCategory === "all" || pipeline.category === selectedCategory)
  );
  const installedCount = installedPipelines.length;
  const availablePipelineCount = storePipelines.filter(
    (pipeline) => !installedPipelineIds.has(pipeline.id)
  ).length;
  const visiblePipelineCount =
    filteredInstalledPipelines.length + availablePipelines.length;
  const configEntries = selectedPipeline
    ? Object.entries(selectedPipeline.configSchema.properties)
    : [];
  const changedConfigCount = selectedPipeline
    ? configEntries.reduce((count, [key]) => {
        return isSameConfigValue(localConfig[key], selectedPipeline.config[key])
          ? count
          : count + 1;
      }, 0)
    : 0;
  const hasConfigChanges = changedConfigCount > 0;

  return (
    <PageContainer>
      <div className="space-y-8">
        <div className="mb-4">
          <h1 className="text-xl font-semibold">Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Install, update, and cache nf-core pipelines used by analysis workflows.
          </p>
        </div>

        <div className="sticky top-16 z-30">
          <div className="rounded-lg border border-border bg-background/95 backdrop-blur px-3 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-xs text-muted-foreground">
              {storeError
                ? "Store registry unavailable. Installed pipelines can still be managed."
                : `${installedCount} installed • ${storeLoading ? "Checking store..." : `${availablePipelineCount} available`} • Download pipeline code and databases to warm runtime cache.`}
            </p>
            <div className="flex items-center gap-2">
              <Button asChild variant="outline" size="sm" className="bg-white">
                <Link href="/admin/data-compute">Infrastructure</Link>
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => {
                  void mutate();
                  void mutateStore();
                }}
                disabled={isLoading || storeLoading}
              >
                <RefreshCw className={`h-4 w-4 mr-2 ${isLoading || storeLoading ? "animate-spin" : ""}`} />
                Refresh all
              </Button>
            </div>
          </div>
        </div>

        <section id="pipelines" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Pipelines</p>
              <h2 className="text-base font-semibold">Pipelines</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Installed and not-installed pipelines in one list.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="w-52">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger className="bg-white">
                    <SelectValue placeholder="All categories" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All categories</SelectItem>
                    {storeCategories.map((category) => (
                      <SelectItem key={category.id} value={category.id}>
                        {category.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Badge variant="secondary" className="h-6 px-3">
                {installedCount} installed
              </Badge>
              <Badge variant={storeError ? "destructive" : "outline"} className="h-6 px-3">
                {storeLoading ? "Checking..." : storeError ? "Registry unavailable" : `${availablePipelineCount} available`}
              </Badge>
            </div>
          </div>

          {downloadError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">{downloadError}</p>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setDownloadError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {databaseError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">{databaseError}</p>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setDatabaseError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {installError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">{installError}</p>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setInstallError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {toggleError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">{toggleError}</p>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setToggleError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive">
              Failed to load pipeline configurations
            </div>
          ) : storeLoading && visiblePipelineCount === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : visiblePipelineCount > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {filteredInstalledPipelines.map((pipeline: PipelineConfig) => (
                <GlassCard key={pipeline.pipelineId} className="relative">
                  {(() => {
                    const storeEntry = storePipelineMap.get(pipeline.pipelineId);
                    const latestVersion = storeEntry?.latestVersion || storeEntry?.version;
                    const updateAvailable =
                      latestVersion &&
                      pipeline.version &&
                      compareVersions(latestVersion, pipeline.version) > 0;
                    const downloadStatus = pipeline.download;
                    const expectedCodeVersion = downloadStatus?.expectedVersion;
                    const downloadedCodeVersion = downloadStatus?.version;
                    const codeStatus = downloadStatus?.status;
                    const downloadJob = downloadStatus?.job;
                    const downloadInProgress = downloadJob?.state === "running";
                    const downloadFailed = downloadJob?.state === "error";
                    const downloadFinishedAt = downloadJob?.finishedAt;
                    const codeUpdateAvailable =
                      codeStatus === "downloaded" &&
                      expectedCodeVersion &&
                      downloadedCodeVersion &&
                      compareVersions(expectedCodeVersion, downloadedCodeVersion) > 0;
                    const codeMissing = codeStatus === "missing";
                    const shouldOfferCodeDownload =
                      codeMissing || codeUpdateAvailable || (codeStatus === "downloaded" && !downloadedCodeVersion);
                    const codeActionLabel = codeMissing
                      ? "Download pipeline"
                      : codeUpdateAvailable
                        ? "Update pipeline"
                        : "Re-download pipeline";
                    const databaseDownloads = pipeline.databaseDownloads || [];
                    const databasesRunning = databaseDownloads.filter(
                      (database) => database.job?.state === "running"
                    );
                    const databaseMissing = databaseDownloads.filter(
                      (database) => database.status === "missing"
                    );
                    const databaseFailed = databaseDownloads.filter(
                      (database) => database.job?.state === "error" && database.status === "missing"
                    );
                    const databaseAvailable = databaseDownloads.filter(
                      (database) => database.status === "downloaded"
                    );

                    return (
                      <>
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex items-start gap-4">
                            <div className={`p-3 rounded-xl ${getCategoryColor(pipeline.category)}`}>
                              {getPipelineIcon(pipeline.icon)}
                            </div>
                            <div className="min-w-0">
                              <div className="flex flex-wrap items-center gap-2 mb-1">
                                <h3 className="font-semibold truncate">{pipeline.name}</h3>
                                {pipeline.version && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    v{pipeline.version}
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-xs font-normal">
                                  Installed
                                </Badge>
                                <Badge
                                  variant={pipeline.enabled ? "outline" : "secondary"}
                                  className="text-xs font-normal"
                                >
                                  {pipeline.enabled ? "Enabled" : "Disabled"}
                                </Badge>
                                {codeStatus === "downloaded" && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    Pipeline cached
                                  </Badge>
                                )}
                                {downloadInProgress && (
                                  <Badge variant="secondary" className="text-xs">
                                    Downloading pipeline...
                                  </Badge>
                                )}
                                {downloadFailed && (
                                  <Badge variant="secondary" className="text-xs">
                                    Pipeline download failed
                                  </Badge>
                                )}
                                {codeStatus === "missing" && (
                                  <Badge variant="secondary" className="text-xs">
                                    Pipeline not cached
                                  </Badge>
                                )}
                                {codeStatus === "unsupported" && (
                                  <Badge variant="secondary" className="text-xs">
                                    External pipeline
                                  </Badge>
                                )}
                                {databaseDownloads.length > 0 && databaseAvailable.length > 0 && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    DB ready
                                  </Badge>
                                )}
                                {databaseDownloads.length > 0 && databaseMissing.length > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    DB missing
                                  </Badge>
                                )}
                                {databasesRunning.length > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    Downloading DB...
                                  </Badge>
                                )}
                                {databaseFailed.length > 0 && (
                                  <Badge variant="secondary" className="text-xs">
                                    DB download failed
                                  </Badge>
                                )}
                                <Badge variant="secondary" className="text-xs capitalize">
                                  {pipeline.category}
                                </Badge>
                                {updateAvailable && (
                                  <Badge variant="secondary" className="text-xs">
                                    Package update
                                  </Badge>
                                )}
                                {codeUpdateAvailable && (
                                  <Badge variant="secondary" className="text-xs">
                                    Pipeline update
                                  </Badge>
                                )}
                              </div>
                              <p className="text-sm text-muted-foreground line-clamp-2">
                                {pipeline.description}
                              </p>
                              <p className="text-xs text-muted-foreground font-mono mt-1">
                                {pipeline.pipelineId}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {latestVersion
                                  ? `Latest version: v${latestVersion}`
                                  : "Latest version: unknown"}
                              </p>
                              <p className="text-xs text-muted-foreground mt-1">
                                {codeStatus === "downloaded"
                                  ? `Pipeline cache: ${downloadedCodeVersion ? `v${downloadedCodeVersion}` : "version unknown"}`
                                  : codeStatus === "missing"
                                    ? "Pipeline cache: not downloaded"
                                    : codeStatus === "unsupported"
                                      ? "Pipeline cache: managed externally"
                                      : "Pipeline cache: unknown"}
                                {expectedCodeVersion ? ` • Expected v${expectedCodeVersion}` : ""}
                              </p>
                              {databaseDownloads.map((database) => {
                                const databaseRunning = database.job?.state === "running";
                                const databaseFailedState = database.job?.state === "error";
                                const databaseUnavailable = database.status === "missing";
                                const databaseProgress = database.job?.progressPercent;
                                const databaseBytes = database.job?.bytesDownloaded;
                                const databaseTotal = database.job?.totalBytes;
                                const manualCommands = getManualDbDownloadCommands(database);
                                return (
                                  <div key={database.id} className="mt-1 space-y-1">
                                    <p className="text-xs text-muted-foreground">
                                      {database.label}:{" "}
                                      {database.status === "downloaded"
                                        ? `downloaded${database.version ? ` (v${database.version})` : ""}`
                                        : "not downloaded"}
                                    </p>
                                    {database.path && (
                                      <p className="text-xs text-muted-foreground break-all">
                                        Path: {database.path}
                                      </p>
                                    )}
                                    {database.detail && (
                                      <p className="text-xs text-muted-foreground">
                                        {database.detail}
                                      </p>
                                    )}
                                    {databaseRunning && (
                                      <p className="text-xs text-muted-foreground">
                                        Downloading: {databaseProgress != null ? `${databaseProgress}%` : "in progress"}
                                        {typeof databaseBytes === "number"
                                          ? ` (${formatBytes(databaseBytes)}`
                                          : ""}
                                        {typeof databaseBytes === "number" && typeof databaseTotal === "number"
                                          ? ` / ${formatBytes(databaseTotal)})`
                                          : typeof databaseBytes === "number"
                                            ? ")"
                                            : ""}
                                      </p>
                                    )}
                                    {databaseFailedState && (
                                      <p className={`text-xs ${databaseUnavailable ? "text-destructive" : "text-muted-foreground"}`}>
                                        {database.job?.error
                                          ? databaseUnavailable
                                            ? `${database.label} download failed: ${database.job.error}`
                                            : `Last ${database.label} re-download attempt failed: ${database.job.error}`
                                          : databaseUnavailable
                                            ? `${database.label} download failed`
                                            : `Last ${database.label} re-download attempt failed`}
                                      </p>
                                    )}
                                    {(databaseUnavailable || databaseFailedState) && manualCommands && (
                                      <div className="mt-1 rounded-md border border-border/60 bg-muted/40 p-2">
                                        <p className="text-[11px] text-muted-foreground">
                                          Manual terminal fallback (run on the SeqDesk server):
                                        </p>
                                        <pre className="mt-1 overflow-x-auto whitespace-pre-wrap break-all rounded bg-background p-2 text-[11px] text-foreground">{manualCommands.join("\n")}</pre>
                                      </div>
                                    )}
                                    {database.job?.state === "success" && database.job.finishedAt && (
                                      <p className="text-xs text-muted-foreground">
                                        Last DB download {formatStoreDate(database.job.finishedAt)}
                                      </p>
                                    )}
                                  </div>
                                );
                              })}
                              {downloadInProgress && downloadJob?.startedAt && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Download started {formatStoreDate(downloadJob.startedAt)}
                                </p>
                              )}
                              {downloadFailed && (
                                <p className="text-xs text-destructive mt-1">
                                  {downloadJob?.error ? `Pipeline download failed: ${downloadJob.error}` : "Pipeline download failed"}
                                </p>
                              )}
                              {downloadJob?.state === "success" && downloadFinishedAt && (
                                <p className="text-xs text-muted-foreground mt-1">
                                  Last download {formatStoreDate(downloadFinishedAt)}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>

                        <div className="mt-4 flex flex-wrap items-center gap-3">
                          <div className="ml-auto flex flex-wrap gap-2">
                            {shouldOfferCodeDownload && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleDownloadPipelineCode(pipeline.pipelineId, expectedCodeVersion, codeUpdateAvailable ? "update" : "download")}
                                className="h-8"
                                disabled={downloadingPipeline === pipeline.pipelineId || downloadInProgress}
                              >
                                {downloadingPipeline === pipeline.pipelineId || downloadInProgress ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <Download className="h-4 w-4 mr-1" />
                                )}
                                {downloadingPipeline === pipeline.pipelineId || downloadInProgress
                                  ? downloadAction === "update"
                                    ? "Updating..."
                                    : "Downloading..."
                                  : codeActionLabel}
                              </Button>
                            )}
                            {databaseDownloads.map((database) => {
                              const key = `${pipeline.pipelineId}:${database.id}`;
                              const databaseRunning = database.job?.state === "running";
                              const databaseBusy = downloadingDatabase === key || databaseRunning;
                              const databaseActionLabel =
                                database.status === "downloaded" ? "Re-download DB" : "Download DB";
                              return (
                                <Button
                                  key={key}
                                  variant="outline"
                                  size="sm"
                                  onClick={() =>
                                    handleDownloadPipelineDatabase(
                                      pipeline.pipelineId,
                                      database.id,
                                      database.status === "downloaded"
                                    )
                                  }
                                  className="h-8"
                                  disabled={databaseBusy}
                                >
                                  {databaseBusy ? (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                  ) : (
                                    <Download className="h-4 w-4 mr-1" />
                                  )}
                                  {databaseBusy
                                    ? databaseRunning
                                      ? "Downloading DB..."
                                      : "Starting..."
                                    : databaseActionLabel}
                                </Button>
                              );
                            })}
                            {updateAvailable && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleUpdatePipeline(pipeline.pipelineId, latestVersion)}
                                className="h-8"
                                disabled={installingPipeline === pipeline.pipelineId}
                              >
                                {installingPipeline === pipeline.pipelineId && installAction === "update" ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4 mr-1" />
                                )}
                                {installingPipeline === pipeline.pipelineId && installAction === "update"
                                  ? "Updating..."
                                  : "Update"}
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => handleTogglePipelineEnabled(pipeline)}
                              className="h-8"
                              disabled={togglingPipeline === pipeline.pipelineId}
                            >
                              {togglingPipeline === pipeline.pipelineId ? (
                                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                              ) : (
                                <Settings2 className="h-4 w-4 mr-1" />
                              )}
                              {pipeline.enabled ? "Disable" : "Enable"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openDagDialog(pipeline)}
                              className="h-8"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => openConfigDialog(pipeline)}
                              className="h-8"
                            >
                              <Settings2 className="h-4 w-4 mr-1" />
                              Configure
                            </Button>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </GlassCard>
              ))}

              {availablePipelines.map((pipeline) => (
                <GlassCard key={pipeline.id} className="relative">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-xl ${getCategoryColor(pipeline.category)}`}>
                        {getPipelineIcon(pipeline.icon || "")}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">{pipeline.name}</h3>
                          <Badge variant="outline" className="text-xs font-normal">
                            v{pipeline.version}
                          </Badge>
                          <Badge variant="secondary" className="text-xs">
                            Not installed
                          </Badge>
                          <Badge variant="secondary" className="text-xs capitalize">
                            {pipeline.category}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {pipeline.description}
                        </p>
                        <p className="text-xs text-muted-foreground font-mono mt-1">
                          {pipeline.id}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          by {pipeline.author || "unknown"} | {(pipeline.downloads || 0).toLocaleString()} installs
                        </p>
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="outline"
                      className="bg-white"
                      size="sm"
                      onClick={() => handleInstallPipeline(pipeline.id, pipeline.latestVersion || pipeline.version)}
                      disabled={installingPipeline === pipeline.id}
                    >
                      {installingPipeline === pipeline.id && installAction === "install" ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      {installingPipeline === pipeline.id && installAction === "install" ? "Installing..." : "Install"}
                    </Button>
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-10 text-center">
              <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <h3 className="text-sm font-semibold">
                {selectedCategory === "all"
                  ? "No pipelines found"
                  : "No pipelines in this category"}
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                {selectedCategory === "all"
                  ? "No installed pipelines and no store entries are currently available."
                  : "Try another category or refresh the store registry."}
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Configuration Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-3xl w-[94vw] max-h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="pb-3 border-b">
            <DialogTitle className="flex items-center gap-3">
              {selectedPipeline && getPipelineIcon(selectedPipeline.icon)}
              <span>Configure {selectedPipeline?.name}</span>
            </DialogTitle>
            <DialogDescription>
              Update pipeline-specific settings. Changes apply to future runs.
            </DialogDescription>
          </DialogHeader>

          {selectedPipeline && (
            <div className="flex-1 overflow-auto py-4 pr-1">
              <div className="rounded-lg border border-border bg-muted/20 p-3 mb-4">
                <div className="grid gap-2 sm:grid-cols-3">
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Pipeline ID</p>
                    <p className="text-xs font-mono mt-1 break-all">{selectedPipeline.pipelineId}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Category</p>
                    <p className="text-xs mt-1 capitalize">{selectedPipeline.category}</p>
                  </div>
                  <div>
                    <p className="text-[11px] uppercase tracking-wide text-muted-foreground">Config fields</p>
                    <p className="text-xs mt-1">{configEntries.length}</p>
                  </div>
                </div>
              </div>

              {configEntries.length === 0 ? (
                <div className="rounded-lg border border-dashed bg-muted/30 px-4 py-8 text-center">
                  <Settings2 className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                  <p className="text-sm font-medium">No configurable fields</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    This pipeline currently uses default settings only.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {configEntries.map(([key, schema]) => {
                    const defaultValue =
                      schema.default !== undefined
                        ? schema.default
                        : selectedPipeline.defaultConfig[key];
                    const changed = !isSameConfigValue(
                      localConfig[key],
                      selectedPipeline.config[key]
                    );

                    return (
                      <div
                        key={key}
                        className={`rounded-lg border p-4 ${
                          changed
                            ? "border-amber-200 bg-amber-50/30"
                            : "border-border bg-background"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2 mb-3">
                          <div>
                            <Label htmlFor={key} className="text-sm font-medium">
                              {schema.title}
                            </Label>
                            {schema.description && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {schema.description}
                              </p>
                            )}
                            <p className="text-[11px] font-mono text-muted-foreground mt-1">
                              {key}
                            </p>
                          </div>
                          {changed && (
                            <Badge variant="secondary" className="text-xs">
                              Modified
                            </Badge>
                          )}
                        </div>

                        {schema.type === "boolean" ? (
                          <div className="flex items-center gap-3">
                            <Checkbox
                              id={key}
                              checked={Boolean(localConfig[key])}
                              onCheckedChange={(checked) =>
                                setLocalConfig((prev) => ({
                                  ...prev,
                                  [key]: checked === true,
                                }))
                              }
                            />
                            <Label htmlFor={key} className="text-sm">
                              Enabled
                            </Label>
                          </div>
                        ) : (
                          <Input
                            id={key}
                            type={schema.type === "number" ? "number" : "text"}
                            value={
                              localConfig[key] === undefined || localConfig[key] === null
                                ? ""
                                : String(localConfig[key])
                            }
                            onChange={(e) => {
                              const value = e.target.value;
                              if (schema.type === "number") {
                                setLocalConfig((prev) => {
                                  const next = { ...prev };
                                  if (value === "") {
                                    delete next[key];
                                  } else {
                                    next[key] = Number(value);
                                  }
                                  return next;
                                });
                                return;
                              }
                              setLocalConfig((prev) => ({
                                ...prev,
                                [key]: value,
                              }));
                            }}
                            className="bg-white"
                          />
                        )}

                        {defaultValue !== undefined && (
                          <p className="text-[11px] text-muted-foreground mt-2">
                            Default:{" "}
                            <span className="font-mono">
                              {typeof defaultValue === "string"
                                ? defaultValue
                                : JSON.stringify(defaultValue)}
                            </span>
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {configError && (
                <p className="text-sm text-destructive mt-4">{configError}</p>
              )}
            </div>
          )}

          <DialogFooter className="border-t pt-3 flex items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground mr-auto">
              {hasConfigChanges
                ? `${changedConfigCount} unsaved change${
                    changedConfigCount === 1 ? "" : "s"
                  }`
                : "No unsaved changes"}
            </p>
            <Button
              variant="outline"
              onClick={handleResetToDefaults}
              disabled={saving || configEntries.length === 0}
            >
              Reset
            </Button>
            <Button
              variant="outline"
              onClick={() => setConfigDialogOpen(false)}
              disabled={saving}
            >
              Cancel
            </Button>
            <Button onClick={handleSaveConfig} disabled={saving || !hasConfigChanges}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Pipeline View Dialog with Data Integration and Workflow tabs */}
      <Dialog open={dagDialogOpen} onOpenChange={setDagDialogOpen}>
        <DialogContent className="max-w-6xl w-[95vw] h-[88vh] flex flex-col overflow-hidden">
          <DialogHeader className="border-b pb-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <DialogTitle className="flex items-center gap-3">
                  {selectedPipeline && getPipelineIcon(selectedPipeline.icon)}
                  <span>{selectedPipeline?.name}</span>
                </DialogTitle>
                <DialogDescription className="mt-1">
                  {selectedPipeline?.description}
                </DialogDescription>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {selectedPipeline?.category && (
                  <Badge variant="secondary" className="capitalize">
                    {selectedPipeline.category}
                  </Badge>
                )}
                {selectedPipeline?.pipelineId && (
                  <Badge variant="outline" className="font-mono">
                    {selectedPipeline.pipelineId}
                  </Badge>
                )}
                {pipelineDefinition && (
                  <Badge variant="outline" className="font-normal">
                    v{dagData?.pipeline?.version || "latest"}
                  </Badge>
                )}
                {dagData?.pipeline?.url && (
                  <Button variant="outline" size="sm" className="bg-white" asChild>
                    <a
                      href={dagData.pipeline.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      Docs
                      <ExternalLink className="h-4 w-4 ml-2" />
                    </a>
                  </Button>
                )}
              </div>
            </div>
          </DialogHeader>

          <Tabs
            value={dialogViewTab}
            onValueChange={(v) => setDialogViewTab(v as "integration" | "workflow")}
            className="flex-1 flex flex-col min-h-0 pt-4"
          >
            <TabsList className="grid w-full grid-cols-2 max-w-md">
              <TabsTrigger value="integration" className="gap-2">
                <Layers className="h-4 w-4" />
                Data Integration
              </TabsTrigger>
              <TabsTrigger value="workflow" className="gap-2">
                <FileBarChart className="h-4 w-4" />
                Workflow Steps
              </TabsTrigger>
            </TabsList>

            <TabsContent value="integration" className="flex-1 overflow-auto mt-4">
              {loadingDag ? (
                <div className="flex items-center justify-center h-full min-h-48">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : pipelineDefinition ? (
                <div className="max-w-5xl mx-auto pb-4">
                  <PipelineIntegrationDetails
                    pipelineName={selectedPipeline?.name || "Pipeline"}
                    pipelineId={selectedPipeline?.pipelineId || "unknown"}
                    samplesheet={pipelineDefinition.samplesheet}
                    inputs={pipelineDefinition.inputs}
                    outputs={pipelineDefinition.outputs}
                  />
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Data integration details not available for this pipeline</p>
                </div>
              )}
            </TabsContent>

            <TabsContent value="workflow" className="flex-1 min-h-0 mt-4">
              {loadingDag ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : dagData ? (
                <div className="h-full rounded-lg border border-border overflow-hidden">
                  <PipelineDagViewer
                    nodes={dagData.nodes}
                    edges={dagData.edges}
                    pipeline={dagData.pipeline}
                    className="h-full"
                  />
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  Pipeline workflow not available
                </div>
              )}
            </TabsContent>
          </Tabs>

          <DialogFooter className="border-t pt-3">
            <Button variant="outline" onClick={() => setDagDialogOpen(false)}>
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
