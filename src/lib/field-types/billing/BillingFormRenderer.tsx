"use client";

/**
 * Billing Form Renderer Component
 *
 * This component is rendered in the Order Form when displaying a billing field.
 * It allows users to enter Cost Center and PSP Element (SAP Project Structure Plan).
 */

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Receipt, AlertCircle, Check } from "lucide-react";
import { FormFieldDefinition } from "@/types/form-config";
import { BillingFieldValue, validatePspElement, getPspElementHint } from "./index";
import { BillingSettings, DEFAULT_BILLING_SETTINGS } from "@/lib/modules/types";

interface BillingFormRendererProps {
  field: FormFieldDefinition;
  value: BillingFieldValue | null;
  disabled?: boolean;
  onChange: (value: BillingFieldValue) => void;
}

export function BillingFormRenderer({
  field,
  value,
  disabled,
  onChange,
}: BillingFormRendererProps) {
  // Billing settings (could be fetched from API, using defaults for now)
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [pspError, setPspError] = useState<string | null>(null);
  const [pspValid, setPspValid] = useState<boolean>(false);

  // Fetch billing settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/admin/modules/billing");
        if (res.ok) {
          const data = await res.json();
          if (data.settings) {
            setSettings(data.settings);
          }
        }
      } catch {
        console.error("Failed to load billing settings");
      }
    };
    fetchSettings();
  }, []);

  const currentValue = value || { costCenter: "", pspElement: "" };

  const handleCostCenterChange = (costCenter: string) => {
    onChange({ ...currentValue, costCenter });
  };

  const handlePspChange = (pspElement: string) => {
    onChange({ ...currentValue, pspElement });

    // Validate on change
    if (pspElement.trim()) {
      const error = validatePspElement(pspElement, settings);
      setPspError(error);
      setPspValid(!error);
    } else {
      setPspError(null);
      setPspValid(false);
    }
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-start gap-3 mb-4">
          <div className="h-8 w-8 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
            <Receipt className="h-4 w-4 text-emerald-600" />
          </div>
          <div className="flex-1">
            <Label className="text-base font-medium">{field.label}</Label>
            {field.helpText && (
              <p className="text-sm text-muted-foreground mt-1">{field.helpText}</p>
            )}
          </div>
        </div>

        {/* Fields */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Cost Center */}
          {settings.costCenterEnabled && (
            <div className="space-y-2">
              <Label htmlFor="costCenter" className="text-sm">
                Cost Center
                {field.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              <Input
                id="costCenter"
                value={currentValue.costCenter || ""}
                onChange={(e) => handleCostCenterChange(e.target.value)}
                placeholder={settings.costCenterExample || "Enter cost center code"}
                disabled={disabled}
              />
              {settings.costCenterExample && (
                <p className="text-xs text-muted-foreground">
                  e.g., {settings.costCenterExample}
                </p>
              )}
            </div>
          )}

          {/* PSP Element */}
          {settings.pspEnabled && (
            <div className="space-y-2">
              <Label htmlFor="pspElement" className="text-sm">
                PSP Element
                {field.required && <span className="text-destructive ml-1">*</span>}
              </Label>
              <div className="relative">
                <Input
                  id="pspElement"
                  value={currentValue.pspElement || ""}
                  onChange={(e) => handlePspChange(e.target.value)}
                  placeholder={getPspElementHint(settings)}
                  disabled={disabled}
                  className={
                    pspError
                      ? "border-destructive focus-visible:ring-destructive pr-9"
                      : pspValid
                      ? "border-green-500 focus-visible:ring-green-500 pr-9"
                      : ""
                  }
                />
                {pspError && (
                  <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-destructive" />
                )}
                {pspValid && (
                  <Check className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-green-500" />
                )}
              </div>
              {pspError ? (
                <p className="text-xs text-destructive">{pspError}</p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  Format: {settings.pspExample}
                </p>
              )}
            </div>
          )}
        </div>

        {/* Note about billing */}
        <div className="mt-4 pt-4 border-t border-border/50">
          <p className="text-xs text-muted-foreground">
            Enter your internal billing codes for cost allocation. Contact your finance
            department if you need help finding your Cost Center or PSP Element.
          </p>
        </div>
      </div>
    </div>
  );
}
