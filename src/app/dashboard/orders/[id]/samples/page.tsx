"use client";

import { useState, useEffect, useCallback, useRef, useMemo, use } from "react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  CellContext,
  RowData,
} from "@tanstack/react-table";

// Extend TanStack Table meta types
declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnIdOrUpdates: string | Record<string, unknown>, value?: unknown) => void;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    editable?: boolean;
    isReadOnlyAfterSave?: boolean;
    isChecklistField?: boolean;
    isCustomField?: boolean;
    isCoreField?: boolean;
    fieldName?: string;
    fieldType?: string;
    required?: boolean;
    options?: Array<{ value: string; label: string }>;
  }
}
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  ArrowLeft,
  Loader2,
  Save,
  Plus,
  Trash2,
  AlertCircle,
  Check,
  FileSpreadsheet,
  Download,
  Copy,
  Maximize2,
  Minimize2,
  PlusCircle,
  X,
  Settings2,
  ChevronDown,
} from "lucide-react";
import type { FormFieldDefinition } from "@/types/form-config";
import { FIELD_TO_COLUMN_MAP } from "@/lib/sample-fields";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";
import { OrganismCell } from "@/lib/field-types/organism";
import { ExcelToolbar } from "@/components/samples/ExcelToolbar";
import { toast } from "sonner";

// Generate unique sample ID like v1: S-{timestamp}-{random}
function generateSampleId(): string {
  const timestamp = Date.now();
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `S-${timestamp}-${random}`;
}

interface Sample {
  id?: string;
  sampleId: string;
  sampleAlias: string;
  sampleTitle: string;
  sampleDescription: string;
  scientificName: string;
  taxId: string;
  checklistData?: Record<string, string>;
  customFields?: Record<string, unknown>;  // Per-sample order form fields
  isNew?: boolean;
  isDeleted?: boolean;
  isModified?: boolean;
  [key: string]: unknown;
}

interface Order {
  id: string;
  name: string;
  status: string;
}

interface MixsField {
  type: string;
  label: string;
  name: string;
  required: boolean;
  visible: boolean;
  helpText?: string;
  group?: string;
  options?: { value: string; label: string }[];
  units?: { value: string; label: string }[];
  simpleValidation?: {
    pattern?: string;
    patternMessage?: string;
  };
}

interface MixsChecklist {
  name: string;
  description: string;
  accession: string;
  fields: MixsField[];
}

interface FieldInfo {
  field: string;
  headerName: string;
  description: string;
  required: boolean;
  type: string;
  group?: string;
  options?: { value: string; label: string }[];
  units?: { value: string; label: string }[];
  examples?: string[];
  pattern?: string;
}

// Core sample fields metadata (only for Sample ID which is always shown)
const CORE_FIELD_METADATA: Record<string, FieldInfo> = {
  sampleId: {
    field: "sampleId",
    headerName: "Sample ID",
    description: "A unique identifier for this sample. Auto-generated on new row creation. Cannot be changed after saving.",
    required: true,
    type: "text",
    examples: ["S-1737000000000-ABC12"],
  },
};


// Helper to navigate to adjacent cell
function navigateToCell(
  currentInput: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement | HTMLButtonElement,
  direction: 'up' | 'down' | 'left' | 'right'
) {
  const currentCell = currentInput.closest('td');
  if (!currentCell) return;

  const currentRow = currentCell.closest('tr');
  if (!currentRow) return;

  const cells = Array.from(currentRow.querySelectorAll('td'));
  const cellIndex = cells.indexOf(currentCell);

  let targetCell: Element | null = null;

  if (direction === 'left' && cellIndex > 0) {
    targetCell = cells[cellIndex - 1];
  } else if (direction === 'right' && cellIndex < cells.length - 1) {
    targetCell = cells[cellIndex + 1];
  } else if (direction === 'up') {
    const prevRow = currentRow.previousElementSibling;
    if (prevRow) {
      const prevCells = prevRow.querySelectorAll('td');
      targetCell = prevCells[cellIndex] || null;
    }
  } else if (direction === 'down') {
    const nextRow = currentRow.nextElementSibling;
    if (nextRow) {
      const nextCells = nextRow.querySelectorAll('td');
      targetCell = nextCells[cellIndex] || null;
    }
  }

  if (targetCell) {
    const input = targetCell.querySelector('input, select, textarea, button') as HTMLElement;
    if (input) {
      input.focus();
      if (input instanceof HTMLInputElement || input instanceof HTMLTextAreaElement) {
        input.select();
      }
    }
  }
}

