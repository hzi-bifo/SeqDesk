"use client";

import { useState, useEffect, useCallback, useRef, useMemo, use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  ColumnDef,
  CellContext,
  RowData,
} from "@tanstack/react-table";

declare module "@tanstack/react-table" {
  interface TableMeta<TData extends RowData> {
    updateData: (rowIndex: number, columnIdOrUpdates: string | Record<string, unknown>, value?: unknown) => void;
  }
}

import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageContainer } from "@/components/layout/PageContainer";
import { HelpBox } from "@/components/ui/help-box";
import { ExcelToolbar } from "@/components/samples/ExcelToolbar";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Save,
  AlertCircle,
  Check,
  FileSpreadsheet,
  BookOpen,
  HelpCircle,
  X,
  ChevronDown,
  ChevronUp,
} from "lucide-react";

interface Sample {
  id: string;
  sampleId: string;
  sampleTitle: string | null;
  checklistData?: Record<string, string>;
  isModified?: boolean;
  [key: string]: unknown;
}

interface Study {
  id: string;
  title: string;
  description: string | null;
  checklistType: string | null;
  studyMetadata: string | null;
  submitted: boolean;
  samples: Sample[];
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
}

// Helper to navigate cells
function navigateToCell(currentInput: HTMLInputElement, direction: 'up' | 'down' | 'left' | 'right') {
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
    if (prevRow) targetCell = prevRow.querySelectorAll('td')[cellIndex];
  } else if (direction === 'down') {
    const nextRow = currentRow.nextElementSibling;
    if (nextRow) targetCell = nextRow.querySelectorAll('td')[cellIndex];
  }

  if (targetCell) {
    const input = targetCell.querySelector('input, select') as HTMLElement;
    if (input) {
      input.focus();
      if (input instanceof HTMLInputElement) input.select();
    }
  }
}

// Editable cell component
function EditableCell({ getValue, row, column, table }: CellContext<Sample, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue);

  useEffect(() => setValue(initialValue), [initialValue]);

  const onBlur = () => {
    if (value !== initialValue) {
      table.options.meta?.updateData(row.index, column.id, value);
    }
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter" || e.key === "ArrowDown") {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'down');
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      onBlur();
      navigateToCell(e.currentTarget, 'up');
    } else if (e.key === "Escape") {
      setValue(initialValue);
      e.currentTarget.blur();
    }
  };

  return (
    <input
      value={value ?? ""}
      onChange={(e) => setValue(e.target.value)}
      onBlur={onBlur}
      onKeyDown={onKeyDown}
      className="w-full h-full px-2 py-1 border-0 outline-none bg-transparent focus:bg-blue-50 focus:ring-1 focus:ring-blue-300"
    />
  );
}

// Select cell component
function SelectCell({ getValue, row, column, table }: CellContext<Sample, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue);
  const options = (column.columnDef.meta as { options?: { value: string; label: string }[] })?.options || [];

  useEffect(() => setValue(initialValue), [initialValue]);

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const newValue = e.target.value;
    setValue(newValue);
    table.options.meta?.updateData(row.index, column.id, newValue);
  };

  return (
    <select
      value={value ?? ""}
      onChange={onChange}
      className="w-full h-full px-2 py-1 border-0 outline-none bg-transparent focus:bg-blue-50"
    >
      <option value="">Select...</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  );
}

const CHECKLIST_MAP: Record<string, string> = {
  "human-gut": "GSC MIxS human gut",
  "human-oral": "GSC MIxS human oral",
  "human-skin": "GSC MIxS human skin",
  "human-associated": "GSC MIxS human associated",
  "host-associated": "GSC MIxS host associated",
  "plant-associated": "GSC MIxS plant associated",
  "soil": "GSC MIxS soil",
  "water": "GSC MIxS water",
  "wastewater-sludge": "GSC MIxS wastewater sludge",
  "air": "GSC MIxS air",
  "sediment": "GSC MIxS sediment",
  "microbial-mat": "GSC MIxS microbial mat biolfilm",
  "misc-environment": "GSC MIxS miscellaneous natural or artificial environment",
};

