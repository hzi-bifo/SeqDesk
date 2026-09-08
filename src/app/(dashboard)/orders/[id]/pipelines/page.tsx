"use client";
import { use, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { OrderPipelineView } from "@/components/orders/OrderPipelineView";
import { useCapability } from "@/components/deployment-profile/useCapability";
import { Skeleton } from "@/components/ui/skeleton";
import type { OrderSequencingSummaryResponse } from "@/lib/sequencing/types";
type InputSample = { id: string; sampleTitle: string | null; sampleId: string; reads: { id: string; file1: string | null; file2: string | null; isActive: boolean; supersededByReadId?: string | null }[] };
export default function OrderPipelinesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params); const query = useSearchParams(); const { data: session } = useSession();
  const selected = query.get("pipeline");
  const canRun = useCapability("analysis.run"), canConfigure = useCapability("system.pipelines.manage"), canCancel = useCapability("analysis.cancel_own");
  const canResolve = useCapability("analysis.resolve_outputs"), canCancelAll = useCapability("analysis.cancel_all"), canPurge = useCapability("data.purge_shared");
  const [summary, setSummary] = useState<OrderSequencingSummaryResponse>();
  const [inputs, setInputs] = useState<InputSample[]>([]);
  const [imported, setImported] = useState(false);
  const [pipelines, setPipelines] = useState<{ pipelineId: string; name: string; description?: string }[]>([]);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false); const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const responses = await Promise.all([fetch(`/api/orders/${id}/pipeline-input`), fetch(`/api/orders/${id}`), fetch("/api/admin/settings/pipelines?enabled=true&catalog=order")]);
        if (responses.some(r => !r.ok)) throw new Error("Pipelines or sequencing data could not be loaded. Check permissions and module configuration.");
        const [data, order, catalog] = await Promise.all(responses.map(r => r.json()));
        if (active) { setSummary(data); setInputs(order.samples); setImported(order.dataOrigin === "import"); setPipelines(catalog.pipelines ?? []); setError(""); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Could not load pipelines"); }
    }
    void load(); const timer = setInterval(() => { if (!document.hidden) void load(); }, 5000);
    return () => { active = false; clearInterval(timer); };
  }, [id, revision]);
  async function selectRead(sampleId: string, readId: string) {
    if (!readId) return; setBusy(true); setError("");
    try {
      const response = await fetch(`/api/orders/${id}/pipeline-input`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ sampleId, readId }) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not select reads");
      setRevision(n => n + 1);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not select reads"); } finally { setBusy(false); }
  }
  const inputSelection = imported ? {
    description: "Review the files selected for each sample.",
    renderSample: (sampleId: string) => {
      const sample = inputs.find(input => input.id === sampleId);
      if (!sample) return <span className="text-xs text-muted-foreground">Read sets unavailable. Refresh to try again.</span>;
      const reads = sample.reads.filter(read => read.file1 && !read.supersededByReadId);
      // A single active input needs no decision. Do not implicitly activate a
      // lone inactive set: that still requires the selector and the normal PUT.
      if (reads.length === 1 && reads[0].isActive) {
        const read = reads[0];
        return <div className="min-w-0 space-y-1">
          <div className="break-all text-xs" title={[read.file1, read.file2].filter(Boolean).join("\n")}>
            {read.file1?.split(/[\\/]/).pop()}{read.file2 && <> + {read.file2.split(/[\\/]/).pop()}</>}
          </div>
          <div className="text-xs text-muted-foreground">{read.file2 ? "Paired-end" : "Single-end"}</div>
        </div>;
      }
      return <div className="min-w-0"><select
        aria-label={`Input reads for ${sample.sampleId}`}
        className="w-full min-w-0 max-w-full rounded-md border border-input bg-background p-2 text-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        disabled={busy || !canRun || session?.user.isDemo || !reads.length}
        value={reads.find(read => read.isActive)?.id ?? ""}
        onChange={e => void selectRead(sample.id, e.target.value)}
      >
        <option value="" disabled>{reads.length ? "Select a validated read set" : "No validated read sets yet"}</option>
        {reads.map((read, index) => <option key={read.id} value={read.id}>Read set {index + 1} · {read.file2 ? "Paired-end" : "Single-end"} · {[read.file1, read.file2].filter(Boolean).map(file => file?.split(/[\\/]/).pop()).join(" + ")}</option>)}
      </select>{reads.length > 1 && <p className="mt-1.5 text-xs text-muted-foreground">Changing this also selects these files for other pipelines.</p>}</div>;
    },
  } : undefined;
  return <PageContainer><div className="space-y-5">{!selected && <><h1 className="text-xl font-semibold">Pipelines</h1><p>Choose a pipeline to process your sequencing data. <Link className="underline" href={`/orders/${id}/samples-files`}>View files and downloads</Link></p></>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!summary && !error && <Skeleton className="h-32 w-full motion-reduce:animate-none" />}
    {!selected && inputSelection && <section className="space-y-3 rounded-xl border bg-card p-4" aria-label="Input data">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h2 className="text-sm font-medium">Input data</h2><p className="mt-1 text-xs text-muted-foreground">{inputSelection.description}</p></div>
        <Link className="text-sm underline" href={`/orders/${id}/samples-files`}>Manage files and data sources</Link>
      </div>
      {!inputs.length && <p className="text-sm text-muted-foreground">No validated samples yet. Wait for an import to complete.</p>}
      {inputs.map(sample => <label key={sample.id} className="grid items-center gap-2 text-sm sm:grid-cols-2"><span>{sample.sampleTitle || sample.sampleId}</span>{inputSelection.renderSample(sample.id)}</label>)}
    </section>}
    {!selected && <div className="grid gap-4 md:grid-cols-2">{pipelines.map(p => <Link key={p.pipelineId} className="rounded border p-5 hover:bg-muted" href={`/orders/${id}/pipelines?pipeline=${encodeURIComponent(p.pipelineId)}`}><h2 className="font-semibold">{p.name}</h2><p className="text-sm text-muted-foreground">{p.description}</p></Link>)}{summary && !pipelines.length && <p>No enabled sequencing-data pipelines. An administrator can enable existing packages in pipeline settings.</p>}</div>}
    {selected && summary && <OrderPipelineView orderId={id} pipelineId={selected} samples={summary.samples} inputSelection={inputSelection} isDemo={session?.user.isDemo} canRunPipelines={canRun && !busy} canManagePipelines={canConfigure} canCancelOwnRuns={canCancel} canResolveOutputs={canResolve} canCancelAllRuns={canCancelAll} canPurgeRuns={canPurge} currentUserId={session?.user.id} onRunCompleted={() => setRevision(n => n + 1)} onSampleDataChanged={() => setRevision(n => n + 1)} />}
  </div></PageContainer>;
}
