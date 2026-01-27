"use client";

/**
 * Billing Admin Editor Component
 *
 * This component is rendered in the Form Builder when configuring a billing field.
 * It allows admins to configure field properties and shows current billing settings.
 */

import { useState, useEffect } from "react";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Receipt, Check, Settings, Loader2 } from "lucide-react";
import { BillingSettings, DEFAULT_BILLING_SETTINGS } from "@/lib/modules/types";

interface BillingAdminEditorProps {
  label: string;
  helpText: string;
  visible: boolean;
  required: boolean;
  onLabelChange: (label: string) => void;
  onHelpTextChange: (helpText: string) => void;
  onVisibleChange: (visible: boolean) => void;
  onRequiredChange: (required: boolean) => void;
}

export function BillingAdminEditor({
  label,
  helpText,
  visible,
  required,
  onLabelChange,
  onHelpTextChange,
  onVisibleChange,
  onRequiredChange,
}: BillingAdminEditorProps) {
  const [settings, setSettings] = useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loading, setLoading] = useState(true);

  // Fetch current billing settings
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
      } finally {
        setLoading(false);
      }
    };
    fetchSettings();
  }, []);

  return (
    <div className="space-y-6 py-4">
      {/* Info Banner */}
      <div className="p-4 rounded-lg border border-emerald-500/20 bg-emerald-500/5">
        <div className="flex items-start gap-3">
          <div className="h-10 w-10 rounded-lg bg-emerald-500/10 flex items-center justify-center flex-shrink-0">
            <Receipt className="h-5 w-5 text-emerald-600" />
          </div>
          <div>
            <h3 className="font-semibold text-emerald-700">Billing Information Field</h3>
            <p className="text-sm text-muted-foreground mt-1">
              This field collects internal billing codes (Cost Center and PSP Element)
              for cost allocation and financial tracking.
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
            <Label htmlFor="billingLabel">Field Label</Label>
            <Input
              id="billingLabel"
              value={label}
              onChange={(e) => onLabelChange(e.target.value)}
              placeholder="e.g., Billing Information"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="billingHelpText">Help Text</Label>
            <Input
              id="billingHelpText"
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
            Current Configuration
          </h4>

          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-3 border border-border rounded-lg p-4">
              {/* Cost Center Config */}
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-sm font-medium">Cost Center</span>
                  <p className="text-xs text-muted-foreground">
                    {settings.costCenterExample
                      ? `Example: ${settings.costCenterExample}`
                      : "Any format accepted"}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    settings.costCenterEnabled
                      ? "bg-green-500/10 text-green-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {settings.costCenterEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              {/* PSP Config */}
              <div className="flex items-center justify-between pt-2 border-t border-border/50">
                <div>
                  <span className="text-sm font-medium">PSP Element</span>
                  <p className="text-xs text-muted-foreground">
                    Format: {settings.pspExample}
                  </p>
                </div>
                <span
                  className={`text-xs px-2 py-0.5 rounded-full ${
                    settings.pspEnabled
                      ? "bg-green-500/10 text-green-600"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {settings.pspEnabled ? "Enabled" : "Disabled"}
                </span>
              </div>

              <div className="pt-2 border-t border-border/50">
                <a
                  href="/admin/modules"
                  className="text-xs text-primary hover:underline flex items-center gap-1"
                >
                  <Settings className="h-3 w-3" />
                  Configure in Modules settings
                </a>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Data Collected */}
      <div className="space-y-3">
        <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
          Data Collected
        </h4>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {[
            {
              name: "Cost Center",
              required: false,
              enabled: settings.costCenterEnabled,
            },
            { name: "PSP Element", required: false, enabled: settings.pspEnabled },
          ]
            .filter((item) => item.enabled)
            .map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-2 px-3 py-2 rounded-lg bg-muted/30 text-sm"
              >
                <Check className="h-3 w-3 text-emerald-600" />
                <span>{item.name}</span>
                {item.required && <span className="text-destructive text-xs">*</span>}
              </div>
            ))}
        </div>
        <p className="text-xs text-muted-foreground">
          PSP Elements are validated against the configured format. Cost Center accepts
          any format by default.
        </p>
      </div>
    </div>
  );
}
