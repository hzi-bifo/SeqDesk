"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Loader2, RotateCcw, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MAX_LIBRARY_FILE_BYTES } from "@/lib/files/library-types";

interface UploadItem {
  id: number;
  file: File;
  status: "queued" | "uploading" | "saved" | "failed";
  error?: string;
  retryable?: boolean;
}

/** Keep each outcome visible so a partial failure never asks users to upload the whole batch again. */
export function FileUploadPanel({ targetKey, onSaved, onStart, onBusyChange }: {
  targetKey: string;
  onSaved: () => Promise<unknown>;
  onStart: () => void;
  onBusyChange: (busy: boolean) => void;
}) {
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(false);
  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; controller.current?.abort(); onBusyChange(false); };
  }, [onBusyChange]);

  useEffect(() => {
    if (!busy) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ""; };
    window.addEventListener("beforeunload", beforeUnload);
    return () => window.removeEventListener("beforeunload", beforeUnload);
  }, [busy]);

  const run = async (batch: UploadItem[], retry = false) => {
    if (!batch.length || controller.current) return;
    const active = new AbortController();
    controller.current = active;
    setBusy(true); onBusyChange(true); onStart();
    setItems((current) => retry
      ? current.map((item) => batch.some((entry) => entry.id === item.id) ? { ...item, status: "queued", error: undefined } : item)
      : [...current, ...batch]);
    const update = (id: number, changes: Partial<UploadItem>) => {
      if (mounted.current) setItems((current) => current.map((item) => item.id === id ? { ...item, ...changes } : item));
    };
    try {
      for (const item of batch) {
        if (active.signal.aborted) break;
        if (item.file.size > MAX_LIBRARY_FILE_BYTES) {
          update(item.id, { status: "failed", error: "Larger than 100 MB. Choose a smaller file.", retryable: false });
          continue;
        }
        update(item.id, { status: "uploading", error: undefined });
        const form = new FormData(); form.set("targetKey", targetKey); form.set("file", item.file);
        try {
          const response = await fetch("/api/files/library", { method: "POST", body: form, signal: active.signal });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok) {
            update(item.id, { status: "failed", error: payload.error || (response.status === 413 ? "The server rejected this file as too large." : `Upload failed (${response.status}).`), retryable: response.status >= 500 || response.status === 429 });
            continue;
          }
          update(item.id, { status: "saved", retryable: false });
          // A refresh failure must not turn an upload that succeeded into a failed one.
          if (!active.signal.aborted) await Promise.allSettled([Promise.resolve().then(onSaved)]);
        } catch {
          if (active.signal.aborted) break;
          update(item.id, { status: "failed", error: "Connection interrupted. Check Files before retrying if the upload may have finished.", retryable: true });
        }
      }
    } finally {
      controller.current = null;
      if (mounted.current) { setBusy(false); onBusyChange(false); }
    }
  };
  const add = (files: File[]) => void run(files.map((file) => ({ id: ++sequence.current, file, status: "queued" })));
  const failed = items.filter((item) => item.status === "failed");
  const retryable = failed.filter((item) => item.retryable);
  const saved = items.filter((item) => item.status === "saved").length;

  return <section className="mt-4 space-y-3" aria-label="Upload files">
    <div
      className={`flex flex-wrap items-center justify-between gap-3 rounded-lg border border-dashed p-4 ${dragging ? "border-primary bg-secondary" : "bg-card"}`}
      onDragOver={(event) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = busy ? "none" : "copy"; if (!busy) setDragging(true); } }}
      onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragging(false); }}
      onDrop={(event) => { event.preventDefault(); setDragging(false); if (!busy) add(Array.from(event.dataTransfer.files)); }}
    >
      <div><p className="text-sm font-medium">Drop files here or choose them from your computer</p><p className="mt-1 text-xs text-muted-foreground">All file types · Up to 100 MB each</p></div>
      <Button onClick={() => inputRef.current?.click()} disabled={busy}><Upload className="mr-2 h-4 w-4" />Upload files</Button>
      <input ref={inputRef} type="file" multiple className="hidden" aria-label="Choose files to upload" disabled={busy} onChange={(event) => { add(Array.from(event.target.files ?? [])); event.target.value = ""; }} />
    </div>
    {items.length > 0 && <div className="rounded-lg border p-3" aria-label="Upload results">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p role="status" className="text-sm">{busy ? "Uploading… " : "Uploads finished. "}{saved} saved{failed.length ? ` · ${failed.length} failed` : ""} · {items.length} total</p>
        <div className="flex gap-2">
          {retryable.length > 0 && <Button variant="outline" size="sm" disabled={busy} onClick={() => void run(retryable, true)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Retry failed</Button>}
          <Button variant="ghost" size="sm" disabled={busy} onClick={() => setItems([])}>Clear list</Button>
        </div>
      </div>
      {busy && <p className="mt-1 text-xs text-muted-foreground">Keep this page open until uploads finish. Saved files appear below as they complete.</p>}
      <ul className="mt-2 max-h-48 space-y-2 overflow-y-auto text-sm">{items.map((item) => <li key={item.id} className="flex items-start gap-2">
        {item.status === "uploading" ? <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin" /> : item.status === "saved" ? <Check className="mt-0.5 h-4 w-4 shrink-0 text-green-600" /> : <span className="mt-1 h-3 w-4 shrink-0" />}
        <div className="min-w-0"><p className="break-all">{item.file.name} <span className={item.status === "failed" ? "text-destructive" : "text-muted-foreground"}>— {item.status === "saved" ? "Saved in Files" : item.status === "failed" ? "Failed" : item.status === "uploading" ? "Uploading" : "Waiting"}</span></p>{item.error && <p className="text-xs text-destructive">{item.error}</p>}</div>
      </li>)}</ul>
    </div>}
  </section>;
}
