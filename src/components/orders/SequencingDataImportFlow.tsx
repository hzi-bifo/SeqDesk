"use client";

import { useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
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
    <div><h1 className="text-lg font-semibold">{needsName || newEntry ? "Add sequencing data" : "Data source"}</h1><p className="mt-1 text-sm text-muted-foreground">Name your sequencing data, choose a source, then import or submit samples. Organize them into studies when you are ready.</p></div>
    {needsName ? <form className="space-y-4 rounded-lg border bg-card p-5" onSubmit={async event => {
      event.preventDefault();
      if (saving) return;
      draftKey.current ??= crypto.randomUUID();
      const next = importCollectionSchema.safeParse({ key: draftKey.current, name });
      if (!next.success) { setError("Enter a sequencing data name (1–500 characters)."); return; }
      setSaving(true); setError("");
      try {
        const response = await fetch("/api/workbench/collections", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(next.data) });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "Could not save collection");
        const query = new URLSearchParams({ name: result.name ?? next.data.name, collection: next.data.key });
        if (result.id) query.set("orderId", result.id);
        if (selected && !editing) query.set("source", selected);
        setEditing(false); draftKey.current = null;
        router.push(`/orders/import?${query}`);
      } catch (e) { setError(e instanceof Error ? e.message : "Could not save collection"); }
      finally { setSaving(false); }
    }}>
      <label className="block space-y-2"><span className="text-sm font-medium">Sequencing data name</span><Input autoFocus required maxLength={500} value={name} onChange={event => setName(event.target.value)} placeholder="e.g. Marine benchmark comparison" /></label>
      <p className="text-sm text-muted-foreground">This names your collection of samples and read files—not a study or an instrument run. Continuing saves the collection immediately, even before you choose a source or download files.</p>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={saving}>{saving ? "Saving collection…" : selected && !editing ? "Continue to import module" : "Choose data source"}</Button>
      {editing && <Button type="button" variant="ghost" onClick={() => setEditing(false)}>Cancel</Button>}
    </form> : <>
      {collection && <div className="flex min-w-0 items-center justify-between gap-4 rounded-lg border bg-muted/30 p-4"><div className="min-w-0"><p className="text-xs text-muted-foreground">Sequencing data collection</p><p className="break-words font-medium">{collection.name}</p></div><Button className="shrink-0" variant="ghost" onClick={() => { setName(collection.name); setEditing(true); }}>Start another collection</Button></div>}
      {selected && collection ? <>
        <Link className="inline-block text-sm underline" href={storeHref}>Back to import module store</Link>
        {moduleEnabled ? <WorkbenchImportsClient key={`${selected}:${collection.key}:${collection.name}`} source={selected} collection={collection} onCollectionReady={orderId => router.push(`/orders/${orderId}/samples-files`)} /> : <p>This import module is disabled. Ask an administrator to enable it in Modules.</p>}
      </> : <RawDataSources collection={collection} orderId={params.get("orderId") ?? undefined} />}
    </>}
  </div>;
}
