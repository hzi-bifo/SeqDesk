"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Check, ChevronRight, FileText, Info, LayoutGrid, List, NotebookText, PanelRight, PanelRightClose, Pencil, Plus, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Skeleton } from "@/components/ui/skeleton";
import { ExploreCanvas } from "@/components/explore/ExploreCanvas";
import { ExploreListView } from "@/components/explore/ExploreListView";
import { ExploreReport } from "@/components/explore/ExploreReport";
import { fetcher } from "@/lib/explore/client";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
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
  // Edit opens the page editor; the analysis steps (canvas) and the lists are one tab further in.
  const view: EditView = requestedView === "canvas" || requestedView === "list" ? requestedView : "page";
  const focus = searchParams.get("focus");
  // The right sidebar of the page editor: figures, tables, views and variables; hidden and shown like the left one.
  const [panelPref, setPanelPref] = useStoredPreference<"shown" | "hidden">("seqdesk:explore:page-panel", "shown", ["shown", "hidden"]);
  const [panelEl, setPanelEl] = useState<HTMLElement | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);

  const key = `/api/explore/reports/${encodeURIComponent(reportId)}`;
  const { data, error } = useSWR<{ report: ReportView }>(key, fetcher);
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
        query.set("view", next.view ?? "page");
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
  const panelOpen = mode === "edit" && view === "page" && canEdit && panelPref === "shown";
  const openCanvas = () => go({ mode: "edit", view: "canvas" });
  const openEditor = () => go({ mode: "edit", view: "page" });
  const done = () => go({ mode: "report" });

  return (
    <div className="flex items-start overflow-x-clip">
    <PageContainer className="min-w-0 flex-1 overflow-x-clip pt-3 md:pt-3">
      {/* One slim bar: where you are, how you look at it, and the actions. The title lives in the document below. */}
      <div className="flex h-9 items-center gap-2">
        <nav className="flex min-w-24 shrink items-center gap-1.5 overflow-hidden text-sm" aria-label="Breadcrumb">
          <Link href={`/explore${scopeQuery}`} className="inline-flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground">
            <NotebookText className="h-4 w-4" />
            Reports
          </Link>
          {activeScope && (
            <span className="hidden shrink-0 items-center gap-1.5 xl:flex">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="max-w-56 truncate font-medium text-muted-foreground" title={activeScope.label}>{activeScope.label}</span>
            </span>
          )}
        </nav>
        <span className="flex-1" />
        {mode === "edit" && (
          <div className="flex h-8 items-center rounded-md border bg-background p-0.5 text-xs" role="group" aria-label="View">
            {(
              [
                { id: "page", label: "Page", icon: FileText, hint: "Arrange the page: text, figures, tables and filters" },
                { id: "canvas", label: "Canvas", icon: LayoutGrid, hint: "The analysis steps: tables, analyses and their outputs as connected cards" },
                { id: "list", label: "List", icon: List, hint: "Tables and analysis steps as lists" },
              ] as const
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => go({ mode: "edit", view: tab.id })}
                className={`inline-flex h-7 items-center gap-1.5 rounded px-2.5 ${view === tab.id ? "bg-secondary font-medium text-foreground" : "text-muted-foreground hover:text-foreground"}`}
                aria-pressed={view === tab.id}
                title={tab.hint}
              >
                <tab.icon className="h-3.5 w-3.5" />
                <span className="hidden sm:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        )}
        {mode === "edit" && canEdit && view !== "page" && (
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
          </>
        )}
        {(mode === "report" || view === "page") && (
          /* Filled by the page: Undo and the save state while editing, Start over and Share otherwise. */
          <div ref={setActionsEl} className="flex items-center gap-1" />
        )}
        {mode === "edit" && view === "page" && canEdit && (
          <>
            <Button variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => setPanelPref(panelPref === "shown" ? "hidden" : "shown")} aria-pressed={panelPref === "shown"} aria-label={panelPref === "shown" ? "Hide the panel" : "Show the panel"} title="Show or hide the panel with figures, tables and variables">
              <PanelRight className="h-4 w-4" />
            </Button>
          </>
        )}
        {mode === "edit" && canEdit && (
          <Button size="sm" className="h-8" onClick={done} title="Back to the report; changes are saved as you make them">
            <Check className="h-3.5 w-3.5 mr-1.5" />
            Done
          </Button>
        )}
        {mode === "report" && canEdit && (
          <Button size="sm" className="h-8" onClick={openEditor} title="Edit the page; the analysis steps are behind the Canvas tab">
            <Pencil className="h-3.5 w-3.5 mr-1.5" />
            Edit
          </Button>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-8 w-8 px-0 text-muted-foreground" aria-label="About reports" title="About reports">
              <Info className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs">
            <p className="font-medium">A report</p>
            <p className="mt-1 text-muted-foreground">
              The page is what others read: figures, tables and your text. Behind Edit are the analysis steps that produce them. Figures and tables follow the latest run of their analysis.
            </p>
            <ul className="mt-2 space-y-1 text-muted-foreground">
              <li><span className="font-medium text-foreground">Page</span> is where the outputs are arranged with text and filters.</li>
              <li><span className="font-medium text-foreground">Canvas</span> shows the tables of the scope, this report&apos;s analyses and their outputs as connected cards.</li>
              <li><span className="font-medium text-foreground">List</span> lists tables and analysis steps.</li>
            </ul>
          </PopoverContent>
        </Popover>
      </div>

      {mode === "report" && <ExploreReport reportId={reportId} scope={scopeKey} canEdit={canEdit} editing={false} onDone={done} onOpenCanvas={openCanvas} actionsContainer={actionsEl} />}
      {mode === "edit" && view === "page" && (
        <ExploreReport reportId={reportId} scope={scopeKey} canEdit={canEdit} editing={canEdit} onDone={done} onOpenCanvas={openCanvas} panelContainer={panelOpen ? panelEl : null} actionsContainer={actionsEl} />
      )}
      {mode === "edit" && view === "canvas" && (
        <div className="mt-3">
          <ExploreCanvas scope={scopeKey} reportId={reportId} fillViewport focusNodeId={focus} />
        </div>
      )}
      {mode === "edit" && view === "list" && <ExploreListView scope={scopeKey} reportId={reportId} />}
    </PageContainer>
    {panelOpen && (
      <aside className="sticky top-0 hidden h-screen w-80 shrink-0 flex-col border-l bg-card lg:flex" aria-label="Add to the page">
        <div className="flex items-center gap-2 border-b px-3 py-2 text-xs font-medium">
          <span>Add to the page</span>
          <span className="flex-1" />
          <button type="button" onClick={() => setPanelPref("hidden")} className="rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="Hide the panel" title="Hide the panel">
            <PanelRightClose className="h-4 w-4" />
          </button>
        </div>
        <div ref={setPanelEl} className="min-h-0 flex-1 overflow-y-auto" />
      </aside>
    )}
    </div>
  );
}

