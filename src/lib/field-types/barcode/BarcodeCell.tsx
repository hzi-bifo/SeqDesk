"use client";

import { useState, useEffect } from "react";
import { CellContext, RowData } from "@tanstack/react-table";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FormFieldDefinition } from "@/types/form-config";

// Generic sample type to avoid circular deps
interface SampleRow {
  [key: string]: unknown;
}

/**
 * BarcodeCell — per-sample barcode dropdown with dynamic options.
 *
 * Options come from `table.options.meta.barcodeOptions` (resolved at runtime
 * from the selected sequencing kit's barcode set), NOT from the static
 * `field.options` array.
 */
export function BarcodeCell<T extends SampleRow>({
  getValue,
  row,
  column,
  table,
}: CellContext<T, unknown>) {
  const initialValue = getValue() as string;
  const [value, setValue] = useState(initialValue ?? "");
  const meta = column.columnDef.meta as {
    field?: FormFieldDefinition;
    editable?: boolean;
  } | undefined;
  const field = meta?.field;
  const isEditable = meta?.editable !== false;

  // Read dynamic barcode options from table meta
  const barcodeOptions = (
    table.options.meta as Record<string, unknown> | undefined
  )?.barcodeOptions as {
    options: { value: string; label: string }[];
    count: number;
  } | null | undefined;

  const options = barcodeOptions?.options || [];

  useEffect(() => {
    setValue(initialValue ?? "");
  }, [initialValue]);

  const handleChange = (newValue: string) => {
    if (!isEditable) return;
    setValue(newValue);
    (table.options.meta as { updateData?: (rowIndex: number, columnId: string, value: unknown) => void })
      ?.updateData?.(row.index, column.id, newValue);
  };

  const onFocus = () => {
    if (field) {
      (table.options.meta as { onColumnClick?: (field: FormFieldDefinition | null) => void })
        ?.onColumnClick?.(field);
    }
  };

  // No barcode options available (no kit selected or kit doesn't support barcoding)
  if (options.length === 0) {
    return (
      <div className="w-full h-full px-2 py-1.5 text-xs text-muted-foreground bg-muted/30 flex items-center">
        Select kit first
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
            isEditable
              ? "hover:bg-secondary cursor-pointer"
              : "cursor-not-allowed opacity-70"
          )}
        >
          <span className={value ? "font-mono text-xs" : "text-muted-foreground"}>
            {selectedLabel || "Select..."}
          </span>
          <ChevronDown className="h-4 w-4 text-muted-foreground" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-[180px] max-h-[240px] overflow-y-auto"
      >
        <DropdownMenuItem onClick={() => handleChange("")}>
          <span className="text-muted-foreground">Select...</span>
        </DropdownMenuItem>
        {options.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => handleChange(opt.value)}
            className={cn(
              "font-mono text-xs",
              value === opt.value ? "bg-accent" : ""
            )}
          >
            {opt.label}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
