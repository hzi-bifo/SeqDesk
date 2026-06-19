"use client";

import { use, useEffect, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowLeft,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
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
  helpText?: string;
  required?: boolean;
  editable?: boolean;
  options?: Array<{ value: string; label: string }>;
}

interface StudyTableRow {
  id: string;
  status: FacilitySampleStatus;
  statusLabel: string;
  cells: Record<string, string>;
}

interface StudyInfoPanel {
  heading: string;
  subheading?: string;
  fields: Array<{ label: string; value: string }>;
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
  info: StudyInfoPanel[];
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

// A single inline-editable metadata cell. Click to edit; Enter/blur saves (PATCH
// merges into the real Sample, so the change shows everywhere), Esc cancels.
function EditableCell({
  studyId,
  sampleId,
  column,
  value,
  onSaved,
}: {
  studyId: string;
  sampleId: string;
  column: StudyTableColumn;
  value: string;
  onSaved: (next: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    setDraft(value);
  }, [value]);

  const commit = async () => {
    setEditing(false);
    if (draft === value) return;
    setSaving(true);
    setFailed(false);
    try {
      const res = await fetch(`/api/studies/${studyId}/table`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sampleId, columnKey: column.key, value: draft }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved(draft);
    } catch {
      setFailed(true);
      setDraft(value);
    } finally {
      setSaving(false);
    }
  };

  const cancel = () => {
    setDraft(value);
    setEditing(false);
  };

  if (!editing) {
    return (
      <button
        type="button"
        onClick={() => setEditing(true)}
        title="Click to edit"
        className={cn(
          "-mx-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-primary/5",
          failed && "text-destructive"
        )}
      >
        <span className="truncate">
          {value || <span className="text-muted-foreground/40">—</span>}
        </span>
        {saving && (
          <Loader2 className="h-3 w-3 flex-shrink-0 animate-spin text-muted-foreground" />
        )}
      </button>
    );
  }

  const onChange = (
    event: ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setDraft(event.target.value);
  const editorClass =
    "w-full min-w-[8rem] rounded border border-primary/40 bg-background px-1 py-0.5 text-sm outline-none ring-1 ring-primary/30";

  if (column.fieldType === "select" && column.options) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={onChange}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
        }}
        className={editorClass}
      >
        <option value="">—</option>
        {column.options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    );
  }

  if (column.fieldType === "textarea") {
    return (
      <textarea
        autoFocus
        rows={2}
        value={draft}
        onChange={onChange}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === "Escape") cancel();
        }}
        className={editorClass}
      />
    );
  }

  const inputType =
    column.fieldType === "number"
      ? "number"
      : column.fieldType === "date"
        ? "date"
        : column.fieldType === "email"
          ? "email"
          : column.fieldType === "url"
            ? "url"
            : "text";

  return (
    <input
      autoFocus
      type={inputType}
      value={draft}
      onChange={onChange}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          commit();
        }
        if (event.key === "Escape") cancel();
      }}
      className={editorClass}
    />
  );
}

