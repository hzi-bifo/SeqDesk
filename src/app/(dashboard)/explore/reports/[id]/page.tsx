"use client";

import { Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { Check, ChevronRight, FileText, LayoutGrid, List, NotebookText, PanelRight, PanelRightClose, Pencil, Plus, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { ReportLoadingLayout } from "@/components/explore/ExploreLoading";
import { ExploreCanvas } from "@/components/explore/ExploreCanvas";
import { ExploreListView } from "@/components/explore/ExploreListView";
import { ExploreReport } from "@/components/explore/ExploreReport";
import { fetcher } from "@/lib/explore/client";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
import type { ReportView } from "@/lib/explore/reports";
import type { ExploreScope } from "@/lib/explore/types";
import { filesHref } from "@/lib/files/library-types";
import { ReportSourceFiles } from "@/components/explore/ReportSourceFiles";

type EditView = "canvas" | "page" | "list";

const DESKTOP_PANEL_QUERY = "(min-width: 1024px)";
function subscribeToPanelBreakpoint(onChange: () => void) {
  const media = window.matchMedia(DESKTOP_PANEL_QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}
const desktopPanelSnapshot = () => window.matchMedia(DESKTOP_PANEL_QUERY).matches;
const serverPanelSnapshot = () => false;

export default function ReportPage() {
  return (
    <Suspense fallback={<ReportLoadingLayout />}>
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
  // Below the sidebar breakpoint the same panel opens as a drawer over the page.
  const [drawer, setDrawer] = useState(false);
  const [drawerEl, setDrawerEl] = useState<HTMLElement | null>(null);
  const [actionsEl, setActionsEl] = useState<HTMLElement | null>(null);
  const panelToggleRef = useRef<HTMLButtonElement>(null);
  // A drawer is a temporary mobile overlay, not a preference. Do not reopen
  // it over a still-open data picker when the window becomes narrow again.
  const subscribeToPanel = useCallback((onChange: () => void) => subscribeToPanelBreakpoint(() => {
    if (desktopPanelSnapshot()) setDrawer(false);
    onChange();
  }), []);
  const isDesktop = useSyncExternalStore(subscribeToPanel, desktopPanelSnapshot, serverPanelSnapshot);

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
        query.set("view", next.view ?? "page");
      }
      router.replace(`/explore/reports/${reportId}?${query.toString()}`);
    },
    [reportId, router, scope]
  );

  if (error) {
    return (
      <PageContainer>
        <p role="alert" className="text-sm text-destructive">Could not load the report: {String(error.message)}</p>
        <Button variant="outline" className="mt-3 mr-3" onClick={() => void mutate()}>Retry loading report</Button>
        <Button asChild variant="link" className="px-0"><Link href={`/explore${scopeQuery}`}>Back to the reports</Link></Button>
      </PageContainer>
    );
  }
  if (!report) {
    return <ReportLoadingLayout view={mode === "edit" ? view : "page"} sidebar={mode === "edit" && view === "page" && panelPref === "shown"} />;
  }
  const scopeKey = report.targetKey;
  const panelOpen = mode === "edit" && view === "page" && canEdit && panelPref === "shown";
  const desktopPanelOpen = panelOpen && isDesktop;
  const drawerOpen = !isDesktop && drawer && mode === "edit" && view === "page" && canEdit;
  const openCanvas = () => go({ mode: "edit", view: "canvas" });
  const openEditor = () => go({ mode: "edit", view: "page" });
  const done = () => go({ mode: "report" });

  // Report actions always stay in the document header, independent of the sidebar.
  const reportActions = (
    <div className="ml-auto flex min-h-9 min-w-0 max-w-full flex-wrap items-center justify-end gap-2" role="group" aria-label="Report actions">
      {mode === "edit" && canEdit && view !== "page" && (
        <>
          <Button asChild variant="outline" size="sm" className="h-8" title="Choose existing files or upload source data and references">
            <Link href={filesHref(scopeKey, reportId)}>
              <Upload className="h-3.5 w-3.5 lg:mr-1.5" />
              <span className="hidden lg:inline">Add from Files</span>
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
        <div ref={setActionsEl} className="flex min-w-0 max-w-full flex-wrap items-center justify-end gap-1" />
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
      {mode === "edit" && view === "page" && canEdit && !desktopPanelOpen && (
        isDesktop ? (
          <Button ref={panelToggleRef} variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => setPanelPref("shown")} aria-label="Show the panel" title="Show the panel with figures, tables and variables">
            <PanelRight className="h-4 w-4" />
          </Button>
        ) : (
          <DialogTrigger asChild>
            <Button ref={panelToggleRef} variant="ghost" size="sm" className="h-8 w-8 px-0" aria-label="Open the panel" title="Open the panel with figures, tables and variables">
              <PanelRight className="h-4 w-4" />
            </Button>
          </DialogTrigger>
        )
      )}
    </div>
  );

  return (
    <Dialog open={drawerOpen} onOpenChange={setDrawer}>
    <div className="flex min-w-0 items-start overflow-x-clip">
    <div className="min-w-0 flex-1">
    <PageContainer className="@container/report-header min-w-0 border-b py-3 md:py-3">
      {/* The sidebar starts alongside this bar, never below it. */}
      <div className="flex min-h-9 flex-wrap items-center gap-2" role="group" aria-label="Report toolbar">
        <nav className="flex min-w-4 flex-1 items-center gap-1.5 overflow-hidden text-sm" aria-label="Breadcrumb">
          <Link href={`/explore${scopeQuery}`} aria-label="Reports" className="inline-flex shrink-0 items-center gap-1.5 font-medium text-muted-foreground hover:text-foreground">
            <NotebookText className="h-4 w-4" />
            <span className="hidden @[24rem]/report-header:inline">Reports</span>
          </Link>
          {activeScope && (
            <span className="hidden min-w-0 items-center gap-1.5 @[44rem]/report-header:flex">
              <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
              <span className="max-w-56 truncate font-medium text-muted-foreground" title={activeScope.label}>{activeScope.label}</span>
            </span>
          )}
        </nav>
        {mode === "edit" && (
          <div className="ml-auto flex h-8 shrink-0 items-center rounded-md border bg-background p-0.5 text-xs" role="group" aria-label="View">
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
                aria-label={tab.label}
                title={tab.hint}
              >
                <tab.icon className="h-3.5 w-3.5" />
                <span className="hidden @[34rem]/report-header:inline">{tab.label}</span>
              </button>
            ))}
          </div>
        )}
        {reportActions}
      </div>
    </PageContainer>

    <PageContainer className="min-w-0 overflow-x-clip pt-0 md:pt-0">
      {/* One instance for reading and editing, so leaving the editor saves what is still pending instead of unmounting it. */}
      {(mode === "report" || (mode === "edit" && view === "page")) && (
        <ExploreReport reportId={reportId} scope={scopeKey} canEdit={canEdit} editing={mode === "edit" && canEdit} onDone={done} onOpenCanvas={openCanvas} panelContainer={desktopPanelOpen ? panelEl : drawerOpen ? drawerEl : null} actionsContainer={actionsEl} />
      )}
      {mode === "edit" && view === "canvas" && (
        <div className="mt-3">
          <ExploreCanvas scope={scopeKey} reportId={reportId} fillViewport focusNodeId={focus} />
        </div>
      )}
      {mode === "edit" && view === "list" && <ExploreListView scope={scopeKey} reportId={reportId} />}
      <ReportSourceFiles reportId={reportId} scope={scopeKey} canEdit={canEdit} />
    </PageContainer>
    </div>
    {panelOpen && (
      <aside className="sticky top-0 hidden h-[calc(100dvh-var(--seqdesk-footer-height,2.5rem))] w-80 shrink-0 flex-col border-l bg-card lg:flex" aria-label="Add to the page">
        <div className="border-b px-3 py-3">
          <div className="flex min-h-9 items-center justify-between gap-2">
            <h2 className="text-xs font-medium">Add to the page</h2>
            <Button ref={panelToggleRef} variant="ghost" size="sm" className="h-8 w-8 px-0" onClick={() => setPanelPref("hidden")} aria-label="Hide the panel" title="Hide the panel">
              <PanelRightClose className="h-4 w-4" />
            </Button>
          </div>
        </div>
        <div ref={setPanelEl} className="min-h-0 flex-1 overflow-y-auto overscroll-contain" />
      </aside>
    )}
    <DialogContent
      data-report-panel-drawer
      aria-modal="true"
      showCloseButton={false}
      className="left-auto right-0 top-0 flex h-dvh w-80 max-w-[90vw] translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-y-0 border-r-0 p-0 data-[state=open]:animate-none data-[state=closed]:animate-none"
      onCloseAutoFocus={event => {
        event.preventDefault();
        // A data picker can remain open when a resize closes this drawer.
        // Keep its focus; otherwise return to the current visible panel toggle.
        const otherDialog = document.activeElement?.closest('[role="dialog"]');
        if (otherDialog && !otherDialog.hasAttribute("data-report-panel-drawer")) return;
        panelToggleRef.current?.focus({ preventScroll: true });
      }}
    >
      <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <DialogTitle className="flex-1 text-xs font-medium">Add to the page</DialogTitle>
        <DialogDescription className="sr-only">Browse saved data, figures and tables to add to this report.</DialogDescription>
        <DialogClose asChild><Button type="button" variant="ghost" size="sm" className="h-8 w-8 px-0" aria-label="Close the panel">
          <PanelRightClose className="h-4 w-4" />
        </Button></DialogClose>
      </div>
      <div ref={setDrawerEl} className="min-h-0 flex-1 overflow-y-auto overscroll-contain pb-[env(safe-area-inset-bottom)]" />
    </DialogContent>
    </div>
    </Dialog>
  );
}
