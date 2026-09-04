"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactElement,
} from "react";
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Columns3,
  Download,
  Flag,
  Loader2,
  MoreHorizontal,
  RotateCcw,
  Search,
  Table2,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type DataGridCellValue = string | number | boolean | null;
export type DataGridColumnType = "string" | "number" | "boolean" | "date" | "json";
export type DataGridDensity = "comfortable" | "compact";
export type DataGridRowAction = "flag" | "exclude" | "restore";

export interface DataGridColumn {
  key: string;
  label: string;
  type: DataGridColumnType;
  /** Semantic role such as "sample" or "taxon"; shown as a small badge in the header. */
  role?: string;
  /** Source group such as "identity", "pipeline" or "study"; tints the header. */
  group?: string;
  editable?: boolean;
}

export interface DataGridRow {
  rowKey: string;
  data: Record<string, DataGridCellValue>;
  /** Shown as small badges in the leading status cell. */
  flags?: string[];
  /** Rendered muted and struck through, with a "Restore" row action. */
  excluded?: boolean;
  /** Column keys whose value is an override; those cells carry a marker. */
  edited?: string[];
}

export interface DataGridProps {
  columns: DataGridColumn[];
  rows: DataGridRow[];
  /** Controlled hidden-column keys; when undefined the grid manages visibility itself. */
  hiddenColumns?: string[];
  onHiddenColumnsChange?: (keys: string[]) => void;
  onCellEdit?: (
    rowKey: string,
    columnKey: string,
    value: DataGridCellValue
  ) => Promise<void> | void;
  onRowAction?: (rowKey: string, action: DataGridRowAction) => void;
  loading?: boolean;
  emptyText?: string;
  /** File name of the CSV download; defaults to "export.csv". */
  exportFileName?: string;
  /** Total rows in the dataset, for "showing N of M" when only a page is loaded. */
  total?: number;
  hasMore?: boolean;
  onLoadMore?: () => void;
  /** Initial row density; the toolbar toggle takes over afterwards. */
  density?: DataGridDensity;
  onDensityChange?: (density: DataGridDensity) => void;
  /** CSS max-height of the scroll container; defaults to "70vh". */
  maxHeight?: string;
  className?: string;
}

// ---------------------------------------------------------------------------
// Internal types and constants
// ---------------------------------------------------------------------------

type SortDirection = "asc" | "desc";

interface SortState {
  key: string;
  dir: SortDirection;
}

interface CellPosition {
  row: number;
  col: number;
}

interface EditingState {
  rowKey: string;
  columnKey: string;
  draft: string;
  /** Select the whole draft on open (false when the edit was started by typing). */
  selectAll: boolean;
}

/** How an editor closes: plain close, or commit-and-move within the row. */
type EditorExit = "close" | "next" | "prev";

type ParsedInput =
  | { ok: true; value: DataGridCellValue }
  | { ok: false; error: string };

const SKELETON_ROW_COUNT = 6;
const SKELETON_MIN_COLUMNS = 4;
const LONG_TEXT_TITLE_THRESHOLD = 40;

// Header tint by column group, mirroring the study table so the same sources read
// alike across the app. Unknown groups pick a deterministic tint from the palette.
const KNOWN_GROUP_TINTS: Record<string, string> = {
  identity: "bg-muted",
  status: "bg-muted",
  sample: "bg-muted",
  order: "bg-amber-100/70 dark:bg-amber-900/30",
  sequencing: "bg-amber-100/70 dark:bg-amber-900/30",
  study: "bg-sky-100/70 dark:bg-sky-900/30",
  mixs: "bg-violet-100/70 dark:bg-violet-900/30",
  pipeline: "bg-emerald-100/70 dark:bg-emerald-900/30",
  output: "bg-emerald-100/70 dark:bg-emerald-900/30",
  curation: "bg-rose-100/70 dark:bg-rose-900/30",
};

