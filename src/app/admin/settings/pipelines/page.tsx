"use client";

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
import {
  Loader2,
  Dna,
  FlaskConical,
  Settings2,
  Eye,
  RefreshCw,
  XCircle,
  Download,
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

export default function PipelineSettingsPage() {
  const { data, error, isLoading, mutate } = useSWR(
    "/api/admin/settings/pipelines",
    fetcher,
    {
      refreshInterval: (latestData) =>
        latestData?.pipelines?.some((pipeline: PipelineConfig) => pipeline.download?.job?.state === "running")
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

  const [showStore, setShowStore] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState("all");
  const [configDialogOpen, setConfigDialogOpen] = useState(false);
  const [dagDialogOpen, setDagDialogOpen] = useState(false);
  const [selectedPipeline, setSelectedPipeline] = useState<PipelineConfig | null>(null);
  const [localConfig, setLocalConfig] = useState<Record<string, unknown>>({});
  const [saving, setSaving] = useState(false);
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

  const openConfigDialog = (pipeline: PipelineConfig) => {
    setSelectedPipeline(pipeline);
    setLocalConfig({ ...pipeline.config });
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

  const installedPipelineIds = new Set(data?.pipelines?.map((p: PipelineConfig) => p.pipelineId) || []);
  const storePipelines: StorePipeline[] = storeData?.pipelines || [];
  const storePipelineMap = new Map(storePipelines.map((pipeline) => [pipeline.id, pipeline]));
  const storeCategories: StoreCategory[] = storeData?.categories || [];
  const availablePipelines = storePipelines.filter(
    (pipeline) => !installedPipelineIds.has(pipeline.id) && (selectedCategory === "all" || pipeline.category === selectedCategory)
  );
  const installedCount = data?.pipelines?.length || 0;
  const shouldShowStore = showStore || installedCount === 0;
  const storeToggleLabel = shouldShowStore && installedCount > 0 ? "Hide store" : "Add pipeline";

  return (
    <PageContainer>
      <div className="mb-8 flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Pipelines</h1>
          <p className="text-muted-foreground mt-1">
            Install and manage nf-core pipelines. Installed pipelines are ready to run. Execution settings live in Data & Compute.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" asChild>
            <a href="/admin/data-compute">Compute settings</a>
          </Button>
          <Button size="sm" onClick={() => setShowStore((prev) => !prev)}>
            <Download className="h-4 w-4 mr-2" />
            {storeToggleLabel}
          </Button>
        </div>
      </div>

      <section id="installed-pipelines" className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Installed</p>
            <h2 className="text-2xl font-semibold">Installed pipelines</h2>
            <p className="text-sm text-muted-foreground mt-2">
              Installed pipelines are available on this instance and ready to run. Download to warm the workflow cache.
            </p>
          </div>
          <Badge variant="secondary" className="h-6 px-3">
            {installedCount} installed
          </Badge>
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

        {isLoading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-center py-12 text-destructive">
            Failed to load pipeline configurations
          </div>
        ) : installedCount > 0 ? (
          <div className="grid gap-4 md:grid-cols-2">
            {data.pipelines.map((pipeline: PipelineConfig) => (
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
          </div>
        ) : (
          <div className="text-center py-16 bg-muted/30 rounded-xl border border-dashed">
            <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <h3 className="font-semibold mb-2">No Pipelines Installed</h3>
            <p className="text-muted-foreground mb-4">
              Install a pipeline from the store to get started.
            </p>
            <Button onClick={() => setShowStore(true)}>
              <Download className="h-4 w-4 mr-2" />
              Browse Store
            </Button>
          </div>
        )}
      </section>

      {shouldShowStore && (
        <section id="pipeline-store" className="space-y-4">
          <GlassCard className="space-y-4">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-muted-foreground">Pipeline store</p>
                <h2 className="text-2xl font-semibold">Add pipelines</h2>
                <p className="text-sm text-muted-foreground mt-2 max-w-2xl">
                  Install nf-core pipelines packaged for SeqDesk with samplesheet generation and output parsing.
                  Download the workflow code after install to warm the Nextflow cache.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => mutateStore()}
                  disabled={storeLoading}
                >
                  <RefreshCw className={`h-4 w-4 mr-2 ${storeLoading ? "animate-spin" : ""}`} />
                  Refresh registry
                </Button>
                <Button size="sm" asChild>
                  <a
                    href={`${storeData?.browseUrl || "https://seqdesk.com/pipelines"}`}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Browse store
                    <ExternalLink className="h-4 w-4 ml-2" />
                  </a>
                </Button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <Badge variant={storeError ? "destructive" : "secondary"} className="uppercase text-[10px]">
                {storeLoading ? "Checking" : storeError ? "Registry failed" : "Registry online"}
              </Badge>
              {!storeLoading && !storeError && (
                <>
                  <span>v{storeData?.version || "unknown"}</span>
                  <span>|</span>
                  <span>{storePipelines.length} pipelines</span>
                  <span>|</span>
                  <span>Updated {formatStoreDate(storeData?.lastUpdated)}</span>
                </>
              )}
            </div>

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

            <div className="flex flex-wrap items-center gap-3">
              <div className="w-56">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger>
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
              <span className="text-xs text-muted-foreground">
                Showing {availablePipelines.length} available
              </span>
            </div>

            {storeLoading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
              </div>
            ) : storeError ? (
              <div className="text-center py-12 text-destructive">
                Failed to load pipeline registry from the store.
              </div>
            ) : availablePipelines.length > 0 ? (
              <div className="grid gap-3">
                {availablePipelines.map((pipeline) => (
                  <div
                    key={pipeline.id}
                    className="flex flex-col gap-4 rounded-xl border bg-card p-4 md:flex-row md:items-center md:justify-between"
                  >
                    <div className="flex items-start gap-3">
                      <div className={`p-2.5 rounded-lg ${getCategoryColor(pipeline.category)}`}>
                        {getPipelineIcon(pipeline.icon || "")}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-semibold">{pipeline.name}</h3>
                          <Badge variant="outline" className="text-xs font-normal">
                            v{pipeline.version}
                          </Badge>
                          <Badge variant="secondary" className="text-xs capitalize">
                            {pipeline.category}
                          </Badge>
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {pipeline.description}
                        </p>
                        <p className="text-xs text-muted-foreground mt-1">
                          by {pipeline.author || "unknown"} | {(pipeline.downloads || 0).toLocaleString()} installs
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
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
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-muted-foreground">
                No additional pipelines available in this category.
              </div>
            )}

            <details className="rounded-lg border border-dashed px-4 py-3 text-xs text-muted-foreground">
              <summary className="cursor-pointer text-sm font-medium text-foreground">
                Store URLs
              </summary>
              <div className="mt-2 grid gap-1">
                <div className="flex flex-wrap gap-2">
                  <span className="min-w-[110px] text-muted-foreground/70">Store URL</span>
                  <span className="font-mono break-all">{storeData?.storeBaseUrl || "https://seqdesk.com"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="min-w-[110px] text-muted-foreground/70">Registry URL</span>
                  <span className="font-mono break-all">{storeData?.registryUrl || "https://seqdesk.com/api/registry"}</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="min-w-[110px] text-muted-foreground/70">Browse URL</span>
                  <span className="font-mono break-all">{storeData?.browseUrl || "https://seqdesk.com/pipelines"}</span>
                </div>
              </div>
            </details>
          </GlassCard>
        </section>
      )}

      {/* Configuration Dialog */}
      <Dialog open={configDialogOpen} onOpenChange={setConfigDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Configure {selectedPipeline?.name}</DialogTitle>
            <DialogDescription>Adjust pipeline-specific settings</DialogDescription>
          </DialogHeader>

          {selectedPipeline && (
            <div className="space-y-4 py-4">
              {Object.entries(selectedPipeline.configSchema.properties).map(([key, schema]) => (
                <div key={key} className="space-y-2">
                  {schema.type === "boolean" ? (
                    <div className="flex items-start gap-3">
                      <Checkbox
                        id={key}
                        checked={localConfig[key] as boolean}
                        onCheckedChange={(checked) =>
                          setLocalConfig((prev) => ({ ...prev, [key]: checked }))
                        }
                      />
                      <div className="grid gap-1.5 leading-none">
                        <Label htmlFor={key}>{schema.title}</Label>
                        {schema.description && (
                          <p className="text-sm text-muted-foreground">{schema.description}</p>
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
                            [key]: schema.type === "number" ? Number(e.target.value) : e.target.value,
                          }))
                        }
                        className="w-full px-3 py-2 border rounded-md bg-background"
                      />
                      {schema.description && (
                        <p className="text-sm text-muted-foreground">{schema.description}</p>
                      )}
                    </div>
                  )}
                </div>
              ))}
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

      {/* Pipeline View Dialog with Data Integration and Workflow tabs */}
      <Dialog open={dagDialogOpen} onOpenChange={setDagDialogOpen}>
        <DialogContent className="max-w-6xl w-[95vw] h-[85vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-3">
              {selectedPipeline && getPipelineIcon(selectedPipeline.icon)}
              {selectedPipeline?.name}
              {pipelineDefinition && (
                <Badge variant="outline" className="font-normal">
                  v{dagData?.pipeline?.version || "latest"}
                </Badge>
              )}
            </DialogTitle>
            <DialogDescription>{selectedPipeline?.description}</DialogDescription>
          </DialogHeader>

          {/* View Tabs */}
          <Tabs value={dialogViewTab} onValueChange={(v) => setDialogViewTab(v as "integration" | "workflow")} className="flex-1 flex flex-col min-h-0">
            <TabsList className="w-fit">
              <TabsTrigger value="integration" className="gap-2">
                <Layers className="h-4 w-4" />
                Data Integration
              </TabsTrigger>
              <TabsTrigger value="workflow" className="gap-2">
                <FileBarChart className="h-4 w-4" />
                Workflow Steps
              </TabsTrigger>
            </TabsList>

            {/* Data Integration Tab */}
            <TabsContent value="integration" className="flex-1 overflow-auto mt-4">
              {loadingDag ? (
                <div className="flex items-center justify-center h-64">
                  <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
                </div>
              ) : pipelineDefinition ? (
                <div className="max-w-4xl mx-auto pb-4">
                  <PipelineIntegrationDetails
                    pipelineName={selectedPipeline?.name || "Pipeline"}
                    pipelineId={selectedPipeline?.pipelineId || "unknown"}
                    samplesheet={pipelineDefinition.samplesheet}
                    inputs={pipelineDefinition.inputs}
                    outputs={pipelineDefinition.outputs}
                  />

                  {/* Link to docs */}
                  {dagData?.pipeline?.url && (
                    <div className="mt-8 pt-6 border-t text-center">
                      <a
                        href={dagData.pipeline.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-2 text-sm text-primary hover:underline"
                      >
                        View full nf-core documentation
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  )}
                </div>
              ) : (
                <div className="text-center py-12 text-muted-foreground">
                  <Layers className="h-12 w-12 mx-auto mb-4 opacity-50" />
                  <p>Data integration details not available for this pipeline</p>
                </div>
              )}
            </TabsContent>

            {/* Workflow Steps Tab */}
            <TabsContent value="workflow" className="flex-1 min-h-0 mt-4">
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
            </TabsContent>
          </Tabs>

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
