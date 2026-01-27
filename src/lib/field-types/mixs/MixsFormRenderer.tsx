"use client";

/**
 * MIxS Form Renderer Component
 *
 * This component is rendered in the Order Form when displaying a MIxS field.
 * It shows a checklist selector and dynamically renders the fields from
 * the selected checklist.
 */

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Leaf } from "lucide-react";
import { FormFieldDefinition } from "@/types/form-config";
import { MixsTemplate } from "./index";

interface MixsFormRendererProps {
  field: FormFieldDefinition;
  templates: MixsTemplate[];
  selectedChecklist: string;
  checklistFields?: FormFieldDefinition[];
  fieldValues?: Record<string, unknown>;
  disabled?: boolean;
  onChecklistChange: (checklistName: string) => void;
  onFieldChange?: (fieldName: string, value: unknown) => void;
  renderField?: (field: FormFieldDefinition) => React.ReactNode;
  /** If true, only shows the checklist selector without the fields (for order-level selection) */
  selectorOnly?: boolean;
  /** Selected field names when in selector mode */
  selectedFields?: string[];
  /** Callback when field selection changes */
  onFieldSelectionChange?: (fieldNames: string[]) => void;
}

export function MixsFormRenderer({
  field,
  templates,
  selectedChecklist,
  checklistFields = [],
  fieldValues = {},
  disabled,
  onChecklistChange,
  onFieldChange,
  renderField,
  selectorOnly = false,
  selectedFields = [],
  onFieldSelectionChange,
}: MixsFormRendererProps) {
  // Filter templates to only show enabled ones
  const enabledTemplates = templates.filter(
    (t) => field.mixsChecklists?.includes(t.name)
  );

  if (enabledTemplates.length === 0) {
    return (
      <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5 text-amber-700 text-sm">
        No MIxS checklists are configured. Please contact the administrator.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Checklist Selector */}
      <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
            <Leaf className="h-4 w-4 text-emerald-600" />
          </div>
          <div>
            <Label className="text-base font-medium">{field.label}</Label>
            {field.helpText && (
              <p className="text-sm text-muted-foreground mt-1">{field.helpText}</p>
            )}
          </div>
        </div>

        <Select
          value={selectedChecklist}
          onValueChange={onChecklistChange}
          disabled={disabled}
        >
          <SelectTrigger className="max-w-md h-11">
            <SelectValue placeholder="Select environment type..." />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="none">None (skip MIxS metadata)</SelectItem>
            {enabledTemplates.map((template) => (
              <SelectItem key={template.name} value={template.name}>
                {template.name} ({template.fields.length} fields)
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

      </div>

      {/* Field selection when in selector-only mode */}
      {selectorOnly && selectedChecklist && selectedChecklist !== "none" && (() => {
        const template = enabledTemplates.find(t => t.name === selectedChecklist);
        if (!template) return null;

        const allFieldNames = template.fields.map(f => f.name);
        const allSelected = selectedFields.length === allFieldNames.length;
        const noneSelected = selectedFields.length === 0;

        const toggleField = (fieldName: string) => {
          if (!onFieldSelectionChange) return;
          if (selectedFields.includes(fieldName)) {
            onFieldSelectionChange(selectedFields.filter(n => n !== fieldName));
          } else {
            onFieldSelectionChange([...selectedFields, fieldName]);
          }
        };

        const selectAll = () => {
          if (onFieldSelectionChange) {
            onFieldSelectionChange(allFieldNames);
          }
        };

        const selectNone = () => {
          if (onFieldSelectionChange) {
            onFieldSelectionChange([]);
          }
        };

        return (
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-emerald-700">
                Select fields to collect per sample
              </p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={selectAll}
                  disabled={disabled || allSelected}
                  className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                >
                  Select all
                </button>
                <span className="text-muted-foreground">|</span>
                <button
                  type="button"
                  onClick={selectNone}
                  disabled={disabled || noneSelected}
                  className="text-xs text-emerald-600 hover:text-emerald-700 disabled:opacity-50"
                >
                  Clear
                </button>
              </div>
            </div>

            <div className="border border-emerald-500/20 rounded-lg divide-y divide-emerald-500/10 max-h-64 overflow-y-auto">
              {template.fields.map((templateField) => {
                const isSelected = selectedFields.includes(templateField.name);
                return (
                  <label
                    key={templateField.name}
                    className={`flex items-start gap-3 p-3 cursor-pointer transition-colors ${
                      isSelected ? "bg-emerald-500/5" : "hover:bg-muted/50"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={isSelected}
                      onChange={() => toggleField(templateField.name)}
                      disabled={disabled}
                      className="mt-0.5 h-4 w-4 rounded border-emerald-500/50 text-emerald-600 focus:ring-emerald-500/30"
                    />
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm font-medium ${isSelected ? "text-emerald-700" : ""}`}>
                        {templateField.label}
                        {templateField.required && (
                          <span className="text-destructive ml-1">*</span>
                        )}
                      </p>
                      {templateField.helpText && (
                        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                          {templateField.helpText}
                        </p>
                      )}
                    </div>
                  </label>
                );
              })}
            </div>

            <p className="text-xs text-muted-foreground">
              {selectedFields.length} of {template.fields.length} fields selected.
              {selectedFields.length > 0 && " These will be shown when adding samples."}
            </p>
          </div>
        );
      })()}

      {/* Selected Checklist Fields - only shown when not in selector-only mode */}
      {!selectorOnly && selectedChecklist && selectedChecklist !== "none" && checklistFields.length > 0 && (
        <div className="space-y-6 pl-4 border-l-2 border-emerald-500/30">
          <div className="flex items-center gap-2 text-sm">
            <Leaf className="h-4 w-4 text-emerald-600" />
            <span className="font-medium text-emerald-700">
              {selectedChecklist}
            </span>
            <span className="text-muted-foreground">
              - {checklistFields.length} fields
            </span>
          </div>

          {renderField ? (
            // Use provided renderer
            checklistFields.map((mField) => (
              <div key={mField.id}>{renderField(mField)}</div>
            ))
          ) : (
            // Default rendering
            checklistFields.map((mField) => (
              <DefaultFieldRenderer
                key={mField.id}
                field={mField}
                value={fieldValues[mField.name]}
                onChange={(value) => onFieldChange && onFieldChange(mField.name, value)}
                disabled={disabled}
              />
            ))
          )}
        </div>
      )}
    </div>
  );
}

// Default field renderer for MIxS fields
function DefaultFieldRenderer({
  field,
  value,
  onChange,
  disabled,
}: {
  field: FormFieldDefinition;
  value: unknown;
  onChange: (value: unknown) => void;
  disabled?: boolean;
}) {
  const stringValue = value !== undefined && value !== null ? String(value) : "";

  switch (field.type) {
    case "select":
      return (
        <div className="space-y-2">
          <Label>
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Select
            value={stringValue}
            onValueChange={onChange}
            disabled={disabled}
          >
            <SelectTrigger>
              <SelectValue placeholder={field.placeholder || `Select ${field.label}...`} />
            </SelectTrigger>
            <SelectContent>
              {field.options?.map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {field.helpText && (
            <p className="text-xs text-muted-foreground">{field.helpText}</p>
          )}
        </div>
      );

    case "textarea":
      return (
        <div className="space-y-2">
          <Label>
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          <textarea
            value={stringValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder}
            disabled={disabled}
            className="w-full min-h-[100px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-ring"
          />
          {field.helpText && (
            <p className="text-xs text-muted-foreground">{field.helpText}</p>
          )}
        </div>
      );

    default:
      return (
        <div className="space-y-2">
          <Label>
            {field.label}
            {field.required && <span className="text-destructive ml-1">*</span>}
          </Label>
          <Input
            type={field.type === "number" ? "number" : "text"}
            value={stringValue}
            onChange={(e) => onChange(e.target.value)}
            placeholder={field.placeholder || field.example}
            disabled={disabled}
          />
          {field.helpText && (
            <p className="text-xs text-muted-foreground">{field.helpText}</p>
          )}
        </div>
      );
  }
}
