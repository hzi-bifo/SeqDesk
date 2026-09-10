"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileText, Folder, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  createReadSetDrafts,
  isReadFile,
  readSetLinkRequest,
  validateReadSetDraft,
  type MatchingFile,
  type ReadSetDraft,
} from "@/lib/orders/data-files-matching";
import type {
  OrderDataFilesLinkResult,
  OrderDataFilesProcessing,
  OrderDataFilesSample,
  OrderDataFilesStorage,
} from "@/lib/orders/data-files-types";

const UPLOAD_LIMIT = 64 * 1024 * 1024;
const selectClass = "h-9 min-w-0 rounded-md border border-input bg-background px-2 text-sm";

export function formatFileSize(bytes: number | null) {
  if (bytes === null) return "Size unavailable";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GiB`;
}

async function responseData<T>(response: Response, fallback: string): Promise<T> {
  let data: T & { error?: string };
  try { data = await response.json(); } catch { throw new Error(fallback); }
  if (!response.ok) throw new Error(data.error || fallback);
  return data;
}

export function OrderFilesAddDialog({
  orderId,
  orderName,
  samples,
  mode,
  preselectedSampleId,
  uploadLimitBytes = UPLOAD_LIMIT,
  onClose,
  onSaved,
}: {
  orderId: string;
  orderName: string;
  samples: OrderDataFilesSample[];
  mode: "storage" | "upload";
  preselectedSampleId?: string;
  uploadLimitBytes?: number;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [step, setStep] = useState<"select" | "review">("select");
  const [path, setPath] = useState("");
  const [storage, setStorage] = useState<OrderDataFilesStorage | null>(null);
  const [storageLoading, setStorageLoading] = useState(mode === "storage");
  const [storageError, setStorageError] = useState("");
  const [storageRevision, setStorageRevision] = useState(0);
  const [selected, setSelected] = useState<MatchingFile[]>([]);
  const [drafts, setDrafts] = useState<ReadSetDraft[]>([]);
  const [processing, setProcessing] = useState<OrderDataFilesProcessing>("unknown");
  const [processingNote, setProcessingNote] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [savedCount, setSavedCount] = useState(0);
  const requestIds = useRef(new Map<string, string>());

  useEffect(() => {
    if (mode !== "storage") return;
    const controller = new AbortController();
    setStorageLoading(true);
    setStorageError("");
    fetch(`/api/orders/${encodeURIComponent(orderId)}/data-files/storage?${new URLSearchParams({ path })}`, { signal: controller.signal, cache: "no-store" })
      .then(response => responseData<OrderDataFilesStorage>(response, "Could not browse storage."))
      .then(data => { if (!controller.signal.aborted) setStorage(data); })
      .catch(e => { if (!controller.signal.aborted) setStorageError(e instanceof Error ? e.message : "Could not browse storage."); })
      .finally(() => { if (!controller.signal.aborted) setStorageLoading(false); });
    return () => controller.abort();
  }, [mode, orderId, path, storageRevision]);

  const remaining = drafts.filter(draft => draft.included && !draft.saved);
  const matchingErrors = useMemo(() => drafts.filter(draft => draft.included && !draft.saved).flatMap(validateReadSetDraft), [drafts]);
  const oversized = mode === "upload" && remaining.some(draft => draft.files.reduce((total, file) => total + (file.size ?? 0), 0) > uploadLimitBytes);
  const canSave = remaining.length > 0 && matchingErrors.length === 0 && !oversized && (processing === "unknown" || Boolean(processingNote.trim()));
  const preselected = samples.find(sample => sample.id === preselectedSampleId);
  const currentPath = storage?.path ?? path;
  const currentRoot = storage?.roots.filter(root => !root.path || currentPath === root.path || currentPath.startsWith(`${root.path}/`)).sort((a, b) => b.path.length - a.path.length)[0];
  const canGoUp = Boolean(currentRoot && currentPath !== currentRoot.path);

  function updateDraft(id: string, patch: Partial<ReadSetDraft>) {
    setDrafts(current => current.map(draft => draft.id === id ? { ...draft, ...patch } : draft));
  }

  function review() {
    setError("");
    setDrafts(createReadSetDrafts(selected, samples, preselectedSampleId));
    setStep("review");
  }

  function selectUpload(files: FileList | null) {
    setError("");
    const incoming = [...(files ?? [])];
    if (incoming.some(file => !isReadFile(file.name))) {
      setError("Choose FASTQ files (.fastq, .fq, or .gz). Other file types cannot be linked as read sets.");
      setSelected([]);
      return;
    }
    if (new Set(incoming.map(file => file.name)).size !== incoming.length) {
      setError("These files have duplicate names. Upload them in separate read sets so each file can be identified.");
      setSelected([]);
      return;
    }
    setSelected(incoming.map(file => ({ path: file.name, name: file.name, size: file.size, upload: file })));
  }

  async function save() {
    if (pending || !canSave) return;
    setPending(true);
    setError("");
    let completed = 0;
    const createdSamples = new Map<string, string>();
    try {
      for (const draft of remaining) {
        const payload = readSetLinkRequest(draft, processing, processingNote);
        const newIdentifier = payload.newSample?.sampleId;
        if (newIdentifier && createdSamples.has(newIdentifier)) {
          payload.sampleId = createdSamples.get(newIdentifier)!;
          delete payload.newSample;
        }
        // The target may switch from newSample to sampleId after an earlier lane
        // creates it. Use fixed field order so that a lost-response retry keeps
        // the same identity even after that in-memory conversion.
        const requestKey = JSON.stringify({
          draftId: draft.id,
          sampleId: payload.sampleId,
          newSample: payload.newSample,
          read1: payload.read1,
          read2: payload.read2,
          processing: payload.processing,
          processingNote: payload.processingNote,
          files: draft.files.map(file => ({ path: file.path, size: file.size, modified: file.upload?.lastModified })),
        });
        if (!requestIds.current.has(requestKey)) requestIds.current.set(requestKey, crypto.randomUUID());
        payload.requestId = requestIds.current.get(requestKey)!;
        let response: Response;
        if (mode === "upload") {
          const body = new FormData();
          const file1 = draft.files.find(file => file.path === draft.read1)?.upload;
          const file2 = draft.files.find(file => file.path === draft.read2)?.upload;
          if (!file1 || (draft.layout === "paired" && !file2)) throw new Error("The selected local files are no longer available. Select them again.");
          body.set("file1", file1);
          body.set("requestId", payload.requestId);
          if (draft.layout === "paired" && file2) body.set("file2", file2);
          if (payload.sampleId) body.set("sampleId", payload.sampleId);
          if (payload.newSample) body.set("newSample", JSON.stringify(payload.newSample));
          body.set("processing", processing);
          if (payload.processingNote) body.set("processingNote", payload.processingNote);
          response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/data-files/upload`, { method: "POST", body });
        } else {
          response = await fetch(`/api/orders/${encodeURIComponent(orderId)}/data-files`, {
            method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload),
          });
        }
        const result = await responseData<OrderDataFilesLinkResult>(response, "Could not add this read set.");
        if (newIdentifier) createdSamples.set(newIdentifier, result.sampleId);
        completed += 1;
        setSavedCount(count => count + 1);
        setDrafts(current => current.map(item => {
          if (item.id === draft.id) return { ...item, saved: true };
          if (newIdentifier && item.sampleId === "new" && item.newSampleIdentifier.trim() === newIdentifier) return { ...item, sampleId: result.sampleId };
          return item;
        }));
      }
      onSaved();
      onClose();
    } catch (e) {
      setError(`${e instanceof Error ? e.message : "Could not add files."}${completed ? ` ${completed} read set${completed === 1 ? " was" : "s were"} saved; retry adds only the remaining sets.` : ""}`);
      if (completed) onSaved();
    } finally { setPending(false); }
  }

  return <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl" onInteractOutside={event => { if (pending) event.preventDefault(); }} onEscapeKeyDown={event => { if (pending) event.preventDefault(); }}>
      <DialogHeader>
        <DialogTitle>{step === "review" ? "Review file matching" : mode === "storage" ? "Use existing files" : "Upload files"}</DialogTitle>
        <DialogDescription>{orderName}{preselected ? ` · ${preselected.sampleId}` : ""}. {step === "review" ? "Each group is saved as a separate read set for its sample." : mode === "storage" ? "Choose files from storage you can access. Files stay in their current location." : `Choose FASTQ files from your computer. Up to ${formatFileSize(uploadLimitBytes)} per read set; use existing storage for larger files.`}</DialogDescription>
      </DialogHeader>

      {step === "select" ? <div className="space-y-4">
        {mode === "storage" ? <>
          {storage?.roots.length ? <div className="flex flex-wrap gap-2" aria-label="Accessible storage locations">{storage.roots.map(root => <Button key={root.path} type="button" variant="outline" size="sm" onClick={() => setPath(root.path)}><Folder className="size-4" aria-hidden="true" />{root.label}</Button>)}</div> : null}
          <div className="flex flex-wrap items-center gap-2">
            {canGoUp && <Button type="button" variant="ghost" size="sm" onClick={() => setPath(currentPath.includes("/") ? currentPath.slice(0, currentPath.lastIndexOf("/")) : "")}><ArrowLeft className="size-4" aria-hidden="true" />Up one folder</Button>}
            <span className="break-all text-sm text-muted-foreground">{storage?.path || "Accessible storage"}</span>
          </div>
          {storageLoading && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading storage…</p>}
          {storageError && <div role="alert" className="space-y-2 text-sm text-destructive"><p>{storageError}</p><Button type="button" size="sm" variant="outline" onClick={() => setStorageRevision(value => value + 1)}>Retry storage</Button></div>}
          {!storageLoading && !storageError && <div className="max-h-72 overflow-auto rounded-md border">
            {storage?.entries.length ? <table className="w-full text-left text-sm"><thead className="sticky top-0 bg-background"><tr><th className="p-3 font-medium">File or folder</th><th className="p-3 text-right font-medium">Size</th></tr></thead><tbody>{storage.entries.map(entry => <tr key={entry.path} className="border-t">
              <td className="p-3">{entry.type === "directory" ? <button type="button" className="flex items-center gap-2 text-left hover:underline" onClick={() => setPath(entry.path)}><Folder className="size-4 shrink-0" aria-hidden="true" /><span className="break-all">{entry.name}</span></button> : <label className="flex items-center gap-2"><input type="checkbox" className="size-4" aria-label={`Select ${entry.name}`} disabled={!isReadFile(entry.name)} checked={selected.some(file => file.path === entry.path)} onChange={event => setSelected(current => event.target.checked ? [...current, { path: entry.path, name: entry.name, size: entry.size }] : current.filter(file => file.path !== entry.path))} /><FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" /><span className="break-all">{entry.name}</span></label>}</td>
              <td className="whitespace-nowrap p-3 text-right text-muted-foreground">{entry.type === "file" ? formatFileSize(entry.size) : "—"}</td>
            </tr>)}</tbody></table> : <p className="p-4 text-sm text-muted-foreground">No files in this location. Choose another accessible folder or upload files from your computer.</p>}
          </div>}
          {storage?.truncated && <p className="text-sm text-muted-foreground">This folder has more entries than can be displayed. Choose a more specific subfolder.</p>}
        </> : <label className="block space-y-2"><span className="text-sm font-medium">FASTQ files</span><Input type="file" multiple accept=".fastq,.fq,.fastq.gz,.fq.gz" onChange={event => selectUpload(event.target.files)} /></label>}
        {selected.length > 0 && <div className="space-y-2"><p className="text-sm font-medium">{selected.length} file{selected.length === 1 ? "" : "s"} selected</p><ul className="max-h-32 space-y-1 overflow-auto text-sm text-muted-foreground">{selected.map(file => <li key={file.path} className="flex items-center justify-between gap-2"><span className="break-all">{file.name}</span><button type="button" className="shrink-0 underline" aria-label={`Remove ${file.name}`} onClick={() => setSelected(current => current.filter(item => item.path !== file.path))}>Remove</button></li>)}</ul></div>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex justify-end gap-2"><Button type="button" variant="outline" onClick={onClose}>Cancel</Button><Button type="button" disabled={selected.length === 0} onClick={review}>Review matching</Button></div>
      </div> : <div className="space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Button type="button" variant="ghost" size="sm" disabled={pending || savedCount > 0} onClick={() => setStep("select")}><ArrowLeft className="size-4" aria-hidden="true" />Change selected files</Button>
          {selected.length === 2 && drafts.length === 2 && savedCount === 0 && <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setDrafts([{ ...drafts[0], id: "manual-pair", files: selected, layout: "paired", read1: selected[0].path, read2: selected[1].path, ambiguous: false }])}>Treat these files as one pair</Button>}
        </div>
        <div className="divide-y rounded-md border">{drafts.map((draft, index) => {
          const issues = validateReadSetDraft(draft);
          return <section key={draft.id} aria-label={`Read set ${index + 1}`} className="space-y-3 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3"><label className="flex items-center gap-2 text-sm font-medium"><input type="checkbox" checked={draft.included} disabled={pending || draft.saved} onChange={event => updateDraft(draft.id, { included: event.target.checked })} />Read set {index + 1}</label>{draft.saved && <span className="text-sm">Saved</span>}</div>
            <fieldset disabled={!draft.included || pending || draft.saved} className="grid min-w-0 gap-4 md:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <label className="flex items-center gap-2 text-sm"><span>Read layout</span><select className={selectClass} aria-label={`Read layout for set ${index + 1}`} value={draft.layout} onChange={event => updateDraft(draft.id, { layout: event.target.value as "paired" | "single" })}><option value="paired">Paired-end</option><option value="single">Single-end / long reads</option></select></label>
                {(draft.layout === "paired" ? ["R1", "R2"] : ["Read file"]).map((role, roleIndex) => <label key={role} className="grid grid-cols-[4rem_minmax(0,1fr)] items-center gap-2 text-sm"><span>{role}</span><select className={`${selectClass} w-full`} aria-label={`${role} for set ${index + 1}`} value={roleIndex === 0 ? draft.read1 : draft.read2} onChange={event => updateDraft(draft.id, { [roleIndex === 0 ? "read1" : "read2"]: event.target.value })}><option value="">Choose file</option>{draft.files.map(file => <option key={file.path} value={file.path}>{file.name}</option>)}</select></label>)}
                <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Selected file paths</summary>{draft.files.map(file => <p key={file.path} className="mt-1 break-all">{file.path} · {formatFileSize(file.size)}</p>)}</details>
              </div>
              <div className="min-w-0 space-y-2"><label className="block space-y-1 text-sm"><span>Destination sample</span><select className={`${selectClass} w-full`} aria-label={`Destination sample for set ${index + 1}`} value={draft.sampleId} onChange={event => updateDraft(draft.id, { sampleId: event.target.value })}><option value="">Choose sample</option>{samples.map(sample => <option key={sample.id} value={sample.id}>{sample.sampleId}{sample.sampleTitle ? ` · ${sample.sampleTitle}` : ""}</option>)}{draft.sampleId && draft.sampleId !== "new" && !samples.some(sample => sample.id === draft.sampleId) && <option value={draft.sampleId}>{draft.newSampleIdentifier}</option>}<option value="new">Create a new sample</option></select></label>
                {draft.sampleId === "new" && <><label className="block space-y-1 text-sm"><span>New sample identifier</span><Input aria-label={`New sample identifier for set ${index + 1}`} value={draft.newSampleIdentifier} maxLength={200} onChange={event => updateDraft(draft.id, { newSampleIdentifier: event.target.value })} /></label><label className="block space-y-1 text-sm"><span>Sample title (optional)</span><Input value={draft.newSampleTitle} maxLength={500} onChange={event => updateDraft(draft.id, { newSampleTitle: event.target.value })} /></label></>}
              </div>
            </fieldset>
            {draft.included && !draft.saved && issues.length > 0 && <ul className="space-y-1 text-sm text-amber-700 dark:text-amber-400" aria-label={`Matching issues for set ${index + 1}`}>{issues.map(issue => <li key={issue}>{issue}</li>)}</ul>}
          </section>;
        })}</div>
        <details className="space-y-3 text-sm"><summary className="cursor-pointer text-muted-foreground">Processing history · {processing === "unknown" ? "unknown" : processing}</summary><p className="text-muted-foreground">File origin does not establish whether reads were cleaned. Record only processing you can substantiate.</p><label className="block space-y-1"><span>Processing state</span><select className={`${selectClass} block w-full`} aria-label="Processing state" disabled={pending} value={processing} onChange={event => setProcessing(event.target.value as OrderDataFilesProcessing)}><option value="unknown">Unknown</option><option value="unprocessed">Unprocessed reads</option><option value="cleaned">Cleaned / filtered reads</option></select></label><label className="block space-y-1"><span>Processing evidence{processing !== "unknown" ? " (required)" : " (optional)"}</span><Input value={processingNote} maxLength={2000} disabled={pending} onChange={event => setProcessingNote(event.target.value)} /></label></details>
        {oversized && <p role="alert" className="text-sm text-destructive">A read set exceeds the {formatFileSize(uploadLimitBytes)} upload limit. Place larger files in accessible server storage, then use existing files.</p>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4"><p className="text-sm text-muted-foreground">{remaining.length} read set{remaining.length === 1 ? "" : "s"} to add{savedCount > 0 ? ` · ${savedCount} saved` : ""}</p><div className="flex gap-2"><Button type="button" variant="outline" disabled={pending} onClick={onClose}>Cancel</Button><Button type="button" disabled={pending || !canSave} onClick={() => void save()}>{pending ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />Saving files…</> : mode === "upload" ? "Upload and associate" : "Confirm file links"}</Button></div></div>
      </div>}
    </DialogContent>
  </Dialog>;
}
