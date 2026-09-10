"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
export function CancelImportButton({ jobId, status, phase }: { jobId: string; status: string; phase?: string | null }) {
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  if (status !== "running" && status !== "queued") return null;
  if (sent || phase === "cancelling") return <span role="status">{status === "queued" ? "Cancellation requested" : "Stopping…"}</span>;
  async function cancel() {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/workbench/imports/${encodeURIComponent(jobId)}/cancel`, { method: "POST" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Could not cancel import");
      setSent(true);
    } catch (e) { setError(e instanceof Error ? e.message : "Could not cancel import"); }
    finally { setPending(false); }
  }
  return <div className="space-y-2 text-sm">
    {confirming ? <>
      <p>Cancel this import? Partial files will be removed. Retrying starts a new download; completed imports are kept.</p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" size="sm" className="h-auto min-h-8 whitespace-normal" variant="destructive" disabled={pending} onClick={() => void cancel()}>{pending ? "Requesting…" : "Confirm cancellation"}</Button>
        <Button type="button" size="sm" className="h-auto min-h-8 whitespace-normal" variant="ghost" disabled={pending} onClick={() => setConfirming(false)}>{status === "running" ? "Keep downloading" : "Keep queued"}</Button>
      </div>
    </> : <Button type="button" size="sm" className="h-auto min-h-8 whitespace-normal" variant="outline" onClick={() => setConfirming(true)}>{status === "running" ? "Stop download" : "Cancel queued import"}</Button>}
    {error && <p role="alert" className="text-destructive">{error}</p>}
  </div>;
}
