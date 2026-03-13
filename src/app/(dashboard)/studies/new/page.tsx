"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  CellContext,
  RowData,
} from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  X,
  Loader2,
  Check,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  FileText,
  Leaf,
  CheckCircle2,
  User,
  Bug,
  Mountain,
  Droplets,
  Wind,
  Waves,
  Microscope,
  FlaskConical,
  Table as TableIcon,
  Search,
  AlertTriangle,
  Shield,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";
import { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import { FundingFormRenderer } from "@/lib/field-types/funding/FundingFormRenderer";
import type { FundingFieldValue } from "@/lib/field-types/funding";
import { ExcelToolbar } from "@/components/samples/ExcelToolbar";
import { InlineFieldError } from "@/components/ui/inline-field-error";
import { toast } from "sonner";

// Note: TanStack Table meta types are extended globally in orders/new/page.tsx
// PerSampleField extends FormFieldDefinition properties for compatibility

// Per-sample field definition - extends FormFieldDefinition properties for compatibility
interface PerSampleField extends Omit<FormFieldDefinition, 'options'> {
  source: 'custom' | 'mixs';
  options?: Array<{ value: string; label: string }>;
}

// Sample row interface for the table
interface SampleMetadataRow {
  id: string;
  sampleId: string;
  [key: string]: unknown;
}

// Helper to navigate to adjacent cell
function navigateToCell(currentInput: HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement, direction: 'up' | 'down' | 'left' | 'right') {
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
      if (input instanceof HTMLInputElement) {
        input.select();
      }
    }
  }
}

function focusFirstCellEditor(cell: HTMLElement) {
  const editor = cell.querySelector<HTMLElement>(
    "input:not([disabled]), textarea:not([disabled]), select:not([disabled]), button:not([disabled])"
  );
  if (editor) {
    editor.focus();
  }
}

function preserveTableScroll(
  meta:
    | {
        getScrollPosition?: () => number;
        restoreScrollPosition?: (scrollLeft: number) => void;
      }
    | undefined,
  callback: () => void
) {
  const scrollLeft = meta?.getScrollPosition?.() ?? 0;
  callback();
  requestAnimationFrame(() => {
    meta?.restoreScrollPosition?.(scrollLeft);
  });
}

// Local meta type aliases for type assertions
type StudyColumnMeta = {
  field?: PerSampleField;
  editable?: boolean;
  isMixsField?: boolean;
};

// Helper to validate a value against field validation rules
function isMissingRequiredValue(field: FormFieldDefinition | undefined, value: unknown): boolean {
  if (!field) return false;
  if (field.type === "checkbox") {
    return value !== true;
  }
  if (field.type === "multiselect") {
    if (Array.isArray(value)) return value.length === 0;
    if (typeof value === "string") return value.trim() === "";
    return true;
  }
  if (field.type === "funding") {
    const fundingValue = value as FundingFieldValue | null;
    return !fundingValue?.entries || fundingValue.entries.length === 0;
  }
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function validateFieldValue(field: FormFieldDefinition | undefined, value: unknown): string | null {
  if (!field) return null;

  if (field.type === "checkbox") {
    if (field.required && value !== true) return "Required";
    return null;
  }

  if (field.required && isMissingRequiredValue(field, value)) {
    return "Required";
  }

  const v = field.simpleValidation;
  if (!v) return null;

  if (Array.isArray(value)) return null;

  const strValue = String(value ?? "");
  if (!strValue && value !== 0) return null;

  // Check min/max length
  if (v.minLength && strValue.length < v.minLength) {
    return `Min ${v.minLength} characters`;
  }
  if (v.maxLength && strValue.length > v.maxLength) {
    return `Max ${v.maxLength} characters`;
  }

  // Check min/max value for numbers
  if (field.type === 'number') {
    const num = parseFloat(strValue);
    if (!isNaN(num)) {
      if (v.minValue !== undefined && num < v.minValue) {
        return `Min value: ${v.minValue}`;
      }
      if (v.maxValue !== undefined && num > v.maxValue) {
        return `Max value: ${v.maxValue}`;
      }
    }
  }

  // Check pattern
  if (v.pattern) {
    try {
      const regex = new RegExp(v.pattern);
      if (!regex.test(strValue)) {
        return v.patternMessage || "Invalid format";
      }
    } catch {
      // Invalid regex, skip validation
    }
  }

  return null;
}

function getStoredChecklistKey(field: PerSampleField): string {
  if (field.source === "mixs" && field.name.startsWith("_mixs_")) {
    return field.name.replace(/^_mixs_/, "");
  }
  return field.name;
}

function getPerSampleFieldValue(row: SampleMetadataRow, field: PerSampleField): unknown {
  const direct = row[field.name];
  if (direct !== undefined) return direct;

  if (field.source === "mixs" && field.name.startsWith("_mixs_")) {
    return row[field.name.replace(/^_mixs_/, "")];
  }

  return undefined;
}

function normalizeLegacySubmgFieldName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

const LEGACY_SUBMG_PER_SAMPLE_FIELDS = new Set([
  "collection date",
  "geographic location",
]);

function isLegacySubmgPerSampleFieldName(value: string): boolean {
  return LEGACY_SUBMG_PER_SAMPLE_FIELDS.has(normalizeLegacySubmgFieldName(value));
}

// Detect if a field is a date field (by name or pattern)
function isDateField(field: FormFieldDefinition | undefined): boolean {
  if (!field) return false;
  if (field.type === "date") return true;
  // Check by name
  const nameLower = field.name.toLowerCase();
  if (nameLower.includes('date') || nameLower.includes('_date')) return true;
  // Check by pattern (ISO 8601 date patterns typically start with year validation)
  const pattern = field.simpleValidation?.pattern;
  if (pattern && (pattern.includes('[12][0-9]{3}') || pattern.includes('ISO8601'))) return true;
  return false;
}

// Editable cell component for text/number/date/select fields
const EditableCell = React.memo(function EditableCell({
  getValue,
  row,
  column,
  table,
}: CellContext<SampleMetadataRow, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue ?? "");
  const [localValidationError, setLocalValidationError] = useState<string | null>(null);
  const [hasBlurred, setHasBlurred] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const selectRef = useRef<HTMLSelectElement>(null);
  const meta = column.columnDef.meta as StudyColumnMeta | undefined;
  const field = meta?.field;
  const isEditable = meta?.editable !== false;
  const { setFocusedField, setValidationError: setContextValidationError } = useFieldHelp();

  const fieldIsDate = isDateField(field as FormFieldDefinition);

  useEffect(() => {
    setValue(initialValue ?? "");
    const hasInitialValue = initialValue !== undefined && initialValue !== null && initialValue !== "";
    if (hasInitialValue) {
      setLocalValidationError(validateFieldValue(field as FormFieldDefinition, initialValue));
      setHasBlurred(true);
    }
  }, [initialValue, field]);

  const onBlur = () => {
    setHasBlurred(true);
    // Validate on blur
    const error = validateFieldValue(field as FormFieldDefinition, value);
    setLocalValidationError(error);
    // Clear context validation error when leaving the cell
    setContextValidationError(null);

    if (isEditable && value !== initialValue) {
      table.options.meta?.updateData(row.index, column.id, value);
    }
  };

  // Show field help when cell is focused (with scroll preservation)
  const onFocus = useCallback(() => {
    if (!field) return;

    preserveTableScroll(table.options.meta, () => {
      setFocusedField(field);
      // Only show error on focus if already blurred once
      if (hasBlurred) {
        const error = validateFieldValue(field as FormFieldDefinition, value);
        setContextValidationError(error);
      }
    });
  }, [field, setFocusedField, setContextValidationError, value, table.options.meta, hasBlurred]);

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'down');
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'up');
    } else if (e.key === "Tab") {
      onBlur();
    } else if (e.key === "Escape") {
      setValue(initialValue ?? "");
      e.currentTarget.blur();
    }
  };

  const onInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (e.key === "ArrowLeft" && e.currentTarget.selectionStart === 0) {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'left');
    } else if (e.key === "ArrowRight" && e.currentTarget.selectionStart === e.currentTarget.value.length) {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'right');
    } else {
      onKeyDown(e);
    }
  };

  // Only show error styling if we've blurred at least once
  const showError = localValidationError && hasBlurred;

  const cellClassName = cn(
    "w-full h-8 px-2 py-1 border-0 outline-none text-sm",
    "focus:ring-2 focus:ring-inset",
    "cursor-text",
    showError
      ? "bg-red-50 focus:bg-red-50 focus:ring-red-300"
      : "bg-white focus:bg-blue-50 focus:ring-blue-300"
  );

  // Render select for select fields
  if (field?.type === "select" && field.options) {
    return (
      <select
        ref={selectRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setLocalValidationError(null); // Clear error on selection
          setContextValidationError(null);
          if (isEditable) {
            table.options.meta?.updateData(row.index, column.id, e.target.value);
          }
        }}
        onFocus={onFocus}
        onKeyDown={onKeyDown}
        disabled={!isEditable}
        className={cn(cellClassName, "cursor-pointer")}
        style={{ minWidth: "100px" }}
      >
        <option value="">Select...</option>
        {field.options.map((opt) => (
          <option key={opt.value} value={opt.value}>
            {opt.label}
          </option>
        ))}
      </select>
    );
  }

  if (field?.type === "textarea") {
    return (
      <div className="relative">
        <textarea
          value={value}
          onChange={(e) => {
            if (!isEditable) return;
            setValue(e.target.value);
            if (hasBlurred) {
              const error = validateFieldValue(field as FormFieldDefinition, e.target.value);
              setLocalValidationError(error);
              setContextValidationError(error);
            }
          }}
          onBlur={onBlur}
          onFocus={onFocus}
          onKeyDown={onInputKeyDown}
          placeholder={field?.placeholder}
          disabled={!isEditable}
          className={cn(cellClassName, "resize-none leading-tight")}
          rows={1}
          style={{ minWidth: "140px" }}
        />
        {showError && (
          <div className="absolute right-1 top-1/2 -translate-y-1/2 text-red-500" title={localValidationError}>
            <AlertCircle className="h-3.5 w-3.5" />
          </div>
        )}
      </div>
    );
  }

  // For date fields, render a date picker alongside text input
  if (fieldIsDate) {
    return (
      <div className="relative flex items-center">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            // Don't validate during typing for date fields - only on blur
          }}
          onBlur={onBlur}
          onFocus={onFocus}
          onKeyDown={onInputKeyDown}
          placeholder="YYYY-MM-DD"
          disabled={!isEditable}
          className={cn(cellClassName, "pr-8")}
          style={{ minWidth: "120px" }}
          title={showError ? localValidationError : "Enter date as YYYY-MM-DD or YYYY-MM or YYYY"}
        />
        <input
          type="date"
          value={value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : ""}
          onChange={(e) => {
            const dateVal = e.target.value;
            setValue(dateVal);
            setHasBlurred(true);
            const error = dateVal ? validateFieldValue(field as FormFieldDefinition, dateVal) : null;
            setLocalValidationError(error);
            if (isEditable) {
              table.options.meta?.updateData(row.index, column.id, dateVal);
            }
          }}
          disabled={!isEditable}
          className="absolute right-0 w-6 h-full opacity-0 cursor-pointer"
          title="Open date picker"
        />
        <div className="absolute right-1 top-1/2 -translate-y-1/2 pointer-events-none text-muted-foreground">
          {showError ? (
            <AlertCircle className="h-3.5 w-3.5 text-red-500" />
          ) : (
            <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
          )}
        </div>
      </div>
    );
  }

  const inputType = field?.type === "number" ? "number" : field?.type === "date" ? "date" : "text";

  return (
    <div className="relative">
      <input
        ref={inputRef}
        type={inputType}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          // For non-date fields, validate during typing
          const error = e.target.value
            ? validateFieldValue(field as FormFieldDefinition, e.target.value)
            : null;
          setLocalValidationError(error);
          if (hasBlurred) {
            setContextValidationError(error); // Also update context for Field Help
          }
        }}
        onBlur={onBlur}
        onFocus={onFocus}
        onKeyDown={onInputKeyDown}
        placeholder={field?.placeholder}
        disabled={!isEditable}
        className={cellClassName}
        style={{ minWidth: "80px" }}
        title={showError ? localValidationError : undefined}
      />
      {showError && (
        <div className="absolute right-1 top-1/2 -translate-y-1/2 text-red-500" title={localValidationError}>
          <AlertCircle className="h-3.5 w-3.5" />
        </div>
      )}
    </div>
  );
});

