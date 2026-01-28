"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import Link from "next/link";
import ReactMarkdown from "react-markdown";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  FlaskConical,
  X,
  Loader2,
  Check,
  AlertCircle,
  User,
  Mail,
  Building2,
  ExternalLink,
  ChevronLeft,
  ChevronRight,
  FileText,
  Settings,
  ClipboardList,
  CheckCircle2,
  ChevronDown,
  Circle,
  Leaf,
  Wallet,
  Table as TableIcon,
  Plus,
  Trash2,
} from "lucide-react";
import {
  FormFieldDefinition,
  FormFieldGroup,
  DEFAULT_FORM_SCHEMA,
  DEFAULT_GROUPS,
} from "@/types/form-config";
import { cn } from "@/lib/utils";
import { MixsFormRenderer } from "@/lib/field-types/mixs/MixsFormRenderer";
import type { MixsTemplate } from "@/lib/field-types/mixs";
import { FundingFormRenderer } from "@/lib/field-types/funding/FundingFormRenderer";
import type { FundingFieldValue } from "@/lib/field-types/funding";
import { BillingFormRenderer } from "@/lib/field-types/billing/BillingFormRenderer";
import type { BillingFieldValue } from "@/lib/field-types/billing";
import { SequencingTechFormRenderer } from "@/lib/field-types/sequencing-tech/SequencingTechFormRenderer";
import { useModule } from "@/lib/modules";
import { useFieldHelp } from "@/lib/contexts/FieldHelpContext";
import { mapPerSampleFieldToColumn } from "@/lib/sample-fields";
import { toast } from "sonner";
import { OrganismCell } from "@/lib/field-types/organism";

// Extend TanStack Table meta types for the wizard
declare module "@tanstack/react-table" {
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnIdOrUpdates: string | Record<string, unknown>, value?: unknown) => void;
    onColumnClick?: (field: FormFieldDefinition | null) => void;
    validateCell?: (field: FormFieldDefinition, value: unknown) => string | null;
    getScrollPosition?: () => number;
    restoreScrollPosition?: (scrollLeft: number) => void;
  }
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    field?: FormFieldDefinition;
    editable?: boolean;
    // Properties used in other parts of the app (samples page, studies page)
    isChecklistField?: boolean;
    isCustomField?: boolean;
    isMixsField?: boolean;
    fieldName?: string;
    options?: Array<{ value: string; label: string }>;
  }
}

// Sample row interface for the wizard
interface SampleRow {
  id: string;
  sampleId: string;
  [key: string]: unknown;
}

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

// Editable cell component for text/number/date fields
function EditableCell({
  getValue,
  row,
  column,
  table,
}: CellContext<SampleRow, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue ?? "");
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = column.columnDef.meta as { field?: FormFieldDefinition; editable?: boolean } | undefined;
  const field = meta?.field;
  const isEditable = meta?.editable !== false;

  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);

  const validate = (val: unknown): string | null => {
    if (table.options.meta?.validateCell && field) {
      return table.options.meta.validateCell(field, val);
    }
    return null;
  };

  const onBlur = () => {
    const validationError = validate(value);
    setError(validationError);
    if (value !== initialValue) {
      table.options.meta?.updateData(row.index, column.id, value);
    }
  };

  const onFocus = () => {
    if (field) {
      table.options.meta?.onColumnClick?.(field);
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
    } else if (e.key === "Escape") {
      setValue(initialValue ?? "");
      e.currentTarget.blur();
    }
  };

  const inputType = field?.type === "number" ? "number" : field?.type === "date" ? "date" : "text";

  return (
    <div className="relative">
      {field?.type === "textarea" ? (
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder={field?.placeholder}
          disabled={!isEditable}
          className={cn(
            "w-full h-full px-2 py-1.5 border-0 outline-none bg-transparent text-sm resize-none",
            "focus:bg-blue-50 focus:ring-1 focus:ring-blue-300",
            error && "bg-red-50"
          )}
        />
      ) : (
        <input
          ref={inputRef}
          type={inputType}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onBlur={onBlur}
          onFocus={onFocus}
          onKeyDown={onKeyDown}
          placeholder={field?.placeholder}
          disabled={!isEditable}
          className={cn(
            "w-full h-full px-2 py-1.5 border-0 outline-none bg-transparent text-sm",
            "focus:bg-blue-50 focus:ring-1 focus:ring-blue-300",
            error && "bg-red-50"
          )}
        />
      )}
      {error && (
        <div className="absolute -bottom-5 left-0 text-[10px] text-red-500 whitespace-nowrap">
          {error}
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
}: CellContext<SampleRow, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue ?? "");
  const meta = column.columnDef.meta as { field?: FormFieldDefinition; editable?: boolean } | undefined;
  const field = meta?.field;
  const options = field?.options || [];
  const isEditable = meta?.editable !== false;

  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);

  const handleChange = (newValue: string) => {
    if (!isEditable) return;
    setValue(newValue);
    table.options.meta?.updateData(row.index, column.id, newValue);
  };

  const onFocus = () => {
    if (field) {
      table.options.meta?.onColumnClick?.(field);
    }
  };

  // Show warning if no options available
  if (options.length === 0) {
    return (
      <div className="w-full h-full px-2 py-1.5 text-sm text-amber-600 bg-amber-50">
        No options
      </div>
    );
  }

  // Find the label for current value
  const selectedLabel = options.find((opt) => opt.value === value)?.label;

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          onClick={onFocus}
          disabled={!isEditable}
          className={cn(
            "w-full h-full px-2 py-1 text-sm text-left bg-white flex items-center justify-between",
            isEditable ? "hover:bg-blue-50 cursor-pointer" : "cursor-not-allowed opacity-70"
          )}
        >
          <span className={value ? "" : "text-muted-foreground"}>
            {selectedLabel || "Select..."}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[200px]">
        <DropdownMenuItem onClick={() => handleChange("")}>
          <span className="text-muted-foreground">Select...</span>
        </DropdownMenuItem>
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            className={value === opt.value ? "bg-accent" : ""}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function CheckboxCell({
  getValue,
  row,
  column,
  table,
}: CellContext<SampleRow, unknown>) {
  const initialValue = getValue();
  const normalizeChecked = (val: unknown) => {
    if (val === true || val === false) return val;
    if (val === "true") return true;
    if (val === "false") return false;
    return Boolean(val);
  };
  const [checked, setChecked] = useState(normalizeChecked(initialValue));
  const meta = column.columnDef.meta as { field?: FormFieldDefinition; editable?: boolean } | undefined;
  const field = meta?.field;
  const isEditable = meta?.editable !== false;

  useEffect(() => {
    setChecked(normalizeChecked(initialValue));
  }, [initialValue]);

  const onFocus = () => {
    if (field) {
      table.options.meta?.onColumnClick?.(field);
    }
  };

  const onChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!isEditable) return;
    const nextValue = e.target.checked;
    setChecked(nextValue);
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
}

