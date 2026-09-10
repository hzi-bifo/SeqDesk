"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ChevronDown, Download, FileText, FolderOpen, Loader2, Plus, RadioTower, RefreshCw, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CancelImportButton } from "@/components/workbench/CancelImportButton";
import { ImportProgress } from "@/components/workbench/ImportProgress";
import { OrderFilesAddDialog, formatFileSize } from "./OrderFilesAddDialog";
import { OrderDataSourceChoices } from "./OrderDataSourceChoices";
import type { OrderDataFile, OrderDataFileReadSet, OrderDataFilesInventory } from "@/lib/orders/data-files-types";

interface ImportJob {
  id: string;
  status: string;
  phase: string | null;
  error: string | null;
  updatedAt: string;
  finishedAt: string | null;
  providerId?: string;
  request?: { sample?: number; accession?: string };
  preview?: { summary?: { label?: string } };
}

function isActiveImport(job: ImportJob) {
  return job.status === "running" || job.status === "queued";
}

const origins: Record<string, string> = {
  external_import: "Public import", cami: "CAMI import", sra: "SRA / ENA import",
  "cami-benchmark": "CAMI import", "ena-fastq-accession": "SRA / ENA import", facility: "Facility sequencing", sequencer: "Sequencer run",
  local_files: "Linked from storage", associate: "Linked from storage", upload: "Uploaded",
  sequencer_ingest: "Sequencer run", pipeline: "Pipeline output", simulated: "Simulated reads",
  manual: "Manually added", legacy: "Existing data", unknown: "Origin not recorded",
};
const processingLabels: Record<string, string> = {
  unknown: "Processing unknown", unprocessed: "Unprocessed reads", raw: "Raw / protected reads", cleaned: "Cleaned / filtered reads",
};

