"use client";

import { use, useEffect, useState, type ChangeEvent } from "react";
import Link from "next/link";
import { PageContainer } from "@/components/layout/PageContainer";
import { Button } from "@/components/ui/button";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  AlertCircle,
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  ChevronDown,
  ChevronRight,
  Download,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  Plus,
  Search,
  Table2,
  X,
} from "lucide-react";
import {
  FACILITY_SAMPLE_STATUSES,
  FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES,
  FACILITY_SAMPLE_STATUS_LABELS,
  type FacilitySampleStatus,
} from "@/lib/sequencing/constants";

type StudyTableColumnGroup =
  | "identity"
  | "status"
  | "order"
  | "study"
  | "mixs"
  | "output";

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
  removable?: boolean;
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
  availableMixsFields: Array<{ name: string; label: string }>;
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
  mixs: "bg-violet-100/70",
  output: "bg-emerald-100/70",
};

const GROUP_LEGEND: Array<{ group: StudyTableColumnGroup; label: string }> = [
  { group: "identity", label: "Identity" },
  { group: "order", label: "Sequencing Order fields" },
  { group: "mixs", label: "MIxS metadata" },
  { group: "study", label: "Study metadata" },
  { group: "output", label: "Pipeline outputs" },
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
  const [mixsPickerOpen, setMixsPickerOpen] = useState(false);
  const [mixsSearch, setMixsSearch] = useState("");
  const [mixsBusy, setMixsBusy] = useState(false);
  const [sort, setSort] = useState<{ key: string; dir: "asc" | "desc" } | null>(
    null
  );
  const [filterQuery, setFilterQuery] = useState("");

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

  const toggleSort = (key: string) =>
    setSort((prev) =>
      prev?.key === key
        ? prev.dir === "asc"
          ? { key, dir: "desc" }
          : null
        : { key, dir: "asc" }
    );

  // Filter + sort are derived (cheap for a study's worth of rows); cell editing
  // still targets rows by id, so order/visibility changes don't affect saves.
  const filterText = filterQuery.trim().toLowerCase();
  const displayRows = (() => {
    let result = filterText
      ? rows.filter((row) =>
          Object.values(row.cells).some((value) =>
            String(value).toLowerCase().includes(filterText)
          )
        )
      : rows;
    if (sort) {
      const { key, dir } = sort;
      result = [...result].sort((a, b) => {
        const av = a.cells[key] ?? "";
        const bv = b.cells[key] ?? "";
        const an = Number(av.replace(/,/g, ""));
        const bn = Number(bv.replace(/,/g, ""));
        const numeric =
          av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn);
        const cmp = numeric ? an - bn : av.localeCompare(bv);
        return dir === "asc" ? cmp : -cmp;
      });
    }
    return result;
  })();

  const refetch = async () => {
    try {
      const res = await fetch(`/api/studies/${id}/table`);
      if (!res.ok) return;
      const payload = await res.json().catch(() => null);
      if (payload) setData(payload as StudyTableData);
    } catch {
      // keep the current view on a transient failure
    }
  };

  const addMixsColumn = async (fieldName: string) => {
    setMixsBusy(true);
    try {
      const res = await fetch(`/api/studies/${id}/table/columns`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fieldName }),
      });
      // Always reconcile from the server so the view matches reality whether the
      // add succeeded or not; only close the picker on success.
      await refetch();
      if (res.ok) {
        setMixsPickerOpen(false);
        setMixsSearch("");
      }
    } finally {
      setMixsBusy(false);
    }
  };

  const removeMixsColumn = async (columnKey: string) => {
    const fieldName = columnKey.replace(/^checklist:/, "");
    await fetch(`/api/studies/${id}/table/columns`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ fieldName }),
    });
    // Reconcile from the server (a failed delete simply leaves the column shown).
    await refetch();
  };

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

  const mixsMatches = data.availableMixsFields
    .filter((field) => {
      const query = mixsSearch.trim().toLowerCase();
      return (
        !query ||
        field.label.toLowerCase().includes(query) ||
        field.name.toLowerCase().includes(query)
      );
    })
    .slice(0, 100);

  // The MIxS field picker, rendered from the "+" header column inside the table.
  const mixsPickerContent = (
    <>
      <input
        autoFocus
        value={mixsSearch}
        onChange={(event) => setMixsSearch(event.target.value)}
        placeholder="Search MIxS fields…"
        className="mb-2 w-full rounded border bg-background px-2 py-1 text-sm outline-none"
      />
      <div className="max-h-72 overflow-auto">
        {mixsMatches.length === 0 ? (
          <p className="px-2 py-2 text-sm text-muted-foreground">
            No matching fields
          </p>
        ) : (
          mixsMatches.map((field) => (
            <button
              key={field.name}
              type="button"
              disabled={mixsBusy}
              onClick={() => addMixsColumn(field.name)}
              title={field.name}
              className="block w-full truncate rounded px-2 py-1 text-left text-sm font-normal hover:bg-muted disabled:opacity-50"
            >
              {field.label}
            </button>
          ))
        )}
      </div>
    </>
  );

  // Inject a "+" column right after the last MIxS column (falling back to after
  // the Sequencing Order block), so adding a MIxS field feels like a table action.
  const ADD_MIXS_KEY = "__add_mixs__";
  const showAddMixs = data.availableMixsFields.length > 0;
  let addMixsAfter = -1;
  if (showAddMixs) {
    columns.forEach((column, index) => {
      if (column.group === "mixs") addMixsAfter = index;
    });
    if (addMixsAfter === -1) {
      columns.forEach((column, index) => {
        if (column.group === "order") addMixsAfter = index;
      });
    }
  }
  const renderColumns: StudyTableColumn[] =
    showAddMixs && addMixsAfter >= 0
      ? [
          ...columns.slice(0, addMixsAfter + 1),
          { key: ADD_MIXS_KEY, label: "", kind: "field", group: "mixs" },
          ...columns.slice(addMixsAfter + 1),
        ]
      : columns;

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
            {renderColumns.map((column, index) => {
              if (column.key === ADD_MIXS_KEY) {
                return (
                  <th
                    key={ADD_MIXS_KEY}
                    title="Add a MIxS metadata column"
                    className={cn(
                      "sticky top-0 z-20 border-b px-2 py-2 text-center",
                      GROUP_HEADER_TINT.mixs
                    )}
                  >
                    <Popover
                      open={mixsPickerOpen}
                      onOpenChange={setMixsPickerOpen}
                    >
                      <PopoverTrigger asChild>
                        <button
                          type="button"
                          aria-label="Add MIxS field"
                          className="inline-flex h-5 w-5 items-center justify-center rounded text-foreground/70 hover:bg-foreground/10 hover:text-foreground"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                      </PopoverTrigger>
                      <PopoverContent align="start" className="w-72 p-2">
                        {mixsPickerContent}
                      </PopoverContent>
                    </Popover>
                  </th>
                );
              }
              return (
              <th
                key={column.key}
                className={cn(
                  "sticky top-0 z-20 whitespace-nowrap border-b px-3 py-2 text-left font-semibold text-foreground/80",
                  GROUP_HEADER_TINT[column.group],
                  index === 0 && "left-0 z-30"
                )}
              >
                <span className="inline-flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => toggleSort(column.key)}
                    title="Sort by this column"
                    className="inline-flex items-center gap-1 hover:text-foreground"
                  >
                    {column.label}
                    {sort?.key === column.key &&
                      (sort.dir === "asc" ? (
                        <ArrowUp className="h-3 w-3" />
                      ) : (
                        <ArrowDown className="h-3 w-3" />
                      ))}
                  </button>
                  {column.required && (
                    <span className="text-muted-foreground/60">*</span>
                  )}
                  {column.helpText && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button
                          type="button"
                          aria-label={`About ${column.label}`}
                          className="inline-flex cursor-help align-middle"
                        >
                          <Info className="h-3 w-3 text-muted-foreground/50 hover:text-foreground" />
                        </button>
                      </TooltipTrigger>
                      <TooltipContent className="max-w-xs font-normal">
                        {column.helpText}
                      </TooltipContent>
                    </Tooltip>
                  )}
                  {column.removable && (
                    <button
                      type="button"
                      onClick={() => removeMixsColumn(column.key)}
                      aria-label={`Remove ${column.label} column`}
                      title="Remove this column"
                      className="inline-flex text-muted-foreground/50 hover:text-destructive"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </span>
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td
                colSpan={renderColumns.length}
                className="px-4 py-16 text-center text-muted-foreground"
              >
                <Table2 className="mx-auto h-6 w-6" />
                {rows.length === 0 ? (
                  <>
                    <p className="mt-2 text-sm font-medium text-foreground">
                      No samples in this study yet
                    </p>
                    <p className="mt-1 text-sm">
                      Assign samples to this study to see them here. The columns
                      above show what will be captured for each sample.
                    </p>
                  </>
                ) : (
                  <p className="mt-2 text-sm">
                    No rows match “{filterQuery}”.
                  </p>
                )}
              </td>
            </tr>
          ) : (
            displayRows.map((row) => {
              const tint = STATUS_ROW_TINT[row.status];
              return (
                <tr key={row.id} className={cn("border-b", tint)}>
                  {renderColumns.map((column, index) => {
                    if (column.key === ADD_MIXS_KEY) {
                      return <td key={ADD_MIXS_KEY} className="px-2" />;
                    }
                    return (
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
                    );
                  })}
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

          {/* Toolbar: filter + add row */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                <input
                  value={filterQuery}
                  onChange={(event) => setFilterQuery(event.target.value)}
                  placeholder="Filter rows…"
                  className="w-56 rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary/30"
                />
              </div>
              {filterText && (
                <span className="text-xs text-muted-foreground">
                  {displayRows.length} of {rows.length}
                </span>
              )}
              {sort && (
                <button
                  type="button"
                  onClick={() => setSort(null)}
                  className="text-xs text-muted-foreground underline hover:text-foreground"
                >
                  clear sort
                </button>
              )}
            </div>
            <Button variant="outline" asChild>
              <Link href={`/orders/new?study=${id}`}>
                <Plus className="mr-2 h-4 w-4" /> Add samples
              </Link>
            </Button>
          </div>

          {grid("calc(100vh - 360px)")}

          {legends}
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
