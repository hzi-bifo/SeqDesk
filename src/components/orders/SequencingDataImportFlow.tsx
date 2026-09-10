"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, FolderOpen, LockKeyhole } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { RawDataSources } from "./RawDataSources";
import { WorkbenchImportsClient } from "@/components/workbench/WorkbenchImportsClient";
import { importCollectionSchema } from "@/lib/workbench/import-collection";

export function SequencingDataImportFlow({ newEntry = false, moduleEnabled = true }: { newEntry?: boolean; moduleEnabled?: boolean }) {
  const params = useSearchParams();
  const router = useRouter();
  const parsed = importCollectionSchema.safeParse({ key: params.get("collection"), name: params.get("name") });
  const collection = parsed.success ? parsed.data : undefined;
  const source = params.get("source");
  const selected = source === "cami" || source === "sra" ? source : undefined;
  const [name, setName] = useState(collection?.name ?? "");
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const draftKey = useRef<string | null>(null);
  const needsName = editing || (!collection && (newEntry || Boolean(selected)));
  const storeHref = collection ? `/orders/import?${new URLSearchParams({ name: collection.name, collection: collection.key, ...(params.get("orderId") ? { orderId: params.get("orderId")! } : {}) })}` : "/orders/import";

  return <div className="space-y-6">
    <div><h1 className="text-xl font-semibold">{needsName ? "New data collection" : "Import data with SeqDesk"}</h1><p className="mt-1 text-sm text-muted-foreground">{needsName ? "Keep samples and their files together. Start with SeqDesk's import modules, or add existing files and uploads after creating your collection." : "Use import modules such as CAMI and SRA to add samples, files and metadata."}</p></div>
    {needsName ? <form className="space-y-4 rounded-lg border bg-card p-5" onSubmit={async event => {
      event.preventDefault();
      if (saving) return;
      draftKey.current ??= crypto.randomUUID();
      const next = importCollectionSchema.safeParse({ key: draftKey.current, name });
      if (!next.success) { setError("Enter a collection name (1–500 characters)."); return; }
      setSaving(true); setError("");
      try {
        const response = await fetch("/api/workbench/collections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next.data) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not save collection");
        if (!result.id) throw new Error("The collection was not returned. Please retry.");
        const query = new URLSearchParams({ name: result.name ?? next.data.name, collection: next.data.key });
        if (result.id) query.set("orderId", result.id);
        if (selected && !editing) query.set("source", selected);
        setEditing(false); draftKey.current = null;
        router.push(selected && !editing ? `/orders/import?${query}` : `/orders/${result.id}/samples-files`);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not save collection"); }
      finally { setSaving(false); }
    }}>
      <label className="block space-y-2"><span className="text-sm font-medium">Collection name</span><Input autoFocus required maxLength={500} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Marine benchmark comparison" /></label>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? "Saving collection…" : selected && !editing ? "Continue to import module" : "Create collection"}</Button>
      {editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
    </form> : <>
      {collection && <div className="flex min-w-0 flex-wrap items-center justify-between gap-4 rounded-xl border bg-card p-4"><div className="flex min-w-0 items-center gap-3"><span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted/60 text-muted-foreground"><FolderOpen className="size-5" aria-hidden="true" /></span><div className="min-w-0"><p className="text-xs text-muted-foreground">Data collection</p><p className="break-words font-medium">{collection.name}</p></div></div><div className="flex flex-wrap gap-2">{params.get("orderId") && <Button variant="outline" size="sm" asChild><Link href={`/orders/${params.get("orderId")}/samples-files`}>Back to Files</Link></Button>}<Button className="shrink-0" variant="ghost" onClick={() => { setName(""); setEditing(true); }}>New collection</Button></div></div>}
      {selected && collection ? <>
        <Button variant="ghost" size="sm" className="-ml-2 w-fit text-muted-foreground" asChild><Link href={storeHref}><ArrowLeft aria-hidden="true" />Back to import module store</Link></Button>
        {moduleEnabled ? <WorkbenchImportsClient key={`${selected}:${collection.key}:${collection.name}`} source={selected} collection={collection} onCollectionReady={orderId => router.push(`/orders/${orderId}/samples-files`)} /> : <div className="flex items-start gap-3 rounded-xl border bg-card p-5"><LockKeyhole className="size-5 shrink-0 text-muted-foreground" aria-hidden="true" /><p className="text-sm text-muted-foreground">This import module is disabled. Ask an administrator to enable it in Modules.</p></div>}
      </> : <RawDataSources collection={collection} orderId={params.get("orderId") ?? undefined} />}
    </>}
  </div>;
}
