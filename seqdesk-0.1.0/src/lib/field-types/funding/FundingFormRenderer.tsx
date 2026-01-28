"use client";

/**
 * Funding Form Renderer Component
 *
 * This component is rendered in the Order Form when displaying a funding field.
 * It allows users to add one or more funding sources with structured data.
 */

import { useState } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Wallet, Plus, Trash2, Star, ChevronDown, ChevronUp } from "lucide-react";
import { FormFieldDefinition } from "@/types/form-config";
import { FundingEntry, FundingFieldValue, FUNDING_AGENCIES } from "./index";

interface FundingFormRendererProps {
  field: FormFieldDefinition;
  value: FundingFieldValue | null;
  disabled?: boolean;
  onChange: (value: FundingFieldValue) => void;
}

function generateId(): string {
  return `funding_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

function createEmptyEntry(): FundingEntry {
  return {
    id: generateId(),
    agencyId: "",
    grantNumber: "",
    grantTitle: "",
    piName: "",
    isPrimary: false,
  };
}

export function FundingFormRenderer({
  field,
  value,
  disabled,
  onChange,
}: FundingFormRendererProps) {
  const [expandedEntries, setExpandedEntries] = useState<Set<string>>(new Set());

  const entries = value?.entries || [];

  const toggleExpanded = (entryId: string) => {
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      if (next.has(entryId)) {
        next.delete(entryId);
      } else {
        next.add(entryId);
      }
      return next;
    });
  };

  const addEntry = () => {
    const newEntry = createEmptyEntry();
    // If this is the first entry, make it primary
    if (entries.length === 0) {
      newEntry.isPrimary = true;
    }
    const newEntries = [...entries, newEntry];
    onChange({ entries: newEntries });
    // Auto-expand the new entry
    setExpandedEntries((prev) => new Set([...prev, newEntry.id]));
  };

  const removeEntry = (entryId: string) => {
    const newEntries = entries.filter((e) => e.id !== entryId);
    // If we removed the primary, make the first one primary
    if (newEntries.length > 0 && !newEntries.some((e) => e.isPrimary)) {
      newEntries[0].isPrimary = true;
    }
    onChange({ entries: newEntries });
    setExpandedEntries((prev) => {
      const next = new Set(prev);
      next.delete(entryId);
      return next;
    });
  };

  const updateEntry = (entryId: string, updates: Partial<FundingEntry>) => {
    const newEntries = entries.map((e) =>
      e.id === entryId ? { ...e, ...updates } : e
    );
    onChange({ entries: newEntries });
  };

  const setPrimary = (entryId: string) => {
    const newEntries = entries.map((e) => ({
      ...e,
      isPrimary: e.id === entryId,
    }));
    onChange({ entries: newEntries });
  };

  const getAgencyHint = (agencyId: string): string => {
    const agency = FUNDING_AGENCIES.find((a) => a.id === agencyId);
    return agency?.grantNumberHint || "Enter grant/award number";
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <Wallet className="h-4 w-4 text-amber-600" />
          </div>
          <div className="flex-1">
            <Label className="text-base font-medium">{field.label}</Label>
            {field.helpText && (
              <p className="text-sm text-muted-foreground mt-1">{field.helpText}</p>
            )}
          </div>
        </div>

        {/* Entries */}
        {entries.length > 0 && (
          <div className="space-y-3 mb-4">
            {entries.map((entry, index) => {
              const isExpanded = expandedEntries.has(entry.id);
              const agency = FUNDING_AGENCIES.find((a) => a.id === entry.agencyId);
              const displayName = entry.agencyId === "other"
                ? entry.agencyOther || "Other"
                : agency?.name || "Select agency";

              return (
                <div
                  key={entry.id}
                  className={`border rounded-lg overflow-hidden transition-colors ${
                    entry.isPrimary
                      ? "border-amber-500/40 bg-amber-500/5"
                      : "border-border bg-background"
                  }`}
                >
                  {/* Entry Header */}
                  <div
                    className="flex items-center gap-3 p-3 cursor-pointer hover:bg-muted/50"
                    onClick={() => toggleExpanded(entry.id)}
                  >
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setPrimary(entry.id);
                      }}
                      disabled={disabled || entry.isPrimary}
                      className={`p-1 rounded transition-colors ${
                        entry.isPrimary
                          ? "text-amber-500"
                          : "text-muted-foreground hover:text-amber-500"
                      }`}
                      title={entry.isPrimary ? "Primary funding source" : "Set as primary"}
                    >
                      <Star className={`h-4 w-4 ${entry.isPrimary ? "fill-current" : ""}`} />
                    </button>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">
                          {displayName}
                        </span>
                        {entry.grantNumber && (
                          <span className="text-sm text-muted-foreground truncate">
                            {entry.grantNumber}
                          </span>
                        )}
                      </div>
                      {entry.isPrimary && (
                        <span className="text-[10px] text-amber-600 font-medium">
                          Primary
                        </span>
                      )}
                    </div>

                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        removeEntry(entry.id);
                      }}
                      disabled={disabled}
                      className="p-1 rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                      title="Remove"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>

                    {isExpanded ? (
                      <ChevronUp className="h-4 w-4 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>

                  {/* Entry Details */}
                  {isExpanded && (
                    <div className="p-4 pt-0 space-y-4 border-t border-border/50">
                      {/* Agency + Grant Number Row */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
                        <div className="space-y-2">
                          <Label className="text-sm">
                            Funding Agency <span className="text-destructive">*</span>
                          </Label>
                          <Select
                            value={entry.agencyId}
                            onValueChange={(v) => updateEntry(entry.id, { agencyId: v })}
                            disabled={disabled}
                          >
                            <SelectTrigger>
                              <SelectValue placeholder="Select agency..." />
                            </SelectTrigger>
                            <SelectContent>
                              {FUNDING_AGENCIES.map((agency) => (
                                <SelectItem key={agency.id} value={agency.id}>
                                  {agency.name}
                                  {agency.country && (
                                    <span className="text-muted-foreground ml-1">
                                      ({agency.country})
                                    </span>
                                  )}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>

                          {entry.agencyId === "other" && (
                            <Input
                              value={entry.agencyOther || ""}
                              onChange={(e) =>
                                updateEntry(entry.id, { agencyOther: e.target.value })
                              }
                              placeholder="Enter agency name..."
                              disabled={disabled}
                              className="mt-2"
                            />
                          )}
                        </div>

                        <div className="space-y-2">
                          <Label className="text-sm">
                            Grant/Award Number <span className="text-destructive">*</span>
                          </Label>
                          <Input
                            value={entry.grantNumber}
                            onChange={(e) =>
                              updateEntry(entry.id, { grantNumber: e.target.value })
                            }
                            placeholder={getAgencyHint(entry.agencyId)}
                            disabled={disabled}
                          />
                        </div>
                      </div>

                      {/* Grant Title */}
                      <div className="space-y-2">
                        <Label className="text-sm">Grant/Project Title</Label>
                        <Input
                          value={entry.grantTitle || ""}
                          onChange={(e) =>
                            updateEntry(entry.id, { grantTitle: e.target.value })
                          }
                          placeholder="Official title of the funded project"
                          disabled={disabled}
                        />
                      </div>

                      {/* PI Row */}
                      <div className="space-y-2">
                        <Label className="text-sm">PI on Grant</Label>
                        <Input
                          value={entry.piName || ""}
                          onChange={(e) =>
                            updateEntry(entry.id, { piName: e.target.value })
                          }
                          placeholder="Principal investigator name"
                          disabled={disabled}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Add Button */}
        <Button
          type="button"
          variant="outline"
          onClick={addEntry}
          disabled={disabled}
          className="w-full border-dashed"
        >
          <Plus className="h-4 w-4 mr-2" />
          {entries.length === 0 ? "Add Funding Source" : "Add Another Funding Source"}
        </Button>

        {entries.length === 0 && !field.required && (
          <p className="text-xs text-muted-foreground text-center mt-2">
            Optional - you can skip this if your project is not grant-funded
          </p>
        )}
      </div>
    </div>
  );
}
