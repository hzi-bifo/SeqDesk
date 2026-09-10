"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSWRConfig } from "swr";
import { ExternalLink, FileText, LayoutGrid, Loader2, MoreHorizontal, Pencil, TextCursorInput, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useConfirm } from "@/components/ui/confirm-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { postJson } from "@/lib/explore/client";
import type { ReportListResponse, ReportSummary } from "@/lib/explore/reports";
import { cn } from "@/lib/utils";

interface SidebarReportLinkProps {
  report: ReportSummary;
  scope: string;
  active: boolean;
  canEdit: boolean;
}

export function SidebarReportLink({ report, scope, active, canEdit }: SidebarReportLinkProps) {
  const router = useRouter();
  const { mutate } = useSWRConfig();
  const confirm = useConfirm();
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [title, setTitle] = useState(report.title);
  const [busy, setBusy] = useState(false);
  const pendingRef = useRef(false);
  const actionsRef = useRef<HTMLButtonElement>(null);
  const linkRef = useRef<HTMLAnchorElement>(null);
  const scopeQuery = `?scope=${encodeURIComponent(scope)}`;
  const href = `/explore/reports/${encodeURIComponent(report.id)}${scopeQuery}`;
  const reportKey = `/api/explore/reports/${encodeURIComponent(report.id)}`;
  const reportsKey = `/api/explore/reports?targetKey=${encodeURIComponent(scope)}`;
  const ready = report.blockCount > 0 || report.hasSuccessfulRun;
  const statusLabel = report.blockCount > 0
    ? "Report saved"
    : report.hasSuccessfulRun
      ? "Canvas analysis succeeded at least once"
      : "No saved report or successful canvas run yet";

  const rename = async () => {
    const name = title.trim();
    if (!canEdit || !name || pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    try {
      const { report: renamed } = await postJson<{ report: ReportSummary }>(reportKey, { title: name }, "PATCH");
      await mutate<ReportListResponse>(reportsKey, (current) => current && ({
        ...current,
        reports: current.reports.map((entry) => entry.id === renamed.id ? renamed : entry),
      }), { revalidate: false });
      setRenaming(false);
      toast.success("Report renamed");
      // The open report and its list share these caches with the sidebar.
      void Promise.allSettled([mutate(reportKey), mutate(reportsKey)]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not rename the report");
    } finally {
      pendingRef.current = false;
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!canEdit || pendingRef.current) return;
    pendingRef.current = true;
    setBusy(true);
    let deleted = false;
    try {
      const confirmed = await confirm({
        title: `Delete ${report.title}?`,
        description: report.analysisCount > 0
          ? `This removes the report and its ${report.analysisCount} analysis step${report.analysisCount === 1 ? "" : "s"}, including their runs and outputs. The tables of the scope stay.`
          : "This removes the report and its page. The tables of the scope stay.",
        confirmLabel: "Delete report",
        variant: "destructive",
      });
      if (!confirmed) return;
      await postJson(reportKey, undefined, "DELETE");
      deleted = true;
      if (active) router.replace(`/explore${scopeQuery}`);
      await mutate<ReportListResponse>(reportsKey, (current) => current && ({
        ...current,
        reports: current.reports.filter((entry) => entry.id !== report.id),
      }), { revalidate: false });
      toast.success("Report deleted");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not delete the report");
    } finally {
      pendingRef.current = false;
      setBusy(false);
      if (!deleted) linkRef.current?.focus();
    }
  };

  return (
    <>
      <DropdownMenu open={menuOpen} onOpenChange={setMenuOpen} modal={false}>
        <div
          className={cn(
            "group flex items-center rounded-md text-xs transition-colors",
            active
              ? "bg-secondary font-medium text-foreground"
              : "text-muted-foreground hover:bg-secondary/40 hover:text-foreground"
          )}
          onContextMenu={(event) => {
            event.preventDefault();
            if (!busy) setMenuOpen(true);
          }}
        >
          <Link
            ref={linkRef}
            href={href}
            title={statusLabel}
            aria-current={active ? "page" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onKeyDown={(event) => {
              if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10")) {
                event.preventDefault();
                if (!busy) setMenuOpen(true);
              }
            }}
          >
            <span
              className={cn(
                "h-2 w-2 shrink-0 rounded-full shadow-sm",
                ready ? "bg-[#00BD7D]" : "bg-slate-300",
                active && "ring-2 ring-background"
              )}
              aria-hidden="true"
            />
            <span className="truncate">{report.title}</span>
            <span className="sr-only">{statusLabel}</span>
          </Link>
          <DropdownMenuTrigger asChild>
            <button
              ref={actionsRef}
              type="button"
              disabled={busy}
              aria-label={`Actions for ${report.title}`}
              title={`Actions for ${report.title}`}
              className="mr-1 shrink-0 rounded p-1 text-muted-foreground hover:bg-secondary hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              <MoreHorizontal className="h-3 w-3" aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
        </div>
        <DropdownMenuContent
          side="right"
          align="start"
          className="w-48"
          aria-label={`Actions for ${report.title}`}
          onCloseAutoFocus={(event) => {
            if (renaming || pendingRef.current) event.preventDefault();
          }}
        >
          <DropdownMenuItem asChild>
            <Link href={href}><FileText />Open report</Link>
          </DropdownMenuItem>
          <DropdownMenuItem asChild>
            <a href={href} target="_blank" rel="noopener noreferrer"><ExternalLink />Open in new tab</a>
          </DropdownMenuItem>
          {canEdit && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem asChild>
                <Link href={`${href}&mode=edit&view=page`}><Pencil />Edit report</Link>
              </DropdownMenuItem>
              <DropdownMenuItem asChild>
                <Link href={`${href}&mode=edit&view=canvas`}><LayoutGrid />Open canvas</Link>
              </DropdownMenuItem>
              <DropdownMenuItem disabled={busy} onSelect={() => { setTitle(report.title); setRenaming(true); }}>
                <TextCursorInput />Rename
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem variant="destructive" disabled={busy} onSelect={() => void remove()}>
                <Trash2 />Delete report
              </DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <Dialog open={renaming} onOpenChange={(open) => { if (!busy) setRenaming(open); }}>
        <DialogContent
          onCloseAutoFocus={(event) => { event.preventDefault(); actionsRef.current?.focus(); }}
        >
          <DialogHeader>
            <DialogTitle>Rename report</DialogTitle>
            <DialogDescription>Choose a title for this report.</DialogDescription>
          </DialogHeader>
          <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); void rename(); }}>
            <Input
              aria-label="Report title"
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              maxLength={200}
              required
              disabled={busy}
              autoFocus
            />
            <DialogFooter>
              <Button type="button" variant="outline" disabled={busy} onClick={() => setRenaming(false)}>Cancel</Button>
              <Button type="submit" disabled={busy || !canEdit || !title.trim()}>
                {busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" />}
                Save
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
