"use client";

import { use, useEffect, useState } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowLeft,
  Download,
  Loader2,
  Table2,
} from "lucide-react";
import {
  FACILITY_SAMPLE_STATUSES,
  FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES,
  FACILITY_SAMPLE_STATUS_LABELS,
  type FacilitySampleStatus,
} from "@/lib/sequencing/constants";

type StudyTableColumnGroup = "identity" | "status" | "order" | "study";

interface StudyTableColumn {
  key: string;
  label: string;
  kind: "identity" | "status" | "field";
  group: StudyTableColumnGroup;
  fieldType?: string;
}

interface StudyTableRow {
  id: string;
  status: FacilitySampleStatus;
  statusLabel: string;
  cells: Record<string, string>;
}

interface StudyTableData {
  study: {
    id: string;
    title: string;
    alias: string | null;
    checklistType: string | null;
    sampleCount: number;
  };
  columns: StudyTableColumn[];
  rows: StudyTableRow[];
  studySummary: Array<{ label: string; value: string }>;
  perStudy: boolean;
}

// Light per-status row tints. Kept opaque (not translucent) so the frozen first
// column never bleeds rows underneath it during horizontal scroll.
const STATUS_ROW_TINT: Record<FacilitySampleStatus, string> = {
  WAITING: "bg-card",
  PROCESSING: "bg-blue-50",
  SEQUENCED: "bg-indigo-50",
  QC_REVIEW: "bg-amber-50",
  READY: "bg-emerald-50",
  ISSUE: "bg-rose-50",
};

// Header tint by column group, so Sequencing Order vs. Study metadata read apart.
const GROUP_HEADER_TINT: Record<StudyTableColumnGroup, string> = {
  identity: "bg-muted",
  status: "bg-muted",
  order: "bg-amber-100/70",
  study: "bg-sky-100/70",
};

const GROUP_LEGEND: Array<{ group: StudyTableColumnGroup; label: string }> = [
  { group: "identity", label: "Identity" },
  { group: "order", label: "Sequencing Order fields" },
  { group: "study", label: "Study metadata" },
];

export default function StudyTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<StudyTableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError("");
      try {
        const res = await fetch(`/api/studies/${id}/table`);
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          throw new Error(body?.error || "Failed to load table");
        }
        const payload = (await res.json()) as StudyTableData;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Failed to load table");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-24 text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading table…
        </div>
      </PageContainer>
    );
  }

  if (error || !data) {
    return (
      <PageContainer>
        <div className="mx-auto mt-10 flex max-w-md flex-col items-center gap-3 rounded-lg border border-destructive/20 bg-destructive/5 p-6 text-center">
          <AlertCircle className="h-6 w-6 text-destructive" />
          <p className="text-sm text-destructive">{error || "Study not found"}</p>
          <Button variant="outline" size="sm" asChild>
            <Link href={`/studies/${id}`}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Back to study
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  const { study, columns, rows, studySummary, perStudy } = data;

  return (
    <PageContainer>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
              <Link href={`/studies/${id}`}>
                <ArrowLeft className="mr-2 h-4 w-4" /> {study.title}
              </Link>
            </Button>
            <div className="flex flex-wrap items-center gap-2">
              <Table2 className="h-5 w-5 text-muted-foreground" />
              <h1 className="text-xl font-semibold">Table Overview</h1>
              {perStudy && (
                <span className="rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary">
                  Per-study questionnaire
                </span>
              )}
            </div>
            <p className="mt-0.5 text-sm text-muted-foreground">
              {study.sampleCount} sample{study.sampleCount === 1 ? "" : "s"}
              {study.checklistType ? ` · ${study.checklistType}` : ""} · all
              per-sample metadata in one sheet
            </p>
          </div>
          <Button asChild disabled={rows.length === 0}>
            <a href={`/api/studies/${id}/table/export`}>
              <Download className="mr-2 h-4 w-4" /> Export to XLSX
            </a>
          </Button>
        </div>

        {/* Study-level summary */}
        {studySummary.length > 0 && (
          <div className="flex flex-wrap gap-x-6 gap-y-2 rounded-lg border bg-muted/40 px-4 py-3 text-sm">
            {studySummary.map((entry) => (
              <div key={entry.label} className="min-w-0">
                <span className="text-muted-foreground">{entry.label}: </span>
                <span className="font-medium">{entry.value}</span>
              </div>
            ))}
          </div>
        )}

        {/* Status legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Row colour = sequencing status:</span>
          {FACILITY_SAMPLE_STATUSES.map((status) => (
            <span key={status} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-3 w-3 rounded border",
                  STATUS_ROW_TINT[status]
                )}
              />
              {FACILITY_SAMPLE_STATUS_LABELS[status]}
            </span>
          ))}
        </div>

        {/* Column-group legend */}
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Column header colour = source:</span>
          {GROUP_LEGEND.map((entry) => (
            <span key={entry.group} className="inline-flex items-center gap-1.5">
              <span
                className={cn(
                  "inline-block h-3 w-3 rounded border",
                  GROUP_HEADER_TINT[entry.group]
                )}
              />
              {entry.label}
            </span>
          ))}
        </div>

        {/* The table */}
        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed px-4 py-16 text-center">
            <Table2 className="mx-auto h-6 w-6 text-muted-foreground" />
            <p className="mt-2 text-sm font-medium">No samples in this study yet</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Assign samples to this study to see them here.
            </p>
          </div>
        ) : (
          <div
            className="overflow-auto rounded-lg border bg-card"
            style={{ maxHeight: "calc(100vh - 300px)" }}
          >
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  {columns.map((column, index) => (
                    <th
                      key={column.key}
                      className={cn(
                        "sticky top-0 z-20 whitespace-nowrap border-b px-3 py-2 text-left font-semibold text-foreground/80",
                        GROUP_HEADER_TINT[column.group],
                        index === 0 && "left-0 z-30"
                      )}
                    >
                      {column.label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => {
                  const tint = STATUS_ROW_TINT[row.status];
                  return (
                    <tr key={row.id} className={cn("border-b", tint)}>
                      {columns.map((column, index) => (
                        <td
                          key={column.key}
                          className={cn(
                            "whitespace-nowrap px-3 py-1.5 align-top",
                            index === 0 &&
                              cn("sticky left-0 z-10 font-medium", tint)
                          )}
                        >
                          {column.kind === "status" ? (
                            <span
                              className={cn(
                                "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                                FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES[row.status]
                              )}
                            >
                              {row.statusLabel}
                            </span>
                          ) : row.cells[column.key] ? (
                            row.cells[column.key]
                          ) : (
                            <span className="text-muted-foreground/40">—</span>
                          )}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </PageContainer>
  );
}
