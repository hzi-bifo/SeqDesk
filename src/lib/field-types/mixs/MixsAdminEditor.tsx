"use client";

/**
 * MIxS Admin Editor Component
 *
 * This component is rendered in the Form Builder when editing a MIxS field.
 * It allows admins to configure which checklists are available for users.
 */

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Leaf, Loader2, AlertTriangle } from "lucide-react";
import { MixsTemplate } from "./index";

interface MixsAdminEditorProps {
  label: string;
  helpText: string;
  visible: boolean;
  required: boolean;
  mixsChecklists: string[];
  templates: MixsTemplate[];
  templatesLoading: boolean;
  onLabelChange: (value: string) => void;
  onHelpTextChange: (value: string) => void;
  onVisibleChange: (value: boolean) => void;
  onRequiredChange: (value: boolean) => void;
  onChecklistToggle: (checklistName: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export function MixsAdminEditor({
  label,
  helpText,
  visible,
  required,
  mixsChecklists,
  templates,
  templatesLoading,
  onLabelChange,
  onHelpTextChange,
  onVisibleChange,
  onRequiredChange,
  onChecklistToggle,
  onSelectAll,
  onClearAll,
}: MixsAdminEditorProps) {
  return (
    <div className="space-y-6 py-4">
      {/* Basic Settings */}
      <div className="grid grid-cols-2 gap-4">
        <div className="space-y-2">
          <Label htmlFor="fieldLabel">Display Label</Label>
          <Input
            id="fieldLabel"
            value={label}
            onChange={(e) => onLabelChange(e.target.value)}
            placeholder="e.g., Sample Metadata (MIxS)"
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="fieldHelpText">Help Text</Label>
          <Input
            id="fieldHelpText"
            value={helpText}
            onChange={(e) => onHelpTextChange(e.target.value)}
            placeholder="Instructions for users"
          />
        </div>
      </div>

      <div className="flex items-center gap-6">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={visible}
            onChange={(e) => onVisibleChange(e.target.checked)}
            className="rounded border-input h-4 w-4"
          />
          <span className="text-sm">Visible on form</span>
        </label>
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={required}
            onChange={(e) => onRequiredChange(e.target.checked)}
            className="rounded border-input h-4 w-4"
          />
          <span className="text-sm">Require checklist selection</span>
        </label>
      </div>

      {/* Checklist Configuration */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="font-medium">Available Checklists</h3>
            <p className="text-sm text-muted-foreground">
              Select which MIxS environment checklists users can choose from
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onSelectAll}
            >
              Select All
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={onClearAll}
            >
              Clear
            </Button>
          </div>
        </div>

        <div className="border border-border rounded-lg divide-y divide-border">
          {templatesLoading ? (
            <div className="p-4 text-center text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin mx-auto mb-2" />
              Loading checklists...
            </div>
          ) : templates.length === 0 ? (
            <div className="p-4 text-center text-muted-foreground">
              <p>No MIxS templates found.</p>
              <p className="text-xs mt-1">
                Add JSON files with category: &quot;mixs&quot; to data/field-templates/
              </p>
            </div>
          ) : (
            templates.map((template) => {
              const isEnabled = mixsChecklists.includes(template.name);
              return (
                <div
                  key={template.name}
                  className={`p-4 transition-colors ${isEnabled ? "bg-emerald-500/5" : ""}`}
                >
                  <div className="flex items-start gap-3">
                    <button
                      type="button"
                      onClick={() => onChecklistToggle(template.name)}
                      className={`mt-0.5 relative w-10 h-5 rounded-full transition-colors flex-shrink-0 ${
                        isEnabled ? "bg-emerald-500" : "bg-muted"
                      }`}
                    >
                      <span
                        className={`absolute top-0.5 left-0.5 w-4 h-4 rounded-full bg-white transition-transform shadow-sm ${
                          isEnabled ? "translate-x-5" : "translate-x-0"
                        }`}
                      />
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="font-medium">{template.name}</p>
                        <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                          {template.fields.length} fields
                        </span>
                        {template.version && (
                          <span className="text-xs text-muted-foreground">v{template.version}</span>
                        )}
                      </div>
                      <p className="text-sm text-muted-foreground mt-0.5">{template.description}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {mixsChecklists.length === 0 && templates.length > 0 && (
          <p className="text-sm text-amber-600 flex items-center gap-2">
            <AlertTriangle className="h-4 w-4" />
            Select at least one checklist for users to choose from
          </p>
        )}

        {mixsChecklists.length > 0 && (
          <p className="text-sm text-emerald-600">
            {mixsChecklists.length} checklist{mixsChecklists.length !== 1 ? "s" : ""} enabled.
            Users will select one when creating orders.
          </p>
        )}
      </div>

      {/* Info box */}
      <div className="p-4 rounded-lg bg-muted/50 border border-border">
        <div className="flex items-start gap-3">
          <Leaf className="h-5 w-5 text-emerald-600 flex-shrink-0 mt-0.5" />
          <div>
            <h4 className="font-medium text-sm mb-2">How MIxS Metadata Works</h4>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>1. Users select an environment type (e.g., Soil, Water, Host-Associated)</li>
              <li>2. The corresponding MIxS metadata fields appear below the selector</li>
              <li>3. Users fill in the relevant metadata for their samples</li>
              <li>4. Data is stored with the order for ENA/INSDC submission</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