const FALLBACK_GROUP_TINTS = [
  "bg-amber-100/70 dark:bg-amber-900/30",
  "bg-sky-100/70 dark:bg-sky-900/30",
  "bg-violet-100/70 dark:bg-violet-900/30",
  "bg-emerald-100/70 dark:bg-emerald-900/30",
  "bg-rose-100/70 dark:bg-rose-900/30",
  "bg-teal-100/70 dark:bg-teal-900/30",
];

const TRUE_WORDS = new Set(["true", "1", "yes", "y", "t"]);
const FALSE_WORDS = new Set(["false", "0", "no", "n", "f"]);

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

function groupTint(group: string | undefined): string {
  if (!group) return "bg-muted";
  const known = KNOWN_GROUP_TINTS[group.toLowerCase()];
  if (known) return known;
  let hash = 0;
  for (let index = 0; index < group.length; index += 1) {
    hash = (hash * 31 + group.charCodeAt(index)) >>> 0;
  }
  return FALLBACK_GROUP_TINTS[hash % FALLBACK_GROUP_TINTS.length];
}

// Up to six significant digits, but never rounding away the integer part of a
// large value (a read count must stay exact); integers print verbatim.
function formatNumber(value: number): string {
  if (!Number.isFinite(value) || Number.isInteger(value)) return String(value);
  const magnitude = Math.abs(value);
  if (magnitude >= 1) {
    const integerDigits = Math.floor(Math.log10(magnitude)) + 1;
    const fractionDigits = Math.max(0, 6 - integerDigits);
    return String(Number(value.toFixed(fractionDigits)));
  }
  return String(Number(value.toPrecision(6)));
}

function formatCellValue(
  value: DataGridCellValue | undefined,
  type: DataGridColumnType
): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return formatNumber(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  if (type === "number") {
    const trimmed = value.trim();
    const numeric = Number(trimmed);
    return trimmed !== "" && Number.isFinite(numeric) ? formatNumber(numeric) : value;
  }
  return value;
}