const CheckboxCell = React.memo(function CheckboxCell({
  getValue,
  row,
  column,
  table,
}: CellContext<SampleMetadataRow, unknown>) {
  const initialValue = getValue();
  const normalizeChecked = (val: unknown) => {
    if (val === true || val === false) return val;
    if (val === "true") return true;
    if (val === "false") return false;
    return Boolean(val);
  };
  const [checked, setChecked] = useState(normalizeChecked(initialValue));
  const meta = column.columnDef.meta as StudyColumnMeta | undefined;
  const field = meta?.field as FormFieldDefinition | undefined;
  const isEditable = meta?.editable !== false;
  const { setFocusedField, setValidationError: setContextValidationError } = useFieldHelp();

  useEffect(() => {
    setChecked(normalizeChecked(initialValue));
  }, [initialValue]);

  const onFocus = () => {
    if (!field) return;

    preserveTableScroll(table.options.meta, () => {
      setFocusedField(field);
      setContextValidationError(validateFieldValue(field, checked));
    });
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isEditable) return;
    const nextValue = e.target.checked;
    setChecked(nextValue);
    setContextValidationError(validateFieldValue(field, nextValue));
    table.options.meta?.updateData(row.index, column.id, nextValue);
  };

  return (
    <div className="flex items-center justify-center h-full">
      <input
        type="checkbox"
        checked={checked}
        onChange={onChange}
        onFocus={onFocus}
        disabled={!isEditable}
        className={cn(
          "h-4 w-4 rounded border-input",
          !isEditable && "cursor-not-allowed opacity-70"
        )}
      />
    </div>
  );
});

const MultiSelectCell = React.memo(function MultiSelectCell({
  getValue,
  row,
  column,
  table,
}: CellContext<SampleMetadataRow, unknown>) {
  const initialValue = getValue();
  const normalizeValues = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.map((item) => String(item));
    if (val === undefined || val === null || val === "") return [];
    if (typeof val === "string" && val.includes(",")) {
      return val.split(",").map((item) => item.trim()).filter(Boolean);
    }
    return [String(val)];
  };
  const [value, setValue] = useState<string[]>(normalizeValues(initialValue));
  const meta = column.columnDef.meta as StudyColumnMeta | undefined;
  const field = meta?.field as FormFieldDefinition | undefined;
  const options = field?.options || [];
  const isEditable = meta?.editable !== false;
  const { setFocusedField, setValidationError: setContextValidationError } = useFieldHelp();

  useEffect(() => {
    setValue(normalizeValues(initialValue));
  }, [initialValue]);

  const onFocus = () => {
    if (!field) return;

    preserveTableScroll(table.options.meta, () => {
      setFocusedField(field);
      setContextValidationError(validateFieldValue(field, value));
    });
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!isEditable) return;
    const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
    setValue(selected);
    setContextValidationError(validateFieldValue(field, selected));
    table.options.meta?.updateData(row.index, column.id, selected);
  };

  if (options.length === 0) {
    return (
      <div className="w-full h-full px-2 py-1.5 text-sm text-amber-600 bg-amber-50">
        No options
      </div>
    );
  }

  return (
    <select
      multiple
      value={value}
      onChange={handleChange}
      onFocus={onFocus}
      disabled={!isEditable}
      className={cn(
        "w-full h-full px-2 py-1 text-sm bg-white border-0 outline-none",
        "focus:bg-blue-50 focus:ring-1 focus:ring-blue-300",
        !isEditable && "cursor-not-allowed opacity-70"
      )}
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
});

const CHECKLIST_TYPES = [
  { id: "human-gut", name: "Human Gut", icon: User, description: "Samples from human gastrointestinal tract", templateName: "MIxS Human Gut" },
  { id: "human-oral", name: "Human Oral", icon: User, description: "Samples from human oral cavity", templateName: "MIxS Human Oral" },
  { id: "human-skin", name: "Human Skin", icon: User, description: "Samples from human skin", templateName: "MIxS Human Skin" },
  { id: "human-associated", name: "Human Associated", icon: User, description: "Other human-associated samples", templateName: "MIxS Human Associated" },
  { id: "host-associated", name: "Host Associated", icon: Bug, description: "Samples from non-human hosts", templateName: "MIxS Host Associated" },
  { id: "plant-associated", name: "Plant Associated", icon: Leaf, description: "Samples associated with plants", templateName: "MIxS Plant Associated" },
  { id: "soil", name: "Soil", icon: Mountain, description: "Terrestrial soil samples", templateName: "MIxS Soil" },
  { id: "water", name: "Water", icon: Droplets, description: "Freshwater or marine samples", templateName: "MIxS Water" },
  { id: "wastewater-sludge", name: "Wastewater/Sludge", icon: Waves, description: "Wastewater treatment samples", templateName: "MIxS Wastewater Sludge" },
  { id: "air", name: "Air", icon: Wind, description: "Atmospheric or aerosol samples", templateName: "MIxS Air" },
  { id: "sediment", name: "Sediment", icon: Mountain, description: "Aquatic or terrestrial sediments", templateName: "MIxS Sediment" },
  { id: "microbial-mat", name: "Microbial Mat/Biofilm", icon: Microscope, description: "Biofilm or microbial mat samples", templateName: "MIxS Microbial Mat Biofilm" },
  { id: "misc-environment", name: "Miscellaneous", icon: FlaskConical, description: "Other environment types", templateName: "MIxS Miscellaneous" },
];

// Field definitions for help sidebar
const FIELD_DEFINITIONS = {
  title: {
    id: "title",
    name: "title",
    label: "Study Title",
    type: "text" as const,
    required: true,
    visible: true,
    order: 1,
    helpText: "Choose a descriptive title that reflects the biological context of your study. This title will appear in the European Nucleotide Archive (ENA) when your study is published.",
    placeholder: "e.g., Soil microbiome survey 2024",
  },
  description: {
    id: "description",
    name: "description",
    label: "Description",
    type: "textarea" as const,
    required: false,
    visible: true,
    order: 2,
    helpText: "Provide additional context about your study objectives, methods, or any relevant information. This helps reviewers and other researchers understand your work.",
    placeholder: "Describe the study objectives, methods, or any relevant context...",
  },
  checklistType: {
    id: "checklistType",
    name: "checklistType",
    label: "Environment Type",
    type: "select" as const,
    required: true,
    visible: true,
    order: 3,
    helpText: "Select the environment type that best matches where your samples were collected. This determines which MIxS (Minimum Information about any Sequence) metadata fields will be available for your samples.",
  },
  samples: {
    id: "samples",
    name: "samples",
    label: "Sample Selection",
    type: "multiselect" as const,
    required: true,
    visible: true,
    order: 4,
    helpText: "Select samples from your orders to include in this study. All selected samples will share the same MIxS checklist type for metadata entry.",
  },
};