function MultiSelectCell({
  getValue,
  row,
  column,
  table,
}: CellContext<SampleRow, unknown>) {
  const initialValue = getValue();
  const normalizeValues = (val: unknown): string[] => {
    if (Array.isArray(val)) return val.map((item) => String(item));
    if (val === undefined || val === null || val === "") return [];
    return [String(val)];
  };
  const [value, setValue] = useState<string[]>(normalizeValues(initialValue));
  const meta = column.columnDef.meta as { field?: FormFieldDefinition; editable?: boolean } | undefined;
  const field = meta?.field;
  const options = field?.options || [];
  const isEditable = meta?.editable !== false;

  useEffect(() => {
    setValue(normalizeValues(initialValue));
  }, [initialValue]);

  const onFocus = () => {
    if (field) {
      table.options.meta?.onColumnClick?.(field);
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    if (!isEditable) return;
    const selected = Array.from(e.target.selectedOptions).map((opt) => opt.value);
    setValue(selected);
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
}

interface UserProfile {
  firstName: string;
  lastName: string;
  email: string;
  institution: string | null;
  department: { name: string } | null;
}

interface FormSchema {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  version: number;
  enabledMixsChecklists?: string[];
}

interface Step {
  id: string;
  title: string;
  description: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface AIResult {
  valid: boolean;
  message: string;
  suggestion?: string;
  checking?: boolean;
  expanded?: boolean;
}

export default function NewOrderPage() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const { enabled: aiModuleEnabled } = useModule("ai-validation");
  const { enabled: fundingModuleEnabled } = useModule("funding-info");
  const { enabled: billingModuleEnabled } = useModule("billing-info");
  const { enabled: sequencingTechModuleEnabled } = useModule("sequencing-tech");

  // Edit mode - if edit param is present, we're editing an existing order
  const editOrderId = searchParams.get("edit");
  const isEditMode = !!editOrderId;
  const [loadingOrder, setLoadingOrder] = useState(isEditMode);

  const [currentStep, setCurrentStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [userProfile, setUserProfile] = useState<UserProfile | null>(null);
  const [loadingProfile, setLoadingProfile] = useState(true);
  const [formSchema, setFormSchema] = useState<FormSchema | null>(null);
  const [loadingSchema, setLoadingSchema] = useState(true);

  // MIxS state
  const [mixsTemplates, setMixsTemplates] = useState<MixsTemplate[]>([]);
  const [selectedMixsChecklist, setSelectedMixsChecklist] = useState<string>("");
  const [selectedMixsFields, setSelectedMixsFields] = useState<string[]>([]);

  // Unified field values state - stores all field values by field name
  const [fieldValues, setFieldValues] = useState<Record<string, unknown>>({});
  const [loadedCustomFields, setLoadedCustomFields] = useState<Record<string, unknown>>({});

  // Field validation state
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [aiResults, setAiResults] = useState<Record<string, AIResult>>({});
  const [acknowledgedAiWarnings, setAcknowledgedAiWarnings] = useState(false);

  // Currently focused field for help panel (shared via context to sidebar)
  const { focusedField, setFocusedField } = useFieldHelp();

  // Samples state for the samples step
  const [samples, setSamples] = useState<SampleRow[]>([]);
  const [samplesPrePopulated, setSamplesPrePopulated] = useState(false);

  // Submission success dialog
  const [submissionDialogOpen, setSubmissionDialogOpen] = useState(false);
  const [submissionInstructions, setSubmissionInstructions] = useState("");
  const [createdOrderId, setCreatedOrderId] = useState<string | null>(null);

  // Per-sample fields from form schema (for the samples table columns)
  const perSampleFields = (formSchema?.fields || [])
    .filter((f) => f.visible && f.perSample)
    .sort((a, b) => a.order - b.order);

  // Generate unique sample ID
  const generateSampleId = () => {
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 7).toUpperCase();
    return `S-${timestamp}-${random}`;
  };

  // Create a new sample row with default values
  const createNewSample = () => {
    const newSample: SampleRow = {
      id: `temp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      sampleId: generateSampleId(),
    };
    // Initialize per-sample field values
    for (const field of perSampleFields) {
      if (field.defaultValue !== undefined) {
        newSample[field.name] = field.defaultValue;
      } else if (field.type === "checkbox") {
        newSample[field.name] = false;
      } else if (field.type === "multiselect") {
        newSample[field.name] = [];
      } else {
        newSample[field.name] = "";
      }
    }
    return newSample;
  };

  // Add a new sample row
  const handleAddSample = () => {
    const newSample = createNewSample();
    setSamples((prev) => {
      const newSamples = [...prev, newSample];
      const expectedCount = fieldValues.numberOfSamples as number | undefined;
      if (expectedCount && newSamples.length !== expectedCount) {
        // Update the numberOfSamples field to match actual count
        setFieldValues((prevValues) => ({
          ...prevValues,
          numberOfSamples: newSamples.length,
        }));
        toast.info(`Number of samples updated to ${newSamples.length}`);
      }
      return newSamples;
    });
  };

  // Remove a sample row
  const handleRemoveSample = (id: string) => {
    setSamples((prev) => {
      const newSamples = prev.filter((s) => s.id !== id);
      const expectedCount = fieldValues.numberOfSamples as number | undefined;
      if (expectedCount && newSamples.length !== expectedCount) {
        // Update the numberOfSamples field to match actual count
        setFieldValues((prevValues) => ({
          ...prevValues,
          numberOfSamples: newSamples.length,
        }));
        toast.info(`Number of samples updated to ${newSamples.length}`);
      }
      return newSamples;
    });
  };

  // Update sample field value
  const handleSampleFieldChange = (sampleId: string, fieldName: string, value: unknown) => {
    setSamples((prev) =>
      prev.map((s) =>
        s.id === sampleId ? { ...s, [fieldName]: value } : s
      )
    );
  };

  // Auto-generate sample aliases based on index
  const handleAutoGenerateAliases = () => {
    if (samples.length === 0) return;
    setSamples((prev) =>
      prev.map((s, index) => ({
        ...s,
        sample_alias: `Sample_${index + 1}`,
        sampleAlias: `Sample_${index + 1}`,
      }))
    );
    toast.success(`Generated aliases for ${samples.length} sample${samples.length !== 1 ? "s" : ""}`);
  };

  // Copy organism (taxId + scientificName) from first row to all rows
  const handleCopyOrganismToAll = () => {
    if (samples.length < 2) return;
    const firstSample = samples[0];
    const taxId = firstSample.taxId || firstSample.tax_id || "";
    const scientificName = firstSample.scientificName || firstSample.scientific_name || "";

    if (!taxId && !scientificName) {
      toast.error("First sample has no organism set");
      return;
    }

    setSamples((prev) =>
      prev.map((s, index) => {
        if (index === 0) return s;
        return {
          ...s,
          taxId,
          tax_id: taxId,
          scientificName,
          scientific_name: scientificName,
        };
      })
    );
    toast.success(`Copied organism to ${samples.length - 1} sample${samples.length - 1 !== 1 ? "s" : ""}`);
  };

  // Copy a specific field value from first row to all rows
  const handleCopyFieldToAll = (fieldName: string, fieldLabel: string) => {
    if (samples.length < 2) return;
    const firstSample = samples[0];
    const value = firstSample[fieldName];

    if (value === undefined || value === null || value === "") {
      toast.error(`First sample has no ${fieldLabel.toLowerCase()} set`);
      return;
    }

    setSamples((prev) =>
      prev.map((s, index) => {
        if (index === 0) return s;
        return { ...s, [fieldName]: value };
      })
    );
    toast.success(`Copied ${fieldLabel.toLowerCase()} to ${samples.length - 1} sample${samples.length - 1 !== 1 ? "s" : ""}`);
  };

  const normalizeCoreSampleValue = (value: unknown) => {
    if (value === undefined || value === null) return "";
    return String(value);
  };

  const buildSamplePayload = (sample: SampleRow) => {
    const coreSampleData = {
      sampleAlias: normalizeCoreSampleValue(sample.sample_alias ?? sample.sampleAlias),
      sampleTitle: normalizeCoreSampleValue(sample.sample_title ?? sample.sampleTitle),
      sampleDescription: normalizeCoreSampleValue(sample.sample_description ?? sample.sampleDescription),
      scientificName: normalizeCoreSampleValue(sample.scientific_name ?? sample.scientificName),
      taxId: normalizeCoreSampleValue(sample.tax_id ?? sample.taxId),
    };
    const customFields: Record<string, unknown> = {};

    for (const field of perSampleFields) {
      const value = sample[field.name];
      const isEmptyValue =
        value === undefined ||
        value === null ||
        value === "" ||
        (Array.isArray(value) && value.length === 0);
      if (isEmptyValue) continue;
      const columnName = mapPerSampleFieldToColumn(field.name);
      if (columnName) {
        coreSampleData[columnName] = normalizeCoreSampleValue(value);
      } else {
        customFields[field.name] = value;
      }
    }

    return { coreSampleData, customFields };
  };

  // Fetch user profile on mount
  useEffect(() => {
    const fetchProfile = async () => {
      try {
        const res = await fetch("/api/user/profile");
        if (res.ok) {
          const data = await res.json();
          setUserProfile(data);
        }
      } catch {
        console.error("Failed to load profile");
      } finally {
        setLoadingProfile(false);
      }
    };

    fetchProfile();
  }, []);

  // Fetch form schema on mount
  useEffect(() => {
    const fetchSchema = async () => {
      try {
        const res = await fetch("/api/form-schema");
        if (res.ok) {
          const data = await res.json();
          setFormSchema(data);

          // Check if there's a MIxS field in the schema
          const mixsField = data.fields?.find((f: FormFieldDefinition) => f.type === "mixs" && f.visible);
          if (mixsField && mixsField.mixsChecklists && mixsField.mixsChecklists.length > 0) {
            const templatesRes = await fetch("/api/mixs-templates");
            if (templatesRes.ok) {
              const templatesData = await templatesRes.json();
              // Filter to only include checklists enabled in the mixs field
              const enabledTemplates = templatesData.templates?.filter((t: MixsTemplate) =>
                mixsField.mixsChecklists.includes(t.name)
              ) || [];
              setMixsTemplates(enabledTemplates);
            }
          }
        } else {
          setFormSchema({
            fields: DEFAULT_FORM_SCHEMA.fields,
            groups: DEFAULT_GROUPS,
            version: 1,
          });
        }
      } catch {
        console.error("Failed to load form schema");
        setFormSchema({
          fields: DEFAULT_FORM_SCHEMA.fields,
          groups: DEFAULT_GROUPS,
          version: 1,
        });
      } finally {
        setLoadingSchema(false);
      }
    };

    fetchSchema();
  }, []);

  // Load existing order data when in edit mode
  useEffect(() => {
    if (!isEditMode || !editOrderId || !formSchema) return;

    const fetchOrder = async () => {
      try {
        const res = await fetch(`/api/orders/${editOrderId}`);
        if (!res.ok) {
          setError("Failed to load order for editing");
          setLoadingOrder(false);
          return;
        }

        const order = await res.json();

        // Pre-fill field values from order data
        const values: Record<string, unknown> = {};

        // Core order fields
        if (order.name) values.name = order.name;
        if (order.numberOfSamples) values.numberOfSamples = order.numberOfSamples;
        if (order.platform) values.platform = order.platform;
        if (order.instrumentModel) values.instrumentModel = order.instrumentModel;
        if (order.libraryStrategy) values.libraryStrategy = order.libraryStrategy;
        if (order.librarySource) values.librarySource = order.librarySource;
        if (order.librarySelection) values.librarySelection = order.librarySelection;
        if (order.contactName) values.contactName = order.contactName;
        if (order.contactEmail) values.contactEmail = order.contactEmail;
        if (order.contactPhone) values.contactPhone = order.contactPhone;
        if (order.billingAddress) values.billingAddress = order.billingAddress;

        // Custom fields from JSON
        if (order.customFields) {
          try {
            const customData = JSON.parse(order.customFields);
            setLoadedCustomFields(customData);
            Object.entries(customData).forEach(([key, value]) => {
              // Skip internal fields
              if (!key.startsWith("_mixs")) {
                values[key] = value;
              }
              // Handle MIxS checklist selection
              if (key === "_mixsChecklist" && value) {
                setSelectedMixsChecklist(value as string);
              }
              if (key === "_mixsFields" && Array.isArray(value)) {
                setSelectedMixsFields(value as string[]);
              }
            });
          } catch {
            console.error("Failed to parse custom fields");
            setLoadedCustomFields({});
          }
        } else {
          setLoadedCustomFields({});
        }

        setFieldValues(values);

        // Pre-fill samples
        if (order.samples && order.samples.length > 0) {
          const sampleRows: SampleRow[] = order.samples.map((sample: {
            id: string;
            sampleId: string;
            sampleAlias?: string;
            sampleTitle?: string;
            sampleDescription?: string;
            scientificName?: string;
            taxId?: string;
            customFields?: string;
          }) => {
            const row: SampleRow = {
              id: sample.id,
              sampleId: sample.sampleId,
            };

            // Add core sample fields (both snake_case and camelCase for compatibility)
            if (sample.sampleAlias) {
              row.sample_alias = sample.sampleAlias;
              row.sampleAlias = sample.sampleAlias;
            }
            if (sample.sampleTitle) {
              row.sample_title = sample.sampleTitle;
              row.sampleTitle = sample.sampleTitle;
            }
            if (sample.sampleDescription) {
              row.sample_description = sample.sampleDescription;
              row.sampleDescription = sample.sampleDescription;
            }
            if (sample.scientificName) {
              row.scientific_name = sample.scientificName;
              row.scientificName = sample.scientificName;
            }
            if (sample.taxId) {
              row.tax_id = sample.taxId;
              row.taxId = sample.taxId;
            }

            // Add custom fields
            if (sample.customFields) {
              try {
                const customData = JSON.parse(sample.customFields);
                Object.entries(customData).forEach(([key, value]) => {
                  row[key] = value;
                });
              } catch {
                console.error("Failed to parse sample custom fields");
              }
            }

            return row;
          });
          setSamples(sampleRows);
        }
      } catch (err) {
        console.error("Failed to load order:", err);
        setError("Failed to load order for editing");
      } finally {
        setLoadingOrder(false);
      }
    };

    fetchOrder();
  }, [isEditMode, editOrderId, formSchema]);

  // Get visible fields sorted by order (also filter by module state)
  // Exclude perSample fields - those are collected in the samples table after order creation
  const visibleFields = (formSchema?.fields || [])
    .filter((f) => {
      if (!f.visible) return false;
      // Filter out per-sample fields - they go in the samples table
      if (f.perSample) return false;
      // Filter out funding fields if module is disabled
      if (f.type === "funding" && !fundingModuleEnabled) return false;
      // Filter out billing fields if module is disabled
      if (f.type === "billing" && !billingModuleEnabled) return false;
      // Filter out sequencing-tech fields if module is disabled
      if (f.type === "sequencing-tech" && !sequencingTechModuleEnabled) return false;
      return true;
    })
    .sort((a, b) => a.order - b.order);

  // Get groups sorted by order
  const groups = (formSchema?.groups || DEFAULT_GROUPS).sort((a, b) => a.order - b.order);

  // Check if there's a MIxS field with available templates
  const mixsFieldDef = visibleFields.find((f) => f.type === "mixs");
  const hasMixsField = mixsFieldDef && mixsTemplates.length > 0;

  // Get fields for a specific group (excluding MIxS fields which have their own step)
  const getFieldsForGroup = (groupId: string) => {
    return visibleFields.filter(
      (f) => f.groupId === groupId && f.type !== "mixs"
    );
  };

  // Map icon names to components
  const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
    FileText,
    Settings,
    ClipboardList,
    CheckCircle2,
    Leaf,
    FlaskConical,
    User,
    Mail,
    Building2,
    AlertCircle,
    Table: TableIcon,
  };

  // Get fields without a group (orphaned fields)
  const ungroupedFields = visibleFields.filter(
    (f) => !f.groupId && f.type !== "mixs"
  );

  // Build steps dynamically based on groups from the form schema
  const buildSteps = (): Step[] => {
    const steps: Step[] = [];

    // Add steps from groups that have visible fields
    for (const group of groups) {
      const groupFields = getFieldsForGroup(group.id);
      if (groupFields.length > 0) {
        steps.push({
          id: group.id,
          title: group.name,
          description: group.description || "",
          icon: iconMap[group.icon || "FileText"] || FileText,
        });
      }
    }

    // Add step for ungrouped fields (fields without a groupId)
    if (ungroupedFields.length > 0) {
      steps.push({
        id: "_ungrouped",
        title: "Additional Details",
        description: "Other order information",
        icon: ClipboardList,
      });
    }

    // MIxS metadata step (separate from other groups)
    if (hasMixsField && mixsTemplates.length > 0) {
      steps.push({
        id: "mixs",
        title: "Sample Metadata",
        description: "Select MIxS environment checklist for your samples",
        icon: Leaf,
      });
    }

    // Samples step - add samples with per-sample fields in a table
    steps.push({
      id: "samples",
      title: "Samples",
      description: "Add your samples to this order",
      icon: TableIcon,
    });

    // Always have review step
    steps.push({
      id: "review",
      title: "Review",
      description: "Review and submit your order",
      icon: CheckCircle2,
    });

    return steps;
  };

  const steps = buildSteps();

  // Handle MIxS checklist selection (just saves the selection - fields filled per sample later)
  const handleMixsChecklistChange = (checklistName: string) => {
    const newChecklist = checklistName === "none" ? "" : checklistName;
    setSelectedMixsChecklist(newChecklist);

    // Auto-select all fields when checklist changes
    if (newChecklist) {
      const template = mixsTemplates.find(t => t.name === newChecklist);
      if (template) {
        setSelectedMixsFields(template.fields.map(f => f.name));
      }
    } else {
      setSelectedMixsFields([]);
    }
  };

  // Update field value
  const setFieldValue = (fieldName: string, value: unknown) => {
    setFieldValues((prev) => ({
      ...prev,
      [fieldName]: value,
    }));
    // Clear error when user types
    if (fieldErrors[fieldName]) {
      setFieldErrors((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
    // Clear AI result when user types (they need to re-validate)
    if (aiResults[fieldName] && !aiResults[fieldName].checking) {
      setAiResults((prev) => {
        const next = { ...prev };
        delete next[fieldName];
        return next;
      });
    }
  };

  // Validate a field with simple validation rules
  const validateField = (field: FormFieldDefinition, value: unknown): string | null => {
    const sv = field.simpleValidation;
    if (!sv) return null;

    const strValue = String(value ?? "");
    if (!strValue && value !== 0) return null;

    if (sv.minLength && strValue.length < sv.minLength) {
      return `Minimum ${sv.minLength} characters required`;
    }
    if (sv.maxLength && strValue.length > sv.maxLength) {
      return `Maximum ${sv.maxLength} characters allowed`;
    }
    if (sv.minValue !== undefined && Number(value) < sv.minValue) {
      return `Minimum value is ${sv.minValue}`;
    }
    if (sv.maxValue !== undefined && Number(value) > sv.maxValue) {
      return `Maximum value is ${sv.maxValue}`;
    }
    if (sv.pattern && strValue) {
      try {
        const regex = new RegExp(sv.pattern);
        if (!regex.test(strValue)) {
          return sv.patternMessage || "Invalid format";
        }
      } catch {
        // Invalid regex, skip
      }
    }
    return null;
  };

  // Run AI validation for a field
  const runAiValidation = useCallback(async (field: FormFieldDefinition, value: unknown) => {
    // Skip if AI module is disabled or field doesn't have AI validation
    if (!aiModuleEnabled || !field.aiValidation?.enabled || !field.aiValidation?.prompt) return;

    const strValue = String(value || "");
    if (!strValue.trim()) {
      // Clear AI result if value is empty
      setAiResults((prev) => {
        const next = { ...prev };
        delete next[field.name];
        return next;
      });
      return;
    }

    setAiResults((prev) => ({
      ...prev,
      [field.name]: { valid: true, message: "Checking...", checking: true },
    }));

    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: strValue,
          fieldLabel: field.label,
          prompt: field.aiValidation.prompt,
          strictness: field.aiValidation.strictness || "moderate",
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAiResults((prev) => ({
          ...prev,
          [field.name]: {
            valid: data.valid,
            message: data.message,
            suggestion: data.suggestion,
            checking: false,
            expanded: false,
          },
        }));
      } else {
        setAiResults((prev) => ({
          ...prev,
          [field.name]: { valid: true, message: "Could not validate", checking: false },
        }));
      }
    } catch {
      setAiResults((prev) => ({
        ...prev,
        [field.name]: { valid: true, message: "Validation unavailable", checking: false },
      }));
    }
  }, [aiModuleEnabled]);

  // Toggle AI result expansion
  const toggleAiExpanded = (fieldName: string) => {
    setAiResults((prev) => ({
      ...prev,
      [fieldName]: {
        ...prev[fieldName],
        expanded: !prev[fieldName]?.expanded,
      },
    }));
  };

  // Handle field blur - run both simple and AI validation
  const handleFieldBlur = (field: FormFieldDefinition, value: unknown) => {
    // Run simple validation
    const error = validateField(field, value);
    if (error) {
      setFieldErrors((prev) => ({ ...prev, [field.name]: error }));
    }

    // Auto-run AI validation if enabled, module is enabled, and value exists
    if (aiModuleEnabled && field.aiValidation?.enabled && value && String(value).trim()) {
      runAiValidation(field, value);
    }
  };

  const isMissingRequiredValue = (field: FormFieldDefinition, value: unknown) => {
    if (field.type === "checkbox") {
      return value !== true;
    }
    if (field.type === "multiselect") {
      return !Array.isArray(value) || value.length === 0;
    }
    return (
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0)
    );
  };

  const validateBeforeSubmit = () => {
    // Order fields validation (required + simple validation)
    for (const field of visibleFields.filter((f) => f.type !== "mixs")) {
      const value = fieldValues[field.name];
      if (field.required && isMissingRequiredValue(field, value)) {
        setError(`${field.label} is required`);
        return false;
      }
      const validationError = validateField(field, value);
      if (validationError) {
        setError(`${field.label}: ${validationError}`);
        return false;
      }
    }

    // MIxS selection validation
    const mixsField = visibleFields.find((field) => field.type === "mixs");
    if (mixsField?.required && !selectedMixsChecklist) {
      setError("Select a MIxS checklist");
      return false;
    }

    if (selectedMixsChecklist) {
      if (selectedMixsFields.length === 0) {
        setError("Select at least one MIxS field to collect per sample");
        return false;
      }
      const template = mixsTemplates.find((t) => t.name === selectedMixsChecklist);
      if (template) {
        const requiredNames = template.fields
          .filter((field) => field.required)
          .map((field) => field.name);
        const missingRequired = requiredNames.filter((name) => !selectedMixsFields.includes(name));
        if (missingRequired.length > 0) {
          setError(`MIxS requires selected fields: ${missingRequired.join(", ")}`);
          return false;
        }
      }
    }

    if (samples.length === 0) {
      setError("Please add at least one sample");
      return false;
    }

    // Per-sample validation (required + simple validation)
    for (let i = 0; i < samples.length; i++) {
      const sample = samples[i];
      for (const field of perSampleFields) {
        // For organism fields, check taxId instead of the field name
        let value: unknown;
        if (field.type === "organism") {
          value = sample.taxId || sample.tax_id;
        } else {
          value = sample[field.name];
        }
        if (field.required && isMissingRequiredValue(field, value)) {
          setError(`Sample ${i + 1}: ${field.label} is required`);
          return false;
        }
        const validationError = validateSampleField(field, value);
        if (validationError) {
          setError(`Sample ${i + 1}: ${field.label} ${validationError}`);
          return false;
        }
      }
    }

    // Enforce unique sample alias if configured
    const aliasField = perSampleFields.find(
      (field) => mapPerSampleFieldToColumn(field.name) === "sampleAlias"
    );
    if (aliasField) {
      const aliases = samples
        .map((sample) => String(sample[aliasField.name] ?? "").trim())
        .filter(Boolean)
        .map((alias) => alias.toLowerCase());
      const duplicates = aliases.filter((alias, index) => aliases.indexOf(alias) !== index);
      if (duplicates.length > 0) {
        setError("Sample Alias values must be unique");
        return false;
      }
    }

    // Cross-field checks
    const hasLibraryStrategy = visibleFields.some((field) => field.name === "libraryStrategy");
    if (hasLibraryStrategy && fieldValues.libraryStrategy === "AMPLICON") {
      const hasPrimer = visibleFields.some((field) => field.name === "primer_set");
      const hasTarget = visibleFields.some((field) => field.name === "target_region");
      if (hasPrimer || hasTarget) {
        const primerValue = fieldValues.primer_set;
        const targetValue = fieldValues.target_region;
        const primerEmpty = primerValue === undefined || primerValue === null || primerValue === "";
        const targetEmpty = targetValue === undefined || targetValue === null || targetValue === "";
        if (primerEmpty && targetEmpty) {
          setError("Provide a Primer Set or Target Region for AMPLICON sequencing");
          return false;
        }
      }
    }

    const hasReadLayout = visibleFields.some((field) => field.name === "read_layout");
    if (hasReadLayout && fieldValues.read_layout === "PE") {
      const readLengthField = visibleFields.find(
        (field) => field.name === "read_length_bp" || field.name === "read_length"
      );
      if (readLengthField) {
        const readLengthValue = fieldValues[readLengthField.name];
        if (isMissingRequiredValue(readLengthField, readLengthValue)) {
          setError("Read Length is required for paired-end sequencing");
          return false;
        }
      }
    }

    setError("");
    return true;
  };

  const handleSubmit = async () => {
    setError("");
    setSaving(true);

    if (!validateBeforeSubmit()) {
      setSaving(false);
      return;
    }

    try {
      // Build the request body
      // System fields with systemKey go to their respective columns
      // Other fields go to customFields
      const systemFieldData: Record<string, unknown> = {};
      const customFieldData: Record<string, unknown> = isEditMode
        ? { ...loadedCustomFields }
        : {};

      for (const field of visibleFields) {
        const value = fieldValues[field.name];
        const isEmptyValue =
          value === undefined ||
          value === null ||
          value === "" ||
          (Array.isArray(value) && value.length === 0);

        if (field.isSystem && field.systemKey) {
          // System field - map to Order column
          systemFieldData[field.systemKey] = isEmptyValue ? null : value;
        } else {
          // Custom field
          if (isEmptyValue) {
            delete customFieldData[field.name];
          } else {
            customFieldData[field.name] = value;
          }
        }
      }

      // Add MIxS checklist and selected fields to customFields (actual values collected per sample)
      if (selectedMixsChecklist) {
        customFieldData._mixsChecklist = selectedMixsChecklist;
        customFieldData._mixsFields = selectedMixsFields;
      } else if (isEditMode) {
        delete customFieldData._mixsChecklist;
        delete customFieldData._mixsFields;
      }

      let orderId: string;

      if (isEditMode && editOrderId) {
        // Update existing order
        const res = await fetch(`/api/orders/${editOrderId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ...systemFieldData,
            customFields: Object.keys(customFieldData).length > 0 ? customFieldData : null,
          }),
        });

        if (!res.ok) {
          const data = await res.json();
          setError(data.error || "Failed to update order");
          return;
        }

        orderId = editOrderId;

        // Update samples for the order
        if (samples.length > 0) {
          const samplesToSave = samples.map((sample) => {
            const { coreSampleData, customFields } = buildSamplePayload(sample);
            return {
              id: sample.id.startsWith("temp_") ? undefined : sample.id,
              sampleId: sample.sampleId,
              sampleAlias: coreSampleData.sampleAlias,
              sampleTitle: coreSampleData.sampleTitle,
              sampleDescription: coreSampleData.sampleDescription,
              scientificName: coreSampleData.scientificName,
              taxId: coreSampleData.taxId,
              customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
              isNew: sample.id.startsWith("temp_"),
            };
          });

          const samplesRes = await fetch(`/api/orders/${orderId}/samples`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              samples: samplesToSave,
              checklist: selectedMixsChecklist || null,
            }),
          });

          if (!samplesRes.ok) {
            console.error("Failed to save samples");
          }
        }

        // Redirect to order detail page after edit
        router.push(`/dashboard/orders/${orderId}`);
        return;
      }

      // Create new order
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...systemFieldData,
          customFields: Object.keys(customFieldData).length > 0 ? customFieldData : null,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        setError(data.error || "Failed to create order");
        return;
      }

      const order = await res.json();
      orderId = order.id;

      // Create samples for the order
      if (samples.length > 0) {
        const samplesToSave = samples.map((sample) => {
          const { coreSampleData, customFields } = buildSamplePayload(sample);
          return {
            sampleId: sample.sampleId,
            sampleAlias: coreSampleData.sampleAlias,
            sampleTitle: coreSampleData.sampleTitle,
            sampleDescription: coreSampleData.sampleDescription,
            scientificName: coreSampleData.scientificName,
            taxId: coreSampleData.taxId,
            customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
            isNew: true,
          };
        });

        const samplesRes = await fetch(`/api/orders/${orderId}/samples`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            samples: samplesToSave,
            checklist: selectedMixsChecklist || null,
          }),
        });

        if (!samplesRes.ok) {
          // Order was created but samples failed - go to order detail anyway
          console.error("Failed to save samples");
        }
      }

      // Fetch post-submission instructions
      try {
        const instructionsRes = await fetch("/api/settings/instructions");
        if (instructionsRes.ok) {
          const { instructions } = await instructionsRes.json();
          setSubmissionInstructions(instructions);
        }
      } catch {
        // Use default if fetch fails
        setSubmissionInstructions("Your order has been submitted successfully. Please prepare and ship your samples according to the facility guidelines.");
      }

      // Show success dialog instead of redirecting
      setCreatedOrderId(order.id);
      setSubmissionDialogOpen(true);
    } catch {
      setError("Failed to create order");
    } finally {
      setSaving(false);
    }
  };

  const validateStep = (stepId: string): boolean => {
    // MIxS step - no required validation (checklist selection is optional)
    if (stepId === "mixs") {
      if (mixsFieldDef?.required && !selectedMixsChecklist) {
        setError("Select a MIxS checklist");
        return false;
      }

      if (selectedMixsChecklist && selectedMixsFields.length === 0) {
        setError("Select at least one MIxS field to collect per sample");
        return false;
      }

      if (selectedMixsChecklist) {
        const template = mixsTemplates.find((t) => t.name === selectedMixsChecklist);
        if (template) {
          const requiredNames = template.fields
            .filter((field) => field.required)
            .map((field) => field.name);
          const missingRequired = requiredNames.filter((name) => !selectedMixsFields.includes(name));
          if (missingRequired.length > 0) {
            setError(`MIxS requires selected fields: ${missingRequired.join(", ")}`);
            return false;
          }
        }
      }

      setError("");
      return true;
    }

    // Samples step - require at least one sample and validate required per-sample fields
    if (stepId === "samples") {
      if (samples.length === 0) {
        setError("Please add at least one sample");
        return false;
      }

      // Validate required per-sample fields
      for (let i = 0; i < samples.length; i++) {
        const sample = samples[i];
        for (const field of perSampleFields) {
          if (field.required) {
            // For organism fields, check taxId instead of the field name
            let value: unknown;
            if (field.type === "organism") {
              // Check all possible property names for taxId
              value = (sample as Record<string, unknown>)["taxId"]
                   || (sample as Record<string, unknown>)["tax_id"]
                   || (sample as Record<string, unknown>)["scientificName"]
                   || (sample as Record<string, unknown>)["scientific_name"];
            } else {
              value = sample[field.name];
            }
            if (isMissingRequiredValue(field, value)) {
              setError(`Sample ${i + 1}: ${field.label} is required`);
              return false;
            }
          }
        }
      }

      const aliasField = perSampleFields.find(
        (field) => mapPerSampleFieldToColumn(field.name) === "sampleAlias"
      );
      if (aliasField) {
        const aliases = samples
          .map((sample) => String(sample[aliasField.name] ?? "").trim())
          .filter(Boolean)
          .map((alias) => alias.toLowerCase());
        const duplicates = aliases.filter((alias, index) => aliases.indexOf(alias) !== index);
        if (duplicates.length > 0) {
          setError("Sample Alias values must be unique");
          return false;
        }
      }
      setError("");
      return true;
    }

    // Review step - no validation needed
    if (stepId === "review") {
      setError("");
      return true;
    }

    // Ungrouped fields step
    if (stepId === "_ungrouped") {
      for (const field of ungroupedFields) {
        if (field.required) {
          const value = fieldValues[field.name];
          if (isMissingRequiredValue(field, value)) {
            setError(`${field.label} is required`);
            return false;
          }
        }
      }
      setError("");
      return true;
    }

    // For group steps, validate fields in that group
    const fieldsToValidate = getFieldsForGroup(stepId);

    for (const field of fieldsToValidate) {
      if (field.required) {
        const value = fieldValues[field.name];
        if (isMissingRequiredValue(field, value)) {
          setError(`${field.label} is required`);
          return false;
        }
      }
    }

    setError("");
    return true;
  };

  const nextStep = () => {
    if (validateStep(steps[currentStep].id)) {
      if (currentStep < steps.length - 1) {
        const nextStepId = steps[currentStep + 1].id;

        // Pre-populate samples when entering the samples step
        if (nextStepId === "samples" && !samplesPrePopulated && !isEditMode) {
          const numberOfSamples = fieldValues.numberOfSamples as number | undefined;
          if (numberOfSamples && numberOfSamples > 0 && samples.length === 0) {
            const newSamples: SampleRow[] = [];
            for (let i = 0; i < numberOfSamples; i++) {
              newSamples.push(createNewSample());
            }
            setSamples(newSamples);
            toast.success(`Pre-filled ${numberOfSamples} empty sample row${numberOfSamples > 1 ? "s" : ""}`);
          }
          setSamplesPrePopulated(true);
        }

        setCurrentStep(currentStep + 1);
      }
    }
  };

  const prevStep = () => {
    if (currentStep > 0) {
      setError("");
      setAcknowledgedAiWarnings(false); // Reset when going back to edit
      setCurrentStep(currentStep - 1);
    }
  };

  // Get border class based on validation state
  const getBorderClass = (field: FormFieldDefinition) => {
    const aiResult = aiResults[field.name];
    const hasError = fieldErrors[field.name];

    if (hasError) return "border-destructive focus:ring-destructive/30";
    if (aiResult && !aiResult.checking) {
      if (aiResult.valid) return "border-green-500 focus:ring-green-500/30";
      return "border-amber-500 focus:ring-amber-500/30";
    }
    return "border-input";
  };

  // AI Indicator component - shows inside the input field
  const AIIndicator = ({ field }: { field: FormFieldDefinition }) => {
    const aiResult = aiResults[field.name];
    const hasAI = aiModuleEnabled && field.aiValidation?.enabled;

    if (!hasAI) return null;

    // If checking - show pulsing dot
    if (aiResult?.checking) {
      return (
        <div className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none">
          <div className="h-3 w-3 rounded-full bg-violet-500 animate-pulse" />
        </div>
      );
    }

    // If has result - show colored icon that can be clicked
    if (aiResult && !aiResult.checking) {
      return (
        <button
          type="button"
          onClick={() => toggleAiExpanded(field.name)}
          className={`absolute right-3 top-1/2 -translate-y-1/2 p-1 rounded-full transition-all hover:scale-110 ${
            aiResult.valid
              ? "text-green-500 hover:bg-green-500/10"
              : "text-amber-500 hover:bg-amber-500/10"
          }`}
          title={aiResult.valid ? "Valid - Click for details" : "Issue found - Click for details"}
        >
          {aiResult.valid ? (
            <CheckCircle2 className="h-4 w-4" />
          ) : (
            <AlertCircle className="h-4 w-4" />
          )}
        </button>
      );
    }

    // If AI enabled but no result yet - show subtle dot
    return (
      <div
        className="absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none"
        title="AI validation enabled"
      >
        <div className="h-2 w-2 rounded-full bg-violet-400 opacity-40" />
      </div>
    );
  };

  // AI Result message component
  const AIResultMessage = ({ field }: { field: FormFieldDefinition }) => {
    const aiResult = aiResults[field.name];

    if (!aiResult || aiResult.checking) return null;

    return (
      <div
        className={`overflow-hidden transition-all duration-200 ${
          aiResult.expanded ? "max-h-40" : "max-h-0"
        }`}
      >
        <div className={`mt-2 p-3 rounded-lg text-sm ${
          aiResult.valid
            ? "bg-green-500/10 border border-green-500/20 text-green-700 dark:text-green-400"
            : "bg-amber-500/10 border border-amber-500/20 text-amber-700 dark:text-amber-400"
        }`}>
          <div className="flex items-start gap-2">
            {aiResult.valid ? (
              <CheckCircle2 className="h-4 w-4 mt-0.5 flex-shrink-0" />
            ) : (
              <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            )}
            <div className="flex-1 min-w-0">
              <p className="font-medium">{aiResult.valid ? "Looks good!" : "Potential issue"}</p>
              <p className="text-xs opacity-80 mt-0.5">{aiResult.message}</p>
              {aiResult.suggestion && (
                <p className="text-xs mt-1 italic">Suggestion: {aiResult.suggestion}</p>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  };

  // Quick AI status bar below field (always visible when result exists)
  const AIStatusBar = ({ field }: { field: FormFieldDefinition }) => {
    const aiResult = aiResults[field.name];

    if (!aiResult) return null;
    if (aiResult.checking) {
      return (
        <div className="flex items-center gap-2 mt-1.5 text-xs text-violet-600">
          <Loader2 className="h-3 w-3 animate-spin" />
          <span>AI is checking...</span>
        </div>
      );
    }

    return (
      <button
        type="button"
        onClick={() => toggleAiExpanded(field.name)}
        className={`flex items-center gap-1.5 mt-1.5 text-xs transition-colors ${
          aiResult.valid
            ? "text-green-600 hover:text-green-700"
            : "text-amber-600 hover:text-amber-700"
        }`}
      >
        {aiResult.valid ? (
          <CheckCircle2 className="h-3 w-3" />
        ) : (
          <AlertCircle className="h-3 w-3" />
        )}
        <span>{aiResult.valid ? "AI verified" : "AI found an issue"}</span>
        <ChevronDown className={`h-3 w-3 transition-transform ${aiResult.expanded ? "rotate-180" : ""}`} />
      </button>
    );
  };

  // Render a field based on its definition
  const renderField = (field: FormFieldDefinition, largeStyle: boolean = false) => {
    const value = fieldValues[field.name] ?? "";
    const baseInputClass = largeStyle ? "text-base h-12" : "";
    const hasAI = aiModuleEnabled && field.aiValidation?.enabled;

    switch (field.type) {
      case "text":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id} className={largeStyle ? "text-base" : ""}>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
              {hasAI && (
                <span className="ml-2 text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 font-medium">
                  AI
                </span>
              )}
            </Label>
            <div className="relative">
              <Input
                id={field.id}
                value={value as string}
                onChange={(e) => setFieldValue(field.name, e.target.value)}
                onFocus={() => setFocusedField(field)}
                onBlur={() => handleFieldBlur(field, value)}
                placeholder={field.placeholder}
                required={field.required}
                disabled={saving}
                className={`${baseInputClass} ${getBorderClass(field)} ${hasAI ? "pr-10" : ""} transition-colors`}
              />
              <AIIndicator field={field} />
            </div>
            {fieldErrors[field.name] && (
              <p className="text-sm text-destructive">{fieldErrors[field.name]}</p>
            )}
            <AIStatusBar field={field} />
            <AIResultMessage field={field} />
          </div>
        );

      case "textarea":
        return (
          <div key={field.id} className="space-y-2">
            <div className="flex items-center justify-between">
              <Label htmlFor={field.id}>
                {field.label}
                {field.required && <span className="text-destructive ml-1">*</span>}
                {hasAI && (
                  <span className="ml-2 text-xs text-violet-500 font-normal inline-flex items-center gap-1">
                    <Circle className="h-2 w-2 fill-current" />
                    AI
                  </span>
                )}
              </Label>
            </div>
            <div className="relative">
              <textarea
                id={field.id}
                value={value as string}
                onChange={(e) => setFieldValue(field.name, e.target.value)}
                onFocus={() => setFocusedField(field)}
                onBlur={() => handleFieldBlur(field, value)}
                placeholder={field.placeholder}
                required={field.required}
                disabled={saving}
                className={`w-full min-h-[120px] px-3 py-2 rounded-md border bg-background text-sm resize-none focus:outline-none focus:ring-2 transition-colors ${
                  hasAI ? "pr-10" : ""
                } ${getBorderClass(field)}`}
              />
              {hasAI && (
                <div className="absolute right-3 top-3">
                  {aiResults[field.name]?.checking ? (
                    <div className="h-3 w-3 rounded-full bg-violet-500 animate-pulse" />
                  ) : aiResults[field.name] ? (
                    <button
                      type="button"
                      onClick={() => toggleAiExpanded(field.name)}
                      className={`p-1 rounded-full transition-all hover:scale-110 ${
                        aiResults[field.name].valid
                          ? "text-green-500 hover:bg-green-500/10"
                          : "text-amber-500 hover:bg-amber-500/10"
                      }`}
                    >
                      {aiResults[field.name].valid ? (
                        <CheckCircle2 className="h-4 w-4" />
                      ) : (
                        <AlertCircle className="h-4 w-4" />
                      )}
                    </button>
                  ) : (
                    <div className="h-2 w-2 rounded-full bg-violet-400 opacity-40" />
                  )}
                </div>
              )}
            </div>
            {fieldErrors[field.name] && (
              <p className="text-sm text-destructive">{fieldErrors[field.name]}</p>
            )}
            <AIStatusBar field={field} />
            <AIResultMessage field={field} />
          </div>
        );

      case "number":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id}>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id={field.id}
              type="number"
              value={value as string}
              onChange={(e) => setFieldValue(field.name, e.target.value)}
              onFocus={() => setFocusedField(field)}
              onBlur={() => handleFieldBlur(field, value)}
              placeholder={field.placeholder}
              required={field.required}
              disabled={saving}
              className={`max-w-xs ${fieldErrors[field.name] ? "border-destructive" : ""}`}
            />
            {fieldErrors[field.name] && (
              <p className="text-sm text-destructive">{fieldErrors[field.name]}</p>
            )}
          </div>
        );

      case "date":
        return (
          <div key={field.id} className="space-y-2">
            <Label htmlFor={field.id}>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Input
              id={field.id}
              type="date"
              value={value as string}
              onChange={(e) => setFieldValue(field.name, e.target.value)}
              onFocus={() => setFocusedField(field)}
              required={field.required}
              disabled={saving}
              className="max-w-xs"
            />
          </div>
        );

      case "checkbox":
        return (
          <div key={field.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              id={field.id}
              checked={value as boolean}
              onChange={(e) => setFieldValue(field.name, e.target.checked)}
              onFocus={() => setFocusedField(field)}
              disabled={saving}
              className="mt-1 h-4 w-4 rounded border-input"
            />
            <div>
              <Label htmlFor={field.id} className="font-medium">{field.label}</Label>
            </div>
          </div>
        );

      case "select":
        return (
          <div key={field.id} className="space-y-2" onFocus={() => setFocusedField(field)}>
            <Label htmlFor={field.id} className={largeStyle ? "text-base" : ""}>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <Select
              value={value as string}
              onValueChange={(v) => setFieldValue(field.name, v)}
              disabled={saving}
              onOpenChange={(open) => { if (open) setFocusedField(field); }}
            >
              <SelectTrigger className={largeStyle ? "max-w-md h-12" : "max-w-md"}>
                <SelectValue placeholder={field.placeholder || `Select ${field.label.toLowerCase()}`} />
              </SelectTrigger>
              <SelectContent>
                {field.options?.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        );

      case "multiselect":
        return (
          <div key={field.id} className="space-y-2" onFocus={() => setFocusedField(field)}>
            <Label>
              {field.label}
              {field.required && <span className="text-destructive ml-1">*</span>}
            </Label>
            <div className="space-y-2 p-4 rounded-lg border border-input bg-background/50 max-w-md">
              {field.options?.map((opt) => {
                const selected = Array.isArray(value) ? value.includes(opt.value) : false;
                return (
                  <div key={opt.value} className="flex items-center gap-3">
                    <input
                      type="checkbox"
                      id={`${field.id}-${opt.value}`}
                      checked={selected}
                      onChange={(e) => {
                        const currentValues = Array.isArray(value) ? value : [];
                        if (e.target.checked) {
                          setFieldValue(field.name, [...currentValues, opt.value]);
                        } else {
                          setFieldValue(
                            field.name,
                            currentValues.filter((v) => v !== opt.value)
                          );
                        }
                      }}
                      onFocus={() => setFocusedField(field)}
                      disabled={saving}
                      className="h-4 w-4 rounded border-input"
                    />
                    <Label htmlFor={`${field.id}-${opt.value}`} className="font-normal cursor-pointer">
                      {opt.label}
                    </Label>
                  </div>
                );
              })}
            </div>
          </div>
        );

      case "funding":
        return (
          <FundingFormRenderer
            key={field.id}
            field={field}
            value={value as FundingFieldValue | null}
            disabled={saving}
            onChange={(newValue) => setFieldValue(field.name, newValue)}
          />
        );

      case "billing":
        return (
          <BillingFormRenderer
            key={field.id}
            field={field}
            value={value as BillingFieldValue | null}
            disabled={saving}
            onChange={(newValue) => setFieldValue(field.name, newValue)}
          />
        );

      case "sequencing-tech":
        return (
          <SequencingTechFormRenderer
            key={field.id}
            field={field}
            value={value as string | undefined}
            disabled={saving}
            onChange={(newValue) => setFieldValue(field.name, newValue)}
          />
        );

      default:
        return null;
    }
  };

  // Get display value for review - handles option labels
  const getDisplayValue = (field: FormFieldDefinition, value: unknown): string => {
    if (value === undefined || value === null || value === "") return "Not specified";

    if (field.type === "select" && field.options) {
      const option = field.options.find((o) => o.value === value);
      return option?.label || String(value);
    }

    if (field.type === "multiselect" && Array.isArray(value) && field.options) {
      return value
        .map((v) => field.options?.find((o) => o.value === v)?.label || v)
        .join(", ");
    }

    if (typeof value === "boolean") {
      return value ? "Yes" : "No";
    }

    // Handle funding field type
    if (field.type === "funding") {
      const fundingValue = value as FundingFieldValue | null;
      if (!fundingValue?.entries || fundingValue.entries.length === 0) {
        return "No funding sources";
      }
      return fundingValue.entries
        .map((entry) => {
          const agencyName = entry.agencyId === "other"
            ? (entry.agencyOther || "Other")
            : entry.agencyId.toUpperCase();
          return `${agencyName}: ${entry.grantNumber}${entry.isPrimary ? " (Primary)" : ""}`;
        })
        .join("; ");
    }

    // Handle billing field type
    if (field.type === "billing") {
      const billingValue = value as BillingFieldValue | null;
      if (!billingValue) return "Not specified";
      const parts: string[] = [];
      if (billingValue.costCenter) {
        parts.push(`Cost Center: ${billingValue.costCenter}`);
      }
      if (billingValue.pspElement) {
        parts.push(`PSP: ${billingValue.pspElement}`);
      }
      return parts.length > 0 ? parts.join(", ") : "Not specified";
    }

    // Handle sequencing-tech field type
    if (field.type === "sequencing-tech") {
      // Value is the technology ID
      if (!value || typeof value !== "string") return "Not selected";
      // Return the ID for now - could be enhanced to show name if needed
      return value;
    }

    return String(value);
  };

  // Check if this is the first group step (show contact info)
  const isFirstGroupStep = (stepId: string) => {
    const groupSteps = steps.filter(s => s.id !== "mixs" && s.id !== "review");
    return groupSteps.length > 0 && groupSteps[0].id === stepId;
  };

  // Validation function for per-sample fields
  const validateSampleField = useCallback((field: FormFieldDefinition, value: unknown): string | null => {
    const sv = field.simpleValidation;
    const isEmptyValue =
      value === undefined ||
      value === null ||
      value === "" ||
      (Array.isArray(value) && value.length === 0);

    if (field.type === "checkbox") {
      if (field.required && value !== true) return "Required";
      return null;
    }

    if (field.required && isEmptyValue) {
      return "Required";
    }

    const strValue = String(value ?? "");
    if (!sv || !strValue) return null;

    if (sv.minLength && strValue.length < sv.minLength) {
      return `Min ${sv.minLength} chars`;
    }
    if (sv.maxLength && strValue.length > sv.maxLength) {
      return `Max ${sv.maxLength} chars`;
    }
    if (sv.minValue !== undefined && Number(value) < sv.minValue) {
      return `Min ${sv.minValue}`;
    }
    if (sv.maxValue !== undefined && Number(value) > sv.maxValue) {
      return `Max ${sv.maxValue}`;
    }
    if (sv.pattern && strValue) {
      try {
        const regex = new RegExp(sv.pattern);
        if (!regex.test(strValue)) {
          return sv.patternMessage || "Invalid format";
        }
      } catch {
        // Invalid regex, skip
      }
    }
    return null;
  }, []);

  // Build columns for TanStack Table
  const sampleTableColumns = useMemo((): ColumnDef<SampleRow>[] => {
    const cols: ColumnDef<SampleRow>[] = [
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
    for (const field of perSampleFields) {
      // Determine cell component based on field type
      const cellComponent =
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
      const columnSize =
        field.type === "organism" ? 280
        : field.type === "textarea" ? 240
        : field.type === "date" ? 160
        : field.type === "select" ? 180
        : 180;

      const col: ColumnDef<SampleRow> = {
        id: field.name,
        accessorFn: (row) => row[field.name] ?? "",
        header: () => (
          <button
            type="button"
            onClick={() => setFocusedField(field)}
            className={cn(
              "flex items-center gap-1 text-left w-full transition-colors",
              focusedField?.id === field.id && "text-primary"
            )}
          >
            {field.label}
            {field.required && <span className="text-destructive">*</span>}
          </button>
        ),
        size: columnSize,
        cell: cellComponent,
        meta: {
          field,
          editable: !saving,
        },
      };
      cols.push(col);
    }

    // Delete column
    cols.push({
      id: "delete",
      header: "",
      size: 50,
      cell: ({ row }) => (
        <button
          type="button"
          onClick={() => handleRemoveSample(row.original.id)}
          disabled={saving}
          className="w-full h-full flex items-center justify-center text-muted-foreground hover:text-destructive transition-colors disabled:opacity-50"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      ),
    });

    return cols;
  }, [perSampleFields, focusedField, saving]);

  // Update sample data from table
  // Supports both single field update: updateSampleData(rowIndex, columnId, value)
  // And multi-field update: updateSampleData(rowIndex, { field1: value1, field2: value2 })
  const updateSampleData = useCallback((rowIndex: number, columnIdOrUpdates: string | Record<string, unknown>, value?: unknown) => {
    setSamples((old) => {
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
  }, []);

  // TanStack Table instance
  const sampleTable = useReactTable({
    data: samples,
    columns: sampleTableColumns,
    getCoreRowModel: getCoreRowModel(),
    meta: {
      updateData: updateSampleData,
      onColumnClick: (field) => setFocusedField(field),
      validateCell: validateSampleField,
    },
  });

  // Check if any field is an organism field
  const hasOrganismField = perSampleFields.some(f => f.type === "organism");
  // Check if any field is a sample alias field
  const hasSampleAliasField = perSampleFields.some(f =>
    f.name === "_sampleAlias" || f.name === "sample_alias" || f.name === "sampleAlias"
  );

  // Samples Table Step Component
  const SamplesTableStep = () => {
    return (
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-muted-foreground">
              Add your samples below. Use <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Tab</kbd>,{" "}
              <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">Enter</kbd>, or arrow keys to navigate.
              {perSampleFields.length > 0 && (
                <span> Click column headers for field help.</span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* Quick Actions Dropdown */}
            {samples.length > 0 && (hasSampleAliasField || hasOrganismField) && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={saving}>
                    <ChevronDown className="h-4 w-4 mr-1" />
                    Quick Actions
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  {hasSampleAliasField && (
                    <DropdownMenuItem onClick={handleAutoGenerateAliases}>
                      Auto-generate sample aliases
                    </DropdownMenuItem>
                  )}
                  {hasOrganismField && samples.length > 1 && (
                    <DropdownMenuItem onClick={handleCopyOrganismToAll}>
                      Copy organism to all samples
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            <Button onClick={handleAddSample} size="sm" disabled={saving}>
              <Plus className="h-4 w-4 mr-1" />
              Add Sample
            </Button>
          </div>
        </div>

        <div className="border rounded-lg">
          <div className="overflow-x-auto overflow-y-visible">
            <table className="w-full text-sm border-collapse">
              <thead className="bg-muted/50">
                {sampleTable.getHeaderGroups().map((headerGroup) => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map((header) => (
                      <th
                        key={header.id}
                        style={{ width: header.getSize() }}
                        className="px-2 py-2 text-left font-medium border-b border-r last:border-r-0"
                      >
                        {header.isPlaceholder
                          ? null
                          : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {sampleTable.getRowModel().rows.length === 0 ? (
                  <tr>
                    <td
                      colSpan={sampleTableColumns.length}
                      className="px-4 py-8 text-center text-muted-foreground border-b"
                    >
                      <div className="flex flex-col items-center gap-2">
                        <TableIcon className="h-8 w-8 text-muted-foreground/30" />
                        <span>No samples yet. Click &quot;Add Row&quot; to add your first sample.</span>
                      </div>
                    </td>
                  </tr>
                ) : (
                  sampleTable.getRowModel().rows.map((row) => (
                    <tr key={row.id} className="hover:bg-muted/30">
                      {row.getVisibleCells().map((cell) => (
                        <td
                          key={cell.id}
                          style={{ width: cell.column.getSize() }}
                          className="border-b border-r last:border-r-0 p-0"
                        >
                          {flexRender(cell.column.columnDef.cell, cell.getContext())}
                        </td>
                      ))}
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
          <div className="bg-muted/30 px-3 py-2 border-t flex items-center justify-between">
            <Button variant="ghost" size="sm" onClick={handleAddSample} disabled={saving}>
              <Plus className="h-4 w-4 mr-1" />
              Add Row
            </Button>
            <span className="text-xs text-muted-foreground">
              {samples.length} sample{samples.length !== 1 ? "s" : ""}
              {perSampleFields.length > 0 && ` • ${perSampleFields.length} field${perSampleFields.length !== 1 ? "s" : ""}`}
            </span>
          </div>
        </div>

        {perSampleFields.length === 0 && samples.length > 0 && (
          <p className="text-sm text-muted-foreground">
            No per-sample fields configured. Samples will be created with just their IDs.
          </p>
        )}
      </div>
    );
  };

  // Render step content
  const renderStepContent = () => {
    const stepId = steps[currentStep].id;

    // MIxS step
    if (stepId === "mixs") {
      const mixsField = visibleFields.find(f => f.type === "mixs");
      if (!mixsField) return null;
      return (
        <MixsFormRenderer
          field={mixsField}
          templates={mixsTemplates as MixsTemplate[]}
          selectedChecklist={selectedMixsChecklist}
          selectedFields={selectedMixsFields}
          disabled={saving}
          onChecklistChange={handleMixsChecklistChange}
          onFieldSelectionChange={setSelectedMixsFields}
          selectorOnly={true}
        />
      );
    }

    // Samples step - TanStack Table for entering sample data
    if (stepId === "samples") {
      return <SamplesTableStep />;
    }

    // Review step
    if (stepId === "review") {
        // Get fields without MIxS for review
        const fieldsForReview = visibleFields.filter(f => f.type !== "mixs");

        // Count AI issues
        const aiIssues = Object.entries(aiResults).filter(
          ([, result]) => result && !result.checking && !result.valid
        );

        // Review row component for better display
        const ReviewRow = ({
          field,
          value
        }: {
          field: FormFieldDefinition;
          value: unknown;
        }) => {
          const aiResult = aiResults[field.name];
          const displayValue = getDisplayValue(field, value);
          const hasIssue = aiResult && !aiResult.checking && !aiResult.valid;

          return (
            <div className={`py-4 ${hasIssue ? "bg-amber-500/5 -mx-6 px-6" : ""}`}>
              <div className="flex items-start justify-between gap-4">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-muted-foreground mb-1">{field.label}</p>
                  <p className="text-base font-medium break-words">{displayValue}</p>
                </div>
                {aiResult && !aiResult.checking && (
                  <div className="flex-shrink-0 mt-5">
                    {aiResult.valid ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <div className="group relative">
                        <AlertCircle className="h-5 w-5 text-amber-500 cursor-help" />
                        <div className="absolute right-0 bottom-full mb-2 hidden group-hover:block w-72 p-3 bg-popover border border-border rounded-lg shadow-lg text-sm z-10">
                          <p className="font-medium text-amber-600 mb-1">Potential Issue</p>
                          <p className="text-foreground">{aiResult.message}</p>
                          {aiResult.suggestion && (
                            <p className="text-muted-foreground mt-2 text-xs italic">
                              Suggestion: {aiResult.suggestion}
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              {hasIssue && (
                <div className="mt-2 p-2 rounded bg-amber-500/10 border border-amber-500/20">
                  <p className="text-sm text-amber-700">{aiResult?.message}</p>
                  {aiResult?.suggestion && (
                    <p className="text-xs text-amber-600 mt-1 italic">
                      Suggestion: {aiResult.suggestion}
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        };

        return (
          <div className="space-y-8">
            {/* AI Validation Summary */}
            {aiIssues.length > 0 && (
              <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-5">
                <div className="flex items-start gap-4">
                  <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                      {aiIssues.length} field{aiIssues.length > 1 ? "s" : ""} may need attention
                    </p>
                    <p className="text-amber-600 dark:text-amber-500 mt-1">
                      AI validation flagged potential issues. Review the highlighted fields below,
                      or proceed if you believe the values are correct.
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Contact Information Section */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="bg-muted/50 px-6 py-4 border-b border-border">
                <h3 className="text-lg font-semibold flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <User className="h-4 w-4 text-primary" />
                  </div>
                  Contact Information
                </h3>
              </div>
              <div className="p-6">
                <div className="grid sm:grid-cols-2 gap-6">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Full Name</p>
                    <p className="text-lg font-medium">
                      {userProfile?.firstName} {userProfile?.lastName}
                    </p>
                  </div>
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Email</p>
                    <p className="text-lg font-medium break-all">
                      {userProfile?.email || session?.user?.email}
                    </p>
                  </div>
                  {(userProfile?.institution || userProfile?.department) && (
                    <div className="sm:col-span-2">
                      <p className="text-sm text-muted-foreground mb-1">Institution / Department</p>
                      <p className="text-lg font-medium">
                        {[userProfile?.department?.name, userProfile?.institution]
                          .filter(Boolean)
                          .join(" - ")}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            </div>

            {/* Fields organized by groups */}
            {groups.map((group) => {
              const groupFields = fieldsForReview.filter(f => f.groupId === group.id);
              const filledFields = groupFields.filter(f => {
                const v = fieldValues[f.name];
                return v !== undefined && v !== "" && v !== null;
              });
              if (filledFields.length === 0) return null;

              const GroupIcon = iconMap[group.icon || "FileText"] || FileText;
              return (
                <div key={group.id} className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/50 px-6 py-4 border-b border-border">
                    <h3 className="text-lg font-semibold flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <GroupIcon className="h-4 w-4 text-primary" />
                      </div>
                      {group.name}
                    </h3>
                  </div>
                  <div className="px-6 divide-y divide-border">
                    {filledFields.map((field) => {
                      const value = fieldValues[field.name];
                      return <ReviewRow key={field.id} field={field} value={value} />;
                    })}
                  </div>
                </div>
              );
            })}

            {/* Ungrouped fields section */}
            {(() => {
              const filledUngrouped = ungroupedFields.filter(f => {
                const v = fieldValues[f.name];
                return v !== undefined && v !== "" && v !== null;
              });
              if (filledUngrouped.length === 0) return null;
              return (
                <div className="bg-card border border-border rounded-xl overflow-hidden">
                  <div className="bg-muted/50 px-6 py-4 border-b border-border">
                    <h3 className="text-lg font-semibold flex items-center gap-3">
                      <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                        <ClipboardList className="h-4 w-4 text-primary" />
                      </div>
                      Additional Details
                    </h3>
                  </div>
                  <div className="px-6 divide-y divide-border">
                    {filledUngrouped.map((field) => {
                      const value = fieldValues[field.name];
                      return <ReviewRow key={field.id} field={field} value={value} />;
                    })}
                  </div>
                </div>
              );
            })()}

            {/* MIxS Metadata Section */}
            {selectedMixsChecklist && (
              <div className="bg-card border border-emerald-500/30 rounded-xl overflow-hidden">
                <div className="bg-emerald-500/5 px-6 py-4 border-b border-emerald-500/20">
                  <h3 className="text-lg font-semibold flex items-center gap-3">
                    <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center">
                      <Leaf className="h-4 w-4 text-emerald-600" />
                    </div>
                    <span>MIxS Metadata</span>
                  </h3>
                </div>
                <div className="p-6">
                  <div className="grid sm:grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Environment Type</p>
                      <p className="text-lg font-medium">{selectedMixsChecklist}</p>
                    </div>
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Fields to Collect</p>
                      <p className="text-lg font-medium">{selectedMixsFields.length} fields per sample</p>
                    </div>
                  </div>
                  <p className="text-sm text-emerald-600 mt-3">
                    These metadata fields will be collected when adding samples to this order.
                  </p>
                </div>
              </div>
            )}

            {/* Samples Section */}
            <div className="bg-card border border-border rounded-xl overflow-hidden">
              <div className="bg-muted/50 px-6 py-4 border-b border-border">
                <h3 className="text-lg font-semibold flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
                    <TableIcon className="h-4 w-4 text-primary" />
                  </div>
                  Samples
                </h3>
              </div>
              <div className="p-6">
                <div className="grid sm:grid-cols-2 gap-4 mb-4">
                  <div>
                    <p className="text-sm text-muted-foreground mb-1">Total Samples</p>
                    <p className="text-lg font-medium">{samples.length}</p>
                  </div>
                  {perSampleFields.length > 0 && (
                    <div>
                      <p className="text-sm text-muted-foreground mb-1">Per-Sample Fields</p>
                      <p className="text-lg font-medium">{perSampleFields.length} fields</p>
                    </div>
                  )}
                </div>
                {samples.length > 0 && (
                  <div className="border rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-muted/50 border-b">
                        <tr>
                          <th className="px-3 py-2 text-left font-medium text-muted-foreground">#</th>
                          <th className="px-3 py-2 text-left font-medium">Sample ID</th>
                          {perSampleFields.slice(0, 3).map((field) => (
                            <th key={field.id} className="px-3 py-2 text-left font-medium">
                              {field.label}
                            </th>
                          ))}
                          {perSampleFields.length > 3 && (
                            <th className="px-3 py-2 text-left font-medium text-muted-foreground">
                              +{perSampleFields.length - 3} more
                            </th>
                          )}
                        </tr>
                      </thead>
                      <tbody className="divide-y">
                        {samples.slice(0, 5).map((sample, index) => (
                          <tr key={sample.id}>
                            <td className="px-3 py-2 text-muted-foreground">{index + 1}</td>
                            <td className="px-3 py-2">
                              <code className="text-xs bg-muted px-2 py-1 rounded font-mono">
                                {sample.sampleId}
                              </code>
                            </td>
                            {perSampleFields.slice(0, 3).map((field) => (
                              <td key={field.id} className="px-3 py-2">
                                {field.type === "organism"
                                  ? String(sample.scientificName || sample.scientific_name || sample.taxId || sample.tax_id || "-")
                                  : String(sample[field.name] || "-")}
                              </td>
                            ))}
                            {perSampleFields.length > 3 && <td className="px-3 py-2">...</td>}
                          </tr>
                        ))}
                        {samples.length > 5 && (
                          <tr className="bg-muted/30">
                            <td colSpan={3 + Math.min(perSampleFields.length, 3) + (perSampleFields.length > 3 ? 1 : 0)} className="px-3 py-2 text-center text-muted-foreground">
                              ... and {samples.length - 5} more samples
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            </div>

            {/* Ready to Submit */}
            <div className={`rounded-xl p-5 flex items-start gap-4 ${
              aiIssues.length > 0
                ? "bg-amber-500/5 border border-amber-500/20"
                : "bg-green-500/5 border border-green-500/20"
            }`}>
              {aiIssues.length > 0 ? (
                <>
                  <div className="h-10 w-10 rounded-full bg-amber-500/20 flex items-center justify-center flex-shrink-0">
                    <AlertCircle className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-amber-700 dark:text-amber-400">
                      Review before submitting
                    </p>
                    <p className="text-amber-600 dark:text-amber-500 mt-1">
                      Some fields have potential issues. You can go back to make changes
                      or proceed if you believe the values are correct.
                    </p>
                  </div>
                </>
              ) : (
                <>
                  <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center flex-shrink-0">
                    <CheckCircle2 className="h-5 w-5 text-green-600" />
                  </div>
                  <div>
                    <p className="text-lg font-semibold text-green-700 dark:text-green-400">
                      Ready to submit
                    </p>
                    <p className="text-green-600 dark:text-green-500 mt-1">
                      Your order with {samples.length} sample{samples.length !== 1 ? "s" : ""} is ready.
                      After submitting, you can edit samples and track progress from the order page.
                    </p>
                  </div>
                </>
              )}
            </div>
          </div>
        );
    }

    // Ungrouped fields step
    if (stepId === "_ungrouped") {
      return (
        <div className="space-y-8">
          {ungroupedFields.map((field) => renderField(field, true))}
        </div>
      );
    }

    // Dynamic group step - render fields for this group
    const groupFields = getFieldsForGroup(stepId);
    const showContactInfo = isFirstGroupStep(stepId);

    return (
      <div className="space-y-8">
        {/* Render group fields */}
        {groupFields.map((field) => renderField(field, true))}

        {/* Contact Information - shown on first group step */}
        {showContactInfo && (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <Label className="text-base">Contact Information</Label>
              <Button variant="ghost" size="sm" asChild>
                <Link href="/dashboard/settings">
                  Change
                  <ExternalLink className="h-3 w-3 ml-2" />
                </Link>
              </Button>
            </div>

            {loadingProfile ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : (
              <div className="bg-muted/30 rounded-lg p-5 space-y-3 max-w-md">
                <div className="flex items-center gap-3">
                  <User className="h-5 w-5 text-muted-foreground" />
                  <span className="font-medium">
                    {userProfile?.firstName} {userProfile?.lastName}
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="h-5 w-5 text-muted-foreground" />
                  <span>{userProfile?.email || session?.user?.email}</span>
                </div>
                {(userProfile?.institution || userProfile?.department) && (
                  <div className="flex items-center gap-3">
                    <Building2 className="h-5 w-5 text-muted-foreground" />
                    <span>
                      {[userProfile?.department?.name, userProfile?.institution]
                        .filter(Boolean)
                        .join(", ")}
                    </span>
                  </div>
                )}
              </div>
            )}
            <p className="text-sm text-muted-foreground">
              This information is taken from your account profile.
            </p>
          </div>
        )}
      </div>
    );
  };

  if (loadingSchema) {
    return (
      <div className="p-8 flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="p-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-3">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <FlaskConical className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">New Sequencing Order</h1>
            <p className="text-muted-foreground">
              Step {currentStep + 1} of {steps.length}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" asChild>
          <Link href="/dashboard/orders">
            <X className="h-5 w-5" />
          </Link>
        </Button>
      </div>

      {/* Content */}
      <div>
          {/* Progress bar with integrated steps */}
          <div className="mb-6">
            <div className="relative h-8 bg-muted rounded-lg overflow-hidden">
              {/* Progress fill */}
              <div
                className="absolute inset-y-0 left-0 bg-primary transition-all duration-300 ease-out"
                style={{ width: `${((currentStep + 1) / steps.length) * 100}%` }}
              />
              {/* Step labels */}
              <div className="relative h-full flex items-center">
                {steps.map((step, index) => {
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
                      style={{ width: `${100 / steps.length}%` }}
                      className={`h-full px-2 text-xs transition-all flex items-center justify-center gap-1 ${
                        isInFilledArea
                          ? "text-primary-foreground"
                          : "text-muted-foreground"
                      } ${
                        isClickable ? "hover:bg-black/10 cursor-pointer" : ""
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
            <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive flex items-center gap-2">
              <AlertCircle className="h-5 w-5 flex-shrink-0" />
              {error}
            </div>
          )}

          {/* Main form content - full width, help is in sidebar */}
          <div>
            {/* Step header */}
            <div className="mb-6">
              <h2 className="text-xl font-semibold">{steps[currentStep].title}</h2>
              <p className="text-sm text-muted-foreground">{steps[currentStep].description}</p>
              {currentStep === 0 && (
                <div className="mt-3 p-2.5 rounded-lg bg-muted/50 border border-border">
                  <p className="text-sm text-muted-foreground">
                    Order ID: <code className="font-mono text-foreground bg-muted px-1.5 py-0.5 rounded text-xs">ORD-XXXXXXXX-XXXX</code>
                    <span className="ml-2 text-xs">(auto-generated)</span>
                  </p>
                </div>
              )}
            </div>

            {renderStepContent()}
          </div>

          {/* Navigation buttons */}
          <div className="flex items-center justify-between mt-8 pt-6 border-t border-border">
          <Button
            variant="outline"
            onClick={prevStep}
            disabled={currentStep === 0 || saving}
          >
            <ChevronLeft className="h-4 w-4 mr-2" />
            Previous
          </Button>

          {currentStep === steps.length - 1 ? (
            (() => {
              // Count AI issues on review step
              const aiIssueCount = Object.values(aiResults).filter(
                (r) => r && !r.checking && !r.valid
              ).length;
              const hasAiIssues = aiIssueCount > 0;

              if (saving) {
                return (
                  <Button disabled>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Creating...
                  </Button>
                );
              }

              if (hasAiIssues && !acknowledgedAiWarnings) {
                return (
                  <Button
                    variant="outline"
                    className="border-amber-500 text-amber-600 hover:bg-amber-500/10"
                    onClick={() => setAcknowledgedAiWarnings(true)}
                  >
                    <AlertCircle className="h-4 w-4 mr-2" />
                    {aiIssueCount} issue{aiIssueCount > 1 ? "s" : ""} - Review & Continue
                  </Button>
                );
              }

              if (hasAiIssues && acknowledgedAiWarnings) {
                return (
                  <Button
                    onClick={handleSubmit}
                    className="bg-amber-500 hover:bg-amber-600"
                  >
                    <AlertCircle className="h-4 w-4 mr-2" />
                    Submit Anyway
                  </Button>
                );
              }

              return (
                <Button onClick={handleSubmit}>
                  <Check className="h-4 w-4 mr-2" />
                  Submit for Sequencing
                </Button>
              );
            })()
          ) : (
            <Button onClick={nextStep} disabled={saving}>
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          )}
          </div>
      </div>

      {/* Submission Success Dialog */}
      <Dialog open={submissionDialogOpen} onOpenChange={setSubmissionDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-xl">
              <CheckCircle2 className="h-6 w-6 text-green-500" />
              Order Submitted Successfully
            </DialogTitle>
          </DialogHeader>

          <div className="prose prose-sm max-w-none dark:prose-invert py-4">
            <ReactMarkdown>{submissionInstructions}</ReactMarkdown>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button
              variant="outline"
              onClick={() => {
                setSubmissionDialogOpen(false);
                router.push("/dashboard/orders");
              }}
            >
              Back to Orders
            </Button>
            <Button
              onClick={() => {
                setSubmissionDialogOpen(false);
                if (createdOrderId) {
                  router.push(`/dashboard/orders/${createdOrderId}`);
                }
              }}
            >
              View Order Details
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
