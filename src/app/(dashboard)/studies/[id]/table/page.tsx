"use client";

import {
  use,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent as ReactClipboardEvent,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
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
  Columns3,
  Download,
  Filter,
  Info,
  Loader2,
  Maximize2,
  Minimize2,
  PencilLine,
  Plus,
  Search,
  Table2,
  Redo2,
  Undo2,
  Upload,
  X,
} from "lucide-react";
import {
  FACILITY_SAMPLE_STATUSES,
  FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES,
  FACILITY_SAMPLE_STATUS_LABELS,
  type FacilitySampleStatus,
} from "@/lib/sequencing/constants";
import { validateStudyTableCellValue } from "@/lib/studies/study-table-validation";

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

// Group labels + order for the "Columns" show/hide menu (covers all six groups).
const COLUMN_GROUP_LABEL: Record<StudyTableColumnGroup, string> = {
  identity: "Identity",
  status: "Status",
  order: "Sequencing Order",
  mixs: "MIxS metadata",
  study: "Study metadata",
  output: "Pipeline outputs",
};
const COLUMN_GROUP_ORDER: StudyTableColumnGroup[] = [
  "identity",
  "status",
  "order",
  "mixs",
  "study",
  "output",
];

type TableDensity = "comfortable" | "compact";

// One level of a multi-level (Excel-style) sort: column key + direction.
type SortLevel = { key: string; dir: "asc" | "desc" };

interface CellChange {
  rowId: string;
  rowLabel: string;
  columnKey: string;
  columnLabel: string;
  before: string;
  after: string;
}

interface ChangeBatch {
  label: string;
  changes: CellChange[];
}

interface ImportPreview {
  fileName: string;
  changes: CellChange[];
  errors: string[];
  unmappedColumns: string[];
}

const MAX_HISTORY_BATCHES = 50;

function cellValidationKey(rowId: string, columnKey: string): string {
  return `${rowId}\u001f${columnKey}`;
}

function isMultiCellClipboard(text: string): boolean {
  return text.includes("\t") || text.includes("\n") || text.includes("\r");
}

function parseClipboardTable(text: string): string[][] {
  const normalized = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  const trimmed = normalized.endsWith("\n") ? normalized.slice(0, -1) : normalized;
  return trimmed.split("\n").map((line) => line.split("\t"));
}

function normalizeHeader(value: string): string {
  return value
    .replace(/\s*\*\s*$/, "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

function getWorkbookCellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "object") {
    const richText = (value as { richText?: Array<{ text?: string }> }).richText;
    if (Array.isArray(richText)) {
      return richText.map((part) => part.text ?? "").join("").trim();
    }
    const formulaResult = (value as { result?: unknown }).result;
    if (formulaResult !== undefined) return getWorkbookCellText(formulaResult);
    const text = (value as { text?: unknown }).text;
    if (text !== undefined) return String(text).trim();
  }
  return String(value).trim();
}

