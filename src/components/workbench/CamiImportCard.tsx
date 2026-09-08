"use client";

import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import type { WorkbenchImportPreview } from "@/lib/workbench/importers/types";
import { camiCatalog } from "@/lib/workbench/importers/cami-catalog";
import type { ImportCollection } from "@/lib/workbench/import-collection";
import { canSelectCamiSample, type CamiSampleStatus } from "@/lib/workbench/cami-sample-types";
import { ImportFileDetails } from "./ImportFileDetails";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportProgress } from "./ImportProgress";

type ReviewedSample = { sample: number; preview: WorkbenchImportPreview & { fingerprint: string }; requestKey: string };
const statusLabels = { available: "Available", imported: "Imported here", queued: "Queued", running: "Downloading / preparing", error: "Failed · retry", cancelled: "Cancelled · retry" };

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

  return <section className="space-y-4 rounded-lg border border-border bg-card p-4">
    <h2 className="font-semibold">CAMI import module</h2>
    <p className="text-sm text-muted-foreground">CAMI II Marine and CAMI III toy human gut · Raw reads and source metadata</p>
    {!initiallyOpen && <Button disabled={busy} variant="outline" onClick={() => setEnabled(!enabled)}>{enabled ? "Close CAMI module" : "Use CAMI module"}</Button>}
    {enabled && <>
      <fieldset disabled={busy} className="flex flex-wrap gap-4">
        <label className="space-y-1 text-sm"><span className="block font-medium">Dataset</span><select className="rounded border bg-background p-2" value={dataset} onChange={event => { invalidate(); setSelection([]); setDataset(event.target.value as keyof typeof camiCatalog); }}>
          {Object.entries(camiCatalog).map(([key, entry]) => <option key={key} value={key}>{entry.title}</option>)}
        </select></label>
        <label className="space-y-1 text-sm"><span className="block font-medium">Technology</span><select className="rounded border bg-background p-2" value={technology} onChange={event => { invalidate(); setSelection([]); setTechnology(event.target.value as "short" | "long"); }}>
          <option value="short">Short reads (paired-end)</option><option value="long">Long reads</option>
        </select></label>
      </fieldset>
      <p className="text-sm"><a className="underline" href={camiCatalog[dataset].sourcePage} target="_blank" rel="noreferrer">Dataset details and citation</a></p>
      <p className="text-xs font-medium">Synthetic benchmark · {technology === "short" ? "Short reads · Paired-end" : "Long reads · Single-end"}</p>
      {!collection && <p className="text-sm text-muted-foreground">Name your sequencing data before selecting samples.</p>}
      {statusError && <div role="alert" className="text-sm text-destructive">{statusError} <Button variant="outline" size="sm" onClick={() => setStatusRefresh(value => value + 1)}>Retry status check</Button></div>}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h3 className="text-sm font-semibold">Samples</h3><p className="text-xs text-muted-foreground">{selected.length} selected · {importedCount} of {camiCatalog[dataset].samples} imported here for {technology === "short" ? "short reads" : "long reads"}</p></div>
        <div className="flex gap-2">
          <Button size="sm" variant="outline" disabled={busy || !available.length} onClick={() => { invalidate(); setSelection(available); }}>Select all available</Button>
          <Button size="sm" variant="ghost" disabled={busy || !selection.length} onClick={() => { invalidate(); setSelection([]); }}>Clear selection</Button>
        </div>
      </div>
      <fieldset disabled={busy} aria-label="CAMI samples" className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: camiCatalog[dataset].samples }, (_, sample) => {
          const status = loaded ? statuses.find(item => item.sample === sample) : undefined;
          return <div key={sample} className={"min-w-0 rounded-lg border p-3 " + (selected.includes(sample) ? "border-primary bg-primary/5" : "bg-background")}>
            <label className="flex items-start gap-2 text-sm">
              <input type="checkbox" className="mt-1 accent-teal-600" aria-label={"Select sample_" + sample} disabled={!canSelectCamiSample(status)} checked={selected.includes(sample)} onChange={event => { invalidate(); setSelection(current => event.target.checked ? [...current, sample] : current.filter(value => value !== sample)); }} />
              <span className="min-w-0"><span className="block font-medium">{"sample_" + sample}</span><span className={"mt-1 block text-xs " + (status?.status === "imported" ? "text-teal-700" : "text-muted-foreground")}>{status ? statusLabels[status.status] : statusError ? "Status unavailable" : collection ? "Checking status…" : "Choose a collection first"}</span></span>
            </label>
            {status?.status === "queued" && status.phase && status.phase !== "queued" && <p role="status" className="mt-2 text-xs text-muted-foreground">{status.phase}</p>}
            {!status && !statusError && collection && <Skeleton className="mt-2 h-6 w-full motion-reduce:animate-none" aria-label="Loading sample status" />}
            {status?.status === "running" && <div className="mt-2 text-xs"><ImportProgress status="running" phase={status.phase} /></div>}
            {status?.status === "imported" && status.orderId && <a className="mt-2 block text-xs underline" href={"/orders/" + status.orderId}>Open sequencing data</a>}
            {status?.error && <p className="mt-2 break-words text-xs text-destructive">{status.error}</p>}
          </div>;
        })}
      </fieldset>
      <p className="text-xs text-muted-foreground">Select one, several or all available samples. Imported and queued samples are skipped for this technology. Gold standards are excluded.</p>
      <Button disabled={busy || !selected.length || !loaded} onClick={() => void previewSelected()}>Preview {selected.length || ""}{selected.length ? " selected sample" + (selected.length === 1 ? "" : "s") : "selected samples"}</Button>
      {activity && <p role="status" className="text-sm">{activity}</p>}
      {activity.startsWith("Queuing") && <p className="text-xs text-muted-foreground">Keep this page open until the selected samples are queued. Queued downloads continue in the background.</p>}
      {notice && <p role="status" className="text-sm">{notice}</p>}
      {selectedReviews.length > 0 && <div className="space-y-3 rounded-lg border bg-muted/20 p-4 text-sm">
        <p className="font-medium">{selectedReviews.length} reviewed sample{selectedReviews.length === 1 ? "" : "s"} · {(totalBytes / 1024 ** 3).toFixed(2)} GiB total download</p>
        <p className="text-muted-foreground">Downloads run in the background and wait automatically until enough storage is available.</p>
        <div className="max-h-72 space-y-2 overflow-auto">{selectedReviews.map(item => <details key={item.sample} className="rounded border bg-background p-3">
          <summary className="cursor-pointer">{"sample_" + item.sample} · {((item.preview.assets ?? []).reduce((sum, asset) => sum + asset.bytes, 0) / 1024 ** 3).toFixed(2)} GiB</summary>
          {item.preview.sampleMetadata && <p className="mt-2 text-muted-foreground">{String(item.preview.sampleMetadata.platform)} · {String(item.preview.sampleMetadata.environment)}{item.preview.sampleMetadata.subjectId ? " · Subject " + item.preview.sampleMetadata.subjectId : ""}</p>}
          {item.preview.assets?.map(asset => <ImportFileDetails key={asset.url} file={asset} />)}
          {item.preview.warnings?.map(warning => <p key={warning} className="mt-1 text-xs text-muted-foreground">{warning}</p>)}
        </details>)}</div>
        <Button disabled={busy || !loaded} onClick={() => void startSelected()}>Import {selectedReviews.length} reviewed sample{selectedReviews.length === 1 ? "" : "s"}</Button>
      </div>}
      {Object.entries(sampleErrors).map(([sample, message]) => <p key={sample} role="alert" className="break-words text-sm text-destructive">{"sample_" + sample + ": " + message}</p>)}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </>}
  </section>;
}
