"use client";

import { useState } from "react";
import Link from "next/link";
import useSWR, { useSWRConfig } from "swr";
import { Download, FolderOpen, Paperclip, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import { fetcher, postJson } from "@/lib/explore/client";
import { filesHref, formatFileSize, type LibraryFileSummary } from "@/lib/files/library-types";

export function ReportSourceFiles({ reportId, scope, canEdit }: { reportId: string; scope: string; canEdit: boolean }) {
  const key = `/api/explore/reports/${encodeURIComponent(reportId)}/files`;
  const { mutate: mutateCache } = useSWRConfig();
  const { data, error, isLoading, mutate } = useSWR<{ files: Array<LibraryFileSummary & { attached: boolean; usedInReport: boolean }> }>(key, fetcher);
  const [removing, setRemoving] = useState<string | null>(null);
  const remove = async (file: LibraryFileSummary & { usedInReport: boolean }) => {
    setRemoving(file.id);
    try {
      await postJson(`${key}?fileId=${encodeURIComponent(file.id)}`, undefined, "DELETE");
      await Promise.allSettled([mutate(), mutateCache(`/api/files/library?targetKey=${encodeURIComponent(scope)}`)]);
      toast.success(file.usedInReport ? "Attachment removed. The file stays listed because this report or an analysis version uses it." : "Reference removed. The original is still in Files.");
    }
    catch (err) { toast.error(err instanceof Error ? err.message : "Could not remove the reference"); }
    finally { setRemoving(null); }
  };
  if (!canEdit && !data?.files.length && !error) return null;
  return <section className="mt-6 rounded-lg border p-4" aria-label="Source files">
    <div className="flex items-center justify-between gap-3">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><Paperclip className="h-4 w-4" />Source files</h2>
      <Button asChild size="sm" variant="outline"><Link href={filesHref(scope, canEdit ? reportId : null)}><FolderOpen className="mr-1 h-3.5 w-3.5" />{canEdit ? "Add from Files" : "Browse Files"}</Link></Button>
    </div>
    <p className="mt-1 text-xs text-muted-foreground">Original uploads referenced by this report or its analyses. Files stay in the library when a report is deleted.</p>
    {error && <p role="alert" className="mt-2 text-sm text-destructive">{error.message}</p>}
    {isLoading && <p role="status" className="mt-3 text-sm text-muted-foreground">Loading source files…</p>}
    {data?.files.length === 0 && <p className="mt-3 text-sm text-muted-foreground">Add source data or reference documents from Files.</p>}
    <ul className="mt-3 space-y-2">{data?.files.map((file) => <li key={file.id} className="flex items-center gap-3 text-sm">
      <a className="min-w-0 flex-1 truncate hover:underline" href={`/api/files/library/${file.id}?download=1`} title={file.originalName}><Download className="mr-2 inline h-3.5 w-3.5" />{file.originalName}</a>
      <span className="text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)}</span>
      <span className="text-xs text-muted-foreground" title={file.usedInReport ? "Used by a report table or a saved analysis version" : "Attached as a reference document"}>{file.usedInReport ? "Used by report" : "Reference"}</span>
      {canEdit && file.attached && <Button variant="ghost" size="icon" disabled={!!removing} title="Remove attachment; keep the original in Files" aria-label={`Remove reference to ${file.originalName}`} onClick={() => void remove(file)}><X className="h-3.5 w-3.5" /></Button>}
    </li>)}</ul>
  </section>;
}
