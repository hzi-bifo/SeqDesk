"use client";

import { Download, Loader2 } from "lucide-react";
import { useRef, useState } from "react";
import { toast } from "@/components/ui/toast";
import { pipelinePageRequest } from "@/lib/pipelines/page-request";

export function isPipelineReportPath(path: string): boolean {
  return /\.(html?|pdf|txt|tsv|csv|log|json)$/i.test(path);
}

export function pipelineFileDownloadHref(runId: string, path: string): string {
  return `/api/pipelines/runs/${encodeURIComponent(runId)}/file?path=${encodeURIComponent(path)}&download=1`;
}

export function PipelineFileDownload({
  runId,
  path,
  label,
  disabled = false,
  showLabel = false,
  reportsOnly = false,
  verifyAvailability = false,
}: {
  runId?: string | null;
  path: string;
  label: string;
  disabled?: boolean;
  showLabel?: boolean;
  reportsOnly?: boolean;
  verifyAvailability?: boolean;
}) {
  const [checking, setChecking] = useState(false);
  const checkingRef = useRef(false);
  if (!runId || disabled) return null;
  // Read files may have been moved into sequencing storage. Their downloads
  // belong in Files, not on the pipeline report endpoint.
  if (reportsOnly && !isPipelineReportPath(path)) return null;

  return (
    <a
      href={pipelineFileDownloadHref(runId, path)}
      download
      aria-label={`Download ${label}`}
      title={`Download ${label}`}
      className="inline-flex min-h-7 min-w-7 shrink-0 items-center justify-center gap-1 rounded px-1.5 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      aria-disabled={checking || undefined}
      onClick={async (event) => {
        event.stopPropagation();
        if (!verifyAvailability) return;
        event.preventDefault();
        if (checkingRef.current) return;
        checkingRef.current = true;
        setChecking(true);
        try {
          const check = await pipelinePageRequest<{ available: boolean }>(`/api/pipelines/runs/${encodeURIComponent(runId)}/file?path=${encodeURIComponent(path)}&check=1`);
          if (!check.available) throw new Error("This report is no longer available.");
          const link = document.createElement("a");
          link.href = pipelineFileDownloadHref(runId, path);
          link.download = "";
          link.click();
        } catch (error) {
          toast.error("Could not download report", { description: error instanceof Error ? error.message : "Please retry." });
        } finally {
          checkingRef.current = false;
          setChecking(false);
        }
      }}
    >
      {checking ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Download className="size-3.5" aria-hidden="true" />}
      {showLabel && "Download"}
    </a>
  );
}
