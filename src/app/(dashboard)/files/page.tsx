"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR, { useSWRConfig } from "swr";
import { ArrowLeft, Check, Download, File, FolderOpen, Loader2, Paperclip, Search, Table2 } from "lucide-react";
import { FileUploadPanel } from "@/components/files/FileUploadPanel";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { fetcher, formatDateTime, postJson } from "@/lib/explore/client";
import type { ExploreScope } from "@/lib/explore/types";
import { filesHref, formatFileSize, type LibraryFileSummary, type LibraryResponse } from "@/lib/files/library-types";
import { useModuleEnabled } from "@/lib/modules";

export default function FilesPage() {
  return <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}><FilesScreen /></Suspense>;
}

function FilesScreen() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const exploreEnabled = useModuleEnabled("explore");
  const { mutate: mutateCache } = useSWRConfig();
  const [uploading, setUploading] = useState(false);
  const [linking, setLinking] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const { data: scopesData, error: scopesError } = useSWR<{ scopes: ExploreScope[] }>("/api/files/library/scopes", fetcher);
  const scopes = scopesData?.scopes ?? [];
  const requestedScope = searchParams.get("scope");
  const scope = scopes.find((entry) => entry.targetKey === requestedScope)?.targetKey ?? (!requestedScope ? scopes[0]?.targetKey : null);
  const reportId = searchParams.get("report");
  const { data: reportsData, error: reportsError } = useSWR<{ reports: Array<{ id: string; title: string }> }>(scope && exploreEnabled ? `/api/explore/reports?targetKey=${encodeURIComponent(scope)}` : null, fetcher);
  const report = reportsData?.reports.find((entry) => entry.id === reportId);
  const { data, error, isLoading, mutate } = useSWR<LibraryResponse>(scope ? `/api/files/library?targetKey=${encodeURIComponent(scope)}` : null, fetcher);
  const activeScope = scopes.find((entry) => entry.targetKey === scope);
  const files = (data?.files ?? []).filter((file) => file.originalName.toLowerCase().includes(search.toLowerCase()));
  const canEdit = data?.canEdit === true;
  const reportHref = scope && report ? `/explore/reports/${encodeURIComponent(report.id)}?scope=${encodeURIComponent(scope)}` : null;

  const attach = async (file: LibraryFileSummary) => {
    if (!report || !scope || linking) return;
    setLinking(file.id);
    try {
      const key = `/api/explore/reports/${encodeURIComponent(report.id)}/files`;
      await postJson(key, { fileId: file.id });
      await Promise.allSettled([mutate(), mutateCache(key)]);
      toast.success(`${file.originalName} attached to ${report.title}`);
    } catch (attachError) { toast.error(attachError instanceof Error ? attachError.message : "Could not attach the file"); }
    finally { setLinking(null); }
  };

  return <PageContainer>
    {reportHref && <Link href={reportHref} className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="h-4 w-4" />Back to {report?.title}</Link>}
    <div className="flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="flex items-center gap-2 text-xl font-semibold"><FolderOpen className="h-5 w-5" />Files</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Keep original uploads here and reuse them across reports. Prepare spreadsheets as tables, attach reference documents, or select files in a custom analysis.</p>
      </div>
    </div>
    <div className="mt-6 flex flex-wrap items-center gap-3">
      <Select value={scope ?? ""} disabled={uploading || !!linking} onValueChange={(value) => { setSearch(""); router.push(filesHref(value)); }}>
        <SelectTrigger className="w-72" aria-label="Study, order or project"><SelectValue placeholder="Choose a study, order or project" /></SelectTrigger>
        <SelectContent>{scopes.map((entry) => <SelectItem key={entry.targetKey} value={entry.targetKey}>{entry.label}</SelectItem>)}</SelectContent>
      </Select>
      <div className="relative min-w-48 flex-1"><Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" /><Input className="pl-9" aria-label="Search files" placeholder="Search files…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
      {canEdit && !!reportsData?.reports.length && <Select value={report?.id ?? "__none__"} disabled={uploading || !!linking} onValueChange={(value) => {
        if (scope) router.replace(filesHref(scope, value === "__none__" ? null : value));
      }}>
        <SelectTrigger className="w-64" aria-label="Use files in report"><SelectValue placeholder="Choose a report" /></SelectTrigger>
        <SelectContent><SelectItem value="__none__">Choose a report to attach files</SelectItem>{reportsData.reports.map((entry) => <SelectItem key={entry.id} value={entry.id}>{entry.title}</SelectItem>)}</SelectContent>
      </Select>}
    </div>
    {activeScope && <p className="mt-2 text-xs text-muted-foreground">Shared by reports in {activeScope.label}</p>}
    {report && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border bg-secondary/30 px-3 py-2 text-sm"><p>Adding to <strong>{report.title}</strong>. Attach as many references as you need, then return to the report.</p><Button asChild size="sm" variant="outline"><Link href={reportHref!}>Return to report</Link></Button></div>}
    {reportId && reportsData && !report && <p role="alert" className="mt-4 text-sm text-amber-700">The selected report is no longer available here. Choose another report, or <Link href={filesHref(scope!)} className="underline">continue with Files</Link>.</p>}
    {(scopesError || error || reportsError) && <p role="alert" className="mt-4 text-sm text-destructive">{scopesError?.message || error?.message || reportsError?.message}</p>}
    {scope && canEdit && <FileUploadPanel key={scope} targetKey={scope} onSaved={() => mutate()} onStart={() => setSearch("")} onBusyChange={setUploading} />}
    {!scope && scopesData && <p className="mt-6 text-sm text-muted-foreground">{requestedScope ? "This study or order is not available. Choose another above." : "Create a study or order before uploading files."}</p>}
    {isLoading && <Skeleton className="mt-6 h-32 w-full" />}
    {data && files.length === 0 && <div className="mt-6 rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      <FolderOpen className="mx-auto mb-3 h-8 w-8" />{search ? "No files match your search." : "Upload data tables, images, protocols, reference documents or any other files you want to use later."}
    </div>}
    {files.length > 0 && <div className="mt-6 overflow-x-auto rounded-lg border"><table role="table" className="block w-full text-left text-sm md:table">
      <thead className="hidden bg-secondary/40 text-xs text-muted-foreground md:table-header-group"><tr><th className="p-3 font-medium">File</th><th className="p-3 font-medium">Used in</th><th className="p-3 font-medium">Actions</th></tr></thead>
      <tbody role="rowgroup" className="block divide-y md:table-row-group">{files.map((file) => <tr role="row" key={file.id} id={`file-${file.id}`} className="block scroll-mt-24 target:bg-primary/5 md:table-row">
        <td role="cell" className="block p-3 align-top md:table-cell"><div className="flex items-start gap-2"><File className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" /><div><p className="break-all font-medium">{file.originalName}</p><p className="mt-1 text-xs text-muted-foreground">{formatFileSize(file.sizeBytes)} · {formatDateTime(file.createdAt)}</p></div></div></td>
        <td role="cell" className="block px-3 pb-2 align-top text-xs md:table-cell md:p-3"><div className="flex flex-col gap-1">
          {(file.datasets.length > 0 || file.reports.length > 0) && <span className="text-muted-foreground md:hidden">Used in</span>}
          {file.datasets.map((dataset) => <Link key={dataset.id} className="text-primary hover:underline" href={`/explore/datasets/${dataset.id}?scope=${encodeURIComponent(scope!)}`}><Table2 className="mr-1 inline h-3 w-3" />{dataset.name}</Link>)}
          {file.reports.map((entry) => <Link key={entry.id} className="text-primary hover:underline" href={`/explore/reports/${entry.id}?scope=${encodeURIComponent(scope!)}`}>{entry.title}</Link>)}
          {!file.datasets.length && !file.reports.length && <span className="text-muted-foreground">Available to use</span>}
        </div></td>
        <td role="cell" className="block px-3 pb-3 align-top md:table-cell md:p-3"><div className="flex flex-wrap gap-2">
          <Button asChild size="sm" variant="outline"><a href={`/api/files/library/${file.id}?download=1`}><Download className="mr-1 h-3.5 w-3.5" />Download</a></Button>
          {canEdit && exploreEnabled && file.canImportTable && <Button asChild size="sm" variant="outline"><Link href={`/explore/datasets/import?scope=${encodeURIComponent(scope!)}&file=${file.id}${report ? `&report=${report.id}` : ""}`}><Table2 className="mr-1 h-3.5 w-3.5" />Use as table</Link></Button>}
          {canEdit && report && <Button size="sm" variant="outline" disabled={!!linking || file.reports.some((entry) => entry.id === report.id && entry.attached)} onClick={() => void attach(file)}>{file.reports.some((entry) => entry.id === report.id && entry.attached) ? <><Check className="mr-1 h-3.5 w-3.5" />Attached</> : <>{linking === file.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Paperclip className="mr-1 h-3.5 w-3.5" />}Attach to report</>}</Button>}
          {canEdit && exploreEnabled && <Button asChild size="sm" variant="ghost"><Link href={`/explore/analyses/new?scope=${encodeURIComponent(scope!)}&kit=__blank__&file=${file.id}${report ? `&report=${report.id}` : ""}`}>Use in custom analysis</Link></Button>}
        </div></td>
      </tr>)}</tbody>
    </table></div>}
  </PageContainer>;
}
