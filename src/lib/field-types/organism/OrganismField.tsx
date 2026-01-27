"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { searchTaxonomy, getTaxonomyByTaxId, type TaxonomyEntry } from "./taxonomy-data";
import { Search, Check, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";

interface OrganismFieldProps {
  value: string; // taxId
  scientificName?: string;
  onChange: (taxId: string, scientificName: string) => void;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  // For table cell mode
  compact?: boolean;
}

export function OrganismField({
  value,
  scientificName,
  onChange,
  placeholder = "e.g., human gut metagenome",
  disabled = false,
  className,
  compact = false,
}: OrganismFieldProps) {
  const [inputValue, setInputValue] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [results, setResults] = useState<TaxonomyEntry[]>([]);
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Initialize input value from props
  useEffect(() => {
    if (value && scientificName) {
      setInputValue(scientificName);
    } else if (value) {
      // Try to look up the scientific name from taxId
      const entry = getTaxonomyByTaxId(value);
      if (entry) {
        setInputValue(entry.scientificName);
      } else {
        setInputValue(`TaxID: ${value}`);
      }
    } else {
      setInputValue("");
    }
  }, [value, scientificName]);

  // Search as user types
  useEffect(() => {
    if (inputValue.length >= 2) {
      const searchResults = searchTaxonomy(inputValue, 8);
      setResults(searchResults);
      setHighlightedIndex(0);
    } else {
      setResults([]);
    }
  }, [inputValue]);

  // Handle click outside to close dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(event.target as Node) &&
        inputRef.current &&
        !inputRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelect = useCallback((entry: TaxonomyEntry) => {
    onChange(entry.taxId, entry.scientificName);
    setInputValue(entry.scientificName);
    setIsOpen(false);
    setResults([]);
  }, [onChange]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!isOpen || results.length === 0) {
      if (e.key === "ArrowDown" && results.length > 0) {
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
    }
  };

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value;
    setInputValue(newValue);
    setIsOpen(true);

    // If user clears the input, clear the values
    if (!newValue) {
      onChange("", "");
    }
  };

  const handleFocus = () => {
    if (inputValue.length >= 2) {
      setIsOpen(true);
    }
  };

  // Handle manual taxId entry (if user types a number)
  const handleBlur = () => {
    // Give time for click events on dropdown
    setTimeout(() => {
      // If input looks like a taxId and no selection was made
      if (/^\d+$/.test(inputValue) && !results.find(r => r.taxId === inputValue)) {
        const entry = getTaxonomyByTaxId(inputValue);
        if (entry) {
          onChange(entry.taxId, entry.scientificName);
          setInputValue(entry.scientificName);
        } else {
          // Unknown taxId - keep it but mark as unknown
          onChange(inputValue, `Unknown organism (TaxID: ${inputValue})`);
        }
      }
      setIsOpen(false);
    }, 200);
  };

  return (
    <div className={cn("relative", className)}>
      <div className="relative">
        <Search className={cn(
          "absolute left-2 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none",
          compact ? "h-3 w-3" : "h-4 w-4"
        )} />
        <Input
          ref={inputRef}
          value={inputValue}
          onChange={handleInputChange}
          onFocus={handleFocus}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(
            compact ? "h-8 pl-7 text-sm" : "pl-9",
            value && "pr-16"
          )}
        />
        {value && (
          <span className={cn(
            "absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground font-mono",
            compact ? "text-[10px]" : "text-xs"
          )}>
            {value}
          </span>
        )}
      </div>

      {/* Dropdown */}
      {isOpen && results.length > 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-white rounded-lg border shadow-lg max-h-64 overflow-y-auto"
        >
          {results.map((entry, index) => (
            <button
              key={entry.taxId}
              type="button"
              onClick={() => handleSelect(entry)}
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
                  {entry.commonName && (
                    <span className="text-xs text-muted-foreground truncate">
                      ({entry.commonName})
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className="text-xs font-mono text-muted-foreground">
                    NCBI:{entry.taxId}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-stone-100 text-stone-600">
                    {entry.category}
                  </span>
                </div>
              </div>
              {entry.taxId === value && (
                <Check className="h-4 w-4 text-green-600 flex-shrink-0 mt-0.5" />
              )}
            </button>
          ))}

          {/* Link to NCBI for custom search */}
          <a
            href={`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?name=${encodeURIComponent(inputValue)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="w-full px-3 py-2 text-left flex items-center gap-2 text-xs text-muted-foreground hover:bg-stone-50 border-t border-stone-200"
          >
            <ExternalLink className="h-3 w-3" />
            Search NCBI Taxonomy for &quot;{inputValue}&quot;
          </a>
        </div>
      )}

      {/* No results message */}
      {isOpen && inputValue.length >= 2 && results.length === 0 && (
        <div
          ref={dropdownRef}
          className="absolute z-50 mt-1 w-full bg-white rounded-lg border shadow-lg p-3"
        >
          <p className="text-sm text-muted-foreground mb-2">
            No matching organisms found.
          </p>
          <p className="text-xs text-muted-foreground mb-2">
            You can enter a valid NCBI Taxonomy ID directly, or search NCBI:
          </p>
          <a
            href={`https://www.ncbi.nlm.nih.gov/Taxonomy/Browser/wwwtax.cgi?name=${encodeURIComponent(inputValue)}`}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3 w-3" />
            Search NCBI Taxonomy
          </a>
        </div>
      )}
    </div>
  );
}

// Simpler version for table cells
export function OrganismCellEditor({
  value,
  scientificName,
  onChange,
  onBlur,
}: {
  value: string;
  scientificName?: string;
  onChange: (taxId: string, scientificName: string) => void;
  onBlur?: () => void;
}) {
  return (
    <OrganismField
      value={value}
      scientificName={scientificName}
      onChange={onChange}
      compact
      className="w-full"
    />
  );
}
