"use client";
import { use, useEffect, useState } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { ImportedReadSummary } from "@/components/orders/ImportedReadSummary";
import { Skeleton } from "@/components/ui/skeleton";
import { ImportProgress } from "@/components/workbench/ImportProgress";
import { CancelImportButton } from "@/components/workbench/CancelImportButton";

type Job = { id: string; status: string; phase: string | null; error: string | null; updatedAt: string; finishedAt: string | null; request?: { sample?: number; accession?: string }; preview?: { summary?: { label?: string } } };
type Collection = { name: string; sourceMetadata?: string | null; samples: { id: string; reads: { id: string }[] }[] };
export default function SamplesFilesPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const [order, setOrder] = useState<Collection>();
  const [jobs, setJobs] = useState<Job[]>([]);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout>;
    async function refresh() {
      try {
        const response = await fetch(`/api/orders/${id}`, { cache: "no-store" });
        if (!response.ok) throw new Error("Could not load collection. Check your access or try again.");
        const data: Collection = await response.json();
        const metadata = JSON.parse(data.sourceMetadata || "{}");
        let incoming: Job[] = [];
        if (metadata.collectionKey) {
          const progress = await fetch(`/api/workbench/imports?collection=${encodeURIComponent(metadata.collectionKey)}`, { cache: "no-store" });
          if (!progress.ok) throw new Error("Could not refresh import progress. Retrying…");
          incoming = (await progress.json()).jobs;
        }
        if (active) { setOrder(data); setJobs(incoming); setError(""); setRevision(data.samples.reduce((n, sample) => n + sample.reads.length, 0)); }
      } catch (e) { if (active) setError(e instanceof Error ? e.message : "Could not refresh"); }
      finally { if (active) timer = setTimeout(refresh, 3000); }
    }
    void refresh();
    return () => { active = false; clearTimeout(timer); };
  }, [id]);
  let collectionKey: string | undefined;
  try { collectionKey = JSON.parse(order?.sourceMetadata || "{}").collectionKey; } catch { /* Legacy metadata */ }
  return <PageContainer><div className="space-y-5">
    <h1 className="text-xl font-semibold">{order?.name ?? "Sequencing data"} · Files</h1>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    {!order && !error && <div role="status" aria-label="Loading files" className="space-y-3">{[0, 1, 2].map(i => <Skeleton key={i} className="h-16 w-full motion-reduce:animate-none" />)}</div>}
    {order && <>
      <Link className="underline" href={collectionKey ? `/orders/import?${new URLSearchParams({ collection: collectionKey, name: order.name, orderId: id })}` : "/orders/import"}>Add data from a source</Link>
      <p className="text-sm text-muted-foreground">After download and validation, imported files and their associated sample metadata are saved automatically. <Link className="underline" href={`/orders/${id}`}>View metadata</Link></p>
      <p className="text-sm text-muted-foreground">Imports run on the SeqDesk server. You can leave this page and return later; we notify you here in SeqDesk when an import finishes or fails. For a local installation, keep the server and computer running.</p>
      {collectionKey && <p className="text-sm">{jobs.filter(j => j.status === "success").length} imports ready · {jobs.filter(j => j.status === "running").length} running · {jobs.filter(j => j.status === "queued").length} queued · {jobs.filter(j => j.status === "error").length} failed</p>}
      {jobs.length > 0 && <div className="overflow-x-auto rounded border"><table className="w-full text-left text-sm"><thead><tr><th className="p-3">Sample / selection</th><th className="p-3">Status</th><th className="p-3">Progress</th><th className="p-3">Last update</th><th className="p-3">Actions</th></tr></thead><tbody>{jobs.map(job => <tr key={job.id} className="border-t"><td className="p-3">{job.request?.sample != null ? `sample_${job.request.sample}` : job.request?.accession ?? job.preview?.summary?.label ?? "Import"}</td><td className="p-3">{job.status === "success" ? "Ready" : job.status}</td><td className="p-3">{job.error ? <span>{job.error}</span> : <ImportProgress status={job.status} phase={job.phase} />}{job.status === "running" && Date.now() - Date.parse(job.updatedAt) > 60000 && <p>No recent update; the server may still be processing.</p>}</td><td className="p-3">{new Date(job.finishedAt ?? job.updatedAt).toLocaleString()}</td><td className="p-3"><CancelImportButton jobId={job.id} status={job.status} phase={job.phase} /></td></tr>)}</tbody></table></div>}
      {revision > 0 ? <ImportedReadSummary key={revision} orderId={id} /> : <p>No validated read files are ready yet.</p>}
    </>}
  </div></PageContainer>;
}