// Editable cell component
function EditableCell({
  getValue,
  row,
  column,
  table,
}: CellContext<Sample, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue ?? "");
  const inputRef = useRef<HTMLInputElement>(null);

  // Check if this cell is editable and get validation info
  const columnMeta = column.columnDef.meta as {
    editable?: boolean;
    isReadOnlyAfterSave?: boolean;
    fieldType?: string;
    required?: boolean;
  } | undefined;
  const isEditable = columnMeta?.editable !== false;
  const isReadOnlyAfterSave = columnMeta?.isReadOnlyAfterSave;
  const isSavedRow = !!(row.original.id && !row.original.isNew);
  const isReadOnly = !isEditable || (isReadOnlyAfterSave && isSavedRow);

  // Check if field is required (header ends with *)
  const headerStr = column.columnDef.header?.toString() || "";
  const isRequired = columnMeta?.required ?? headerStr.endsWith("*");

  // Validation status
  const hasValue = value !== undefined && value !== null && value !== "";
  const isValid = !isRequired || hasValue;

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const onBlur = () => {
    if (value !== initialValue) {
      table.options.meta?.updateData(row.index, column.id, value);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'down');
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'up');
    } else if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'left');
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'right');
    } else if (e.key === "Tab") {
      onBlur();
      // Let default Tab behavior work
    } else if (e.key === "Escape") {
      setValue(initialValue ?? "");
      e.currentTarget.blur();
    }
  };

  if (isReadOnly) {
    return (
      <div className="px-2 py-1 h-full bg-gray-50 text-gray-500 cursor-not-allowed flex items-center gap-1">
        <span className="flex-1 truncate">{value}</span>
        {isRequired && hasValue && (
          <Check className="h-3 w-3 text-green-500 flex-shrink-0" />
        )}
        {isRequired && !hasValue && (
          <AlertCircle className="h-3 w-3 text-amber-500 flex-shrink-0" />
        )}
      </div>
    );
  }

  return (
    <div className="relative flex items-center h-full">
      {columnMeta?.fieldType === "textarea" ? (
        <textarea
          value={value ?? ""}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          disabled={isReadOnly}
          className={`w-full h-full px-2 py-1 pr-6 border-0 outline-none bg-transparent focus:bg-blue-50 focus:ring-1 focus:ring-blue-300 resize-none ${
            !isValid ? "bg-amber-50/50" : ""
          }`}
        />
      ) : (
        <input
          ref={inputRef}
          type={
            columnMeta?.fieldType === "number"
              ? "number"
              : columnMeta?.fieldType === "date"
                ? "date"
                : "text"
          }
          value={value ?? ""}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          onKeyDown={onKeyDown}
          disabled={isReadOnly}
          className={`w-full h-full px-2 py-1 pr-6 border-0 outline-none bg-transparent focus:bg-blue-50 focus:ring-1 focus:ring-blue-300 ${
            !isValid ? "bg-amber-50/50" : ""
          }`}
        />
      )}
      {isRequired && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2">
          {hasValue ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <AlertCircle className="h-3 w-3 text-amber-500" />
          )}
        </div>
      )}
    </div>
  );
}

// Select cell component for dropdown fields
function SelectCell({
  getValue,
  row,
  column,
  table,
}: CellContext<Sample, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue);
  const columnMeta = column.columnDef.meta as {
    options?: { value: string; label: string }[];
    editable?: boolean;
    isReadOnlyAfterSave?: boolean;
    required?: boolean;
  } | undefined;
  const options = columnMeta?.options || [];
  const isEditable = columnMeta?.editable !== false;
  const isReadOnlyAfterSave = columnMeta?.isReadOnlyAfterSave;
  const isSavedRow = !!(row.original.id && !row.original.isNew);
  const isReadOnly = !isEditable || (isReadOnlyAfterSave && isSavedRow);

  // Check if field is required (header ends with *)
  const headerStr = column.columnDef.header?.toString() || "";
  const isRequired = columnMeta?.required ?? headerStr.endsWith("*");
  const hasValue = value !== undefined && value !== null && value !== "";

  useEffect(() => {
    setValue(initialValue);
  }, [initialValue]);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isReadOnly) return;
    const newValue = e.target.value;
    setValue(newValue);
    table.options.meta?.updateData(row.index, column.id, newValue);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLSelectElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      navigateToCell(e.currentTarget, 'down');
    } else if (e.key === "Escape") {
      e.currentTarget.blur();
    }
    // Note: Arrow up/down are used by select to change value, so we don't override them
  };

  return (
    <div className="relative flex items-center h-full">
      <select
        value={value ?? ""}
        onChange={onChange}
        onKeyDown={onKeyDown}
        disabled={isReadOnly}
        className={`w-full h-full px-2 py-1 pr-6 border-0 outline-none bg-transparent focus:bg-blue-50 ${
          isRequired && !hasValue ? "bg-amber-50/50" : ""
        } ${isReadOnly ? "cursor-not-allowed opacity-70" : ""}`}
      >
        <option value="">Select...</option>
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {isRequired && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
          {hasValue ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <AlertCircle className="h-3 w-3 text-amber-500" />
          )}
        </div>
      )}
    </div>
  );
}

function CheckboxCell({
  getValue,
  row,
  column,
  table,
}: CellContext<Sample, unknown>) {
  const initialValue = getValue();
  const normalizeChecked = (val: unknown) => {
    if (val === true || val === false) return val;
    if (val === "true") return true;
    if (val === "false") return false;
    return Boolean(val);
  };
  const [checked, setChecked] = useState(normalizeChecked(initialValue));
  const columnMeta = column.columnDef.meta as {
    editable?: boolean;
    isReadOnlyAfterSave?: boolean;
    required?: boolean;
  } | undefined;
  const isEditable = columnMeta?.editable !== false;
  const isReadOnlyAfterSave = columnMeta?.isReadOnlyAfterSave;
  const isSavedRow = !!(row.original.id && !row.original.isNew);
  const isReadOnly = !isEditable || (isReadOnlyAfterSave && isSavedRow);
  const headerStr = column.columnDef.header?.toString() || "";
  const isRequired = columnMeta?.required ?? headerStr.endsWith("*");
  const hasValue = checked;

  useEffect(() => {
    setChecked(normalizeChecked(initialValue));
  }, [initialValue]);

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (isReadOnly) return;
    const nextValue = e.target.checked;
    setChecked(nextValue);
    table.options.meta?.updateData(row.index, column.id, nextValue);
  };

  return (
    <div className="relative flex items-center justify-center h-full">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        disabled={isReadOnly}
        className={`h-4 w-4 rounded border-input ${isReadOnly ? "cursor-not-allowed opacity-70" : ""}`}
      />
      {isRequired && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
          {hasValue ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <AlertCircle className="h-3 w-3 text-amber-500" />
          )}
        </div>
      )}
    </div>
  );
}

