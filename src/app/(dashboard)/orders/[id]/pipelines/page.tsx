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
  return <PageContainer><div className="space-y-5"><h1 className="text-xl font-semibold">Pipelines</h1><p>Sequencing-data pipelines use validated read sets. <Link className="underline" href={`/orders/${id}/samples-files`}>View files and downloads</Link></p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!summary && !error && <Skeleton className="h-32 w-full motion-reduce:animate-none" />}
    {imported && <section className="space-y-3 rounded border p-4"><h2 className="font-medium">Pipeline input reads</h2>{!inputs.length && <p>No validated samples yet. Wait for an import to complete.</p>}{inputs.map(sample => <label key={sample.id} className="block text-sm">{sample.sampleTitle || sample.sampleId}<select aria-label={`Input reads for ${sample.sampleId}`} className="ml-3 rounded border bg-background p-2" disabled={busy || !canRun || session?.user.isDemo} value={sample.reads.find(read => read.isActive)?.id ?? ""} onChange={e => void selectRead(sample.id, e.target.value)}><option value="" disabled>Select a validated read set</option>{sample.reads.filter(read => read.file1 && !read.supersededByReadId).map(read => <option key={read.id} value={read.id}>{read.file2 ? "Paired-end" : "Single-end"} · {read.file1?.split("/").pop()} · {read.id.slice(-8)}</option>)}</select></label>)}</section>}
    {!selected && <div className="grid gap-4 md:grid-cols-2">{pipelines.map(p => <Link key={p.pipelineId} className="rounded border p-5 hover:bg-muted" href={`/orders/${id}/pipelines?pipeline=${encodeURIComponent(p.pipelineId)}`}><h2 className="font-semibold">{p.name}</h2><p className="text-sm text-muted-foreground">{p.description}</p></Link>)}{summary && !pipelines.length && <p>No enabled sequencing-data pipelines. An administrator can enable existing packages in pipeline settings.</p>}</div>}
    {selected && summary && <OrderPipelineView orderId={id} pipelineId={selected} samples={summary.samples} isDemo={session?.user.isDemo} canRunPipelines={canRun && !busy} canManagePipelines={canConfigure} canCancelOwnRuns={canCancel} canResolveOutputs={canResolve} canCancelAllRuns={canCancelAll} canPurgeRuns={canPurge} currentUserId={session?.user.id} onRunCompleted={() => setRevision(n => n + 1)} onSampleDataChanged={() => setRevision(n => n + 1)} />}
  </div></PageContainer>;
}