export default function StudyMetadataPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const tableContainerRef = useRef<HTMLDivElement>(null);

  const [study, setStudy] = useState<Study | null>(null);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [hasChanges, setHasChanges] = useState(false);

  // Study-level metadata
  const [studyMetadata, setStudyMetadata] = useState<Record<string, string>>({});
  const [showStudyFields, setShowStudyFields] = useState(true);

  // MIxS fields
  const [checklistFields, setChecklistFields] = useState<MixsField[]>([]);
  const [selectedField, setSelectedField] = useState<MixsField | null>(null);
  const apiStudyId = study?.id ?? id;

  useEffect(() => {
    fetchStudy();
  }, [id]);

  // Warn user about unsaved changes when leaving
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

  const fetchStudy = async () => {
    try {
      const res = await fetch(`/api/studies/${id}`);
      if (!res.ok) throw new Error("Failed to fetch study");
      const data = await res.json();
      setStudy(data);
      if (typeof data?.id === "string" && data.id !== id) {
        router.replace(`/studies/${data.id}`);
      }
      setSamples(data.samples || []);

      // Parse study metadata
      if (data.studyMetadata) {
        try {
          setStudyMetadata(JSON.parse(data.studyMetadata));
        } catch {
          setStudyMetadata({});
        }
      }

      // Load MIxS checklist fields if checklist type is set
      if (data.checklistType) {
        await loadChecklistFields(data.checklistType);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load study");
    } finally {
      setLoading(false);
    }
  };

  const loadChecklistFields = async (checklistType: string) => {
    try {
      const checklistName = CHECKLIST_MAP[checklistType];
      if (!checklistName) return;

      const res = await fetch(`/api/mixs/checklists?name=${encodeURIComponent(checklistName)}`);
      if (!res.ok) return;

      const data = await res.json();
      if (data.fields) {
        // Filter to visible fields only
        const visibleFields = data.fields.filter((f: MixsField) => f.visible !== false);
        setChecklistFields(visibleFields);
      }
    } catch (err) {
      console.error("Failed to load checklist fields:", err);
    }
  };

  const handleSave = async () => {
    if (!study) return;

    setSaving(true);
    setError("");
    setSuccess("");

    try {
      // Save study-level metadata
      await fetch(`/api/studies/${apiStudyId}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studyMetadata: JSON.stringify(studyMetadata),
        }),
      });

      // Save sample-level metadata
      const modifiedSamples = samples.filter(s => s.isModified);
      for (const sample of modifiedSamples) {
        await fetch(`/api/samples/${sample.id}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            checklistData: sample.checklistData,
          }),
        });
      }

      // Reset modified flags
      setSamples(prev => prev.map(s => ({ ...s, isModified: false })));
      setHasChanges(false);
      setSuccess("Metadata saved successfully");
      setTimeout(() => setSuccess(""), 3000);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  // Columns for the spreadsheet
  const columns = useMemo<ColumnDef<Sample>[]>(() => {
    const cols: ColumnDef<Sample>[] = [
      // Row number
      {
        id: "rowNum",
        header: "#",
        size: 40,
        cell: ({ row }) => (
          <div className="text-center text-xs text-muted-foreground">{row.index + 1}</div>
        ),
      },
      // Sample ID (read-only)
      {
        accessorKey: "sampleId",
        header: "Sample ID",
        size: 150,
        cell: ({ getValue }) => (
          <div className="px-2 py-1 h-full bg-gray-50 text-gray-600 font-mono text-xs">
            {getValue() as string}
          </div>
        ),
      },
      // Sample Title (read-only)
      {
        accessorKey: "sampleTitle",
        header: "Title",
        size: 150,
        cell: ({ getValue }) => (
          <div className="px-2 py-1 h-full bg-gray-50 text-gray-600 text-sm truncate">
            {(getValue() as string) || "-"}
          </div>
        ),
      },
    ];

    // Add MIxS checklist fields (sample-level)
    for (const field of checklistFields) {
      const col: ColumnDef<Sample> = {
        id: field.name,
        accessorFn: (row) => row.checklistData?.[field.name] || "",
        header: field.required ? `${field.label} *` : field.label,
        size: 160,
        cell: field.type === "select" && field.options ? SelectCell : EditableCell,
        meta: {
          isChecklistField: true,
          fieldName: field.name,
          options: field.options,
        },
      };
      cols.push(col);
    }

    return cols;
  }, [checklistFields]);

  // Update data callback
  // Supports both single field update: updateData(rowIndex, columnId, value)
  // And multi-field update: updateData(rowIndex, { field1: value1, field2: value2 })
  const updateData = useCallback((rowIndex: number, columnIdOrUpdates: string | Record<string, unknown>, value?: unknown) => {
    setSamples(old => {
      const newData = [...old];
      const row = { ...newData[rowIndex] };

      if (typeof columnIdOrUpdates === "object") {
        // Multi-field update (for organism field)
        for (const [fieldName, fieldValue] of Object.entries(columnIdOrUpdates)) {
          (row as Record<string, unknown>)[fieldName] = fieldValue;
        }
      } else {
        // Single field update
        const columnId = columnIdOrUpdates;
        const colMeta = columns.find(c => c.id === columnId)?.meta as { isChecklistField?: boolean; fieldName?: string } | undefined;

        if (colMeta?.isChecklistField && colMeta.fieldName) {
          if (!row.checklistData) row.checklistData = {};
          row.checklistData[colMeta.fieldName] = value as string;
        }
      }

      row.isModified = true;
      newData[rowIndex] = row;
      return newData;
    });
    setHasChanges(true);
    setSuccess("");
  }, [columns]);

  // Flatten samples for Excel template (checklistData -> flat row)
  const flatSamplesForExcel = useMemo(() => {
    return samples.map((s) => {
      const flat: Record<string, unknown> = {
        id: s.id,
        sampleId: s.sampleId,
      };
      if (s.checklistData) {
        for (const [k, v] of Object.entries(s.checklistData)) {
          flat[k] = v;
        }
      }
      return flat as { id: string; sampleId: string; [key: string]: unknown };
    });
  }, [samples]);

  // Handle samples imported from Excel - merge checklist data
  const handleSamplesImported = useCallback(
    (importedRows: { id: string; sampleId: string; [key: string]: unknown }[]) => {
      const normalizeSampleId = (value: unknown) =>
        String(value ?? "").trim().toLowerCase();
      setSamples((prev) => {
        const importedBySampleId = new Map(
          importedRows
            .map((row) => [normalizeSampleId(row.sampleId), row] as const)
            .filter(([key]) => key.length > 0)
        );

        return prev.map((sample) => {
          const key = normalizeSampleId(sample.sampleId);
          const row = importedBySampleId.get(key);
          if (!row) return sample;

          const nextChecklistData = { ...(sample.checklistData || {}) };
          let changed = false;
          for (const field of checklistFields) {
            if (row[field.name] !== undefined && row[field.name] !== "") {
              nextChecklistData[field.name] = String(row[field.name]);
              changed = true;
            }
          }

          if (!changed) return sample;

          return {
            ...sample,
            checklistData: nextChecklistData,
            isModified: true,
          };
        });
      });
      setHasChanges(true);
      toast.success(
        `Imported metadata for ${importedRows.length} sample${importedRows.length !== 1 ? "s" : ""}`
      );
    },
    [checklistFields]
  );

  const table = useReactTable({
    data: samples,
    columns,
    getCoreRowModel: getCoreRowModel(),
    meta: { updateData },
  });

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </PageContainer>
    );
  }

  if (!study) {
    return (
      <PageContainer>
        <div className="text-center py-12">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-destructive" />
          <h2 className="text-xl font-semibold mb-2">Study Not Found</h2>
          <Button asChild variant="outline">
            <Link href="/studies">
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Studies
            </Link>
          </Button>
        </div>
      </PageContainer>
    );
  }

  if (!study.checklistType) {
    return (
      <PageContainer>
        <div className="mb-6">
          <Button variant="ghost" size="sm" asChild className="mb-4">
            <Link href={`/studies/${id}`}>
              <ArrowLeft className="h-4 w-4 mr-2" />
              Back to Study
            </Link>
          </Button>
        </div>
        <GlassCard className="p-8 text-center">
          <AlertCircle className="h-12 w-12 mx-auto mb-4 text-amber-500" />
          <h2 className="text-xl font-semibold mb-2">No MIxS Checklist Selected</h2>
          <p className="text-muted-foreground mb-4">
            This study needs a MIxS checklist type to define the metadata fields.
          </p>
          <Button asChild>
            <Link href={`/studies/${id}`}>
              Edit Study Settings
            </Link>
          </Button>
        </GlassCard>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      {/* Header */}
      {/* Unsaved changes banner */}
      {hasChanges && (
        <div className="mb-4 p-3 bg-amber-50 border border-amber-200 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-2 text-amber-800">
            <AlertCircle className="h-4 w-4" />
            <span className="text-sm font-medium">You have unsaved changes</span>
          </div>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
            Save Now
          </Button>
        </div>
      )}

      <div className="mb-6">
        <Button variant="ghost" size="sm" asChild className="mb-4">
          <Link href={`/studies/${id}`}>
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Study
          </Link>
        </Button>

        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold flex items-center gap-2">
              <FileSpreadsheet className="h-6 w-6" />
              MIxS Metadata
            </h1>
            <p className="text-muted-foreground mt-1">
              {study.title} - {samples.length} samples - {CHECKLIST_MAP[study.checklistType] || study.checklistType}
            </p>
          </div>
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
              </>
            )}
          </Button>
        </div>
      </div>

      <HelpBox title="Filling in metadata">
        Edit cells directly in the spreadsheet below. Study-level fields apply to all samples.
        Click Save Changes to persist your edits. Required fields are marked with an asterisk (*).
      </HelpBox>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm flex items-center gap-2">
          <AlertCircle className="h-4 w-4" />
          {error}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={() => setError("")}>
            <X className="h-4 w-4" />
          </Button>
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600 text-sm flex items-center gap-2">
          <Check className="h-4 w-4" />
          {success}
        </div>
      )}

      {/* Study-Level Metadata */}
      <GlassCard className="p-4 mb-6">
        <button
          onClick={() => setShowStudyFields(!showStudyFields)}
          className="w-full flex items-center justify-between"
        >
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <BookOpen className="h-5 w-5" />
            Study-Level Fields
            <span className="text-sm font-normal text-muted-foreground">
              (shared by all samples)
            </span>
          </h2>
          {showStudyFields ? <ChevronUp className="h-5 w-5" /> : <ChevronDown className="h-5 w-5" />}
        </button>

        {showStudyFields && (
          <div className="mt-4 grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {checklistFields.slice(0, 6).map(field => (
              <div key={field.name}>
                <Label className="text-sm flex items-center gap-1">
                  {field.label}
                  {field.required && <span className="text-red-500">*</span>}
                  {field.helpText && (
                    <span title={field.helpText}>
                      <HelpCircle className="h-3 w-3 text-muted-foreground" />
                    </span>
                  )}
                </Label>
                <Input
                  value={studyMetadata[field.name] || ""}
                  onChange={(e) => {
                    setStudyMetadata(prev => ({ ...prev, [field.name]: e.target.value }));
                    setHasChanges(true);
                  }}
                  placeholder={field.helpText || `Enter ${field.label.toLowerCase()}`}
                  className="mt-1"
                />
              </div>
            ))}
          </div>
        )}
      </GlassCard>

      {/* Sample-Level Metadata Spreadsheet */}
      <GlassCard className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-5 w-5" />
            Sample-Level Fields
            <span className="text-sm font-normal text-muted-foreground">
              (unique per sample)
            </span>
          </h2>
          <div className="flex items-center gap-2">
            {selectedField && (
              <div className="text-sm text-muted-foreground mr-2">
                <strong>{selectedField.label}:</strong> {selectedField.helpText || "No description"}
              </div>
            )}
            <ExcelToolbar
              perSampleFields={checklistFields.map((f) => ({
                ...f,
                id: f.name,
                order: 0,
                perSample: true,
              })) as unknown as import("@/types/form-config").FormFieldDefinition[]}
              samples={flatSamplesForExcel}
              onSamplesImported={handleSamplesImported}
              disabled={saving}
              entityName="metadata"
            />
          </div>
        </div>

        {samples.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <FileSpreadsheet className="h-10 w-10 mx-auto mb-2 opacity-50" />
            <p>No samples in this study</p>
            <p className="text-sm">Assign samples from an order first</p>
          </div>
        ) : (
          <div ref={tableContainerRef} className="overflow-auto border rounded-lg" style={{ maxHeight: "500px" }}>
            <table className="w-full border-collapse text-sm">
              <thead className="sticky top-0 z-10 bg-stone-100">
                {table.getHeaderGroups().map(headerGroup => (
                  <tr key={headerGroup.id}>
                    {headerGroup.headers.map(header => (
                      <th
                        key={header.id}
                        className="border-b border-r border-stone-200 px-2 py-2 text-left font-medium text-stone-700 whitespace-nowrap"
                        style={{ width: header.getSize(), minWidth: header.getSize() }}
                        onClick={() => {
                          const meta = header.column.columnDef.meta as { fieldName?: string } | undefined;
                          if (meta?.fieldName) {
                            const field = checklistFields.find(f => f.name === meta.fieldName);
                            setSelectedField(field || null);
                          }
                        }}
                      >
                        {header.isPlaceholder ? null : flexRender(header.column.columnDef.header, header.getContext())}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody>
                {table.getRowModel().rows.map(row => (
                  <tr
                    key={row.id}
                    className={`border-b border-stone-100 ${row.original.isModified ? "bg-amber-50/50" : "hover:bg-stone-50"}`}
                  >
                    {row.getVisibleCells().map(cell => (
                      <td
                        key={cell.id}
                        className="border-r border-stone-100 p-0"
                        style={{ width: cell.column.getSize(), minWidth: cell.column.getSize() }}
                      >
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {hasChanges && (
          <div className="mt-4 flex items-center justify-between p-3 bg-amber-50 rounded-lg border border-amber-200">
            <span className="text-sm text-amber-800">You have unsaved changes</span>
            <Button size="sm" onClick={handleSave} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4 mr-1" />}
              Save
            </Button>
          </div>
        )}
      </GlassCard>
    </PageContainer>
  );
}
