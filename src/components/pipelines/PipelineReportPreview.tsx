"use client";

import useSWR from "swr";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { pipelinePageRequest } from "@/lib/pipelines/page-request";
import { isPipelineReportPath, PipelineFileDownload } from "./PipelineFileDownload";

export function PipelineReportPreview({ file, isDemo, onClose }: {
  file: { path: string; label: string; runId?: string | null };
  isDemo?: boolean;
  onClose: () => void;
}) {
  const checkUrl = file.runId && !isDemo && isPipelineReportPath(file.path)
    ? `/api/pipelines/runs/${encodeURIComponent(file.runId)}/file?path=${encodeURIComponent(file.path)}&check=1`
    : null;
  const check = useSWR(checkUrl, pipelinePageRequest<{ available: boolean }>, { shouldRetryOnError: false });
  const ready = !checkUrl || (!check.isLoading && !check.error && check.data?.available === true);
  const previewUrl = `/api/files/preview?path=${encodeURIComponent(file.path)}`;
  return <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
    <DialogContent className="flex h-[90vh] w-[90vw] max-w-6xl flex-col sm:max-w-6xl">
      <DialogHeader className="pr-8">
        <DialogTitle className="truncate text-sm">{file.label}</DialogTitle>
        <DialogDescription className="sr-only">Saved pipeline report</DialogDescription>
      </DialogHeader>
      {ready ? <>
        <div className="flex items-center gap-3">
          <PipelineFileDownload runId={file.runId} path={file.path} label={file.label} disabled={!!isDemo} showLabel reportsOnly verifyAvailability />
          <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="text-xs underline">Open in new tab</a>
        </div>
        <iframe src={previewUrl} className="min-h-0 flex-1 w-full rounded-lg" title={file.label} sandbox="allow-same-origin allow-scripts" />
      </> : check.isLoading ? <div role="status" className="flex-1 rounded-lg bg-muted motion-safe:animate-pulse p-6 text-sm">Checking report availability…</div>
        : <div role="alert" className="rounded-lg border p-4 text-sm">
          <p className="font-medium">Report unavailable</p>
          <p className="mt-1 text-muted-foreground">{check.error instanceof Error ? check.error.message : "This saved report could not be found."}</p>
          <Button size="sm" variant="outline" className="mt-3" onClick={() => { void check.mutate().catch(() => undefined); }}>Retry report</Button>
        </div>}
    </DialogContent>
  </Dialog>;
}
