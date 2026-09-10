"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CheckCircle2, Clock3, Download, ExternalLink, Eye, Loader2, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { WorkbenchImportPreview } from "@/lib/workbench/importers/types";
import { camiCatalog } from "@/lib/workbench/importers/cami-catalog";
import type { ImportCollection } from "@/lib/workbench/import-collection";
import { canSelectCamiSample, type CamiSampleFileInfo, type CamiSampleStatus } from "@/lib/workbench/cami-sample-types";
import { ImportFileDetails } from "./ImportFileDetails";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportProgress } from "./ImportProgress";
import { ImportModuleHeader, ImportStepHeading, importModuleTheme } from "./ImportModuleUI";
import { cn } from "@/lib/utils";

type ReviewedSample = { sample: number; preview: WorkbenchImportPreview & { fingerprint: string }; requestKey: string };
const statusLabels = { available: "Available", imported: "Imported here", queued: "Queued", running: "Downloading / preparing", error: "Failed · retry", cancelled: "Cancelled · retry" };

function formatDownloadSize(bytes: number) {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(2)} GiB`;
  if (bytes >= 1024 ** 2) return `${(bytes / 1024 ** 2).toFixed(1)} MiB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${bytes} B`;
}

export function CamiImportCard({ onStarted, onQueued, initiallyOpen = false, collection, enablePolling = true }: {
  onQueued?: (orderId: string) => void;
  onStarted: (jobId: string) => Promise<void>; initiallyOpen?: boolean; collection?: ImportCollection; enablePolling?: boolean;
}) {
  const [technology, setTechnology] = useState<"short" | "long">("short");
  const [dataset, setDataset] = useState<keyof typeof camiCatalog>("cami2-marine");
  const [enabled, setEnabled] = useState(initiallyOpen);
  const [selection, setSelection] = useState<number[]>([]);
  const [statuses, setStatuses] = useState<CamiSampleStatus[]>([]);
  const [statusScope, setStatusScope] = useState("");
  const [statusError, setStatusError] = useState("");
  const [statusRefresh, setStatusRefresh] = useState(0);
  const [fileInfo, setFileInfo] = useState<{ scope: string; files: CamiSampleFileInfo[] } | null>(null);
  const [fileInfoRefresh, setFileInfoRefresh] = useState(0);
  const [reviewed, setReviewed] = useState<ReviewedSample[]>([]);
  const [sampleErrors, setSampleErrors] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const operation = useRef<AbortController | null>(null);
  const scope = [collection?.key, dataset, technology].join(":");
  const loaded = statusScope === scope && !statusError;
  const available = loaded ? statuses.filter(canSelectCamiSample).map(item => item.sample) : [];
  const selected = selection.filter(sample => available.includes(sample));
  const selectedReviews = reviewed.filter(item => selected.includes(item.sample));
  const totalBytes = selectedReviews.reduce((sum, item) => sum + (item.preview.assets ?? []).reduce((bytes, asset) => bytes + asset.bytes, 0), 0);
  const importedCount = loaded ? statuses.filter(item => item.status === "imported").length : 0;
  const titleId = useId();
  const theme = importModuleTheme.cami;
  const hasCollection = Boolean(collection);
  const fileScope = `${dataset}:${technology}:${fileInfoRefresh}`;
  const currentFiles = fileInfo?.scope === fileScope ? fileInfo.files : undefined;
  const sizeUnavailable = currentFiles?.some(file => file.downloadBytes === null);
  const paired = camiCatalog[dataset].technologies[technology].layout === "paired";

  function invalidate() {
    generation.current++; operation.current?.abort(); setReviewed([]); setSampleErrors({}); setError(null); setNotice("");
  }
  useEffect(() => {
    invalidate(); setSelection([]); setBusy(false); setActivity("");
    return () => { generation.current++; operation.current?.abort(); };
  }, [collection?.key, collection?.name, dataset, technology]);

  useEffect(() => {
    if (!enabled || !collection) return;
    const controller = new AbortController();
    let active = true, fetching = false;
    async function refresh() {
      if (fetching) return;
      fetching = true;
      try {
        const query = new URLSearchParams({ collection: collection!.key, dataset, technology });
        const response = await fetch("/api/workbench/importers/cami-benchmark/samples?" + query, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Could not check sample status");
        if (!Array.isArray(payload.samples) || payload.samples.length !== camiCatalog[dataset].samples) throw new Error("Incomplete sample status; reload before importing.");
        if (active) { setStatuses(payload.samples); setStatusScope(scope); setStatusError(""); }
      } catch (err) {
        if (active) setStatusError(err instanceof Error ? err.message : "Could not check sample status");
      } finally { fetching = false; }
    }
    void refresh();
    const timer = enablePolling ? setInterval(() => void refresh(), 5000) : undefined;
    return () => { active = false; controller.abort(); if (timer) clearInterval(timer); };
  }, [enabled, collection?.key, dataset, technology, scope, statusRefresh, enablePolling]);

  useEffect(() => {
    if (!enabled || !hasCollection) return;
    const controller = new AbortController();
    async function loadFileInfo() {
      try {
        const query = new URLSearchParams({ dataset, technology });
        const response = await fetch("/api/workbench/importers/cami-benchmark/files?" + query, { cache: "no-store", signal: controller.signal });
        const payload = await response.json();
        const files: CamiSampleFileInfo[] = payload.files;
        if (!response.ok || !Array.isArray(files) || files.length !== camiCatalog[dataset].samples || files.some((file, index) =>
          file?.sample !== index || (file.downloadBytes !== null && (!Number.isSafeInteger(file.downloadBytes) || file.downloadBytes <= 0))
        )) throw new Error("File information unavailable");
        if (!controller.signal.aborted) setFileInfo({ scope: fileScope, files });
      } catch {
        if (!controller.signal.aborted) setFileInfo({ scope: fileScope, files: Array.from({ length: camiCatalog[dataset].samples }, (_, sample) => ({ sample, downloadBytes: null })) });
      }
    }
    void loadFileInfo();
    return () => controller.abort();
  }, [enabled, hasCollection, dataset, technology, fileScope]);

  function sampleInput(sample: number) {
    return { dataset, technology, sample, role: "reads", ...(collection ? { collection } : {}) };
  }

  async function previewSelected() {
    invalidate();
    const version = generation.current;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true);
    const pending = [...selected].sort((a, b) => a - b);
    const next: ReviewedSample[] = [];
    const failures: Record<number, string> = {};
    try {
      for (const [index, sample] of pending.entries()) {
        controller.signal.throwIfAborted();
        setActivity("Previewing sample_" + sample + " · " + (index + 1) + " of " + pending.length);
        try {
          const response = await fetch("/api/workbench/importers/cami-benchmark/preview", {
            method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify(sampleInput(sample)), signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "CAMI preview failed");
          if (!payload.preview?.fingerprint || !payload.preview.assets?.length) throw new Error("CAMI preview is incomplete");
          next.push({ sample, preview: payload.preview, requestKey: crypto.randomUUID() });
        } catch (err) {
          if (controller.signal.aborted) throw err;
          failures[sample] = err instanceof Error ? err.message : "CAMI preview failed";
        }
      }
      if (version === generation.current) { setReviewed(next); setSampleErrors(failures); }
    } catch (err) {
      if (version === generation.current && !controller.signal.aborted) setError(err instanceof Error ? err.message : "CAMI preview failed");
    } finally {
      if (version === generation.current) { setBusy(false); setActivity(""); }
    }
  }

  async function startSelected() {
    if (!collection || !selectedReviews.length) return;
    const version = generation.current;
    const controller = new AbortController(); operation.current = controller;
    setBusy(true); setError(null); setNotice("");
    const accepted: number[] = [];
    let collectionOrderId: string | undefined;
    const failures: Record<number, string> = { ...sampleErrors };
    try {
      // Each sample keeps its own reviewed manifest/idempotency key and job.
      // A partial queue failure never silently retries a previously accepted job.
      for (const [index, item] of selectedReviews.entries()) {
        controller.signal.throwIfAborted();
        setActivity("Queuing sample_" + item.sample + " · " + (index + 1) + " of " + selectedReviews.length);
        try {
          const response = await fetch("/api/workbench/imports", {
            method: "POST", headers: { "content-type": "application/json", "idempotency-key": item.requestKey },
            body: JSON.stringify({ providerId: "cami-benchmark", input: sampleInput(item.sample), previewFingerprint: item.preview.fingerprint }),
            signal: controller.signal,
          });
          const payload = await response.json();
          if (!response.ok) throw new Error(payload.error || "Could not queue this sample");
          if (!payload.job?.id) throw new Error("No import job returned; retry with the same selection");
          accepted.push(item.sample); delete failures[item.sample];
          if (typeof payload.collectionOrderId === "string") collectionOrderId = payload.collectionOrderId;
          if (version === generation.current) {
            setStatuses(current => current.map(status => status.sample === item.sample ? { sample: item.sample, status: "queued", jobId: payload.job.id } : status));
            // Accepted work remains accepted even if refreshing the progress UI fails.
            await onStarted(payload.job.id).catch(() => {});
          }
        } catch (err) {
          if (controller.signal.aborted) throw err;
          failures[item.sample] = err instanceof Error ? err.message : "Could not queue this sample";
        }
      }
      if (version === generation.current) {
        setSelection(current => current.filter(sample => !accepted.includes(sample)));
        setReviewed(current => current.filter(item => !accepted.includes(item.sample)));
        setSampleErrors(failures);
        if (collectionOrderId && accepted.length === selectedReviews.length && !Object.keys(failures).length) onQueued?.(collectionOrderId);
        setNotice(accepted.length + " sample import" + (accepted.length === 1 ? "" : "s") + " queued." + (Object.keys(failures).length ? " Some selections need attention; review their errors below." : ""));
      }
    } catch (err) {
      if (version === generation.current && !controller.signal.aborted) setError(err instanceof Error ? err.message : "CAMI import failed");
    } finally {
      if (version === generation.current) { setBusy(false); setActivity(""); setStatusRefresh(value => value + 1); }
    }
  }

  return <section aria-labelledby={titleId} className="@container overflow-hidden rounded-xl border bg-card">
    <ImportModuleHeader source="cami" titleId={titleId} title="CAMI import module" description="CAMI II Marine and CAMI III toy human gut · Raw reads and source metadata">
      <Badge variant="outline" className="border-teal-200 bg-card/60 font-normal dark:border-teal-800">Synthetic benchmark</Badge>
      <Badge variant="outline" className="border-teal-200 bg-card/60 font-normal dark:border-teal-800">Short & long reads</Badge>
    </ImportModuleHeader>
    {!initiallyOpen && <div className={cn("px-5 pt-5", enabled ? "pb-1" : "pb-5")}><Button disabled={busy} variant="outline" onClick={() => setEnabled(!enabled)}>{enabled ? "Close CAMI module" : "Use CAMI module"}</Button></div>}
    {enabled && <div className="space-y-6 p-5 sm:p-6">
      <div className="space-y-4 rounded-xl border bg-muted/20 p-4">
      <ImportStepHeading source="cami" step={1} title="Choose dataset & reads" />
      <fieldset disabled={busy} className="grid gap-4 @lg:grid-cols-2">
        <label className="min-w-0 space-y-1.5 text-sm"><span className="block font-medium">Dataset</span><select className="h-10 w-full min-w-0 rounded-lg border bg-card px-3 outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50" value={dataset} onChange={event => { invalidate(); setSelection([]); setDataset(event.target.value as keyof typeof camiCatalog); }}>
          {Object.entries(camiCatalog).map(([key, entry]) => <option key={key} value={key}>{entry.title}</option>)}
        </select></label>
        <label className="min-w-0 space-y-1.5 text-sm"><span className="block font-medium">Technology</span><select className="h-10 w-full min-w-0 rounded-lg border bg-card px-3 outline-none focus-visible:ring-2 focus-visible:ring-teal-600/40 disabled:opacity-50" value={technology} onChange={event => { invalidate(); setSelection([]); setTechnology(event.target.value as "short" | "long"); }}>
          <option value="short">Short reads (paired-end)</option><option value="long">Long reads</option>
        </select></label>
      </fieldset>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{technology === "short" ? "Short reads · Paired-end" : "Long reads · Single-end"}</p>
        <a className={cn("inline-flex items-center gap-1.5 rounded text-xs font-medium underline-offset-4 hover:underline focus-visible:outline-2", theme.text)} href={camiCatalog[dataset].sourcePage} target="_blank" rel="noreferrer">Dataset details and citation <ExternalLink className="size-3" aria-hidden="true" /></a>
      </div>
      </div>
      {!collection && <p className="text-sm text-muted-foreground">Name your sequencing data before selecting samples.</p>}
      {statusError && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{statusError} <Button variant="outline" size="sm" onClick={() => setStatusRefresh(value => value + 1)}>Retry status check</Button></div>}
      <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="space-y-1.5"><ImportStepHeading source="cami" step={2} title="Samples" /><p className="text-xs tabular-nums text-muted-foreground">{selected.length} selected · {importedCount} of {camiCatalog[dataset].samples} imported here for {technology === "short" ? "short reads" : "long reads"}</p></div>
        <div className="flex flex-wrap gap-2">
          {sizeUnavailable && <Button size="sm" variant="ghost" disabled={busy} onClick={() => setFileInfoRefresh(value => value + 1)}>Retry file sizes</Button>}
          <Button size="sm" variant="outline" disabled={busy || !available.length} onClick={() => { invalidate(); setSelection(available); }}>Select all available</Button>
          <Button size="sm" variant="ghost" disabled={busy || !selection.length} onClick={() => { invalidate(); setSelection([]); }}>Clear selection</Button>
        </div>
      </div>
      <fieldset disabled={busy} aria-label="CAMI samples" aria-busy={!loaded && !statusError && Boolean(collection)} className="grid gap-3 @xs:grid-cols-2 @xl:grid-cols-3 @4xl:grid-cols-4">
        {Array.from({ length: camiCatalog[dataset].samples }, (_, sample) => {
          const status = loaded ? statuses.find(item => item.sample === sample) : undefined;
          const selectable = canSelectCamiSample(status) && !busy;
          const downloadBytes = reviewed.find(item => item.sample === sample)?.preview.assets?.[0]?.bytes ?? currentFiles?.find(file => file.sample === sample)?.downloadBytes;
          const StatusIcon = status?.status === "imported" ? CheckCircle2 : status?.status === "running" ? Download : status?.status === "queued" ? Clock3 : status?.status === "error" || status?.status === "cancelled" ? RotateCcw : null;
          const hasDetails = Boolean(
            (status?.status === "queued" && status.phase && status.phase !== "queued") ||
            (!status && !statusError && collection) || status?.status === "running" ||
            (status?.status === "imported" && status.orderId) || status?.error
          );
          return <div key={sample} className={cn("flex h-56 min-w-0 flex-col overflow-hidden rounded-xl border transition-colors focus-within:ring-2 focus-within:ring-teal-600/50 motion-reduce:transition-none", selected.includes(sample) ? "border-teal-500 bg-teal-50/80 dark:border-teal-500 dark:bg-teal-950/30" : status?.status === "running" || status?.status === "imported" ? "border-teal-200 bg-teal-50/30 dark:border-teal-900 dark:bg-teal-950/20" : "bg-card", selectable && "hover:border-teal-400 dark:hover:border-teal-600")}>
            <label className={cn("flex shrink-0 items-start gap-3 p-4 text-sm", !hasDetails && "flex-1", selectable && "cursor-pointer")}>
              <input type="checkbox" className="mt-0.5 size-4 shrink-0 accent-teal-700" aria-label={"Select sample_" + sample} disabled={!canSelectCamiSample(status)} checked={selected.includes(sample)} onChange={event => { invalidate(); setSelection(current => event.target.checked ? [...current, sample] : current.filter(value => value !== sample)); }} />
              <span className="min-w-0 flex-1">
                <span className="block font-semibold">{"sample_" + sample}</span>
                <span className={cn("mt-1.5 flex items-center gap-1.5 text-xs", status?.status === "imported" || status?.status === "running" ? theme.text : "text-muted-foreground")}>{StatusIcon && <StatusIcon className="size-3 shrink-0" aria-hidden="true" />}{status ? statusLabels[status.status] : statusError ? "Status unavailable" : collection ? "Checking status…" : "Choose a collection first"}</span>
                <span className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                  <span className="rounded-md bg-muted px-1.5 py-0.5" title={paired ? "PE: paired-end reads" : "SE: single-end reads"}>{paired ? "Paired-end" : "Single-end"}</span>
                  <span className="rounded-md bg-muted px-1.5 py-0.5">FASTQ</span>
                </span>
                <span className="mt-2 block text-xs tabular-nums" title="Compressed source archive size; checked again during preview.">
                  {typeof downloadBytes === "number" ? `${formatDownloadSize(downloadBytes)} download` : currentFiles || !collection ? "Size unavailable" : <span className="inline-flex items-center gap-2 text-muted-foreground"><span aria-hidden="true" className="h-2 w-8 rounded bg-teal-100 motion-safe:animate-pulse dark:bg-teal-900/40" />Checking size…</span>}
                </span>
                {!hasDetails && <span className="mt-1 block text-[11px] leading-relaxed text-muted-foreground" title={paired ? "SeqDesk unpacks the archive and splits paired reads into R1.fastq.gz and R2.fastq.gz." : "SeqDesk unpacks the archive into one single-end FASTQ.gz file."}>
                  .tar.gz → {paired ? "R1 + R2" : "1 read file"}<span className="block">{paired ? "2 FASTQ.gz files" : "1 FASTQ.gz file"} after import</span>
                </span>}
              </span>
            </label>
            {hasDetails && <div role="group" aria-label={`Details for sample_${sample}`} tabIndex={status ? 0 : undefined} className="min-h-0 flex-1 overflow-y-auto overscroll-contain break-words rounded-b-xl outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-teal-600/50">
            {status?.status === "queued" && status.phase && status.phase !== "queued" && <p role="status" className="px-4 pb-4 text-xs leading-relaxed text-muted-foreground">{status.phase}</p>}
            {!status && !statusError && collection && <div className="px-4 pb-4"><Skeleton className="h-2 w-full bg-teal-100 dark:bg-teal-900/40 motion-reduce:animate-none" aria-label="Loading sample status" /></div>}
            {status?.status === "running" && <div className="border-t border-teal-100 px-4 py-3 text-xs leading-relaxed dark:border-teal-900"><ImportProgress status="running" phase={status.phase} source="cami" barFirst /></div>}
            {status?.status === "imported" && status.orderId && <a className={cn("block px-4 pb-4 text-xs underline underline-offset-4", theme.text)} href={"/orders/" + status.orderId}>Open sequencing data</a>}
            {status?.error && <p className="break-words px-4 pb-4 text-xs text-destructive">{status.error}</p>}
            </div>}
          </div>;
        })}
      </fieldset>
      <p className="text-xs text-muted-foreground">Select one, several or all available samples. Imported and queued samples are skipped for this technology. Gold standards are excluded.</p>
      <Button className={cn("h-auto min-h-10 whitespace-normal", theme.action)} disabled={busy || !selected.length || !loaded} onClick={() => void previewSelected()}><Eye aria-hidden="true" />Preview {selected.length || ""}{selected.length ? " selected sample" + (selected.length === 1 ? "" : "s") : "selected samples"}</Button>
      </div>
      {activity && <div role="status" className={cn("space-y-3 rounded-xl border p-4", theme.border, theme.surface)}><p className="flex items-center gap-2 text-sm"><Loader2 className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />{activity}</p><Skeleton className="h-2 w-full bg-teal-200/60 dark:bg-teal-800/60 motion-reduce:animate-none" /></div>}
      {activity.startsWith("Queuing") && <p className="text-xs text-muted-foreground">Keep this page open until the selected samples are queued. Queued downloads continue in the background.</p>}
      {notice && <p role="status" className={cn("rounded-lg border p-3 text-sm", theme.surface, theme.border)}>{notice}</p>}
      {selectedReviews.length > 0 && <section aria-label="Review CAMI import" className={cn("overflow-hidden rounded-xl border text-sm", theme.border)}>
        <div className={cn("space-y-2 border-b p-4", theme.surface, theme.border)}><ImportStepHeading source="cami" step={3} title="Review import" /><p className="font-medium">{selectedReviews.length} reviewed sample{selectedReviews.length === 1 ? "" : "s"} · {(totalBytes / 1024 ** 3).toFixed(2)} GiB total download</p></div>
        <div className="space-y-4 p-4">
        <p className="text-muted-foreground">Downloads run in the background and wait automatically until enough storage is available.</p>
        <div className="max-h-80 space-y-3 overflow-auto">{selectedReviews.map(item => <details key={item.sample} className="rounded-lg border bg-card p-3 open:space-y-3">
          <summary className="cursor-pointer rounded font-medium focus-visible:outline-2 focus-visible:outline-teal-600">{"sample_" + item.sample} · {((item.preview.assets ?? []).reduce((sum, asset) => sum + asset.bytes, 0) / 1024 ** 3).toFixed(2)} GiB</summary>
          {item.preview.sampleMetadata && <p className="mt-2 text-muted-foreground">{String(item.preview.sampleMetadata.platform)} · {String(item.preview.sampleMetadata.environment)}{item.preview.sampleMetadata.subjectId ? " · Subject " + item.preview.sampleMetadata.subjectId : ""}</p>}
          {item.preview.assets?.map(asset => <ImportFileDetails key={asset.url} file={asset} />)}
          {item.preview.warnings?.map(warning => <p key={warning} className="mt-1 text-xs text-muted-foreground">{warning}</p>)}
        </details>)}</div>
        <Button className={cn("h-auto min-h-10 whitespace-normal", theme.action)} disabled={busy || !loaded} onClick={() => void startSelected()}><Download aria-hidden="true" />Import {selectedReviews.length} reviewed sample{selectedReviews.length === 1 ? "" : "s"}</Button>
        </div>
      </section>}
      {Object.entries(sampleErrors).map(([sample, message]) => <p key={sample} role="alert" className="break-words text-sm text-destructive">{"sample_" + sample + ": " + message}</p>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </div>}
  </section>;
}
