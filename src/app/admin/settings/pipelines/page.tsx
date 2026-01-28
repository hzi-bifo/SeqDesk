"use client";

import { useState, useEffect } from "react";
import useSWR from "swr";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  Loader2, Dna, FlaskConical, Settings2, Server, HardDrive, Save,
  CheckCircle2, Eye, RefreshCw, XCircle, Download, ExternalLink,
  Package, Microscope, FileBarChart, Layers
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

// Available pipelines from store (mock data for now)
const STORE_PIPELINES = [
  {
    id: "rnaseq",
    name: "RNA-seq",
    description: "RNA sequencing analysis with differential expression",
    category: "transcriptomics",
    version: "3.14.0",
    author: "nf-core",
    downloads: 3420,
    icon: "rna",
  },
  {
    id: "ampliseq",
    name: "Ampliseq",
    description: "16S/18S/ITS amplicon sequencing analysis",
    category: "amplicon",
    version: "2.8.0",
    author: "nf-core",
    downloads: 1890,
    icon: "amplicon",
  },
  {
    id: "taxprofiler",
    name: "Taxprofiler",
    description: "Taxonomic classification and profiling",
    category: "metagenomics",
    version: "1.1.0",
    author: "nf-core",
    downloads: 890,
    icon: "taxonomy",
  },
  {
    id: "fetchngs",
    name: "FetchNGS",
    description: "Download data from public databases",
    category: "utilities",
    version: "1.10.0",
    author: "nf-core",
    downloads: 2150,
    icon: "download",
  },
];

