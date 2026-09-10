"use client";
import { importModuleTheme } from "./ImportModuleUI";
import { cn } from "@/lib/utils";

export function ImportProgress({ status, phase, source = "cami", barFirst = false }: { status: string; phase?: string | null; source?: "cami" | "sra"; barFirst?: boolean }) {
  const match = /^downloading\b.*?([\d.]+)%/i.exec(phase ?? "");
  const percent = match ? Math.min(100, Math.max(0, Number(match[1]))) : undefined;
  const progress = status === "running" && (percent !== undefined ? <div role="progressbar" aria-label="Download progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} className="h-2 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full transition-[width] motion-reduce:transition-none", importModuleTheme[source].progress)} style={{ width: `${percent}%` }} /></div> : <div role="status" aria-label="Processing" className={cn("h-2 rounded-full opacity-30 motion-safe:animate-pulse", importModuleTheme[source].progress)} />);
  return <div className="space-y-2">{barFirst && progress}<p>{status === "success" ? "Ready — files validated" : phase || status}</p>{!barFirst && progress}</div>;
}
