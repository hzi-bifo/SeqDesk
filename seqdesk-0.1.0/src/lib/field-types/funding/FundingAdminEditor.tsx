"use client";

/**
 * Funding Admin Editor Component
 *
 * This component is rendered in the Form Builder when configuring a funding field.
 * It allows admins to configure field properties like label, help text, and required status.
 */

import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Wallet, Check } from "lucide-react";
import { FUNDING_AGENCIES } from "./index";

interface FundingAdminEditorProps {
  label: string;
  helpText: string;
  visible: boolean;
  required: boolean;
  onLabelChange: (label: string) => void;
  onHelpTextChange: (helpText: string) => void;
  onVisibleChange: (visible: boolean) => void;
  onRequiredChange: (required: boolean) => void;
}

export function FundingAdminEditor({
  label,
  helpText,
  visible,
  required,
  onLabelChange,
  onHelpTextChange,
  onVisibleChange,
  onRequiredChange,
}: FundingAdminEditorProps) {
  return (
    <div className="space-y-6 py-4">
      {/* Info Banner */}
      <div className="p-4 rounded-lg border border-amber-500/20 bg-amber-500/5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
            <Wallet className="h-5 w-5 text-amber-600" />
          </div>
          <div>
            <h3 className="font-semibold text-amber-700">Funding Information Field</h3>
            <p className="text-sm text-muted-foreground mt-1">
              This field allows users to add one or more funding sources with structured information
              including agency, grant number, project title, and PI details.
            </p>
          </div>
        </div>
      </div>

      {/* Field Settings */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Field Settings
          </h4>

          <div className="space-y-2">
            <Label htmlFor="fundingLabel">Field Label</Label>
            <Input
              id="fundingLabel"
              value={label}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="e.g., Funding Information"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="fundingHelpText">Help Text</Label>
            <Input
              id="fundingHelpText"
              value={helpText}
              onChange={(e) => onHelpTextChange(e.target.value)}
              placeholder="Instructions for users..."
            />
          </div>

          <div className="flex items-center gap-6 py-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={visible}
                onChange={(e) => onVisibleChange(e.target.checked)}
                className="rounded border-input h-4 w-4"
              />
              <span className="text-sm">Visible</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={required}
                onChange={(e) => onRequiredChange(e.target.checked)}
                className="rounded border-input h-4 w-4"
              />
              <span className="text-sm">Required</span>
            </label>
          </div>
        </div>

        <div className="space-y-4">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            Supported Agencies
          </h4>

          <div className="space-y-1 max-h-64 overflow-y-auto border border-border rounded-lg p-2">
            {FUNDING_AGENCIES.filter(a => a.id !== "other").map((agency) => (
              <div
                key={agency.id}
                className="flex items-center gap-2 px-2 py-1.5 rounded text-sm"
              >
                <Check className="h-3 w-3 text-amber-600" />
                <span>{agency.name}</span>
                {agency.country && (
                  <span className="text-xs text-muted-foreground">({agency.country})</span>
                )}
              </div>
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Users can also select &quot;Other&quot; for agencies not in this list.
          </p>
        </div>
      </div>

      {/* Data Collected */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Data Collected Per Funding Source
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {[
            { name: "Funding Agency", required: true },
            { name: "Grant/Award Number", required: true },
            { name: "Grant/Project Title", required: false },
            { name: "PI on Grant", required: false },
            { name: "Primary Flag", required: false },
          ].map((item) => (
            <div
              key={item.name}
              className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 text-sm"
            >
              <span>{item.name}</span>
              {item.required && (
                <span className="text-destructive text-xs">*</span>
              )}
            </div>
          ))}
        </div>
        <p className="text-xs text-muted-foreground">
          * Required fields. Users can add multiple funding sources and mark one as primary.
        </p>
      </div>
    </div>
  );
}