// A single inline-editable metadata cell, controlled by the table for spreadsheet-
// style keyboard use: click or Enter to edit, Enter saves + moves down, Tab saves +
// moves across, Esc cancels, arrows move between editable cells when not editing.
// Saving PATCHes the real Sample, so the change shows everywhere.
function EditableCell({
  studyId,
  sampleId,
  column,
  value,
  onSaved,
  active,
  editing,
  onActivate,
  onStartEdit,
  onStopEdit,
  onMove,
  onPasteText,
  validationError,
}: {
  studyId: string;
  sampleId: string;
  column: StudyTableColumn;
  value: string;
  onSaved: (next: string) => void;
  active: boolean;
  editing: boolean;
  onActivate: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onMove: (dRow: number, dCol: number, startEditing: boolean) => void;
  onPasteText: (text: string) => void;
  validationError?: string;
}) {
  const [draft, setDraft] = useState(value);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const [localError, setLocalError] = useState("");
  const triggerRef = useRef<HTMLButtonElement>(null);
  // True between an Enter/Tab commit and the resulting blur, so the blur that fires
  // as focus leaves doesn't PATCH the same value a second time.
  const skipBlur = useRef(false);

  // Sync the draft from the server value, but never clobber an in-progress edit
  // (a background refetch must not overwrite what the user is typing).
  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  // Pull focus to the trigger when this becomes the active, non-editing cell, so
  // arrow navigation always lands on something focusable.
  useEffect(() => {
    if (active && !editing) triggerRef.current?.focus();
  }, [active, editing]);

  // Each fresh edit session starts with the blur guard cleared.
  useEffect(() => {
    if (editing) skipBlur.current = false;
  }, [editing]);

  // Persist an in-progress edit if this cell unmounts before a blur can commit it
  // — e.g. its row is filtered out or its column hidden mid-edit. A ref holds the
  // latest values so the unmount-only cleanup sees them.
  const latest = useRef({ draft, value, editing, columnKey: column.key });
  useEffect(() => {
    latest.current = { draft, value, editing, columnKey: column.key };
  });
  useEffect(
    () => () => {
      const l = latest.current;
      if (l.editing && l.draft !== l.value) {
        const validation = validateStudyTableCellValue(column, l.draft);
        if (validation.error) return;
        fetch(`/api/studies/${studyId}/table`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sampleId,
            columnKey: l.columnKey,
            value: validation.value,
          }),
        }).catch(() => {});
      }
    },
    [studyId, sampleId, column]
  );

  const commit = async (): Promise<boolean> => {
    const validation = validateStudyTableCellValue(column, draft);
    if (validation.error) {
      setFailed(true);
      setLocalError(validation.error);
      return false;
    }
    if (validation.value === value) {
      setFailed(false);
      setLocalError("");
      setDraft(validation.value);
      return true;
    }
    setSaving(true);
    setFailed(false);
    setLocalError("");
    try {
      const res = await fetch(`/api/studies/${studyId}/table`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleId,
          columnKey: column.key,
          value: validation.value,
        }),
      });
      if (!res.ok) throw new Error("save failed");
      onSaved(validation.value);
      return true;
    } catch {
      setFailed(true);
      setLocalError("Save failed");
      setDraft(value);
      return false;
    } finally {
      setSaving(false);
    }
  };

  if (!editing) {
    return (
      <button
        ref={triggerRef}
        type="button"
        onClick={() => {
          onActivate();
          onStartEdit();
        }}
        onFocus={onActivate}
        onPaste={(event) => {
          const text = event.clipboardData.getData("text/plain");
          if (!text) return;
          event.preventDefault();
          onActivate();
          onPasteText(text);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === "F2") {
            event.preventDefault();
            onStartEdit();
          } else if (event.key === "ArrowDown") {
            event.preventDefault();
            onMove(1, 0, false);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            onMove(-1, 0, false);
          } else if (event.key === "ArrowRight") {
            event.preventDefault();
            onMove(0, 1, false);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            onMove(0, -1, false);
          }
        }}
        title={localError || validationError || "Click or press Enter to edit"}
        className={cn(
          "-mx-1 flex w-full items-center gap-1 rounded px-1 py-0.5 text-left hover:bg-primary/5 focus:outline-none",
          active && "bg-primary/5 ring-1 ring-inset ring-primary/50",
          (failed || validationError) && "text-destructive"
        )}
      >
        <span className="truncate">
          {value || <span className="text-muted-foreground/40">—</span>}
        </span>
        {(localError || validationError) && (
          <AlertCircle className="h-3 w-3 flex-shrink-0 text-destructive" />
        )}
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

  const onBlur = () => {
    if (skipBlur.current) {
      skipBlur.current = false;
      return;
    }
    commit();
  };

  // Enter saves + moves down (newline in a textarea instead); Tab/Shift+Tab saves +
  // moves across; Esc cancels back to the focused (non-editing) cell.
  const onEditorKeyDown = async (
    event: ReactKeyboardEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    if (event.key === "Escape") {
      event.preventDefault();
      setDraft(value);
      onStopEdit();
    } else if (event.key === "Enter" && column.fieldType !== "textarea") {
      event.preventDefault();
      skipBlur.current = true;
      const ok = await commit();
      if (ok) onMove(1, 0, true);
      else skipBlur.current = false;
    } else if (event.key === "Tab") {
      event.preventDefault();
      skipBlur.current = true;
      const ok = await commit();
      if (ok) onMove(0, event.shiftKey ? -1 : 1, true);
      else skipBlur.current = false;
    }
  };
  const onEditorPaste = (
    event: ReactClipboardEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >
  ) => {
    const text = event.clipboardData.getData("text/plain");
    if (!text || !isMultiCellClipboard(text)) return;
    event.preventDefault();
    onStopEdit();
    onPasteText(text);
  };

  if (column.fieldType === "select" && column.options) {
    return (
      <select
        autoFocus
        value={draft}
        onChange={onChange}
        onBlur={onBlur}
        onKeyDown={onEditorKeyDown}
        onPaste={onEditorPaste}
        className={cn(
          editorClass,
          (localError || validationError) && "border-destructive"
        )}
        aria-invalid={Boolean(localError || validationError)}
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
        onBlur={onBlur}
        onKeyDown={onEditorKeyDown}
        onPaste={onEditorPaste}
        className={cn(
          editorClass,
          (localError || validationError) && "border-destructive"
        )}
        aria-invalid={Boolean(localError || validationError)}
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
      onBlur={onBlur}
      onKeyDown={onEditorKeyDown}
      onPaste={onEditorPaste}
      className={cn(
        editorClass,
        (localError || validationError) && "border-destructive"
      )}
      aria-invalid={Boolean(localError || validationError)}
    />
  );
}

// A study/order info value that may be a long free-text field (description,
// abstract, project name). Short values render inline; long ones are clamped to
// a few lines with a "Show more"/"Show less" toggle so the info panels stay tidy.
const INFO_VALUE_CLAMP = 180;
function InfoFieldValue({ value }: { value: string }) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > INFO_VALUE_CLAMP;
  if (!isLong) return <>{value}</>;
  return (
    <>
      <span className={expanded ? undefined : "line-clamp-3"}>{value}</span>
      <button
        type="button"
        onClick={() => setExpanded((open) => !open)}
        className="mt-0.5 block text-xs font-medium text-primary hover:underline"
        aria-expanded={expanded}
      >
        {expanded ? "Show less" : "Show more"}
      </button>
    </>
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
  const [sortLevels, setSortLevels] = useState<SortLevel[]>([]);
  // Which column's header sort dropdown is open (one at a time).
  const [openSortCol, setOpenSortCol] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState("");
  // "Tame the wide table" view controls. Column visibility + density persist
  // per-study in localStorage; the status filter is transient like the text filter.
  const [statusFilter, setStatusFilter] = useState<Set<FacilitySampleStatus>>(
    new Set()
  );
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [density, setDensity] = useState<TableDensity>("comfortable");
  const [columnsMenuOpen, setColumnsMenuOpen] = useState(false);
  const [statusMenuOpen, setStatusMenuOpen] = useState(false);
  // Bulk edit: set one editable field across all currently-shown rows.
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkColumnKey, setBulkColumnKey] = useState("");
  const [bulkValue, setBulkValue] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkDone, setBulkDone] = useState(0);
  const [bulkError, setBulkError] = useState("");
  const [exportMenuOpen, setExportMenuOpen] = useState(false);
  // Spreadsheet keyboard navigation: which cell is focused, and whether it's editing.
  const [activeCell, setActiveCell] = useState<{
    rowId: string;
    colKey: string;
  } | null>(null);
  const [cellEditing, setCellEditing] = useState(false);
  const [undoStack, setUndoStack] = useState<ChangeBatch[]>([]);
  const [redoStack, setRedoStack] = useState<ChangeBatch[]>([]);
  const [tableActionBusy, setTableActionBusy] = useState(false);
  const [tableActionError, setTableActionError] = useState("");
  const [tableNotice, setTableNotice] = useState("");
  const [importPreview, setImportPreview] = useState<ImportPreview | null>(null);
  const [importBusy, setImportBusy] = useState(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  const hiddenKey = `seqdesk:study-table:${id}:hidden`;
  const densityKey = `seqdesk:study-table:${id}:density`;

  // Restore persisted view preferences once per study (in an effect, to avoid a
  // hydration mismatch from reading localStorage during render).
  useEffect(() => {
    try {
      const rawHidden = localStorage.getItem(hiddenKey);
      if (rawHidden) {
        const parsed = JSON.parse(rawHidden);
        if (Array.isArray(parsed)) {
          setHiddenColumns(new Set(parsed.filter((v) => typeof v === "string")));
        }
      }
      const rawDensity = localStorage.getItem(densityKey);
      if (rawDensity === "compact" || rawDensity === "comfortable") {
        setDensity(rawDensity);
      }
    } catch {
      // ignore unreadable/disabled storage
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const persistHidden = (next: Set<string>) => {
    setHiddenColumns(next);
    try {
      localStorage.setItem(hiddenKey, JSON.stringify([...next]));
    } catch {
      // ignore
    }
  };
  const toggleColumnHidden = (key: string) => {
    const next = new Set(hiddenColumns);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    persistHidden(next);
  };
  const persistDensity = (next: TableDensity) => {
    setDensity(next);
    try {
      localStorage.setItem(densityKey, next);
    } catch {
      // ignore
    }
  };
  const toggleStatusFilter = (status: FacilitySampleStatus) => {
    setStatusFilter((prev) => {
      const next = new Set(prev);
      if (next.has(status)) next.delete(status);
      else next.add(status);
      return next;
    });
  };

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

  // Clicking a header is a quick single-column sort (asc → desc → off); the Sort
  // menu builds the multi-level sort.
  const toggleSort = (key: string) =>
    setSortLevels((prev) => {
      if (prev.length === 1 && prev[0].key === key) {
        return prev[0].dir === "asc" ? [{ key, dir: "desc" }] : [];
      }
      return [{ key, dir: "asc" }];
    });

  // Filter + sort are derived (cheap for a study's worth of rows); cell editing
  // still targets rows by id, so order/visibility changes don't affect saves.
  const filterText = filterQuery.trim().toLowerCase();
  const isFiltered = filterText !== "" || statusFilter.size > 0;
  // Rows matching the text filter only. The Status facet counts use this so they
  // reflect an active text filter yet stay stable as you toggle statuses.
  const textFilteredRows = filterText
    ? rows.filter((row) =>
        Object.values(row.cells).some((value) =>
          String(value).toLowerCase().includes(filterText)
        )
      )
    : rows;
  const displayRows = (() => {
    let result =
      statusFilter.size > 0
        ? textFilteredRows.filter((row) => statusFilter.has(row.status))
        : textFilteredRows;
    if (sortLevels.length > 0) {
      result = [...result].sort((a, b) => {
        for (const { key, dir } of sortLevels) {
          const av = a.cells[key] ?? "";
          const bv = b.cells[key] ?? "";
          const an = Number(av.replace(/,/g, ""));
          const bn = Number(bv.replace(/,/g, ""));
          const numeric =
            av !== "" && bv !== "" && !Number.isNaN(an) && !Number.isNaN(bn);
          const cmp = numeric ? an - bn : av.localeCompare(bv);
          if (cmp !== 0) return dir === "asc" ? cmp : -cmp;
        }
        return 0;
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

  const recordHistory = (batch: ChangeBatch) => {
    if (batch.changes.length === 0) return;
    setUndoStack((prev) => [...prev, batch].slice(-MAX_HISTORY_BATCHES));
    setRedoStack([]);
  };

  const updateCells = (changes: CellChange[]) => {
    if (changes.length === 0) return;
    setData((prev) =>
      prev
        ? {
            ...prev,
            rows: prev.rows.map((row) =>
              changes.some((change) => change.rowId === row.id)
                ? {
                    ...row,
                    cells: changes.reduce(
                      (cells, change) =>
                        change.rowId === row.id
                          ? { ...cells, [change.columnKey]: change.after }
                          : cells,
                      row.cells
                    ),
                  }
                : row
            ),
          }
        : prev
    );
  };

  const updateCell = (
    row: StudyTableRow,
    column: StudyTableColumn,
    next: string
  ) => {
    const before = row.cells[column.key] ?? "";
    if (before === next) return;
    const change: CellChange = {
      rowId: row.id,
      rowLabel: row.cells._sampleId || row.id,
      columnKey: column.key,
      columnLabel: column.label,
      before,
      after: next,
    };
    updateCells([change]);
    recordHistory({ label: "Cell edit", changes: [change] });
    setTableNotice(`${column.label} updated for ${change.rowLabel}`);
  };

  const persistCellChanges = async (changes: CellChange[]) => {
    const applied: CellChange[] = [];
    for (const change of changes) {
      const res = await fetch(`/api/studies/${id}/table`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sampleId: change.rowId,
          columnKey: change.columnKey,
          value: change.after,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        if (applied.length > 0) {
          updateCells(applied);
          await refetch();
        }
        throw new Error(
          body?.error ||
            `Failed to update ${change.rowLabel} / ${change.columnLabel}`
        );
      }
      applied.push(change);
    }
  };

  const applyCellChangeBatch = async (changes: CellChange[], label: string) => {
    const meaningful = changes.filter((change) => change.before !== change.after);
    if (meaningful.length === 0) {
      setTableNotice("No changes to apply");
      return true;
    }
    setTableActionBusy(true);
    setTableActionError("");
    setTableNotice("");
    try {
      await persistCellChanges(meaningful);
      updateCells(meaningful);
      recordHistory({ label, changes: meaningful });
      setTableNotice(
        `${label}: ${meaningful.length} cell${
          meaningful.length === 1 ? "" : "s"
        } updated`
      );
      return true;
    } catch (err) {
      setTableActionError(
        err instanceof Error ? err.message : `Failed to apply ${label}`
      );
      return false;
    } finally {
      setTableActionBusy(false);
    }
  };

  const pasteIntoCell = async (
    rowId: string,
    columnKey: string,
    text: string
  ) => {
    if (tableActionBusy) return;
    const startRow = navRowIds.indexOf(rowId);
    const startCol = navColKeys.indexOf(columnKey);
    if (startRow < 0 || startCol < 0) return;

    const matrix = parseClipboardTable(text);
    const changes: CellChange[] = [];
    const errors: string[] = [];

    matrix.forEach((clipboardRow, rowOffset) => {
      clipboardRow.forEach((rawValue, colOffset) => {
        const targetRowId = navRowIds[startRow + rowOffset];
        const targetColumnKey = navColKeys[startCol + colOffset];
        const rawText = rawValue.trim();
        if (!targetRowId || !targetColumnKey) {
          if (rawText) errors.push("Pasted data exceeds the visible table range");
          return;
        }

        const targetRow = rowById.get(targetRowId);
        const targetColumn = editableColumnByKey.get(targetColumnKey);
        if (!targetRow || !targetColumn) return;

        const validation = validateStudyTableCellValue(targetColumn, rawValue);
        if (validation.error) {
          errors.push(
            `${targetRow.cells._sampleId || targetRow.id} / ${
              targetColumn.label
            }: ${validation.error}`
          );
          return;
        }

        changes.push({
          rowId: targetRow.id,
          rowLabel: targetRow.cells._sampleId || targetRow.id,
          columnKey: targetColumn.key,
          columnLabel: targetColumn.label,
          before: targetRow.cells[targetColumn.key] ?? "",
          after: validation.value,
        });
      });
    });

    if (errors.length > 0) {
      setTableActionError([...new Set(errors)].slice(0, 5).join("; "));
      setTableNotice("");
      return;
    }

    await applyCellChangeBatch(changes, "Paste");
  };

  const undoLastChange = async () => {
    const batch = undoStack[undoStack.length - 1];
    if (!batch || tableActionBusy) return;

    const reversed = batch.changes.map((change) => ({
      ...change,
      before: change.after,
      after: change.before,
    }));

    setTableActionBusy(true);
    setTableActionError("");
    setTableNotice("");
    try {
      await persistCellChanges(reversed);
      updateCells(reversed);
      setUndoStack((prev) => prev.slice(0, -1));
      setRedoStack((prev) => [...prev, batch].slice(-MAX_HISTORY_BATCHES));
      setTableNotice(
        `Undid ${batch.label}: ${batch.changes.length} cell${
          batch.changes.length === 1 ? "" : "s"
        }`
      );
    } catch (err) {
      setTableActionError(
        err instanceof Error ? err.message : `Failed to undo ${batch.label}`
      );
    } finally {
      setTableActionBusy(false);
    }
  };

  const redoLastChange = async () => {
    const batch = redoStack[redoStack.length - 1];
    if (!batch || tableActionBusy) return;

    setTableActionBusy(true);
    setTableActionError("");
    setTableNotice("");
    try {
      await persistCellChanges(batch.changes);
      updateCells(batch.changes);
      setRedoStack((prev) => prev.slice(0, -1));
      setUndoStack((prev) => [...prev, batch].slice(-MAX_HISTORY_BATCHES));
      setTableNotice(
        `Redid ${batch.label}: ${batch.changes.length} cell${
          batch.changes.length === 1 ? "" : "s"
        }`
      );
    } catch (err) {
      setTableActionError(
        err instanceof Error ? err.message : `Failed to redo ${batch.label}`
      );
    } finally {
      setTableActionBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    setImportBusy(true);
    setTableActionError("");
    setTableNotice("");
    setImportPreview(null);

    try {
      const ExcelJS = await import("exceljs");
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(await file.arrayBuffer());

      const sheet = workbook.getWorksheet("Study Samples") || workbook.worksheets[0];
      if (!sheet) {
        throw new Error("No worksheet found in the uploaded workbook");
      }

      const headerRow = sheet.getRow(1);
      const rowIdHeader = normalizeHeader("SeqDesk Row ID");
      const sampleIdHeader = normalizeHeader("Sample ID");
      const editableHeaders = new Map<string, StudyTableColumn>();
      const knownHeaders = new Set<string>([rowIdHeader]);
      for (const column of columns) {
        knownHeaders.add(normalizeHeader(column.label));
        knownHeaders.add(normalizeHeader(column.key));
        if (column.editable) {
          editableHeaders.set(normalizeHeader(column.label), column);
          editableHeaders.set(normalizeHeader(column.key), column);
        }
      }

      let rowIdColumnNumber: number | null = null;
      let sampleIdColumnNumber: number | null = null;
      const headerMap = new Map<number, StudyTableColumn>();
      const mappedColumnKeys = new Set<string>();
      const errors: string[] = [];
      const unmappedColumns: string[] = [];

      for (let colNumber = 1; colNumber <= headerRow.cellCount; colNumber += 1) {
        const headerText = getWorkbookCellText(headerRow.getCell(colNumber).value);
        if (!headerText) continue;
        const normalized = normalizeHeader(headerText);
        if (normalized === rowIdHeader) {
          rowIdColumnNumber = colNumber;
          continue;
        }
        if (normalized === sampleIdHeader || normalized === "sampleid") {
          sampleIdColumnNumber = colNumber;
          continue;
        }
        const editableColumn = editableHeaders.get(normalized);
        if (editableColumn) {
          if (mappedColumnKeys.has(editableColumn.key)) {
            errors.push(`${editableColumn.label} appears more than once`);
            continue;
          }
          headerMap.set(colNumber, editableColumn);
          mappedColumnKeys.add(editableColumn.key);
        } else if (!knownHeaders.has(normalized)) {
          unmappedColumns.push(headerText);
        }
      }

      if (headerMap.size === 0) {
        errors.push("No editable table columns matched the workbook headers");
      }

      const rowsBySampleId = new Map<string, StudyTableRow[]>();
      for (const row of rows) {
        const sampleId = (row.cells._sampleId || "").trim();
        if (!sampleId) continue;
        rowsBySampleId.set(sampleId, [...(rowsBySampleId.get(sampleId) || []), row]);
      }

      const changes: CellChange[] = [];
      for (let rowNumber = 2; rowNumber <= sheet.rowCount; rowNumber += 1) {
        const worksheetRow = sheet.getRow(rowNumber);
        let hasValue = false;
        const maxColumn = Math.max(headerRow.cellCount, worksheetRow.cellCount);
        for (let colNumber = 1; colNumber <= maxColumn; colNumber += 1) {
          if (getWorkbookCellText(worksheetRow.getCell(colNumber).value)) {
            hasValue = true;
            break;
          }
        }
        if (!hasValue) continue;

        let targetRow: StudyTableRow | undefined;
        const workbookRowId =
          rowIdColumnNumber === null
            ? ""
            : getWorkbookCellText(worksheetRow.getCell(rowIdColumnNumber).value);
        if (workbookRowId) {
          targetRow = rowById.get(workbookRowId);
          if (!targetRow) {
            errors.push(`Row ${rowNumber}: SeqDesk Row ID does not belong to this study`);
            continue;
          }
        } else if (sampleIdColumnNumber !== null) {
          const sampleId = getWorkbookCellText(
            worksheetRow.getCell(sampleIdColumnNumber).value
          );
          const matches = rowsBySampleId.get(sampleId) || [];
          if (matches.length === 1) {
            targetRow = matches[0];
          } else if (matches.length > 1) {
            errors.push(`Row ${rowNumber}: Sample ID "${sampleId}" is not unique`);
            continue;
          } else {
            errors.push(`Row ${rowNumber}: Sample ID "${sampleId}" was not found`);
            continue;
          }
        } else {
          errors.push(`Row ${rowNumber}: no SeqDesk Row ID or Sample ID column found`);
          continue;
        }

        headerMap.forEach((column, colNumber) => {
          if (!targetRow) return;
          const rawValue = getWorkbookCellText(worksheetRow.getCell(colNumber).value);
          const validation = validateStudyTableCellValue(column, rawValue);
          if (validation.error) {
            errors.push(
              `Row ${rowNumber} / ${targetRow.cells._sampleId || targetRow.id} / ${
                column.label
              }: ${validation.error}`
            );
            return;
          }
          changes.push({
            rowId: targetRow.id,
            rowLabel: targetRow.cells._sampleId || targetRow.id,
            columnKey: column.key,
            columnLabel: column.label,
            before: targetRow.cells[column.key] ?? "",
            after: validation.value,
          });
        });
      }

      setImportPreview({
        fileName: file.name,
        changes: changes.filter((change) => change.before !== change.after),
        errors,
        unmappedColumns: [...new Set(unmappedColumns)],
      });
    } catch (err) {
      setTableActionError(
        err instanceof Error ? err.message : "Failed to read workbook"
      );
    } finally {
      setImportBusy(false);
    }
  };

  const applyImportPreview = async () => {
    if (!importPreview || importPreview.errors.length > 0) return;
    const ok = await applyCellChangeBatch(importPreview.changes, "Excel import");
    if (ok) setImportPreview(null);
  };

  const handleTableShortcut = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (!(event.metaKey || event.ctrlKey)) return;
    const target = event.target as HTMLElement | null;
    if (
      target?.closest("input, textarea, select, [contenteditable='true']")
    ) {
      return;
    }
    const key = event.key.toLowerCase();
    if (key === "z" && event.shiftKey) {
      event.preventDefault();
      void redoLastChange();
    } else if (key === "z") {
      event.preventDefault();
      void undoLastChange();
    } else if (key === "y") {
      event.preventDefault();
      void redoLastChange();
    }
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

  // Column visibility — the first column (Sample ID) is the sticky row anchor and
  // always stays; everything else can be toggled from the "Columns" menu.
  const hideableColumns = columns.slice(1);
  const visibleColumns = columns.filter(
    (column, index) => index === 0 || !hiddenColumns.has(column.key)
  );

  // Inject a "+" column right after the last MIxS column (falling back to after
  // the Sequencing Order block), so adding a MIxS field feels like a table action.
  const ADD_MIXS_KEY = "__add_mixs__";
  const showAddMixs = data.availableMixsFields.length > 0;
  let addMixsAfter = -1;
  if (showAddMixs) {
    visibleColumns.forEach((column, index) => {
      if (column.group === "mixs") addMixsAfter = index;
    });
    if (addMixsAfter === -1) {
      visibleColumns.forEach((column, index) => {
        if (column.group === "order") addMixsAfter = index;
      });
    }
  }
  const renderColumns: StudyTableColumn[] =
    showAddMixs && addMixsAfter >= 0
      ? [
          ...visibleColumns.slice(0, addMixsAfter + 1),
          { key: ADD_MIXS_KEY, label: "", kind: "field", group: "mixs" },
          ...visibleColumns.slice(addMixsAfter + 1),
        ]
      : visibleColumns;

  // Row/header padding by density (Comfortable vs. Compact).
  const cellPad = density === "compact" ? "px-2 py-0.5" : "px-3 py-1.5";
  const headPad = density === "compact" ? "px-2 py-1" : "px-3 py-2";

  // Keyboard navigation grid: editable cells addressed by (rowId, colKey) over the
  // rows + columns currently on screen (so it follows filters, sort, and hiding).
  const navRowIds = displayRows.map((row) => row.id);
  const navColKeys = renderColumns
    .filter((column) => column.editable && column.key !== ADD_MIXS_KEY)
    .map((column) => column.key);
  const editableColumns = columns.filter((column) => column.editable);
  const editableColumnByKey = new Map(
    editableColumns.map((column) => [column.key, column])
  );
  const rowById = new Map(rows.map((row) => [row.id, row]));
  const validationByCell = new Map<string, string>();
  for (const row of rows) {
    for (const column of editableColumns) {
      const validation = validateStudyTableCellValue(
        column,
        row.cells[column.key] ?? ""
      );
      if (validation.error) {
        validationByCell.set(
          cellValidationKey(row.id, column.key),
          validation.error
        );
      }
    }
  }
  const validationCount = validationByCell.size;
  // If the active cell's row/column has left the view (filtered out, hidden, or
  // sorted away), drop the stale pointer so navigation isn't trapped. Any pending
  // edit on that cell is persisted by the cell's own unmount handler.
  if (
    activeCell &&
    (!navRowIds.includes(activeCell.rowId) ||
      !navColKeys.includes(activeCell.colKey))
  ) {
    setActiveCell(null);
    if (cellEditing) setCellEditing(false);
  }
  const isActiveCell = (rowId: string, colKey: string) =>
    activeCell?.rowId === rowId && activeCell?.colKey === colKey;
  const focusCell = (rowId: string, colKey: string) =>
    setActiveCell((prev) =>
      prev && prev.rowId === rowId && prev.colKey === colKey
        ? prev
        : { rowId, colKey }
    );
  const moveActiveCell = (dRow: number, dCol: number, startEditing: boolean) => {
    setActiveCell((prev) => {
      if (!prev) return prev;
      const r = navRowIds.indexOf(prev.rowId);
      const c = navColKeys.indexOf(prev.colKey);
      if (r < 0 || c < 0) return prev;
      const nr = Math.min(Math.max(r + dRow, 0), navRowIds.length - 1);
      const nc = Math.min(Math.max(c + dCol, 0), navColKeys.length - 1);
      return { rowId: navRowIds[nr], colKey: navColKeys[nc] };
    });
    setCellEditing(startEditing);
  };

  // Client-side CSV of exactly what's on screen: visible columns (minus the "+"
  // sentinel), in display order, for the filtered + sorted rows.
  const exportColumns = renderColumns.filter((c) => c.key !== ADD_MIXS_KEY);
  const downloadCurrentViewCsv = () => {
    const esc = (value: string) =>
      /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
    const header = exportColumns.map((c) => esc(c.label)).join(",");
    const body = displayRows
      .map((row) => exportColumns.map((c) => esc(row.cells[c.key] ?? "")).join(","))
      .join("\r\n");
    // Prepend a BOM so Excel reads UTF-8 correctly.
    const blob = new Blob([`﻿${header}\r\n${body}`], {
      type: "text/csv;charset=utf-8;",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `${(study.alias || study.title || "study").replace(
      /[^a-z0-9_-]+/gi,
      "_"
    )}-table-view.csv`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const exportButton = (
    <Popover open={exportMenuOpen} onOpenChange={setExportMenuOpen}>
      <PopoverTrigger asChild>
        <Button disabled={rows.length === 0}>
          <Download className="mr-2 h-4 w-4" /> Export
          <ChevronDown className="ml-1.5 h-3.5 w-3.5" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-72 p-1">
        <a
          href={`/api/studies/${id}/table/export`}
          onClick={() => setExportMenuOpen(false)}
          className="block rounded px-2 py-1.5 hover:bg-muted"
        >
          <div className="text-sm font-medium">Full table (XLSX)</div>
          <div className="text-xs text-muted-foreground">
            Every column and row, plus the study info sheet
          </div>
        </a>
        <button
          type="button"
          disabled={displayRows.length === 0}
          onClick={() => {
            downloadCurrentViewCsv();
            setExportMenuOpen(false);
          }}
          className="block w-full rounded px-2 py-1.5 text-left hover:bg-muted disabled:opacity-50"
        >
          <div className="text-sm font-medium">Current view (CSV)</div>
          <div className="text-xs text-muted-foreground">
            {exportColumns.length} column{exportColumns.length === 1 ? "" : "s"} ×{" "}
            {displayRows.length} row{displayRows.length === 1 ? "" : "s"} — matches
            your filters, hidden columns &amp; sort
          </div>
        </button>
      </PopoverContent>
    </Popover>
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
          click a cell to edit · Enter saves &amp; moves down, Tab moves across,
          arrows navigate
        </span>
      </div>
    </div>
  );

  // Bulk edit reuses the per-cell PATCH endpoint (sequential — a study's worth of
  // rows is gentle on the API; each PATCH re-validates the field server-side).
  const bulkColumn =
    editableColumns.find((column) => column.key === bulkColumnKey) || null;

  const applyBulkEdit = async () => {
    if (!bulkColumn || displayRows.length === 0) return;
    const targets = [...displayRows];
    setBulkBusy(true);
    setBulkDone(0);
    setBulkError("");
    try {
      const validation = validateStudyTableCellValue(bulkColumn, bulkValue);
      if (validation.error) {
        setBulkError(validation.error);
        return;
      }
      const changes = targets.map((row) => ({
        rowId: row.id,
        rowLabel: row.cells._sampleId || row.id,
        columnKey: bulkColumn.key,
        columnLabel: bulkColumn.label,
        before: row.cells[bulkColumn.key] ?? "",
        after: validation.value,
      }));
      const meaningful = changes.filter((change) => change.before !== change.after);
      setBulkDone(meaningful.length);
      const ok = await applyCellChangeBatch(meaningful, "Bulk edit");
      if (!ok) return;
      setBulkOpen(false);
      setBulkColumnKey("");
      setBulkValue("");
    } catch (err) {
      setBulkError(
        err instanceof Error ? err.message : "Failed to apply bulk edit"
      );
    } finally {
      setBulkBusy(false);
    }
  };

  const bulkPanel = (
    <Popover
      open={bulkOpen}
      onOpenChange={(open) => {
        if (!bulkBusy) setBulkOpen(open);
      }}
    >
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          disabled={editableColumns.length === 0 || rows.length === 0}
        >
          <PencilLine className="mr-2 h-4 w-4" /> Bulk edit
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-80 space-y-2 p-3">
        <p className="text-xs text-muted-foreground">
          Set one field on all {displayRows.length} shown row
          {displayRows.length === 1 ? "" : "s"}. Filter the table first to target a
          subset.
        </p>
        {bulkError && (
          <p className="rounded border border-destructive/20 bg-destructive/5 px-2 py-1 text-xs text-destructive">
            {bulkError}
          </p>
        )}
        <label className="block text-xs font-medium text-muted-foreground">
          Field
          <select
            value={bulkColumnKey}
            onChange={(event) => {
              setBulkColumnKey(event.target.value);
              setBulkValue("");
            }}
            className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm font-normal text-foreground outline-none"
          >
            <option value="">Choose a field…</option>
            {editableColumns.map((column) => (
              <option key={column.key} value={column.key}>
                {column.label}
              </option>
            ))}
          </select>
        </label>
        {bulkColumn && (
          <label className="block text-xs font-medium text-muted-foreground">
            New value <span className="font-normal">(leave empty to clear)</span>
            {bulkColumn.fieldType === "select" && bulkColumn.options ? (
              <select
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
                className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm font-normal text-foreground outline-none"
              >
                <option value="">—</option>
                {bulkColumn.options.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={
                  bulkColumn.fieldType === "number"
                    ? "number"
                    : bulkColumn.fieldType === "date"
                      ? "date"
                      : "text"
                }
                value={bulkValue}
                onChange={(event) => setBulkValue(event.target.value)}
                className="mt-1 w-full rounded border bg-background px-2 py-1 text-sm font-normal text-foreground outline-none"
              />
            )}
          </label>
        )}
        <Button
          size="sm"
          className="w-full"
          disabled={!bulkColumn || bulkBusy || displayRows.length === 0}
          onClick={applyBulkEdit}
        >
          {bulkBusy ? (
            <>
              <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Applying… {bulkDone}/
              {displayRows.length}
            </>
          ) : (
            `Apply to ${displayRows.length} row${
              displayRows.length === 1 ? "" : "s"
            }`
          )}
        </Button>
      </PopoverContent>
    </Popover>
  );

  // Per-column sort dropdown that lives in the header row (Excel/Sheets-style).
  // "Add as sort level" builds the multi-level sort; one menu is open at a time.
  const sortItemClass =
    "flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm hover:bg-muted";
  const columnSortControl = (column: StudyTableColumn) => {
    const sortIndex = sortLevels.findIndex((l) => l.key === column.key);
    const inSort = sortIndex >= 0;
    return (
      <Popover
        open={openSortCol === column.key}
        onOpenChange={(open) => setOpenSortCol(open ? column.key : null)}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            aria-label={`Sort options for ${column.label}`}
            title="Sort options"
            className={cn(
              "inline-flex flex-shrink-0 rounded p-0.5 hover:bg-foreground/10 hover:text-foreground",
              inSort
                ? "text-primary"
                : "text-muted-foreground/40 opacity-0 focus:opacity-100 group-hover/th:opacity-100"
            )}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" className="w-48 p-1">
          <button
            type="button"
            onClick={() => {
              setSortLevels([{ key: column.key, dir: "asc" }]);
              setOpenSortCol(null);
            }}
            className={sortItemClass}
          >
            <ArrowUp className="h-3.5 w-3.5" /> Sort A → Z
          </button>
          <button
            type="button"
            onClick={() => {
              setSortLevels([{ key: column.key, dir: "desc" }]);
              setOpenSortCol(null);
            }}
            className={sortItemClass}
          >
            <ArrowDown className="h-3.5 w-3.5" /> Sort Z → A
          </button>
          {sortLevels.length > 0 && !inSort && (
            <button
              type="button"
              onClick={() => {
                setSortLevels([...sortLevels, { key: column.key, dir: "asc" }]);
                setOpenSortCol(null);
              }}
              className={sortItemClass}
            >
              <Plus className="h-3.5 w-3.5" /> Add as sort level
            </button>
          )}
          {inSort && sortLevels.length > 1 && (
            <button
              type="button"
              onClick={() => {
                setSortLevels((prev) =>
                  prev.filter((l) => l.key !== column.key)
                );
                setOpenSortCol(null);
              }}
              className={sortItemClass}
            >
              <X className="h-3.5 w-3.5" /> Remove from sort
            </button>
          )}
          {sortLevels.length > 0 && (
            <button
              type="button"
              onClick={() => {
                setSortLevels([]);
                setOpenSortCol(null);
              }}
              className={cn(
                sortItemClass,
                "mt-1 border-t text-muted-foreground"
              )}
            >
              Clear sorting
            </button>
          )}
        </PopoverContent>
      </Popover>
    );
  };

  const columnsMenu = (
    <Popover open={columnsMenuOpen} onOpenChange={setColumnsMenuOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 className="mr-2 h-4 w-4" /> Columns
          {hiddenColumns.size > 0 && (
            <span className="ml-1.5 rounded bg-muted px-1 text-xs text-muted-foreground">
              {hiddenColumns.size} hidden
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-medium text-muted-foreground">
            Show columns
          </span>
          {hiddenColumns.size > 0 && (
            <button
              type="button"
              onClick={() => persistHidden(new Set())}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Show all
            </button>
          )}
        </div>
        <div className="max-h-80 overflow-auto">
          {COLUMN_GROUP_ORDER.map((group) => {
            const cols = hideableColumns.filter((c) => c.group === group);
            if (cols.length === 0) return null;
            return (
              <div key={group} className="mb-1.5">
                <div className="px-1 py-0.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground/70">
                  {COLUMN_GROUP_LABEL[group]}
                </div>
                {cols.map((c) => (
                  <label
                    key={c.key}
                    className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 text-sm hover:bg-muted"
                  >
                    <input
                      type="checkbox"
                      checked={!hiddenColumns.has(c.key)}
                      onChange={() => toggleColumnHidden(c.key)}
                      className="h-3.5 w-3.5"
                    />
                    <span className="truncate">{c.label}</span>
                  </label>
                ))}
              </div>
            );
          })}
        </div>
      </PopoverContent>
    </Popover>
  );

  const statusMenu = (
    <Popover open={statusMenuOpen} onOpenChange={setStatusMenuOpen}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm">
          <Filter className="mr-2 h-4 w-4" /> Status
          {statusFilter.size > 0 && (
            <span className="ml-1.5 rounded bg-primary/10 px-1 text-xs text-primary">
              {statusFilter.size}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-56 p-2">
        <div className="mb-1 flex items-center justify-between px-1">
          <span className="text-xs font-medium text-muted-foreground">
            Filter by status
          </span>
          {statusFilter.size > 0 && (
            <button
              type="button"
              onClick={() => setStatusFilter(new Set())}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              Clear
            </button>
          )}
        </div>
        {FACILITY_SAMPLE_STATUSES.map((status) => {
          const count = textFilteredRows.filter(
            (r) => r.status === status
          ).length;
          return (
            <label
              key={status}
              className="flex cursor-pointer items-center gap-2 rounded px-1 py-1 text-sm hover:bg-muted"
            >
              <input
                type="checkbox"
                checked={statusFilter.has(status)}
                onChange={() => toggleStatusFilter(status)}
                className="h-3.5 w-3.5"
              />
              <span
                className={cn(
                  "inline-flex rounded-full border px-2 py-0.5 text-xs font-medium",
                  FACILITY_SAMPLE_STATUS_BADGE_CLASSNAMES[status]
                )}
              >
                {FACILITY_SAMPLE_STATUS_LABELS[status]}
              </span>
              <span className="ml-auto text-xs text-muted-foreground">
                {count}
              </span>
            </label>
          );
        })}
      </PopoverContent>
    </Popover>
  );

  const densityToggle = (
    <div className="inline-flex overflow-hidden rounded-md border">
      {(["comfortable", "compact"] as const).map((d) => (
        <button
          key={d}
          type="button"
          onClick={() => persistDensity(d)}
          className={cn(
            "px-2.5 py-1.5 text-xs capitalize",
            density === d
              ? "bg-muted font-medium text-foreground"
              : "text-muted-foreground hover:bg-muted/50"
          )}
        >
          {d}
        </button>
      ))}
    </div>
  );

  const undoRedoControls = (
    <div className="inline-flex overflow-hidden rounded-md border">
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-none border-r px-2"
            disabled={undoStack.length === 0 || tableActionBusy}
            onClick={undoLastChange}
            aria-label="Undo last table change"
          >
            <Undo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Undo last table change</TooltipContent>
      </Tooltip>
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 rounded-none px-2"
            disabled={redoStack.length === 0 || tableActionBusy}
            onClick={redoLastChange}
            aria-label="Redo last table change"
          >
            <Redo2 className="h-4 w-4" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Redo last undone change</TooltipContent>
      </Tooltip>
    </div>
  );

  const importButton = (
    <Button
      type="button"
      variant="outline"
      size="sm"
      disabled={rows.length === 0 || tableActionBusy || importBusy}
      onClick={() => importInputRef.current?.click()}
    >
      {importBusy ? (
        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
      ) : (
        <Upload className="mr-2 h-4 w-4" />
      )}
      Import XLSX
    </Button>
  );

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <input
          value={filterQuery}
          onChange={(event) => setFilterQuery(event.target.value)}
          placeholder="Filter rows…"
          className="w-56 rounded-md border bg-background py-1.5 pl-8 pr-2 text-sm outline-none focus:ring-1 focus:ring-primary/30"
        />
      </div>
      {columnsMenu}
      {statusMenu}
      {bulkPanel}
      {importButton}
      {undoRedoControls}
      {densityToggle}
      {validationCount > 0 && (
        <span className="inline-flex items-center gap-1 rounded-md border border-destructive/20 bg-destructive/5 px-2 py-1 text-xs font-medium text-destructive">
          <AlertCircle className="h-3.5 w-3.5" />
          {validationCount} invalid cell{validationCount === 1 ? "" : "s"}
        </span>
      )}
      {isFiltered && (
        <span className="text-xs text-muted-foreground">
          {displayRows.length} of {rows.length}
        </span>
      )}
      {sortLevels.length > 0 && (
        <button
          type="button"
          onClick={() => setSortLevels([])}
          className="text-xs text-muted-foreground underline hover:text-foreground"
        >
          clear sort
        </button>
      )}
    </div>
  );

  const tableFeedback =
    tableActionBusy || tableActionError || tableNotice ? (
      <div
        className={cn(
          "flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-sm",
          tableActionError
            ? "border-destructive/20 bg-destructive/5 text-destructive"
            : "bg-muted/30 text-muted-foreground"
        )}
      >
        {tableActionBusy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : tableActionError ? (
          <AlertCircle className="h-4 w-4" />
        ) : (
          <Info className="h-4 w-4" />
        )}
        <span>
          {tableActionBusy
            ? "Updating table…"
            : tableActionError || tableNotice}
        </span>
      </div>
    ) : null;

  const importPreviewPanel = importPreview ? (
    <div
      className={cn(
        "space-y-3 rounded-lg border p-3 text-sm",
        importPreview.errors.length > 0
          ? "border-destructive/20 bg-destructive/5"
          : "bg-muted/20"
      )}
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">Excel import preview</div>
          <p className="mt-0.5 truncate text-xs text-muted-foreground">
            {importPreview.fileName} · {importPreview.changes.length} changed cell
            {importPreview.changes.length === 1 ? "" : "s"}
            {importPreview.unmappedColumns.length > 0
              ? ` · ${importPreview.unmappedColumns.length} unmapped column${
                  importPreview.unmappedColumns.length === 1 ? "" : "s"
                }`
              : ""}
          </p>
        </div>
        <div className="flex flex-shrink-0 items-center gap-2">
          <Button
            type="button"
            size="sm"
            disabled={
              importPreview.errors.length > 0 ||
              importPreview.changes.length === 0 ||
              tableActionBusy
            }
            onClick={applyImportPreview}
          >
            Apply
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={tableActionBusy}
            onClick={() => setImportPreview(null)}
          >
            Cancel
          </Button>
        </div>
      </div>

      {importPreview.errors.length > 0 && (
        <div className="space-y-1 text-xs text-destructive">
          {importPreview.errors.slice(0, 5).map((item, index) => (
            <div key={`${item}-${index}`}>• {item}</div>
          ))}
          {importPreview.errors.length > 5 && (
            <div>• {importPreview.errors.length - 5} more error(s)</div>
          )}
        </div>
      )}

      {importPreview.errors.length === 0 && importPreview.changes.length > 0 && (
        <div className="space-y-1 text-xs text-muted-foreground">
          {importPreview.changes.slice(0, 5).map((change, index) => (
            <div key={`${change.rowId}-${change.columnKey}-${index}`}>
              {change.rowLabel} / {change.columnLabel}: “{change.before || "—"}”
              → “{change.after || "—"}”
            </div>
          ))}
          {importPreview.changes.length > 5 && (
            <div>{importPreview.changes.length - 5} more change(s)</div>
          )}
        </div>
      )}

      {importPreview.unmappedColumns.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Unmapped columns ignored: {importPreview.unmappedColumns.slice(0, 6).join(", ")}
          {importPreview.unmappedColumns.length > 6 ? ", …" : ""}
        </p>
      )}
    </div>
  ) : null;

  // The grid renders headers ALWAYS (so an empty study still shows its columns +
  // per-column help), and a spanning placeholder row when there are no samples.
  const grid = (maxHeight: string) => (
    <div
      className="overflow-auto rounded-lg border bg-card [container-type:inline-size]"
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
                      "sticky top-0 z-20 border-b text-center",
                      headPad,
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
                  "group/th sticky top-0 z-20 whitespace-nowrap border-b text-left font-semibold text-foreground/80",
                  headPad,
                  GROUP_HEADER_TINT[column.group],
                  index === 0 && "left-0 z-30"
                )}
              >
                <span className="inline-flex items-center gap-1">
                  {(() => {
                    const sortIndex = sortLevels.findIndex(
                      (level) => level.key === column.key
                    );
                    // The help text now shows on hovering the column name itself —
                    // no separate (i) icon.
                    const labelButton = (
                      <button
                        type="button"
                        onClick={() => toggleSort(column.key)}
                        className="inline-flex items-center gap-1 hover:text-foreground"
                      >
                        {column.label}
                        {sortIndex >= 0 && (
                          <span className="inline-flex items-center text-primary">
                            {sortLevels[sortIndex].dir === "asc" ? (
                              <ArrowUp className="h-3 w-3" />
                            ) : (
                              <ArrowDown className="h-3 w-3" />
                            )}
                            {sortLevels.length > 1 && (
                              <span className="text-[9px] font-semibold">
                                {sortIndex + 1}
                              </span>
                            )}
                          </span>
                        )}
                      </button>
                    );
                    return column.helpText ? (
                      <Tooltip>
                        <TooltipTrigger asChild>{labelButton}</TooltipTrigger>
                        <TooltipContent className="max-w-xs font-normal">
                          {column.helpText}
                        </TooltipContent>
                      </Tooltip>
                    ) : (
                      labelButton
                    );
                  })()}
                  {column.required && (
                    <span className="text-muted-foreground/60">*</span>
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
                  {columnSortControl(column)}
                </span>
              </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {displayRows.length === 0 ? (
            <tr>
              <td colSpan={renderColumns.length} className="p-0">
                {/* Pinned to the left of the visible scroll area and sized to it
                    (100cqw), so the message stays centered in the viewport rather
                    than the full — possibly very wide — table. */}
                <div className="sticky left-0 w-[100cqw] px-4 py-16 text-center text-muted-foreground">
                  <Table2 className="mx-auto mb-2 h-6 w-6" />
                  {rows.length === 0 ? (
                    <>
                      <p className="text-sm font-medium text-foreground">
                        No samples in this study yet
                      </p>
                      <p className="mt-1 text-sm">
                        Assign samples to this study to see them here. The columns
                        above show what will be captured for each sample.
                      </p>
                    </>
                  ) : (
                    <p className="text-sm">No rows match “{filterQuery}”.</p>
                  )}
                </div>
              </td>
            </tr>
          ) : (
            displayRows.map((row) => {
              const tint = STATUS_ROW_TINT[row.status];
              return (
                <tr key={row.id} className={cn("border-b", tint)}>
                  {renderColumns.map((column, index) => {
                    if (column.key === ADD_MIXS_KEY) {
                      return <td key={ADD_MIXS_KEY} className={cellPad} />;
                    }
                    const validationError = column.editable
                      ? validationByCell.get(cellValidationKey(row.id, column.key))
                      : undefined;
                    return (
                    <td
                      key={column.key}
                      title={validationError}
                      className={cn(
                        "whitespace-nowrap align-top",
                        cellPad,
                        validationError &&
                          "bg-destructive/5 ring-1 ring-inset ring-destructive/25",
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
                          onSaved={(next) => updateCell(row, column, next)}
                          active={isActiveCell(row.id, column.key)}
                          editing={
                            cellEditing && isActiveCell(row.id, column.key)
                          }
                          onActivate={() => focusCell(row.id, column.key)}
                          onStartEdit={() => {
                            focusCell(row.id, column.key);
                            setCellEditing(true);
                          }}
                          onStopEdit={() => setCellEditing(false)}
                          onMove={moveActiveCell}
                          onPasteText={(text) =>
                            void pasteIntoCell(row.id, column.key, text)
                          }
                          validationError={validationError}
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
          {/* Append-a-row affordance: starts a new sequencing order for this study. */}
          <tr className="border-t">
            <td colSpan={renderColumns.length} className="p-0">
              <Link
                href={`/orders/new?study=${id}`}
                className="block transition-colors hover:bg-muted/50"
              >
                <span className="sticky left-0 flex w-fit items-center gap-2 px-3 py-2 text-sm font-medium text-muted-foreground">
                  <Plus className="h-4 w-4" /> Add samples
                </span>
              </Link>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  );

  return (
    <>
      <input
        ref={importInputRef}
        type="file"
        accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        className="hidden"
        onChange={(event) => {
          const file = event.currentTarget.files?.[0];
          if (file) void handleImportFile(file);
          event.currentTarget.value = "";
        }}
      />
      <PageContainer>
        <div className="space-y-4" onKeyDown={handleTableShortcut}>
          {/* Header */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <Button variant="ghost" size="sm" asChild className="-ml-2 mb-1">
                <Link href={`/studies/${id}`}>
                  <ArrowLeft className="mr-2 h-4 w-4" /> {study.title}
                </Link>
              </Button>
              <div className="flex flex-wrap items-center gap-2">
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
                              <InfoFieldValue value={field.value} />
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

          {/* Toolbar: filter + columns + status + density (the "Add samples"
              action lives in the table as a row) */}
          {toolbar}
          {tableFeedback}
          {importPreviewPanel}

          {grid("calc(100vh - 400px)")}

          {legends}
        </div>
      </PageContainer>

      {/* Fullscreen overlay — table at the full viewport width. */}
      {fullscreen && (
        <div
          className="fixed inset-0 z-50 flex flex-col bg-background"
          onKeyDown={handleTableShortcut}
        >
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
          <div className="space-y-2 border-b px-4 py-2">
            {toolbar}
            {tableFeedback}
            {importPreviewPanel}
            {legends}
          </div>
          <div className="flex-1 overflow-hidden p-4">
            {grid("calc(100vh - 230px)")}
          </div>
        </div>
      )}
    </>
  );
}
