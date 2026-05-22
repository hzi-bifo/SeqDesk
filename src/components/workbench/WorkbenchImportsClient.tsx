"use client";

import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Database,
  Download,
  Loader2,
  PackageCheck,
  PackagePlus,
  Search,
  Store,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkbenchStatusBadge } from "@/components/workbench/WorkbenchPageShell";
import { cn } from "@/lib/utils";

interface ImporterSummary {
  id: string;
  label: string;
  description: string;
  category: string;
  preflight: {
    ok: boolean;
    message?: string;
    details?: string;
  } | null;
}

interface PreviewGenome {
  accession: string;
  organismName?: string;
  assemblyName?: string;
  assemblyLevel?: string;
  sourceDatabase?: string;
  representativeCategory?: string;
}

interface ImportPreview {
  summary: {
    label: string;
    requestedTaxon?: string;
    totalFound: number;
    selectedCount: number;
    capped: boolean;
    cap: number;
    hardMax: number;
  };
  genomes: PreviewGenome[];
  warnings?: string[];
}

interface ImportJob {
  id: string;
  providerId: string;
  status: string;
  phase: string | null;
  progress: number | null;
  error: string | null;
  targetPath: string | null;
  resultDatasetId: string | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreInstallJob {
  itemId: string;
  state: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  error?: string;
  logPath: string;
  managedPath: string;
}

interface StoreItem {
  id: string;
  label: string;
  description: string;
  category: string;
  kind: string;
  usedBy: string[];
  commands: string[];
  status: {
    state: "installed" | "missing" | "setup-needed";
    source?: "managed" | "system";
    version?: string;
    message: string;
    details?: string;
    managedPath?: string;
  };
  installJob: StoreInstallJob | null;
}

const providerId = "ncbi-genomes-taxon";
const storeItemId = "ncbi-datasets-cli";
const assemblyLevels = ["complete", "chromosome", "scaffold", "contig"] as const;

function formatDate(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusTone(status: string): "neutral" | "accent" | "warning" {
  if (status === "success") return "accent";
  if (status === "error" || status === "cancelled") return "warning";
  return "neutral";
}

function storeStatusTone(item: StoreItem | undefined): "neutral" | "accent" | "warning" {
  if (!item) return "neutral";
  if (item.installJob?.state === "running" || item.status.state === "installed") return "accent";
  if (item.status.state === "setup-needed" || item.installJob?.state === "error") return "warning";
  return "neutral";
}

function storeStatusLabel(item: StoreItem | undefined): string {
  if (!item) return "Checking";
  if (item.installJob?.state === "running") return "Installing";
  if (item.status.state === "installed") return "Installed";
  if (item.status.state === "setup-needed") return "Setup needed";
  if (item.installJob?.state === "error") return "Install failed";
  return "Not installed";
}

export function WorkbenchImportsClient() {
  const [importers, setImporters] = useState<ImporterSummary[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [storeItems, setStoreItems] = useState<StoreItem[]>([]);
  const [storeOpen, setStoreOpen] = useState(false);
  const [selectedImporterId, setSelectedImporterId] = useState<string | null>(null);
  const [taxon, setTaxon] = useState("Escherichia coli");
  const [cap, setCap] = useState(25);
  const [assemblySource, setAssemblySource] = useState("refseq");
  const [mag, setMag] = useState("exclude");
  const [excludeAtypical, setExcludeAtypical] = useState(true);
  const [referenceOnly, setReferenceOnly] = useState(false);
  const [selectedLevels, setSelectedLevels] = useState<string[]>(["complete", "chromosome"]);
  const [preview, setPreview] = useState<ImportPreview | null>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [installingItemId, setInstallingItemId] = useState<string | null>(null);

  const ncbiImporter = importers.find((importer) => importer.id === providerId);
  const referenceStoreItem = storeItems.find((item) => item.id === storeItemId);
  const referenceInstallRunning =
    installingItemId === storeItemId || referenceStoreItem?.installJob?.state === "running";
  const referenceInstalled = referenceStoreItem?.status.state === "installed";
  const input = useMemo(
    () => ({
      taxon,
      cap,
      assemblySource,
      mag,
      excludeAtypical,
      referenceOnly,
      assemblyLevels: selectedLevels,
    }),
    [assemblySource, cap, excludeAtypical, mag, referenceOnly, selectedLevels, taxon]
  );

  const refreshJobs = async () => {
    const response = await fetch("/api/workbench/imports", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { jobs?: ImportJob[] };
    setJobs(Array.isArray(payload.jobs) ? payload.jobs : []);
  };

  const refreshImporters = async () => {
    const response = await fetch("/api/workbench/importers", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { importers?: ImporterSummary[] };
    setImporters(Array.isArray(payload.importers) ? payload.importers : []);
  };

  const refreshStore = async () => {
    const response = await fetch("/api/workbench/store", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { items?: StoreItem[] };
    setStoreItems(Array.isArray(payload.items) ? payload.items : []);
  };

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      await Promise.all([refreshImporters(), refreshStore(), refreshJobs()]);
      if (cancelled) return;
    })();
    const interval = setInterval(
      () => void Promise.all([refreshImporters(), refreshStore(), refreshJobs()]),
      5000
    );
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

  const startStoreInstall = async (itemId: string) => {
    setStoreOpen(true);
    setStoreError(null);
    setInstallingItemId(itemId);
    try {
      const response = await fetch(`/api/workbench/store/${itemId}/install`, {
        method: "POST",
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.error || "Failed to start Workbench Store install");
      }
      await Promise.all([refreshStore(), refreshImporters()]);
    } catch (err) {
      setStoreError(err instanceof Error ? err.message : "Failed to start Workbench Store install");
    } finally {
      setInstallingItemId(null);
    }
  };

  const openReferenceImporter = () => {
    setSelectedImporterId(providerId);
    setStoreOpen(false);
    setStoreError(null);
  };

  const handleReferenceStoreAction = () => {
    if (referenceInstallRunning) return;
    if (referenceInstalled && ncbiImporter?.preflight?.ok !== false) {
      openReferenceImporter();
      return;
    }
    if (referenceInstalled && ncbiImporter?.preflight?.ok === false) {
      void Promise.all([refreshStore(), refreshImporters()]);
      return;
    }
    if (referenceStoreItem?.status.state === "missing" || referenceStoreItem?.installJob?.state === "error") {
      void startStoreInstall(storeItemId);
    }
  };

  const runPreview = async () => {
    setLoadingPreview(true);
    setError(null);
    setPreview(null);
    try {
      const response = await fetch(`/api/workbench/importers/${providerId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(input),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Preview failed");
      }
      setPreview(payload.preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      setLoadingPreview(false);
    }
  };

  const startImport = async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/workbench/imports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId, input }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.details || payload.error || "Failed to start import");
      }
      setPreview(null);
      await refreshJobs();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start import");
    } finally {
      setStarting(false);
    }
  };

  const toggleLevel = (level: string) => {
    setSelectedLevels((current) =>
      current.includes(level)
        ? current.filter((entry) => entry !== level)
        : [...current, level]
    );
  };

  const referenceActionLabel = referenceInstallRunning
    ? "Installing"
    : referenceInstalled && ncbiImporter?.preflight?.ok === false
      ? "Check setup"
      : referenceInstalled
        ? "Open importer"
        : referenceStoreItem?.status.state === "setup-needed"
          ? "Setup needed"
          : referenceStoreItem?.installJob?.state === "error"
            ? "Retry install"
            : "Install";
  const referenceActionDisabled =
    referenceInstallRunning ||
    !referenceStoreItem ||
    referenceStoreItem.status.state === "setup-needed";

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-border bg-card">
        <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-foreground">Workbench imports</h2>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">
              Add import capabilities from the Workbench Store before starting data pulls.
            </p>
          </div>
          <Button
            type="button"
            variant={storeOpen ? "secondary" : "outline"}
            onClick={() => setStoreOpen((current) => !current)}
          >
            <Store className="h-4 w-4" />
            Store
          </Button>
        </div>

        {storeOpen && (
          <div className="border-b border-border p-4">
            <div className="mb-3 flex items-center gap-2">
              <h3 className="text-sm font-semibold text-foreground">Reference genomes</h3>
              <WorkbenchStatusBadge tone={storeStatusTone(referenceStoreItem)}>
                {storeStatusLabel(referenceStoreItem)}
              </WorkbenchStatusBadge>
            </div>
            {storeError && (
              <div className="mb-3 flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{storeError}</span>
              </div>
            )}
            <div className="rounded-lg border border-border bg-background p-4">
              <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
                <div className="flex min-w-0 gap-3">
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-teal-50 text-teal-700 ring-1 ring-teal-200">
                    {referenceInstalled ? (
                      <PackageCheck className="h-5 w-5" />
                    ) : (
                      <PackagePlus className="h-5 w-5" />
                    )}
                  </span>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h4 className="text-base font-semibold text-foreground">Reference genomes</h4>
                      {referenceStoreItem?.status.source && (
                        <WorkbenchStatusBadge>{referenceStoreItem.status.source}</WorkbenchStatusBadge>
                      )}
                    </div>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Install NCBI Datasets support, then use NCBI Genomes by Taxon to preview and
                      import capped genome FASTA packages.
                    </p>
                    <div className="mt-3 flex flex-wrap gap-1.5">
                      <WorkbenchStatusBadge>NCBI Datasets</WorkbenchStatusBadge>
                      <WorkbenchStatusBadge>FASTA</WorkbenchStatusBadge>
                      <WorkbenchStatusBadge>Shared cache</WorkbenchStatusBadge>
                    </div>
                    {referenceStoreItem && (
                      <div className="mt-3 text-xs text-muted-foreground">
                        <p>{referenceStoreItem.status.message}</p>
                        {referenceStoreItem.status.details && (
                          <p className="mt-1">{referenceStoreItem.status.details}</p>
                        )}
                        {referenceStoreItem.installJob?.error && (
                          <p className="mt-1 text-destructive">{referenceStoreItem.installJob.error}</p>
                        )}
                      </div>
                    )}
                    {referenceInstalled && ncbiImporter?.preflight?.ok === false && (
                      <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                        <p className="font-medium">{ncbiImporter.preflight.message}</p>
                        {ncbiImporter.preflight.details && (
                          <p className="mt-1 text-xs">{ncbiImporter.preflight.details}</p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
                <Button
                  type="button"
                  onClick={handleReferenceStoreAction}
                  disabled={referenceActionDisabled}
                  className="shrink-0"
                >
                  {referenceInstallRunning ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : referenceInstalled ? (
                    <Database className="h-4 w-4" />
                  ) : (
                    <Wrench className="h-4 w-4" />
                  )}
                  {referenceActionLabel}
                </Button>
              </div>
            </div>
          </div>
        )}

        {!storeOpen && selectedImporterId !== providerId && (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <Store className="h-5 w-5" />
            </span>
            <h3 className="text-base font-semibold text-foreground">No import capability selected</h3>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Open the Store to install or enable Workbench import capabilities for this server.
            </p>
          </div>
        )}

        {selectedImporterId === providerId && (
          <div className="grid gap-5 border-t border-border p-4 lg:grid-cols-[minmax(0,1.1fr)_minmax(360px,0.9fr)]">
            <div className="space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-foreground">
                    {ncbiImporter?.label || "NCBI Genomes by Taxon"}
                  </h3>
                  {ncbiImporter?.preflight ? (
                    <WorkbenchStatusBadge tone={ncbiImporter.preflight.ok ? "accent" : "warning"}>
                      {ncbiImporter.preflight.ok ? "Ready" : "Setup needed"}
                    </WorkbenchStatusBadge>
                  ) : null}
                </div>
                <p className="mt-1 text-sm text-muted-foreground">
                  {ncbiImporter?.description ||
                    "Preview and import capped NCBI genome FASTA packages for a taxon."}
                </p>
                {ncbiImporter?.preflight && !ncbiImporter.preflight.ok && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
                    <p className="font-medium">{ncbiImporter.preflight.message}</p>
                    {ncbiImporter.preflight.details && (
                      <p className="mt-1 text-xs">{ncbiImporter.preflight.details}</p>
                    )}
                  </div>
                )}
              </div>

              <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_120px]">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Taxon</span>
                  <Input
                    value={taxon}
                    onChange={(event) => setTaxon(event.target.value)}
                    placeholder="Taxon name or NCBI Taxonomy ID"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Cap</span>
                  <Input
                    type="number"
                    min={1}
                    max={500}
                    value={cap}
                    onChange={(event) => setCap(Number(event.target.value))}
                  />
                </label>
              </div>

              <div className="grid gap-3 md:grid-cols-2">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Assembly source</span>
                  <Select value={assemblySource} onValueChange={setAssemblySource}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="refseq">RefSeq</SelectItem>
                      <SelectItem value="genbank">GenBank</SelectItem>
                      <SelectItem value="all">All</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">MAGs</span>
                  <Select value={mag} onValueChange={setMag}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="exclude">Exclude</SelectItem>
                      <SelectItem value="all">Include all</SelectItem>
                      <SelectItem value="only">Only MAGs</SelectItem>
                    </SelectContent>
                  </Select>
                </label>
              </div>

              <div className="space-y-2">
                <span className="text-xs font-medium text-muted-foreground">Assembly levels</span>
                <div className="flex flex-wrap gap-2">
                  {assemblyLevels.map((level) => (
                    <label
                      key={level}
                      className="inline-flex items-center gap-2 rounded-lg border border-border px-3 py-1.5 text-sm"
                    >
                      <input
                        type="checkbox"
                        checked={selectedLevels.includes(level)}
                        onChange={() => toggleLevel(level)}
                      />
                      {level}
                    </label>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={excludeAtypical}
                    onChange={(event) => setExcludeAtypical(event.target.checked)}
                  />
                  Exclude atypical assemblies
                </label>
                <label className="inline-flex items-center gap-2 text-sm text-foreground">
                  <input
                    type="checkbox"
                    checked={referenceOnly}
                    onChange={(event) => setReferenceOnly(event.target.checked)}
                  />
                  Reference genomes only
                </label>
              </div>

              {error && (
                <div className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                  <span>{error}</span>
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void runPreview()}
                  disabled={loadingPreview || !taxon.trim() || ncbiImporter?.preflight?.ok === false}
                >
                  {loadingPreview ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Search className="h-4 w-4" />
                  )}
                  Preview
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void startImport()}
                  disabled={!preview || starting}
                >
                  {starting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Download className="h-4 w-4" />
                  )}
                  Start import
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border bg-background">
              <div className="border-b border-border px-4 py-3">
                <h3 className="text-sm font-semibold text-foreground">Preview</h3>
              </div>
              {preview ? (
                <div className="space-y-3 p-4">
                  <div className="flex items-center gap-2 text-sm">
                    <CheckCircle2 className="h-4 w-4 text-teal-700" />
                    <span className="font-medium text-foreground">
                      {preview.summary.selectedCount} genome(s) selected
                    </span>
                    {preview.summary.capped && (
                      <WorkbenchStatusBadge tone="warning">Capped</WorkbenchStatusBadge>
                    )}
                  </div>
                  {preview.warnings?.map((warning) => (
                    <p key={warning} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
                      {warning}
                    </p>
                  ))}
                  <div className="max-h-80 space-y-2 overflow-auto">
                    {preview.genomes.slice(0, 12).map((genome) => (
                      <div key={genome.accession} className="rounded-lg border border-border px-3 py-2">
                        <p className="text-sm font-medium text-foreground">{genome.accession}</p>
                        <p className="truncate text-xs text-muted-foreground">
                          {genome.organismName || "Unknown organism"}
                          {genome.assemblyName ? ` · ${genome.assemblyName}` : ""}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5">
                          {genome.sourceDatabase && (
                            <WorkbenchStatusBadge>{genome.sourceDatabase}</WorkbenchStatusBadge>
                          )}
                          {genome.assemblyLevel && (
                            <WorkbenchStatusBadge>{genome.assemblyLevel}</WorkbenchStatusBadge>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-72 items-center justify-center px-6 text-center text-sm text-muted-foreground">
                  Enter a taxon and preview matching NCBI genomes before starting a download.
                </div>
              )}
            </div>
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="border-b border-border px-4 py-3">
          <h2 className="text-sm font-semibold text-foreground">Import jobs</h2>
        </div>
        {jobs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No Workbench import jobs yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {jobs.map((job) => (
              <div key={job.id} className="grid gap-3 px-4 py-4 md:grid-cols-[1.2fr_0.8fr_1fr_1.2fr] md:items-center">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{job.providerId}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</p>
                </div>
                <div>
                  <WorkbenchStatusBadge tone={statusTone(job.status)}>{job.status}</WorkbenchStatusBadge>
                </div>
                <div className="text-sm text-muted-foreground">
                  {job.phase || "queued"}
                  {typeof job.progress === "number" ? ` · ${job.progress}%` : ""}
                </div>
                <div className={cn("truncate text-sm", job.error ? "text-destructive" : "text-muted-foreground")}>
                  {job.error || job.targetPath || "Waiting"}
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
