"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  Bell,
  CheckCircle2,
  Database,
  Download,
  FileSearch,
  FolderOpen,
  Loader2,
  PackageCheck,
  PackagePlus,
  Search,
  Store,
  Wrench,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { WorkbenchStatusBadge } from "@/components/workbench/WorkbenchPageShell";
import { cn } from "@/lib/utils";
import { CamiImportCard } from "./CamiImportCard";
import type { ImportCollection } from "@/lib/workbench/import-collection";
import { ImportFileDetails } from "./ImportFileDetails";
import { ImportProgress } from "./ImportProgress";
import { CancelImportButton } from "./CancelImportButton";
import { ImportModuleHeader, ImportStepHeading, importModuleTheme } from "./ImportModuleUI";

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
  fingerprint?: string;
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

interface EnaImportPreview {
  fingerprint?: string;
  summary: ImportPreview["summary"];
  files: Array<{
    runAccession: string;
    sampleAccession?: string;
    scientificName?: string;
    libraryLayout?: string;
    filename: string;
    url?: string;
    md5?: string;
    bytes?: number;
  }>;
  warnings?: string[];
}

interface ImportJob {
  collectionOrderId?: string;
  id: string;
  providerId: string;
  status: string;
  phase: string | null;
  progress: number | null;
  error: string | null;
  resultDatasetId: string | null;
  request?: { collection?: { key?: string } } | null;
  scientificRecords?: { orderId?: string; orderTitle?: string; studyId: string | null; sampleId: string; studyTitle: string | null; sampleTitle: string } | null;
  createdAt: string;
  updatedAt: string;
}

interface StoreInstallJob {
  itemId: string;
  state: "running" | "success" | "error";
  startedAt: string;
  finishedAt?: string;
  error?: string;
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
  };
  installJob: StoreInstallJob | null;
}

const providerId = "ncbi-genomes-taxon";
const enaProviderId = "ena-fastq-accession";
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