function MultiSelectCell({
  getValue,
  row,
  column,
  table,
}: CellContext<Sample, unknown>) {
  const initialValue = getValue();
  const normalizeValues = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.map((item) => String(item));
    if (val === undefined || val === null || val === "") return [];
    return [String(val)];
  };
  const [value, setValue] = useState<string[]>(normalizeValues(initialValue));
  const columnMeta = column.columnDef.meta as {
    options?: { value: string; label: string }[];
    editable?: boolean;
    isReadOnlyAfterSave?: boolean;
    required?: boolean;
  } | undefined;
  const options = columnMeta?.options || [];
  const isEditable = columnMeta?.editable !== false;
  const isReadOnlyAfterSave = columnMeta?.isReadOnlyAfterSave;
  const isSavedRow = !!(row.original.id && !row.original.isNew);
  const isReadOnly = !isEditable || (isReadOnlyAfterSave && isSavedRow);
  const headerStr = column.columnDef.header?.toString() || "";
  const isRequired = columnMeta?.required ?? headerStr.endsWith("*");
  const hasValue = value.length > 0;

  useEffect(() => {
    setValue(normalizeValues(initialValue));
  }, [initialValue]);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (isReadOnly) return;
    const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
    setValue(selected);
    table.options.meta?.updateData(row.index, column.id, selected);
  };

  return (
    <div className="relative flex items-center h-full">
      <select
        multiple
        value={value}
        onChange={onChange}
        disabled={isReadOnly}
        className={`w-full h-full px-2 py-1 pr-6 border-0 outline-none bg-transparent focus:bg-blue-50 ${
          isRequired && !hasValue ? "bg-amber-50/50" : ""
        } ${isReadOnly ? "cursor-not-allowed opacity-70" : ""}`}
      >
        {options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
      {isRequired && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none">
          {hasValue ? (
            <Check className="h-3 w-3 text-green-500" />
          ) : (
            <AlertCircle className="h-3 w-3 text-amber-500" />
          )}
        </div>
      )}
    </div>
  );
}

