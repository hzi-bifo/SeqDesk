"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

type Sample = { id: string; sampleId: string; sampleTitle: string | null; orderId?: string | null };
type Member = { sampleId: string; role: string; groupLabel: string | null; sample: Sample };
export function StudyCohort({ studyId, readOnly = false, onChange }: { studyId: string; readOnly?: boolean; onChange?: () => void | Promise<void> }) {
  const [members, setMembers] = useState<Member[]>([]); const [samples, setSamples] = useState<Sample[]>([]);
  const [sampleId, setSampleId] = useState(""); const [role, setRole] = useState("unassigned"); const [groupLabel, setGroup] = useState("");
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const refresh = useCallback(async () => {
    const response = await fetch(`/api/studies/${studyId}/cohort`);
    if (!response.ok) throw new Error("Could not load study groups");
    setMembers((await response.json()).members);
  }, [studyId]);
  useEffect(() => { void refresh().catch(e => setError(e.message)); }, [refresh]);
  useEffect(() => { if (!readOnly) void fetch("/api/samples").then(async r => { if (!r.ok) throw new Error("Could not load available samples"); setSamples(await r.json()); }).catch(e => setError(e.message)); }, [readOnly, studyId]);
  async function save(remove?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/studies/${studyId}/cohort${remove ? `?sampleId=${encodeURIComponent(remove)}` : ""}`, { method: remove ? "DELETE" : "POST", headers: { "content-type": "application/json" }, ...(remove ? {} : { body: JSON.stringify({ sampleId, role, groupLabel: groupLabel || null }) }) });
      if (!response.ok) throw new Error((await response.json()).error || "Membership update failed");
      await refresh();
      await onChange?.();
    } catch (e) { setError(e instanceof Error ? e.message : "Membership update failed"); } finally { setBusy(false); }
  }
  return <section className="mb-6 space-y-4 rounded-lg border bg-card p-5"><div><h2 className="text-sm font-semibold">Study groups</h2><p className="mt-1 text-xs text-muted-foreground">Combine facility and imported samples without copying data. Linked samples are available to analysis pipelines in this study. Roles apply only to this study; submission pipelines use directly assigned samples.</p></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!readOnly && <form className="flex flex-wrap items-end gap-3" onSubmit={e => { e.preventDefault(); void save(); }}><label className="text-xs">Sample<select aria-label="Cohort sample" className="block max-w-80 rounded border bg-background p-2 text-sm" value={sampleId} onChange={e => setSampleId(e.target.value)}><option value="">Select a sample</option>{samples.map(s => <option value={s.id} key={s.id}>{s.sampleTitle || s.sampleId}</option>)}</select></label><label className="text-xs">Role<select className="block rounded border bg-background p-2 text-sm" value={role} onChange={e => setRole(e.target.value)}>{["unassigned", "case", "control", "reference"].map(r => <option key={r}>{r}</option>)}</select></label><label className="text-xs">Group name<input maxLength={120} className="block rounded border bg-background p-2 text-sm" value={groupLabel} onChange={e => setGroup(e.target.value)} /></label><Button size="sm" disabled={busy || !sampleId}>Add / update membership</Button></form>}
    <div className="divide-y">{members.map(m => <div key={m.sampleId} className="flex items-center justify-between gap-3 py-3 text-sm"><span>{m.sample.orderId ? <Link className="underline" href={`/orders/${m.sample.orderId}`}>{m.sample.sampleTitle || m.sample.sampleId}</Link> : m.sample.sampleTitle || m.sample.sampleId} · {m.role}{m.groupLabel ? ` · ${m.groupLabel}` : ""}</span>{!readOnly && <Button size="sm" variant="ghost" disabled={busy} onClick={() => void save(m.sampleId)}>Unlink</Button>}</div>)}</div>
    {!members.length && <p className="text-sm text-muted-foreground">No study groups defined yet. Samples may be linked to several studies.</p>}
  </section>;
}
