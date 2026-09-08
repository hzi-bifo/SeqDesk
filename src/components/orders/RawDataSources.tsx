"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, Database, Package, Search, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useModuleEnabled } from "@/lib/modules";
import { importModuleCatalog } from "@/lib/modules/import-catalog";
import type { ImportCollection } from "@/lib/workbench/import-collection";

function sourceHref(source: string, collection?: ImportCollection, orderId?: string) {
  const query = new URLSearchParams({ source });
  if (orderId && source !== "facility") query.set("orderId", orderId);
  if (collection) { query.set("name", collection.name); query.set("collection", collection.key); }
  return `${source === "facility" ? "/orders/new" : "/orders/import"}?${query}`;
}

function ImportModuleCard({ module, collection, orderId }: { module: typeof importModuleCatalog[number]; collection?: ImportCollection; orderId?: string }) {
  const enabled = useModuleEnabled(module.id);
  return <section className="flex min-w-0 flex-col gap-4 rounded-lg border bg-card p-5">
    <div className="flex items-start justify-between gap-2"><Database className="h-6 w-6 text-primary" /><span className="rounded bg-muted px-2 py-1 text-xs">Bundled · {enabled ? "Enabled" : "Disabled"}</span></div>
    <div><p className="mb-1 text-xs text-muted-foreground">{module.category} · Import module</p><h3 className="font-semibold">{module.name}</h3></div>
    <p className="flex-1 text-sm text-muted-foreground">{module.description}</p>
    <div className="flex flex-wrap gap-2">{module.formats.map(format => <span key={format} className="rounded border px-2 py-1 text-xs text-muted-foreground">{format}</span>)}</div>
    {enabled ? <Button variant="outline" asChild><Link href={sourceHref(module.source, collection, orderId)}>Use {module.source === "cami" ? "CAMI" : "SRA / ENA"} module</Link></Button> : <Button variant="outline" disabled>Disabled by administrator</Button>}
  </section>;
}

export function RawDataSources({ collection, orderId }: { collection?: ImportCollection; orderId?: string } = {}) {
  const facility = useModuleEnabled("sequencing-management");
  const [search, setSearch] = useState("");
  const visible = importModuleCatalog.filter(module => `${module.name} ${module.description} ${module.category} ${module.formats.join(" ")}`.toLowerCase().includes(search.trim().toLowerCase()));
  return <div className="space-y-6">
    <section className="flex flex-col gap-4 rounded-lg border bg-card p-5 sm:flex-row sm:items-center">
      <Building2 className="h-6 w-6 shrink-0 text-muted-foreground" />
      <div className="flex-1"><h2 className="font-semibold">Facility sequencing</h2><p className="mt-1 text-sm text-muted-foreground">Submit samples to the facility using the existing sequencing order form.</p></div>
      {facility ? <Button variant="outline" asChild><Link href={sourceHref("facility", collection)}>Use facility sequencing</Link></Button> : <Button variant="outline" disabled>Disabled by administrator</Button>}
    </section>
    <section aria-labelledby="import-store-title" className="space-y-4">
      <div className="flex items-start gap-3"><Store className="mt-1 h-5 w-5 shrink-0" /><div><h2 id="import-store-title" className="font-semibold">Import module store</h2><p className="mt-1 text-sm text-muted-foreground">Choose a module to browse its source, preview files and import raw reads with metadata. All modules add data to the same SeqDesk application.</p></div></div>
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <p className="flex items-center gap-2 text-sm text-muted-foreground"><Package className="h-4 w-4" />Loaded import modules · {importModuleCatalog.length} bundled</p>
        <div className="relative sm:w-72"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input aria-label="Search import modules" className="pl-9" placeholder="Search import modules…" value={search} onChange={event => setSearch(event.target.value)} /></div>
      </div>
      <div className="grid gap-4 md:grid-cols-2">{visible.map(module => <ImportModuleCard key={module.id} module={module} collection={collection} orderId={orderId} />)}</div>
      {!visible.length && <p role="status" className="rounded-lg border p-5 text-sm text-muted-foreground">No loaded import modules match “{search}”. Try another module name or data type.</p>}
    </section>
  </div>;
}
