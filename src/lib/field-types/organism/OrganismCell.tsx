"use client";

import { useState, useEffect, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";
import { CellContext } from "@tanstack/react-table";
import { searchTaxonomy, getTaxonomyByTaxId, type TaxonomyEntry } from "./taxonomy-data";
import { Search, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

// Generic sample type to avoid circular deps
interface SampleRow {
  taxId?: string;
  scientificName?: string;
  [key: string]: unknown;
}

export function OrganismCell<T extends SampleRow>({
  getValue,
  row,
  column,
  table,
}: CellContext<T, unknown>) {
  const initialValue = getValue() as string;
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<TaxonomyEntry[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0, width: 320 });
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const columnMeta = column.columnDef.meta as {
    editable?: boolean;
    fieldName?: string;
  } | undefined;

  const isEditable = columnMeta?.editable !== false;

  // Get the current taxId and scientificName from the row
  // Support multiple naming conventions (camelCase and snake_case)
  const taxId = (row.original.taxId ?? row.original.tax_id ?? "") as string;
  const scientificName = (row.original.scientificName ?? row.original.scientific_name ?? "") as string;

  // Initialize display value
  useEffect(() => {
    if (scientificName) {
      setInputValue(scientificName);
    } else if (taxId) {
      const entry = getTaxonomyByTaxId(taxId);
      if (entry) {
        setInputValue(entry.scientificName);
      } else {
        setInputValue(taxId ? `TaxID: ${taxId}` : "");
      }
    } else {
      setInputValue("");
    }
  }, [taxId, scientificName]);

  // Search as user types
  useEffect(() => {
    if (inputValue.length >= 2 && isOpen) {
      const searchResults = searchTaxonomy(inputValue, 6);
      setResults(searchResults);
      setHighlightedIndex(0);
    } else {
      setResults([]);
    }
  }, [inputValue, isOpen]);

  // Handle click outside
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      const clickedDropdown = dropdownRef.current?.contains(target);
      const clickedInput = inputRef.current?.contains(target);
      const clickedContainer = containerRef.current?.contains(target);

      if (!clickedDropdown && !clickedInput && !clickedContainer) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [isOpen]);

  // Calculate dropdown position when open and handle scroll/resize
  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current) return;

    const updatePosition = () => {
      if (containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        setDropdownPosition({
          top: rect.bottom,
          left: rect.left,
          width: Math.max(320, rect.width),
        });
      }
    };

    updatePosition();

    // Update position on scroll and resize
    window.addEventListener("resize", updatePosition);
    document.addEventListener("scroll", updatePosition, true);

    return () => {
      window.removeEventListener("resize", updatePosition);
      document.removeEventListener("scroll", updatePosition, true);
    };
  }, [isOpen]);

  const handleSelect = useCallback((entry: TaxonomyEntry) => {
    setInputValue(entry.scientificName);
    setIsOpen(false);
    setResults([]);

    // Update both taxId and scientificName in the table
    const updateFn = (table.options.meta as { updateData?: (rowIndex: number, updates: Record<string, unknown>) => void })?.updateData;
    if (updateFn) {
      updateFn(row.index, {
        taxId: entry.taxId,
        scientificName: entry.scientificName,
      });
    }
  }, [row.index, table.options.meta]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) {
      if (e.key === "ArrowDown" && inputValue.length >= 2) {
        setIsOpen(true);
      }
      return;
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault();
        setHighlightedIndex((prev) => Math.min(prev + 1, results.length - 1));
        break;
      case "ArrowUp":
        e.preventDefault();
        setHighlightedIndex((prev) => Math.max(prev - 1, 0));
        break;
      case "Enter":
        e.preventDefault();
        if (results[highlightedIndex]) {
          handleSelect(results[highlightedIndex]);
        }
        break;
      case "Escape":
        setIsOpen(false);
        break;
      case "Tab":
        setIsOpen(false);
        break;
    }
  };

  const handleBlur = () => {
    // Delay to allow click events on dropdown
    setTimeout(() => {
      if (!isOpen) return;

      // If input looks like a taxId
      if (/^\d+$/.test(inputValue)) {
        const entry = getTaxonomyByTaxId(inputValue);
        if (entry) {
          handleSelect(entry);
        } else {
          // Unknown taxId
          const updateFn = (table.options.meta as { updateData?: (rowIndex: number, updates: Record<string, unknown>) => void })?.updateData;
          if (updateFn) {
            updateFn(row.index, {
              taxId: inputValue,
              scientificName: `Unknown (TaxID: ${inputValue})`,
            });
          }
        }
      }
      setIsOpen(false);
    }, 150);
  };

  if (!isEditable) {
    return (
      <div className="px-2 py-1 h-full flex items-center gap-2 bg-gray-50">
        <span className="text-sm truncate">{scientificName || taxId || "-"}</span>
        {taxId && (
          <span className="text-[10px] font-mono text-muted-foreground">{taxId}</span>
        )}
      </div>
    );
  }

  // Render dropdown content
  const dropdownContent = isOpen && (results.length > 0 || inputValue.length >= 2) ? (
    <div
      ref={dropdownRef}
      className="fixed z-[9999] bg-white rounded-lg border shadow-lg max-h-64 overflow-y-auto"
      style={{
        top: dropdownPosition.top,
        left: dropdownPosition.left,
        width: dropdownPosition.width,
      }}
    >
      {results.length > 0 ? (
        <>
          {results.map((entry, index) => (
            <button
              key={entry.taxId}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                handleSelect(entry);
              }}
              className={cn(
                "w-full px-3 py-2 text-left flex items-start gap-2 hover:bg-stone-50 transition-colors",
                index === highlightedIndex && "bg-stone-100",
                index !== results.length - 1 && "border-b border-stone-100"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="font-medium text-sm truncate">
                    {entry.scientificName}
                  </span>
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-mono text-muted-foreground">
                    {entry.taxId}
                  </span>
                  <span className="text-[10px] px-1 py-0.5 rounded bg-stone-100 text-stone-600">
                    {entry.category}
                  </span>
                </div>
              </div>
              {entry.taxId === taxId && (
                <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
              )}
            </button>
          ))}
          <a
            href={`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?name=${encodeURIComponent(inputValue)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-3 py-2 text-left flex items-center gap-2 text-xs text-muted-foreground hover:bg-stone-50 border-t border-stone-200"
            onMouseDown={(e) => e.preventDefault()}
          >
            <ExternalLink className="h-3 w-3" />
            Search NCBI for &quot;{inputValue}&quot;
          </a>
        </>
      ) : (
        <div className="p-3">
          <p className="text-xs text-muted-foreground mb-2">
            No matches. Enter a valid NCBI Taxonomy ID or:
          </p>
          <a
            href={`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?name=${encodeURIComponent(inputValue)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
            onMouseDown={(e) => e.preventDefault()}
          >
            <ExternalLink className="h-3 w-3" />
            Search NCBI Taxonomy
          </a>
        </div>
      )}
    </div>
  ) : null;

  return (
    <div ref={containerRef} className="relative h-full">
      <div className="relative h-full">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground pointer-events-none z-10" />
        <input
          ref={inputRef}
          data-testid={`sample-cell-${row.index}-${column.id}`}
          value={inputValue}
          onChange={(e) => {
            setInputValue(e.target.value);
            setIsOpen(true);
          }}
          onFocus={() => {
            if (inputValue.length >= 2) {
              setIsOpen(true);
            }
          }}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder="e.g., human gut metagenome"
          className="w-full h-full pl-7 pr-14 text-sm border-0 bg-transparent focus:outline-none focus:ring-1 focus:ring-primary/50"
        />
        {taxId && (
          <span className="absolute right-2 top-1/2 -translate-y-1/2 text-[10px] font-mono text-muted-foreground bg-stone-100 px-1 rounded">
            {taxId}
          </span>
        )}
      </div>

      {/* Render dropdown via portal to avoid overflow clipping */}
      {typeof document !== "undefined" && dropdownContent && createPortal(dropdownContent, document.body)}
    </div>
  );
}