export function WorkbenchImportsClient({
  onCollectionReady,
  enablePolling = true,
  source,
  collection,
}: {
  onCollectionReady?: (orderId: string) => void;
  enablePolling?: boolean;
  source?: "cami" | "sra" | "jobs";
  collection?: ImportCollection;
} = {}) {
  const [importers, setImporters] = useState<ImporterSummary[]>([]);
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  const [trackedJobs, setTrackedJobs] = useState<Record<string, string>>({});
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
  const [enaAccession, setEnaAccession] = useState("");
  const [enaMaxFiles, setEnaMaxFiles] = useState(20);
  const [enaPreview, setEnaPreview] = useState<EnaImportPreview | null>(null);
  const [enaError, setEnaError] = useState<string | null>(null);
  const [enaLoadingPreview, setEnaLoadingPreview] = useState(false);
  const [enaStarting, setEnaStarting] = useState(false);
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [storeError, setStoreError] = useState<string | null>(null);
  const [installingItemId, setInstallingItemId] = useState<string | null>(null);
  const previewGeneration = useRef(0);
  const enaPreviewGeneration = useRef(0);
  const importRequestKey = useRef("");
  const enaImportRequestKey = useRef("");
  const moduleProviderId = source === "cami" ? "cami-benchmark" : source === "sra" ? enaProviderId : null;
  const sourceTheme = source === "sra" ? importModuleTheme.sra : importModuleTheme.cami;
  const collectionOrderId = collection ? jobs.find(job => job.collectionOrderId && job.request?.collection?.key === collection.key)?.collectionOrderId : undefined;
  // Module selection is not a job-history page. Recover only active transfers
  // for this module/collection, and retain results started here for their links.
  const visibleJobs = moduleProviderId ? jobs.filter(job => Boolean(collection) && job.providerId === moduleProviderId && (
    trackedJobs[job.id] === collection?.key ||
    (job.request?.collection?.key === collection?.key && (job.status === "queued" || job.status === "running"))
  )) : jobs;

  const ncbiImporter = importers.find((importer) => importer.id === providerId);
  const enaImporter = importers.find((importer) => importer.id === enaProviderId);
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

  useEffect(() => {
    previewGeneration.current += 1;
    setPreview(null);
    setLoadingPreview(false);
  }, [input]);
  useEffect(() => {
    enaPreviewGeneration.current += 1;
    setEnaPreview(null);
    setEnaLoadingPreview(false);
  }, [enaAccession, enaMaxFiles, collection?.key, collection?.name]);

  const refreshJobs = async () => {
    const response = await fetch(collection ? `/api/workbench/imports?collection=${encodeURIComponent(collection.key)}` : "/api/workbench/imports", { cache: "no-store" });
    if (!response.ok) return;
    const payload = (await response.json()) as { jobs?: ImportJob[] };
    const incoming = Array.isArray(payload.jobs) ? payload.jobs : [];
    setJobs(incoming);
    if (collection && moduleProviderId) {
      const active = incoming.filter(job => job.providerId === moduleProviderId && job.request?.collection?.key === collection.key && (job.status === "queued" || job.status === "running"));
      // Keep completion/errors visible if this screen recovered an active job.
      if (active.length) setTrackedJobs(current => ({ ...current, ...Object.fromEntries(active.map(job => [job.id, collection.key])) }));
    }
  };

  const trackStartedImport = async (jobId: string) => {
    if (collection) setTrackedJobs(current => ({ ...current, [jobId]: collection.key }));
    await refreshJobs();
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
      await Promise.all([refreshImporters(), ...(!source ? [refreshStore()] : []), refreshJobs()]);
      if (cancelled) return;
    })();
    if (!enablePolling) {
      return () => {
        cancelled = true;
      };
    }
    const interval = setInterval(
      () => void Promise.all([refreshImporters(), ...(!source ? [refreshStore()] : []), refreshJobs()]),
      5000
    );
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [enablePolling, source, collection?.key]);

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
    importRequestKey.current = crypto.randomUUID();
    const generation = ++previewGeneration.current;
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
      if (generation === previewGeneration.current) setPreview(payload.preview);
    } catch (err) {
      if (generation === previewGeneration.current) setError(err instanceof Error ? err.message : "Preview failed");
    } finally {
      if (generation === previewGeneration.current) setLoadingPreview(false);
    }
  };

  const startImport = async () => {
    setStarting(true);
    setError(null);
    try {
      const response = await fetch("/api/workbench/imports", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": importRequestKey.current },
        body: JSON.stringify({ providerId, input, previewFingerprint: preview?.fingerprint }),
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

  const runEnaPreview = async () => {
    enaImportRequestKey.current = crypto.randomUUID();
    const generation = ++enaPreviewGeneration.current;
    setEnaLoadingPreview(true);
    setEnaError(null);
    setEnaPreview(null);
    try {
      const response = await fetch(`/api/workbench/importers/${enaProviderId}/preview`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ accession: enaAccession, maxFiles: enaMaxFiles, ...(collection ? { collection } : {}) }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "ENA preview failed");
      if (generation === enaPreviewGeneration.current) setEnaPreview(payload.preview);
    } catch (err) {
      if (generation === enaPreviewGeneration.current) setEnaError(err instanceof Error ? err.message : "ENA preview failed");
    } finally {
      if (generation === enaPreviewGeneration.current) setEnaLoadingPreview(false);
    }
  };

  const startEnaImport = async () => {
    setEnaStarting(true);
    setEnaError(null);
    try {
      if (!collection) throw new Error("Name your sequencing data before importing.");
      const response = await fetch("/api/workbench/imports", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": enaImportRequestKey.current },
        body: JSON.stringify({
          providerId: enaProviderId,
          input: { accession: enaAccession, maxFiles: enaMaxFiles, collection },
          previewFingerprint: enaPreview?.fingerprint,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to start ENA import");
      setEnaPreview(null);
      await trackStartedImport(payload.job.id);
      if (typeof payload.collectionOrderId === "string") onCollectionReady?.(payload.collectionOrderId);
    } catch (err) {
      setEnaError(err instanceof Error ? err.message : "Failed to start ENA import");
    } finally {
      setEnaStarting(false);
    }
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
    <div className="@container space-y-6">
      {!source && <Link className="text-sm underline" href="/orders">View sequencing data</Link>}
      {(!source || source === "cami") && <CamiImportCard initiallyOpen={source === "cami"} onStarted={trackStartedImport} onQueued={onCollectionReady} collection={collection} enablePolling={enablePolling} />}
      {(!source || source === "sra") && <section aria-label="SRA / ENA import" className="@container overflow-hidden rounded-xl border bg-card">
        {!source && <div className="flex flex-col gap-3 border-b border-border px-4 py-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Store className="h-4 w-4 text-teal-700" />
              <h2 className="text-sm font-semibold text-foreground">Additional import sources</h2>
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
        </div>}

        <ImportModuleHeader source="sra" title={source ? "SRA / ENA import module" : enaImporter?.label || "ENA FASTQ by accession"} description="Find public sequencing reads by run, sample or project accession. Preview the files, then import reads with their original source metadata.">
          <Badge variant="outline" className="border-sky-200 bg-card/60 font-normal dark:border-sky-800">Single & paired-end FASTQ</Badge>
          <Badge variant="outline" className="border-sky-200 bg-card/60 font-normal dark:border-sky-800">No local tool required</Badge>
        </ImportModuleHeader>
        <div className="p-5 sm:p-6">
          <div className="grid items-start gap-6 @3xl:grid-cols-[minmax(0,1fr)_minmax(0,0.9fr)]">
            <div className="min-w-0 space-y-5">
              <ImportStepHeading source="sra" step={1} title="Find sequencing reads" />
              <div className="grid gap-3 @lg:grid-cols-[minmax(0,1fr)_120px]">
                <label className="min-w-0 space-y-1.5">
                  <span className="text-sm font-medium">Accession</span>
                  <Input
                    className="h-10 bg-card font-mono focus-visible:ring-sky-600/30"
                    value={enaAccession}
                    onChange={(event) => setEnaAccession(event.target.value.toUpperCase())}
                    placeholder="ERR…, SRR…, DRR…, ERS…, or PRJEB…"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-sm font-medium">Max files</span>
                  <Input
                    className="h-10 bg-card focus-visible:ring-sky-600/30"
                    type="number"
                    min={1}
                    max={100}
                    value={enaMaxFiles}
                    onChange={(event) => setEnaMaxFiles(Number(event.target.value))}
                  />
                </label>
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">Accepts public ENA, SRA and DRA accessions. Repository study and BioProject metadata are retained as provenance; no SeqDesk study is created.</p>
              <div className="space-y-3 rounded-xl border bg-muted/20 p-4">
                <p className="text-sm font-medium">Try a public example</p>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Choose an example, then select Preview files. Examples set a two-file limit.
                  Previewing fetches archive metadata only; files are downloaded when you import.
                </p>
                <div className="grid gap-2">
                  {[
                    { accession: "ERR164407", label: "Marine metagenome run" },
                    { accession: "DRR099973", label: "Mouse gut metagenome run" },
                    { accession: "PRJEB1787", label: "Marine metagenome project" },
                  ].map((example) => (
                    <Button
                      key={example.accession}
                      type="button"
                      variant="outline"
                      size="sm"
                      className={cn("h-auto min-h-14 flex-row items-center justify-between gap-3 px-3 py-2.5 text-left whitespace-normal hover:border-sky-300 dark:hover:border-sky-700", enaAccession === example.accession && "border-sky-300 bg-sky-50 dark:border-sky-700 dark:bg-sky-950/30")}
                      disabled={enaLoadingPreview || enaStarting}
                      onClick={() => {
                        setEnaAccession(example.accession);
                        setEnaMaxFiles(2);
                        setEnaError(null);
                      }}
                    >
                      <span className="min-w-0 space-y-0.5"><span className="block">{example.label}</span><span className="block font-mono text-xs text-muted-foreground">{example.accession}</span></span>
                      <ArrowRight className="size-4 text-sky-700 dark:text-sky-300" aria-hidden="true" />
                    </Button>
                  ))}
                </div>
              </div>
              {enaError && (
                <div role="alert" className="flex gap-2 rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                  <span className="min-w-0 break-words">{enaError}</span>
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  className={cn("h-10", importModuleTheme.sra.action)}
                  onClick={() => void runEnaPreview()}
                  disabled={enaLoadingPreview || !enaAccession.trim()}
                >
                  {enaLoadingPreview ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Search className="h-4 w-4" aria-hidden="true" />}
                  Preview files
                </Button>
              </div>
            </div>

            <section aria-label="SRA file preview" aria-busy={enaLoadingPreview} className="min-w-0 overflow-hidden rounded-xl border border-sky-200 dark:border-sky-800">
              <div className={cn("space-y-1 border-b p-4", importModuleTheme.sra.surface, importModuleTheme.sra.border)}>
                <ImportStepHeading source="sra" step={2} title="Review files" />
              </div>
              <div className="space-y-4 p-4">
              {enaLoadingPreview ? (
                <div role="status" className="space-y-4">
                  <p className="flex items-center gap-2 text-sm text-sky-700 dark:text-sky-300"><Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />Looking up archive files…</p>
                  {[0, 1, 2].map(index => <div key={index} aria-hidden="true" className="space-y-3 rounded-lg border p-3"><Skeleton className="h-4 w-3/4 bg-sky-100 dark:bg-sky-900/40 motion-reduce:animate-none" /><Skeleton className="h-3 w-1/2 motion-reduce:animate-none" /></div>)}
                </div>
              ) : enaPreview ? (
                <div className="space-y-3">
                  <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <CheckCircle2 className="size-4 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden="true" />
                    {enaPreview.summary.selectedCount} FASTQ file(s) selected
                  </p>
                  {enaPreview.warnings?.map((warning) => (
                    <p key={warning} className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
                      {warning}
                    </p>
                  ))}
                  <div className="max-h-96 space-y-3 overflow-auto">
                    {enaPreview.files.map((file) => (
                      <div key={`${file.runAccession}:${file.filename}`} className="space-y-2 rounded-lg border bg-card p-3">
                        <p className="break-words text-sm font-medium">{file.filename}</p>
                        <p className="break-words text-xs leading-relaxed text-muted-foreground">
                          {file.runAccession}
                          {file.scientificName ? ` · ${file.scientificName}` : ""}
                          {file.libraryLayout ? ` · ${file.libraryLayout}` : ""}
                          {file.bytes !== undefined ? ` · ${(file.bytes / 1024 ** 2).toFixed(1)} MiB` : " · size unknown"}
                        </p>
                        <ImportFileDetails file={{ ...file, sourceMd5: file.md5 }} />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <div className="flex min-h-64 flex-col items-center justify-center gap-3 px-3 py-8 text-center">
                  <span className={cn("flex size-14 items-center justify-center rounded-2xl", importModuleTheme.sra.surface)}><FileSearch className="size-7" strokeWidth={1.5} aria-hidden="true" /></span>
                  <p className="text-sm font-medium">Your file preview appears here</p>
                  <p className="max-w-xs text-sm leading-relaxed text-muted-foreground">Preview archive metadata and file counts before any data is downloaded.</p>
                </div>
              )}
              </div>
              <div className="space-y-3 border-t bg-muted/20 p-4">
                <Button
                  type="button"
                  className={cn("h-auto min-h-10 w-full whitespace-normal", importModuleTheme.sra.action)}
                  onClick={() => void startEnaImport()}
                  disabled={!enaPreview || enaStarting}
                >
                  {enaStarting ? <Loader2 className="h-4 w-4 motion-safe:animate-spin" aria-hidden="true" /> : <Download className="h-4 w-4" aria-hidden="true" />}
                  Import sequencing data
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">Check the files and metadata above before starting your download.</p>
              </div>
            </section>
          </div>
        </div>

        {!source && storeOpen && (
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

        {!source && !storeOpen && selectedImporterId !== providerId && (
          <div className="flex min-h-56 flex-col items-center justify-center px-6 py-12 text-center">
            <span className="mb-4 flex h-12 w-12 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
              <Store className="h-5 w-5" />
            </span>
            <h3 className="text-base font-semibold text-foreground">Reference genome import not selected</h3>
            <p className="mt-2 max-w-xl text-sm text-muted-foreground">
              Public ENA FASTQ imports above work without a local tool. Open the Store when you
              also want taxon-based NCBI reference genome packages.
            </p>
          </div>
        )}

        {!source && selectedImporterId === providerId && (
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
      </section>}

      {collection && collectionOrderId && <aside className={cn("flex flex-col justify-between gap-4 rounded-xl border p-5 @xl:flex-row", sourceTheme.border, sourceTheme.surface)}>
        <div className="min-w-0 space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold"><Bell className="size-4 shrink-0" aria-hidden="true" />Your imports continue in the background</p>
          <p className="max-w-2xl text-xs leading-relaxed text-muted-foreground">You can leave this page. Imports continue on the server; keep your local server and computer running. Completion and failure notifications appear in SeqDesk.</p>
        </div>
        <Button variant="outline" className="h-auto min-h-10 max-w-full self-start whitespace-normal text-left" asChild><Link href={`/orders/${collectionOrderId}/samples-files`}><FolderOpen className="size-4" aria-hidden="true" /><span className="min-w-0 break-words">Open {collection.name} · Files</span><ArrowRight className="size-4" aria-hidden="true" /></Link></Button>
      </aside>}

      {(!moduleProviderId || visibleJobs.length > 0) && <section aria-label={moduleProviderId ? "Import progress" : "Import jobs"} className="@container overflow-hidden rounded-xl border bg-card">
        <div className={cn("border-b px-5 py-4", moduleProviderId && sourceTheme.surface)}>
          <h2 className="flex items-center gap-2 text-sm font-semibold text-foreground"><Download className={cn("size-4", moduleProviderId && sourceTheme.text)} aria-hidden="true" />{moduleProviderId ? "Import progress" : "Import jobs"}</h2>
        </div>
        {visibleJobs.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-foreground">
            No import jobs yet.
          </div>
        ) : (
          <div className="divide-y divide-border">
            {visibleJobs.map((job) => (
              <div key={job.id} className="grid gap-3 px-4 py-4 @xl:grid-cols-2 @xl:items-start @4xl:grid-cols-[1.2fr_0.8fr_1.4fr_1.2fr]">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-foreground">{job.providerId}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(job.createdAt)}</p>
                </div>
                <div>
                  <WorkbenchStatusBadge tone={statusTone(job.status)}>{job.status}</WorkbenchStatusBadge>
                </div>
                <div className="min-w-0 text-sm text-muted-foreground">
                  <ImportProgress status={job.status} phase={job.phase} source={job.providerId === enaProviderId ? "sra" : "cami"} />
                </div>
                <div className="min-w-0 space-y-3 text-sm">
                  <div className={job.error ? "text-destructive" : "text-muted-foreground"}>
                    {job.error || (job.scientificRecords ? <span>Imported sequencing data into <Link className="underline" href={job.scientificRecords.orderId ? `/orders/${job.scientificRecords.orderId}` : `/sequencing/${job.scientificRecords.sampleId}`}>{job.scientificRecords.orderTitle ?? job.scientificRecords.sampleTitle} — open sequencing data</Link>. {job.scientificRecords.studyId ? <Link className="underline" href={`/studies/${job.scientificRecords.studyId}`}>{job.scientificRecords.studyTitle} — open study</Link> : <>No study created. <Link className="underline" href="/studies">Link samples to a study later</Link>.</>}</span> : job.resultDatasetId ? "Dataset ready" : job.phase === "cancelling" ? "Cancellation requested. Waiting for the worker to stop." : job.status === "running" ? "Import continues in the background" : job.status === "queued" ? "Queued on the server" : job.status)}
                  </div>
                  <CancelImportButton jobId={job.id} status={job.status} phase={job.phase} />
                </div>
              </div>
            ))}
          </div>
        )}
      </section>}
    </div>
  );
}
