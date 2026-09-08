"use client";
export function ImportProgress({ status, phase }: { status: string; phase?: string | null }) {
  const match = /^downloading\b.*?([\d.]+)%/i.exec(phase ?? "");
  const percent = match ? Math.min(100, Math.max(0, Number(match[1]))) : undefined;
  return <div className="space-y-2"><p>{status === "success" ? "Ready — files validated" : phase || status}</p>{status === "running" && (percent !== undefined ? <div role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded bg-muted"><div className="h-full rounded bg-teal-600 transition-[width] motion-reduce:transition-none" style={{ width: `${percent}%` }} /></div> : <div role="status" aria-label="Processing" className="h-2 rounded bg-teal-600/30 motion-safe:animate-pulse" />)}</div>;
}
