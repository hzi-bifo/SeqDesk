"use client";

import { Suspense, useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import useSWR from "swr";
import { BookOpen, FolderOpen, FolderPlus, Inbox, Info, Loader2, MoreHorizontal, NotebookText, Pencil, Plus, Trash2, Upload } from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/toast";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useStoredPreference } from "@/lib/explore/use-stored-preference";
import { fetcher, formatDateTime, postJson, SCOPE_STORAGE_KEY } from "@/lib/explore/client";
import { isValidTargetKey } from "@/lib/explore/target-key";
import type { ReportSummary } from "@/lib/explore/reports";
import type { ExploreScope } from "@/lib/explore/types";

export default function ExplorePage() {
  return (
    <Suspense fallback={<PageContainer><Skeleton className="h-8 w-48" /></PageContainer>}>
      <ReportsHome />
    </Suspense>
  );
}

/**
 * The reports of a scope: one card per report, and the way to a new one. A
 * report is a page for others with its own analysis steps behind it; the
 * tables of the scope are shared by all of them.
 */
function ReportsHome() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedScope = searchParams.get("scope");
  const [storedScope, setStoredScope] = useStoredPreference<string>(SCOPE_STORAGE_KEY, "");
  const [projectDialog, setProjectDialog] = useState<{ name: string; description: string } | null>(null);
  const [creatingProject, setCreatingProject] = useState(false);
  const [creating, setCreating] = useState(false);
  const [renaming, setRenaming] = useState<{ id: string; title: string } | null>(null);
  const [deleting, setDeleting] = useState<ReportSummary | null>(null);
  const [busy, setBusy] = useState(false);

  const { data: scopesData, error: scopesError, isLoading: scopesLoading, mutate: mutateScopes } = useSWR<{ scopes: ExploreScope[] }>(
    "/api/explore/scopes",
    fetcher
  );
  const scopes = useMemo(() => scopesData?.scopes ?? [], [scopesData]);

  // The scope comes from the URL, else from the last choice, else the first study or order.
  const scope = useMemo(() => {
    if (scopes.length === 0) return null;
    const candidates = [requestedScope, storedScope].filter((value): value is string => Boolean(value && isValidTargetKey(value)));
    return candidates.find((value) => scopes.some((entry) => entry.targetKey === value)) ?? scopes[0].targetKey;
  }, [scopes, requestedScope, storedScope]);

  // The URL names the scope so the sidebar shows the study or order it belongs to.
  useEffect(() => {
    if (scope && scope !== requestedScope) router.replace(`/explore?scope=${encodeURIComponent(scope)}`);
  }, [scope, requestedScope, router]);

  const selectScope = useCallback(
    (value: string) => {
      setStoredScope(value);
      router.replace(`/explore?scope=${encodeURIComponent(value)}`);
    },
    [router, setStoredScope]
  );

  const activeScope = scopes.find((entry) => entry.targetKey === scope) ?? null;
  const canEdit = activeScope?.access === "write";
  const scopeQuery = scope ? `?scope=${encodeURIComponent(scope)}` : "";
  const reportsKey = scope ? `/api/explore/reports?targetKey=${encodeURIComponent(scope)}` : null;
  const { data: reportsData, isLoading: reportsLoading, mutate: mutateReports } = useSWR<{ reports: ReportSummary[] }>(reportsKey, fetcher);
  const reports = reportsData?.reports ?? [];

  const createReport = async () => {
    if (!scope) return;
    setCreating(true);
    try {
      const { report } = await postJson<{ report: ReportSummary }>("/api/explore/reports", { targetKey: scope });
      await mutateReports();
      router.push(`/explore/reports/${report.id}${scopeQuery}&mode=edit&view=canvas`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not create the report");
      setCreating(false);
    }
  };

  const rename = async () => {
    if (!renaming || !renaming.title.trim()) return;
    setBusy(true);
    try {
      await postJson(`/api/explore/reports/${renaming.id}`, { title: renaming.title.trim() }, "PATCH");
      await mutateReports();
      setRenaming(null);
      toast.success("Report renamed");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename the report");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!deleting) return;
    setBusy(true);
    try {
      await postJson(`/api/explore/reports/${deleting.id}`, undefined, "DELETE");
      await mutateReports();
      setDeleting(null);
      toast.success("Report deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the report");
    } finally {
      setBusy(false);
    }
  };

  return (
    <PageContainer className="pt-3 md:pt-3">
      {/* One slim row: what you are looking at and what you can add. */}
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="inline-flex items-center gap-1.5 text-sm font-semibold">
          <NotebookText className="h-4 w-4 text-muted-foreground" />
          Reports
        </h1>
        <span className="h-5 w-px bg-border" aria-hidden />
        {scopesLoading ? (
          <Skeleton className="h-8 w-56" />
        ) : (
          <Select value={scope ?? undefined} onValueChange={selectScope}>
            <SelectTrigger className="h-8 max-w-[22rem] gap-1.5 border-transparent bg-transparent px-1.5 text-sm font-medium shadow-none hover:bg-secondary" aria-label="Reports scope">
              {activeScope ? (
                <span className="inline-flex min-w-0 items-center gap-1.5">
                  {activeScope.type === "study" ? (
                    <BookOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : activeScope.type === "order" ? (
                    <Inbox className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : activeScope.type === "project" ? (
                    <FolderOpen className="h-4 w-4 shrink-0 text-muted-foreground" />
                  ) : (
                    <NotebookText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{activeScope.label}</span>
                </span>
              ) : (
                <SelectValue placeholder={scopes.length ? "Choose a study or order" : "No studies or orders yet"} />
              )}
            </SelectTrigger>
            <SelectContent>
              {(["project", "study", "order", "workspace"] as const).map((type) => {
                const entries = scopes.filter((entry) => entry.type === type);
                if (entries.length === 0) return null;
                return (
                  <SelectGroup key={type}>
                    <SelectLabel>{type === "study" ? "Studies" : type === "order" ? "Sequencing orders" : type === "project" ? "Projects" : "Workspace"}</SelectLabel>
                    {entries.map((entry) => (
                      <SelectItem key={entry.targetKey} value={entry.targetKey}>
                        {entry.label}
                        {entry.detail && <span className="ml-1.5 text-xs text-muted-foreground">{entry.detail}</span>}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                );
              })}
            </SelectContent>
          </Select>
        )}
        <button
          type="button"
          onClick={() => setProjectDialog({ name: "", description: "" })}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground"
          aria-label="New project"
          title="New project: a scope of its own for tables that belong to no study or order"
        >
          <FolderPlus className="h-4 w-4" />
        </button>
        <span className="flex-1" />
        {activeScope && canEdit && (
          <>
            <Button asChild variant="outline" size="sm" className="h-8" title="Import a TSV, CSV or Excel file as a table of this scope">
              <Link href={`/explore/datasets/import${scopeQuery}`}>
                <Upload className="h-3.5 w-3.5 lg:mr-1.5" />
                <span className="hidden lg:inline">Import table</span>
              </Link>
            </Button>
            <Button size="sm" className="h-8" onClick={() => void createReport()} disabled={creating} title="A new report with its own analysis steps">
              {creating ? <Loader2 className="h-3.5 w-3.5 animate-spin lg:mr-1.5" /> : <Plus className="h-3.5 w-3.5 lg:mr-1.5" />}
              <span className="hidden lg:inline">New report</span>
            </Button>
          </>
        )}
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" className="rounded-md p-1.5 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label="About reports" title="About reports">
              <Info className="h-4 w-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 text-xs">
            <p className="font-medium">Reports</p>
            <p className="mt-1 text-muted-foreground">
              A report is a page for others, made of the figures and tables its own analysis steps produce, with your text around them. A study or order can have several, each independent; the tables they read are shared.
            </p>
          </PopoverContent>
        </Popover>
      </div>

      {scopesError && <p className="mt-4 text-sm text-destructive">Could not load your studies and orders: {String(scopesError.message)}</p>}

      {!scopesLoading && scopes.length === 0 && (
        <div className="mt-4 rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground">
          <p>Reports belong to a study or a sequencing order you own, or to a project of their own.</p>
          <Button variant="outline" size="sm" className="mt-4" onClick={() => setProjectDialog({ name: "", description: "" })}>
            <FolderPlus className="mr-2 h-4 w-4" />
            New project
          </Button>
        </div>
      )}

      {activeScope && reportsLoading && !reportsData && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Skeleton className="h-28 w-full" />
          <Skeleton className="h-28 w-full" />
        </div>
      )}

      {activeScope && reportsData && reports.length === 0 && (
        <div className="mt-6 rounded-lg border border-dashed p-10 text-center">
          <NotebookText className="mx-auto h-8 w-8 text-muted-foreground" />
          <p className="mt-3 text-sm font-medium">No reports yet</p>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
            A report holds its own analysis steps and the page they fill. Start one, bring in a table, and analyse it on the canvas.
          </p>
          {canEdit && (
            <Button className="mt-4" onClick={() => void createReport()} disabled={creating}>
              {creating ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
              Create new report
            </Button>
          )}
        </div>
      )}

      {activeScope && reports.length > 0 && (
        <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {reports.map((report) => (
            <div key={report.id} className="relative rounded-lg border bg-card p-4 transition-colors hover:bg-secondary/30">
              <Link href={`/explore/reports/${report.id}${scopeQuery}`} className="block pr-8">
                <h2 className="truncate font-semibold">{report.title}</h2>
                <p className="mt-1 text-xs text-muted-foreground">
                  {report.analysisCount} analysis step{report.analysisCount === 1 ? "" : "s"}, {report.blockCount > 0 ? `${report.blockCount} block${report.blockCount === 1 ? "" : "s"} on the page` : "page not written yet"}
                </p>
                <p className="mt-3 text-xs text-muted-foreground">Changed {formatDateTime(report.updatedAt)}</p>
              </Link>
              {canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button type="button" className="absolute right-2 top-2 rounded-md p-1 text-muted-foreground hover:bg-secondary hover:text-foreground" aria-label={`Actions for ${report.title}`}>
                      <MoreHorizontal className="h-4 w-4" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem onSelect={() => router.push(`/explore/reports/${report.id}${scopeQuery}&mode=edit&view=page`)}>
                      <Pencil className="mr-2 h-4 w-4" /> Edit
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setRenaming({ id: report.id, title: report.title })}>
                      <Pencil className="mr-2 h-4 w-4" /> Rename
                    </DropdownMenuItem>
                    <DropdownMenuItem className="text-destructive focus:text-destructive" onSelect={() => setDeleting(report)}>
                      <Trash2 className="mr-2 h-4 w-4" /> Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          ))}
        </div>
      )}

      <Dialog open={renaming !== null} onOpenChange={(open) => !open && setRenaming(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Rename report</DialogTitle>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={(event) => {
              event.preventDefault();
              void rename();
            }}
          >
            <Input value={renaming?.title ?? ""} onChange={(event) => setRenaming((current) => (current ? { ...current, title: event.target.value } : current))} aria-label="Report title" autoFocus />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setRenaming(null)} disabled={busy}>Cancel</Button>
              <Button type="submit" disabled={busy || !renaming?.title.trim()}>Save</Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={deleting !== null} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete {deleting?.title}?</DialogTitle>
            <DialogDescription>
              {deleting && deleting.analysisCount > 0
                ? `This removes its ${deleting.analysisCount} analysis step${deleting.analysisCount === 1 ? "" : "s"} with their runs and outputs. The tables of the scope stay.`
                : "This removes the report and its page. The tables of the scope stay."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setDeleting(null)} disabled={busy}>Cancel</Button>
            <Button type="button" variant="destructive" onClick={() => void remove()} disabled={busy}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Trash2 className="mr-2 h-4 w-4" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={projectDialog !== null} onOpenChange={(open) => !open && setProjectDialog(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>New project</DialogTitle>
            <DialogDescription>A scope of its own: bring in tables, analyse them and write reports, without a study or sequencing order behind it.</DialogDescription>
          </DialogHeader>
          <form
            className="space-y-3"
            onSubmit={async (event) => {
              event.preventDefault();
              if (!projectDialog || !projectDialog.name.trim()) return;
              setCreatingProject(true);
              try {
                const result = await postJson<{ project: { targetKey: string } }>("/api/explore/projects", { name: projectDialog.name.trim(), description: projectDialog.description.trim() || undefined });
                await mutateScopes();
                setProjectDialog(null);
                selectScope(result.project.targetKey);
                toast.success("Project created");
              } catch (error) {
                toast.error(error instanceof Error ? error.message : "Could not create the project");
              } finally {
                setCreatingProject(false);
              }
            }}
          >
            <label className="block text-sm">
              <span className="font-medium">Name</span>
              <Input className="mt-1" value={projectDialog?.name ?? ""} onChange={(event) => setProjectDialog((current) => (current ? { ...current, name: event.target.value } : current))} placeholder="Clinical metagenomics cohort" autoFocus />
            </label>
            <label className="block text-sm">
              <span className="font-medium">Description</span>
              <Textarea className="mt-1" rows={2} value={projectDialog?.description ?? ""} onChange={(event) => setProjectDialog((current) => (current ? { ...current, description: event.target.value } : current))} placeholder="What the tables in this project are about" />
            </label>
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setProjectDialog(null)} disabled={creatingProject}>Cancel</Button>
              <Button type="submit" disabled={creatingProject || !projectDialog?.name.trim()}>
                {creatingProject ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <FolderPlus className="mr-2 h-4 w-4" />}
                Create project
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