function originLabel(source: string) { return origins[source] ?? source.replaceAll("_", " "); }
function fileStatus(files: OrderDataFile[]) {
  return files.length === 0 ? "Awaiting files" : files.some(file => !file.exists) ? "File unavailable" : "Available";
}
function Status({ children }: { children: string }) {
  return <span className="inline-flex items-center gap-2 text-sm"><span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${children === "Available" ? "bg-emerald-600 dark:bg-emerald-400" : "bg-amber-600 dark:bg-amber-400"}`} />{children}</span>;
}
function FileDetails({ file, downloadHref }: { file: OrderDataFile; downloadHref?: string }) {
  return <div className="space-y-1 text-xs"><p className="break-all font-mono">{file.path}</p><p className="text-muted-foreground">{formatFileSize(file.size)}{file.role ? ` · ${file.role}` : ""}</p>{file.checksum && <p className="break-all text-muted-foreground">Checksum: {file.checksum}</p>}{downloadHref && file.exists && <a href={downloadHref} className="inline-flex items-center gap-1 underline" download><Download className="size-3" aria-hidden="true" />Download {file.role === "single" ? "file" : file.role ?? "file"}</a>}</div>;
}
function ReadSetFiles({ readSet, orderId, index, canSelect, selectPending, onSelect }: {
  readSet: OrderDataFileReadSet; orderId: string; index: number; canSelect: boolean; selectPending: boolean; onSelect: (readSet: OrderDataFileReadSet) => void;
}) {
  return <div className="space-y-2" data-read-set={readSet.id}>
    <div><p className="text-sm font-medium">Read set {index + 1}</p><p className="text-xs text-muted-foreground">{originLabel(readSet.source)}</p></div>
    {readSet.files.map(file => <div key={`${file.role}:${file.path}`} className="flex min-w-0 items-start gap-2 text-sm"><FileText className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-all">{file.name}<span className="ml-2 text-xs text-muted-foreground">{file.role === "single" ? "Single-end" : file.role}</span></span></div>)}
    <details className="text-xs"><summary className="w-fit cursor-pointer text-muted-foreground">Details</summary><div className="mt-3 space-y-3">
      <p>{processingLabels[readSet.processing] ?? readSet.processing}</p>
      {readSet.runAccessionNumber && <p>Accession: {readSet.runAccessionNumber}</p>}
      {readSet.files.map(file => <FileDetails key={`${file.role}:${file.path}`} file={file} downloadHref={`/api/orders/${encodeURIComponent(orderId)}/data-files/download?${new URLSearchParams({ readId: readSet.id, mate: file.role === "R2" ? "2" : "1" })}`} />)}
      {canSelect && readSet.isActive && <p className="text-muted-foreground">Selected for facility processing</p>}
      {readSet.supersededByReadId && <p className="text-muted-foreground">Superseded read set · retained for provenance</p>}
      {canSelect && !readSet.isActive && !readSet.supersededByReadId && <Button type="button" size="sm" variant="outline" disabled={selectPending || fileStatus(readSet.files) !== "Available"} onClick={() => onSelect(readSet)}>{selectPending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : null}Use for facility processing</Button>}
      {Object.keys(readSet.metadata).length > 0 && <details><summary className="cursor-pointer text-muted-foreground">Provenance and processing evidence</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{JSON.stringify(readSet.metadata, null, 2)}</pre></details>}
    </div></details>
  </div>;
}

export function OrderFilesClient({ orderId }: { orderId: string }) {
  const [inventory, setInventory] = useState<OrderDataFilesInventory | null>(null);
  const [error, setError] = useState("");
  const [activityError, setActivityError] = useState("");
  const [jobs, setJobs] = useState<ImportJob[]>([]);
  // Resolve the initial tab once, without overwriting a user's tab selection.
  const [filesView, setFilesView] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);
  const [dialog, setDialog] = useState<{ mode: "storage" | "upload"; sampleId?: string } | null>(null);
  const [selectPending, setSelectPending] = useState<string | null>(null);
  const [notice, setNotice] = useState("");
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function load() {
      try {
        const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/data-files`, { cache: "no-store", signal: controller.signal });
        if (!response.ok) {
          const data = await response.json().catch(() => ({}));
          throw new Error(data.error || "Could not load files. Check your access or try again.");
        }
        const data: OrderDataFilesInventory = await response.json();
        if (controller.signal.aborted) return;
        setInventory(data); setError("");
        let initialView = "samples";
        if (data.order.collectionKey) {
          try {
            const progress = await fetch(`/api/workbench/imports?${new URLSearchParams({ collection: data.order.collectionKey })}`, { cache: "no-store", signal: controller.signal });
            if (!progress.ok) throw new Error("Could not refresh import activity. Retrying…");
            const imports = await progress.json();
            const nextJobs: ImportJob[] = imports.jobs ?? [];
            if (!controller.signal.aborted) {
              setJobs(nextJobs); setActivityError("");
              if (nextJobs.some(isActiveImport)) initialView = "activity";
            }
          } catch (e) { if (!controller.signal.aborted) setActivityError(e instanceof Error ? e.message : "Could not refresh import activity."); }
        } else { setJobs([]); setActivityError(""); }
        if (!controller.signal.aborted) setFilesView(current => current ?? initialView);
      } catch (e) { if (!controller.signal.aborted) setError(e instanceof Error ? e.message : "Could not load files."); }
      finally { if (!controller.signal.aborted) timer = setTimeout(load, 5000); }
    }
    void load();
    return () => { controller.abort(); if (timer) clearTimeout(timer); };
  }, [orderId, revision]);

  async function selectReadSet(readSet: OrderDataFileReadSet) {
    setSelectPending(readSet.id); setNotice("");
    try {
      const response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/data-files/selection`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sampleId: readSet.sampleId, readId: readSet.id }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not select these files for facility processing.");
      setNotice("Read set selected for facility processing."); refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not select these files."); }
    finally { setSelectPending(null); }
  }

  const orderName = inventory?.order.name || "Sequencing data";
  const activeImportCount = jobs.filter(isActiveImport).length;
  const canSelect = Boolean(inventory?.canManageFacility && inventory.order.dataOrigin !== "import");
  const canImport = Boolean(inventory?.canManage && inventory.order.dataOrigin === "import" && inventory.order.collectionKey);
  const allFiles = inventory ? [
    ...inventory.readSets.flatMap(readSet => readSet.files.map(file => ({ id: `read:${readSet.id}:${file.role}:${file.path}`, sampleId: readSet.sampleId, source: originLabel(readSet.source), file, readSet }))),
    ...inventory.artifacts.map(artifact => ({ id: `artifact:${artifact.id}`, sampleId: artifact.sampleId, source: `${originLabel(artifact.source)} · ${artifact.type.replaceAll("_", " ")}`, file: artifact.file, readSet: null })),
    ...inventory.streams.flatMap(stream => stream.files.filter(item => !inventory.readSets.some(readSet => readSet.files.some(file => file.path === item.file.path))).map(item => ({ id: `stream:${stream.id}:${item.id}`, sampleId: item.sampleId, source: "Recent stream file", file: item.file, readSet: null }))),
  ] : [];
  function downloadHref(item: typeof allFiles[number]) {
    if (item.readSet) return `/api/orders/${encodeURIComponent(orderId)}/data-files/download?${new URLSearchParams({ readId: item.readSet.id, mate: item.file.role === "R2" ? "2" : "1" })}`;
    if (item.id.startsWith("artifact:")) return `/api/orders/${encodeURIComponent(orderId)}/data-files/download?${new URLSearchParams({ artifactId: item.id.slice("artifact:".length) })}`;
    return undefined;
  }

  function addMenu(sampleId?: string) {
    if (!inventory?.canManage) return null;
    const label = sampleId ? "Add files" : "Add data";
    return (
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            type="button"
            variant={sampleId ? "ghost" : "default"}
            size={sampleId ? "sm" : "default"}
            aria-label={sampleId ? `Add files to ${inventory.samples.find(sample => sample.id === sampleId)?.sampleId ?? "sample"}` : label}
          >
            <Plus className="size-4" aria-hidden="true" />{label}<ChevronDown className="size-4" aria-hidden="true" />
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuItem disabled={!inventory.storageConfigured} onSelect={() => setDialog({ mode: "storage", sampleId })}>
            <FolderOpen className="size-4" aria-hidden="true" />Use existing files{!inventory.storageConfigured ? " (storage unavailable)" : ""}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={() => setDialog({ mode: "upload", sampleId })}>
            <Upload className="size-4" aria-hidden="true" />Upload files
          </DropdownMenuItem>
          {!sampleId && inventory.sequencingSourceEnabled && canSelect && (
            <DropdownMenuItem asChild>
              <Link href={`/orders/${orderId}/sequencing?view=stream`}><RadioTower className="size-4" aria-hidden="true" />Connect a sequencer</Link>
            </DropdownMenuItem>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
    );
  }

  return <PageContainer maxWidth="full"><div className="space-y-6">
    <div className="flex flex-wrap items-start justify-between gap-4"><div><h1 className="text-xl font-semibold">Files</h1><p className="mt-1 text-sm text-muted-foreground">{orderName}</p></div><div className="flex flex-wrap items-center gap-2">
      {canSelect && <Button type="button" variant="outline" asChild><Link href={`/orders/${orderId}/sequencing`}>Facility processing</Link></Button>}
      {inventory && !canImport && addMenu()}
    </div></div>
    {error && <div role="alert" className="flex flex-wrap items-center gap-3 text-sm text-destructive"><p>{error}</p><Button type="button" size="sm" variant="outline" onClick={refresh}><RefreshCw className="size-4" aria-hidden="true" />Retry</Button></div>}
    {notice && <p role="status" className="text-sm">{notice}</p>}
    {!inventory && !error && <div role="status" aria-label="Loading files" className="space-y-3">{[0, 1, 2].map(index => <Skeleton key={index} className="h-16 w-full motion-reduce:animate-none" />)}</div>}
    {canImport && inventory?.order.collectionKey && <OrderDataSourceChoices collection={{ key: inventory.order.collectionKey, name: orderName }} orderId={orderId} storageConfigured={inventory.storageConfigured} onAddFiles={mode => setDialog({ mode })} />}
    {inventory && <Tabs value={filesView ?? "samples"} onValueChange={setFilesView} className={canImport ? "border-t pt-6" : undefined}>
      {canImport && <h2 className="mb-2 font-semibold">Collection files</h2>}
      <TabsList aria-label="Files view" className="h-auto min-h-9 max-w-full flex-wrap justify-start">
        <TabsTrigger value="samples" onClick={() => setFilesView("samples")}>By sample</TabsTrigger>
        <TabsTrigger value="all" onClick={() => setFilesView("all")}>All files</TabsTrigger>
        <TabsTrigger value="activity" onClick={() => setFilesView("activity")}>
          Activity{" "}
          {activeImportCount > 0 && <span className="inline-flex items-center gap-1.5 rounded-full bg-teal-100 px-2 py-0.5 text-xs font-medium tabular-nums text-teal-800 dark:bg-teal-950 dark:text-teal-200" title={`${activeImportCount} ${activeImportCount === 1 ? "import is" : "imports are"} running or queued`}>
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-teal-600 motion-safe:animate-pulse dark:bg-teal-400" />
            {activeImportCount} in progress
          </span>}
        </TabsTrigger>
      </TabsList>
      <TabsContent value="samples" className="mt-3">
        {inventory.samples.length === 0 ? <div className="space-y-2 py-8"><h2 className="font-medium">No samples or files yet</h2><p className="text-sm text-muted-foreground">{inventory.canManage ? (canImport ? "Choose a source above to add samples and files to this collection." : "Use existing files or upload reads. Match files to a sample during review.") : inventory.order.dataOrigin === "import" ? "Files will appear here when an import has finished." : "Files will appear here when the facility releases your results."}</p></div> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] table-fixed text-left text-sm"><colgroup><col className="w-[24%]" /><col className="w-[53%]" /><col className="w-[23%]" /></colgroup><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-3 pr-4 font-normal">Sample</th><th className="p-3 font-normal">Files</th><th className="py-3 pl-4 font-normal">Status</th></tr></thead><tbody>{inventory.samples.map(sample => {
          const sets = inventory.readSets.filter(readSet => readSet.sampleId === sample.id);
          const extraFiles = allFiles.filter(item => item.sampleId === sample.id && !item.readSet);
          const files = [...sets.flatMap(set => set.files), ...extraFiles.map(item => item.file)];
          return <tr key={sample.id} className="border-b align-top"><td className="py-5 pr-4"><p className="break-words font-medium">{sample.sampleId}</p>{sample.sampleTitle && <p className="mt-1 break-words text-xs text-muted-foreground">{sample.sampleTitle}</p>}</td><td className="space-y-5 p-5 pl-3">
            {sets.map((readSet, index) => <ReadSetFiles key={readSet.id} readSet={readSet} orderId={orderId} index={index} canSelect={canSelect} selectPending={selectPending === readSet.id} onSelect={readSet => void selectReadSet(readSet)} />)}
            {extraFiles.map(item => <div key={item.id} className="space-y-1"><p className="break-all">{item.file.name}</p><p className="text-xs text-muted-foreground">{item.source}</p><details><summary className="w-fit cursor-pointer text-xs text-muted-foreground">Details</summary><FileDetails file={item.file} downloadHref={downloadHref(item)} /></details></div>)}
            {files.length === 0 && <p className="text-muted-foreground">{!inventory.canManage && inventory.order.dataOrigin !== "import" ? "Awaiting released files" : "No files associated"}</p>}
          </td><td className="space-y-3 py-5 pl-4"><Status>{fileStatus(files)}</Status>{inventory.canManage && <div>{addMenu(sample.id)}</div>}</td></tr>;
        })}</tbody></table></div>}
        {inventory.artifacts.some(artifact => !artifact.sampleId) && <p className="mt-4 text-sm text-muted-foreground">Collection-level files are listed in All files.</p>}
      </TabsContent>
      <TabsContent value="all" className="mt-3"><p className="mb-3 text-xs text-muted-foreground">Files in {orderName}</p>{allFiles.length === 0 ? <p className="py-8 text-sm text-muted-foreground">{inventory.canManage ? "No files yet. Add data to this collection to get started." : "No files have been made available yet."}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-3 pr-4 font-normal">File</th><th className="p-3 font-normal">Sample</th><th className="p-3 font-normal">Status</th></tr></thead><tbody>{allFiles.map(item => <tr key={item.id} className="border-b align-top"><td className="max-w-md py-4 pr-4"><p className="break-all">{item.file.name}</p><p className="mt-1 text-xs text-muted-foreground">{item.source}{item.file.role ? ` · ${item.file.role}` : ""}</p><details className="mt-2"><summary className="w-fit cursor-pointer text-xs text-muted-foreground">Details</summary><div className="mt-2"><FileDetails file={item.file} downloadHref={downloadHref(item)} />{item.readSet && <p className="mt-2 text-xs">{processingLabels[item.readSet.processing] ?? item.readSet.processing}</p>}</div></details></td><td className="p-4">{inventory.samples.find(sample => sample.id === item.sampleId)?.sampleId ?? (item.sampleId ? "Sample unavailable" : "Collection file")}</td><td className="p-4"><Status>{fileStatus([item.file])}</Status></td></tr>)}</tbody></table></div>}</TabsContent>
      <TabsContent value="activity" className="mt-3 space-y-5">
        {activityError && <p role="alert" className="text-sm text-destructive">{activityError}</p>}
        {jobs.length > 0 && <><p className="text-sm text-muted-foreground">Imports run on the SeqDesk server. You can leave this page and return later.</p><div className="overflow-x-auto"><table className="w-full min-w-[560px] text-left text-sm"><thead><tr className="border-b text-xs text-muted-foreground"><th className="py-3 pr-4 font-normal">Import</th><th className="p-3 font-normal">Progress</th><th className="p-3 font-normal">Last update</th><th className="p-3 font-normal">Actions</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id} className="border-b align-top"><td className="py-4 pr-4">{job.request?.sample != null ? `sample_${job.request.sample}` : job.request?.accession ?? job.preview?.summary?.label ?? "Import"}</td><td className="p-4">{job.error ? <p className="text-destructive">{job.error}</p> : <ImportProgress status={job.status} phase={job.phase} source={(job.providerId === "sra" || job.providerId === "ena-fastq-accession") ? "sra" : "cami"} />}{job.status === "running" && Date.now() - Date.parse(job.updatedAt) > 60000 && <p className="mt-2 text-xs text-muted-foreground">No recent update; the server may still be processing.</p>}</td><td className="p-4 text-xs text-muted-foreground">{new Date(job.finishedAt ?? job.updatedAt).toLocaleString()}</td><td className="p-4">{inventory.canManage && <CancelImportButton jobId={job.id} status={job.status} phase={job.phase} />}</td></tr>)}</tbody></table></div></>}
        {inventory.streams.length > 0 && <section aria-label="Sequencer activity" className="space-y-3"><h2 className="text-sm font-medium">Sequencer activity</h2>{inventory.streams.map(stream => <div key={stream.id} className="flex flex-wrap items-center justify-between gap-3 border-b pb-3 text-sm"><div><p>{stream.status.replaceAll("_", " ")} · {stream.files.length} recent file{stream.files.length === 1 ? "" : "s"}</p><p className="mt-1 text-xs text-muted-foreground">{stream.startedAt ? new Date(stream.startedAt).toLocaleString() : "Start time unavailable"}</p></div>{inventory.canManageFacility && <Button size="sm" variant="outline" asChild><Link href={`/orders/${orderId}/sequencing?view=stream`}>View live sequencer</Link></Button>}</div>)}</section>}
        {jobs.length === 0 && inventory.streams.length === 0 && <p className="py-8 text-sm text-muted-foreground">No import or sequencer activity for this collection.</p>}
        {canSelect && (inventory.sequencingSourceEnabled || inventory.streams.length > 0) && <Button variant="outline" size="sm" asChild><Link href={`/orders/${orderId}/sequencing?view=stream`}><RadioTower className="size-4" aria-hidden="true" />Live sequencer</Link></Button>}
      </TabsContent>
    </Tabs>}
    {dialog && inventory && <OrderFilesAddDialog key={`${dialog.mode}:${dialog.sampleId ?? "all"}`} orderId={orderId} orderName={orderName} samples={inventory.samples} mode={dialog.mode} preselectedSampleId={dialog.sampleId} uploadLimitBytes={inventory.uploadLimitBytes} onClose={() => setDialog(null)} onSaved={() => { setNotice("Files added to the collection."); refresh(); }} />}
  </div></PageContainer>;
}