const CATEGORIES = [
  { id: "all", name: "All", icon: Layers },
  { id: "metagenomics", name: "Metagenomics", icon: Microscope },
  { id: "transcriptomics", name: "Transcriptomics", icon: Dna },
  { id: "amplicon", name: "Amplicon", icon: FlaskConical },
  { id: "utilities", name: "Utilities", icon: Package },
];

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
    fetcher
  );

  const { data: execData, mutate: mutateExec } = useSWR(
    "/api/admin/settings/pipelines/execution",
    fetcher
  );

  const [activeTab, setActiveTab] = useState("installed");
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

  // Install state
  const [installingPipeline, setInstallingPipeline] = useState<string | null>(null);
  const [installError, setInstallError] = useState<string | null>(null);

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

  // Install a pipeline from the store
  const handleInstallPipeline = async (pipelineId: string) => {
    setInstallingPipeline(pipelineId);
    setInstallError(null);
    try {
      const res = await fetch('/api/admin/settings/pipelines/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pipelineId }),
      });
      const data = await res.json();
      if (!res.ok) {
        setInstallError(data.error || 'Installation failed');
        return;
      }
      // Refresh pipeline list
      mutate();
      // Switch to installed tab
      setActiveTab('installed');
    } catch (err) {
      setInstallError('Installation failed. Check console for details.');
      console.error('Install error:', err);
    } finally {
      setInstallingPipeline(null);
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
  const availablePipelines = STORE_PIPELINES.filter(
    (p) => !installedPipelineIds.has(p.id) && (selectedCategory === "all" || p.category === selectedCategory)
  );

  return (
    <PageContainer maxWidth="wide">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold tracking-tight">Pipeline Store</h1>
        <p className="text-muted-foreground mt-1">
          Browse, install, and configure bioinformatics pipelines
        </p>
      </div>

      {/* Main Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="grid w-full max-w-md grid-cols-3">
          <TabsTrigger value="installed" className="gap-2">
            <Package className="h-4 w-4" />
            Installed
            {data?.pipelines?.length > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5">
                {data.pipelines.length}
              </Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="store" className="gap-2">
            <Download className="h-4 w-4" />
            Available
          </TabsTrigger>
          <TabsTrigger value="settings" className="gap-2">
            <Settings2 className="h-4 w-4" />
            Settings
          </TabsTrigger>
        </TabsList>

        {/* Installed Pipelines Tab */}
        <TabsContent value="installed" className="space-y-4">
          {isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : error ? (
            <div className="text-center py-12 text-destructive">
              Failed to load pipeline configurations
            </div>
          ) : data?.pipelines?.length > 0 ? (
            <div className="grid gap-4 md:grid-cols-2">
              {data.pipelines.map((pipeline: PipelineConfig) => (
                <GlassCard key={pipeline.pipelineId} className="relative overflow-hidden">
                  {/* Status indicator */}
                  <div className={`absolute top-0 right-0 w-2 h-full ${pipeline.enabled ? "bg-green-500" : "bg-gray-300"}`} />

                  <div className="flex items-start gap-4 pr-4">
                    <div className={`p-3 rounded-xl ${getCategoryColor(pipeline.category)}`}>
                      {getPipelineIcon(pipeline.icon)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <h3 className="font-semibold truncate">{pipeline.name}</h3>
                        {pipeline.version && (
                          <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                            v{pipeline.version}
                          </span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                        {pipeline.description}
                      </p>

                      <div className="flex items-center gap-3 flex-wrap">
                        <div className="flex items-center gap-2">
                          <Switch
                            id={`enable-${pipeline.pipelineId}`}
                            checked={pipeline.enabled}
                            onCheckedChange={() => handleToggleEnabled(pipeline)}
                            disabled={saving}
                          />
                          <Label htmlFor={`enable-${pipeline.pipelineId}`} className="text-sm">
                            {pipeline.enabled ? "Enabled" : "Disabled"}
                          </Label>
                        </div>
                        <div className="flex gap-2">
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
                    </div>
                  </div>
                </GlassCard>
              ))}
            </div>
          ) : (
            <div className="text-center py-16 bg-muted/30 rounded-xl border border-dashed">
              <Package className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <h3 className="font-semibold mb-2">No Pipelines Installed</h3>
              <p className="text-muted-foreground mb-4">
                Browse the store to install your first pipeline
              </p>
              <Button onClick={() => setActiveTab("store")}>
                <Download className="h-4 w-4 mr-2" />
                Browse Store
              </Button>
            </div>
          )}
        </TabsContent>

        {/* Available Pipelines (Store) Tab */}
        <TabsContent value="store" className="space-y-6">
          {/* Category Filter */}
          <div className="flex gap-2 flex-wrap">
            {CATEGORIES.map((cat) => (
              <Button
                key={cat.id}
                variant={selectedCategory === cat.id ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedCategory(cat.id)}
                className="gap-2"
              >
                <cat.icon className="h-4 w-4" />
                {cat.name}
              </Button>
            ))}
          </div>

          {/* Install error banner */}
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

          {/* Pipeline Grid */}
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
            {availablePipelines.map((pipeline) => (
              <div
                key={pipeline.id}
                className="relative bg-card border rounded-xl p-5 hover:shadow-lg transition-all duration-200 hover:border-primary/50"
              >
                <div className="flex items-start gap-4">
                  <div className={`p-3 rounded-xl ${getCategoryColor(pipeline.category)}`}>
                    {getPipelineIcon(pipeline.icon)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <h3 className="font-semibold">{pipeline.name}</h3>
                      <span className="text-xs text-muted-foreground bg-muted px-2 py-0.5 rounded-full">
                        v{pipeline.version}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground line-clamp-2 mb-3">
                      {pipeline.description}
                    </p>
                    <div className="flex items-center gap-4 text-xs text-muted-foreground">
                      <span>by {pipeline.author}</span>
                      <span>{pipeline.downloads.toLocaleString()} installs</span>
                    </div>
                  </div>
                </div>

                <div className="mt-4 flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => handleInstallPipeline(pipeline.id)}
                    disabled={installingPipeline === pipeline.id}
                  >
                    {installingPipeline === pipeline.id ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {installingPipeline === pipeline.id ? 'Installing...' : 'Install'}
                  </Button>
                  <Button size="sm" variant="outline" asChild>
                    <a href={`https://nf-co.re/${pipeline.id}`} target="_blank" rel="noopener noreferrer">
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  </Button>
                </div>
              </div>
            ))}
          </div>

          {availablePipelines.length === 0 && (
            <div className="text-center py-12 text-muted-foreground">
              No additional pipelines available in this category
            </div>
          )}

          {/* Store info */}
          <div className="bg-muted/30 rounded-xl p-6 border border-dashed">
            <div className="flex items-start gap-4">
              <div className="p-3 bg-primary/10 rounded-xl">
                <FileBarChart className="h-6 w-6 text-primary" />
              </div>
              <div>
                <h3 className="font-semibold mb-1">Pipeline Store</h3>
                <p className="text-sm text-muted-foreground mb-3">
                  Install nf-core pipelines with one click. Each pipeline creates a SeqDesk integration
                  package with samplesheet generation and output parsing configured.
                </p>
                <a
                  href="https://nf-co.re/pipelines"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                >
                  Browse all nf-core pipelines
                  <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            </div>
          </div>
        </TabsContent>

        {/* Settings Tab */}
        <TabsContent value="settings" className="space-y-6">
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
                  <Label htmlFor="run-dir">Pipeline Run Directory</Label>
                  <div className="flex gap-2">
                    <Input
                      id="run-dir"
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
                  <Label htmlFor="conda-path">Conda Installation Path</Label>
                  <div className="flex gap-2">
                    <Input
                      id="conda-path"
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
                  <Label htmlFor="conda-env">Conda Environment Name</Label>
                  <Input
                    id="conda-env"
                    value={execSettings.condaEnv}
                    onChange={(e) =>
                      setExecSettings((prev) => ({ ...prev, condaEnv: e.target.value }))
                    }
                    placeholder="seqdesk-pipelines"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="nextflow-profile">Nextflow Profile Override</Label>
                  <Input
                    id="nextflow-profile"
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
                  <Label htmlFor="weblog-url">Nextflow Weblog URL</Label>
                  <div className="flex gap-2">
                    <Input
                      id="weblog-url"
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
                  <Label htmlFor="weblog-secret">Weblog Secret</Label>
                  <Input
                    id="weblog-secret"
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
                  {savingExec ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Save className="h-4 w-4 mr-2" />}
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
        </TabsContent>
      </Tabs>

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
