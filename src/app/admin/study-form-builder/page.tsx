"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Loader2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  Leaf,
  FileText,
  Table,
  Link2,
  Shield,
  Download,
  Upload,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { HelpBox } from "@/components/ui/help-box";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  FormFieldDefinition,
  FormFieldGroup,
  FieldType,
  SelectOption,
  FIELD_TYPE_LABELS,
} from "@/types/form-config";
import { useModule } from "@/lib/modules";
import {
  STUDY_INFORMATION_SECTION_ID,
  STUDY_METADATA_SECTION_ID,
  getFixedStudySections,
  normalizeStudyFormSchema,
} from "@/lib/studies/fixed-sections";

// Default groups for study forms
const DEFAULT_STUDY_GROUPS: FormFieldGroup[] = getFixedStudySections();

const LEGACY_SUBMG_PER_SAMPLE_FIELDS = new Set([
  "collection date",
  "geographic location",
]);

function normalizeLegacySubmgFieldName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ");
}

function isLegacySubmgPerSampleFieldName(value: string): boolean {
  return LEGACY_SUBMG_PER_SAMPLE_FIELDS.has(normalizeLegacySubmgFieldName(value));
}

type ImportedStudyField = Omit<FormFieldDefinition, "id" | "order"> & {
  id?: string;
  order?: number;
};

type ImportedStudyGroup = Omit<FormFieldGroup, "id" | "order"> & {
  id?: string;
  order?: number;
};

type ImportedStudyConfig = {
  version?: string;
  type?: string;
  exportedAt?: string;
  fields?: ImportedStudyField[];
  groups?: ImportedStudyGroup[];
};