interface AvailableSample {
  id: string;
  sampleId: string;
  sampleTitle: string | null;
  studyId: string | null;
  study: { id: string; title: string } | null;
  order: {
    id: string;
    orderNumber: string;
    name: string | null;
    status: string;
  };
}

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface StudyFormConfig {
  perSampleFields: FormFieldDefinition[];
  studyFields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  modules: {
    mixs: boolean;
    sampleAssociation: boolean;
    funding: boolean;
  };
}

interface MixsField {
  name: string;
  label: string;
  type: FormFieldDefinition['type'];
  required: boolean;
  helpText?: string;
  placeholder?: string;
  example?: string;
  options?: Array<{ value: string; label: string }>;
  units?: Array<{ value: string; label: string }>;
  group?: string;
  simpleValidation?: {
    minLength?: number;
    maxLength?: number;
    minValue?: number;
    maxValue?: number;
    pattern?: string;
    patternMessage?: string;
  };
}

interface MixsTemplate {
  name: string;
  fields: MixsField[];
}

export default function NewStudyPage() {
  const router = useRouter();
  const { data: session } = useSession();
  const { setFocusedField } = useFieldHelp();
  const [currentStep, setCurrentStep] = useState(0);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [checklistType, setChecklistType] = useState("");
  const [selectedSampleIds, setSelectedSampleIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [validationWarnings, setValidationWarnings] = useState<string[]>([]);
  const [showWarningDialog, setShowWarningDialog] = useState(false);

  // Form configuration from admin
  const [formConfig, setFormConfig] = useState<StudyFormConfig | null>(null);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Study-level custom field values
  const [studyFieldValues, setStudyFieldValues] = useState<Record<string, unknown>>({});
  const [studyFieldErrors, setStudyFieldErrors] = useState<Record<string, string>>({});

  // MIxS template fields
  const [mixsTemplate, setMixsTemplate] = useState<MixsTemplate | null>(null);
  const [loadingMixs, setLoadingMixs] = useState(false);
  const [selectedMixsFields, setSelectedMixsFields] = useState<Set<string>>(new Set());
  const [mixsFieldSearch, setMixsFieldSearch] = useState("");

  // Available samples from orders
  const [availableSamples, setAvailableSamples] = useState<AvailableSample[]>([]);
  const [loadingSamples, setLoadingSamples] = useState(false);

  // Per-sample data for the table
  const [sampleMetadata, setSampleMetadata] = useState<SampleMetadataRow[]>([]);

  const isFacilityAdmin = session?.user?.role === "FACILITY_ADMIN";

  const studyFields = useMemo(() => {
    const fields = (formConfig?.studyFields || [])
      .filter((field) => field.visible !== false && field.type !== "mixs" && !field.adminOnly);
    return fields.sort((a, b) => a.order - b.order);
  }, [formConfig?.studyFields]);

  // Admin-only study fields shown in a separate section for admins
  const adminOnlyStudyFields = useMemo(() => {
    if (!isFacilityAdmin) return [];
    return (formConfig?.studyFields || [])
      .filter((field) => field.visible !== false && field.adminOnly)
      .sort((a, b) => a.order - b.order);
  }, [formConfig?.studyFields, isFacilityAdmin]);

  const studyFieldGroups = useMemo(() => {
    const sortedGroups = [...(formConfig?.groups || [])].sort((a, b) => a.order - b.order);
    const groupMap = new Map(
      sortedGroups.map((group) => [
        group.id,
        { ...group, fields: [] as FormFieldDefinition[] },
      ])
    );
    const ungrouped = {
      id: "ungrouped",
      name: "Additional Fields",
      order: Number.MAX_SAFE_INTEGER,
      description: undefined as string | undefined,
      fields: [] as FormFieldDefinition[],
    };

    for (const field of studyFields) {
      const target = field.groupId ? groupMap.get(field.groupId) : undefined;
      if (target) {
        target.fields.push(field);
      } else {
        ungrouped.fields.push(field);
      }
    }

    for (const group of groupMap.values()) {
      group.fields.sort((a, b) => a.order - b.order);
    }
    ungrouped.fields.sort((a, b) => a.order - b.order);

    const grouped = sortedGroups
      .map((group) => groupMap.get(group.id))
      .filter((group): group is { id: string; name: string; description?: string; order: number; fields: FormFieldDefinition[] } => !!group && group.fields.length > 0);

    if (ungrouped.fields.length > 0) {
      grouped.push(ungrouped);
    }

    return grouped;
  }, [formConfig?.groups, studyFields]);

  useEffect(() => {
    if (studyFields.length === 0) return;
    setStudyFieldValues((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const field of studyFields) {
        if (next[field.name] !== undefined) continue;
        if (field.defaultValue !== undefined) {
          next[field.name] = field.defaultValue;
        } else if (field.type === "checkbox") {
          next[field.name] = false;
        } else if (field.type === "multiselect") {
          next[field.name] = [];
        } else if (field.type === "funding") {
          next[field.name] = null;
        } else {
          next[field.name] = "";
        }
        changed = true;
      }
      return changed ? next : prev;
    });
  }, [studyFields]);

  // Ref for table scroll container to preserve scroll position
  const tableScrollRef = useRef<HTMLDivElement>(null);
  // Store scroll position to restore after re-renders
  const scrollPositionRef = useRef<number>(0);

  const getTableScrollPosition = useCallback(() => {
    return tableScrollRef.current?.scrollLeft ?? scrollPositionRef.current;
  }, []);

  const restoreTableScrollPosition = useCallback((scrollLeft: number) => {
    const scrollContainer = tableScrollRef.current;
    if (!scrollContainer) return;
    scrollContainer.scrollLeft = scrollLeft;
    scrollPositionRef.current = scrollLeft;
  }, []);

  // Track which fields have been touched (for validation display)
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  // Fetch form configuration on mount
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/study-form-schema");
        if (res.ok) {
          const data = await res.json();
          setFormConfig(data);
        } else {
          setFormConfig({
            perSampleFields: [],
            studyFields: [],
            groups: [],
            modules: { mixs: true, sampleAssociation: true, funding: false },
          });
        }
      } catch {
        setFormConfig({
          perSampleFields: [],
          studyFields: [],
          groups: [],
          modules: { mixs: true, sampleAssociation: true, funding: false },
        });
      } finally {
        setLoadingConfig(false);
      }
    };
    fetchConfig();
  }, []);

  // Fetch MIxS template when checklist type changes
  useEffect(() => {
    if (!checklistType || !formConfig?.modules.mixs) {
      setMixsTemplate(null);
      setSelectedMixsFields(new Set());
      return;
    }

    const checklist = CHECKLIST_TYPES.find(c => c.id === checklistType);
    if (!checklist) return;

    const fetchMixsTemplate = async () => {
      setLoadingMixs(true);
      try {
        const res = await fetch(`/api/mixs-templates?name=${encodeURIComponent(checklist.templateName)}`);
        if (res.ok) {
          const data = await res.json();
          setMixsTemplate(data);
          // Select only required fields by default (users opt-in to optional fields)
          setSelectedMixsFields(new Set(data.fields.filter((f: MixsField) => f.required).map((f: MixsField) => f.name)));
        }
      } catch {
        console.error("Failed to load MIxS template");
      } finally {
        setLoadingMixs(false);
      }
    };

    fetchMixsTemplate();
  }, [checklistType, formConfig?.modules.mixs]);

  // Update sampleMetadata when selectedSampleIds changes
  useEffect(() => {
    const selectedSamples = availableSamples.filter(s => selectedSampleIds.includes(s.id));
    setSampleMetadata(prev => {
      // Keep existing data for samples that are still selected
      const existingData = new Map(prev.map(row => [row.id, row]));
      return selectedSamples.map(sample => {
        const existing = existingData.get(sample.id);
        if (existing) {
          return existing;
        }
        return {
          id: sample.id,
          sampleId: sample.sampleId,
        };
      });
    });
  }, [selectedSampleIds, availableSamples]);

  // Determine if we have per-sample fields to show
  const hasPerSampleFields = useMemo(() => {
    const mixsFieldsActive = Boolean(formConfig?.modules.mixs && mixsTemplate);
    const hasCustomFields = (formConfig?.perSampleFields || []).some((field) => {
      if (field.visible === false) return false;
      if (mixsFieldsActive && isLegacySubmgPerSampleFieldName(field.name)) return false;
      return true;
    });
    const hasMixsFields = formConfig?.modules.mixs && mixsTemplate && mixsTemplate.fields.length > 0;
    return hasCustomFields || hasMixsFields;
  }, [formConfig, mixsTemplate]);

  // Get all per-sample fields (custom + selected MIxS fields)
  // Order: 1) Custom fields, 2) Required MIxS fields, 3) Optional MIxS fields
  const allPerSampleFields = useMemo((): PerSampleField[] => {
    const customFields: PerSampleField[] = [];
    const requiredMixsFields: PerSampleField[] = [];
    const optionalMixsFields: PerSampleField[] = [];
    const mixsFieldsActive = Boolean(formConfig?.modules.mixs && mixsTemplate);

    // Add custom per-sample fields first
    if (formConfig?.perSampleFields) {
      const sortedPerSampleFields = [...formConfig.perSampleFields].sort((a, b) => a.order - b.order);
      for (let i = 0; i < sortedPerSampleFields.length; i++) {
        const field = sortedPerSampleFields[i];
        if (
          field.visible !== false &&
          !(mixsFieldsActive && isLegacySubmgPerSampleFieldName(field.name))
        ) {
          customFields.push({
            id: field.id || field.name,
            name: field.name,
            label: field.label,
            type: field.type,
            required: field.required,
            visible: true,
            order: field.order ?? i,
            helpText: field.helpText,
            placeholder: field.placeholder,
            options: field.options,
            adminOnly: field.adminOnly,
            source: 'custom',
          });
        }
      }
    }

    // Add MIxS fields - required first, then selected optional
    if (formConfig?.modules.mixs && mixsTemplate) {
      // First pass: collect required MIxS fields
      for (let i = 0; i < mixsTemplate.fields.length; i++) {
        const field = mixsTemplate.fields[i];
        if (field.required) {
          requiredMixsFields.push({
            id: `_mixs_${field.name}`,
            name: `_mixs_${field.name}`,
            label: field.label,
            type: field.type,
            required: true,
            visible: true,
            order: i,
            helpText: field.helpText,
            placeholder: field.placeholder,
            example: field.example,
            options: field.options,
            units: field.units,
            group: field.group,
            simpleValidation: field.simpleValidation,
            source: 'mixs',
          });
        }
      }
      // Second pass: collect selected optional MIxS fields
      for (let i = 0; i < mixsTemplate.fields.length; i++) {
        const field = mixsTemplate.fields[i];
        if (!field.required && selectedMixsFields.has(field.name)) {
          optionalMixsFields.push({
            id: `_mixs_${field.name}`,
            name: `_mixs_${field.name}`,
            label: field.label,
            type: field.type,
            required: false,
            visible: true,
            order: i,
            helpText: field.helpText,
            placeholder: field.placeholder,
            example: field.example,
            options: field.options,
            units: field.units,
            group: field.group,
            simpleValidation: field.simpleValidation,
            source: 'mixs',
          });
        }
      }
    }

    // Combine: custom fields, then required MIxS, then optional MIxS
    return [...customFields, ...requiredMixsFields, ...optionalMixsFields];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [formConfig, mixsTemplate, selectedMixsFields.size, [...selectedMixsFields].join(',')]);

  // Build steps dynamically based on configuration
  // Sample selection comes first so users start by choosing what to study
  const STEPS: Step[] = useMemo(() => {
    const steps: Step[] = [];

    // Start with sample selection if enabled
    if (formConfig?.modules.sampleAssociation) {
      steps.push({
        id: "samples",
        title: "Select Samples",
        description: "Choose samples from your orders",
        icon: FlaskConical,
      });
    }

    // Study details come after sample selection
    steps.push({
      id: "details",
      title: "Study Details",
      description: "Basic information about your study",
      icon: FileText,
    });

    // Add MIxS environment step only if enabled
    if (formConfig?.modules.mixs) {
      steps.push({
        id: "environment",
        title: "Environment Type",
        description: "Select the MIxS checklist for your samples",
        icon: Leaf,
      });
    }

    // Add sample metadata step if we have per-sample fields
    if (formConfig?.modules.sampleAssociation && hasPerSampleFields) {
      steps.push({
        id: "metadata",
        title: "Sample Metadata",
        description: "Enter metadata for each sample",
        icon: TableIcon,
      });
    }

    // Always add review step
    steps.push({
      id: "review",
      title: "Review",
      description: "Review and create your study",
      icon: CheckCircle2,
    });

    return steps;
  }, [formConfig, hasPerSampleFields]);

  const isMetadataStepActive = STEPS[currentStep]?.id === "metadata";

  useEffect(() => {
    if (!isMetadataStepActive) return;

    const scrollContainer = tableScrollRef.current;
    if (!scrollContainer) return;

    const handleScroll = () => {
      scrollPositionRef.current = scrollContainer.scrollLeft;
    };

    // Capture current position in case focus handlers run before another scroll event
    handleScroll();

    scrollContainer.addEventListener("scroll", handleScroll);
    return () => scrollContainer.removeEventListener("scroll", handleScroll);
  }, [isMetadataStepActive]);

  const focusFieldWithScrollPreserved = useCallback(
    (field: FormFieldDefinition) => {
      const scrollLeft = getTableScrollPosition();
      setFocusedField(field);
      requestAnimationFrame(() => {
        restoreTableScrollPosition(scrollLeft);
      });
    },
    [getTableScrollPosition, restoreTableScrollPosition, setFocusedField]
  );

  const markTouched = (field: string) => {
    setTouched(prev => ({ ...prev, [field]: true }));
  };

  const setStudyFieldValue = (fieldName: string, value: unknown) => {
    setStudyFieldValues((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
    if (studyFieldErrors[fieldName]) {
      setStudyFieldErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  const handleStudyFieldBlur = (field: FormFieldDefinition) => {
    const value = studyFieldValues[field.name];
    const validationError = validateFieldValue(field, value);
    if (validationError) {
      setStudyFieldErrors((prev) => ({ ...prev, [field.name]: validationError }));
      return;
    }

    if (studyFieldErrors[field.name]) {
      setStudyFieldErrors((prev) => {
        const next = { ...prev };
        delete next[field.name];
        return next;
      });
    }
  };

  const validateStudyFields = () => {
    if (studyFields.length === 0) return true;
    const errors: Record<string, string> = {};

    for (const field of studyFields) {
      const value = studyFieldValues[field.name];
      const validationError = validateFieldValue(field, value);
      if (validationError) {
        errors[field.name] = validationError;
      }
    }

    setStudyFieldErrors(errors);

    const firstErrorField = studyFields.find((field) => errors[field.name]);
    if (firstErrorField) {
      setError(`${firstErrorField.label}: ${errors[firstErrorField.name]}`);
      return false;
    }

    return true;
  };

  // Fetch available samples when reaching the samples step
  // Since samples is now the first step, also fetch eagerly when config loads
  useEffect(() => {
    const samplesStepIndex = STEPS.findIndex(s => s.id === "samples");
    if (samplesStepIndex !== -1 && currentStep === samplesStepIndex && availableSamples.length === 0) {
      fetchAvailableSamples();
    }
  }, [currentStep, STEPS, availableSamples.length]);

  // Update field help sidebar when step changes
  useEffect(() => {
    const stepId = STEPS[currentStep]?.id;
    if (stepId === "samples") {
      setFocusedField(FIELD_DEFINITIONS.samples);
    } else if (stepId === "details") {
      setFocusedField(FIELD_DEFINITIONS.title);
    } else if (stepId === "environment") {
      setFocusedField(FIELD_DEFINITIONS.checklistType);
    }
  }, [currentStep, STEPS, setFocusedField]);

  const fetchAvailableSamples = async () => {
    setLoadingSamples(true);
    try {
      const res = await fetch("/api/samples");
      if (!res.ok) throw new Error("Failed to fetch samples");
      const data = await res.json();
      setAvailableSamples(data);
    } catch {
      console.error("Failed to fetch samples");
    } finally {
      setLoadingSamples(false);
    }
  };

  // Validation state
  const isTitleValid = title.trim().length > 0;
  const isChecklistValid = !formConfig?.modules.mixs || checklistType !== "";
  const isSamplesValid = !formConfig?.modules.sampleAssociation || selectedSampleIds.length > 0;

  // Get border class based on validation state
  const getBorderClass = (field: string, isValid: boolean) => {
    if (!touched[field]) return "";
    if (isValid) return "border-green-500 focus:ring-green-500/20";
    return "input-error";
  };

  const nextStep = () => {
    setError("");

    const currentStepId = STEPS[currentStep]?.id;

    // Validate current step
    if (currentStepId === "details") {
      markTouched("title");
      if (!title.trim()) {
        setError("Study title is required");
        return;
      }
      if (!validateStudyFields()) {
        return;
      }
    }

    if (currentStepId === "environment") {
      markTouched("checklistType");
      if (!checklistType) {
        setError("Please select an environment type");
        return;
      }
    }

    if (currentStepId === "samples") {
      markTouched("samples");
      if (selectedSampleIds.length === 0) {
        setError("Please select at least one sample");
        return;
      }
    }

    if (currentStep < STEPS.length - 1) {
      setCurrentStep(currentStep + 1);
    }
  };

  const prevStep = () => {
    setError("");
    if (currentStep > 0) {
      setCurrentStep(currentStep - 1);
    }
  };

  // Update sample metadata from table
  // Supports both single field update: updateSampleMetadata(rowIndex, columnId, value)
  // And multi-field update: updateSampleMetadata(rowIndex, { field1: value1, field2: value2 })
  const updateSampleMetadata = useCallback((rowIndex: number, columnIdOrUpdates: string | Record<string, unknown>, value?: unknown) => {
    const scrollLeft = getTableScrollPosition();

    setSampleMetadata((old) => {
      const newData = [...old];
      if (newData[rowIndex]) {
        if (typeof columnIdOrUpdates === "object") {
          // Multi-field update
          newData[rowIndex] = {
            ...newData[rowIndex],
            ...columnIdOrUpdates,
          };
        } else {
          // Single field update
          newData[rowIndex] = {
            ...newData[rowIndex],
            [columnIdOrUpdates]: value,
          };
        }
      }
      return newData;
    });

    // Restore scroll position after React re-render
    requestAnimationFrame(() => {
      restoreTableScrollPosition(scrollLeft);
    });
  }, [getTableScrollPosition, restoreTableScrollPosition]);

  const hasMetadataValue = useCallback(
    (row: SampleMetadataRow) =>
      allPerSampleFields.some((f) => {
        const val = row[f.name];
        return (
          val !== undefined &&
          val !== null &&
          val !== "" &&
          !(Array.isArray(val) && val.length === 0)
        );
      }),
    [allPerSampleFields]
  );

  // Handle samples imported from Excel
  const handleSamplesImported = useCallback(
    (
      importedRows: { id: string; sampleId: string; [key: string]: unknown }[],
      mode: "replace" | "append"
    ) => {
      const normalizeSampleId = (value: unknown) =>
        String(value ?? "").trim().toLowerCase();
      const stripImportedIdentity = (
        row: { id: string; sampleId: string; [key: string]: unknown }
      ) => {
        const { id, sampleId, ...rest } = row;
        void id;
        void sampleId;
        return rest;
      };

      if (mode === "replace") {
        setSampleMetadata((prev) => {
          const importedBySampleId = new Map(
            importedRows
              .map((row) => [normalizeSampleId(row.sampleId), row] as const)
              .filter(([key]) => key.length > 0)
          );

          return prev.map((existing) => {
            const key = normalizeSampleId(existing.sampleId);
            const imported = importedBySampleId.get(key);
            if (!imported) return existing;
            return { ...existing, ...stripImportedIdentity(imported) };
          });
        });
      } else {
        setSampleMetadata((prev) => {
          const updated = [...prev];
          const filledIndexes = new Set<number>();
          const unmatchedRows: { id: string; sampleId: string; [key: string]: unknown }[] = [];

          for (const row of importedRows) {
            const key = normalizeSampleId(row.sampleId);
            if (!key) {
              unmatchedRows.push(row);
              continue;
            }
            const targetIndex = updated.findIndex(
              (existing) => normalizeSampleId(existing.sampleId) === key
            );
            if (targetIndex === -1 || hasMetadataValue(updated[targetIndex])) {
              unmatchedRows.push(row);
              continue;
            }
            updated[targetIndex] = {
              ...updated[targetIndex],
              ...stripImportedIdentity(row),
            };
            filledIndexes.add(targetIndex);
          }

          for (const row of unmatchedRows) {
            const emptyIndex = updated.findIndex(
              (existing, index) =>
                !filledIndexes.has(index) && !hasMetadataValue(existing)
            );
            if (emptyIndex === -1) {
              break;
            }
            updated[emptyIndex] = {
              ...updated[emptyIndex],
              ...stripImportedIdentity(row),
            };
            filledIndexes.add(emptyIndex);
          }

          return updated;
        });
      }
      toast.success(
        `Imported ${importedRows.length} sample${importedRows.length !== 1 ? "s" : ""} metadata`
      );
    },
    [hasMetadataValue]
  );

  // Build table columns
  const tableColumns = useMemo((): ColumnDef<SampleMetadataRow>[] => {
    const cols: ColumnDef<SampleMetadataRow>[] = [
      // Row number
      {
        id: "rowNumber",
        header: "#",
        size: 50,
        cell: ({ row }) => (
          <div className="text-center text-muted-foreground font-medium text-sm">
            {row.index + 1}
          </div>
        ),
      },
      // Sample ID - read only
      {
        accessorKey: "sampleId",
        header: () => (
          <span className="text-muted-foreground">Sample ID</span>
        ),
        size: 160,
        cell: ({ getValue }) => (
          <div className="px-2 py-1 h-full bg-muted/50 text-muted-foreground font-mono text-xs">
            {getValue() as string}
          </div>
        ),
      },
    ];

    // Add per-sample field columns
    for (const field of allPerSampleFields) {
      const isMixsField = field.source === 'mixs';
      // Create a stable copy of the field for the closure
      const fieldCopy = { ...field };
      let cellType: typeof EditableCell | typeof MultiSelectCell | typeof CheckboxCell = EditableCell;

      if (field.type === "multiselect") {
        cellType = MultiSelectCell;
      } else if (field.type === "checkbox") {
        cellType = CheckboxCell;
      }

      const col: ColumnDef<SampleMetadataRow> = {
        id: field.name,
        accessorFn: (row) => getPerSampleFieldValue(row, field) ?? "",
        header: () => (
          <span className={cn(
            "flex items-center gap-1",
            isMixsField && "text-emerald-800"
          )}>
            {fieldCopy.label}
            {fieldCopy.required && <span className="text-destructive">*</span>}
          </span>
        ),
        size: field.type === "date" ? 140 : 150,
        cell: cellType,
        meta: {
          field: field as FormFieldDefinition,
          editable: !isLoading,
          isMixsField,
        },
      };
      cols.push(col);
    }

    return cols;
  }, [allPerSampleFields, isLoading]);

  // TanStack Table instance
  const metadataTable = useReactTable({
    data: sampleMetadata,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: updateSampleMetadata,
      getScrollPosition: getTableScrollPosition,
      restoreScrollPosition: restoreTableScrollPosition,
    },
  });

  // Blur any focused input to commit pending values before validation
  const commitPendingInputs = () => {
    const active = document.activeElement;
    if (active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement || active instanceof HTMLSelectElement) {
      active.blur();
    }
  };

  // Returns { canProceed: boolean, warnings: string[] }
  // Hard errors (title, checklist, samples) return canProceed=false
  // Soft errors (missing required per-sample data) return warnings but canProceed=true
  const validateBeforeSubmit = (skipWarnings = false): { canProceed: boolean; warnings: string[] } => {
    // Commit any pending input values first
    commitPendingInputs();

    const warnings: string[] = [];

    if (!title.trim()) {
      setError("Study title is required");
      return { canProceed: false, warnings: [] };
    }

    if (formConfig?.modules.mixs && !checklistType) {
      setError("Please select a MIxS checklist type");
      return { canProceed: false, warnings: [] };
    }

    if (formConfig?.modules.sampleAssociation && selectedSampleIds.length === 0) {
      setError("Please select at least one sample");
      return { canProceed: false, warnings: [] };
    }

    if (!validateStudyFields()) {
      return { canProceed: false, warnings: [] };
    }

    // Per-sample field validation - collect as warnings, not hard errors
    if (formConfig?.modules.sampleAssociation && hasPerSampleFields) {
      for (const row of sampleMetadata) {
        for (const field of allPerSampleFields) {
          const value = getPerSampleFieldValue(row, field);
          const validationError = validateFieldValue(field as FormFieldDefinition, value);
          if (validationError) {
            warnings.push(`${row.sampleId}: ${field.label} ${validationError}`);
          }
        }
      }
    }

    // If there are warnings and we're not skipping them, show the dialog
    if (warnings.length > 0 && !skipWarnings) {
      setValidationWarnings(warnings);
      setShowWarningDialog(true);
      return { canProceed: false, warnings };
    }

    return { canProceed: true, warnings };
  };

  const buildStudyMetadataPayload = () => {
    const metadata: Record<string, unknown> = {};
    // Include regular study fields and admin-only fields
    const allFields = [...studyFields, ...adminOnlyStudyFields];
    for (const field of allFields) {
      let value = studyFieldValues[field.name];
      if (field.type === "multiselect" && typeof value === "string") {
        value = value.includes(",")
          ? value.split(",").map((item) => item.trim()).filter(Boolean)
          : value ? [value] : [];
      }
      if (isMissingRequiredValue(field, value)) {
        continue;
      }
      metadata[field.name] = value;
    }
    return metadata;
  };

  const handleSubmit = async (skipWarnings = false) => {
    setError("");
    setShowWarningDialog(false);

    const { canProceed } = validateBeforeSubmit(skipWarnings);
    if (!canProceed) {
      return;
    }

    setIsLoading(true);

    try {
      const studyMetadata = buildStudyMetadataPayload();
      const payload: Record<string, unknown> = {
        title: title.trim(),
        description: description.trim() || null,
        checklistType: formConfig?.modules.mixs ? checklistType : null,
      };

      if (Object.keys(studyMetadata).length > 0) {
        payload.studyMetadata = studyMetadata;
      }

      // Create the study
      const res = await fetch("/api/studies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "Failed to create study");
      }

      const study = await res.json();

      // Assign the selected samples to the study with per-sample data
      if (formConfig?.modules.sampleAssociation && selectedSampleIds.length > 0) {
        // Convert sampleMetadata to perSampleData format
        const perSampleData: Record<string, Record<string, unknown>> = {};
        for (const row of sampleMetadata) {
          const data: Record<string, unknown> = {};
          for (const field of allPerSampleFields) {
            const value = getPerSampleFieldValue(row, field);
            const isEmptyValue =
              value === undefined ||
              value === null ||
              value === "" ||
              (Array.isArray(value) && value.length === 0);
            if (!isEmptyValue) {
              data[getStoredChecklistKey(field)] = value;
            }
          }
          if (Object.keys(data).length > 0) {
            perSampleData[row.id] = data;
          }
        }

        const assignRes = await fetch(`/api/studies/${study.id}/samples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            sampleIds: selectedSampleIds,
            perSampleData: perSampleData,
          }),
        });

        if (!assignRes.ok) {
          throw new Error("Failed to assign samples to study");
        }
      }

      // Redirect to study detail page
      router.push(`/studies/${study.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create study");
    } finally {
      setIsLoading(false);
    }
  };

  const toggleSampleSelection = (sampleId: string) => {
    setSelectedSampleIds(prev =>
      prev.includes(sampleId)
        ? prev.filter(id => id !== sampleId)
        : [...prev, sampleId]
    );
  };

  const selectAllUnassigned = () => {
    const unassignedIds = availableSamples
      .filter(s => s.studyId === null)
      .map(s => s.id);
    setSelectedSampleIds(unassignedIds);
  };

  const clearSelection = () => {
    setSelectedSampleIds([]);
  };

  // Filter samples
  const unassignedSamples = availableSamples.filter(s => s.studyId === null);
  const assignedSamples = availableSamples.filter(s => s.studyId !== null);
  const selectedSamples = availableSamples.filter(s => selectedSampleIds.includes(s.id));

  // Validation indicator component
  const ValidationIndicator = ({ isValid, touched: isTouched }: { isValid: boolean; touched: boolean }) => {
    if (!isTouched || !isValid) return null;
    return (
      <div className="absolute right-3 top-1/2 -translate-y-1/2">
        <CheckCircle2 className="h-4 w-4 text-green-500" />
      </div>
    );
  };

  const renderStudyFieldInput = (field: FormFieldDefinition) => {
    const value = studyFieldValues[field.name];
    const error = studyFieldErrors[field.name];
    const showRequired = field.required;
    const commonLabel = (
      <Label className="text-sm flex items-center gap-1">
        {field.label}
        {showRequired && <span className="text-destructive">*</span>}
      </Label>
    );

    if (field.type === "funding") {
      return (
        <div key={field.id} className="md:col-span-2">
          <FundingFormRenderer
            field={field}
            value={(value as FundingFieldValue | null) || null}
            disabled={isLoading}
            onChange={(newValue) => setStudyFieldValue(field.name, newValue)}
          />
          {error && <p className="text-xs text-destructive mt-1">{error}</p>}
        </div>
      );
    }

    if (field.type === "checkbox") {
      return (
        <div key={field.id} className="space-y-1">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={value === true}
              onChange={(e) => setStudyFieldValue(field.name, e.target.checked)}
              onFocus={() => setFocusedField(field)}
              onBlur={() => handleStudyFieldBlur(field)}
              disabled={isLoading}
              className="h-4 w-4 rounded border-input"
            />
            <div className="flex items-center gap-1">
              {commonLabel}
            </div>
          </div>
          {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
          {error && <p className="text-xs text-destructive">{error}</p>}
        </div>
      );
    }

    if (field.type === "select") {
      return (
        <div key={field.id} className="space-y-1">
          {commonLabel}
          <select
            value={typeof value === "string" ? value : ""}
            onChange={(e) => {
              setStudyFieldValue(field.name, e.target.value);
              handleStudyFieldBlur(field);
            }}
            onFocus={() => setFocusedField(field)}
            disabled={isLoading}
            className={cn(
              "h-10 w-full rounded-md border border-input bg-background px-3 text-sm",
              error && "input-error"
            )}
          >
            <option value="">Select...</option>
            {(field.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {error && <InlineFieldError message={error} />}
          {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        </div>
      );
    }

    if (field.type === "multiselect") {
      const selectedValues = Array.isArray(value)
        ? value.map((item) => String(item))
        : typeof value === "string" && value.includes(",")
          ? value.split(",").map((item) => item.trim()).filter(Boolean)
          : [];
      return (
        <div key={field.id} className="space-y-1">
          {commonLabel}
          <select
            multiple
            value={selectedValues}
            onChange={(e) => {
              const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
              setStudyFieldValue(field.name, selected);
              handleStudyFieldBlur(field);
            }}
            onFocus={() => setFocusedField(field)}
            disabled={isLoading}
            className={cn(
              "min-h-[88px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm",
              error && "input-error"
            )}
          >
            {(field.options || []).map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
          {error && <InlineFieldError message={error} />}
          {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        </div>
      );
    }

    if (field.type === "textarea") {
      return (
        <div key={field.id} className="space-y-1 md:col-span-2">
          {commonLabel}
          <Textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => setStudyFieldValue(field.name, e.target.value)}
            onFocus={() => setFocusedField(field)}
            onBlur={() => handleStudyFieldBlur(field)}
            placeholder={field.placeholder}
            rows={3}
            disabled={isLoading}
            className={cn(error && "input-error")}
          />
          {error && <InlineFieldError message={error} />}
          {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
        </div>
      );
    }

    const inputType = field.type === "number" ? "number" : field.type === "date" ? "date" : "text";
    return (
      <div key={field.id} className="space-y-1">
        {commonLabel}
        <Input
          type={inputType}
          value={value === undefined || value === null ? "" : String(value)}
          onChange={(e) => setStudyFieldValue(field.name, e.target.value)}
          onFocus={() => setFocusedField(field)}
          onBlur={() => handleStudyFieldBlur(field)}
          placeholder={field.placeholder}
          disabled={isLoading}
          className={cn(error && "input-error")}
        />
        {error && <InlineFieldError message={error} />}
        {field.helpText && <p className="text-xs text-muted-foreground">{field.helpText}</p>}
      </div>
    );
  };

  // Sample Metadata Table Step Component
  const SampleMetadataTableStep = () => {
    if (loadingMixs) {
      return (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-primary" />
        </div>
      );
    }

    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-muted-foreground">
            Add your sample metadata below. Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Tab</kbd>,{" "}
            <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Enter</kbd>, or arrow keys to navigate.
            {allPerSampleFields.length > 0 && (
              <span> Click column headers for field help.</span>
            )}
          </p>
          <div className="flex items-center gap-2">
            <ExcelToolbar
              perSampleFields={allPerSampleFields as FormFieldDefinition[]}
              samples={sampleMetadata}
              onSamplesImported={handleSamplesImported}
              disabled={isLoading}
              entityName="study"
            />
          </div>
        </div>
        {allPerSampleFields.some((field) => field.adminOnly) && (
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-xs text-slate-600">
            Facility-only columns are shown only to facility admins and stay hidden from researchers.
          </div>
        )}

        {allPerSampleFields.length === 0 ? (
          <div className="text-center py-8 bg-muted/30 rounded-lg">
            <p className="text-muted-foreground">No per-sample fields configured.</p>
            {formConfig?.modules.mixs && !mixsTemplate && (
              <p className="text-sm text-amber-600 mt-2">
                MIxS template not loaded. Please ensure you selected an environment type.
              </p>
            )}
          </div>
        ) : (
          <div className="border rounded-lg overflow-hidden">
            <div ref={tableScrollRef} className="overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  {metadataTable.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => {
                        const colMeta = header.column.columnDef.meta as StudyColumnMeta | undefined;
                        const isMixs = colMeta?.isMixsField;
                        const field = colMeta?.field;
                        const isFacilityField = field?.adminOnly === true;
                        return (
                          <th
                            key={header.id}
                            style={{ width: header.getSize() }}
                            onClick={() => {
                              if (field) {
                                focusFieldWithScrollPreserved(field);
                              }
                            }}
                            className={cn(
                              "px-2 py-1.5 text-left text-xs font-medium border-b border-r last:border-r-0 cursor-pointer",
                              isFacilityField
                                ? "bg-slate-100 hover:bg-slate-200"
                                : isMixs
                                  ? "bg-emerald-50 hover:bg-emerald-100"
                                  : "bg-muted/50 hover:bg-muted"
                            )}
                          >
                            {header.isPlaceholder ? null : (
                              <div className="flex items-center gap-1.5">
                                {flexRender(header.column.columnDef.header, header.getContext())}
                                {isFacilityField && (
                                  <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                                    Facility
                                  </span>
                                )}
                              </div>
                            )}
                          </th>
                        );
                      })}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {metadataTable.getRowModel().rows.length === 0 ? (
                    <tr>
                      <td
                        colSpan={tableColumns.length}
                        className="px-4 py-8 text-center text-muted-foreground border-b"
                      >
                        <div className="flex flex-col items-center gap-2">
                          <TableIcon className="h-8 w-8 text-muted-foreground/30" />
                          <span>No samples selected. Go back to select samples.</span>
                        </div>
                      </td>
                    </tr>
                  ) : (
                    metadataTable.getRowModel().rows.map((row) => (
                      <tr key={row.id} className="hover:bg-muted/30">
                        {row.getVisibleCells().map((cell) => {
                          const colMeta = cell.column.columnDef.meta as StudyColumnMeta | undefined;
                          const isMixs = colMeta?.isMixsField;
                          const isFacilityField = colMeta?.field?.adminOnly === true;
                          const shouldFocusEditorOnCellMouseDown = Boolean(colMeta?.field) && colMeta?.editable !== false;
                          return (
                            <td
                              key={cell.id}
                              style={{ width: cell.column.getSize() }}
                              className={cn(
                                "border-b border-r last:border-r-0 h-8",
                                isFacilityField
                                  ? "bg-slate-50/80"
                                  : isMixs && "bg-emerald-50/50"
                              )}
                              onMouseDown={(event) => {
                                if (!shouldFocusEditorOnCellMouseDown) return;

                                const target = event.target as HTMLElement;
                                if (target.closest("input, textarea, select, button")) return;

                                focusFirstCellEditor(event.currentTarget);
                              }}
                            >
                              {flexRender(cell.column.columnDef.cell, cell.getContext())}
                            </td>
                          );
                        })}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <div className="bg-muted/30 px-3 py-2 border-t flex items-center justify-end">
              <span className="text-xs text-muted-foreground">
                {sampleMetadata.length} sample{sampleMetadata.length !== 1 ? "s" : ""}
                {allPerSampleFields.length > 0 && ` | ${allPerSampleFields.length} field${allPerSampleFields.length !== 1 ? "s" : ""}`}
              </span>
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderStepContent = () => {
    const currentStepId = STEPS[currentStep]?.id;

    switch (currentStepId) {
      case "details":
        const titleError = touched.title && !isTitleValid ? "Required" : null;
        return (
          <div className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="title" className="text-base flex items-center gap-2">
                Study Title <span className="text-destructive">*</span>
                {touched.title && isTitleValid && (
                  <CheckCircle2 className="h-4 w-4 text-green-500" />
                )}
              </Label>
              <div className="relative">
                <Input
                  id="title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onFocus={() => setFocusedField(FIELD_DEFINITIONS.title)}
                  onBlur={() => markTouched("title")}
                  placeholder={FIELD_DEFINITIONS.title.placeholder}
                  disabled={isLoading}
                  className={cn(
                    "h-12 text-base transition-colors",
                    touched.title && isTitleValid && "pr-10",
                    getBorderClass("title", isTitleValid)
                  )}
                />
                <ValidationIndicator isValid={isTitleValid} touched={touched.title || false} />
              </div>
              {titleError && <InlineFieldError message={titleError} />}
              <p className="text-sm text-muted-foreground">
                {FIELD_DEFINITIONS.title.helpText}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-base flex items-center gap-2">
                Description
                <span className="text-xs text-muted-foreground font-normal">(optional)</span>
              </Label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                onFocus={() => setFocusedField(FIELD_DEFINITIONS.description)}
                placeholder={FIELD_DEFINITIONS.description.placeholder}
                rows={4}
                disabled={isLoading}
                className="text-base"
              />
              <p className="text-sm text-muted-foreground">
                {FIELD_DEFINITIONS.description.helpText}
              </p>
            </div>

            {studyFieldGroups.length > 0 && (
              <div className="space-y-6 pt-4 border-t border-border">
                {studyFieldGroups.map((group) => (
                  <div key={group.id} className="space-y-3">
                    <div>
                      <h3 className="text-sm font-medium">{group.name}</h3>
                      {group.description && (
                        <p className="text-xs text-muted-foreground">{group.description}</p>
                      )}
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                      {group.fields.map(renderStudyFieldInput)}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Facility-only fields section (admin only) */}
            {adminOnlyStudyFields.length > 0 && (
              <div className="space-y-4 pt-6 border-t border-slate-200">
                <div className="flex items-center gap-2">
                  <Shield className="h-4 w-4 text-slate-500" />
                  <h3 className="text-sm font-medium text-slate-700">Facility Fields</h3>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50/50 px-4 py-3 mb-2">
                  <p className="text-xs text-slate-500">
                    These fields are only visible to facility admins.
                  </p>
                </div>
                <div className="grid md:grid-cols-2 gap-4">
                  {adminOnlyStudyFields.map(renderStudyFieldInput)}
                </div>
              </div>
            )}
          </div>
        );

      case "environment":
        return (
          <div className="space-y-6">
            <div>
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm text-muted-foreground">
                  Select the environment type that best matches your samples.
                </p>
                {touched.checklistType && isChecklistValid && (
                  <div className="flex items-center gap-1.5 text-green-600 text-sm">
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Selected</span>
                  </div>
                )}
              </div>
              <div
                className="grid grid-cols-2 md:grid-cols-3 gap-3"
                onFocus={() => setFocusedField(FIELD_DEFINITIONS.checklistType)}
              >
                {CHECKLIST_TYPES.map((checklist) => {
                  const Icon = checklist.icon;
                  const isSelected = checklistType === checklist.id;
                  return (
                    <button
                      key={checklist.id}
                      type="button"
                      onClick={() => {
                        setChecklistType(checklist.id);
                        markTouched("checklistType");
                      }}
                      disabled={isLoading}
                      className={cn(
                        "relative p-4 rounded-lg border-2 text-left transition-all",
                        "hover:border-primary/50 hover:bg-primary/5",
                        isSelected
                          ? "border-green-500 bg-green-500/10"
                          : "border-border bg-background"
                      )}
                    >
                      {isSelected && (
                        <div className="absolute top-2 right-2">
                          <CheckCircle2 className="h-5 w-5 text-green-500" />
                        </div>
                      )}
                      <Icon className={cn(
                        "h-6 w-6 mb-2",
                        isSelected ? "text-green-600" : "text-muted-foreground"
                      )} />
                      <p className={cn(
                        "font-medium text-sm",
                        isSelected && "text-green-700"
                      )}>{checklist.name}</p>
                      <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                        {checklist.description}
                      </p>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* MIxS Field Selection */}
            {checklistType && (
              <div className="border-t pt-6">
                <div className="mb-4">
                  <h3 className="text-sm font-medium">Metadata Fields</h3>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Required fields are always included. Choose which optional fields to add.
                  </p>
                </div>

                {loadingMixs ? (
                  <div className="flex items-center justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : mixsTemplate && mixsTemplate.fields.length > 0 ? (
                  <div className="space-y-6">
                    {/* Required Fields */}
                    {(() => {
                      const requiredFields = mixsTemplate.fields.filter(f => f.required);
                      if (requiredFields.length === 0) return null;
                      return (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <span className="text-xs font-medium text-amber-700 bg-amber-100 px-2 py-0.5 rounded">
                              Required ({requiredFields.length})
                            </span>
                          </div>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            {requiredFields.map((field) => (
                              <div
                                key={field.name}
                                className="flex items-center gap-3 p-3 rounded-lg border border-amber-200 bg-amber-50/50 text-left"
                              >
                                <div className="h-4 w-4 rounded border border-amber-500 bg-amber-500 flex items-center justify-center flex-shrink-0">
                                  <Check className="h-3 w-3 text-white" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <p className="text-sm font-medium text-amber-900 truncate">
                                    {field.label}
                                  </p>
                                  {field.helpText && (
                                    <p className="text-xs text-amber-700/70 truncate">
                                      {field.helpText}
                                    </p>
                                  )}
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}

                    {/* Optional Fields */}
                    {(() => {
                      const optionalFields = mixsTemplate.fields.filter(f => !f.required);
                      if (optionalFields.length === 0) return null;

                      // Filter by search query
                      const searchLower = mixsFieldSearch.toLowerCase();
                      const filteredFields = searchLower
                        ? optionalFields.filter(f =>
                            f.label.toLowerCase().includes(searchLower) ||
                            f.name.toLowerCase().includes(searchLower) ||
                            (f.helpText && f.helpText.toLowerCase().includes(searchLower))
                          )
                        : optionalFields;

                      return (
                        <div>
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs font-medium text-muted-foreground bg-muted px-2 py-0.5 rounded">
                              Optional ({optionalFields.length})
                            </span>
                            <div className="flex items-center gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const requiredNames = mixsTemplate.fields.filter(f => f.required).map(f => f.name);
                                  const allNames = mixsTemplate.fields.map(f => f.name);
                                  setSelectedMixsFields(new Set([...requiredNames, ...allNames]));
                                }}
                                className="text-xs h-6 px-2"
                              >
                                Select All
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  const requiredNames = mixsTemplate.fields.filter(f => f.required).map(f => f.name);
                                  setSelectedMixsFields(new Set(requiredNames));
                                }}
                                className="text-xs h-6 px-2"
                              >
                                Clear Optional
                              </Button>
                            </div>
                          </div>

                          {/* Search input */}
                          <div className="relative mb-3">
                            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                              type="text"
                              placeholder="Search fields..."
                              value={mixsFieldSearch}
                              onChange={(e) => setMixsFieldSearch(e.target.value)}
                              className="pl-9 h-9 text-sm"
                            />
                            {mixsFieldSearch && (
                              <button
                                type="button"
                                onClick={() => setMixsFieldSearch("")}
                                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>

                          {filteredFields.length === 0 ? (
                            <div className="text-center py-6 bg-muted/30 rounded-lg">
                              <p className="text-sm text-muted-foreground">
                                No fields match &quot;{mixsFieldSearch}&quot;
                              </p>
                            </div>
                          ) : (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 max-h-[400px] overflow-y-auto pr-1">
                              {filteredFields.map((field) => {
                              const isFieldSelected = selectedMixsFields.has(field.name);
                              return (
                                <button
                                  key={field.name}
                                  type="button"
                                  onClick={() => {
                                    setSelectedMixsFields(prev => {
                                      const next = new Set(prev);
                                      if (next.has(field.name)) {
                                        next.delete(field.name);
                                      } else {
                                        next.add(field.name);
                                      }
                                      return next;
                                    });
                                  }}
                                  className={cn(
                                    "flex items-center gap-3 p-3 rounded-lg border text-left transition-all",
                                    "hover:bg-muted/50",
                                    isFieldSelected
                                      ? "border-emerald-300 bg-emerald-50"
                                      : "border-border bg-background"
                                  )}
                                >
                                  <div className={cn(
                                    "h-4 w-4 rounded border flex items-center justify-center flex-shrink-0",
                                    isFieldSelected
                                      ? "border-emerald-500 bg-emerald-500"
                                      : "border-muted-foreground/30"
                                  )}>
                                    {isFieldSelected && <Check className="h-3 w-3 text-white" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className={cn(
                                      "text-sm font-medium truncate",
                                      isFieldSelected && "text-emerald-800"
                                    )}>
                                      {field.label}
                                    </p>
                                    {field.helpText && (
                                      <p className="text-xs text-muted-foreground truncate">
                                        {field.helpText}
                                      </p>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                            </div>
                          )}
                        </div>
                      );
                    })()}

                    {/* Selection summary */}
                    <p className="text-xs text-muted-foreground">
                      {selectedMixsFields.size} of {mixsTemplate.fields.length} fields selected
                    </p>
                  </div>
                ) : (
                  <div className="text-center py-8 bg-muted/30 rounded-lg">
                    <p className="text-sm text-muted-foreground">
                      No additional metadata fields available for this environment type.
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        );

      case "samples":
        return (
          <div className="space-y-4" onFocus={() => setFocusedField(FIELD_DEFINITIONS.samples)}>
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm text-muted-foreground">
                  Select samples from your orders to include in this study.
                </p>
                {selectedSampleIds.length > 0 && (
                  <p className="text-sm text-green-600 mt-1">
                    {selectedSampleIds.length} sample{selectedSampleIds.length !== 1 ? "s" : ""} selected
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                {unassignedSamples.length > 0 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={selectAllUnassigned}
                  >
                    Select All
                  </Button>
                )}
                {selectedSampleIds.length > 0 && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={clearSelection}
                  >
                    Clear
                  </Button>
                )}
              </div>
            </div>

            {loadingSamples ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
              </div>
            ) : unassignedSamples.length === 0 ? (
              <div className="text-center py-12 bg-muted/30 rounded-lg">
                <FlaskConical className="h-12 w-12 mx-auto mb-3 text-muted-foreground/50" />
                <p className="text-muted-foreground mb-2">No unassigned samples available</p>
                <p className="text-sm text-muted-foreground">
                  Create an order and add samples first, or all samples are already assigned to studies.
                </p>
                <Button className="mt-4" size="sm" asChild>
                  <Link href="/orders/new">Create Order</Link>
                </Button>
              </div>
            ) : (
              <div className="space-y-2 max-h-[400px] overflow-y-auto">
                {unassignedSamples.map((sample) => {
                  const isSelected = selectedSampleIds.includes(sample.id);
                  return (
                    <button
                      key={sample.id}
                      type="button"
                      onClick={() => toggleSampleSelection(sample.id)}
                      className={cn(
                        "w-full p-4 rounded-lg border-2 text-left transition-all flex items-center gap-3",
                        "hover:border-primary/50 hover:bg-primary/5",
                        isSelected
                          ? "border-green-500 bg-green-500/10"
                          : "border-blue-400/50 bg-blue-50/50 dark:bg-blue-950/20"
                      )}
                    >
                      <div className={cn(
                        "h-5 w-5 rounded border-2 flex items-center justify-center flex-shrink-0",
                        isSelected ? "border-green-500 bg-green-500" : "border-muted-foreground/30"
                      )}>
                        {isSelected && <Check className="h-3 w-3 text-white" />}
                      </div>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium">{sample.sampleId}</p>
                        <p className="text-sm text-muted-foreground truncate">
                          {sample.order.orderNumber}
                          {sample.order.name && ` - ${sample.order.name}`}
                        </p>
                      </div>
                      {isSelected && (
                        <CheckCircle2 className="h-5 w-5 text-green-500 flex-shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            )}

            {assignedSamples.length > 0 && (
              <div className="pt-4 border-t">
                <p className="text-sm text-muted-foreground mb-2">
                  Samples already assigned to other studies ({assignedSamples.length}):
                </p>
                <div className="space-y-1 max-h-[150px] overflow-y-auto">
                  {assignedSamples.map((sample) => (
                    <div
                      key={sample.id}
                      className="p-3 rounded-lg bg-muted/30 text-sm flex items-center justify-between"
                    >
                      <span className="font-medium">{sample.sampleId}</span>
                      <span className="text-muted-foreground text-xs">
                        in &quot;{sample.study?.title}&quot;
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        );

      case "metadata":
        return <SampleMetadataTableStep />;

      case "review":
        const selectedChecklist = CHECKLIST_TYPES.find(c => c.id === checklistType);

        // Check if all required fields are valid
        const allValid = isTitleValid && isChecklistValid && isSamplesValid;

        return (
          <div className="space-y-6">
            {/* Validation Summary */}
            {allValid ? (
              <div className="rounded-lg border border-green-500/30 bg-green-500/10 p-4">
                <p className="text-base font-semibold text-green-700">Ready to create your study</p>
                <p className="mt-1 text-sm text-green-600">
                  Click &quot;Create Study&quot; to save. You can continue adding metadata after creation.
                </p>
              </div>
            ) : (
              <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4">
                <p className="text-base font-semibold text-amber-700">Missing required information</p>
                <p className="mt-1 text-sm text-amber-600">
                  Please go back and complete all required fields before creating the study.
                </p>
              </div>
            )}

            {/* Compact Summary */}
            <div className="bg-card border border-border rounded-xl p-4">
              <h3 className="text-base font-semibold mb-3">Summary</h3>
              <div className="divide-y divide-border">
                {/* Title */}
                <div className="flex items-center justify-between gap-3 py-2.5">
                  <span className="text-sm text-muted-foreground">Title</span>
                  <div className="flex items-center gap-2">
                    <span className="font-medium text-sm text-right">{title || "Not specified"}</span>
                    <span
                      className={cn(
                        "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                        isTitleValid
                          ? "bg-green-500/10 text-green-700"
                          : "bg-amber-500/10 text-amber-700"
                      )}
                    >
                      {isTitleValid ? "OK" : "Missing"}
                    </span>
                  </div>
                </div>

                {/* Environment Type */}
                {formConfig?.modules.mixs && (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm text-muted-foreground">Environment</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-right">{selectedChecklist?.name || "Not selected"}</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                          isChecklistValid
                            ? "bg-green-500/10 text-green-700"
                            : "bg-amber-500/10 text-amber-700"
                        )}
                      >
                        {isChecklistValid ? "OK" : "Missing"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Samples */}
                {formConfig?.modules.sampleAssociation && (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm text-muted-foreground">Samples</span>
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm text-right">{selectedSampleIds.length} selected</span>
                      <span
                        className={cn(
                          "inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium",
                          isSamplesValid
                            ? "bg-green-500/10 text-green-700"
                            : "bg-amber-500/10 text-amber-700"
                        )}
                      >
                        {isSamplesValid ? "OK" : "Missing"}
                      </span>
                    </div>
                  </div>
                )}

                {/* Metadata fields */}
                {hasPerSampleFields && (
                  <div className="flex items-center justify-between gap-3 py-2.5">
                    <span className="text-sm text-muted-foreground">Metadata Fields</span>
                    <span className="font-medium text-sm">{allPerSampleFields.length} fields configured</span>
                  </div>
                )}
              </div>
            </div>

            {/* Next Steps Info */}
            <div className="bg-muted/30 rounded-xl p-4">
              <p className="text-sm text-muted-foreground">
                <strong>What happens next:</strong> After creating your study, you&apos;ll be taken to the study detail page where you can continue adding metadata to your samples and eventually submit to ENA.
              </p>
            </div>
          </div>
        );

      default:
        return null;
    }
  };

  // Show loading state while fetching config
  if (loadingConfig) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Warning Dialog for missing required fields */}
      <Dialog open={showWarningDialog} onOpenChange={setShowWarningDialog}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-amber-500" />
              Missing Required Information
            </DialogTitle>
            <DialogDescription>
              Some samples have missing required fields. You can still create the study and fill in this information later.
            </DialogDescription>
          </DialogHeader>
          <div className="max-h-48 overflow-y-auto">
            <ul className="text-sm space-y-1 text-muted-foreground">
              {validationWarnings.slice(0, 10).map((warning, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="text-amber-500 mt-0.5">-</span>
                  <span>{warning}</span>
                </li>
              ))}
              {validationWarnings.length > 10 && (
                <li className="text-muted-foreground italic">
                  ...and {validationWarnings.length - 10} more
                </li>
              )}
            </ul>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setShowWarningDialog(false)}>
              Go Back
            </Button>
            <Button onClick={() => handleSubmit(true)}>
              Create Anyway
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-semibold">New Study</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Step {currentStep + 1} of {STEPS.length}
          </p>
        </div>
        <Button variant="outline" size="sm" asChild>
          <Link href="/studies">Cancel</Link>
        </Button>
      </div>

      {/* Content */}
      <div>
        {/* Progress bar with integrated steps */}
        <div className="mb-6">
          <div className="relative h-10 bg-secondary rounded-xl overflow-hidden border border-border">
            {/* Progress fill */}
            <div
              className="absolute inset-y-0 left-0 bg-foreground transition-all duration-300 ease-out"
              style={{ width: `${((currentStep + 1) / STEPS.length) * 100}%` }}
            />
            {/* Step labels */}
            <div className="relative h-full flex items-center">
              {STEPS.map((step, index) => {
                const isCompleted = index < currentStep;
                const isCurrent = index === currentStep;
                const isClickable = isCompleted;
                const isInFilledArea = index <= currentStep;

                return (
                  <button
                    key={step.id}
                    type="button"
                    onClick={() => {
                      if (isClickable) {
                        setError("");
                        setCurrentStep(index);
                      }
                    }}
                    disabled={!isClickable}
                    style={{ width: `${100 / STEPS.length}%` }}
                    className={`h-full px-2 text-xs transition-all flex items-center justify-center gap-1.5 ${
                      isInFilledArea
                        ? "text-background"
                        : "text-muted-foreground"
                    } ${
                      isClickable ? "hover:bg-white/10 cursor-pointer" : ""
                    } ${
                      isCurrent ? "font-semibold" : ""
                    }`}
                    title={isClickable ? `Go back to ${step.title}` : step.title}
                  >
                    {isCompleted && <Check className="h-3 w-3 flex-shrink-0" />}
                    <span className="truncate">{step.title}</span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {error && (
          <div className="mb-6 rounded-lg border border-destructive/20 bg-destructive/10 p-4 text-destructive">
            {error}
          </div>
        )}

        {/* Main form content */}
        <div>
          {/* Step header */}
          <div className="mb-6">
            <h2 className="text-xl font-semibold">{STEPS[currentStep].title}</h2>
            <p className="text-sm text-muted-foreground">{STEPS[currentStep].description}</p>
          </div>

          {renderStepContent()}
        </div>

        {/* Navigation buttons */}
        <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === 0 || isLoading}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>

          {currentStep === STEPS.length - 1 ? (
            <Button
              onClick={() => handleSubmit()}
              disabled={isLoading}
              className={cn(
                isTitleValid && isChecklistValid && isSamplesValid
                  ? ""
                  : "bg-amber-500 hover:bg-amber-600"
              )}
            >
              {isLoading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Creating...
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Create Study
                </>
              )}
            </Button>
          ) : (
            <Button onClick={nextStep} disabled={isLoading}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