export default function SamplesPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const resolvedParams = use(params);
  const containerRef = useRef<HTMLDivElement>(null);

  const [order, setOrder] = useState<Order | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);

  // Use the shared field help context for the left sidebar
  const { setFocusedField } = useFieldHelp();
  const [selectedRows, setSelectedRows] = useState<Record<string, boolean>>({});

  // MIxS checklist state
  const [availableChecklists, setAvailableChecklists] = useState<{ name: string; accession: string; fieldCount: number }[]>([]);
  const [selectedChecklist, setSelectedChecklist] = useState<string | null>(null);
  const [checklistFields, setChecklistFields] = useState<MixsField[]>([]);
  const [showChecklistSelector, setShowChecklistSelector] = useState(false);
  const [loadingChecklist, setLoadingChecklist] = useState(false);

  // Per-sample custom fields from Order Form Builder
  const [perSampleFields, setPerSampleFields] = useState<FormFieldDefinition[]>([]);

  // Build field metadata including MIxS fields and per-sample fields from form config
  const fieldMetadata = useMemo(() => {
    const metadata: Record<string, FieldInfo> = { ...CORE_FIELD_METADATA };

    // Add per-sample fields from Order Form Builder
    for (const field of perSampleFields) {
      // Use either the mapped column name or the original field name for lookup
      const columnName = FIELD_TO_COLUMN_MAP[field.name];
      const fieldKey = columnName || field.name;

      metadata[fieldKey] = {
        field: fieldKey,
        headerName: field.label,
        description: field.helpText || "",
        required: field.required,
        type: field.type,
        group: "Per-Sample Fields",
        options: field.options,
        pattern: field.simpleValidation?.pattern,
      };

      // Also add by custom_ prefix for lookups
      if (!columnName) {
        metadata[`custom_${field.name}`] = metadata[fieldKey];
      }
    }

    // Add MIxS checklist fields
    for (const field of checklistFields) {
      metadata[field.name] = {
        field: field.name,
        headerName: field.label,
        description: field.helpText || "",
        required: field.required,
        type: field.type,
        group: field.group || "MIxS Checklist",
        options: field.options,
        units: field.units,
        pattern: field.simpleValidation?.pattern,
      };
    }

    return metadata;
  }, [checklistFields, perSampleFields]);

  const isEditable = order?.status === "DRAFT";

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (showChecklistSelector) {
        const target = e.target as HTMLElement;
        if (!target.closest('[data-checklist-dropdown]')) {
          setShowChecklistSelector(false);
        }
      }
    };
    document.addEventListener('click', handleClickOutside);
    return () => document.removeEventListener('click', handleClickOutside);
  }, [showChecklistSelector]);

  // Build columns dynamically based on form configuration
  const columns = useMemo((): ColumnDef<Sample>[] => {
    const cols: ColumnDef<Sample>[] = [
      // Sample ID - auto-generated, always read-only
      {
        accessorKey: "sampleId",
        header: "Sample ID *",
        size: 180,
        cell: ({ getValue }) => (
          <div className="px-2 py-1 h-full bg-gray-50 text-gray-600 font-mono text-xs">
            {getValue() as string}
          </div>
        ),
      },
    ];

    // Add per-sample fields from Order Form Builder
    // These are the fields the admin has configured for per-sample data
    for (const field of perSampleFields) {
      // Check if this field maps to a core Sample model column
      const columnName = FIELD_TO_COLUMN_MAP[field.name];
      const isCoreColumn = !!columnName;

      const cell =
        field.type === "organism"
          ? OrganismCell
          : field.type === "select" && field.options
            ? SelectCell
            : field.type === "multiselect"
              ? MultiSelectCell
              : field.type === "checkbox"
                ? CheckboxCell
                : EditableCell;

      // Determine column width based on field type - wider columns for better readability
      const fieldSize =
        field.type === "organism" ? 280
        : field.type === "textarea" ? 240
        : field.type === "date" ? 160
        : field.type === "select" ? 180
        : 180;

      const col: ColumnDef<Sample> = {
        id: isCoreColumn ? columnName : `custom_${field.name}`,
        accessorFn: (row) => {
          if (isCoreColumn) {
            // Read from the actual Sample column
            return row[columnName] ?? "";
          }
          // Read from customFields
          return row.customFields?.[field.name] ?? row[field.name] ?? "";
        },
        header: field.required ? `${field.label} *` : field.label,
        size: fieldSize,
        cell,
        meta: {
          editable: isEditable,
          isCustomField: !isCoreColumn,
          isCoreField: isCoreColumn,
          fieldName: isCoreColumn ? columnName : field.name,
          fieldType: field.type,
          required: field.required,
          options: field.options,
        },
      };
      cols.push(col);
    }

    // Add MIxS checklist fields
    for (const field of checklistFields) {
      const cell =
        field.type === "select" && field.options
          ? SelectCell
          : field.type === "multiselect"
            ? MultiSelectCell
            : field.type === "checkbox"
              ? CheckboxCell
              : EditableCell;

      // Determine column width based on field type
      const checklistFieldSize =
        field.type === "textarea" ? 240
        : field.type === "select" ? 180
        : 180;

      const col: ColumnDef<Sample> = {
        id: field.name,
        accessorFn: (row) => row.checklistData?.[field.name] ?? row[field.name] ?? "",
        header: field.required ? `${field.label} *` : field.label,
        size: checklistFieldSize,
        cell,
        meta: {
          editable: isEditable,
          isChecklistField: true,
          fieldName: field.name,
          fieldType: field.type,
          required: field.required,
          options: field.options,
        },
      };
      cols.push(col);
    }

    // Delete column
    if (isEditable) {
      cols.push({
        id: "delete",
        header: "",
        size: 50,
        cell: ({ row }) => (
          <button
            onClick={() => handleDeleteRow(row.original)}
            className="w-full h-full flex items-center justify-center text-gray-400 hover:text-red-500 transition-colors"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        ),
      });
    }

    return cols;
  }, [checklistFields, perSampleFields, isEditable]);

  // Table instance
  // Memoize filtered data to prevent unnecessary re-renders
  const tableData = useMemo(() => samples.filter((s) => !s.isDeleted), [samples]);

  // Memoize updateData function
  // Supports both single field update: updateData(rowIndex, columnId, value)
  // And multi-field update: updateData(rowIndex, { field1: value1, field2: value2 })
  const updateData = useCallback((rowIndex: number, columnIdOrUpdates: string | Record<string, unknown>, value?: unknown) => {
    setSamples((old) => {
      const newData = [...old];
      const activeRows = newData.filter((s) => !s.isDeleted);
      const realIndex = newData.indexOf(activeRows[rowIndex]);

      if (realIndex === -1) return old;

      const row = { ...newData[realIndex] };

      // Handle multi-field update (for organism field which updates both taxId and scientificName)
      if (typeof columnIdOrUpdates === "object") {
        for (const [fieldName, fieldValue] of Object.entries(columnIdOrUpdates)) {
          (row as Record<string, unknown>)[fieldName] = fieldValue;
        }
      } else {
        // Single field update
        const columnId = columnIdOrUpdates;

        // Check if this is a checklist, custom, or core field
        const colMeta = columns.find((c) =>
          (c as { accessorKey?: string }).accessorKey === columnId ||
          (c as { id?: string }).id === columnId
        )?.meta as { isChecklistField?: boolean; isCustomField?: boolean; isCoreField?: boolean; fieldName?: string } | undefined;

        if (colMeta?.isChecklistField && colMeta.fieldName) {
          // MIxS checklist field
          if (!row.checklistData) row.checklistData = {};
          row.checklistData[colMeta.fieldName] = value as string;
          row[colMeta.fieldName] = value;
        } else if (colMeta?.isCustomField && colMeta.fieldName) {
          // Per-sample custom field from Order Form Builder (stored in customFields)
          if (!row.customFields) row.customFields = {};
          row.customFields[colMeta.fieldName] = value as string;
          row[colMeta.fieldName] = value;
        } else if (colMeta?.isCoreField && colMeta.fieldName) {
          // Core sample field (stored in actual column)
          (row as Record<string, unknown>)[colMeta.fieldName] = value;
        } else {
          (row as Record<string, unknown>)[columnId] = value;
        }
      }

      if (!row.isNew) {
        row.isModified = true;
      }

      newData[realIndex] = row;
      return newData;
    });
    setHasChanges(true);
    setSuccess("");
  }, [columns]);

  const table = useReactTable({
    data: tableData,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData,
    },
  });

  // Fetch available checklists
  useEffect(() => {
    const fetchChecklists = async () => {
      try {
        const res = await fetch("/api/mixs-checklists");
        if (res.ok) {
          const data = await res.json();
          setAvailableChecklists(data.checklists || []);
        }
      } catch (error) {
        console.error("Failed to load checklists:", error);
      }
    };
    fetchChecklists();
  }, []);

  // Fetch per-sample fields from Order Form Builder
  useEffect(() => {
    const fetchPerSampleFields = async () => {
      try {
        const res = await fetch("/api/form-schema");
        if (res.ok) {
          const data = await res.json();
          const fields = (data.fields || []).filter(
            (f: FormFieldDefinition) => f.perSample && f.visible
          );
          setPerSampleFields(fields);
        }
      } catch (error) {
        console.error("Failed to load per-sample fields:", error);
      }
    };
    fetchPerSampleFields();
  }, []);

  // Fetch order and samples
  useEffect(() => {
    const fetchData = async () => {
      try {
        const orderRes = await fetch(`/api/orders/${resolvedParams.id}`);
        if (!orderRes.ok) {
          if (orderRes.status === 404) {
            setError("Order not found");
          } else {
            throw new Error("Failed to fetch order");
          }
          return;
        }
        const orderData = await orderRes.json();
        setOrder(orderData);

        const samplesRes = await fetch(`/api/orders/${resolvedParams.id}/samples`);
        if (samplesRes.ok) {
          const data = await samplesRes.json();
          const samplesData = data.samples || [];
          // Use saved checklist from API response
          if (data.checklist) {
            setSelectedChecklist(data.checklist);
          }
          // Flatten checklistData and customFields into sample for display
          const flattenedSamples = samplesData.map((s: Sample) => {
            let flattened = { ...s };
            if (s.checklistData) {
              flattened = { ...flattened, ...s.checklistData };
            }
            if (s.customFields) {
              flattened = { ...flattened, ...(s.customFields as Record<string, unknown>) };
            }
            return flattened;
          });
          setSamples(flattenedSamples);
        }
      } catch {
        setError("Failed to load data");
      } finally {
        setLoading(false);
      }
    };

    fetchData();
  }, [resolvedParams.id]);

  // Load checklist fields when selected
  useEffect(() => {
    if (!selectedChecklist) {
      setChecklistFields([]);
      return;
    }

    const loadChecklistFields = async () => {
      setLoadingChecklist(true);
      try {
        const res = await fetch(`/api/mixs-checklists?accession=${selectedChecklist}`);
        if (res.ok) {
          const checklist: MixsChecklist = await res.json();
          setChecklistFields(checklist.fields);
        }
      } catch (error) {
        console.error("Failed to load checklist fields:", error);
      } finally {
        setLoadingChecklist(false);
      }
    };

    loadChecklistFields();
  }, [selectedChecklist]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        e.preventDefault();
        if (hasChanges && !saving && order?.status === "DRAFT") {
          handleSave();
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "n") {
        e.preventDefault();
        if (order?.status === "DRAFT") {
          handleAddRow();
        }
      }
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
      if (e.key === "F11") {
        e.preventDefault();
        setIsFullscreen(!isFullscreen);
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [hasChanges, saving, order?.status, isFullscreen]);

  // Warn before leaving with unsaved changes
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (hasChanges) {
        e.preventDefault();
        e.returnValue = "";
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [hasChanges]);

  const handleAddRow = useCallback(() => {
    const newSample: Sample = {
      sampleId: generateSampleId(),
      sampleAlias: "",
      sampleTitle: "",
      sampleDescription: "",
      scientificName: "",
      taxId: "",
      checklistData: {},
      isNew: true,
    };
    setSamples((prev) => [...prev, newSample]);
    setHasChanges(true);
    setSuccess("");
  }, []);

  const handleAddMultipleRows = useCallback(() => {
    const count = prompt("How many rows to add?", "5");
    if (!count) return;

    const num = parseInt(count, 10);
    if (isNaN(num) || num < 1 || num > 100) {
      setError("Please enter a number between 1 and 100");
      return;
    }

    const newSamples: Sample[] = Array.from({ length: num }, () => ({
      sampleId: generateSampleId(),
      sampleAlias: "",
      sampleTitle: "",
      sampleDescription: "",
      scientificName: "",
      taxId: "",
      checklistData: {},
      isNew: true,
    }));

    setSamples((prev) => [...prev, ...newSamples]);
    setHasChanges(true);
    setSuccess("");
  }, []);

  const handleDeleteRow = useCallback((sample: Sample) => {
    if (sample.isNew) {
      setSamples((prev) => prev.filter((s) => s !== sample));
    } else {
      setSamples((prev) =>
        prev.map((s) => (s.id === sample.id ? { ...s, isDeleted: true } : s))
      );
    }
    setHasChanges(true);
    setSuccess("");
  }, []);

  // Auto-generate sample aliases based on index
  const handleAutoGenerateAliases = useCallback(() => {
    const activeSamples = samples.filter((s) => !s.isDeleted);
    if (activeSamples.length === 0) return;

    setSamples((prev) => {
      let index = 0;
      return prev.map((s) => {
        if (s.isDeleted) return s;
        index++;
        return {
          ...s,
          sampleAlias: `Sample_${index}`,
          isModified: !s.isNew ? true : s.isModified,
        };
      });
    });
    setHasChanges(true);
    setSuccess(`Generated aliases for ${activeSamples.length} sample${activeSamples.length !== 1 ? "s" : ""}`);
  }, [samples]);

  // Copy organism (taxId + scientificName) from first row to all rows
  const handleCopyOrganismToAll = useCallback(() => {
    const activeSamples = samples.filter((s) => !s.isDeleted);
    if (activeSamples.length < 2) return;

    const firstSample = activeSamples[0];
    const taxId = firstSample.taxId || "";
    const scientificName = firstSample.scientificName || "";

    if (!taxId && !scientificName) {
      setError("First sample has no organism set");
      return;
    }

    setSamples((prev) => {
      let isFirst = true;
      return prev.map((s) => {
        if (s.isDeleted) return s;
        if (isFirst) {
          isFirst = false;
          return s;
        }
        return {
          ...s,
          taxId,
          scientificName,
          isModified: !s.isNew ? true : s.isModified,
        };
      });
    });
    setHasChanges(true);
    setSuccess(`Copied organism to ${activeSamples.length - 1} sample${activeSamples.length - 1 !== 1 ? "s" : ""}`);
  }, [samples]);

  const handleDuplicateSelected = useCallback(() => {
    const selectedRowKeys = Object.keys(selectedRows).filter((k) => selectedRows[k]);
    if (selectedRowKeys.length !== 1) {
      setError("Please select exactly one row to duplicate");
      return;
    }

    const sourceIndex = parseInt(selectedRowKeys[0]);
    const activeRows = samples.filter((s) => !s.isDeleted);
    const source = activeRows[sourceIndex];
    if (!source) return;

    const duplicate: Sample = {
      ...source,
      id: undefined,
      sampleId: generateSampleId(),
      isNew: true,
      isModified: false,
      isDeleted: false,
    };

    setSamples((prev) => [...prev, duplicate]);
    setHasChanges(true);
    setSuccess("");
    setSelectedRows({});
  }, [selectedRows, samples]);

  const handleExportCSV = useCallback(() => {
    const headers = ["sampleId", "sampleAlias", "sampleTitle", "sampleDescription", "scientificName", "taxId"];
    // Add MIxS checklist fields
    for (const field of checklistFields) {
      headers.push(field.name);
    }
    // Add per-sample custom fields
    for (const field of perSampleFields) {
      headers.push(field.name);
    }

    const rows = samples.filter((s) => !s.isDeleted).map((s) => {
      return headers.map((h) => {
        const val =
          s[h] ??
          s.checklistData?.[h] ??
          s.customFields?.[h] ??
          "";
        // Escape quotes and wrap in quotes if contains comma
        const str = String(val);
        if (str.includes(",") || str.includes('"')) {
          return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
      }).join(",");
    });

    const csv = [headers.join(","), ...rows].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `samples_${order?.name || "export"}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }, [samples, checklistFields, perSampleFields, order?.name]);

  // Flatten samples for Excel template (ExcelToolbar expects flat SampleRow)
  const flatSamplesForExcel = useMemo(() => {
    return samples
      .filter((s) => !s.isDeleted)
      .map((s) => {
        const flat: Record<string, unknown> = {
          id: s.id || `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
          sampleId: s.sampleId,
          scientificName: s.scientificName,
          taxId: s.taxId,
          tax_id: s.taxId,
        };
        // Flatten core fields
        flat.sampleAlias = s.sampleAlias;
        flat.sampleTitle = s.sampleTitle;
        flat.sampleDescription = s.sampleDescription;
        // Flatten customFields
        if (s.customFields) {
          for (const [k, v] of Object.entries(s.customFields)) {
            flat[k] = v;
          }
        }
        // Flatten checklistData
        if (s.checklistData) {
          for (const [k, v] of Object.entries(s.checklistData)) {
            flat[k] = v;
          }
        }
        return flat as { id: string; sampleId: string; [key: string]: unknown };
      });
  }, [samples]);

  // Handle samples imported from Excel
  const handleSamplesImported = useCallback(
    (
      importedRows: { id: string; sampleId: string; [key: string]: unknown }[],
      mode: "replace" | "append"
    ) => {
      const newSamples: Sample[] = importedRows.map((row) => {
        const sample: Sample = {
          sampleId: row.sampleId || generateSampleId(),
          sampleAlias: String(row.sampleAlias || row.sample_alias || ""),
          sampleTitle: String(row.sampleTitle || row.sample_title || ""),
          sampleDescription: String(row.sampleDescription || row.sample_description || ""),
          scientificName: String(row.scientificName || ""),
          taxId: String(row.taxId || row.tax_id || ""),
          checklistData: {},
          customFields: {},
          isNew: true,
        };

        // Map per-sample fields to core columns or customFields
        for (const field of perSampleFields) {
          const columnName = FIELD_TO_COLUMN_MAP[field.name];
          if (columnName) {
            // Core column - already handled above for known core fields
            if (!(columnName in sample) || !sample[columnName]) {
              (sample as Record<string, unknown>)[columnName] = row[field.name] ?? "";
            }
          } else {
            // Custom field
            sample.customFields![field.name] = row[field.name] ?? "";
          }
        }

        return sample;
      });

      if (mode === "replace") {
        // Mark existing samples as deleted, add new ones
        setSamples((prev) => [
          ...prev.map((s) => ({ ...s, isDeleted: true })),
          ...newSamples,
        ]);
      } else {
        setSamples((prev) => [...prev, ...newSamples]);
      }
      setHasChanges(true);
      toast.success(
        `Imported ${importedRows.length} sample${importedRows.length !== 1 ? "s" : ""}`
      );
    },
    [perSampleFields]
  );

  const handleSave = async () => {
    setError("");
    setSuccess("");
    setSaving(true);

    try {
      const activeSamples = samples.filter((s) => !s.isDeleted);
      const invalidSamples = activeSamples.filter((s) => !s.sampleId.trim());
      if (invalidSamples.length > 0) {
        setError("All samples must have a Sample ID");
        setSaving(false);
        return;
      }

      const sampleIds = activeSamples.map((s) => s.sampleId.trim());
      const duplicates = sampleIds.filter((id, index) => sampleIds.indexOf(id) !== index);
      if (duplicates.length > 0) {
        setError(`Duplicate Sample IDs: ${[...new Set(duplicates)].join(", ")}`);
        setSaving(false);
        return;
      }

      // Prepare samples for saving
      const samplesToSave = samples.map((s) => {
        // Collect MIxS checklist data
        const checklistData: Record<string, string> = {};
        for (const field of checklistFields) {
          const val = s[field.name] ?? s.checklistData?.[field.name];
          if (val !== undefined && val !== null && val !== "") {
            checklistData[field.name] = String(val);
          }
        }
        // Collect per-sample custom fields
        const customFields: Record<string, unknown> = {};
        for (const field of perSampleFields) {
          const val = s[field.name] ?? s.customFields?.[field.name];
          const isEmptyValue =
            val === undefined ||
            val === null ||
            val === "" ||
            (Array.isArray(val) && val.length === 0);
          if (!isEmptyValue) {
            customFields[field.name] = val;
          }
        }
        return {
          ...s,
          checklistData: Object.keys(checklistData).length > 0 ? checklistData : undefined,
          customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
        };
      });

      const res = await fetch(`/api/orders/${resolvedParams.id}/samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          samples: samplesToSave,
          checklist: selectedChecklist,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to save samples");
        return;
      }

      const data = await res.json();
      const savedSamples = data.samples || [];
      const flattenedSamples = savedSamples.map((s: Sample) => {
        let flattened = { ...s };
        if (s.checklistData) {
          flattened = { ...flattened, ...s.checklistData };
        }
        if (s.customFields) {
          flattened = { ...flattened, ...(s.customFields as Record<string, unknown>) };
        }
        return flattened;
      });
      setSamples(flattenedSamples);
      setHasChanges(false);
      setSuccess("Samples saved successfully");
    } catch {
      setError("Failed to save samples");
    } finally {
      setSaving(false);
    }
  };

  const handleChecklistChange = async (accession: string) => {
    setSelectedChecklist(accession || null);
    setShowChecklistSelector(false);

    // Auto-save checklist selection to database
    try {
      await fetch(`/api/orders/${resolvedParams.id}/samples`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          samples: samples, // Keep existing samples
          checklist: accession || null,
        }),
      });
    } catch (error) {
      console.error("Failed to save checklist selection:", error);
    }
  };

  const handleCellClick = (fieldId: string) => {
    const field = fieldMetadata[fieldId];
    if (field) {
      // Convert FieldInfo to FormFieldDefinition for the shared left sidebar
      const formField: FormFieldDefinition = {
        id: field.field,
        type: (field.type as FormFieldDefinition["type"]) || "text",
        label: field.headerName,
        name: field.field,
        required: field.required || false,
        visible: true,
        helpText: field.description,
        options: field.options?.map(opt =>
          typeof opt === 'string'
            ? { value: opt, label: opt }
            : opt
        ),
        order: 0,
        perSample: true,
      };
      setFocusedField(formField);
    }
  };

  const activeSampleCount = samples.filter((s) => !s.isDeleted).length;
  const selectedChecklistName = availableChecklists.find(c => c.accession === selectedChecklist)?.name || "Select checklist...";

  if (loading) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (error && !order) {
    return (
      <div className="p-8">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href="/dashboard/orders">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Orders
          </Link>
        </Button>
        <GlassCard className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Error</h2>
          <p className="text-muted-foreground">{error}</p>
        </GlassCard>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className={`flex flex-col ${
        isFullscreen
          ? "fixed inset-0 z-50 bg-background"
          : "min-h-[calc(100vh-2rem)]"
      }`}
      style={!isFullscreen ? { maxHeight: 'calc(100vh - 2rem)' } : undefined}
    >
      {/* Header */}
      <div className={`border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${isFullscreen ? "px-4" : "px-8"} py-4`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-4">
            {!isFullscreen && (
              <Button variant="ghost" size="sm" asChild>
                <Link href={`/dashboard/orders/${resolvedParams.id}`}>
                  <ArrowLeft className="h-4 w-4 mr-2" />
                  Back
                </Link>
              </Button>
            )}
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center">
                <FileSpreadsheet className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold">Sample Entry</h1>
                <p className="text-sm text-muted-foreground">
                  {order?.name} - {activeSampleCount} sample{activeSampleCount !== 1 ? "s" : ""}
                </p>
              </div>
            </div>
          </div>

          {/* Action buttons - hide add buttons when showing setup panel */}
          <div className="flex items-center gap-2">
            {isEditable && (perSampleFields.length > 0 || selectedChecklist || activeSampleCount > 0) && (
              <>
                <Button variant="outline" size="sm" onClick={handleAddRow}>
                  <Plus className="h-4 w-4 mr-1" />
                  Add Row
                </Button>
                <Button variant="outline" size="sm" onClick={handleAddMultipleRows}>
                  <PlusCircle className="h-4 w-4 mr-1" />
                  Add Multiple
                </Button>
                <div className="w-px h-6 bg-border mx-1" />
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleDuplicateSelected}
                >
                  <Copy className="h-4 w-4 mr-1" />
                  Duplicate
                </Button>
                {/* Quick Actions Dropdown */}
                {activeSampleCount > 0 && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="outline" size="sm">
                        <ChevronDown className="h-4 w-4 mr-1" />
                        Quick Actions
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={handleAutoGenerateAliases}>
                        Auto-generate sample aliases
                      </DropdownMenuItem>
                      {activeSampleCount > 1 && (
                        <DropdownMenuItem onClick={handleCopyOrganismToAll}>
                          Copy organism to all samples
                        </DropdownMenuItem>
                      )}
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </>
            )}
            <div className="w-px h-6 bg-border mx-1" />
            <ExcelToolbar
              perSampleFields={perSampleFields}
              samples={flatSamplesForExcel}
              onSamplesImported={handleSamplesImported}
              disabled={saving || !isEditable}
              entityName={order?.name}
            />
            <Button variant="outline" size="sm" onClick={handleExportCSV}>
              <Download className="h-4 w-4 mr-1" />
              Export CSV
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setIsFullscreen(!isFullscreen)}
            >
              {isFullscreen ? <Minimize2 className="h-4 w-4" /> : <Maximize2 className="h-4 w-4" />}
            </Button>
          </div>
        </div>
      </div>

      {/* Alerts */}
      {(error || success || !isEditable) && (
        <div className={`${isFullscreen ? "px-4" : "px-8"} pt-4 space-y-2`}>
          {error && (
            <div className="p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2 text-sm">
              <AlertCircle className="h-4 w-4 flex-shrink-0" />
              {error}
              <button onClick={() => setError("")} className="ml-auto">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {success && (
            <div className="p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 flex items-center gap-2 text-sm">
              <Check className="h-4 w-4 flex-shrink-0" />
              {success}
              <button onClick={() => setSuccess("")} className="ml-auto">
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {!isEditable && (
            <div className="p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20 text-yellow-700 text-sm">
              This order has been submitted and samples cannot be edited.
            </div>
          )}
        </div>
      )}

      {/* Main content - show when per-sample fields exist or samples exist */}
      {(perSampleFields.length > 0 || selectedChecklist || activeSampleCount > 0 || !isEditable) && (
      <div className={`flex-1 flex ${isFullscreen ? "px-4" : "px-8"} py-4 gap-4 min-h-0`}>
        {/* Table */}
        <div className="flex-1 flex flex-col min-h-0">
          <GlassCard className="flex-1 p-0 overflow-hidden flex flex-col">
            <div className="flex-1 overflow-auto">
              <table className="w-full border-collapse text-sm">
                <thead className="sticky top-0 z-10">
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => {
                        // Determine header class based on column metadata
                        const meta = header.column.columnDef.meta as { isChecklistField?: boolean; isCustomField?: boolean; isCoreField?: boolean } | undefined;
                        const isChecklistField = meta?.isChecklistField;
                        const isPerSampleField = meta?.isCustomField || meta?.isCoreField;
                        const isSampleIdField = header.column.id === "sampleId";
                        const isMandatory = header.column.columnDef.header?.toString().includes("*");

                        let headerClass = "bg-gray-100 border-gray-300";
                        if (isSampleIdField) {
                          // Sample ID is always shown with distinct style
                          headerClass = "bg-slate-100 border-slate-300 text-slate-700";
                        } else if (isPerSampleField) {
                          // Per-sample fields from form config (green)
                          headerClass = isMandatory
                            ? "bg-green-100 border-green-400 text-green-800 font-semibold"
                            : "bg-green-50 border-green-300 text-green-700";
                        } else if (isChecklistField) {
                          // MIxS checklist fields (blue)
                          headerClass = isMandatory
                            ? "bg-blue-100 border-blue-400 text-blue-800 font-semibold"
                            : "bg-blue-50 border-blue-300 text-blue-700";
                        }

                        return (
                          <th
                            key={header.id}
                            className={`px-2 py-2 text-left font-medium border-b-2 border-r whitespace-nowrap ${headerClass}`}
                            style={{ width: header.getSize() }}
                            onClick={() => handleCellClick(header.column.id)}
                          >
                            {header.isPlaceholder
                              ? null
                              : flexRender(
                                  header.column.columnDef.header,
                                  header.getContext()
                                )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={columns.length}
                        className="text-center py-12 text-muted-foreground"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <FileSpreadsheet className="h-12 w-12 opacity-20" />
                          <p>No samples added yet</p>
                          {isEditable && (
                            <Button onClick={handleAddRow} size="sm" className="mt-2">
                              <Plus className="h-4 w-4 mr-1" />
                              Add Sample
                            </Button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ) : (
                    table.getRowModel().rows.map((row) => {
                      // Row background based on status
                      let rowClass = "hover:bg-gray-50";
                      if (row.original.isNew) {
                        rowClass = "bg-green-50/50 hover:bg-green-50";
                      } else if (row.original.isModified) {
                        rowClass = "bg-yellow-50/50 hover:bg-yellow-50";
                      }

                      return (
                        <tr key={row.id} className={`border-b ${rowClass}`}>
                          {row.getVisibleCells().map((cell) => {
                            const meta = cell.column.columnDef.meta as { isChecklistField?: boolean; isCustomField?: boolean; isCoreField?: boolean } | undefined;
                            const isChecklistField = meta?.isChecklistField;
                            const isPerSampleField = meta?.isCustomField || meta?.isCoreField;
                            const isSampleIdField = cell.column.id === "sampleId";

                            let cellClass = "border-r";
                            if (isSampleIdField) {
                              cellClass += " border-slate-200";
                            } else if (isPerSampleField) {
                              cellClass += " border-green-200";
                            } else if (isChecklistField) {
                              cellClass += " border-blue-200";
                            } else {
                              cellClass += " border-gray-200";
                            }

                            return (
                              <td
                                key={cell.id}
                                className={cellClass}
                                style={{ width: cell.column.getSize() }}
                                onClick={() => handleCellClick(cell.column.id)}
                              >
                                {flexRender(
                                  cell.column.columnDef.cell,
                                  cell.getContext()
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
          </GlassCard>
        </div>
      </div>
      )}

      {/* Footer */}
      <div className={`border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60 ${isFullscreen ? "px-4" : "px-8"} py-3`}>
        <div className="flex items-center justify-between">
          <div className="text-sm text-muted-foreground">
            {!selectedChecklist && activeSampleCount === 0 && perSampleFields.length === 0 && isEditable
              ? "Select an environment type above to get started"
              : `${columns.length - (isEditable ? 2 : 1)} fields | Tab to move between cells. Enter to confirm.`
            }
          </div>

          {isEditable && (perSampleFields.length > 0 || selectedChecklist || activeSampleCount > 0) && (
            <div className="flex items-center gap-2">
              <Button variant="outline" asChild>
                <Link href={`/dashboard/orders/${resolvedParams.id}`}>Cancel</Link>
              </Button>
              <Button onClick={handleSave} disabled={saving || !hasChanges}>
                {saving ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Saving...
                  </>
                ) : (
                  <>
                    <Save className="h-4 w-4 mr-2" />
                    Save Changes
                    {hasChanges && <span className="ml-1 w-2 h-2 rounded-full bg-yellow-400" />}
                  </>
                )}
              </Button>
            </div>
          )}

          {isEditable && !selectedChecklist && activeSampleCount === 0 && perSampleFields.length === 0 && (
            <Button variant="outline" asChild>
              <Link href={`/dashboard/orders/${resolvedParams.id}`}>
                <ArrowLeft className="h-4 w-4 mr-2" />
                Back to Order
              </Link>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