export default function StudyFormBuilderPage() {
  const { enabled: mixsModuleEnabled } = useModule("mixs-metadata");
  const { enabled: fundingModuleEnabled } = useModule("funding-info");

  const [fields, setFields] = useState<FormFieldDefinition[]>([]);
  const [groups, setGroups] = useState<FormFieldGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [justSaved, setJustSaved] = useState(false);
  const [error, setError] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveInitializedRef = useRef(false);
  const lastPersistedSnapshotRef = useRef("");
  const saveInFlightRef = useRef(false);

  // Delete confirmation dialogs
  const [deleteFieldDialogOpen, setDeleteFieldDialogOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<FormFieldDefinition | null>(null);

  // Import config confirmation dialog
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [pendingImport, setPendingImport] = useState<{
    fields: FormFieldDefinition[];
    groups: FormFieldGroup[];
  } | null>(null);
  const importFileRef = useRef<HTMLInputElement>(null);

  // Field dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FormFieldDefinition | null>(null);
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldVisible, setFieldVisible] = useState(true);
  const [fieldHelpText, setFieldHelpText] = useState("");
  const [fieldPlaceholder, setFieldPlaceholder] = useState("");
  const [fieldOptions, setFieldOptions] = useState<SelectOption[]>([]);
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [fieldGroupId, setFieldGroupId] = useState<string>("");
  const [fieldPerSample, setFieldPerSample] = useState(false);
  const [fieldAdminOnly, setFieldAdminOnly] = useState(false);
  const facilityLockedFieldTypes = new Set<FieldType>(["mixs", "funding"]);

  const canFieldBeFacilityOnly = (
    field: Pick<FormFieldDefinition, "type" | "moduleSource" | "name">
  ) => {
    if (field.name === "_sample_association") return false;
    if (field.moduleSource) return false;
    return !facilityLockedFieldTypes.has(field.type);
  };
  const canCurrentFieldBeFacilityOnly = canFieldBeFacilityOnly({
    type: fieldType,
    moduleSource: editingField?.moduleSource,
    name: fieldName.trim() || editingField?.name || "",
  });

  // Fetch configuration
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/admin/study-form-config");
        if (res.ok) {
          const data = await res.json();
          let loadedFields = data.fields || [];

          // Sample Association is enabled by default - add if not present
          if (!loadedFields.some((f: FormFieldDefinition) => f.name === "_sample_association")) {
            const updatedFields = loadedFields.map((f: FormFieldDefinition) => {
              if (f.perSample) return f;
              return { ...f, order: (f.order || 0) + 1 };
            });
            loadedFields = [
              {
                id: `field_sample_association_${Date.now()}`,
                type: "text",
                label: "Sample Association",
                name: "_sample_association",
                required: false,
                visible: true,
                helpText: "Interface to associate samples from orders to this study",
                order: 0,
              },
              ...updatedFields,
            ];
          }

          const normalized = normalizeStudyFormSchema({
            fields: loadedFields,
            groups: data.groups || DEFAULT_STUDY_GROUPS,
          });
          setFields(normalized.fields);
          setGroups(normalized.groups);
        } else {
          // No config yet - start with Sample Association enabled
          setFields([{
            id: `field_sample_association_${Date.now()}`,
            type: "text",
            label: "Sample Association",
            name: "_sample_association",
            required: false,
            visible: true,
            helpText: "Interface to associate samples from orders to this study",
            order: 0,
          }]);
          setGroups(DEFAULT_STUDY_GROUPS);
        }
      } catch {
        setError("Failed to load configuration");
        setGroups(DEFAULT_STUDY_GROUPS);
      } finally {
        setLoading(false);
      }
    };
    fetchConfig();
  }, []);

  // Generate field name from label
  const generateFieldName = (label: string) => {
    return label
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_|_$/g, "");
  };

  // Reset field form
  const resetFieldForm = () => {
    setFieldLabel("");
    setFieldName("");
    setFieldType("text");
    setFieldRequired(false);
    setFieldVisible(true);
    setFieldPerSample(false);
    setFieldAdminOnly(false);
    setFieldHelpText("");
    setFieldPlaceholder("");
    setFieldOptions([]);
    setFieldGroupId("");
    setEditingField(null);
  };

  // Open dialog for new field
  const handleAddField = (
    perSample: boolean = false,
    adminOnly: boolean = false,
    groupId?: string
  ) => {
    resetFieldForm();
    setFieldPerSample(perSample);
    setFieldAdminOnly(adminOnly);
    if (!perSample && !adminOnly && groups.length > 0) {
      const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
      setFieldGroupId(groupId || sortedGroups[0].id);
    }
    setDialogOpen(true);
  };

  // Helper to add a suggested field
  const addSuggestedField = (template: Omit<FormFieldDefinition, "id" | "order">) => {
    const nextOrder = fields.filter(
      (f) => !!f.perSample === !!template.perSample && !!f.adminOnly === !!template.adminOnly
    ).length;
    const newField: FormFieldDefinition = {
      ...template,
      id: `field_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      order: nextOrder,
    };
    setFields([...fields, newField]);
  };

  // Open dialog for editing
  const handleEditField = (field: FormFieldDefinition) => {
    setEditingField(field);
    setFieldLabel(field.label);
    setFieldName(field.name);
    setFieldType(field.type);
    setFieldRequired(field.required);
    setFieldVisible(field.visible !== false);
    setFieldPerSample(field.perSample || false);
    setFieldHelpText(field.helpText || "");
    setFieldPlaceholder(field.placeholder || "");
    setFieldOptions(field.options || []);
    setFieldGroupId(field.groupId || "");
    setFieldAdminOnly(field.adminOnly || false);
    setDialogOpen(true);
  };

  // Save field
  const handleSaveField = () => {
    if (!fieldLabel.trim()) {
      setError("Field label is required");
      return;
    }

    const name = fieldName.trim() || generateFieldName(fieldLabel);

    const isSpecialFieldType = ["mixs", "funding"].includes(fieldType);
    const isSampleAssociationField = name === "_sample_association";
    if (name.startsWith("_") && !isSpecialFieldType && !isSampleAssociationField) {
      const isExistingReserved = editingField?.name === name;
      if (!isExistingReserved) {
        setError("Field keys starting with '_' are reserved for system fields");
        return;
      }
    }

    const isDuplicate = fields.some(
      (f) => f.name === name && f.id !== editingField?.id
    );
    if (isDuplicate) {
      setError("A field with this name already exists");
      return;
    }

    if (fieldAdminOnly && !canCurrentFieldBeFacilityOnly) {
      setError("This field type must remain visible in the main study flow");
      return;
    }

    const targetSectionCount = fields.filter(
      (f) =>
        !!f.perSample === fieldPerSample &&
        !!f.adminOnly === fieldAdminOnly &&
        f.id !== editingField?.id
    ).length;
    const order =
      editingField &&
      editingField.perSample === fieldPerSample &&
      !!editingField.adminOnly === fieldAdminOnly
      ? editingField.order ?? targetSectionCount
      : targetSectionCount;
    const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
    const shouldAssignUserSection =
      !fieldPerSample && !fieldAdminOnly && name !== "_sample_association";
    const assignedGroupId = shouldAssignUserSection
      ? sortedGroups.find((group) => group.id === fieldGroupId)?.id || sortedGroups[0]?.id
      : undefined;

    const newField: FormFieldDefinition = {
      id: editingField?.id || `field_${Date.now()}`,
      type: fieldType,
      label: fieldLabel.trim(),
      name,
      required: fieldRequired,
      visible: fieldVisible,
      perSample: fieldPerSample,
      helpText: fieldHelpText.trim() || undefined,
      placeholder: fieldPlaceholder.trim() || undefined,
      options: fieldType === "select" || fieldType === "multiselect" ? fieldOptions : undefined,
      order,
      groupId: assignedGroupId,
      adminOnly: fieldAdminOnly || undefined,
    };

    if (editingField) {
      setFields(fields.map((f) => (f.id === editingField.id ? newField : f)));
    } else {
      setFields([...fields, newField]);
    }

    setDialogOpen(false);
    setTimeout(() => {
      resetFieldForm();
      setError("");
    }, 200);
  };

  // Open delete field dialog
  const openDeleteFieldDialog = (field: FormFieldDefinition) => {
    setFieldToDelete(field);
    setDeleteFieldDialogOpen(true);
  };

  // Delete field
  const handleDeleteField = () => {
    if (!fieldToDelete) return;
    setFields(fields.filter((f) => f.id !== fieldToDelete.id));
    setDeleteFieldDialogOpen(false);
    setFieldToDelete(null);
  };

  const toggleFieldAdminOnly = (fieldId: string) => {
    const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
    setFields(fields.map((field) => {
      if (field.id !== fieldId) return field;

      const nextAdminOnly = !field.adminOnly;
      if (nextAdminOnly && !canFieldBeFacilityOnly(field)) {
        return field;
      }
      if (nextAdminOnly) {
        return {
          ...field,
          adminOnly: true,
          groupId: undefined,
        };
      }

      return {
        ...field,
        adminOnly: false,
        groupId:
          !field.perSample && field.name !== "_sample_association"
            ? field.groupId || sortedGroups[0]?.id
            : undefined,
      };
    }));
  };

  // Move field up/down within its section.
  const handleMoveField = (
    fieldId: string,
    perSample: boolean,
    adminOnly: boolean,
    direction: "up" | "down"
  ) => {
    const sectionFields = fields
      .filter((f) => !!f.perSample === perSample && !!f.adminOnly === adminOnly)
      .sort((a, b) => a.order - b.order);
    const index = sectionFields.findIndex((f) => f.id === fieldId);
    if (index === -1) return;
    const newIndex = direction === "up" ? index - 1 : index + 1;
    if (newIndex < 0 || newIndex >= sectionFields.length) return;

    const reordered = [...sectionFields];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];

    const updatedFields = fields.map((field) => {
      const sectionIndex = reordered.findIndex((f) => f.id === field.id);
      if (sectionIndex === -1) return field;
      return { ...field, order: sectionIndex };
    });

    setFields(updatedFields);
  };

  // Add option
  const handleAddOption = () => {
    if (!newOptionLabel.trim()) return;
    const value = generateFieldName(newOptionLabel);
    setFieldOptions([...fieldOptions, { label: newOptionLabel.trim(), value }]);
    setNewOptionLabel("");
  };

  // Remove option
  const handleRemoveOption = (index: number) => {
    setFieldOptions(fieldOptions.filter((_, i) => i !== index));
  };

  const persistConfiguration = useCallback(
    async (manual: boolean) => {
      if (saveInFlightRef.current) return false;

      const snapshot = JSON.stringify({ fields, groups });
      if (!manual && snapshot === lastPersistedSnapshotRef.current) {
        return true;
      }

      saveInFlightRef.current = true;
      setSaving(true);
      setError("");
      setAutoSaveStatus("saving");

      try {
        const res = await fetch("/api/admin/study-form-config", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: snapshot,
        });

        if (!res.ok) {
          const data = await res.json();
          const message = data.error || "Failed to save configuration";
          setError(message);
          setAutoSaveStatus("error");
          return false;
        }

        lastPersistedSnapshotRef.current = snapshot;
        setAutoSaveStatus("saved");
        setLastSavedAt(new Date());

        if (manual) {
          setJustSaved(true);
          setTimeout(() => setJustSaved(false), 2000);
        }

        return true;
      } catch {
        setError("Failed to save configuration");
        setAutoSaveStatus("error");
        return false;
      } finally {
        saveInFlightRef.current = false;
        setSaving(false);
      }
    },
    [fields, groups]
  );

  // Save configuration manually
  const handleSave = async () => {
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
      autoSaveTimerRef.current = null;
    }
    await persistConfiguration(true);
  };

  const handleExportConfig = () => {
    const config = {
      version: "1.0",
      type: "study",
      exportedAt: new Date().toISOString(),
      fields,
      groups,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `seqdesk-study-config-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const config = JSON.parse(event.target?.result as string) as ImportedStudyConfig;
        if (!config.fields || !Array.isArray(config.fields)) {
          setError("Invalid config: missing fields array");
          return;
        }
        if (!config.groups || !Array.isArray(config.groups)) {
          setError("Invalid config: missing groups array");
          return;
        }

        const importTimestamp = Date.now();
        const seenGroupIds = new Set<string>();
        const normalizedGroups: FormFieldGroup[] = config.groups.map((group, index) => {
          const incomingId = typeof group.id === "string" && group.id.trim() !== "" ? group.id : undefined;
          const groupId = incomingId && !seenGroupIds.has(incomingId)
            ? incomingId
            : `imported-group-${importTimestamp}-${index}`;
          seenGroupIds.add(groupId);
          return {
            ...group,
            id: groupId,
            order: typeof group.order === "number" ? group.order : index,
          };
        });

        const validGroupIds = new Set(normalizedGroups.map((group) => group.id));
        const seenFieldIds = new Set<string>();
        const normalizedFields: FormFieldDefinition[] = config.fields.map((field, index) => {
          const incomingId = typeof field.id === "string" && field.id.trim() !== "" ? field.id : undefined;
          const fieldId = incomingId && !seenFieldIds.has(incomingId)
            ? incomingId
            : `imported-${importTimestamp}-${index}`;
          seenFieldIds.add(fieldId);

          const fieldGroupId = typeof field.groupId === "string" && validGroupIds.has(field.groupId)
            ? field.groupId
            : undefined;

          return {
            ...field,
            id: fieldId,
            order: typeof field.order === "number" ? field.order : index,
            groupId: fieldGroupId,
          };
        });

        const normalized = normalizeStudyFormSchema({
          fields: normalizedFields,
          groups: normalizedGroups,
        });

        setPendingImport({
          fields: normalized.fields,
          groups: normalized.groups,
        });
        setImportDialogOpen(true);
      } catch {
        setError("Failed to parse JSON file");
      }
    };
    reader.readAsText(file);
    e.target.value = "";
  };

  const handleConfirmImport = () => {
    if (!pendingImport) return;
    setFields(pendingImport.fields);
    setGroups(pendingImport.groups);
    setPendingImport(null);
    setImportDialogOpen(false);
    setAutoSaveStatus("dirty");
  };

  // Auto-save study config after edits (debounced)
  useEffect(() => {
    if (loading) return;

    const snapshot = JSON.stringify({ fields, groups });

    if (!autoSaveInitializedRef.current) {
      autoSaveInitializedRef.current = true;
      lastPersistedSnapshotRef.current = snapshot;
      setAutoSaveStatus("saved");
      return;
    }

    if (snapshot === lastPersistedSnapshotRef.current) {
      return;
    }

    setAutoSaveStatus("dirty");

    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }

    autoSaveTimerRef.current = setTimeout(() => {
      void persistConfiguration(false);
      autoSaveTimerRef.current = null;
    }, 1200);

    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
        autoSaveTimerRef.current = null;
      }
    };
  }, [fields, groups, loading, persistConfiguration]);

  const isFieldAvailableForModules = (field: FormFieldDefinition) => {
    if (field.type === "mixs" && !mixsModuleEnabled) return false;
    if (field.type === "funding" && !fundingModuleEnabled) return false;
    return true;
  };

  const visibleFields = fields.filter(isFieldAvailableForModules);
  const hiddenByDisabledModulesCount = fields.length - visibleFields.length;

  const orderedStudyFields = visibleFields
    .filter((f) => !f.perSample && f.name !== "_sample_association" && !f.adminOnly)
    .sort((a, b) => a.order - b.order);
  const facilityStudyFields = visibleFields
    .filter((f) => !f.perSample && f.name !== "_sample_association" && f.adminOnly)
    .sort((a, b) => a.order - b.order);

  const orderedPerSampleFields = visibleFields
    .filter((f) => f.perSample && !f.adminOnly)
    .sort((a, b) => a.order - b.order);
  const facilityPerSampleFields = visibleFields
    .filter((f) => f.perSample && f.adminOnly)
    .sort((a, b) => a.order - b.order);

  const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
  const hasMixsField = visibleFields.some((f) => f.type === "mixs");
  const duplicateLegacyPerSampleFields = orderedPerSampleFields.filter((field) =>
    isLegacySubmgPerSampleFieldName(field.name)
  );
  const sectionPreviewFields: Record<string, FormFieldDefinition[]> = {
    [STUDY_INFORMATION_SECTION_ID]: orderedStudyFields.filter(
      (field) => field.groupId === STUDY_INFORMATION_SECTION_ID
    ),
    [STUDY_METADATA_SECTION_ID]: orderedStudyFields.filter(
      (field) => field.groupId === STUDY_METADATA_SECTION_ID
    ),
    "per-sample": orderedPerSampleFields,
    facility: [...facilityStudyFields, ...facilityPerSampleFields],
  };
  const isSampleAssociationField =
    fieldName.trim() === "_sample_association" || editingField?.name === "_sample_association";
  const automaticFieldSectionLabel = fieldPerSample
    ? fieldAdminOnly
      ? "Facility Sample Fields"
      : "Per-Sample tab"
    : fieldAdminOnly
      ? "Facility Fields tab"
      : isSampleAssociationField
        ? "Managed automatically"
        : "";

  const removeLegacySubmgPerSampleFields = () => {
    setFields((currentFields) => {
      const filtered = currentFields.filter(
        (field) => !(field.perSample && isLegacySubmgPerSampleFieldName(field.name))
      );
      const orderedPerSample = filtered
        .filter((field) => field.perSample)
        .sort((a, b) => a.order - b.order);
      const nextOrderById = new Map(orderedPerSample.map((field, index) => [field.id, index]));
      return filtered.map((field) =>
        field.perSample ? { ...field, order: nextOrderById.get(field.id) ?? field.order } : field
      );
    });
  };

  const autoSaveMessage = (() => {
    if (autoSaveStatus === "saving") return "Saving changes...";
    if (autoSaveStatus === "dirty") return "Unsaved changes";
    if (autoSaveStatus === "error") return "Save failed";
    if (lastSavedAt) {
      return `All changes saved at ${lastSavedAt.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      })}`;
    }
    return "All changes saved";
  })();

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  return (
    <Tabs defaultValue="fields">
      {/* Sticky header bar -- outside PageContainer, matching order form builder */}
      <div className="sticky top-0 z-30 bg-card border-b border-border">
        <div className="relative flex items-center justify-center h-[52px] px-6 lg:px-8">
          <div
            className={`absolute left-6 lg:left-8 text-xs ${
              autoSaveStatus === "error"
                ? "text-destructive"
                : autoSaveStatus === "dirty"
                  ? "text-amber-600"
                  : "text-muted-foreground"
            }`}
          >
            {autoSaveMessage}
          </div>
          <TabsList className="h-[52px] bg-transparent rounded-none p-0 gap-1">
            <TabsTrigger
              value="fields"
              className="relative h-[52px] border-0 border-b-2 border-b-transparent rounded-none px-4 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-b-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground"
            >
              Study Fields
            </TabsTrigger>
            <TabsTrigger
              value="per-sample"
              className="relative h-[52px] border-0 border-b-2 border-b-transparent rounded-none px-4 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-b-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground"
            >
              Per-Sample
            </TabsTrigger>
            <TabsTrigger
              value="facility"
              className="relative h-[52px] border-0 border-b-2 border-b-transparent rounded-none px-4 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-b-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground"
            >
              Facility Fields
            </TabsTrigger>
            <TabsTrigger
              value="settings"
              className="relative h-[52px] border-0 border-b-2 border-b-transparent rounded-none px-4 text-sm font-medium text-muted-foreground transition-colors data-[state=active]:text-foreground data-[state=active]:border-b-foreground data-[state=active]:shadow-none data-[state=active]:bg-transparent hover:text-foreground"
            >
              Settings
            </TabsTrigger>
          </TabsList>
          <div className="absolute right-6 lg:right-8 flex items-center gap-2">
            <Button onClick={handleSave} disabled={saving || justSaved} variant="outline" size="sm" className="bg-white">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
                </>
              ) : justSaved ? (
                <>
                  <Check className="h-4 w-4 mr-2 text-green-600" />
                  Saved
                </>
              ) : (
                <>
                  <Check className="h-4 w-4 mr-2" />
                  Save Now
                </>
              )}
            </Button>
          </div>
        </div>
      </div>

    <PageContainer>
      <div className="mb-4 mt-6">
        <h1 className="text-xl font-semibold">Study Configuration</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Define what information users provide when creating studies for ENA submission
        </p>
      </div>

      {error && (
        <div className="mb-6 p-4 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive">
          {error}
        </div>
      )}

      {hiddenByDisabledModulesCount > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {hiddenByDisabledModulesCount} field{hiddenByDisabledModulesCount === 1 ? "" : "s"} hidden because related modules are disabled.{" "}
          <Link href="/admin/modules" className="underline underline-offset-2">
            Manage modules
          </Link>
          .
        </div>
      )}

      <GlassCard className="mb-6 p-6">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">Current Study Overview Sections</h2>
          <span className="text-xs text-muted-foreground">
            Shared by study details, study editing, and the study sidebar
          </span>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          These sections are fixed. Study-level user fields belong to either Study Information or Metadata,
          while per-sample fields and facility-only fields are managed separately below.
        </p>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
          {[
            {
              id: STUDY_INFORMATION_SECTION_ID,
              label: "Study Information",
              description: "Core study fields shown in the main overview.",
              fields: sectionPreviewFields[STUDY_INFORMATION_SECTION_ID] || [],
              onAdd: () => handleAddField(false, false, STUDY_INFORMATION_SECTION_ID),
              actionLabel: "Add study field",
            },
            {
              id: STUDY_METADATA_SECTION_ID,
              label: "Metadata",
              description: "Environment and metadata fields shown in the main overview.",
              fields: sectionPreviewFields[STUDY_METADATA_SECTION_ID] || [],
              onAdd: () => handleAddField(false, false, STUDY_METADATA_SECTION_ID),
              actionLabel: "Add metadata field",
            },
            {
              id: "per-sample",
              label: "Per-Sample",
              description: "Shown in the study metadata table for each sample.",
              fields: sectionPreviewFields["per-sample"] || [],
              onAdd: () => handleAddField(true, false),
              actionLabel: "Add sample field",
            },
            {
              id: "facility",
              label: "Facility Fields",
              description: "Hidden from researchers and shown only to facility admins.",
              fields: sectionPreviewFields.facility || [],
              onAdd: () => undefined,
              actionLabel: "",
            },
          ].map((section) => (
            <div key={section.id} className="rounded-xl border border-border bg-background p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold">{section.label}</h3>
                  <p className="mt-1 text-xs text-muted-foreground">{section.description}</p>
                </div>
                <span className="rounded-full bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                  {section.fields.length} field{section.fields.length === 1 ? "" : "s"}
                </span>
              </div>
              <div className="mt-3 min-h-14 rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-2">
                {section.fields.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {section.fields.slice(0, 4).map((field) => (
                      <span
                        key={field.id}
                        className={`rounded px-2 py-1 text-[10px] font-medium ${
                          field.adminOnly
                            ? "bg-slate-200 text-slate-700"
                            : field.perSample
                              ? "bg-amber-100 text-amber-700"
                              : field.type === "mixs"
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-background text-foreground"
                        }`}
                      >
                        {field.label}
                      </span>
                    ))}
                    {section.fields.length > 4 && (
                      <span className="rounded bg-muted px-2 py-1 text-[10px] font-medium text-muted-foreground">
                        +{section.fields.length - 4} more
                      </span>
                    )}
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground">
                    {section.id === "facility"
                      ? "No facility-only fields yet."
                      : section.id === "per-sample"
                        ? "No per-sample fields yet."
                        : "No fields assigned yet."}
                  </p>
                )}
              </div>
              {section.id !== "facility" ? (
                <div className="mt-3 flex justify-end">
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="bg-white"
                    onClick={section.onAdd}
                  >
                    <Plus className="mr-2 h-4 w-4" />
                    {section.actionLabel}
                  </Button>
                </div>
              ) : (
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="rounded bg-slate-200 px-2 py-0.5 text-[10px] font-medium text-slate-700">
                    Hidden from users
                  </span>
                  <div className="flex gap-2">
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="bg-white"
                      onClick={() => handleAddField(false, true)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add study field
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="bg-white"
                      onClick={() => handleAddField(true, true)}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      Add sample field
                    </Button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </GlassCard>

      {/* Study Fields - filled once per study */}
      <TabsContent value="fields">
        <HelpBox title="What are study fields?">
          Study fields are filled once per study. They capture information that applies to the entire study, such as the principal investigator, study design, or research objectives.
        </HelpBox>
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold">Active Study Fields</h2>
          </div>
          <Button onClick={() => handleAddField(false)} variant="outline" size="sm" className="bg-white">
            <Plus className="h-4 w-4 mr-2" />
            Add Custom Field
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Fields filled <strong>once per study</strong>. Information that applies to the entire study, such as principal investigator, study design, or research objectives.
        </p>

        <div className="space-y-3">
          {/* Sample Association indicator - shown when enabled */}
          {fields.some(f => f.name === "_sample_association") && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-blue-100/50 border border-blue-200">
              <div className="h-8 w-8 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                <Link2 className="h-4 w-4 text-blue-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-blue-800">Sample Association</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-200 text-blue-700 font-medium">
                    Module
                  </span>
                </div>
                <p className="text-xs text-blue-600 mt-1">
                  Interface to select and associate samples from orders to this study
                </p>
              </div>
              <div className="text-xs text-blue-500 px-2">
                Default Active
              </div>
            </div>
          )}

          {orderedStudyFields.map((field, index) => {
            const isMixsField = field.type === "mixs";

            // Special styling for MIxS module fields
            if (isMixsField) {
              return (
                <div key={field.id} className="flex items-center gap-3 p-4 rounded-lg bg-emerald-100/50 border border-emerald-200">
                  <div className="h-8 w-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Leaf className="h-4 w-4 text-emerald-600" />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-emerald-800">{field.label}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-700 font-medium">
                        Module
                      </span>
                    </div>
                    <p className="text-xs text-emerald-600 mt-1">
                      Select the MIxS environment checklist for this study (Soil, Water, Human Gut, etc.)
                    </p>
                  </div>
                  <div className="text-xs text-emerald-500 px-2">
                    From MIxS Module
                  </div>
                </div>
              );
            }

            return (
              <div key={field.id} className="flex items-center gap-3 p-4 rounded-lg bg-muted/30">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveField(field.id, false, false, "up")}
                    disabled={index === 0}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveField(field.id, false, false, "down")}
                    disabled={index === orderedStudyFields.length - 1}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{field.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {FIELD_TYPE_LABELS[field.type] || field.type}
                    </span>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {orderedGroups.find((g) => g.id === field.groupId)?.name || orderedGroups[0]?.name}
                    </span>
                  </div>
                </div>
                {canFieldBeFacilityOnly(field) && (
                  <button
                    type="button"
                    onClick={() => toggleFieldAdminOnly(field.id)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors flex-shrink-0 bg-transparent text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted"
                    title="Move this field to Facility Fields"
                  >
                    <Shield className="h-3 w-3" />
                    Facility only
                  </button>
                )}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEditField(field)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openDeleteFieldDialog(field)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {orderedStudyFields.length === 0 && !fields.some(f => f.name === "_sample_association") && (
            <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg">
              No study fields defined yet.
            </div>
          )}
        </div>
      </GlassCard>

      {/* Suggested Study Fields */}
      <GlassCard className="p-6 mt-4">
        <div className="mb-4">
          <h3 className="text-base font-medium">Suggested Study Fields</h3>
          <p className="text-sm text-muted-foreground">
            Common fields for study metadata. Click to add.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Principal Investigator */}
          {(() => {
            const piField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Principal Investigator",
              name: "principal_investigator",
              required: false,
              visible: true,
              perSample: false,
              helpText: "Lead researcher responsible for this study",
              placeholder: "e.g., Dr. Jane Smith",
            };
            const alreadyAdded = fields.some((f) => f.name === piField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(piField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                    : "bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Principal Investigator</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Study Abstract */}
          {(() => {
            const abstractField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "textarea",
              label: "Study Abstract",
              name: "study_abstract",
              required: false,
              visible: true,
              perSample: false,
              helpText: "Brief description of the study's purpose and methodology",
              placeholder: "Describe the scientific objectives and approach...",
            };
            const alreadyAdded = fields.some((f) => f.name === abstractField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(abstractField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                    : "bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Study Abstract</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Study Type */}
          {(() => {
            const typeField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "select",
              label: "Study Type",
              name: "study_type",
              required: false,
              visible: true,
              perSample: false,
              helpText: "Classification of the study design",
              options: [
                { label: "Whole Genome Sequencing", value: "wgs" },
                { label: "Metagenomics", value: "metagenomics" },
                { label: "Amplicon Sequencing (16S/18S/ITS)", value: "amplicon" },
                { label: "Transcriptomics", value: "transcriptomics" },
                { label: "Other", value: "other" },
              ],
            };
            const alreadyAdded = fields.some((f) => f.name === typeField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(typeField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                    : "bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Study Type</span>
                <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground font-medium">5 options</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}
        </div>
      </GlassCard>
      </TabsContent>

      {/* Per-Sample Fields - filled for each sample */}
      <TabsContent value="per-sample">
        <HelpBox title="What are per-sample fields?">
          Per-sample fields are filled for each sample in a table view. They capture data that varies between samples, such as collection date, geographic location, or host information.
        </HelpBox>
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <Table className="h-4 w-4 text-muted-foreground" />
            </div>
            <h2 className="text-base font-semibold">Per-Sample Fields</h2>
          </div>
          <Button onClick={() => handleAddField(true)} variant="outline" size="sm" className="bg-white">
            <Plus className="h-4 w-4 mr-2" />
            Add Custom Field
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Fields filled <strong>for each sample</strong> in a table view. Use for sample-specific metadata like collection date, geographic location, or treatment conditions.
        </p>
        {hasMixsField && duplicateLegacyPerSampleFields.length > 0 && (
          <div className="mb-4 rounded-lg border border-border bg-muted/30 p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-muted-foreground">
              MIxS is active and already provides collection date/location fields. Remove legacy duplicate fields to avoid showing both.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={removeLegacySubmgPerSampleFields}
            >
              Remove duplicates
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {orderedPerSampleFields.map((field, index) => {
            return (
              <div key={field.id} className="flex items-center gap-3 p-4 rounded-lg bg-muted/30">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveField(field.id, true, false, "up")}
                    disabled={index === 0}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveField(field.id, true, false, "down")}
                    disabled={index === orderedPerSampleFields.length - 1}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{field.label}</span>
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {FIELD_TYPE_LABELS[field.type] || field.type}
                    </span>
                    {field.required && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600">
                        Required
                      </span>
                    )}
                    {hasMixsField && isLegacySubmgPerSampleFieldName(field.name) && (
                      <span className="text-xs px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700">
                        Duplicated by MIxS
                      </span>
                    )}
                  </div>
                  {field.helpText && (
                    <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                  )}
                </div>
                {canFieldBeFacilityOnly(field) && (
                  <button
                    type="button"
                    onClick={() => toggleFieldAdminOnly(field.id)}
                    className="flex items-center gap-1.5 px-2 py-1 rounded text-[11px] font-medium transition-colors flex-shrink-0 bg-transparent text-muted-foreground/60 hover:text-muted-foreground hover:bg-muted"
                    title="Move this field to Facility Fields"
                  >
                    <Shield className="h-3 w-3" />
                    Facility only
                  </button>
                )}
                <div className="flex items-center gap-1">
                  <Button variant="ghost" size="icon" onClick={() => handleEditField(field)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openDeleteFieldDialog(field)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {/* MIxS Per-Sample Fields Indicator - shown when MIxS is added to study fields */}
          {hasMixsField && (
            <div className="flex items-center gap-3 p-4 rounded-lg bg-emerald-100/50 border border-emerald-200">
              <div className="h-8 w-8 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                <Leaf className="h-4 w-4 text-emerald-600" />
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-emerald-800">MIxS Sample Metadata</span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-200 text-emerald-700 font-medium">
                    Module
                  </span>
                </div>
                <p className="text-xs text-emerald-600 mt-1">
                  Environment-specific fields based on the MIxS checklist selected at study level. Fields are determined by the checklist type (Soil, Water, Human Gut, etc.).
                </p>
              </div>
              <div className="text-xs text-emerald-500 px-2">
                Auto-configured
              </div>
            </div>
          )}

          {orderedPerSampleFields.length === 0 && !hasMixsField && (
            <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg">
              No per-sample fields defined. Add fields here for data that varies between samples.
            </div>
          )}
        </div>
      </GlassCard>

      {/* Suggested Per-Sample Fields */}
      <GlassCard className="p-6 mt-4">
        <div className="mb-4">
          <h3 className="text-base font-medium flex items-center gap-2">
            <Table className="h-4 w-4 text-muted-foreground" />
            Suggested Per-Sample Fields
          </h3>
          <p className="text-sm text-muted-foreground">
            Common fields for sample-level metadata. Click to add.
            {hasMixsField && " Collection Date and Geographic Location are managed by MIxS while the module is active."}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Collection Date */}
          {(() => {
            const dateField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "date",
              label: "Collection Date",
              name: "collection_date",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Date when the sample was collected",
            };
            const alreadyAdded = fields.some((f) => f.name === dateField.name);
            const blockedByMixs = hasMixsField;
            const disabled = alreadyAdded || blockedByMixs;
            return (
              <button
                type="button"
                onClick={() => !disabled && addSuggestedField(dateField)}
                disabled={disabled}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  disabled
                    ? "bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                    : "bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                }`}
              >
                <Plus className={`h-3 w-3 ${disabled ? "opacity-30" : ""}`} />
                <span>Collection Date</span>
                {blockedByMixs && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
                    MIxS
                  </span>
                )}
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Geographic Location */}
          {(() => {
            const locationField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Geographic Location",
              name: "geographic_location",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Location where the sample was collected (country:region:locality)",
              placeholder: "e.g., Germany:Lower Saxony:Braunschweig",
            };
            const alreadyAdded = fields.some((f) => f.name === locationField.name);
            const blockedByMixs = hasMixsField;
            const disabled = alreadyAdded || blockedByMixs;
            return (
              <button
                type="button"
                onClick={() => !disabled && addSuggestedField(locationField)}
                disabled={disabled}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  disabled
                    ? "bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                    : "bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                }`}
              >
                <Plus className={`h-3 w-3 ${disabled ? "opacity-30" : ""}`} />
                <span>Geographic Location</span>
                {blockedByMixs && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium">
                    MIxS
                  </span>
                )}
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Host Subject ID */}
          {(() => {
            const hostField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Host Subject ID",
              name: "host_subject_id",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Unique identifier for the host organism (anonymized for human subjects)",
              placeholder: "e.g., Subject_001",
            };
            const alreadyAdded = fields.some((f) => f.name === hostField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(hostField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                    : "bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Host Subject ID</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}
        </div>
      </GlassCard>
      </TabsContent>

      <TabsContent value="facility">
        <HelpBox title="What are facility fields?">
          Facility fields are internal annotations used by the sequencing team. They stay hidden from researchers
          and can be defined separately for the study record or for each linked sample.
        </HelpBox>

        <div className="space-y-4">
          <GlassCard className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Study-Level Facility Fields</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Internal study metadata such as intake notes, review annotations, or coordination details.
                </p>
              </div>
              <Button
                onClick={() => handleAddField(false, true)}
                variant="outline"
                size="sm"
                className="bg-white"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Internal Study Field
              </Button>
            </div>

            <div className="space-y-3">
              {facilityStudyFields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-3 rounded-lg bg-muted/30 p-4">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveField(field.id, false, true, "up")}
                      disabled={index === 0}
                      className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveField(field.id, false, true, "down")}
                      disabled={index === facilityStudyFields.length - 1}
                      className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <GripVertical className="h-4 w-4 text-muted-foreground" />

                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{field.label}</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        Hidden from users
                      </span>
                      <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary">
                        Study-level
                      </span>
                    </div>
                    {field.helpText && (
                      <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleFieldAdminOnly(field.id)}
                    className="flex flex-shrink-0 items-center gap-1.5 rounded bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-300"
                    title="Make this field visible to researchers again"
                  >
                    <Shield className="h-3 w-3" />
                    Show to users
                  </button>

                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleEditField(field)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDeleteFieldDialog(field)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {facilityStudyFields.length === 0 && (
                <div className="rounded-lg border border-dashed py-6 text-center text-muted-foreground">
                  No internal study-level fields defined yet.
                </div>
              )}
            </div>
          </GlassCard>

          <GlassCard className="p-6">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Per-Sample Facility Fields</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Internal sample annotations such as QC notes, processing status, or production tracking fields.
                </p>
              </div>
              <Button
                onClick={() => handleAddField(true, true)}
                variant="outline"
                size="sm"
                className="bg-white"
              >
                <Plus className="mr-2 h-4 w-4" />
                Add Internal Sample Field
              </Button>
            </div>

            <div className="space-y-3">
              {facilityPerSampleFields.map((field, index) => (
                <div key={field.id} className="flex items-center gap-3 rounded-lg bg-muted/30 p-4">
                  <div className="flex flex-col gap-1">
                    <button
                      type="button"
                      onClick={() => handleMoveField(field.id, true, true, "up")}
                      disabled={index === 0}
                      className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronUp className="h-3 w-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleMoveField(field.id, true, true, "down")}
                      disabled={index === facilityPerSampleFields.length - 1}
                      className="rounded p-1 hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronDown className="h-3 w-3" />
                    </button>
                  </div>
                  <GripVertical className="h-4 w-4 text-muted-foreground" />

                  <div className="flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">{field.label}</span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-medium text-slate-700">
                        Hidden from users
                      </span>
                      <span className="rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-700">
                        Per-sample
                      </span>
                    </div>
                    {field.helpText && (
                      <p className="mt-1 text-xs text-muted-foreground">{field.helpText}</p>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => toggleFieldAdminOnly(field.id)}
                    className="flex flex-shrink-0 items-center gap-1.5 rounded bg-slate-200 px-2 py-1 text-[11px] font-medium text-slate-700 transition-colors hover:bg-slate-300"
                    title="Make this field visible to researchers again"
                  >
                    <Shield className="h-3 w-3" />
                    Show to users
                  </button>

                  <div className="flex items-center gap-1">
                    <Button variant="ghost" size="icon" onClick={() => handleEditField(field)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => openDeleteFieldDialog(field)}
                      className="text-destructive hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              ))}

              {facilityPerSampleFields.length === 0 && (
                <div className="rounded-lg border border-dashed py-6 text-center text-muted-foreground">
                  No internal per-sample fields defined yet.
                </div>
              )}
            </div>
          </GlassCard>
        </div>
      </TabsContent>

      {/* Settings Tab */}
      <TabsContent value="settings">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <GlassCard className="p-6">
            <h3 className="text-base font-semibold mb-2">Export Configuration</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Download your current study form configuration as a JSON file.
            </p>
            <Button onClick={handleExportConfig} variant="outline" className="bg-white">
              <Download className="h-4 w-4 mr-2" />
              Export Configuration
            </Button>
          </GlassCard>
          <GlassCard className="p-6">
            <h3 className="text-base font-semibold mb-2">Import Configuration</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Upload a previously exported study form configuration to restore fields and groups.
            </p>
            <Button onClick={() => importFileRef.current?.click()} variant="outline" className="bg-white">
              <Upload className="h-4 w-4 mr-2" />
              Import Configuration
            </Button>
          </GlassCard>
        </div>
      </TabsContent>

      {/* Import Confirmation Dialog */}
      <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Import Configuration</DialogTitle>
            <DialogDescription>
              This will replace your current configuration with the imported one.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <p className="text-sm text-muted-foreground">
              The import contains <strong>{pendingImport?.fields?.length || 0} fields</strong> and <strong>{pendingImport?.groups?.length || 0} groups</strong>.
            </p>
            <p className="text-sm text-amber-600 mt-2">
              This action will replace all existing fields and groups. Auto-save will persist the changes.
            </p>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setImportDialogOpen(false)}>Cancel</Button>
            <Button onClick={handleConfirmImport}>Import</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Field Editor Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editingField ? "Edit Field" : "Add New Field"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="fieldLabel">Label *</Label>
              <Input
                id="fieldLabel"
                value={fieldLabel}
                onChange={(e) => {
                  setFieldLabel(e.target.value);
                  if (!editingField) {
                    setFieldName(generateFieldName(e.target.value));
                  }
                }}
                placeholder="e.g., Principal Investigator"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="fieldName">Field Key</Label>
              <Input
                id="fieldName"
                value={fieldName}
                onChange={(e) => setFieldName(e.target.value)}
                placeholder="e.g., principal_investigator"
                className="font-mono text-sm"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Field Type</Label>
                <Select
                  value={fieldType}
                  onValueChange={(v) => {
                    const nextType = v as FieldType;
                    setFieldType(nextType);
                    if (
                      fieldAdminOnly &&
                      !canFieldBeFacilityOnly({
                        type: nextType,
                        moduleSource: editingField?.moduleSource,
                        name: fieldName.trim() || editingField?.name || "",
                      })
                    ) {
                      setFieldAdminOnly(false);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="text">Text</SelectItem>
                    <SelectItem value="textarea">Textarea</SelectItem>
                    <SelectItem value="number">Number</SelectItem>
                    <SelectItem value="date">Date</SelectItem>
                    <SelectItem value="select">Dropdown</SelectItem>
                    <SelectItem value="multiselect">Multi-select</SelectItem>
                    <SelectItem value="checkbox">Checkbox</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label>Section</Label>
                {automaticFieldSectionLabel ? (
                  <div className="flex h-10 items-center rounded-md border border-input bg-muted/30 px-3 text-sm text-muted-foreground">
                    {automaticFieldSectionLabel}
                  </div>
                ) : (
                  <Select
                    value={fieldGroupId || orderedGroups[0]?.id || STUDY_INFORMATION_SECTION_ID}
                    onValueChange={setFieldGroupId}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Select section..." />
                    </SelectTrigger>
                    <SelectContent>
                      {orderedGroups.map((group) => (
                        <SelectItem key={group.id} value={group.id}>
                          {group.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                <p className="text-xs text-muted-foreground">
                  {automaticFieldSectionLabel
                    ? "This field is placed automatically based on its scope."
                    : "Choose which fixed overview section users see this field under during study entry."}
                </p>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-6">
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fieldVisible}
                    onChange={(e) => setFieldVisible(e.target.checked)}
                    className="rounded border-input h-4 w-4"
                  />
                  <span className="text-sm">Visible</span>
                </label>
                <label className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={fieldRequired}
                    onChange={(e) => setFieldRequired(e.target.checked)}
                    className="rounded border-input h-4 w-4"
                  />
                  <span className="text-sm">Required</span>
                </label>
                <label
                  className={`flex items-center gap-2 ${(canCurrentFieldBeFacilityOnly || fieldAdminOnly) ? "cursor-pointer" : "cursor-not-allowed opacity-60"}`}
                  title={
                    canCurrentFieldBeFacilityOnly || fieldAdminOnly
                      ? "Only visible to facility admins"
                      : "Reserved and module-managed fields must stay visible in the main study flow"
                  }
                >
                  <input
                    type="checkbox"
                    checked={fieldAdminOnly}
                    onChange={(e) => setFieldAdminOnly(e.target.checked)}
                    className="rounded border-input h-4 w-4"
                    disabled={!canCurrentFieldBeFacilityOnly && !fieldAdminOnly}
                  />
                  <span className="text-sm flex items-center gap-1">
                    <Shield className="h-3 w-3 text-slate-500" />
                    Facility only
                  </span>
                </label>
              </div>
              <div className="space-y-2">
                <Label>Field Scope</Label>
                <div
                  className="inline-flex rounded-md border border-input bg-muted/30 p-1"
                  role="group"
                  aria-label="Field scope"
                >
                  <button
                    type="button"
                    onClick={() => setFieldPerSample(false)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      !fieldPerSample
                        ? "bg-background shadow-sm text-foreground"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Study-level
                  </button>
                  <button
                    type="button"
                    onClick={() => setFieldPerSample(true)}
                    className={`px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                      fieldPerSample
                        ? "bg-amber-100 text-amber-700 shadow-sm"
                        : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    Per-sample
                  </button>
                </div>
              </div>
            </div>

            {fieldPerSample && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
                <strong>Per-Sample Field:</strong> This field will appear in the sample entry table where users fill values for each sample individually.
                Examples: collection date, geographic location, host subject ID.
              </div>
            )}
            {!fieldPerSample && (
              <div className="p-3 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground">
                <strong>Study Field:</strong> This field will be filled once when creating the study.
              </div>
            )}

            {fieldAdminOnly && (
              <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
                <strong>Facility-Only:</strong> This field is only visible to facility admins. Researchers will not see it.
              </div>
            )}
            {!canCurrentFieldBeFacilityOnly && (
              <div className="p-3 rounded-lg bg-amber-50 border border-amber-200 text-sm text-amber-700">
                <strong>Main Flow Field:</strong> Reserved and module-managed fields must stay visible in the main study flow.
              </div>
            )}

            <div className="space-y-2">
              <Label>Placeholder</Label>
              <Input
                value={fieldPlaceholder}
                onChange={(e) => setFieldPlaceholder(e.target.value)}
                placeholder="e.g., Enter name..."
              />
            </div>

            <div className="space-y-2">
              <Label>Help Text</Label>
              <Input
                value={fieldHelpText}
                onChange={(e) => setFieldHelpText(e.target.value)}
                placeholder="Explanatory text for users"
              />
            </div>

            {/* Options for select/multiselect */}
            {(fieldType === "select" || fieldType === "multiselect") && (
              <div className="space-y-2">
                <Label>Options</Label>
                <div className="space-y-1 max-h-32 overflow-y-auto">
                  {fieldOptions.map((opt, i) => (
                    <div key={i} className="flex items-center gap-2">
                      <span className="flex-1 text-sm px-2 py-1 rounded bg-muted truncate">
                        {opt.label}
                      </span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-6 w-6"
                        onClick={() => handleRemoveOption(i)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <Input
                    value={newOptionLabel}
                    onChange={(e) => setNewOptionLabel(e.target.value)}
                    placeholder="New option..."
                    className="flex-1 h-8"
                    onKeyDown={(e) => e.key === "Enter" && handleAddOption()}
                  />
                  <Button type="button" variant="outline" size="sm" className="h-8" onClick={handleAddOption}>
                    <Plus className="h-3 w-3" />
                  </Button>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveField}>
              {editingField ? "Update" : "Add"} Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Field Confirmation Dialog */}
      <Dialog open={deleteFieldDialogOpen} onOpenChange={setDeleteFieldDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Field</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the field &quot;{fieldToDelete?.label}&quot;? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setDeleteFieldDialogOpen(false);
              setFieldToDelete(null);
            }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteField}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Field
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </PageContainer>
    {/* Hidden file input for import */}
    <input type="file" ref={importFileRef} accept=".json" onChange={handleImportFile} className="hidden" />
    </Tabs>
  );
}
