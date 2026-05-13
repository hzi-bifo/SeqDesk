"use client";

import { useEffect, useState } from "react";
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
import { Switch } from "@/components/ui/switch";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  AlertTriangle,
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
  FileArchive,
  Layers,
  CheckCircle2,
  ChevronDown,
  Wrench,
  MoreHorizontal,
} from "lucide-react";
import { PipelineDagViewer, DagNode, DagEdge, PipelineInfo } from "@/components/pipelines/PipelineDagViewer";
import { PipelineIntegrationDetails } from "@/components/pipelines/PipelineIntegrationDetails";

const fetcher = (url: string) => fetch(url).then((r) => r.json());
const DEFAULT_GITHUB_REF = "main";

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

interface SequencingTechnologyOption {
  id: string;
  name: string;
  manufacturer?: string;
}

interface SequencingTechResponse {
  technologies: SequencingTechnologyOption[];
}

interface PipelineConfig {
  pipelineId: string;
  name: string;
  description: string;
  category: string;
  version?: string;
  icon: string;
  enabled: boolean;
  catalogs?: string[];
  config: Record<string, unknown>;
  download?: PipelineDownloadInfo;
  databaseDownloads?: PipelineDatabaseDownloadInfo[];
  configSchema: {
    properties: Record<string, {
      type: string;
      title: string;
      description?: string;
      default?: unknown;
      enum?: string[];
    }>;
  };
  defaultConfig: Record<string, unknown>;
  readiness?: PipelineReadiness;
}

interface PipelineReadiness {
  status: "ready" | "warning" | "missing";
  summary: string;
  items: PipelineReadinessItem[];
}

interface PipelineReadinessItem {
  id: string;
  label: string;
  status: "ready" | "warning" | "missing";
  detail?: string;
  action?: "install" | "sync" | "download-db" | "configure" | "enable" | "review-outputs";
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
    phase?: "downloading" | "verifying" | "installing";
    sourceUrl?: string;
    targetPath?: string;
    pid?: number;
    bytesDownloaded?: number;
    totalBytes?: number;
    progressPercent?: number | null;
    limitRate?: string;
    startedAt?: string;
    finishedAt?: string;
    error?: string;
    logPath?: string;
    cancelled?: boolean;
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
  catalogs?: string[];
  isPrivate?: boolean;
  licenseRequired?: boolean;
  source: {
    kind: "registry" | "privateRegistry" | "github";
    sourceId: string;
    label: string;
    registryUrl?: string;
    browseUrl?: string;
    downloadUrl?: string;
    packageUrlDefault?: string;
    keyLabel?: string;
    repository?: string;
    refDefault?: string;
    descriptorPath?: string;
    includeWorkflow?: boolean;
  };
}

interface StoreCategory {
  id: string;
  name: string;
  description?: string;
}

interface PrivateInstallTarget {
  pipelineId: string;
  name: string;
  version?: string;
  source: StorePipeline["source"];
  packageUrlDefault?: string;
  keyLabel?: string;
}

interface GitHubInstallTarget {
  pipelineId: string;
  name: string;
  source: StorePipeline["source"];
  version?: string;
}

interface SmokeArtifactInspection {
  fileName?: string;
  summary: {
    totalFiles: number;
    publishedFiles: number;
    ignoredWorkFiles: number;
    suggestedOutputs: number;
  };
  entries: Array<{
    path: string;
    sizeBytes: number;
    type: string;
  }>;
  suggestions: Array<{
    id: string;
    label: string;
    pattern: string;
    destination: string;
    type: string;
    count: number;
  }>;
}

interface DescriptorLintResult {
  packageId: string;
  packageDir: string;
  valid: boolean;
  errors: number;
  warnings: number;
  issues: Array<{
    level: "error" | "warning";
    code: string;
    message: string;
    file?: string;
  }>;
}

type CatalogView = "installed" | "available" | "needs-setup";

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

function isPrivateStorePipeline(pipeline?: StorePipeline | null): boolean {
  if (!pipeline) return false;
  return pipeline.source.kind === "privateRegistry";
}

function isGitHubStorePipeline(pipeline?: StorePipeline | null): boolean {
  return pipeline?.source.kind === "github";
}

function getSourceBadgeLabel(source: StorePipeline["source"]): string {
  if (source.kind === "github") return "GitHub";
  if (source.kind === "privateRegistry") return `${source.label} private`;
  return source.label;
}

interface MetadataHint {
  id: string;
  label: string;
  required?: boolean;
  description: string;
}

function getPipelineMetadataHints(pipelineId: string): MetadataHint[] {
  if (pipelineId === "mag") {
    return [
      {
        id: "mag-platform",
        label: "Sequencing technology",
        required: true,
        description:
          "Required for MAG pre-check. Value comes from the sequencing technology selector and registry compatibility metadata.",
      },
      {
        id: "mag-short-read",
        label: "Short-read compatibility",
        description:
          "MAG validates short-read paired technologies. An explicit allow list narrows compatible technology IDs but cannot enable long-read or single-read technologies.",
      },
    ];
  }

  return [];
}

function getEnumOptionLabel(key: string, value: string): string {
  if (key === "runAt") {
    if (value === "all") return "All Inputs (Default)";
    if (value === "selected-technologies") return "Selected Sequencing Technologies";
  }
  return value;
}

function isSameConfigValue(a: unknown, b: unknown) {
  if (a === b) return true;
  if (a === undefined && b === undefined) return true;
  return JSON.stringify(a) === JSON.stringify(b);
}

