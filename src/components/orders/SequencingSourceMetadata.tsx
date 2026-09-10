"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Building2, Database, ExternalLink, Files } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  buildSequencingSourceGroups,
  sourceImportDetails,
  type SequencingSourceGroup,
  type SourceMetadataEntry,
  type SourceMetadataOrder,
} from "@/lib/orders/source-metadata";
import { importModuleTheme } from "@/components/workbench/ImportModuleUI";

function SourceDetails({ details }: { details: SourceMetadataEntry["details"] }) {
  return <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
    {details.map(({ label, value }) => <div key={label} className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 whitespace-pre-wrap break-words">{label === "Recorded at"
        ? <time dateTime={value}>{new Date(value).toLocaleString()}</time>
        : value}</dd>
    </div>)}
  </dl>;
}

function OriginalMetadata({ value }: { value: Record<string, unknown> }) {
  const [open, setOpen] = useState(false);
  if (Object.keys(value).length === 0) return null;
  return <details onToggle={event => setOpen(event.currentTarget.open)} className="mt-3">
    <summary className="w-fit cursor-pointer text-xs text-muted-foreground">Original source metadata</summary>
    {open && <pre className="mt-2 max-h-80 overflow-auto whitespace-pre-wrap break-all rounded-md bg-muted/50 p-3 text-xs">{JSON.stringify(value, null, 2)}</pre>}
  </details>;
}

const SUMMARY_LABELS = ["Environment", "Organism", "Read layout", "Read technology", "File format", "Platform", "Read processing", "Import module version"];

function SourceCard({ source }: { source: SequencingSourceGroup }) {
  const [showSamples, setShowSamples] = useState(false);
  const [showPending, setShowPending] = useState(false);
  const theme = source.theme ? importModuleTheme[source.theme] : null;
  const Icon = theme?.Icon ?? (source.providerId === "facility" ? Building2 : Database);
  const sampleCount = new Set(source.entries.map(entry => entry.sampleId)).size;
  const readCount = source.entries.filter(entry => entry.readId).length;
  // Summaries describe imported records only; preview values remain clearly marked as pending.
  const summary = SUMMARY_LABELS.flatMap(label => {
    const values = [...new Set(source.entries.flatMap(entry => entry.details.filter(detail => detail.label === label).map(detail => detail.value)))];
    return values.length ? [{ label, value: values.join(" · ") }] : [];
  });
  return <article aria-label={`${source.moduleName}: ${source.title}`} className="overflow-hidden rounded-lg border bg-card">
    <div className={cn("flex items-start gap-3 border-b px-5 py-4", theme?.surface ?? "bg-muted/30")}>
      <span className="rounded-lg bg-card/80 p-2"><Icon className="size-5" aria-hidden="true" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-xs text-muted-foreground">{source.kind}</p>
        <h3 className="break-words text-sm font-semibold text-foreground">{source.moduleName}</h3>
        {source.title !== source.moduleName && <p className="mt-1 break-words text-sm text-foreground">{source.title}</p>}
      </div>
      {source.synthetic && <span className="shrink-0 rounded-md bg-card/80 px-2 py-1 text-xs">Synthetic benchmark</span>}
    </div>
    <div className="space-y-4 px-5 py-4">
      {source.sourceKey && <p className="break-all text-xs text-muted-foreground">Source identifier: <span className="font-mono text-foreground">{source.sourceKey}</span></p>}
      {source.entries.length > 0 && <p className="text-xs text-muted-foreground">{sampleCount} {sampleCount === 1 ? "sample" : "samples"} · {readCount} {readCount === 1 ? "read set" : "read sets"}</p>}
      {summary.length > 0 && <SourceDetails details={summary} />}
      {source.providerId === "facility" && source.entries.length === 0 && <p className="text-sm text-muted-foreground">Samples submitted to the sequencing facility. File provenance appears as sequencing data is made available.</p>}
      {source.links.length > 0 && <div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{source.links.map(link => <a key={link.url} href={link.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline underline-offset-2">{link.label}<ExternalLink className="size-3" aria-hidden="true" /></a>)}</div>}
      {source.hosts.length > 0 && <p className="break-words text-xs text-muted-foreground">Source servers: {source.hosts.join(" · ")}</p>}
      {source.entries.length > 0 && <details onToggle={event => setShowSamples(event.currentTarget.open)} className="border-t pt-3">
        <summary className="w-fit cursor-pointer text-sm font-medium">Sample provenance ({sampleCount})</summary>
        {showSamples && <div className="mt-4 space-y-4">{source.entries.map(entry => <div key={entry.id} className="rounded-md border p-4">
          <h4 className="mb-3 break-words text-sm font-semibold">{entry.sampleLabel}</h4>
          {entry.details.length > 0 ? <SourceDetails details={entry.details} /> : <p className="text-sm text-muted-foreground">No additional source metadata was recorded.</p>}
          <OriginalMetadata value={entry.original} />
        </div>)}</div>}
      </details>}
      {source.imports.length > 0 && <div className="rounded-md bg-muted/40 p-3 text-sm">
        <p className="font-medium">{source.imports.length} {source.imports.length === 1 ? "import" : "imports"} pending</p>
        <p className="mt-1 text-xs text-muted-foreground">This source has been selected. Final sample metadata will appear when the import finishes. Download status is on Files.</p>
        <details className="mt-2" onToggle={event => setShowPending(event.currentTarget.open)}>
          <summary className="w-fit cursor-pointer text-xs">Source preview metadata</summary>
          {showPending && <div className="mt-3 space-y-4">{source.imports.map(job => <div key={job.id} className="space-y-2 border-t pt-3">
            <p className="break-words text-sm">{job.title} · {job.status === "running" ? "Importing" : "Queued"}</p>
            <SourceDetails details={sourceImportDetails(job)} />
          </div>)}</div>}
        </details>
      </div>}
    </div>
  </article>;
}

export function SequencingSourceMetadata({ order }: { order: SourceMetadataOrder & { id: string } }) {
  const sources = useMemo(() => buildSequencingSourceGroups(order), [order]);
  return <section aria-labelledby="sequencing-data-sources" className="mb-6 space-y-4">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 id="sequencing-data-sources" className="text-sm font-semibold">Data sources</h2>
        <p className="mt-1 text-xs text-muted-foreground">Original source metadata is kept separately from your editable descriptions.</p>
      </div>
      <Link href={`/orders/${order.id}/samples-files`} className="inline-flex items-center gap-1.5 text-xs underline underline-offset-2"><Files className="size-3.5" aria-hidden="true" />{order.dataOrigin === "import" ? "View files and import progress" : "View files"}</Link>
    </div>
    {sources.length > 0
      ? <div className="space-y-4">{sources.map(source => <SourceCard key={source.id} source={source} />)}</div>
      : <div className="rounded-lg border border-dashed p-5 text-sm text-muted-foreground">No data source recorded yet. Add data from Files; the selected module and its metadata will appear here when you start an import.</div>}
  </section>;
}