/** Text shown in the editor: the exact stored value, not the display rounding. */
function editorText(value: DataGridCellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

function csvField(value: DataGridCellValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
}

// RFC 4180: quote fields holding a quote, comma or line break; double inner quotes.
function csvEscape(field: string): string {
  return /[",\r\n]/.test(field) ? `"${field.replace(/"/g, '""')}"` : field;
}

function buildCsv(columns: DataGridColumn[], rows: DataGridRow[]): string {
  const lines = [columns.map((column) => csvEscape(column.label)).join(",")];
  for (const row of rows) {
    lines.push(
      columns.map((column) => csvEscape(csvField(row.data[column.key]))).join(",")
    );
  }
  return lines.join("\r\n");
}

function isEmptyValue(value: DataGridCellValue | undefined): boolean {
  return value === null || value === undefined || value === "";
}

function toComparableNumber(value: DataGridCellValue): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value ? 1 : 0;
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed === "") return null;
  const numeric = Number(trimmed);
  return Number.isFinite(numeric) ? numeric : null;
}

function compareCells(
  a: DataGridCellValue,
  b: DataGridCellValue,
  type: DataGridColumnType
): number {
  if (type === "number" || type === "boolean") {
    const left = toComparableNumber(a);
    const right = toComparableNumber(b);
    if (left !== null && right !== null) return left - right;
    if (left !== null) return -1;
    if (right !== null) return 1;
  } else if (type === "date") {
    const left = Date.parse(String(a));
    const right = Date.parse(String(b));
    if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  }
  return String(a).localeCompare(String(b), undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

function parseCellInput(text: string, type: DataGridColumnType): ParsedInput {
  const trimmed = text.trim();
  if (trimmed === "") return { ok: true, value: null };
  if (type === "number") {
    const numeric = Number(trimmed);
    return Number.isFinite(numeric)
      ? { ok: true, value: numeric }
      : { ok: false, error: "Enter a number" };
  }
  if (type === "boolean") {
    const word = trimmed.toLowerCase();
    if (TRUE_WORDS.has(word)) return { ok: true, value: true };
    if (FALSE_WORDS.has(word)) return { ok: true, value: false };
    return { ok: false, error: "Enter true or false" };
  }
  return { ok: true, value: trimmed };
}

function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}

function describeRowCount(
  loaded: number,
  shown: number,
  total: number | undefined,
  filtering: boolean
): string {
  const partial = typeof total === "number" && total > loaded;
  if (filtering) {
    const base = `${formatCount(shown)} of ${formatCount(loaded)} rows match`;
    return partial ? `${base} (${formatCount(loaded)} of ${formatCount(total)} loaded)` : base;
  }
  if (partial) return `showing ${formatCount(loaded)} of ${formatCount(total)}`;
  return `${formatCount(loaded)} ${loaded === 1 ? "row" : "rows"}`;
}

function sortAriaValue(dir: SortDirection | null): "ascending" | "descending" | "none" {
  if (dir === "asc") return "ascending";
  if (dir === "desc") return "descending";
  return "none";
}

// ---------------------------------------------------------------------------
// Cell editor
// ---------------------------------------------------------------------------

interface CellEditorProps {
  column: DataGridColumn;
  initialDraft: string;
  selectAll: boolean;
  originalValue: DataGridCellValue | undefined;
  onCommit: (value: DataGridCellValue) => Promise<void> | void;
  onExit: (exit: EditorExit) => void;
}

// The inline editor for one cell. Enter commits, Esc cancels, Tab commits and moves
// across, blur commits. While the commit promise is pending the field is read-only
// with a spinner; a rejected commit keeps the editor open showing the old value.
function CellEditor({
  column,
  initialDraft,
  selectAll,
  originalValue,
  onCommit,
  onExit,
}: CellEditorProps) {
  const [draft, setDraft] = useState(initialDraft);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  // Set once the editor has committed or cancelled, so the blur that fires while it
  // unmounts does not commit the same value a second time.
  const settledRef = useRef(false);

  useEffect(() => {
    const input = inputRef.current;
    if (!input) return;
    input.focus();
    if (selectAll) input.select();
    else input.setSelectionRange(input.value.length, input.value.length);
  }, [selectAll]);

  const finish = async (exit: EditorExit) => {
    if (busyRef.current || settledRef.current) return;
    const parsed = parseCellInput(draft, column.type);
    if (!parsed.ok) {
      setError(parsed.error);
      return;
    }
    if (parsed.value === (originalValue ?? null)) {
      settledRef.current = true;
      onExit(exit);
      return;
    }
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await onCommit(parsed.value);
      settledRef.current = true;
      onExit(exit);
    } catch (cause) {
      setDraft(editorText(originalValue));
      setError(cause instanceof Error && cause.message ? cause.message : "Save failed");
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const cancel = () => {
    if (busyRef.current || settledRef.current) return;
    settledRef.current = true;
    onExit("close");
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Enter") {
      event.preventDefault();
      void finish("close");
    } else if (event.key === "Escape") {
      event.preventDefault();
      cancel();
    } else if (event.key === "Tab") {
      event.preventDefault();
      void finish(event.shiftKey ? "prev" : "next");
    }
  };

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        value={draft}
        onChange={(event) => {
          setDraft(event.target.value);
          if (error) setError(null);
        }}
        onKeyDown={onKeyDown}
        onBlur={() => void finish("close")}
        readOnly={busy}
        aria-busy={busy}
        aria-invalid={error ? true : undefined}
        aria-label={`Edit ${column.label}`}
        title={error ?? undefined}
        inputMode={column.type === "number" ? "decimal" : undefined}
        className={cn(
          "h-7 min-w-[8rem] rounded border-primary/40 px-1.5 py-0.5 text-sm ring-1 ring-primary/30",
          column.type === "number" && "text-right tabular-nums",
          busy && "pr-6 text-muted-foreground",
          error && "border-destructive ring-destructive/30"
        )}
      />
      {busy && (
        <Loader2
          aria-hidden="true"
          className="pointer-events-none absolute right-1.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-muted-foreground"
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Grid
// ---------------------------------------------------------------------------

export function DataGrid({
  columns,
  rows,
  hiddenColumns,
  onHiddenColumnsChange,
  onCellEdit,
  onRowAction,
  loading = false,
  emptyText = "No rows.",
  exportFileName = "export.csv",
  total,
  hasMore = false,
  onLoadMore,
  density: densityProp,
  onDensityChange,
  maxHeight = "70vh",
  className,
}: DataGridProps): ReactElement {
  const [internalHidden, setInternalHidden] = useState<string[]>([]);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<SortState | null>(null);
  const [densityOverride, setDensityOverride] = useState<DataGridDensity | null>(null);
  const [activeCell, setActiveCell] = useState<CellPosition>({ row: 0, col: 0 });
  const [editing, setEditing] = useState<EditingState | null>(null);
  const [metaWidth, setMetaWidth] = useState(0);
  const tableRef = useRef<HTMLTableElement>(null);
  const metaHeaderRef = useRef<HTMLTableCellElement>(null);
  // Cell to focus once an editor has closed, so keyboard use continues from it.
  const focusAfterEdit = useRef<CellPosition | null>(null);

  const density = densityOverride ?? densityProp ?? "comfortable";
  const cellPad = density === "compact" ? "px-2 py-0.5" : "px-3 py-1.5";
  const headPad = density === "compact" ? "px-2 py-1" : "px-3 py-2";

  // Column visibility: controlled through props when `hiddenColumns` is given,
  // internal otherwise. The first column is the sticky row anchor and never hides.
  const hiddenKeys = hiddenColumns ?? internalHidden;
  const hiddenSet = useMemo(() => new Set(hiddenKeys), [hiddenKeys]);
  const visibleColumns = useMemo(
    () => columns.filter((column, index) => index === 0 || !hiddenSet.has(column.key)),
    [columns, hiddenSet]
  );
  const hiddenCount = columns.length - visibleColumns.length;

  const updateHidden = (next: string[]) => {
    if (hiddenColumns === undefined) setInternalHidden(next);
    onHiddenColumnsChange?.(next);
  };
  const setColumnHidden = (key: string, hidden: boolean) => {
    if (hidden) {
      if (!hiddenKeys.includes(key)) updateHidden([...hiddenKeys, key]);
    } else {
      updateHidden(hiddenKeys.filter((candidate) => candidate !== key));
    }
  };

  // A sort on a column that has since been hidden is ignored rather than applied
  // invisibly.
  const effectiveSort =
    sort && visibleColumns.some((column) => column.key === sort.key) ? sort : null;

  const displayRows = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    let result = rows;
    if (needle) {
      result = rows.filter(
        (row) =>
          visibleColumns.some((column) =>
            formatCellValue(row.data[column.key], column.type)
              .toLowerCase()
              .includes(needle)
          ) || (row.flags ?? []).some((flag) => flag.toLowerCase().includes(needle))
      );
    }
    if (!effectiveSort) return result;
    const column = visibleColumns.find((candidate) => candidate.key === effectiveSort.key);
    if (!column) return result;
    const direction = effectiveSort.dir === "asc" ? 1 : -1;
    return result
      .map((row, index) => ({ row, index }))
      .sort((left, right) => {
        const a = left.row.data[column.key];
        const b = right.row.data[column.key];
        const aEmpty = isEmptyValue(a);
        const bEmpty = isEmptyValue(b);
        // Empty values sort last in both directions.
        if (aEmpty || bEmpty) {
          if (aEmpty && bEmpty) return left.index - right.index;
          return aEmpty ? 1 : -1;
        }
        const order = compareCells(a, b, column.type) * direction;
        return order !== 0 ? order : left.index - right.index;
      })
      .map((entry) => entry.row);
  }, [rows, filter, visibleColumns, effectiveSort]);

  const canEditColumn = (column: DataGridColumn) =>
    Boolean(column.editable && onCellEdit);
  const showMeta =
    Boolean(onRowAction) ||
    rows.some((row) => (row.flags?.length ?? 0) > 0 || row.excluded === true);
  const showSkeleton = loading && rows.length === 0;
  const filtering = filter.trim() !== "";
  const columnSpan = visibleColumns.length + (showMeta ? 1 : 0);

  const lastRow = displayRows.length - 1;
  const lastCol = visibleColumns.length - 1;
  const activeRow = Math.min(activeCell.row, Math.max(lastRow, 0));
  const activeCol = Math.min(activeCell.col, Math.max(lastCol, 0));

  // An edit whose row or column is no longer displayed (filtered out, hidden,
  // refetched away) is simply dropped.
  const activeEditing =
    editing &&
    displayRows.some((row) => row.rowKey === editing.rowKey) &&
    visibleColumns.some((column) => column.key === editing.columnKey)
      ? editing
      : null;

  const focusCell = useCallback((row: number, col: number) => {
    const cell = tableRef.current?.querySelector<HTMLElement>(
      `td[data-row-index="${row}"][data-col-index="${col}"]`
    );
    if (!cell) return;
    cell.focus();
    if (typeof cell.scrollIntoView === "function") {
      cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, []);

  useEffect(() => {
    if (activeEditing) return;
    const target = focusAfterEdit.current;
    if (!target) return;
    focusAfterEdit.current = null;
    focusCell(target.row, target.col);
  }, [activeEditing, focusCell]);

  // The leading flags/actions column is sticky at the left edge, so the sticky
  // first data column has to sit right after it; its width depends on the badges.
  useLayoutEffect(() => {
    const element = metaHeaderRef.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => {
      setMetaWidth(element.getBoundingClientRect().width);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [showMeta]);

  const stickyLeft = showMeta ? metaWidth : 0;

  const cycleSort = (key: string) =>
    setSort((previous) => {
      if (!previous || previous.key !== key) return { key, dir: "asc" };
      if (previous.dir === "asc") return { key, dir: "desc" };
      return null;
    });

  const changeDensity = (next: DataGridDensity) => {
    setDensityOverride(next);
    onDensityChange?.(next);
  };

  const activateCell = (row: number, col: number) =>
    setActiveCell((previous) =>
      previous.row === row && previous.col === col ? previous : { row, col }
    );

  const startEdit = (row: number, col: number, initialDraft?: string) => {
    const dataRow = displayRows[row];
    const column = visibleColumns[col];
    if (!dataRow || !column || !canEditColumn(column)) return;
    activateCell(row, col);
    setEditing({
      rowKey: dataRow.rowKey,
      columnKey: column.key,
      draft: initialDraft ?? editorText(dataRow.data[column.key]),
      selectAll: initialDraft === undefined,
    });
  };

  const exitEditor = (row: number, col: number, exit: EditorExit) => {
    if (exit !== "close") {
      const step = exit === "next" ? 1 : -1;
      for (let next = col + step; next >= 0 && next < visibleColumns.length; next += step) {
        if (canEditColumn(visibleColumns[next])) {
          startEdit(row, next);
          return;
        }
      }
    }
    focusAfterEdit.current = { row, col };
    setEditing(null);
  };

  const handleCellKeyDown = (
    event: ReactKeyboardEvent<HTMLTableCellElement>,
    row: number,
    col: number
  ) => {
    // Keys typed inside an editor or a row menu belong to that control.
    if (event.target !== event.currentTarget) return;
    const column = visibleColumns[col];
    const jump = event.ctrlKey || event.metaKey;
    const move = (nextRow: number, nextCol: number) => {
      event.preventDefault();
      focusCell(
        Math.min(Math.max(nextRow, 0), Math.max(lastRow, 0)),
        Math.min(Math.max(nextCol, 0), Math.max(lastCol, 0))
      );
    };
    switch (event.key) {
      case "ArrowDown":
        move(row + 1, col);
        return;
      case "ArrowUp":
        move(row - 1, col);
        return;
      case "ArrowRight":
        move(row, col + 1);
        return;
      case "ArrowLeft":
        move(row, col - 1);
        return;
      case "Home":
        move(jump ? 0 : row, 0);
        return;
      case "End":
        move(jump ? lastRow : row, lastCol);
        return;
      case "Enter":
      case "F2":
        if (column && canEditColumn(column)) {
          event.preventDefault();
          startEdit(row, col);
        }
        return;
      default:
        // A printable character starts editing with that character, like a sheet.
        if (
          column &&
          canEditColumn(column) &&
          event.key.length === 1 &&
          event.key !== " " &&
          !event.ctrlKey &&
          !event.metaKey &&
          !event.altKey
        ) {
          event.preventDefault();
          startEdit(row, col, event.key);
        }
    }
  };

  const exportCsv = () => {
    const csv = buildCsv(visibleColumns, displayRows);
    // The BOM makes Excel read the file as UTF-8.
    const blob = new Blob(["\uFEFF", csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = exportFileName || "export.csv";
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  };

  const rowCountText = describeRowCount(rows.length, displayRows.length, total, filtering);
  const skeletonColumnCount = Math.max(visibleColumns.length, SKELETON_MIN_COLUMNS);

  // ---- Toolbar ----

  const toolbar = (
    <div className="flex flex-wrap items-center gap-2">
      <div className="relative">
        <Search
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Filter rows"
          aria-label="Filter rows"
          className="h-8 w-60 pl-7 pr-7 text-sm"
        />
        {filter !== "" && (
          <button
            type="button"
            onClick={() => setFilter("")}
            aria-label="Clear filter"
            className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-muted-foreground hover:text-foreground"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        )}
      </div>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button variant="outline" size="sm">
            <Columns3 className="h-4 w-4" /> Columns
            {hiddenCount > 0 && (
              <span className="rounded bg-muted px-1 text-xs text-muted-foreground">
                {hiddenCount} hidden
              </span>
            )}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="max-h-80 w-64 overflow-auto">
          <DropdownMenuLabel className="text-xs font-medium text-muted-foreground">
            Show columns
          </DropdownMenuLabel>
          <DropdownMenuSeparator />
          {columns.map((column, index) => (
            <DropdownMenuCheckboxItem
              key={column.key}
              checked={index === 0 || !hiddenSet.has(column.key)}
              disabled={index === 0}
              onCheckedChange={(checked) => setColumnHidden(column.key, !checked)}
              // Keep the menu open while toggling several columns.
              onSelect={(event) => event.preventDefault()}
            >
              {column.label}
            </DropdownMenuCheckboxItem>
          ))}
          {hiddenCount > 0 && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => updateHidden([])}>Show all</DropdownMenuItem>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      <div
        role="group"
        aria-label="Row density"
        className="inline-flex overflow-hidden rounded-md border"
      >
        {(["comfortable", "compact"] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => changeDensity(option)}
            aria-pressed={density === option}
            className={cn(
              "px-2.5 py-1.5 text-xs",
              density === option
                ? "bg-muted font-medium text-foreground"
                : "text-muted-foreground hover:bg-muted/50"
            )}
          >
            {option === "compact" ? "Compact" : "Comfortable"}
          </button>
        ))}
      </div>

      <span
        aria-live="polite"
        className="ml-auto inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground"
      >
        {loading && rows.length > 0 && (
          <Loader2 aria-hidden="true" className="h-3 w-3 animate-spin" />
        )}
        {rowCountText}
      </span>

      <Button
        variant="outline"
        size="sm"
        onClick={exportCsv}
        disabled={displayRows.length === 0}
        aria-label="Export CSV"
      >
        <Download className="h-4 w-4" /> Export CSV
      </Button>
    </div>
  );

  // ---- Header ----

  const header = (
    <thead>
      <tr>
        {showMeta && (
          <th
            ref={metaHeaderRef}
            scope="col"
            className={cn("sticky left-0 top-0 z-30 border-b bg-muted text-left", headPad)}
          >
            <span className="sr-only">Flags and row actions</span>
          </th>
        )}
        {visibleColumns.map((column, index) => {
          const sorted = effectiveSort?.key === column.key ? effectiveSort.dir : null;
          const numeric = column.type === "number";
          return (
            <th
              key={column.key}
              scope="col"
              aria-sort={sortAriaValue(sorted)}
              className={cn(
                "group/th sticky top-0 z-20 whitespace-nowrap border-b text-left font-semibold text-foreground/80",
                headPad,
                groupTint(column.group),
                index === 0 && "z-30"
              )}
              style={index === 0 ? { left: stickyLeft } : undefined}
            >
              <div className={cn("flex items-center gap-1.5", numeric && "justify-end")}>
                <button
                  type="button"
                  onClick={() => cycleSort(column.key)}
                  aria-label={`Sort by ${column.label}`}
                  className="inline-flex items-center gap-1 rounded hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-primary/60"
                >
                  <span>{column.label}</span>
                  {sorted === "asc" ? (
                    <ArrowUp className="h-3 w-3 text-primary" />
                  ) : sorted === "desc" ? (
                    <ArrowDown className="h-3 w-3 text-primary" />
                  ) : (
                    <ArrowUpDown className="h-3 w-3 text-transparent group-hover/th:text-muted-foreground/70" />
                  )}
                </button>
                {column.role && (
                  <Badge
                    variant="outline"
                    className="h-4 px-1 py-0 text-[10px] font-medium uppercase tracking-wide"
                  >
                    {column.role}
                  </Badge>
                )}
              </div>
            </th>
          );
        })}
      </tr>
    </thead>
  );

  // ---- Body ----

  const skeletonRows = Array.from({ length: SKELETON_ROW_COUNT }, (_, rowIndex) => (
    <tr key={`skeleton-${rowIndex}`} className="border-b">
      {showMeta && (
        <td className={cn("sticky left-0 z-10 bg-card", cellPad)}>
          <Skeleton className="h-3.5 w-6" />
        </td>
      )}
      {Array.from({ length: skeletonColumnCount }, (_, colIndex) => (
        <td
          key={colIndex}
          className={cn(cellPad, colIndex === 0 && "sticky z-10 bg-card")}
          style={colIndex === 0 ? { left: stickyLeft } : undefined}
        >
          <Skeleton className="h-3.5 w-24" />
        </td>
      ))}
    </tr>
  ));

  const emptyRow = (
    <tr>
      <td colSpan={Math.max(columnSpan, 1)} className="p-0">
        {/* Pinned to the visible scroll area (100cqw), so the message stays centered
            in the viewport rather than in a possibly very wide table. */}
        <div
          className="sticky left-0 px-4 py-12 text-center text-sm text-muted-foreground"
          style={{ width: "100cqw" }}
        >
          <Table2 aria-hidden="true" className="mx-auto mb-2 h-6 w-6" />
          <p>{rows.length === 0 ? emptyText : `No rows match "${filter.trim()}".`}</p>
        </div>
      </td>
    </tr>
  );

  const renderRow = (row: DataGridRow, rowIndex: number) => {
    const firstColumn = visibleColumns[0];
    const rowLabel = firstColumn
      ? formatCellValue(row.data[firstColumn.key], firstColumn.type) || row.rowKey
      : row.rowKey;
    return (
      <tr
        key={row.rowKey}
        data-excluded={row.excluded ? "true" : undefined}
        className={cn(
          "group/row border-b hover:bg-muted/40",
          row.excluded && "text-muted-foreground"
        )}
      >
        {showMeta && (
          <td
            role="gridcell"
            className={cn(
              "sticky left-0 z-10 whitespace-nowrap bg-card align-top group-hover/row:bg-muted",
              cellPad
            )}
          >
            <div className="flex items-center gap-1">
              {onRowAction && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`Row actions for ${rowLabel}`}
                      className="inline-flex h-5 w-5 items-center justify-center rounded text-muted-foreground hover:bg-foreground/10 hover:text-foreground"
                    >
                      <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start">
                    <DropdownMenuItem onSelect={() => onRowAction(row.rowKey, "flag")}>
                      <Flag /> Flag
                    </DropdownMenuItem>
                    {row.excluded ? (
                      <DropdownMenuItem onSelect={() => onRowAction(row.rowKey, "restore")}>
                        <RotateCcw /> Restore
                      </DropdownMenuItem>
                    ) : (
                      <DropdownMenuItem onSelect={() => onRowAction(row.rowKey, "exclude")}>
                        <Ban /> Exclude
                      </DropdownMenuItem>
                    )}
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
              {row.excluded && (
                <Badge variant="outline" className="px-1 py-0 text-[10px] text-muted-foreground">
                  Excluded
                </Badge>
              )}
              {row.flags?.map((flag) => (
                <Badge key={flag} variant="warning" className="px-1 py-0 text-[10px]">
                  {flag}
                </Badge>
              ))}
            </div>
          </td>
        )}
        {visibleColumns.map((column, colIndex) => {
          const value = row.data[column.key];
          const text = formatCellValue(value, column.type);
          const numeric = column.type === "number";
          const editable = canEditColumn(column);
          const isActive = rowIndex === activeRow && colIndex === activeCol;
          const isEditing =
            activeEditing !== null &&
            activeEditing.rowKey === row.rowKey &&
            activeEditing.columnKey === column.key;
          const isEdited = row.edited?.includes(column.key) ?? false;
          const title = isEdited
            ? "Edited value"
            : typeof value === "number" && text !== String(value)
              ? String(value)
              : text.length >= LONG_TEXT_TITLE_THRESHOLD
                ? text
                : undefined;
          return (
            <td
              key={column.key}
              role="gridcell"
              data-row-index={rowIndex}
              data-col-index={colIndex}
              tabIndex={isActive ? 0 : -1}
              title={title}
              onFocus={() => activateCell(rowIndex, colIndex)}
              onKeyDown={(event) => handleCellKeyDown(event, rowIndex, colIndex)}
              onDoubleClick={editable ? () => startEdit(rowIndex, colIndex) : undefined}
              className={cn(
                "whitespace-nowrap align-top outline-none focus:ring-1 focus:ring-inset focus:ring-primary/60",
                cellPad,
                numeric && "text-right tabular-nums",
                editable && "cursor-text",
                colIndex === 0 && "sticky z-10 font-medium",
                isEdited
                  ? "bg-amber-50 dark:bg-amber-950/60"
                  : colIndex === 0 && "bg-card group-hover/row:bg-muted"
              )}
              style={colIndex === 0 ? { left: stickyLeft } : undefined}
            >
              {isEditing && activeEditing ? (
                <CellEditor
                  column={column}
                  initialDraft={activeEditing.draft}
                  selectAll={activeEditing.selectAll}
                  originalValue={value}
                  onCommit={(next) =>
                    onCellEdit ? onCellEdit(row.rowKey, column.key, next) : undefined
                  }
                  onExit={(exit) => exitEditor(rowIndex, colIndex, exit)}
                />
              ) : (
                <div className="relative">
                  <span
                    className={cn("block max-w-[32rem] truncate", row.excluded && "line-through")}
                  >
                    {text}
                  </span>
                  {isEdited && (
                    <span
                      aria-hidden="true"
                      className="absolute -right-1 -top-0.5 h-1 w-1 rounded-full bg-amber-500"
                    />
                  )}
                </div>
              )}
            </td>
          );
        })}
      </tr>
    );
  };

  return (
    <div className={cn("flex flex-col gap-2", className)} data-density={density}>
      {toolbar}
      <div
        className="isolate overflow-auto rounded-lg border bg-card [container-type:inline-size]"
        style={{ maxHeight }}
        aria-busy={loading || undefined}
      >
        <table ref={tableRef} role="grid" className="w-full border-collapse text-sm">
          {header}
          <tbody>
            {showSkeleton
              ? skeletonRows
              : displayRows.length === 0
                ? emptyRow
                : displayRows.map(renderRow)}
          </tbody>
        </table>
      </div>
      {hasMore && onLoadMore && (
        <div className="flex justify-center">
          <Button
            variant="outline"
            size="sm"
            onClick={onLoadMore}
            disabled={loading}
            aria-label="Load more rows"
          >
            {loading && <Loader2 aria-hidden="true" className="h-4 w-4 animate-spin" />}
            Load more
          </Button>
        </div>
      )}
    </div>
  );
}