export default function StudyTablePage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = use(params);
  const [data, setData] = useState<StudyTableData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [fullscreen, setFullscreen] = useState(false);
  const [infoOpen, setInfoOpen] = useState(true);

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

  // Esc exits fullscreen.
  useEffect(() => {
    if (!fullscreen) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setFullscreen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [fullscreen]);

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

  const { study, columns, rows, info, perStudy } = data;

  // Reflect a saved edit in local state so the cell updates without a refetch.
  const updateCell = (rowId: string, key: string, next: string) => {
    setData((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((row) =>
              row.id === rowId
                ? { ...row, cells: { ...row.cells, [key]: next } }
                : row
            ),
          }
        : prev
    );
  };

  const exportButton = (
    <Button asChild disabled={rows.length === 0}>
      <a href={`/api/studies/${id}/table/export`}>
        <Download className="mr-2 h-4 w-4" /> Export to XLSX
      </a>
    </Button>
  );

  const legends = (
    <div className="space-y-1">
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
        <span className="inline-flex items-center gap-1.5">
          <Info className="h-3 w-3" /> hover a header for what it captures ·
          click a metadata cell to edit
        </span>
      </div>
    </div>
  );

  // The grid renders headers ALWAYS (so an empty study still shows its columns +
  // per-column help), and a spanning placeholder row when there are no samples.
  const grid = (maxHeight: string) => (
    <div
      className="overflow-auto rounded-lg border bg-card"
      style={{ maxHeight }}
    >
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {columns.map((column, index) => (
              <th
                key={column.key}
                title={column.helpText}
                className={cn(
                  "sticky top-0 z-20 whitespace-nowrap border-b px-3 py-2 text-left font-semibold text-foreground/80",
                  GROUP_HEADER_TINT[column.group],
                  index === 0 && "left-0 z-30"
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {column.label}
                  {column.required && (
                    <span className="text-muted-foreground/60">*</span>
                  )}
                  {column.helpText && (
                    <Info className="h-3 w-3 text-muted-foreground/50" />
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td
                colSpan={columns.length}
                className="px-4 py-16 text-center text-muted-foreground"
              >
                <Table2 className="mx-auto h-6 w-6" />
                <p className="mt-2 text-sm font-medium text-foreground">
                  No samples in this study yet
                </p>
                <p className="mt-1 text-sm">
                  Assign samples to this study to see them here. The columns
                  above show what will be captured for each sample.
                </p>
              </td>
            </tr>
          ) : (
            rows.map((row) => {
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
                      ) : column.editable ? (
                        <EditableCell
                          studyId={id}
                          sampleId={row.id}
                          column={column}
                          value={row.cells[column.key] ?? ""}
                          onSaved={(next) => updateCell(row.id, column.key, next)}
                        />
                      ) : row.cells[column.key] ? (
                        row.cells[column.key]
                      ) : (
                        <span className="text-muted-foreground/40">—</span>
                      )}
                    </td>
                  ))}
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );

  return (
    <>
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
            <div className="flex flex-shrink-0 items-center gap-2">
              <Button variant="outline" onClick={() => setFullscreen(true)}>
                <Maximize2 className="mr-2 h-4 w-4" /> Fullscreen
              </Button>
              {exportButton}
            </div>
          </div>

          {/* Study & sequencing information (everything that is not per-sample) */}
          {info.length > 0 && (
            <div className="rounded-lg border">
              <button
                type="button"
                onClick={() => setInfoOpen((open) => !open)}
                className="flex w-full items-center gap-2 px-4 py-2 text-sm font-medium hover:bg-muted/40"
              >
                {infoOpen ? (
                  <ChevronDown className="h-4 w-4" />
                ) : (
                  <ChevronRight className="h-4 w-4" />
                )}
                Study &amp; sequencing information
                <span className="text-xs font-normal text-muted-foreground">
                  (not per-sample)
                </span>
              </button>
              {infoOpen && (
                <div className="grid gap-3 border-t p-3 sm:grid-cols-2 lg:grid-cols-3">
                  {info.map((panel, index) => (
                    <div
                      key={`${panel.heading}-${panel.subheading ?? index}`}
                      className="rounded-lg border bg-muted/30 p-3"
                    >
                      <div className="mb-2 flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-semibold">
                          {panel.heading}
                        </span>
                        {panel.subheading && (
                          <span className="truncate text-xs text-muted-foreground">
                            {panel.subheading}
                          </span>
                        )}
                      </div>
                      <dl className="space-y-1 text-sm">
                        {panel.fields.map((field) => (
                          <div key={field.label} className="flex gap-2">
                            <dt className="shrink-0 text-muted-foreground">
                              {field.label}:
                            </dt>
                            <dd className="min-w-0 break-words font-medium">
                              {field.value}
                            </dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {legends}

          {grid("calc(100vh - 320px)")}
        </div>
      </PageContainer>

      {/* Fullscreen overlay — table at the full viewport width. */}
      {fullscreen && (
        <div className="fixed inset-0 z-50 flex flex-col bg-background">
          <div className="flex items-center justify-between gap-3 border-b px-4 py-3">
            <div className="flex min-w-0 items-center gap-2">
              <Table2 className="h-5 w-5 flex-shrink-0 text-muted-foreground" />
              <span className="truncate font-semibold">
                Table Overview — {study.title}
              </span>
              {perStudy && (
                <span className="hidden rounded-full border border-primary/20 bg-primary/10 px-2 py-0.5 text-xs font-medium text-primary sm:inline">
                  Per-study questionnaire
                </span>
              )}
              <span className="flex-shrink-0 text-sm text-muted-foreground">
                {study.sampleCount} sample{study.sampleCount === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {exportButton}
              <Button variant="outline" onClick={() => setFullscreen(false)}>
                <Minimize2 className="mr-2 h-4 w-4" /> Exit fullscreen
              </Button>
            </div>
          </div>
          <div className="border-b px-4 py-2">{legends}</div>
          <div className="flex-1 overflow-hidden p-4">
            {grid("calc(100vh - 180px)")}
          </div>
        </div>
      )}
    </>
  );
}
