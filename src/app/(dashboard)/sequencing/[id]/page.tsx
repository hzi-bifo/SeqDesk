import Link from "next/link";
import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import { authOptions } from "@/lib/auth";
import { decideCapability } from "@/lib/authorization";
import { db } from "@/lib/db";
import { sequencingEntryScope } from "@/lib/sequencing/entry-access";
import { PageContainer } from "@/components/layout/PageContainer";

function Metadata({ value }: { value: string | null }) {
  if (!value) return <p className="text-sm text-muted-foreground">Not recorded</p>;
  let text = value;
  try { text = JSON.stringify(JSON.parse(value), null, 2); } catch { /* Legacy plain-text metadata. */ }
  return <pre className="overflow-auto whitespace-pre-wrap break-all text-xs">{text}</pre>;
}

export default async function SequencingEntryPage({ params }: { params: Promise<{ id: string }> }) {
  const access = decideCapability(await getServerSession(authOptions), "studies.read");
  if (!access.allowed || !access.principal) notFound();
  const { id } = await params;
  const sample = await db.sample.findFirst({ where: { id, ...sequencingEntryScope(access.principal.id, access.grant?.scope === "installation") },
    include: { study: { select: { id: true, title: true } }, order: { select: { id: true, orderNumber: true } }, reads: { orderBy: { id: "asc" } } } });
  if (!sample) notFound();
  return <PageContainer>
    <Link className="text-sm text-muted-foreground hover:underline" href="/sequencing">Sequencing</Link>
    <h1 className="mt-3 text-2xl font-semibold">{sample.sampleTitle || sample.sampleId}</h1>
    <p className="mt-1 text-muted-foreground">{sample.sampleId} · {sample.sampleDescription}</p>
    <nav className="my-6 flex flex-wrap gap-4 border-b pb-3 text-sm"><a href="#metadata">Sample metadata</a><a href="#reads">Sequencing files</a><a href="#provenance">Source provenance</a></nav>
    <section id="metadata" className="mb-6 space-y-3 rounded-lg border bg-card p-5"><h2 className="font-semibold">Sample metadata</h2>
      <p>Study: {sample.study ? <Link className="underline" href={`/studies/${sample.study.id}`}>{sample.study.title}</Link> : "Not linked"}</p>
      {sample.order ? <p>Order: <Link className="underline" href={`/orders/${sample.order.id}`}>{sample.order.orderNumber}</Link></p> : <p className="text-sm text-muted-foreground">Imported sequencing data · no facility order or instrument run required.</p>}
      <Metadata value={sample.checklistData} />
    </section>
    <section id="reads" className="mb-6 space-y-4"><h2 className="font-semibold">Sequencing files</h2>
      {!sample.reads.length && <p>No read datasets linked yet.</p>}
      {sample.reads.map(read => <div key={read.id} className="space-y-3 rounded-lg border bg-card p-5">
        <h3 className="font-medium">{read.file2 ? "Paired-end reads" : "Single-end / long reads"} · {read.dataClass}</h3>
        <p className="text-sm text-muted-foreground">{read.isActive ? "Selected pipeline input" : "Not selected for pipelines"} · {read.classificationNote}</p>
        <dl className="space-y-2 text-sm"><dt>File 1 location</dt><dd className="break-all font-mono">{read.file1 || "Not recorded"}</dd>
          {read.file2 && <><dt>File 2 location</dt><dd className="break-all font-mono">{read.file2}</dd></>}
          <dt>MD5 checksums</dt><dd className="break-all font-mono">{[read.checksum1, read.checksum2].filter(Boolean).join(" / ") || "Not recorded"}</dd>
          <dt>Read counts</dt><dd>{[read.readCount1, read.readCount2].filter(count => count != null).join(" / ") || "Not recorded"}</dd></dl>
        <details><summary className="cursor-pointer text-sm">Technology, validation and source metadata</summary><Metadata value={read.pipelineSources} /></details>
      </div>)}
    </section>
    <section id="provenance" className="space-y-3 rounded-lg border bg-card p-5"><h2 className="font-semibold">Source provenance</h2><Metadata value={sample.customFields} /></section>
  </PageContainer>;
}
