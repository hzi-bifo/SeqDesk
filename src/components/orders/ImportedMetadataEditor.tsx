"use client";

import { useState } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

export type ImportedEditableData = {
  id: string; name: string | null;
  samples: Array<{ id: string; sampleId: string; sampleTitle: string | null; sampleDescription: string | null; scientificName: string | null }>;
};

/** An origin-specific form within the shared data section, not another app. */
export function ImportedMetadataEditor({ initial }: { initial: ImportedEditableData }) {
  const [data, setData] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  async function save(url: string, body: unknown) {
    setBusy(true); setMessage(""); setError("");
    try {
      const response = await fetch(url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error((await response.json()).error || "Could not save metadata");
      setMessage("Metadata saved. Original repository metadata and read files were preserved.");
    } catch (e) { setError(e instanceof Error ? e.message : "Could not save metadata"); }
    finally { setBusy(false); }
  }
  return <PageContainer><div className="mb-6"><h1 className="text-lg font-semibold">Edit sequencing metadata</h1><p className="text-sm text-muted-foreground">Edit local descriptions without changing repository identifiers, provenance or files. No facility submission is required.</p><Link href={`/orders/${data.id}`} className="mt-2 inline-block text-sm underline">Back to sequencing data</Link></div>
    {error && <p role="alert" className="mb-4 text-sm text-destructive">{error}</p>}
    {message && <p role="status" className="mb-4 text-sm">{message}</p>}
    <form className="mb-6 space-y-3 rounded-lg border bg-card p-5" onSubmit={e => { e.preventDefault(); void save(`/api/orders/${data.id}`, { name: data.name }); }}><label className="block text-sm">Sequencing data name<Input maxLength={500} value={data.name || ""} onChange={e => setData({ ...data, name: e.target.value })} /></label><Button size="sm" disabled={busy}>Save data name</Button></form>
    <div className="space-y-4">{data.samples.map((sample, index) => <form key={sample.id} className="space-y-3 rounded-lg border bg-card p-5" onSubmit={e => { e.preventDefault(); void save(`/api/samples/${sample.id}`, { sampleTitle: sample.sampleTitle, sampleDescription: sample.sampleDescription, scientificName: sample.scientificName }); }}><h2 className="text-sm font-semibold">{sample.sampleId}</h2>{(["sampleTitle", "sampleDescription", "scientificName"] as const).map(key => { const field = { value: sample[key] || "", maxLength: key === "sampleDescription" ? 10000 : 500, onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setData(current => ({ ...current, samples: current.samples.map((s, i) => i === index ? { ...s, [key]: e.target.value } : s) })) }; return <label className="block text-sm" key={key}>{key === "sampleTitle" ? "Sample title" : key === "sampleDescription" ? "Sample description" : "Scientific name"}{key === "sampleDescription" ? <Textarea {...field} /> : <Input {...field} />}</label>; })}<Button size="sm" disabled={busy}>Save sample metadata</Button></form>)}</div>
  </PageContainer>;
}
