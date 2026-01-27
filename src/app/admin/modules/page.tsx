"use client";

import { useModules } from "@/lib/modules";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  Package,
  Mail,
  Clock,
  Settings,
  Plus,
  X,
  Shield,
  FormInput,
  CheckCircle2,
  Lock,
  Bell,
  ArrowRight,
  Receipt,
} from "lucide-react";
import { useState, useEffect } from "react";
import { toast } from "sonner";
import {
  type AccountValidationSettings,
  type BillingSettings,
  type ModuleCategory,
  MODULE_CATEGORIES,
  DEFAULT_BILLING_SETTINGS,
} from "@/lib/modules/types";

export default function ModulesPage() {
  const {
    availableModules,
    moduleStates,
    setModuleEnabled,
    loading,
  } = useModules();
  const [updating, setUpdating] = useState<string | null>(null);

  // Account validation settings state
  const [accountValidationSettings, setAccountValidationSettings] =
    useState<AccountValidationSettings>({
      allowedDomains: [],
      enforceValidation: true,
    });
  const [newDomain, setNewDomain] = useState("");
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [savingSettings, setSavingSettings] = useState(false);

  // Billing settings state
  const [billingSettings, setBillingSettings] =
    useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loadingBillingSettings, setLoadingBillingSettings] = useState(true);
  const [savingBillingSettings, setSavingBillingSettings] = useState(false);

  // Fetch account validation settings
  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch("/api/admin/modules/account-validation");
        if (res.ok) {
          const data = await res.json();
          setAccountValidationSettings(data.settings);
        }
      } catch {
        console.error("Failed to load account validation settings");
      } finally {
        setLoadingSettings(false);
      }
    };
    fetchSettings();
  }, []);

  // Fetch billing settings
  useEffect(() => {
    const fetchBillingSettings = async () => {
      try {
        const res = await fetch("/api/admin/modules/billing");
        if (res.ok) {
          const data = await res.json();
          setBillingSettings(data.settings);
        }
      } catch {
        console.error("Failed to load billing settings");
      } finally {
        setLoadingBillingSettings(false);
      }
    };
    fetchBillingSettings();
  }, []);

  const handleToggle = async (moduleId: string, enabled: boolean) => {
    setUpdating(moduleId);
    try {
      await setModuleEnabled(moduleId, enabled);
      toast.success(`${enabled ? "Enabled" : "Disabled"} module successfully`);
    } catch {
      toast.error("Failed to update module");
    } finally {
      setUpdating(null);
    }
  };

  const handleAddDomain = () => {
    const domain = newDomain.trim().toLowerCase();
    if (!domain) return;

    // Basic validation
    if (!domain.includes(".")) {
      toast.error("Please enter a valid domain (e.g., youruniversity.edu)");
      return;
    }

    if (accountValidationSettings.allowedDomains.includes(domain)) {
      toast.error("This domain is already in the list");
      return;
    }

    setAccountValidationSettings((prev) => ({
      ...prev,
      allowedDomains: [...prev.allowedDomains, domain],
    }));
    setNewDomain("");
  };

  const handleRemoveDomain = (domain: string) => {
    setAccountValidationSettings((prev) => ({
      ...prev,
      allowedDomains: prev.allowedDomains.filter((d) => d !== domain),
    }));
  };

  const handleSaveSettings = async () => {
    setSavingSettings(true);
    try {
      const res = await fetch("/api/admin/modules/account-validation", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: accountValidationSettings }),
      });

      if (!res.ok) {
        throw new Error("Failed to save");
      }

      toast.success("Settings saved successfully");
    } catch {
      toast.error("Failed to save settings");
    } finally {
      setSavingSettings(false);
    }
  };

  const handleSaveBillingSettings = async () => {
    setSavingBillingSettings(true);
    try {
      const res = await fetch("/api/admin/modules/billing", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ settings: billingSettings }),
      });

      if (!res.ok) {
        throw new Error("Failed to save");
      }

      toast.success("Billing settings saved successfully");
    } catch {
      toast.error("Failed to save billing settings");
    } finally {
      setSavingBillingSettings(false);
    }
  };

  if (loading) {
    return (
      <PageContainer>
        <div className="flex items-center justify-center min-h-[400px]">
          <Loader2 className="h-8 w-8 animate-spin text-primary" />
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="space-y-8">
        {/* Header */}
        <div className="flex items-center gap-4">
          <div className="h-12 w-12 rounded-lg bg-primary/10 flex items-center justify-center">
            <Package className="h-6 w-6 text-primary" />
          </div>
          <div>
            <h1 className="text-3xl font-bold">Modules</h1>
            <p className="text-muted-foreground">
              Enable or disable features for your installation
            </p>
          </div>
        </div>

        {/* Category icon mapping */}
        {(() => {
          const categoryIcons: Record<ModuleCategory, React.ReactNode> = {
            "order-form": <FormInput className="h-5 w-5" />,
            validation: <CheckCircle2 className="h-5 w-5" />,
            access: <Lock className="h-5 w-5" />,
            communication: <Bell className="h-5 w-5" />,
          };

          const categoryColors: Record<ModuleCategory, string> = {
            "order-form": "bg-emerald-500/10 text-emerald-600",
            validation: "bg-violet-500/10 text-violet-600",
            access: "bg-amber-500/10 text-amber-600",
            communication: "bg-blue-500/10 text-blue-600",
          };

          // Group modules by category
          const categories = Object.keys(MODULE_CATEGORIES) as ModuleCategory[];

          return categories.map((category) => {
            const categoryModules = availableModules.filter(
              (m) => m.category === category
            );
            if (categoryModules.length === 0) return null;

            const categoryInfo = MODULE_CATEGORIES[category];

            return (
              <div key={category} className="space-y-4">
                {/* Category Header */}
                <div className="flex items-center gap-3">
                  <div
                    className={`h-10 w-10 rounded-lg flex items-center justify-center ${categoryColors[category]}`}
                  >
                    {categoryIcons[category]}
                  </div>
                  <div>
                    <h2 className="text-lg font-semibold">{categoryInfo.label}</h2>
                    <p className="text-sm text-muted-foreground">
                      {categoryInfo.description}
                    </p>
                  </div>
                </div>

                {/* Module Cards */}
                <div className="grid gap-3 pl-[52px]">
                  {categoryModules.map((module) => {
                    const isEnabled = moduleStates[module.id] ?? false;
                    const isUpdating = updating === module.id;
                    const isComingSoon = module.comingSoon;

                    return (
                      <GlassCard
                        key={module.id}
                        className={`p-5 ${isComingSoon ? "opacity-60" : ""}`}
                      >
                        <div className="flex items-start justify-between gap-4">
                          <div className="flex-1 space-y-2">
                            <div className="flex items-center gap-3 flex-wrap">
                              <h3 className="text-base font-semibold">{module.name}</h3>
                              {isComingSoon ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-medium flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Coming Soon
                                </span>
                              ) : isEnabled ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">
                                  Active
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                  Inactive
                                </span>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {module.description}
                            </p>
                            {module.featureLocation && (
                              <p className="text-xs text-primary flex items-center gap-1">
                                <ArrowRight className="h-3 w-3" />
                                {module.featureLocation}
                              </p>
                            )}
                          </div>

                          <div className="flex items-center gap-3 flex-shrink-0">
                            {isUpdating && (
                              <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                            )}
                            <Switch
                              id={module.id}
                              checked={isEnabled}
                              onCheckedChange={(checked) =>
                                handleToggle(module.id, checked)
                              }
                              disabled={isUpdating || isComingSoon}
                            />
                            <Label htmlFor={module.id} className="sr-only">
                              Toggle {module.name}
                            </Label>
                          </div>
                        </div>

                        {/* Account Validation Settings Panel */}
                        {module.id === "account-validation" && isEnabled && (
                    <div className="mt-6 pt-6 border-t border-border">
                      <div className="flex items-center gap-2 mb-4">
                        <Shield className="h-4 w-4 text-primary" />
                        <h4 className="font-medium">Allowed Email Domains</h4>
                      </div>

                      {loadingSettings ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : (
                        <div className="space-y-4">
                          <p className="text-sm text-muted-foreground">
                            Only users with email addresses from these domains
                            can register. Leave empty to allow all domains.
                          </p>

                          {/* Domain list */}
                          <div className="flex flex-wrap gap-2">
                            {accountValidationSettings.allowedDomains.map(
                              (domain) => (
                                <span
                                  key={domain}
                                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-primary/10 text-primary text-sm"
                                >
                                  @{domain}
                                  <button
                                    type="button"
                                    onClick={() => handleRemoveDomain(domain)}
                                    className="hover:bg-primary/20 rounded-full p-0.5"
                                  >
                                    <X className="h-3 w-3" />
                                  </button>
                                </span>
                              )
                            )}
                            {accountValidationSettings.allowedDomains.length ===
                              0 && (
                              <span className="text-sm text-muted-foreground italic">
                                No domains configured - all emails allowed
                              </span>
                            )}
                          </div>

                          {/* Add domain */}
                          <div className="flex gap-2 max-w-md">
                            <div className="relative flex-1">
                              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground">
                                @
                              </span>
                              <Input
                                value={newDomain}
                                onChange={(e) => setNewDomain(e.target.value)}
                                placeholder="youruniversity.edu"
                                className="pl-7"
                                onKeyDown={(e) =>
                                  e.key === "Enter" && handleAddDomain()
                                }
                              />
                            </div>
                            <Button
                              type="button"
                              variant="outline"
                              onClick={handleAddDomain}
                            >
                              <Plus className="h-4 w-4 mr-1" />
                              Add
                            </Button>
                          </div>

                          {/* Enforce validation toggle */}
                          <label className="flex items-center gap-3 cursor-pointer">
                            <input
                              type="checkbox"
                              checked={
                                accountValidationSettings.enforceValidation
                              }
                              onChange={(e) =>
                                setAccountValidationSettings((prev) => ({
                                  ...prev,
                                  enforceValidation: e.target.checked,
                                }))
                              }
                              className="rounded border-input h-4 w-4"
                            />
                            <div>
                              <span className="text-sm font-medium">
                                Block unallowed domains
                              </span>
                              <p className="text-xs text-muted-foreground">
                                When enabled, users from other domains cannot
                                register. When disabled, they can register but
                                will see a warning.
                              </p>
                            </div>
                          </label>

                          {/* Save button */}
                          <div className="pt-2">
                            <Button
                              onClick={handleSaveSettings}
                              disabled={savingSettings}
                            >
                              {savingSettings ? (
                                <>
                                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                  Saving...
                                </>
                              ) : (
                                "Save Settings"
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                        {/* Billing Settings Panel */}
                        {module.id === "billing-info" && isEnabled && (
                          <div className="mt-6 pt-6 border-t border-border">
                            <div className="flex items-center gap-2 mb-4">
                              <Receipt className="h-4 w-4 text-teal-600" />
                              <h4 className="font-medium">PSP Element Format</h4>
                            </div>

                            {loadingBillingSettings ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              </div>
                            ) : (
                              <div className="space-y-4">
                                <p className="text-sm text-muted-foreground">
                                  Configure the format for PSP Elements (SAP Project Structure Plan).
                                  Format: Prefix-MainPart-Suffix
                                </p>

                                {/* PSP Format Configuration */}
                                <div className="space-y-4">
                                  {/* Enable/Disable toggles */}
                                  <div className="flex items-center gap-6">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={billingSettings.pspEnabled}
                                        onChange={(e) =>
                                          setBillingSettings((prev) => ({
                                            ...prev,
                                            pspEnabled: e.target.checked,
                                          }))
                                        }
                                        className="rounded border-input h-4 w-4"
                                      />
                                      <span className="text-sm">PSP Element</span>
                                    </label>
                                    <label className="flex items-center gap-2 cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={billingSettings.costCenterEnabled}
                                        onChange={(e) =>
                                          setBillingSettings((prev) => ({
                                            ...prev,
                                            costCenterEnabled: e.target.checked,
                                          }))
                                        }
                                        className="rounded border-input h-4 w-4"
                                      />
                                      <span className="text-sm">Cost Center</span>
                                    </label>
                                  </div>

                                  {/* PSP Format Settings */}
                                  {billingSettings.pspEnabled && (
                                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 p-4 border border-border/50 rounded-lg bg-muted/20">
                                      <div className="space-y-2">
                                        <Label className="text-xs">Prefix Range</Label>
                                        <div className="flex items-center gap-2">
                                          <Input
                                            type="number"
                                            min={0}
                                            max={9}
                                            value={billingSettings.pspPrefixRange.min}
                                            onChange={(e) =>
                                              setBillingSettings((prev) => ({
                                                ...prev,
                                                pspPrefixRange: {
                                                  ...prev.pspPrefixRange,
                                                  min: parseInt(e.target.value) || 0,
                                                },
                                              }))
                                            }
                                            className="w-16 h-8 text-center"
                                          />
                                          <span className="text-muted-foreground">to</span>
                                          <Input
                                            type="number"
                                            min={0}
                                            max={9}
                                            value={billingSettings.pspPrefixRange.max}
                                            onChange={(e) =>
                                              setBillingSettings((prev) => ({
                                                ...prev,
                                                pspPrefixRange: {
                                                  ...prev.pspPrefixRange,
                                                  max: parseInt(e.target.value) || 9,
                                                },
                                              }))
                                            }
                                            className="w-16 h-8 text-center"
                                          />
                                        </div>
                                      </div>

                                      <div className="space-y-2">
                                        <Label className="text-xs">Main Part Digits</Label>
                                        <Input
                                          type="number"
                                          min={1}
                                          max={20}
                                          value={billingSettings.pspMainDigits}
                                          onChange={(e) =>
                                            setBillingSettings((prev) => ({
                                              ...prev,
                                              pspMainDigits: parseInt(e.target.value) || 7,
                                            }))
                                          }
                                          className="w-20 h-8 text-center"
                                        />
                                      </div>

                                      <div className="space-y-2">
                                        <Label className="text-xs">Suffix Range</Label>
                                        <div className="flex items-center gap-2">
                                          <Input
                                            type="number"
                                            min={0}
                                            max={99}
                                            value={billingSettings.pspSuffixRange.min}
                                            onChange={(e) =>
                                              setBillingSettings((prev) => ({
                                                ...prev,
                                                pspSuffixRange: {
                                                  ...prev.pspSuffixRange,
                                                  min: parseInt(e.target.value) || 0,
                                                },
                                              }))
                                            }
                                            className="w-16 h-8 text-center"
                                          />
                                          <span className="text-muted-foreground">to</span>
                                          <Input
                                            type="number"
                                            min={0}
                                            max={99}
                                            value={billingSettings.pspSuffixRange.max}
                                            onChange={(e) =>
                                              setBillingSettings((prev) => ({
                                                ...prev,
                                                pspSuffixRange: {
                                                  ...prev.pspSuffixRange,
                                                  max: parseInt(e.target.value) || 99,
                                                },
                                              }))
                                            }
                                            className="w-16 h-8 text-center"
                                          />
                                        </div>
                                      </div>
                                    </div>
                                  )}

                                  {/* Example */}
                                  <div className="space-y-2">
                                    <Label className="text-xs">Example Value</Label>
                                    <Input
                                      value={billingSettings.pspExample}
                                      onChange={(e) =>
                                        setBillingSettings((prev) => ({
                                          ...prev,
                                          pspExample: e.target.value,
                                        }))
                                      }
                                      placeholder="e.g., 1-1234567-99"
                                      className="max-w-xs"
                                    />
                                    <p className="text-xs text-muted-foreground">
                                      This example will be shown to users as a hint
                                    </p>
                                  </div>

                                  {/* Cost Center Example */}
                                  {billingSettings.costCenterEnabled && (
                                    <div className="space-y-2">
                                      <Label className="text-xs">Cost Center Example</Label>
                                      <Input
                                        value={billingSettings.costCenterExample || ""}
                                        onChange={(e) =>
                                          setBillingSettings((prev) => ({
                                            ...prev,
                                            costCenterExample: e.target.value,
                                          }))
                                        }
                                        placeholder="e.g., 12345678"
                                        className="max-w-xs"
                                      />
                                    </div>
                                  )}

                                  {/* Save button */}
                                  <div className="pt-2">
                                    <Button
                                      onClick={handleSaveBillingSettings}
                                      disabled={savingBillingSettings}
                                    >
                                      {savingBillingSettings ? (
                                        <>
                                          <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                          Saving...
                                        </>
                                      ) : (
                                        "Save Settings"
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </div>
                        )}
                      </GlassCard>
                    );
                  })}
                </div>
              </div>
            );
          });
        })()}

        {/* Info */}
        <div className="text-sm text-muted-foreground bg-muted/30 rounded-lg p-4">
          <p>
            Disabling a module will hide its features throughout the
            application. Existing data will be preserved and will be available
            again when the module is re-enabled.
          </p>
        </div>
      </div>
    </PageContainer>
  );
}