function isUnsetConfigValue(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function formatConfigValue(value: unknown): string {
  if (isUnsetConfigValue(value)) return "Not set";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return JSON.stringify(value);
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

function getReadinessStatusIcon(status: PipelineReadinessItem["status"]) {
  if (status === "ready") {
    return <CheckCircle2 className="h-4 w-4 text-[#00BD7D]" />;
  }
  if (status === "warning") {
    return <AlertTriangle className="h-4 w-4 text-amber-600" />;
  }
  return <XCircle className="h-4 w-4 text-destructive" />;
}

function getReadinessBadge(pipeline: PipelineConfig) {
  const readiness = pipeline.readiness;
  if (!readiness) return null;
  if (readiness.status === "ready") {
    return <Badge variant="outline" className="text-xs font-normal">Ready</Badge>;
  }
  if (readiness.status === "warning") {
    return <Badge variant="secondary" className="text-xs">Setup review</Badge>;
  }
  return <Badge variant="secondary" className="text-xs">Setup incomplete</Badge>;
}

function getReadinessActionLabel(action?: PipelineReadinessItem["action"]) {
  switch (action) {
    case "install":
      return "Install package";
    case "sync":
      return "Sync package";
    case "download-db":
      return "Install DB";
    case "configure":
      return "Configure";
    case "enable":
      return "Enable";
    case "review-outputs":
      return "Review outputs";
    default:
      return null;
  }
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

  const { data: sequencingTechData } = useSWR<SequencingTechResponse>(
    "/api/sequencing-tech",
    fetcher
  );

  const [activeTab, setActiveTab] = useState("order");
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
  const [privateInstallDialogOpen, setPrivateInstallDialogOpen] = useState(false);
  const [privateInstallTarget, setPrivateInstallTarget] = useState<PrivateInstallTarget | null>(null);
  const [privateInstallMode, setPrivateInstallMode] = useState<"install" | "update">("install");
  const [privatePackageUrl, setPrivatePackageUrl] = useState("");
  const [privateAccessKey, setPrivateAccessKey] = useState("");
  const [privateSha256, setPrivateSha256] = useState("");
  const [privateInstallError, setPrivateInstallError] = useState<string | null>(null);
  const [githubInstallDialogOpen, setGithubInstallDialogOpen] = useState(false);
  const [githubInstallTarget, setGithubInstallTarget] = useState<GitHubInstallTarget | null>(null);
  const [githubInstallMode, setGithubInstallMode] = useState<"install" | "update">("install");
  const [githubRepository, setGithubRepository] = useState("");
  const [githubRef, setGithubRef] = useState(DEFAULT_GITHUB_REF);
  const [githubToken, setGithubToken] = useState("");
  const [githubInstallError, setGithubInstallError] = useState<string | null>(null);
  const [githubSubmitting, setGithubSubmitting] = useState(false);
  const [smokeArtifactDialogOpen, setSmokeArtifactDialogOpen] = useState(false);
  const [smokeArtifactFile, setSmokeArtifactFile] = useState<File | null>(null);
  const [smokeArtifactInspecting, setSmokeArtifactInspecting] = useState(false);
  const [smokeArtifactError, setSmokeArtifactError] = useState<string | null>(null);
  const [smokeArtifactResult, setSmokeArtifactResult] = useState<SmokeArtifactInspection | null>(null);
  const [descriptorLintDialogOpen, setDescriptorLintDialogOpen] = useState(false);
  const [descriptorLintTarget, setDescriptorLintTarget] = useState<PipelineConfig | null>(null);
  const [descriptorLintLoading, setDescriptorLintLoading] = useState(false);
  const [descriptorLintError, setDescriptorLintError] = useState<string | null>(null);
  const [descriptorLintResult, setDescriptorLintResult] = useState<DescriptorLintResult | null>(null);
  const [downloadingPipeline, setDownloadingPipeline] = useState<string | null>(null);
  const [downloadAction, setDownloadAction] = useState<"download" | "update" | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [downloadingDatabase, setDownloadingDatabase] = useState<string | null>(null);
  const [databaseError, setDatabaseError] = useState<string | null>(null);
  const [dbDownloadDialogOpen, setDbDownloadDialogOpen] = useState(false);
  const [dbDownloadTarget, setDbDownloadTarget] = useState<{
    pipelineId: string;
    pipelineName: string;
    database: PipelineDatabaseDownloadInfo;
  } | null>(null);
  const [dbDownloadCustomPath, setDbDownloadCustomPath] = useState("");
  const [dbDownloadReplace, setDbDownloadReplace] = useState(false);
  const [dbDownloadLimitRate, setDbDownloadLimitRate] = useState("");
  const [dbDownloadDialogError, setDbDownloadDialogError] = useState<string | null>(null);
  const [dbPreflight, setDbPreflight] = useState<{
    loading: boolean;
    expectedBytes: number | null;
    freeBytes: number | null;
    partialBytes: number;
    remainingBytes: number | null;
    sufficient: boolean | null;
    hasSha256: boolean;
    targetPath: string | null;
    error?: string | null;
  } | null>(null);
  const [cancellingDatabase, setCancellingDatabase] = useState<string | null>(null);
  const [togglingPipeline, setTogglingPipeline] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [allowUserAssemblyDownload, setAllowUserAssemblyDownload] = useState(false);
  const [savingAssemblyDownloadSetting, setSavingAssemblyDownloadSetting] = useState(false);
  const [assemblyDownloadSettingError, setAssemblyDownloadSettingError] = useState<string | null>(null);
  const [advancedToolsOpen, setAdvancedToolsOpen] = useState(false);
  const [showPipelineDetails, setShowPipelineDetails] = useState(false);
  const [catalogView, setCatalogView] = useState<CatalogView>("installed");

  useEffect(() => {
    let mounted = true;

    const fetchAccessSettings = async () => {
      try {
        const res = await fetch("/api/admin/settings/access");
        if (!res.ok) return;
        const payload = (await res.json()) as { allowUserAssemblyDownload?: boolean };
        if (mounted) {
          setAllowUserAssemblyDownload(payload.allowUserAssemblyDownload === true);
        }
      } catch {
        // Best effort only.
      }
    };

    void fetchAccessSettings();

    return () => {
      mounted = false;
    };
  }, []);

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

  const formatSpeed = (bytesPerSec?: number | null) => {
    if (typeof bytesPerSec !== "number" || !Number.isFinite(bytesPerSec) || bytesPerSec <= 0) {
      return null;
    }
    return `${formatBytes(bytesPerSec)}/s`;
  };

  const formatDuration = (seconds?: number | null) => {
    if (typeof seconds !== "number" || !Number.isFinite(seconds) || seconds < 0) {
      return null;
    }
    if (seconds < 60) return `${Math.round(seconds)}s`;
    if (seconds < 3600) {
      const m = Math.floor(seconds / 60);
      const s = Math.round(seconds % 60);
      return s > 0 ? `${m}m ${s}s` : `${m}m`;
    }
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return m > 0 ? `${h}h ${m}m` : `${h}h`;
  };

  const openPrivateInstallDialog = (
    target: PrivateInstallTarget,
    mode: "install" | "update"
  ) => {
    setPrivateInstallTarget(target);
    setPrivateInstallMode(mode);
    setPrivatePackageUrl(target.packageUrlDefault || "");
    setPrivateAccessKey("");
    setPrivateSha256("");
    setPrivateInstallError(null);
    setPrivateInstallDialogOpen(true);
  };

  const handlePrivateInstallPipeline = async () => {
    if (!privateInstallTarget) return;

    const packageUrl = privatePackageUrl.trim();
    const accessKey = privateAccessKey.trim();
    const sha256 = privateSha256.trim();

    if (!packageUrl || !accessKey) {
      setPrivateInstallError("Package URL and access key are required.");
      return;
    }

    setInstallingPipeline(privateInstallTarget.pipelineId);
    setInstallAction(privateInstallMode);
    setInstallError(null);
    setPrivateInstallError(null);

    try {
      const res = await fetch("/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: privateInstallTarget.pipelineId,
          version: privateInstallTarget.version,
          replace: privateInstallMode === "update",
          source: {
            ...privateInstallTarget.source,
            packageUrlDefault: packageUrl,
          },
          credentials: {
            accessKey,
            sha256: sha256 || undefined,
          },
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        const message = data?.details || data?.error || "Private package installation failed";
        setPrivateInstallError(message);
        setInstallError(message);
        return;
      }

      setPrivateInstallDialogOpen(false);
      setPrivateInstallTarget(null);
      setPrivateAccessKey("");
      setPrivateSha256("");
      await Promise.all([mutate(), mutateStore()]);
    } catch (err) {
      const message = "Private package installation failed. Check logs for details.";
      setPrivateInstallError(message);
      setInstallError(message);
      console.error("Private install error:", err);
    } finally {
      setInstallingPipeline(null);
      setInstallAction(null);
    }
  };

  const openGitHubInstallDialog = (
    target: GitHubInstallTarget,
    mode: "install" | "update"
  ) => {
    setGithubInstallTarget(target);
    setGithubInstallMode(mode);
    setGithubRepository(target.source.repository || "");
    setGithubRef(target.source.refDefault || DEFAULT_GITHUB_REF);
    setGithubToken("");
    setGithubInstallError(null);
    setGithubInstallDialogOpen(true);
  };

  const handleGitHubInstall = async () => {
    if (!githubInstallTarget) return;

    const token = githubToken.trim();
    const repository = githubRepository.trim();
    const ref = githubRef.trim() || githubInstallTarget.source.refDefault || DEFAULT_GITHUB_REF;

    if (!token || !repository) {
      setGithubInstallError("Repository and GitHub token are required.");
      return;
    }

    setGithubSubmitting(true);
    setGithubInstallError(null);
    setInstallError(null);
    setInstallingPipeline(githubInstallTarget.pipelineId);
    setInstallAction(githubInstallMode);

    try {
      const res = await fetch("/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId: githubInstallTarget.pipelineId,
          version: githubInstallTarget.version,
          replace: githubInstallMode === "update",
          source: {
            ...githubInstallTarget.source,
            repository,
            refDefault: ref,
          },
          credentials: {
            token,
          },
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const message = data?.details || data?.error || "Failed to install pipeline from GitHub.";
        setGithubInstallError(message);
        setInstallError(message);
        return;
      }

      setGithubInstallDialogOpen(false);
      setGithubToken("");
      setGithubInstallError(null);
      await Promise.all([mutate(), mutateStore()]);
    } catch (err) {
      const message = "Failed to install pipeline from GitHub. Check server logs for details.";
      setGithubInstallError(message);
      setInstallError(message);
      console.error("GitHub install error:", err);
    } finally {
      setGithubSubmitting(false);
      setGithubToken("");
      setInstallingPipeline(null);
      setInstallAction(null);
    }
  };

  const handleInspectSmokeArtifact = async () => {
    if (!smokeArtifactFile) {
      setSmokeArtifactError("Choose a smoke artifact ZIP first.");
      return;
    }

    setSmokeArtifactInspecting(true);
    setSmokeArtifactError(null);
    setSmokeArtifactResult(null);

    try {
      const formData = new FormData();
      formData.append("artifact", smokeArtifactFile);
      const res = await fetch("/api/admin/settings/pipelines/smoke-artifact", {
        method: "POST",
        body: formData,
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(
          payload?.details || payload?.error || "Smoke artifact inspection failed."
        );
      }
      setSmokeArtifactResult(payload as SmokeArtifactInspection);
    } catch (error) {
      setSmokeArtifactError(
        error instanceof Error ? error.message : "Smoke artifact inspection failed."
      );
    } finally {
      setSmokeArtifactInspecting(false);
    }
  };

  const handleLintDescriptor = async (pipeline: PipelineConfig) => {
    setDescriptorLintTarget(pipeline);
    setDescriptorLintDialogOpen(true);
    setDescriptorLintLoading(true);
    setDescriptorLintError(null);
    setDescriptorLintResult(null);

    try {
      const res = await fetch(
        `/api/admin/settings/pipelines/${encodeURIComponent(pipeline.pipelineId)}/lint`
      );
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.error || "Descriptor lint failed.");
      }
      setDescriptorLintResult(payload.result as DescriptorLintResult);
    } catch (error) {
      setDescriptorLintError(
        error instanceof Error ? error.message : "Descriptor lint failed."
      );
    } finally {
      setDescriptorLintLoading(false);
    }
  };

  // Install a pipeline from the store
  const handleInstallPipeline = async (
    pipelineId: string,
    version: string | undefined,
    source: StorePipeline["source"] | undefined
  ) => {
    setInstallingPipeline(pipelineId);
    setInstallAction("install");
    setInstallError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, version, source }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallError(data.error || "Installation failed");
        return;
      }
      await Promise.all([mutate(), mutateStore()]);
    } catch (err) {
      setInstallError("Installation failed. Check console for details.");
      console.error("Install error:", err);
    } finally {
      setInstallingPipeline(null);
      setInstallAction(null);
    }
  };

  const handleUpdatePipeline = async (
    pipelineId: string,
    version: string | undefined,
    source: StorePipeline["source"] | undefined
  ) => {
    setInstallingPipeline(pipelineId);
    setInstallAction("update");
    setInstallError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/install", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, version, replace: true, source }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallError(data.error || "Update failed");
        return;
      }
      await Promise.all([mutate(), mutateStore()]);
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
    replace = false,
    targetPath?: string,
    limitRate?: string
  ) => {
    const key = `${pipelineId}:${databaseId}`;
    setDownloadingDatabase(key);
    setDatabaseError(null);
    try {
      const trimmedTarget = typeof targetPath === "string" ? targetPath.trim() : "";
      const trimmedLimit = typeof limitRate === "string" ? limitRate.trim() : "";
      const res = await fetch("/api/admin/settings/pipelines/download-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId,
          databaseId,
          replace,
          ...(trimmedTarget ? { targetPath: trimmedTarget } : {}),
          ...(trimmedLimit ? { limitRate: trimmedLimit } : {}),
        }),
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

  const [linkingDatabase, setLinkingDatabase] = useState(false);

  const handleLinkExistingDatabase = async () => {
    if (!dbDownloadTarget) return;
    const trimmed = dbDownloadCustomPath.trim();
    if (trimmed.length === 0) {
      setDbDownloadDialogError("Enter the absolute path to the existing file.");
      return;
    }
    if (!trimmed.startsWith("/")) {
      setDbDownloadDialogError("Path must be absolute (start with '/').");
      return;
    }
    setLinkingDatabase(true);
    setDbDownloadDialogError(null);
    try {
      const res = await fetch(
        "/api/admin/settings/pipelines/download-db/link-existing",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            pipelineId: dbDownloadTarget.pipelineId,
            databaseId: dbDownloadTarget.database.id,
            path: trimmed,
          }),
        }
      );
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDbDownloadDialogError(data.error || "Failed to link existing file");
        return;
      }
      setDbDownloadDialogOpen(false);
      mutate();
    } catch (err) {
      console.error("Link existing DB error:", err);
      setDbDownloadDialogError("Failed to link existing file. Check console for details.");
    } finally {
      setLinkingDatabase(false);
    }
  };

  const handleCancelDatabaseDownload = async (
    pipelineId: string,
    databaseId: string
  ) => {
    const key = `${pipelineId}:${databaseId}`;
    setCancellingDatabase(key);
    setDatabaseError(null);
    try {
      const res = await fetch("/api/admin/settings/pipelines/download-db/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pipelineId, databaseId }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDatabaseError(data.error || "Cancel failed");
        return;
      }
      mutate();
    } catch (err) {
      setDatabaseError("Cancel failed. Check console for details.");
      console.error("Database cancel error:", err);
    } finally {
      setCancellingDatabase(null);
    }
  };

  const fetchDbPreflight = async (
    pipelineId: string,
    databaseId: string,
    targetPath: string
  ) => {
    setDbPreflight((prev) => ({
      loading: true,
      expectedBytes: prev?.expectedBytes ?? null,
      freeBytes: prev?.freeBytes ?? null,
      partialBytes: prev?.partialBytes ?? 0,
      remainingBytes: prev?.remainingBytes ?? null,
      sufficient: prev?.sufficient ?? null,
      hasSha256: prev?.hasSha256 ?? false,
      targetPath: prev?.targetPath ?? null,
      error: prev?.error ?? null,
    }));
    try {
      const res = await fetch("/api/admin/settings/pipelines/download-db/preflight", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          pipelineId,
          databaseId,
          ...(targetPath.trim() ? { targetPath: targetPath.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setDbPreflight({
          loading: false,
          expectedBytes: null,
          freeBytes: null,
          partialBytes: 0,
          remainingBytes: null,
          sufficient: null,
          hasSha256: false,
          targetPath: null,
          error: data.error || "Preflight failed",
        });
        return;
      }
      setDbPreflight({
        loading: false,
        expectedBytes: typeof data.expectedBytes === "number" ? data.expectedBytes : null,
        freeBytes: typeof data.freeBytes === "number" ? data.freeBytes : null,
        partialBytes: typeof data.partialBytes === "number" ? data.partialBytes : 0,
        remainingBytes: typeof data.remainingBytes === "number" ? data.remainingBytes : null,
        sufficient: typeof data.sufficient === "boolean" ? data.sufficient : null,
        hasSha256: Boolean(data.hasSha256),
        targetPath: typeof data.targetPath === "string" ? data.targetPath : null,
        error: data.error || null,
      });
    } catch (err) {
      console.error("Preflight error:", err);
      setDbPreflight({
        loading: false,
        expectedBytes: null,
        freeBytes: null,
        partialBytes: 0,
        remainingBytes: null,
        sufficient: null,
        hasSha256: false,
        targetPath: null,
        error: "Preflight check failed",
      });
    }
  };

  const openDbDownloadDialog = (
    pipeline: PipelineConfig,
    database: PipelineDatabaseDownloadInfo
  ) => {
    setDbDownloadTarget({
      pipelineId: pipeline.pipelineId,
      pipelineName: pipeline.name,
      database,
    });
    const initialPath =
      database.configuredPath ||
      database.path ||
      database.expectedPath ||
      "";
    setDbDownloadCustomPath(initialPath);
    setDbDownloadReplace(false);
    setDbDownloadLimitRate("");
    setDbDownloadDialogError(null);
    setDbPreflight(null);
    setDatabaseError(null);
    setDbDownloadDialogOpen(true);
    void fetchDbPreflight(pipeline.pipelineId, database.id, initialPath);
  };

  useEffect(() => {
    if (!dbDownloadDialogOpen || !dbDownloadTarget) return;
    const handle = setTimeout(() => {
      void fetchDbPreflight(
        dbDownloadTarget.pipelineId,
        dbDownloadTarget.database.id,
        dbDownloadCustomPath
      );
    }, 400);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dbDownloadCustomPath, dbDownloadDialogOpen, dbDownloadTarget?.pipelineId, dbDownloadTarget?.database.id]);

  const handleConfirmDbDownload = async () => {
    if (!dbDownloadTarget) return;
    const trimmed = dbDownloadCustomPath.trim();
    if (trimmed.length > 0) {
      if (!trimmed.startsWith("/")) {
        setDbDownloadDialogError(
          "Target path must be absolute (start with '/')."
        );
        return;
      }
      if (trimmed.endsWith("/")) {
        setDbDownloadDialogError(
          "Target path must include the file name, not just a directory."
        );
        return;
      }
    }
    const trimmedLimit = dbDownloadLimitRate.trim();
    if (trimmedLimit.length > 0 && !/^\d+[KMG]?$/i.test(trimmedLimit)) {
      setDbDownloadDialogError(
        "Bandwidth limit must be a number with optional K/M/G suffix (e.g. '10M', '512K')."
      );
      return;
    }
    const defaultPath = dbDownloadTarget.database.expectedPath || "";
    const customPath = trimmed && trimmed !== defaultPath ? trimmed : undefined;
    setDbDownloadDialogOpen(false);
    setDbDownloadDialogError(null);
    await handleDownloadPipelineDatabase(
      dbDownloadTarget.pipelineId,
      dbDownloadTarget.database.id,
      dbDownloadReplace,
      customPath,
      trimmedLimit || undefined
    );
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

  const handleAllowUserAssemblyDownloadChange = async (enabled: boolean) => {
    const previousValue = allowUserAssemblyDownload;
    setAllowUserAssemblyDownload(enabled);
    setSavingAssemblyDownloadSetting(true);
    setAssemblyDownloadSettingError(null);

    try {
      const res = await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowUserAssemblyDownload: enabled }),
      });
      if (!res.ok) {
        throw new Error("Failed to save setting");
      }
    } catch {
      setAllowUserAssemblyDownload(previousValue);
      setAssemblyDownloadSettingError("Failed to update researcher assembly download setting.");
    } finally {
      setSavingAssemblyDownloadSetting(false);
    }
  };

  const installedPipelines: PipelineConfig[] = data?.pipelines || [];
  const installedPipelineIds = new Set(installedPipelines.map((p) => p.pipelineId));
  const storePipelines: StorePipeline[] = storeData?.pipelines || [];
  const visibleStorePipelines = storePipelines;
  const preferredStorePipelineMap = new Map<string, StorePipeline>();
  for (const pipeline of storePipelines) {
    const current = preferredStorePipelineMap.get(pipeline.id);
    if (!current || compareVersions(pipeline.latestVersion, current.latestVersion) >= 0) {
      preferredStorePipelineMap.set(pipeline.id, pipeline);
    }
  }
  const storeCategories: StoreCategory[] = storeData?.categories || [];
  const filteredInstalledPipelines = installedPipelines.filter(
    (pipeline) => selectedCategory === "all" || pipeline.category === selectedCategory
  );
  const availablePipelines = visibleStorePipelines.filter(
    (pipeline) =>
      !installedPipelineIds.has(pipeline.id) &&
      (selectedCategory === "all" || pipeline.category === selectedCategory)
  );
  const installedCount = installedPipelines.length;
  const availablePipelineCount = visibleStorePipelines.filter(
    (pipeline) => !installedPipelineIds.has(pipeline.id)
  ).length;
  const pipelineNeedsSetup = (pipeline: PipelineConfig) => {
    const latestStoreEntry = preferredStorePipelineMap.get(pipeline.pipelineId);
    const latestVersion = latestStoreEntry?.latestVersion || latestStoreEntry?.version;
    const packageUpdateAvailable =
      latestVersion &&
      pipeline.version &&
      compareVersions(latestVersion, pipeline.version) > 0;
    const codeUpdateAvailable =
      pipeline.download?.status === "downloaded" &&
      pipeline.download.expectedVersion &&
      pipeline.download.version &&
      compareVersions(pipeline.download.expectedVersion, pipeline.download.version) > 0;

    return Boolean(
      !pipeline.enabled ||
        pipeline.readiness?.status !== "ready" ||
        pipeline.download?.status === "missing" ||
        pipeline.download?.job?.state === "error" ||
        pipeline.databaseDownloads?.some(
          (database) =>
            database.status === "missing" || database.job?.state === "error"
        ) ||
        packageUpdateAvailable ||
        codeUpdateAvailable
    );
  };
  const configEntries = selectedPipeline
    ? Object.entries(selectedPipeline.configSchema.properties)
    : [];
  const selectedSchemaKeys = new Set(configEntries.map(([key]) => key));
  const selectedDatabaseDownloads = selectedPipeline?.databaseDownloads || [];
  const storedConfigEntries = selectedPipeline
    ? Object.entries(localConfig).filter(([, value]) => !isUnsetConfigValue(value))
    : [];
  const unsetConfigEntries = configEntries.filter(([key]) =>
    isUnsetConfigValue(localConfig[key])
  );
  const extraStoredConfigEntries = storedConfigEntries.filter(
    ([key]) => !selectedSchemaKeys.has(key)
  );
  const showResolvedSettings =
    selectedPipeline &&
    (selectedDatabaseDownloads.length > 0 ||
      storedConfigEntries.length > 0 ||
      configEntries.length > 0);
  const metadataHints = selectedPipeline
    ? getPipelineMetadataHints(selectedPipeline.pipelineId)
    : [];
  const availableSequencingTechnologies =
    sequencingTechData?.technologies?.map((tech) => ({
      id: tech.id,
      label: tech.manufacturer ? `${tech.name} (${tech.manufacturer})` : tech.name,
    })) || [];
  const changedConfigCount = selectedPipeline
    ? configEntries.reduce((count, [key]) => {
        return isSameConfigValue(localConfig[key], selectedPipeline.config[key])
          ? count
          : count + 1;
      }, 0)
    : 0;
  const hasConfigChanges = changedConfigCount > 0;
  const magSelectedTechnologyCount = Array.isArray(localConfig.allowedSequencingTechnologies)
    ? localConfig.allowedSequencingTechnologies
        .filter((value): value is string => typeof value === "string")
        .map((value) => value.trim())
        .filter(Boolean).length
    : 0;
  const hasMagRunTargetSelectionWarning =
    selectedPipeline?.pipelineId === "mag" &&
    localConfig.runAt === "selected-technologies" &&
    magSelectedTechnologyCount === 0;

  const tabFilteredInstalledPipelines = filteredInstalledPipelines.filter(
    (p) => !p.catalogs || p.catalogs.length === 0 || p.catalogs.includes(activeTab)
  );
  const tabFilteredAvailablePipelines = availablePipelines.filter(
    (p) => !p.catalogs || p.catalogs.length === 0 || p.catalogs.includes(activeTab)
  );
  const tabInstalledCount = tabFilteredInstalledPipelines.length;
  const tabAvailableCount = tabFilteredAvailablePipelines.length;
  const tabNeedsSetupCount = tabFilteredInstalledPipelines.filter(pipelineNeedsSetup).length;
  const visibleInstalledPipelines =
    catalogView === "needs-setup"
      ? tabFilteredInstalledPipelines.filter(pipelineNeedsSetup)
      : catalogView === "installed"
        ? tabFilteredInstalledPipelines
        : [];
  const visibleAvailablePipelines =
    catalogView === "available" ? tabFilteredAvailablePipelines : [];
  const tabVisiblePipelineCount =
    visibleInstalledPipelines.length + visibleAvailablePipelines.length;

  return (
    <Tabs value={activeTab} onValueChange={setActiveTab}>
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="relative flex items-center justify-center h-[52px] px-6 lg:px-8">
          <div className="absolute left-6 lg:left-8 text-xs text-muted-foreground">
            {storeError
              ? "Registry unavailable"
              : `${installedCount} installed • ${storeLoading ? "Checking store..." : `${availablePipelineCount} available`}`}
          </div>
          <TabsList className="h-[52px] bg-transparent rounded-none p-0 gap-1">
            <TabsTrigger
              value="order"
              className="relative h-[52px] border-0 border-b-2 border-b-transparent rounded-none px-4 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-b-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground"
            >
              Per-Sample Pipelines
            </TabsTrigger>
            <TabsTrigger
              value="study"
              className="relative h-[52px] border-0 border-b-2 border-b-transparent rounded-none px-4 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-b-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground"
            >
              Per-Study Pipelines
            </TabsTrigger>
          </TabsList>
          <div className="absolute right-6 lg:right-8">
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
              Refresh
            </Button>
          </div>
        </div>
      </div>
    <PageContainer>
      <div className="space-y-8">
        <div className="mb-4 mt-6">
          <h1 className="text-xl font-semibold">Pipelines</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            Manage the analysis workflows available to orders and studies.
          </p>
        </div>

        <section id="pipelines" className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold">Pipeline Catalog</h2>
              <p className="text-sm text-muted-foreground mt-2">
                Install missing packages, enable workflows, and finish setup checks from one list.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-border bg-white p-1">
                {[
                  { value: "installed", label: "Installed", count: tabInstalledCount },
                  { value: "needs-setup", label: "Needs setup", count: tabNeedsSetupCount },
                  { value: "available", label: "Available", count: tabAvailableCount },
                ].map((item) => (
                  <Button
                    key={item.value}
                    type="button"
                    variant={catalogView === item.value ? "secondary" : "ghost"}
                    size="sm"
                    className="h-8 px-3"
                    onClick={() => setCatalogView(item.value as CatalogView)}
                  >
                    {item.label}
                    <span className="ml-1 text-xs text-muted-foreground">
                      {item.count}
                    </span>
                  </Button>
                ))}
              </div>
              <Label htmlFor="pipeline-category-filter" className="sr-only">
                Filter pipelines by category
              </Label>
              <div className="w-52">
                <Select value={selectedCategory} onValueChange={setSelectedCategory}>
                  <SelectTrigger id="pipeline-category-filter" aria-label="Filter pipelines by category" className="bg-white">
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
              <Button
                variant="outline"
                size="sm"
                className="bg-white"
                onClick={() => setShowPipelineDetails((value) => !value)}
              >
                {showPipelineDetails ? "Hide details" : "Show details"}
              </Button>
            </div>
          </div>

          <Collapsible open={advancedToolsOpen} onOpenChange={setAdvancedToolsOpen}>
            <GlassCard className="p-0">
              <CollapsibleTrigger asChild>
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-muted">
                      <Wrench className="h-4 w-4 text-muted-foreground" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-sm font-medium">Advanced Tools</span>
                      <span className="block text-xs text-muted-foreground">
                        Output access policy and smoke artifact inspection.
                      </span>
                    </span>
                  </span>
                  <ChevronDown
                    className={`h-4 w-4 shrink-0 text-muted-foreground transition-transform ${
                      advancedToolsOpen ? "rotate-180" : ""
                    }`}
                  />
                </button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="grid gap-3 border-t border-border px-4 py-4 md:grid-cols-2">
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">Researcher Assembly Downloads</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Show final assemblies in researcher-facing order pages.
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {savingAssemblyDownloadSetting && (
                          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                        )}
                        <Switch
                          checked={allowUserAssemblyDownload}
                          onCheckedChange={(checked) => {
                            void handleAllowUserAssemblyDownloadChange(checked);
                          }}
                          disabled={savingAssemblyDownloadSetting}
                          aria-label="Toggle researcher assembly downloads"
                        />
                      </div>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">Smoke Artifact Import</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Inspect a test ZIP and infer output globs without changing installed pipelines.
                        </p>
                      </div>
                      <Button
                        variant="outline"
                        size="sm"
                        className="bg-white"
                        onClick={() => {
                          setSmokeArtifactDialogOpen(true);
                          setSmokeArtifactError(null);
                        }}
                      >
                        <FileArchive className="h-4 w-4 mr-2" />
                        Inspect ZIP
                      </Button>
                    </div>
                  </div>
                  <div className="rounded-lg border border-border/70 bg-muted/20 p-3 md:col-span-2">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <p className="text-sm font-medium">Descriptor Linter</p>
                        <p className="text-xs text-muted-foreground mt-1">
                          Developer check for installed package descriptors, output patterns, and parser references.
                        </p>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        {installedPipelines.length > 0 ? (
                          installedPipelines.map((pipeline) => (
                            <Button
                              key={pipeline.pipelineId}
                              variant="outline"
                              size="sm"
                              className="h-8 bg-white"
                              onClick={() => {
                                void handleLintDescriptor(pipeline);
                              }}
                              disabled={
                                descriptorLintLoading &&
                                descriptorLintTarget?.pipelineId === pipeline.pipelineId
                              }
                            >
                              {descriptorLintLoading &&
                              descriptorLintTarget?.pipelineId === pipeline.pipelineId ? (
                                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                              ) : (
                                <FileBarChart className="h-4 w-4 mr-2" />
                              )}
                              {pipeline.name}
                            </Button>
                          ))
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            Install a pipeline before running descriptor lint.
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              </CollapsibleContent>
            </GlassCard>
          </Collapsible>

          {assemblyDownloadSettingError && (
            <div className="bg-destructive/10 border border-destructive/30 rounded-lg p-4 flex items-center gap-3">
              <XCircle className="h-5 w-5 text-destructive" />
              <p className="text-sm text-destructive">{assemblyDownloadSettingError}</p>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto"
                onClick={() => setAssemblyDownloadSettingError(null)}
              >
                Dismiss
              </Button>
            </div>
          )}

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
          ) : storeLoading && tabVisiblePipelineCount === 0 ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : tabVisiblePipelineCount > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {visibleInstalledPipelines.map((pipeline: PipelineConfig) => (
                <GlassCard key={pipeline.pipelineId} className="relative">
                  {(() => {
                    const storeEntry = preferredStorePipelineMap.get(pipeline.pipelineId);
                    const privateStorePipeline = isPrivateStorePipeline(storeEntry);
                    const gitHubStorePipeline = isGitHubStorePipeline(storeEntry);
                    const privateInstallTargetData: PrivateInstallTarget | null = privateStorePipeline
                      && storeEntry
                      ? {
                          pipelineId: pipeline.pipelineId,
                          name: pipeline.name,
                          version: storeEntry?.latestVersion || pipeline.version,
                          source: storeEntry.source,
                          packageUrlDefault: storeEntry.source.packageUrlDefault,
                          keyLabel: storeEntry.source.keyLabel,
                        }
                      : null;
                    const githubInstallTarget: GitHubInstallTarget | null =
                      gitHubStorePipeline && storeEntry
                        ? {
                            pipelineId: pipeline.pipelineId,
                            name: pipeline.name,
                            version: storeEntry.latestVersion || pipeline.version,
                            source: storeEntry.source,
                          }
                        : null;
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
                    const readiness = pipeline.readiness;
                    const nextReadinessItem =
                      readiness?.items.find((item) => item.status === "missing") ||
                      readiness?.items.find((item) => item.status === "warning");
                    const nextReadinessActionLabel = getReadinessActionLabel(
                      nextReadinessItem?.action
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
                                {showPipelineDetails && pipeline.version && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    v{pipeline.version}
                                  </Badge>
                                )}
                                <Badge
                                  variant={pipeline.enabled ? "outline" : "secondary"}
                                  className="text-xs font-normal"
                                >
                                {pipeline.enabled ? "Enabled" : "Disabled"}
                                </Badge>
                                {getReadinessBadge(pipeline)}
                                {showPipelineDetails && storeEntry && (
                                  <Badge variant="outline" className="text-xs font-normal">
                                    {getSourceBadgeLabel(storeEntry.source)}
                                  </Badge>
                                )}
                                {showPipelineDetails && privateStorePipeline && (
                                  <Badge variant="secondary" className="text-xs">
                                    Private license
                                  </Badge>
                                )}
                                {showPipelineDetails && codeStatus === "downloaded" && (
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
                                {showPipelineDetails && codeStatus === "unsupported" && (
                                  <Badge variant="secondary" className="text-xs">
                                    External pipeline
                                  </Badge>
                                )}
                                {showPipelineDetails && databaseDownloads.length > 0 && databaseAvailable.length > 0 && (
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
                                {showPipelineDetails && (
                                  <Badge variant="secondary" className="text-xs capitalize">
                                  {pipeline.category}
                                  </Badge>
                                )}
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
                              {readiness && !showPipelineDetails && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  Setup: {readiness.summary}
                                </p>
                              )}
                              {showPipelineDetails && (
                                <>
                                  <p className="text-xs text-muted-foreground font-mono mt-1">
                                    {pipeline.pipelineId}
                                  </p>
                                  <p className="text-xs text-muted-foreground mt-1">
                                    {latestVersion
                                      ? `Latest version: v${latestVersion}`
                                      : "Latest version: unknown"}
                                  </p>
                                  {privateStorePipeline && (
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Package install requires a private access key.
                                  </p>
                                  )}
                                  {gitHubStorePipeline && storeEntry?.source.repository && (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Managed via GitHub import ({storeEntry.source.repository}, ref: {storeEntry.source.refDefault || DEFAULT_GITHUB_REF}).
                                    </p>
                                  )}
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
                                    const startedAtMs = database.job?.startedAt
                                      ? new Date(database.job.startedAt).getTime()
                                      : null;
                                    const elapsedSec =
                                      startedAtMs && !Number.isNaN(startedAtMs)
                                        ? Math.max(0, (Date.now() - startedAtMs) / 1000)
                                        : null;
                                    const speedBytesPerSec =
                                      typeof databaseBytes === "number" && elapsedSec && elapsedSec > 0
                                        ? databaseBytes / elapsedSec
                                        : null;
                                    const remainingBytes =
                                      typeof databaseBytes === "number" &&
                                      typeof databaseTotal === "number" &&
                                      databaseTotal > databaseBytes
                                        ? databaseTotal - databaseBytes
                                        : null;
                                    const etaSec =
                                      remainingBytes != null && speedBytesPerSec && speedBytesPerSec > 0
                                        ? remainingBytes / speedBytesPerSec
                                        : null;
                                    const databaseProgressKnown = typeof databaseProgress === "number";
                                    const databaseTargetPath =
                                      database.job?.targetPath ||
                                      database.configuredPath ||
                                      database.expectedPath ||
                                      database.path;
                                    const databaseSourceUrl =
                                      database.job?.sourceUrl || database.sourceUrl;
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
                                          <div className="mt-1 space-y-1.5">
                                            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                                              <span>
                                                {database.job?.phase === "verifying"
                                                  ? "Verifying checksum..."
                                                  : database.job?.phase === "installing"
                                                    ? "Installing database..."
                                                    : databaseProgressKnown
                                                      ? `Downloading ${databaseProgress}%`
                                                      : "Downloading..."}
                                                {typeof databaseBytes === "number"
                                                  ? typeof databaseTotal === "number"
                                                    ? ` • ${formatBytes(databaseBytes)} of ${formatBytes(databaseTotal)}`
                                                    : ` • ${formatBytes(databaseBytes)} so far`
                                                  : ""}
                                              </span>
                                              {formatSpeed(speedBytesPerSec) && (
                                                <span className="tabular-nums">
                                                  {formatSpeed(speedBytesPerSec)}
                                                </span>
                                              )}
                                            </div>
                                            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                                              <div
                                                className={`h-full bg-primary transition-all ${databaseProgressKnown ? "" : "animate-pulse"}`}
                                                style={{
                                                  width: databaseProgressKnown
                                                    ? `${Math.min(100, Math.max(0, databaseProgress as number))}%`
                                                    : "100%",
                                                }}
                                              />
                                            </div>
                                            <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                                              {formatDuration(elapsedSec) && (
                                                <span>Elapsed: {formatDuration(elapsedSec)}</span>
                                              )}
                                              {formatDuration(etaSec) && (
                                                <span>ETA: {formatDuration(etaSec)}</span>
                                              )}
                                              {database.job?.limitRate && (
                                                <span>Limit: {database.job.limitRate}/s</span>
                                              )}
                                            </div>
                                            {databaseTargetPath && (
                                              <p className="text-[11px] text-muted-foreground break-all">
                                                Saving to: {databaseTargetPath}
                                              </p>
                                            )}
                                            {databaseSourceUrl && (
                                              <p className="text-[11px] text-muted-foreground break-all">
                                                Source: {databaseSourceUrl}
                                              </p>
                                            )}
                                            <div className="pt-1">
                                              <Button
                                                variant="outline"
                                                size="sm"
                                                className="h-7 text-xs"
                                                onClick={() =>
                                                  handleCancelDatabaseDownload(
                                                    pipeline.pipelineId,
                                                    database.id
                                                  )
                                                }
                                                disabled={
                                                  cancellingDatabase ===
                                                  `${pipeline.pipelineId}:${database.id}`
                                                }
                                              >
                                                {cancellingDatabase ===
                                                `${pipeline.pipelineId}:${database.id}` ? (
                                                  <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                                ) : (
                                                  <XCircle className="h-3 w-3 mr-1" />
                                                )}
                                                Cancel download
                                              </Button>
                                            </div>
                                          </div>
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
                                  {readiness && (
                                    <div className="mt-3 rounded-md border border-border/70 bg-muted/30 p-3">
                                      <div className="flex flex-wrap items-center justify-between gap-2">
                                        <div>
                                          <p className="text-xs font-medium">Setup checklist</p>
                                          <p className="text-xs text-muted-foreground mt-0.5">
                                            {readiness.summary}
                                          </p>
                                        </div>
                                        {nextReadinessItem && nextReadinessActionLabel && (
                                          <Button
                                            variant="outline"
                                            size="sm"
                                            className="h-7 bg-white text-xs"
                                            onClick={() => {
                                              if (nextReadinessItem.action === "download-db") {
                                                const database =
                                                  databaseDownloads.find((entry) => entry.status === "missing") ||
                                                  databaseDownloads[0];
                                                if (database) {
                                                  openDbDownloadDialog(pipeline, database);
                                                }
                                                return;
                                              }
                                              if (nextReadinessItem.action === "sync" && githubInstallTarget) {
                                                openGitHubInstallDialog(githubInstallTarget, "update");
                                                return;
                                              }
                                              if (nextReadinessItem.action === "configure") {
                                                openConfigDialog(pipeline);
                                                return;
                                              }
                                              if (nextReadinessItem.action === "enable") {
                                                void handleTogglePipelineEnabled(pipeline);
                                                return;
                                              }
                                              if (nextReadinessItem.action === "review-outputs") {
                                                void handleLintDescriptor(pipeline);
                                              }
                                            }}
                                            disabled={
                                              downloadingDatabase?.startsWith(`${pipeline.pipelineId}:`) ||
                                              githubSubmitting ||
                                              togglingPipeline === pipeline.pipelineId
                                            }
                                          >
                                            {nextReadinessActionLabel}
                                          </Button>
                                        )}
                                      </div>
                                      <div className="mt-2 grid gap-1.5">
                                        {readiness.items.map((item) => (
                                          <div
                                            key={item.id}
                                            className="flex items-start gap-2 text-xs"
                                          >
                                            <span className="mt-0.5 shrink-0">
                                              {getReadinessStatusIcon(item.status)}
                                            </span>
                                            <span>
                                              <span className="font-medium">{item.label}</span>
                                              {item.detail ? (
                                                <span className="text-muted-foreground"> - {item.detail}</span>
                                              ) : null}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
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
                                </>
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
                              if (databaseRunning) {
                                return (
                                  <Button
                                    key={key}
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                      handleCancelDatabaseDownload(
                                        pipeline.pipelineId,
                                        database.id
                                      )
                                    }
                                    className="h-8"
                                    disabled={cancellingDatabase === key}
                                  >
                                    {cancellingDatabase === key ? (
                                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                    ) : (
                                      <XCircle className="h-4 w-4 mr-1" />
                                    )}
                                    Cancel DB download
                                  </Button>
                                );
                              }
                              return (
                                <Button
                                  key={key}
                                  variant="outline"
                                  size="sm"
                                  onClick={() => openDbDownloadDialog(pipeline, database)}
                                  className="h-8"
                                  disabled={databaseBusy}
                                >
                                  {databaseBusy ? (
                                    <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                  ) : (
                                    <Download className="h-4 w-4 mr-1" />
                                  )}
                                  {databaseBusy ? "Starting..." : databaseActionLabel}
                                </Button>
                              );
                            })}
                            {updateAvailable && !privateStorePipeline && !gitHubStorePipeline && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleUpdatePipeline(pipeline.pipelineId, latestVersion, storeEntry?.source)}
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
                            {privateStorePipeline && privateInstallTargetData && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openPrivateInstallDialog(privateInstallTargetData, "update")}
                                className="h-8"
                                disabled={installingPipeline === pipeline.pipelineId}
                              >
                                {installingPipeline === pipeline.pipelineId && installAction === "update" ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <Download className="h-4 w-4 mr-1" />
                                )}
                                {installingPipeline === pipeline.pipelineId && installAction === "update"
                                  ? "Updating..."
                                  : "Reinstall package"}
                              </Button>
                            )}
                            {gitHubStorePipeline && githubInstallTarget && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => openGitHubInstallDialog(githubInstallTarget, "update")}
                                className="h-8"
                                disabled={githubSubmitting}
                              >
                                {githubSubmitting ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <RefreshCw className="h-4 w-4 mr-1" />
                                )}
                                {githubSubmitting ? "Syncing..." : "Sync from GitHub"}
                              </Button>
                            )}
                            {!pipeline.enabled && (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleTogglePipelineEnabled(pipeline)}
                                className="h-8"
                                disabled={togglingPipeline === pipeline.pipelineId}
                              >
                                {togglingPipeline === pipeline.pipelineId ? (
                                  <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                                ) : (
                                  <CheckCircle2 className="h-4 w-4 mr-1" />
                                )}
                                Enable
                              </Button>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => openDagDialog(pipeline)}
                              className="h-8 bg-white"
                            >
                              <Eye className="h-4 w-4 mr-1" />
                              View
                            </Button>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button
                                  variant="ghost"
                                  size="sm"
                                  className="h-8 px-2"
                                  aria-label={`More actions for ${pipeline.name}`}
                                >
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="w-52">
                                <DropdownMenuLabel>Pipeline actions</DropdownMenuLabel>
                                <DropdownMenuItem onSelect={() => openConfigDialog(pipeline)}>
                                  <Settings2 className="h-4 w-4" />
                                  Configure
                                </DropdownMenuItem>
                                {pipeline.enabled && (
                                  <DropdownMenuItem
                                    variant="destructive"
                                    disabled={togglingPipeline === pipeline.pipelineId}
                                    onSelect={() => handleTogglePipelineEnabled(pipeline)}
                                  >
                                    {togglingPipeline === pipeline.pipelineId ? (
                                      <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                      <XCircle className="h-4 w-4" />
                                    )}
                                    Disable
                                  </DropdownMenuItem>
                                )}
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </>
                    );
                  })()}
                </GlassCard>
              ))}

              {visibleAvailablePipelines.map((pipeline) => (
                <GlassCard key={`${pipeline.id}:${pipeline.source.sourceId}`} className="relative border-dashed bg-muted/20">
                  {(() => {
                    const privateStorePipeline = isPrivateStorePipeline(pipeline);
                    const gitHubStorePipeline = isGitHubStorePipeline(pipeline);
                    const privateTarget: PrivateInstallTarget = {
                      pipelineId: pipeline.id,
                      name: pipeline.name,
                      version: pipeline.latestVersion || pipeline.version,
                      source: pipeline.source,
                      packageUrlDefault: pipeline.source.packageUrlDefault,
                      keyLabel: pipeline.source.keyLabel,
                    };
                    const githubTarget: GitHubInstallTarget = {
                      pipelineId: pipeline.id,
                      name: pipeline.name,
                      version: pipeline.latestVersion || pipeline.version,
                      source: pipeline.source,
                    };
                    return (
                      <>
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-start gap-4">
                      <div className={`p-3 rounded-xl ${getCategoryColor(pipeline.category)}`}>
                        {getPipelineIcon(pipeline.icon || "")}
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2 mb-1">
                          <h3 className="font-semibold truncate">{pipeline.name}</h3>
                          {showPipelineDetails && (
                            <Badge variant="outline" className="text-xs font-normal">
                            v{pipeline.version}
                            </Badge>
                          )}
                          <Badge variant="secondary" className="text-xs">
                            Not installed
                          </Badge>
                          {showPipelineDetails && (
                            <Badge variant="outline" className="text-xs font-normal">
                            {getSourceBadgeLabel(pipeline.source)}
                            </Badge>
                          )}
                          {showPipelineDetails && privateStorePipeline && (
                            <Badge variant="secondary" className="text-xs">
                              Private license
                            </Badge>
                          )}
                          {showPipelineDetails && (
                            <Badge variant="secondary" className="text-xs capitalize">
                            {pipeline.category}
                            </Badge>
                          )}
                        </div>
                        <p className="text-sm text-muted-foreground line-clamp-2">
                          {pipeline.description}
                        </p>
                        {showPipelineDetails && (
                          <>
                            <p className="text-xs text-muted-foreground font-mono mt-1">
                              {pipeline.id}
                            </p>
                            <p className="text-xs text-muted-foreground mt-1">
                              by {pipeline.author || "unknown"} | {(pipeline.downloads || 0).toLocaleString()} installs
                            </p>
                            {privateStorePipeline && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Installation requires package URL and private access key.
                              </p>
                            )}
                            {gitHubStorePipeline && (
                              <p className="text-xs text-muted-foreground mt-1">
                                Add from GitHub by providing repository access details and a token.
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                  <div className="mt-4 flex justify-end">
                    <Button
                      variant="outline"
                      className="bg-white"
                      size="sm"
                      onClick={() =>
                        gitHubStorePipeline
                          ? openGitHubInstallDialog(githubTarget, "install")
                          : privateStorePipeline
                          ? openPrivateInstallDialog(privateTarget, "install")
                          : handleInstallPipeline(
                              pipeline.id,
                              pipeline.latestVersion || pipeline.version,
                              pipeline.source
                            )
                      }
                      disabled={installingPipeline === pipeline.id}
                    >
                      {installingPipeline === pipeline.id && installAction === "install" ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : (
                        <Download className="h-4 w-4 mr-2" />
                      )}
                      {installingPipeline === pipeline.id && installAction === "install"
                        ? "Installing..."
                        : gitHubStorePipeline
                          ? "Add from GitHub"
                          : privateStorePipeline
                          ? "Install (key required)"
                          : "Install"}
                    </Button>
                  </div>
                      </>
                    );
                  })()}
                </GlassCard>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed bg-muted/30 px-6 py-10 text-center">
              <Package className="h-10 w-10 mx-auto mb-3 text-muted-foreground" />
              <h3 className="text-sm font-semibold">
                {catalogView === "needs-setup"
                  ? "No pipelines need setup"
                  : catalogView === "available"
                    ? "No available pipelines"
                    : selectedCategory === "all"
                      ? "No installed pipelines"
                      : "No pipelines in this category"}
              </h3>
              <p className="text-sm text-muted-foreground mt-2">
                {catalogView === "needs-setup"
                  ? "Installed pipelines in this view are ready."
                  : catalogView === "available"
                    ? "All registry pipelines for this tab are already installed."
                    : selectedCategory === "all"
                      ? "Use Available to install a pipeline from the registry."
                      : "Try another category or clear the category filter."}
              </p>
            </div>
          )}
        </section>
      </div>

      <Dialog
        open={dbDownloadDialogOpen}
        onOpenChange={(open) => {
          setDbDownloadDialogOpen(open);
          if (!open) {
            setDbDownloadDialogError(null);
          }
        }}
      >
        <DialogContent className="max-w-lg w-[94vw]">
          <DialogHeader>
            <DialogTitle>
              {dbDownloadTarget?.database.status === "downloaded"
                ? `Re-download ${dbDownloadTarget?.database.label || "database"}`
                : `Download ${dbDownloadTarget?.database.label || "database"}`}
            </DialogTitle>
            <DialogDescription>
              {dbDownloadTarget
                ? `Reference database for ${dbDownloadTarget.pipelineName}.`
                : ""}
            </DialogDescription>
          </DialogHeader>

          {dbDownloadTarget && (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Source URL</Label>
                <p className="break-all rounded-md border border-border/60 bg-muted/40 p-2 font-mono text-xs">
                  {dbDownloadTarget.database.sourceUrl || "Unknown"}
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="db-download-target-path">Target path</Label>
                <Input
                  id="db-download-target-path"
                  value={dbDownloadCustomPath}
                  onChange={(event) => setDbDownloadCustomPath(event.target.value)}
                  placeholder={dbDownloadTarget.database.expectedPath || "/absolute/path/to/database/file"}
                  className="bg-white font-mono text-xs"
                />
                <p className="text-[11px] text-muted-foreground break-all">
                  Default: {dbDownloadTarget.database.expectedPath || "(set pipeline run directory first)"}
                </p>
                {dbDownloadTarget.database.configuredPath &&
                  dbDownloadTarget.database.configuredPath !== dbDownloadTarget.database.expectedPath && (
                    <p className="text-[11px] text-muted-foreground break-all">
                      Currently configured: {dbDownloadTarget.database.configuredPath}
                    </p>
                  )}
              </div>

              <div className="rounded-md border border-border/60 bg-muted/30 p-2 text-xs">
                {dbPreflight?.loading && !dbPreflight.expectedBytes ? (
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" />
                    Checking remote size and free disk space...
                  </div>
                ) : dbPreflight ? (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Expected download</span>
                      <span className="tabular-nums">
                        {typeof dbPreflight.expectedBytes === "number"
                          ? formatBytes(dbPreflight.expectedBytes)
                          : "Unknown (source did not report size)"}
                      </span>
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-muted-foreground">Free at target</span>
                      <span
                        className={`tabular-nums ${
                          dbPreflight.sufficient === false ? "text-destructive font-medium" : ""
                        }`}
                      >
                        {typeof dbPreflight.freeBytes === "number"
                          ? formatBytes(dbPreflight.freeBytes)
                          : "Unknown"}
                      </span>
                    </div>
                    {dbPreflight.partialBytes > 0 && (
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-muted-foreground">Partial file present</span>
                        <span className="tabular-nums">
                          {formatBytes(dbPreflight.partialBytes)}
                          {typeof dbPreflight.expectedBytes === "number"
                            ? ` of ${formatBytes(dbPreflight.expectedBytes)}`
                            : ""}
                        </span>
                      </div>
                    )}
                    {dbPreflight.sufficient === false && (
                      <p className="mt-1 text-destructive">
                        Not enough free disk space at the target path. Free up space or pick a different target.
                      </p>
                    )}
                    {dbPreflight.hasSha256 && (
                      <p className="mt-1 text-muted-foreground">
                        sha256 checksum will be verified after download.
                      </p>
                    )}
                    {dbPreflight.error && (
                      <p className="mt-1 text-muted-foreground">{dbPreflight.error}</p>
                    )}
                  </div>
                ) : (
                  <div className="text-muted-foreground">Preflight info will appear here.</div>
                )}
              </div>

              {dbPreflight && dbPreflight.partialBytes > 0 && (
                <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-xs">
                  <p className="font-medium text-amber-900">Partial download detected</p>
                  <p className="mt-1 text-amber-800">
                    {formatBytes(dbPreflight.partialBytes)}
                    {typeof dbPreflight.expectedBytes === "number"
                      ? ` of ${formatBytes(dbPreflight.expectedBytes)}`
                      : ""}{" "}
                    is already on disk. By default the download will resume from where it left off.
                  </p>
                  <div className="mt-2 flex items-start gap-2">
                    <Checkbox
                      id="db-download-replace"
                      checked={dbDownloadReplace}
                      onCheckedChange={(checked) => setDbDownloadReplace(checked === true)}
                    />
                    <Label htmlFor="db-download-replace" className="text-xs leading-snug text-amber-900">
                      Start over (delete the partial file and re-download from scratch)
                    </Label>
                  </div>
                </div>
              )}

              {dbDownloadTarget.database.status === "downloaded" &&
                (!dbPreflight || dbPreflight.partialBytes === 0) && (
                  <div className="flex items-start gap-2">
                    <Checkbox
                      id="db-download-replace"
                      checked={dbDownloadReplace}
                      onCheckedChange={(checked) => setDbDownloadReplace(checked === true)}
                    />
                    <Label htmlFor="db-download-replace" className="text-xs leading-snug">
                      Replace existing file (deletes the file at the target path before downloading)
                    </Label>
                  </div>
                )}

              <div className="space-y-2">
                <Label htmlFor="db-download-limit-rate">Bandwidth limit (optional)</Label>
                <Input
                  id="db-download-limit-rate"
                  value={dbDownloadLimitRate}
                  onChange={(event) => setDbDownloadLimitRate(event.target.value)}
                  placeholder="e.g. 10M for 10 MB/s, 512K for 512 KB/s"
                  className="bg-white text-xs"
                />
                <p className="text-[11px] text-muted-foreground">
                  Leave empty for full speed. Accepts a number with optional K, M, or G suffix.
                </p>
              </div>

              <div className="grid gap-1 text-xs text-muted-foreground">
                <div>
                  Status:{" "}
                  {dbDownloadTarget.database.status === "downloaded"
                    ? `Downloaded${
                        dbDownloadTarget.database.version
                          ? ` (v${dbDownloadTarget.database.version})`
                          : ""
                      }`
                    : "Not downloaded"}
                </div>
                {typeof dbDownloadTarget.database.sizeBytes === "number" && (
                  <div>Size on disk: {formatBytes(dbDownloadTarget.database.sizeBytes)}</div>
                )}
                {dbDownloadTarget.database.lastUpdated && (
                  <div>Last updated: {formatStoreDate(dbDownloadTarget.database.lastUpdated)}</div>
                )}
              </div>

              {dbDownloadDialogError && (
                <p className="text-sm text-destructive">{dbDownloadDialogError}</p>
              )}
            </div>
          )}

          <DialogFooter className="flex-col gap-2 sm:flex-row sm:justify-end">
            <Button
              variant="outline"
              onClick={() => setDbDownloadDialogOpen(false)}
              disabled={linkingDatabase}
            >
              Cancel
            </Button>
            <Button
              variant="outline"
              onClick={handleLinkExistingDatabase}
              disabled={linkingDatabase || dbDownloadCustomPath.trim().length === 0}
              title="Skip the download and point the pipeline at an existing file on disk"
            >
              {linkingDatabase ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : null}
              Use existing file
            </Button>
            <Button
              onClick={handleConfirmDbDownload}
              disabled={dbPreflight?.sufficient === false || linkingDatabase}
            >
              <Download className="h-4 w-4 mr-2" />
              {dbPreflight && dbPreflight.partialBytes > 0 && !dbDownloadReplace
                ? "Resume download"
                : dbDownloadTarget?.database.status === "downloaded"
                  ? "Re-download"
                  : "Download"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={githubInstallDialogOpen}
        onOpenChange={(open) => {
          setGithubInstallDialogOpen(open);
          if (!open) {
            setGithubToken("");
            setGithubInstallError(null);
            setGithubRef(githubInstallTarget?.source.refDefault || DEFAULT_GITHUB_REF);
            setGithubRepository(githubInstallTarget?.source.repository || "");
          }
        }}
      >
        <DialogContent className="max-w-lg w-[94vw]">
          <DialogHeader>
            <DialogTitle>
              {githubInstallMode === "update"
                ? `Sync ${githubInstallTarget?.name || "Pipeline"} from GitHub`
                : `Add ${githubInstallTarget?.name || "Pipeline"} from GitHub`}
            </DialogTitle>
            <DialogDescription>
              Import pipeline descriptors and optional workflow snapshot from a GitHub repository.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="github-repository">Repository</Label>
              <Input
                id="github-repository"
                value={githubRepository}
                onChange={(event) => setGithubRepository(event.target.value)}
                placeholder="owner/repository"
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="github-ref">Branch or ref</Label>
              <Input
                id="github-ref"
                value={githubRef}
                onChange={(event) => setGithubRef(event.target.value)}
                placeholder={githubInstallTarget?.source.refDefault || DEFAULT_GITHUB_REF}
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="github-token">
                {githubInstallTarget?.source.keyLabel || "GitHub token"}
              </Label>
              <Input
                id="github-token"
                value={githubToken}
                onChange={(event) => setGithubToken(event.target.value)}
                type="password"
                placeholder="Paste token with read access to the repository"
                className="bg-white"
              />
            </div>

            {githubInstallError && (
              <p className="text-sm text-destructive">{githubInstallError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setGithubInstallDialogOpen(false)}
              disabled={githubSubmitting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleGitHubInstall}
              disabled={githubSubmitting}
            >
              {githubSubmitting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {githubSubmitting
                ? githubInstallMode === "update"
                  ? "Syncing..."
                  : "Adding..."
                : githubInstallMode === "update"
                  ? "Sync from GitHub"
                  : "Add from GitHub"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={smokeArtifactDialogOpen}
        onOpenChange={(open) => {
          setSmokeArtifactDialogOpen(open);
          if (!open) {
            setSmokeArtifactFile(null);
            setSmokeArtifactError(null);
            setSmokeArtifactResult(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl w-[94vw]">
          <DialogHeader>
            <DialogTitle>Inspect smoke artifact</DialogTitle>
            <DialogDescription>
              Upload a pipeline smoke-test ZIP to inspect published result paths and draft output globs. This does not install or modify a pipeline.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="smoke-artifact">Smoke artifact ZIP</Label>
              <Input
                id="smoke-artifact"
                type="file"
                accept=".zip,application/zip"
                className="bg-white"
                onChange={(event) => {
                  setSmokeArtifactFile(event.target.files?.[0] || null);
                  setSmokeArtifactResult(null);
                  setSmokeArtifactError(null);
                }}
              />
            </div>

            {smokeArtifactError && (
              <p className="text-sm text-destructive">{smokeArtifactError}</p>
            )}

            {smokeArtifactResult && (
              <div className="space-y-4">
                <div className="grid gap-2 sm:grid-cols-4">
                  <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Files</p>
                    <p className="text-lg font-semibold">{smokeArtifactResult.summary.totalFiles}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Published</p>
                    <p className="text-lg font-semibold">{smokeArtifactResult.summary.publishedFiles}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Ignored work</p>
                    <p className="text-lg font-semibold">{smokeArtifactResult.summary.ignoredWorkFiles}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Suggestions</p>
                    <p className="text-lg font-semibold">{smokeArtifactResult.summary.suggestedOutputs}</p>
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium">Suggested output globs</p>
                  <div className="mt-2 space-y-2">
                    {smokeArtifactResult.suggestions.length > 0 ? (
                      smokeArtifactResult.suggestions.map((suggestion) => (
                        <div
                          key={suggestion.id}
                          className="rounded-md border border-border/70 bg-muted/30 p-3"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <p className="text-sm font-medium">{suggestion.label}</p>
                            <Badge variant="outline" className="text-xs">
                              {suggestion.count} file{suggestion.count === 1 ? "" : "s"}
                            </Badge>
                          </div>
                          <code className="mt-2 block break-all rounded bg-background p-2 text-xs">
                            {suggestion.pattern}
                          </code>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {suggestion.destination} • {suggestion.type}
                          </p>
                        </div>
                      ))
                    ) : (
                      <p className="text-sm text-muted-foreground">
                        No result patterns were inferred. Check that the artifact contains published result files outside work/.
                      </p>
                    )}
                  </div>
                </div>

                <div>
                  <p className="text-sm font-medium">Detected result files</p>
                  <div className="mt-2 max-h-52 overflow-auto rounded-md border border-border/70">
                    {smokeArtifactResult.entries.slice(0, 80).map((entry) => (
                      <div
                        key={entry.path}
                        className="flex items-center justify-between gap-3 border-b border-border/50 px-3 py-2 last:border-0"
                      >
                        <code className="min-w-0 flex-1 truncate text-xs" title={entry.path}>
                          {entry.path}
                        </code>
                        <Badge variant="secondary" className="text-xs">
                          {entry.type}
                        </Badge>
                      </div>
                    ))}
                    {smokeArtifactResult.entries.length > 80 && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        Showing first 80 of {smokeArtifactResult.entries.length} result files.
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setSmokeArtifactDialogOpen(false)}
              disabled={smokeArtifactInspecting}
            >
              Close
            </Button>
            <Button
              onClick={handleInspectSmokeArtifact}
              disabled={smokeArtifactInspecting || !smokeArtifactFile}
            >
              {smokeArtifactInspecting && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              Inspect artifact
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={descriptorLintDialogOpen}
        onOpenChange={(open) => {
          setDescriptorLintDialogOpen(open);
          if (!open) {
            setDescriptorLintTarget(null);
            setDescriptorLintError(null);
            setDescriptorLintResult(null);
          }
        }}
      >
        <DialogContent className="max-w-2xl w-[94vw]">
          <DialogHeader>
            <DialogTitle>
              Descriptor lint{descriptorLintTarget ? `: ${descriptorLintTarget.name}` : ""}
            </DialogTitle>
            <DialogDescription>
              Validate the installed package descriptor, samplesheet, output patterns, parser references, and pipeline-specific contracts.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4">
            {descriptorLintLoading && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Checking descriptor...
              </div>
            )}

            {descriptorLintError && (
              <p className="text-sm text-destructive">{descriptorLintError}</p>
            )}

            {descriptorLintResult && (
              <>
                <div className="grid gap-2 sm:grid-cols-3">
                  <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Status</p>
                    <p className="text-lg font-semibold">
                      {descriptorLintResult.valid ? "Valid" : "Needs fixes"}
                    </p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Errors</p>
                    <p className="text-lg font-semibold">{descriptorLintResult.errors}</p>
                  </div>
                  <div className="rounded-md border border-border/70 bg-muted/30 p-3">
                    <p className="text-xs text-muted-foreground">Warnings</p>
                    <p className="text-lg font-semibold">{descriptorLintResult.warnings}</p>
                  </div>
                </div>

                <div className="max-h-80 overflow-auto rounded-md border border-border/70">
                  {descriptorLintResult.issues.length > 0 ? (
                    descriptorLintResult.issues.map((issue, index) => (
                      <div
                        key={`${issue.code}-${index}`}
                        className="border-b border-border/50 px-3 py-3 last:border-0"
                      >
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge
                            variant={issue.level === "error" ? "destructive" : "secondary"}
                            className="text-xs"
                          >
                            {issue.level}
                          </Badge>
                          <code className="text-xs text-muted-foreground">{issue.code}</code>
                          {issue.file && (
                            <code className="text-xs text-muted-foreground">{issue.file}</code>
                          )}
                        </div>
                        <p className="mt-1 text-sm">{issue.message}</p>
                      </div>
                    ))
                  ) : (
                    <p className="px-3 py-4 text-sm text-muted-foreground">
                      No descriptor issues found.
                    </p>
                  )}
                </div>
              </>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDescriptorLintDialogOpen(false)}
            >
              Close
            </Button>
            {descriptorLintTarget && (
              <Button
                onClick={() => {
                  void handleLintDescriptor(descriptorLintTarget);
                }}
                disabled={descriptorLintLoading}
              >
                {descriptorLintLoading && (
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                )}
                Run again
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog
        open={privateInstallDialogOpen}
        onOpenChange={(open) => {
          setPrivateInstallDialogOpen(open);
          if (!open) {
            setPrivateInstallError(null);
            setPrivateAccessKey("");
            setPrivateSha256("");
          }
        }}
      >
        <DialogContent className="max-w-lg w-[94vw]">
          <DialogHeader>
            <DialogTitle>
              {privateInstallMode === "update" ? "Reinstall private package" : "Install private package"}
            </DialogTitle>
            <DialogDescription>
              {privateInstallTarget
                ? `${privateInstallTarget.name} requires a private package URL and access key.`
                : "Provide private package details."}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="private-package-url">Package URL</Label>
              <Input
                id="private-package-url"
                value={privatePackageUrl}
                onChange={(event) => setPrivatePackageUrl(event.target.value)}
                placeholder="https://host.example.org/private-pipeline.tar.gz"
                className="bg-white"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="private-access-key">
                {privateInstallTarget?.keyLabel || `${privateInstallTarget?.name || "Pipeline"} access key`}
              </Label>
              <Input
                id="private-access-key"
                value={privateAccessKey}
                onChange={(event) => setPrivateAccessKey(event.target.value)}
                placeholder="Enter private access key"
                className="bg-white"
                type="password"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="private-sha256">SHA256 checksum (optional)</Label>
              <Input
                id="private-sha256"
                value={privateSha256}
                onChange={(event) => setPrivateSha256(event.target.value)}
                placeholder="Optional checksum verification"
                className="bg-white"
              />
            </div>

            {privateInstallError && (
              <p className="text-sm text-destructive">{privateInstallError}</p>
            )}
          </div>

          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setPrivateInstallDialogOpen(false)}
              disabled={installingPipeline === privateInstallTarget?.pipelineId}
            >
              Cancel
            </Button>
            <Button
              onClick={handlePrivateInstallPipeline}
              disabled={installingPipeline === privateInstallTarget?.pipelineId}
            >
              {installingPipeline === privateInstallTarget?.pipelineId && (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              )}
              {installingPipeline === privateInstallTarget?.pipelineId
                ? privateInstallMode === "update"
                  ? "Updating..."
                  : "Installing..."
                : privateInstallMode === "update"
                  ? "Update package"
                  : "Install package"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

              {showResolvedSettings && (
                <div className="rounded-lg border border-border bg-background p-3 mb-4">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-sm font-medium">Resolved settings</p>
                      <p className="text-xs text-muted-foreground mt-1">
                        Values currently stored for this pipeline, including install-profile database settings.
                      </p>
                    </div>
                    <Badge variant="outline" className="text-xs font-normal">
                      {storedConfigEntries.length} set / {configEntries.length} editable
                    </Badge>
                  </div>

                  {selectedDatabaseDownloads.length > 0 && (
                    <div className="mt-3 space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Database assets
                      </p>
                      {selectedDatabaseDownloads.map((database) => {
                        const localConfiguredPath =
                          typeof localConfig[database.configKey] === "string"
                            ? String(localConfig[database.configKey]).trim()
                            : "";
                        const configuredPath =
                          localConfiguredPath || database.configuredPath || "";
                        const detectedPath = database.path || "";
                        return (
                          <div
                            key={database.id}
                            className="rounded-md border border-border/70 bg-muted/20 p-3"
                          >
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="min-w-0">
                                <p className="text-sm font-medium">{database.label}</p>
                                <p className="text-xs text-muted-foreground font-mono mt-0.5">
                                  {database.configKey}
                                </p>
                              </div>
                              <Badge
                                variant={
                                  database.status === "downloaded" ? "outline" : "secondary"
                                }
                                className="text-xs"
                              >
                                {database.status === "downloaded" ? "Ready" : "Missing"}
                              </Badge>
                            </div>
                            <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                              <div>
                                <p className="text-muted-foreground">Configured path</p>
                                <p className="font-mono break-all">
                                  {configuredPath || "Not set"}
                                </p>
                              </div>
                              <div>
                                <p className="text-muted-foreground">Detected path</p>
                                <p className="font-mono break-all">
                                  {detectedPath || "Not found"}
                                </p>
                              </div>
                              {database.expectedPath && (
                                <div className="sm:col-span-2">
                                  <p className="text-muted-foreground">Default download path</p>
                                  <p className="font-mono break-all">
                                    {database.expectedPath}
                                  </p>
                                </div>
                              )}
                            </div>
                            {database.detail && (
                              <p className="mt-2 text-xs text-muted-foreground">
                                {database.detail}
                              </p>
                            )}
                            {selectedPipeline.pipelineId === "metaxpath" &&
                              database.configKey === "paramsFile" && (
                                <p className="mt-2 text-xs text-muted-foreground">
                                  This params file is the source for MetaxPath database paths such as metaxDmpDir.
                                </p>
                              )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {extraStoredConfigEntries.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Stored outside editable fields
                      </p>
                      <div className="mt-2 grid gap-2">
                        {extraStoredConfigEntries.map(([key, value]) => (
                          <div
                            key={key}
                            className="rounded-md border border-border/70 bg-muted/20 p-2"
                          >
                            <p className="text-xs font-mono text-muted-foreground">
                              {key}
                            </p>
                            <p className="text-xs font-mono break-all mt-1">
                              {formatConfigValue(value)}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {unsetConfigEntries.length > 0 && (
                    <div className="mt-3">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
                        Unset editable fields
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {unsetConfigEntries.map(([key]) => (
                          <Badge key={key} variant="secondary" className="font-mono text-[11px]">
                            {key}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {metadataHints.length > 0 && (
                <div className="rounded-lg border border-amber-300 bg-amber-50/60 p-3 mb-4">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-amber-700 mt-0.5" />
                    <div className="space-y-2">
                      <p className="text-[11px] font-semibold uppercase tracking-wide text-amber-900">
                        Runtime Metadata Checks
                      </p>
                      {metadataHints.map((hint) => (
                        <div key={hint.id}>
                          <div className="flex items-center gap-2">
                            <p className="text-sm font-medium text-amber-900">{hint.label}</p>
                            {hint.required && (
                              <Badge
                                variant="outline"
                                className="text-[10px] border-amber-500/40 text-amber-800 bg-amber-100"
                              >
                                Required
                              </Badge>
                            )}
                          </div>
                          <p className="text-xs text-amber-800/90">{hint.description}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

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
                    const isSequencingTechSelector =
                      key === "allowedSequencingTechnologies" && schema.type === "array";
                    const selectedTechnologyIds = Array.isArray(localConfig[key])
                      ? localConfig[key]
                          .filter((value): value is string => typeof value === "string")
                          .map((value) => value.trim())
                          .filter(Boolean)
                      : [];
                    const isMagRunAtSelector =
                      selectedPipeline?.pipelineId === "mag" &&
                      Object.prototype.hasOwnProperty.call(localConfig, "runAt");
                    const runAtIsSelectedTechnologies =
                      !isMagRunAtSelector ||
                      localConfig.runAt === "selected-technologies";

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
                        ) : schema.enum && schema.enum.length > 0 ? (
                          <Select
                            value={
                              typeof localConfig[key] === "string"
                                ? localConfig[key]
                                : typeof defaultValue === "string"
                                  ? defaultValue
                                  : ""
                            }
                            onValueChange={(value) =>
                              setLocalConfig((prev) => ({
                                ...prev,
                                [key]: value,
                              }))
                            }
                          >
                            <SelectTrigger className="bg-white">
                              <SelectValue placeholder="Select value" />
                            </SelectTrigger>
                            <SelectContent>
                              {schema.enum.map((option) => (
                                <SelectItem key={option} value={option}>
                                  {getEnumOptionLabel(key, option)}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        ) : isSequencingTechSelector ? (
                          <div className="space-y-3">
                            {availableSequencingTechnologies.length === 0 ? (
                              <p className="text-xs text-muted-foreground">
                                No sequencing technologies available.
                              </p>
                            ) : (
                              <div className="grid gap-2 sm:grid-cols-2">
                                {availableSequencingTechnologies.map((tech) => {
                                  const checked = selectedTechnologyIds.includes(tech.id);
                                  return (
                                    <div key={tech.id} className="flex items-center gap-2 rounded border border-border p-2 bg-white">
                                      <Checkbox
                                        id={`${key}-${tech.id}`}
                                        checked={checked}
                                        disabled={!runAtIsSelectedTechnologies}
                                        onCheckedChange={(state) => {
                                          setLocalConfig((prev) => {
                                            const current = Array.isArray(prev[key])
                                              ? prev[key]
                                                  .filter((value): value is string => typeof value === "string")
                                                  .map((value) => value.trim())
                                                  .filter(Boolean)
                                              : [];
                                            const next = state === true
                                              ? Array.from(new Set([...current, tech.id]))
                                              : current.filter((value) => value !== tech.id);
                                            return {
                                              ...prev,
                                              [key]: next,
                                            };
                                          });
                                        }}
                                      />
                                      <Label htmlFor={`${key}-${tech.id}`} className="text-xs cursor-pointer">
                                        {tech.label}
                                      </Label>
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                            {!runAtIsSelectedTechnologies && (
                              <p className="text-xs text-muted-foreground">
                                Set <span className="font-mono">runAt</span> to{" "}
                                <span className="font-mono">selected-technologies</span> to activate this selector.
                              </p>
                            )}
                            {runAtIsSelectedTechnologies && selectedTechnologyIds.length === 0 && (
                              <p className="text-xs text-muted-foreground">
                                If none are selected, this pipeline remains allowed for all technologies.
                              </p>
                            )}
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
              {hasMagRunTargetSelectionWarning && (
                <p className="text-sm text-amber-700 mt-4">
                  MAG is set to <span className="font-mono">selected-technologies</span> but no sequencing technology is selected.
                </p>
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
            <Button
              onClick={handleSaveConfig}
              disabled={saving || !hasConfigChanges}
            >
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
    </Tabs>
  );
}
