"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import useSWR from "swr";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetcher, postJson } from "@/lib/explore/client";
import type { ReportGeneration } from "@/lib/explore/report-generation";

const ACTIVE = ["pending", "queued", "running"];
const STATUS: Record<string, string> = { "not-started": "Not started", pending: "Preparing saved data", queued: "Waiting to run", running: "Generating charts and tables", completed: "Ready to review", failed: "Generation failed", cancelled: "Generation stopped", edited: "Continued in the analysis editor" };

export function ReportGenerationPanel({ reportId, scope, updatedAt, canEdit, onChanged }: { reportId: string; scope: string; updatedAt: string | null; canEdit: boolean; onChanged: () => void | Promise<unknown> }) {
  const key = `/api/explore/reports/${encodeURIComponent(reportId)}/generations`;
  const { data, error, mutate } = useSWR<{ generations: ReportGeneration[] }>(key, fetcher, { refreshInterval: latest => latest?.generations.some(generation => ACTIVE.includes(generation.status)) ? 3000 : 15000 });
  if (error) return <div role="alert" className="mt-4 rounded-lg border p-3 text-sm">Could not check report generation. <Button size="sm" variant="outline" onClick={() => void mutate()}>Retry progress</Button></div>;
  if (!data?.generations.length) return null;
  return <section className="my-4 space-y-3" aria-label="Report generation">{data.generations.map(generation => <GenerationCard key={generation.analysisId} generation={generation} scope={scope} canEdit={canEdit}
    onAction={async (action, itemIds) => {
      try { await postJson(`${key}/${encodeURIComponent(generation.analysisId)}`, action === "add" ? { action, itemIds, expectedUpdatedAt: updatedAt } : { action }); }
      finally { await onChanged(); await mutate(); }
    }} />)}</section>;
}

function GenerationCard({ generation, scope, canEdit, onAction }: { generation: ReportGeneration; scope: string; canEdit: boolean; onAction: (action: "start" | "add", ids?: string[]) => Promise<void> }) {
  const [selection, setSelection] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const available = generation.items.filter(item => !generation.addedIds.includes(item.block.id));
  const selected = available.filter(item => selection === null || selection.includes(item.block.id)).map(item => item.block.id);
  const active = ACTIVE.includes(generation.status);
  const added = generation.items.length > 0 && available.length === 0;
  const act = async (action: "start" | "add") => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try { await onAction(action, selected); }
    catch (error) { setError(error instanceof Error ? error.message : "Could not complete this action. Please try again."); }
    finally { setBusy(false); inFlight.current = false; }
  };
  return <details open={!added} className="rounded-xl border border-teal-200 bg-teal-50/30 p-4 dark:border-teal-900 dark:bg-teal-950/20">
    <summary className="cursor-pointer text-sm"><span className="font-semibold">{generation.name}</span><span className="ml-3 text-muted-foreground">{added ? "Added to report" : STATUS[generation.status] ?? generation.status}</span></summary>
    <div className="mt-3 space-y-3">
      {active && <div role="status"><p className="flex items-center gap-2 text-sm"><Loader2 aria-hidden className="h-4 w-4 animate-spin motion-reduce:animate-none" />{STATUS[generation.status]}</p><div className="mt-3 h-12 rounded-lg bg-teal-100/50 motion-safe:animate-pulse dark:bg-teal-900/30" /><p className="mt-2 text-xs text-muted-foreground">You can leave this page. Come back to this report to review the results. Keep your SeqDesk server running.</p></div>}
      {generation.status === "not-started" && <p className="text-sm text-muted-foreground">Your choices were saved, but generation has not started. Review setup if starting fails.</p>}
      {["failed", "cancelled"].includes(generation.status) && <p role="status" className="text-sm">No items were added to your report. Open the analysis for the reason and retry options.</p>}
      {generation.status === "edited" && <p className="text-sm">This analysis has been edited or rerun. Use its outputs in the page editor; the original guided selection is no longer applied.</p>}
      {generation.warnings.length > 0 && <div role="status" className="space-y-1 text-sm text-amber-800 dark:text-amber-300">{generation.warnings.map((warning, i) => <p key={i}>{warning}</p>)}</div>}
      {generation.notes.length > 0 && <details className="text-sm"><summary className="cursor-pointer">Analysis notes ({generation.notes.length})</summary><ul className="mt-2 list-disc space-y-1 pl-5 text-muted-foreground">{generation.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></details>}
      {generation.status === "completed" && <>
        {available.length ? <><p className="text-sm text-muted-foreground">Choose the finished items to add. Existing report content will be kept.</p><div className="space-y-2">{generation.items.map(item => generation.addedIds.includes(item.block.id)
          ? <p key={item.block.id} className="flex items-center gap-2 text-sm text-muted-foreground"><Check aria-hidden className="h-4 w-4" />{item.label} · On report</p>
          : <label key={item.block.id} className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1 accent-teal-700" disabled={!canEdit || busy} checked={selected.includes(item.block.id)} onChange={event => setSelection(event.target.checked ? [...selected, item.block.id] : selected.filter(id => id !== item.block.id))} />{item.label}</label>)}</div></>
          : <p className="text-sm text-muted-foreground">{added ? "These items are on the report below. You can arrange them with Edit." : "The analysis completed without report-ready items. Open the analysis to inspect the outputs and notes."}</p>}
      </>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-3">
        {canEdit && generation.status === "completed" && available.length > 0 && <Button size="sm" disabled={busy || !selected.length} onClick={() => void act("add")}>{busy ? "Adding…" : `Add ${selected.length} item${selected.length === 1 ? "" : "s"} to report`}</Button>}
        {canEdit && generation.status === "not-started" && <Button size="sm" disabled={busy} onClick={() => void act("start")}>{busy ? "Starting…" : "Start generation"}</Button>}
        <Link className="text-xs text-muted-foreground underline" href={`/explore/analyses/${encodeURIComponent(generation.analysisId)}?scope=${encodeURIComponent(scope)}`}>{active ? "Run details" : "Open analysis and outputs"}</Link>
      </div>
    </div>
  </details>;
}
