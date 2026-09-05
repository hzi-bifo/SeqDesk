"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Check, ChevronRight, FileText, Info, LayoutGrid, List, NotebookText, Pencil, Plus, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "@/components/ui/toast";
import { ExploreCanvas } from "@/components/explore/ExploreCanvas";
import { ExploreListView } from "@/components/explore/ExploreListView";
import { ExploreReport } from "@/components/explore/ExploreReport";
import { fetcher, postJson } from "@/lib/explore/client";
import type { ReportView } from "@/lib/explore/reports";
import type { ExploreScope } from "@/lib/explore/types";

type EditView = "canvas" | "page" | "list";

export default function ReportPage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}>
      <ReportScreen />
    </Suspense>
  );
}

/**
 * One report: its page for readers, and behind a single Edit button the
 * canvas of analysis steps, the page editor and the plain lists.
 */
function ReportScreen() {
  const params = useParams<{ id: string }>();
  const reportId = params.id;
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedScope = searchParams.get("scope");
  const mode: "report" | "edit" = searchParams.get("mode") === "edit" ? "edit" : "report";
  const requestedView = searchParams.get("view");
  const view: EditView = requestedView === "page" || requestedView === "list" ? requestedView : "canvas";
  const focus = searchParams.get("focus");

  const key = `/api/explore/reports/${encodeURIComponent(reportId)}`;
  const { data, error, mutate } = useSWR<{ report: ReportView }>(key, fetcher);
  const { data: scopesData } = useSWR<{ scopes: ExploreScope[] }>("/api/explore/scopes", fetcher);
  const report = data?.report ?? null;
  const scope = report?.targetKey ?? (requestedScope || null);
  const activeScope = scope ? (scopesData?.scopes.find((entry) => entry.targetKey === scope) ?? null) : null;
  const canEdit = activeScope?.access === "write";
  const scopeQuery = scope ? `?scope=${encodeURIComponent(scope)}` : "";

  // The URL names the scope so the sidebar shows the study or order the report belongs to.
  useEffect(() => {
    if (report && requestedScope !== report.targetKey) {
      const next = new URLSearchParams(searchParams.toString());
      next.set("scope", report.targetKey);
      router.replace(`/explore/reports/${reportId}?${next.toString()}`);
    }
  }, [report, requestedScope, reportId, router, searchParams]);

  const go = useCallback(
    (next: { mode: "report" | "edit"; view?: EditView }) => {
      const query = new URLSearchParams();
      if (scope) query.set("scope", scope);
      if (next.mode === "edit") {
        query.set("mode", "edit");
        query.set("view", next.view ?? "canvas");
      }
      router.replace(`/explore/reports/${reportId}?${query.toString()}`);
    },
    [reportId, router, scope]
  );

  if (error) {
    return (
      <PageContainer>
        <p className="text-sm text-destructive">Could not load the report: {String(error.message)}</p>
        <Button asChild variant="link" className="px-0"><Link href={`/explore${scopeQuery}`}>Back to the reports</Link></Button>
      </PageContainer>
    );
  }
  if (!report) {
    return (
      <PageContainer>
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-4 h-40 w-full" />
      </PageContainer>
    );
  }
  const scopeKey = report.targetKey;
  const openCanvas = () => go({ mode: "edit", view: "canvas" });
  const done = () => go({ mode: "report" });

  return (
    <PageContainer className="pt-3 md:pt-3">
      {/* One slim row: where you are, how you look at it, and what you can add. */}
      <div className="flex flex-wrap items-center gap-2">
        <Link href={`/explore${scopeQuery}`} className="inline-flex items-center gap-1.5 text-sm font-semibold text-muted-foreground hover:text-foreground" title={activeScope ? `Reports of ${activeScope.label}` : "Reports"}>
          <NotebookText className="h-4 w-4" />
          Reports
        </Link>
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {mode === "edit" && canEdit ? (
          <TitleEditor
            key={report.title}
            title={report.title}
            onRename={async (title) => {
              await postJson(key, { title }, "PATCH");
              await mutate();
            }}
          />
        ) : (
          <h1 className="max-w-md truncate text-sm font-semibold">{report.title}</h1>
        )}
        {mode === "edit" && (
          <>
            <span className="h-5 w-px bg-border" aria-hidden />
            <div className="flex rounded-md border text-xs" role="group" aria-label="View">
              <button type="button" onClick={() => go({ mode: "edit", view: "canvas" })} className={`inline-flex items-center gap-1 px-2 py-1.5 ${view === "canvas" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={view === "canvas"} title="The analysis steps: tables, analyses and their outputs as connected cards">
                <LayoutGrid className="h-3.5 w-3.5" /> Canvas
              </button>
              <button type="button" onClick={() => go({ mode: "edit", view: "page" })} className={`inline-flex items-center gap-1 px-2 py-1.5 ${view === "page" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={view === "page"} title="Arrange the page: text, figures, tables and filters">
                <FileText className="h-3.5 w-3.5" /> Page
              </button>
              <button type="button" onClick={() => go({ mode: "edit", view: "list" })} className={`inline-flex items-center gap-1 px-2 py-1.5 ${view === "list" ? "bg-secondary font-medium" : "text-muted-foreground"}`} aria-pressed={view === "list"} title="Tables and analysis steps as lists">
                <List className="h-3.5 w-3.5" /> List
              </button>
            </div>
          </>
        )}
        <span className="flex-1" />
        {mode === "edit" && canEdit && (
          <>
            <Button asChild variant="outline" size="sm" className="h-8" title="Import a TSV, CSV or Excel file as a table">
              <Link href={`/explore/datasets/import${scopeQuery}`}>
                <Upload className="h-3.5 w-3.5 lg:mr-1.5" />
                <span className="hidden lg:inline">Import table</span>
              </Link>
            </Button>
            <Button asChild variant="outline" size="sm" className="h-8" title="Start an analysis step from a template or a blank script">
              <Link href={`/explore/analyses/new${scopeQuery}&report=${encodeURIComponent(reportId)}`}>
                <Plus className="h-3.5 w-3.5 lg:mr-1.5" />
                <span className="hidden lg:inline">New analysis</span>
              </Link>
            </Button>
            <Button size="sm" className="h-8" onClick={done} title="Back to the report">
              <Check className="h-3.5 w-3.5 lg:mr-1.5" />
              <span className="hidden lg:inline">Done</span>
            </Button>
          </>
        )}
        {mode === "report" && canEdit && (
          <Button size="sm" className="h-8" onClick={openCanvas} title="Edit the analysis steps and the page">
            <Pencil className="h-3.5 w-3.5 lg:mr-1.5" />
            <span className="hidden lg:inline">Edit</span>
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="About reports" title="About reports">
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs">
            <p className="font-medium">A report</p>
            <p className="mt-1 text-muted-foreground">
              The page is what others read: figures, tables and your text. Behind Edit are the analysis steps that produce them.
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li><span className="font-medium text-foreground">Canvas</span> shows the tables of the scope, this report&apos;s analyses and their outputs as connected cards.</li>
              <li><span className="font-medium text-foreground">Page</span> is where the outputs are arranged with text and filters.</li>
              <li><span className="font-medium text-foreground">List</span> lists tables and analysis steps.</li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {mode === "report" && <ExploreReport reportId={reportId} scope={scopeKey} canEdit={canEdit} editing={false} onDone={done} onOpenCanvas={openCanvas} />}
      {mode === "edit" && view === "page" && <ExploreReport reportId={reportId} scope={scopeKey} canEdit={canEdit} editing={canEdit} onDone={done} onOpenCanvas={openCanvas} />}
      {mode === "edit" && view === "canvas" && (
        <div className="mt-3">
          <ExploreCanvas scope={scopeKey} reportId={reportId} fillViewport focusNodeId={focus} />
        </div>
      )}
      {mode === "edit" && view === "list" && <ExploreListView scope={scopeKey} reportId={reportId} />}
    </PageContainer>
  );
}

/** The report's title as an input: leave the field or press Enter to rename. */
function TitleEditor({ title, onRename }: { title: string; onRename: (title: string) => Promise<void> }) {
  const [value, setValue] = useState(title);
  const commit = async () => {
    const next = value.trim();
    if (!next || next === title) {
      setValue(title);
      return;
    }
    try {
      await onRename(next);
      toast.success("Report renamed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename the report");
      setValue(title);
    }
  };
  return (
    <Input
      value={value}
      onChange={(event) => setValue(event.target.value)}
      onBlur={() => void commit()}
      onKeyDown={(event) => {
        if (event.key === "Enter") (event.target as HTMLInputElement).blur();
      }}
      className="h-8 max-w-sm text-sm font-semibold"
      aria-label="Report title"
    />
  );
}
