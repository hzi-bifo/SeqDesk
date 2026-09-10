"use client";

import { useModules } from "@/lib/modules";
import { useDeploymentProfile } from "@/components/deployment-profile/DeploymentProfileProvider";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { PageContainer } from "@/components/layout/PageContainer";
import { GlassCard } from "@/components/ui/glass-card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import {
  Loader2,
  Clock,
  Plus,
  X,
  Shield,
  ArrowRight,
  Receipt,
  FileText,
  Search,
  Package,
  Database,
  Building2,
  FlaskConical,
  Mail,
  ChevronDown,
} from "lucide-react";
import { Suspense, useState, useEffect, useCallback } from "react";
import { notifyPanel } from "@/lib/notifications/client";
import { toast } from "@/components/ui/toast";
import { PageLoader } from "@/components/ui/page-loader";
import {
  type AccountValidationSettings,
  type BillingSettings,
  type ModuleCategory,
  MODULE_CATEGORIES,
  DEFAULT_BILLING_SETTINGS,
  isAlwaysEnabledModule,
} from "@/lib/modules/types";
import {
  getFormModuleIntegration,
  hasModuleField,
} from "@/lib/modules/form-integration";
import {
  type FormFieldDefinition,
  type FormFieldGroup,
} from "@/types/form-config";
import { importModuleCatalog } from "@/lib/modules/import-catalog";

const CATEGORY_ICONS = {
  "data-sources": Database,
  "order-form": FileText,
  validation: Shield,
  access: Shield,
  communication: Mail,
  analysis: FlaskConical,
};

const MODULE_SETTINGS_LINKS: Record<string, { href: string; label: string }> = {
  "sequencing-management": { href: "/admin/form-builder", label: "Configure facility forms" },
  "notifications": { href: "/admin/settings/notifications", label: "Configure notifications" },
  "dynamic-studies": { href: "/admin/study-definitions", label: "Configure study definitions" },
  "explore": { href: "/admin/settings/analysis", label: "Configure report analysis" },
};

const MODULE_BUILDER_LINKS: Record<string, Array<{ href: string; label: string }>> = {
  "mixs-metadata": [{ href: "/admin/study-form-builder", label: "Study Form Builder" }],
  "funding-info": [{ href: "/admin/study-form-builder", label: "Study Form Builder" }],
  "billing-info": [{ href: "/admin/form-builder", label: "Sequencing Order Form Builder" }],
  "sequencing-tech": [
    { href: "/admin/form-builder", label: "Sequencing Order Form Builder" },
    { href: "/admin/sequencing-run-form-builder", label: "Run Assignment Form Builder" },
  ],
  "ena-sample-fields": [{ href: "/admin/form-builder", label: "Sequencing Order Form Builder" }],
  "ai-validation": [{ href: "/admin/form-builder", label: "Sequencing Order Form Builder" }],
};

interface OrderFormConfigState {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  enabledMixsChecklists: string[];
}

interface StudyFormConfigState {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
}

function ModulesPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const selectedCategory = searchParams.get("category");
  const activeCategory = selectedCategory && Object.hasOwn(MODULE_CATEGORIES, selectedCategory)
    ? selectedCategory as ModuleCategory : "all";
  const [search, setSearch] = useState("");
  const {
    availableModules,
    moduleStates,
    isModuleEnabled,
    setModuleEnabled,
    loading,
    error,
    refresh,
    setGlobalDisabled,
    globalDisabled,
    incompatibleModules,
  } = useModules();
  const deploymentProfile = useDeploymentProfile();
  const [updating, setUpdating] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [resumeDialogOpen, setResumeDialogOpen] = useState(false);
  const [resumingModules, setResumingModules] = useState(false);
  const [resumeError, setResumeError] = useState<string | null>(null);

  // Account validation settings state
  const [accountValidationSettings, setAccountValidationSettings] =
    useState<AccountValidationSettings>({
      allowedDomains: [],
      enforceValidation: true,
    });
  const [newDomain, setNewDomain] = useState("");
  const [loadingSettings, setLoadingSettings] = useState(true);
  const [accountSettingsError, setAccountSettingsError] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  // Billing settings state
  const [billingSettings, setBillingSettings] =
    useState<BillingSettings>(DEFAULT_BILLING_SETTINGS);
  const [loadingBillingSettings, setLoadingBillingSettings] = useState(true);
  const [billingSettingsError, setBillingSettingsError] = useState(false);
  const [savingBillingSettings, setSavingBillingSettings] = useState(false);
  const [orderFormConfig, setOrderFormConfig] =
    useState<OrderFormConfigState | null>(null);
  const [studyFormConfig, setStudyFormConfig] =
    useState<StudyFormConfigState | null>(null);
  const [loadingFormConfigs, setLoadingFormConfigs] = useState(true);
  const [formConfigError, setFormConfigError] = useState(false);
  const [runningAction, setRunningAction] = useState<string | null>(null);

  // Fetch account validation settings
  const fetchAccountSettings = useCallback(async () => {
      setLoadingSettings(true);
      try {
        const res = await fetch("/api/admin/modules/account-validation");
        if (!res.ok) throw new Error("Failed to load account settings");
          const data = await res.json();
          if (!data.settings || !Array.isArray(data.settings.allowedDomains)) throw new Error("Invalid account settings");
          setAccountValidationSettings(data.settings);
          setAccountSettingsError(false);
      } catch {
        setAccountSettingsError(true);
        console.error("Failed to load account validation settings");
      } finally {
        setLoadingSettings(false);
      }
  }, []);
  useEffect(() => { void fetchAccountSettings(); }, [fetchAccountSettings]);

  // Fetch billing settings
  const fetchBillingSettings = useCallback(async () => {
      setLoadingBillingSettings(true);
      try {
        const res = await fetch("/api/admin/modules/billing");
        if (!res.ok) throw new Error("Failed to load billing settings");
          const data = await res.json();
          if (!data.settings || !data.settings.pspPrefixRange || !data.settings.pspSuffixRange) throw new Error("Invalid billing settings");
          setBillingSettings(data.settings);
          setBillingSettingsError(false);
      } catch {
        setBillingSettingsError(true);
        console.error("Failed to load billing settings");
      } finally {
        setLoadingBillingSettings(false);
      }
  }, []);
  useEffect(() => { void fetchBillingSettings(); }, [fetchBillingSettings]);

  const fetchFormConfigs = useCallback(async () => {
    setLoadingFormConfigs(true);
    try {
      const [orderRes, studyRes] = await Promise.all([
        fetch("/api/admin/form-config"),
        fetch("/api/admin/study-form-config"),
      ]);

      if (!orderRes.ok || !studyRes.ok) {
        throw new Error("Failed to load form configurations");
      }

      const orderData = await orderRes.json();
      const studyData = await studyRes.json();

      setOrderFormConfig({
        fields: Array.isArray(orderData.fields) ? orderData.fields : [],
        groups: Array.isArray(orderData.groups) ? orderData.groups : [],
        enabledMixsChecklists: Array.isArray(orderData.enabledMixsChecklists)
          ? orderData.enabledMixsChecklists
          : [],
      });
      setStudyFormConfig({
        fields: Array.isArray(studyData.fields) ? studyData.fields : [],
        groups: Array.isArray(studyData.groups) ? studyData.groups : [],
      });
      setFormConfigError(false);
    } catch {
      setFormConfigError(true);
      notifyPanel.error("Failed to load form builder configuration");
    } finally {
      setLoadingFormConfigs(false);
    }
  }, []);

  useEffect(() => {
    void fetchFormConfigs();
  }, [fetchFormConfigs]);

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

  const handleResumeModules = async () => {
    setResumingModules(true);
    setResumeError(null);
    try {
      await setGlobalDisabled(false);
      setResumeDialogOpen(false);
      toast.success("Optional modules resumed. Individual choices were kept.");
    } catch {
      setResumeError("Could not confirm the change. Check your connection and try again.");
    } finally {
      setResumingModules(false);
    }
  };

  const parseNumberOrFallback = (value: string, fallback: number) => {
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? fallback : parsed;
  };

  const persistOrderFormConfig = async (fields: FormFieldDefinition[]) => {
    if (!orderFormConfig) {
      throw new Error("Sequencing Order form configuration not loaded");
    }

    const res = await fetch("/api/admin/form-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields,
        groups: orderFormConfig.groups,
        enabledMixsChecklists: orderFormConfig.enabledMixsChecklists,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to save sequencing order form configuration");
    }

    const data = await res.json();
    setOrderFormConfig({
      fields: Array.isArray(data.fields) ? data.fields : fields,
      groups: Array.isArray(data.groups) ? data.groups : orderFormConfig.groups,
      enabledMixsChecklists: Array.isArray(data.enabledMixsChecklists)
        ? data.enabledMixsChecklists
        : orderFormConfig.enabledMixsChecklists,
    });
  };

  const persistStudyFormConfig = async (fields: FormFieldDefinition[]) => {
    if (!studyFormConfig) {
      throw new Error("Study form configuration not loaded");
    }

    const res = await fetch("/api/admin/study-form-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fields,
        groups: studyFormConfig.groups,
      }),
    });

    if (!res.ok) {
      throw new Error("Failed to save study form configuration");
    }

    setStudyFormConfig((prev) =>
      prev ? { ...prev, fields } : prev
    );
  };

  const runModuleAction = async (
    actionId: string,
    action: () => Promise<void>
  ) => {
    setRunningAction(actionId);
    try {
      await action();
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : "Failed to update form configuration"
      );
    } finally {
      setRunningAction(null);
    }
  };

  const addStudyMixsField = async () => {
    if (!studyFormConfig) return;
    if (studyFormConfig.fields.some((f) => f.type === "mixs")) {
      toast.info("MIxS field is already added to Study Form Builder");
      return;
    }

    const metadataGroupId = studyFormConfig.groups.find((g) =>
      g.name.toLowerCase().includes("metadata")
    )?.id;

    const newField: FormFieldDefinition = {
      id: `field_mixs_${Date.now()}`,
      type: "mixs",
      label: "MIxS Metadata",
      name: "_mixs",
      required: false,
      visible: true,
      helpText: "Environment-specific metadata fields following MIxS standards",
      order: studyFormConfig.fields.filter((f) => !f.perSample).length,
      groupId: metadataGroupId,
    };

    await persistStudyFormConfig([...studyFormConfig.fields, newField]);
    toast.success("Added MIxS field to Study Form Builder");
  };

  const addStudyFundingField = async () => {
    if (!studyFormConfig) return;
    if (studyFormConfig.fields.some((f) => f.type === "funding")) {
      toast.info("Funding field is already added to Study Form Builder");
      return;
    }

    const infoGroupId = studyFormConfig.groups.find((g) =>
      g.name.toLowerCase().includes("info")
    )?.id;

    const newField: FormFieldDefinition = {
      id: `field_funding_${Date.now()}`,
      type: "funding",
      label: "Funding Information",
      name: "_funding",
      required: false,
      visible: true,
      helpText: "Grant and funding source information for this study",
      order: studyFormConfig.fields.filter((f) => !f.perSample).length,
      groupId: infoGroupId,
    };

    await persistStudyFormConfig([...studyFormConfig.fields, newField]);
    toast.success("Added Funding field to Study Form Builder");
  };

  const addSequencingTechField = async () => {
    if (!orderFormConfig) return;
    if (orderFormConfig.fields.some((f) => f.type === "sequencing-tech")) {
      toast.info(
        "Sequencing Technology field is already added to Sequencing Order Form Builder"
      );
      return;
    }

    const newField: FormFieldDefinition = {
      id: `field_seqtech_${Date.now()}`,
      type: "sequencing-tech",
      label: "Sequencing Technology",
      name: "_sequencing_tech",
      required: false,
      visible: true,
      helpText: "Select the sequencing technology for your samples",
      order: orderFormConfig.fields.filter((f) => !f.perSample).length,
      groupId: "group_sequencing",
      moduleSource: "sequencing-tech",
    };

    await persistOrderFormConfig([...orderFormConfig.fields, newField]);
    toast.success("Added Sequencing Technology field to Sequencing Order Form Builder");
  };

  const addBarcodeField = async () => {
    if (!orderFormConfig) return;
    const hasSequencingTech = orderFormConfig.fields.some(
      (f) => f.type === "sequencing-tech"
    );
    if (!hasSequencingTech) {
      toast.error("Add Sequencing Technology first");
      return;
    }

    if (
      orderFormConfig.fields.some(
        (f) => f.type === "barcode" || f.name === "_barcode"
      )
    ) {
      toast.info("Barcode field is already added to Sequencing Order Form Builder");
      return;
    }

    const newField: FormFieldDefinition = {
      id: `field_barcode_${Date.now()}`,
      type: "barcode",
      label: "Barcode",
      name: "_barcode",
      required: false,
      visible: true,
      perSample: true,
      helpText:
        "Assign a barcode to this sample. Available barcodes depend on the selected sequencing kit.",
      order: orderFormConfig.fields.filter((f) => f.perSample).length,
      moduleSource: "sequencing-tech",
    };

    await persistOrderFormConfig([...orderFormConfig.fields, newField]);
    toast.success("Added Barcode field to Sequencing Order Form Builder");
  };

  const applyOntRunPlanPreset = async () => {
    const res = await fetch("/api/admin/sequencing-run-form-config/preset", {
      method: "POST",
    });
    const payload = (await res.json().catch(() => null)) as
      | {
          orderFieldsAdded?: number;
          runAssignmentFieldsAdded?: number;
          error?: string;
        }
      | null;

    if (!res.ok) {
      throw new Error(payload?.error || "Failed to apply preset");
    }

    await fetchFormConfigs();
    toast.success(
      `ONT run plan preset applied (${payload?.orderFieldsAdded ?? 0} sequencing-order/sample fields, ${payload?.runAssignmentFieldsAdded ?? 0} run-assignment fields added)`
    );
  };

  const addEnaSampleFields = async () => {
    if (!orderFormConfig) return;
    if (
      orderFormConfig.fields.some(
        (f) => f.type === "organism" || f.name === "_organism"
      )
    ) {
      toast.info("ENA sample fields are already added to Sequencing Order Form Builder");
      return;
    }

    const perSampleCount = orderFormConfig.fields.filter((f) => f.perSample).length;
    const now = Date.now();
    const newFields: FormFieldDefinition[] = [
      {
        id: `field_organism_${now}`,
        type: "organism",
        label: "Organism",
        name: "_organism",
        required: true,
        visible: true,
        perSample: true,
        helpText:
          "The source organism or metagenome type. Examples: 'human gut metagenome', 'soil metagenome', 'Escherichia coli'. Start typing to search NCBI taxonomy.",
        placeholder: "e.g., human gut metagenome",
        order: perSampleCount,
        moduleSource: "ena-sample-fields",
      },
      {
        id: `field_sample_title_${now + 1}`,
        type: "text",
        label: "Sample Title",
        name: "sample_title",
        required: true,
        visible: true,
        perSample: true,
        helpText:
          "A short descriptive title for this sample. Required for ENA submission.",
        placeholder: "e.g., Human gut sample from healthy adult",
        order: perSampleCount + 1,
        moduleSource: "ena-sample-fields",
      },
      {
        id: `field_sample_alias_${now + 2}`,
        type: "text",
        label: "Sample Alias",
        name: "sample_alias",
        required: false,
        visible: true,
        perSample: true,
        helpText:
          "A unique identifier for this sample. If left empty, will be auto-generated.",
        placeholder: "e.g., HG-001-A",
        order: perSampleCount + 2,
        moduleSource: "ena-sample-fields",
      },
    ];

    await persistOrderFormConfig([...orderFormConfig.fields, ...newFields]);
    toast.success("Added ENA sample fields to Sequencing Order Form Builder");
  };

  const hasStudyMixsField = studyFormConfig?.fields.some(
    (f) => f.type === "mixs"
  ) ?? false;
  const hasStudyFundingField = studyFormConfig?.fields.some(
    (f) => f.type === "funding"
  ) ?? false;
  const hasSequencingTechField = orderFormConfig?.fields.some(
    (f) => f.type === "sequencing-tech"
  ) ?? false;
  const hasBarcodeField = orderFormConfig?.fields.some(
    (f) => f.type === "barcode" || f.name === "_barcode"
  ) ?? false;
  const hasEnaFields = orderFormConfig?.fields.some(
    (f) => f.type === "organism" || f.name === "_organism"
  ) ?? false;

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

  const categories = (Object.keys(MODULE_CATEGORIES) as ModuleCategory[]).filter(
    (category) => availableModules.some((module) => module.category === category)
  );

  const normalizedSearch = search.trim().toLowerCase();
  const visibleModules = availableModules.filter(module => {
    if (activeCategory !== "all" && module.category !== activeCategory) return false;
    const catalogModule = importModuleCatalog.find(entry => entry.id === module.id);
    return [module.name, module.description, module.id, MODULE_CATEGORIES[module.category].label,
      catalogModule?.name, catalogModule?.summary, catalogModule?.formats.join(" ")]
      .filter(Boolean).join(" ").toLowerCase().includes(normalizedSearch);
  });
  const chooseCategory = (category: ModuleCategory | "all") => {
    const query = new URLSearchParams(searchParams.toString());
    if (category === "all") query.delete("category");
    else query.set("category", category);
    router.replace(`/admin/modules${query.size ? `?${query}` : ""}`, { scroll: false });
  };

  if (loading) {
    return <PageLoader />;
  }

  if (error) {
    return <PageContainer>
      <h1 className="text-2xl font-semibold">Modules</h1>
      <div role="alert" className="mt-6 space-y-3 rounded-xl border bg-card p-6">
        <p>{error}</p>
        <p className="text-sm text-muted-foreground">Module availability is unknown until settings can be loaded. No settings have been changed.</p>
        <Button disabled={retrying} onClick={async () => {
          setRetrying(true);
          try { await refresh(); } finally { setRetrying(false); }
        }}>{retrying ? "Retrying…" : "Try again"}</Button>
      </div>
    </PageContainer>;
  }

  return (
      <PageContainer>
        <div className="space-y-6">
          <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
            <div className="space-y-2">
              <Link href="/admin/settings" className="text-sm text-muted-foreground hover:text-foreground">Application settings</Link>
              <h1 className="text-2xl font-semibold tracking-tight">Modules</h1>
              <p className="max-w-2xl text-sm text-muted-foreground">
                Choose what your SeqDesk can do. Enable data sources and features together, then configure what your users need.
              </p>
            </div>
            <span className="flex shrink-0 items-center gap-2 text-sm text-muted-foreground"><Package className="size-4" aria-hidden="true" />{availableModules.length} included modules</span>
          </div>

          <div className="space-y-4 rounded-xl border bg-card p-4">
            <div className="relative max-w-lg">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
              <Input aria-label="Search modules" placeholder="Find a module, data source or feature…" className="pl-9" value={search} onChange={event => setSearch(event.target.value)} />
            </div>
            <div role="group" aria-label="Module categories" className="flex flex-wrap gap-2">
              <Button variant={activeCategory === "all" ? "default" : "outline"} size="sm" aria-pressed={activeCategory === "all"} onClick={() => chooseCategory("all")}>All modules</Button>
              {categories.map(category => <Button key={category} variant={activeCategory === category ? "default" : "outline"} size="sm" aria-pressed={activeCategory === category} onClick={() => chooseCategory(category)}>{MODULE_CATEGORIES[category].label}</Button>)}
            </div>
            {activeCategory !== "all" && <p className="text-sm text-muted-foreground">{MODULE_CATEGORIES[activeCategory].description}.</p>}
          </div>

          <Dialog open={resumeDialogOpen} onOpenChange={open => {
            if (resumingModules) return;
            setResumeDialogOpen(open);
            if (open) setResumeError(null);
          }}>
            {globalDisabled && <div className="flex flex-col items-start gap-3 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 sm:flex-row sm:items-center">
              <p className="flex-1">Optional modules are paused for this installation. Individual toggles are locked until the installation-wide module setting is re-enabled. Always-active modules remain available.</p>
              <DialogTrigger asChild><Button variant="outline" size="sm" className="shrink-0">Resume optional modules</Button></DialogTrigger>
            </div>}
            <DialogContent showCloseButton={!resumingModules}>
              <DialogHeader>
                <DialogTitle>Resume optional modules?</DialogTitle>
                <DialogDescription>This restores access to the optional modules that were enabled before the pause. Individually disabled modules stay disabled; existing data and settings are kept.</DialogDescription>
              </DialogHeader>
              {resumeError && <p role="alert" className="text-sm text-destructive">{resumeError}</p>}
              <DialogFooter>
                <Button variant="outline" disabled={resumingModules} onClick={() => setResumeDialogOpen(false)}>Cancel</Button>
                <Button disabled={resumingModules} onClick={() => void handleResumeModules()}>{resumingModules ? "Resuming…" : "Resume modules"}</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <p className="text-sm text-muted-foreground" aria-live="polite">{visibleModules.length} {visibleModules.length === 1 ? "module" : "modules"}{normalizedSearch ? " found" : " shown"} · {availableModules.filter(module => isModuleEnabled(module.id)).length} enabled</p>
          {visibleModules.length === 0 && <div className="rounded-xl border border-dashed p-8 text-center">
            <h2 className="font-medium">No matching modules</h2>
            <p className="mt-2 text-sm text-muted-foreground">Try a different search or choose another category.</p>
            <Button variant="link" onClick={() => { setSearch(""); chooseCategory("all"); }}>Show all modules</Button>
          </div>}
                <div className="grid items-start gap-4 xl:grid-cols-2">
                  {visibleModules.map((module) => {
                    const catalogModule = importModuleCatalog.find(entry => entry.id === module.id);
                    const displayName = catalogModule?.name ?? module.name;
                    const Icon = module.id === "sequencing-management" ? Building2 : CATEGORY_ICONS[module.category];
                    const settingsLink = MODULE_SETTINGS_LINKS[module.id];
                    const isProfileCompatible = !incompatibleModules.includes(module.id);
                    const isAlwaysEnabled =
                      isProfileCompatible && isAlwaysEnabledModule(module.id);
                    const isEnabled =
                      isProfileCompatible &&
                      (isAlwaysEnabled || (moduleStates[module.id] ?? false));
                    const isEffectivelyEnabled = isModuleEnabled(module.id);
                    const isUpdating = updating === module.id;
                    const isComingSoon = module.comingSoon;
                    const builderLinks = MODULE_BUILDER_LINKS[module.id] ?? [];
                    const formIntegration = getFormModuleIntegration(module.id);
                    const hasOrderModuleField = Boolean(
                      formIntegration?.targets.includes("order") &&
                        orderFormConfig &&
                        hasModuleField(module.id, orderFormConfig.fields)
                    );
                    const hasStudyModuleField = Boolean(
                      formIntegration?.targets.includes("study") &&
                        studyFormConfig &&
                        hasModuleField(module.id, studyFormConfig.fields)
                    );
                    const hasConfiguredFormField =
                      hasOrderModuleField || hasStudyModuleField;
                    const formTargets = formIntegration?.targets
                      .map((target) => target === "order" ? "Sequencing Order Form" : "Study Form")
                      .join(", ");
                    const fieldTypeList = formIntegration?.fieldTypes
                      .map((fieldType) => fieldType)
                      .join(", ");

                    return (
                      <GlassCard
                        key={module.id}
                        role="article"
                        aria-labelledby={`module-title-${module.id}`}
                        className="min-w-0 overflow-hidden rounded-xl p-0 shadow-none"
                      >
                        <div className={`flex items-center justify-between gap-3 border-b px-5 py-4 ${module.category === "data-sources" ? "bg-teal-50/70 dark:bg-teal-950/20" : module.category === "analysis" ? "bg-violet-50/70 dark:bg-violet-950/20" : "bg-muted/35"}`}>
                          <div className="flex min-w-0 items-center gap-3">
                            <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-card"><Icon className="size-5" aria-hidden="true" /></span>
                            <span className="text-sm font-medium">{MODULE_CATEGORIES[module.category].label}</span>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            {isUpdating && <Loader2 className="size-4 animate-spin text-muted-foreground" aria-label="Saving module setting" />}
                            <Switch
                              id={module.id}
                              role="switch"
                              checked={isEnabled}
                              onCheckedChange={checked => handleToggle(module.id, checked)}
                              disabled={isAlwaysEnabled || !isProfileCompatible || updating !== null || isComingSoon || globalDisabled}
                            />
                            <Label htmlFor={module.id} className="sr-only">Enable {displayName}</Label>
                          </div>
                        </div>
                        <div className="p-5">
                          <div className="min-w-0 space-y-3">
                            <div className="flex items-center gap-3 flex-wrap">
                              <h2 id={`module-title-${module.id}`} className="text-base font-semibold">{displayName}</h2>
                              {!isProfileCompatible ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                  Unavailable in {deploymentProfile.label}
                                </span>
                              ) : isComingSoon ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-slate-500/10 text-slate-500 font-medium flex items-center gap-1">
                                  <Clock className="h-3 w-3" />
                                  Coming Soon
                                </span>
                              ) : isAlwaysEnabled ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">
                                  Always active
                                </span>
                              ) : isEffectivelyEnabled ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-500/10 text-green-600 font-medium">
                                  Enabled
                                </span>
                              ) : globalDisabled && isEnabled ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-700 font-medium">
                                  Paused by installation setting
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-muted text-muted-foreground font-medium">
                                  Disabled
                                </span>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {formIntegration && isProfileCompatible && (
                                <>
                                  <span
                                    className={`rounded px-2 py-0.5 text-xs font-medium ${
                                      hasConfiguredFormField
                                        ? "bg-emerald-500/10 text-emerald-700"
                                        : "bg-amber-500/10 text-amber-700"
                                    }`}
                                  >
                                    {loadingFormConfigs ? "Checking form fields…" : formConfigError ? "Could not check form fields" : hasConfiguredFormField ? "Form fields configured" : "Form field not yet added"}
                                  </span>
                                  {!isEffectivelyEnabled && (
                                    <span className="rounded bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
                                      Hidden from users when disabled
                                    </span>
                                  )}
                                </>
                              )}
                            </div>
                            <p className="text-sm text-muted-foreground">
                              {catalogModule?.summary ?? module.description}
                            </p>
                            {catalogModule && <div className="flex flex-wrap gap-1.5">{catalogModule.formats.map(format => <span key={format} className="rounded-md bg-muted px-2 py-1 text-xs text-muted-foreground">{format}</span>)}</div>}
                            {!isProfileCompatible && (
                              <p className="text-xs text-muted-foreground">
                                This module requires application domains that are not part of the selected deployment profile.
                              </p>
                            )}
                            {module.featureLocation && isProfileCompatible && (
                              <p className="text-xs text-primary flex items-center gap-1">
                                <ArrowRight className="h-3 w-3" />
                                {module.featureLocation}
                              </p>
                            )}
                            {settingsLink && isProfileCompatible && <Button asChild variant="outline" size="sm" className="h-auto min-h-8 whitespace-normal text-left"><Link href={settingsLink.href}>{settingsLink.label}<ArrowRight className="size-3.5 shrink-0" aria-hidden="true" /></Link></Button>}
                            {(formIntegration || builderLinks.length > 0) && <details className="group rounded-lg border bg-muted/10">
                              <summary className="flex cursor-pointer list-none items-center justify-between gap-2 p-3 text-sm font-medium [&::-webkit-details-marker]:hidden">Configure form fields<ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" /></summary>
                              <div className="space-y-3 border-t p-3">
                            {formConfigError && <div role="alert" className="space-y-2 text-sm">
                              <p>Could not load form settings. Existing fields have not been changed.</p>
                              <Button variant="outline" size="sm" disabled={loadingFormConfigs} onClick={() => void fetchFormConfigs()}>Retry form settings</Button>
                            </div>}
                            {builderLinks.length > 0 && isProfileCompatible && (
                              <div className="flex flex-wrap gap-2 pt-1">
                                {builderLinks.map((target) => (
                                  <Button
                                    key={`${module.id}-${target.href}`}
                                    asChild
                                    variant="outline"
                                    size="sm"
                                    className="h-auto min-h-7 whitespace-normal px-2 text-left text-xs"
                                  >
                                    <Link href={target.href}>{target.label}</Link>
                                  </Button>
                                ))}
                              </div>
                            )}

                            {formIntegration && (
                              <div className="rounded-md border border-border/70 bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                                <p className="font-medium text-foreground">Form integration</p>
                                <p className="mt-1">{formIntegration.summary}</p>
                                <p className="mt-1">
                                  Used in: {formTargets}. Field type{formIntegration.fieldTypes.length === 1 ? "" : "s"}: {fieldTypeList}.
                                </p>
                                {formIntegration.settingsHref && (
                                  <Button
                                    asChild
                                    variant="link"
                                    size="sm"
                                    className="mt-1 h-auto p-0 text-xs"
                                  >
                                    <Link href={formIntegration.settingsHref}>Open module settings</Link>
                                  </Button>
                                )}
                              </div>
                            )}

                            {(() => {
                              const quickActions: Array<{
                                key: string;
                                label: string;
                                disabled: boolean;
                                onClick: () => Promise<void>;
                              }> = [];

                              if (module.id === "mixs-metadata") {
                                quickActions.push({
                                  key: "add-study-mixs",
                                  label: hasStudyMixsField
                                    ? "MIxS already added"
                                    : "Add MIxS to Study Form",
                                  disabled:
                                    hasStudyMixsField || !studyFormConfig,
                                  onClick: addStudyMixsField,
                                });
                              }

                              if (module.id === "funding-info") {
                                quickActions.push({
                                  key: "add-study-funding",
                                  label: hasStudyFundingField
                                    ? "Funding already added"
                                    : "Add Funding to Study Form",
                                  disabled:
                                    hasStudyFundingField || !studyFormConfig,
                                  onClick: addStudyFundingField,
                                });
                              }

                              if (module.id === "sequencing-tech") {
                                quickActions.push({
                                  key: "add-sequencing-tech",
                                  label: hasSequencingTechField
                                    ? "Sequencing tech already added"
                                    : "Add Sequencing Tech to Sequencing Order Form",
                                  disabled:
                                    hasSequencingTechField || !orderFormConfig,
                                  onClick: addSequencingTechField,
                                });
                                quickActions.push({
                                  key: "add-barcode",
                                  label: hasBarcodeField
                                    ? "Barcode already added"
                                    : "Add Barcode to Sequencing Order Form",
                                  disabled:
                                    hasBarcodeField ||
                                    !orderFormConfig ||
                                    !hasSequencingTechField,
                                  onClick: addBarcodeField,
                                });
                                quickActions.push({
                                  key: "apply-ont-run-plan-preset",
                                  label: "Apply ONT Run Plan Preset",
                                  disabled: !orderFormConfig,
                                  onClick: applyOntRunPlanPreset,
                                });
                              }

                              if (module.id === "ena-sample-fields") {
                                quickActions.push({
                                  key: "add-ena-fields",
                                  label: hasEnaFields
                                    ? "ENA fields already added"
                                    : "Add ENA Fields to Sequencing Order Form",
                                  disabled: hasEnaFields || !orderFormConfig,
                                  onClick: addEnaSampleFields,
                                });
                              }

                              if (quickActions.length === 0) {
                                return null;
                              }

                              return (
                                <div className="space-y-2 pt-1">
                                  <p className="text-xs text-muted-foreground">
                                    Form actions
                                  </p>
                                  <div className="flex flex-wrap gap-2">
                                    {quickActions.map((action) => {
                                      const actionId = `${module.id}:${action.key}`;
                                      const isRunning = runningAction === actionId;
                                      return (
                                        <Button
                                          key={actionId}
                                          variant="outline"
                                          size="sm"
                                          className="h-auto min-h-7 whitespace-normal px-2 text-left text-xs"
                                          disabled={
                                            isRunning ||
                                            loadingFormConfigs ||
                                            formConfigError ||
                                            !isEffectivelyEnabled ||
                                            isComingSoon ||
                                            action.disabled
                                          }
                                          onClick={() =>
                                            runModuleAction(actionId, action.onClick)
                                          }
                                        >
                                          {isRunning && (
                                            <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                          )}
                                          {!isRunning &&
                                            action.key === "apply-ont-run-plan-preset" && (
                                              <FileText className="h-3 w-3 mr-1" />
                                            )}
                                          {action.label}
                                        </Button>
                                      );
                                    })}
                                  </div>
                                </div>
                              );
                            })()}
                              </div>
                            </details>}
                          </div>
                        </div>

                        {/* Account Validation Settings Panel */}
                        {module.id === "account-validation" && isEffectivelyEnabled && (
                    <details className="group border-t px-5">
                      <summary className="flex cursor-pointer list-none items-center gap-2 py-4 [&::-webkit-details-marker]:hidden">
                        <Shield className="h-4 w-4 text-primary" />
                        <span className="text-sm font-medium">Configure allowed email domains</span>
                        <ChevronDown className="ml-auto size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
                      </summary>
                      <div className="pb-5">

                      {loadingSettings ? (
                        <div className="flex items-center justify-center py-4">
                          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                        </div>
                      ) : accountSettingsError ? (
                        <div role="alert" className="space-y-2 text-sm">
                          <p>Could not load access settings. Reload them before making changes.</p>
                          <Button variant="outline" size="sm" onClick={() => void fetchAccountSettings()}>Retry access settings</Button>
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
                                    aria-label={`Remove domain ${domain}`}
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
                                aria-label="Allowed email domain"
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
                                "Save access settings"
                              )}
                            </Button>
                          </div>
                        </div>
                      )}
                      </div>
                    </details>
                  )}

                        {/* Billing Settings Panel */}
                        {module.id === "billing-info" && isEffectivelyEnabled && (
                          <details className="group border-t px-5">
                            <summary className="flex cursor-pointer list-none items-center gap-2 py-4 [&::-webkit-details-marker]:hidden">
                              <Receipt className="h-4 w-4 text-teal-600" />
                              <span className="text-sm font-medium">Configure billing fields</span>
                              <ChevronDown className="ml-auto size-4 shrink-0 group-open:rotate-180" aria-hidden="true" />
                            </summary>
                            <div className="pb-5">

                            {loadingBillingSettings ? (
                              <div className="flex items-center justify-center py-4">
                                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                              </div>
                            ) : billingSettingsError ? (
                              <div role="alert" className="space-y-2 text-sm">
                                <p>Could not load billing settings. Reload them before making changes.</p>
                                <Button variant="outline" size="sm" onClick={() => void fetchBillingSettings()}>Retry billing settings</Button>
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
                                  <div className="flex flex-wrap items-center gap-4">
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
                                    <div className="grid grid-cols-1 gap-4 p-4 border border-border/50 rounded-lg bg-muted/20">
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
                                                  min: parseNumberOrFallback(e.target.value, 0),
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
                                                  max: parseNumberOrFallback(e.target.value, 9),
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
                                              pspMainDigits: parseNumberOrFallback(
                                                e.target.value,
                                                7
                                              ),
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
                                                  min: parseNumberOrFallback(e.target.value, 0),
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
                                                  max: parseNumberOrFallback(e.target.value, 99),
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
                                        "Save billing settings"
                                      )}
                                    </Button>
                                  </div>
                                </div>
                              </div>
                            )}
                            </div>
                          </details>
                        )}
                      </GlassCard>
                    );
                  })}
                </div>

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

export default function ModulesPage() {
  return <Suspense fallback={<PageLoader />}><ModulesPageContent /></Suspense>;
}
