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
  Wallet,
  Package,
  FileText,
  Table,
  Link2,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  FormFieldDefinition,
  FormFieldGroup,
  FieldType,
  SelectOption,
  FIELD_TYPE_LABELS,
} from "@/types/form-config";
import { ModuleGate, useModule } from "@/lib/modules";

// Default groups for study forms
const DEFAULT_STUDY_GROUPS: FormFieldGroup[] = [
  { id: "group_study_info", name: "Study Information", order: 0 },
  { id: "group_metadata", name: "Metadata", order: 1 },
];

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

export default function StudyFormBuilderPage() {
  const { enabled: mixsModuleEnabled } = useModule("mixs-metadata");
  const { enabled: fundingModuleEnabled } = useModule("funding-info");

  const [fields, setFields] = useState<FormFieldDefinition[]>([]);
  const [groups, setGroups] = useState<FormFieldGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [autoSaveStatus, setAutoSaveStatus] = useState<"idle" | "dirty" | "saving" | "saved" | "error">("idle");
  const [lastSavedAt, setLastSavedAt] = useState<Date | null>(null);
  const [jumpTarget, setJumpTarget] = useState<string | undefined>(undefined);
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveInitializedRef = useRef(false);
  const lastPersistedSnapshotRef = useRef("");
  const saveInFlightRef = useRef(false);

  // Group dialog state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FormFieldGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");

  // Delete confirmation dialogs
  const [deleteFieldDialogOpen, setDeleteFieldDialogOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<FormFieldDefinition | null>(null);
  const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<FormFieldGroup | null>(null);

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

          setFields(loadedFields);
          setGroups(data.groups || DEFAULT_STUDY_GROUPS);
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
    setFieldHelpText("");
    setFieldPlaceholder("");
    setFieldOptions([]);
    setFieldGroupId("");
    setEditingField(null);
  };

  // Open dialog for new field
  const handleAddField = (perSample: boolean = false) => {
    resetFieldForm();
    setFieldPerSample(perSample);
    if (!perSample && groups.length > 0) {
      const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
      setFieldGroupId(sortedGroups[0].id);
    }
    setDialogOpen(true);
  };

  // Helper to add a suggested field
  const addSuggestedField = (template: Omit<FormFieldDefinition, "id" | "order">) => {
    const nextOrder = template.perSample
      ? fields.filter((f) => f.perSample).length
      : fields.filter((f) => !f.perSample).length;
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

    const targetSectionCount = fields.filter(
      (f) => !!f.perSample === fieldPerSample && f.id !== editingField?.id
    ).length;
    const order = editingField && editingField.perSample === fieldPerSample
      ? editingField.order ?? targetSectionCount
      : targetSectionCount;

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
      groupId: fieldGroupId || undefined,
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

  // Move field up/down within its section (study vs per-sample)
  const handleMoveField = (
    fieldId: string,
    perSample: boolean,
    direction: "up" | "down"
  ) => {
    const sectionFields = fields
      .filter((f) => !!f.perSample === perSample)
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

  // Group management
  const handleAddGroup = () => {
    setEditingGroup(null);
    setGroupName("");
    setGroupDescription("");
    setGroupDialogOpen(true);
  };

  const handleEditGroup = (group: FormFieldGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupDescription(group.description || "");
    setGroupDialogOpen(true);
  };

  const handleSaveGroup = () => {
    if (!groupName.trim()) {
      setError("Group name is required");
      return;
    }

    const newGroup: FormFieldGroup = {
      id: editingGroup?.id || `group_${Date.now()}`,
      name: groupName.trim(),
      description: groupDescription.trim() || undefined,
      order: editingGroup?.order ?? groups.length,
    };

    if (editingGroup) {
      setGroups(groups.map((g) => (g.id === editingGroup.id ? newGroup : g)));
    } else {
      setGroups([...groups, newGroup]);
    }

    setGroupDialogOpen(false);
    setError("");
  };

  // Open delete group dialog
  const openDeleteGroupDialog = (group: FormFieldGroup) => {
    setGroupToDelete(group);
    setDeleteGroupDialogOpen(true);
  };

  // Delete group
  const handleDeleteGroup = () => {
    if (!groupToDelete) return;
    setFields(fields.map((f) => (f.groupId === groupToDelete.id ? { ...f, groupId: undefined } : f)));
    setGroups(groups.filter((g) => g.id !== groupToDelete.id));
    setDeleteGroupDialogOpen(false);
    setGroupToDelete(null);
  };

  const handleMoveGroup = (groupId: string, direction: "up" | "down") => {
    const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
    const currentIndex = orderedGroups.findIndex((group) => group.id === groupId);
    if (currentIndex === -1) return;

    const targetIndex = direction === "up" ? currentIndex - 1 : currentIndex + 1;
    if (targetIndex < 0 || targetIndex >= orderedGroups.length) return;

    const reordered = [...orderedGroups];
    [reordered[currentIndex], reordered[targetIndex]] = [
      reordered[targetIndex],
      reordered[currentIndex],
    ];

    setGroups(reordered.map((group, index) => ({ ...group, order: index })));
  };

  // Add MIxS field
  const addMixsField = () => {
    if (fields.some((f) => f.type === "mixs")) {
      setError("A MIxS Metadata field already exists");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const newField: FormFieldDefinition = {
      id: `field_mixs_${Date.now()}`,
      type: "mixs",
      label: "MIxS Metadata",
      name: "_mixs",
      required: false,
      visible: true,
      helpText: "Environment-specific metadata fields following MIxS standards",
      order: fields.filter((f) => !f.perSample).length,
      groupId: groups.find(g => g.name.toLowerCase().includes("metadata"))?.id,
    };

    setFields([...fields, newField]);
  };

  // Add Funding field
  const addFundingField = () => {
    if (fields.some((f) => f.type === "funding")) {
      setError("A Funding Information field already exists");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const newField: FormFieldDefinition = {
      id: `field_funding_${Date.now()}`,
      type: "funding",
      label: "Funding Information",
      name: "_funding",
      required: false,
      visible: true,
      helpText: "Grant and funding source information for this study",
      order: fields.filter((f) => !f.perSample).length,
      groupId: groups.find(g => g.name.toLowerCase().includes("info"))?.id,
    };

    setFields([...fields, newField]);
  };

  // Add Sample Association field
  const addSampleAssociationField = () => {
    if (fields.some((f) => f.name === "_sample_association")) {
      setError("Sample Association is already enabled");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const newField: FormFieldDefinition = {
      id: `field_sample_association_${Date.now()}`,
      type: "text", // Using text as placeholder type - the actual UI is custom
      label: "Sample Association",
      name: "_sample_association",
      required: false,
      visible: true,
      helpText: "Interface to associate samples from orders to this study",
      order: fields.filter((f) => !f.perSample).length,
    };

    setFields([...fields, newField]);
  };

  // Remove Sample Association field
  const removeSampleAssociationField = () => {
    setFields(fields.filter((f) => f.name !== "_sample_association"));
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
      if (manual) {
        setSuccess("");
      }
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
          setSuccess("Configuration saved successfully!");
          setTimeout(() => setSuccess(""), 3000);
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
    setSuccess("");

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
    .filter((f) => !f.perSample && f.name !== "_sample_association")
    .sort((a, b) => a.order - b.order);

  const orderedPerSampleFields = visibleFields
    .filter((f) => f.perSample)
    .sort((a, b) => a.order - b.order);
  const orderedGroups = [...groups].sort((a, b) => a.order - b.order);
  const hasMixsField = visibleFields.some((f) => f.type === "mixs");
  const duplicateLegacyPerSampleFields = orderedPerSampleFields.filter((field) =>
    isLegacySubmgPerSampleFieldName(field.name)
  );

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

  const handleJumpToSection = (sectionId: string) => {
    setJumpTarget(undefined);
    const section = document.getElementById(sectionId);
    if (section) {
      section.scrollIntoView({ behavior: "smooth", block: "start" });
    }
  };

  if (loading) {
    return (
      <PageContainer className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <div className="sticky top-0 z-40 -mx-4 md:-mx-8 mb-6 border-y border-border bg-background/95 backdrop-blur">
        <div className="px-4 md:px-8 py-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div
            className={`text-xs ${
              autoSaveStatus === "error"
                ? "text-destructive"
                : autoSaveStatus === "dirty"
                  ? "text-amber-600"
                  : "text-muted-foreground"
            }`}
          >
            {autoSaveMessage}
          </div>
          <div className="flex items-center gap-2">
            <Select value={jumpTarget} onValueChange={handleJumpToSection}>
              <SelectTrigger className="h-8 w-[200px] bg-white">
                <SelectValue placeholder="Jump to section" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="study-groups-section">Form Groups</SelectItem>
                <SelectItem value="study-fields-section">Study Fields</SelectItem>
                <SelectItem value="study-per-sample-section">Per-Sample Fields</SelectItem>
                <SelectItem value="study-modules-section">Module Forms</SelectItem>
              </SelectContent>
            </Select>
            <Button onClick={handleSave} disabled={saving} variant="outline" size="sm" className="bg-white">
              {saving ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Saving...
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

      <div className="mb-4">
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

      {success && (
        <div className="mb-6 p-4 rounded-lg bg-green-500/10 border border-green-500/20 text-green-600">
          {success}
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

      {/* Form Groups */}
      <div id="study-groups-section" className="scroll-mt-28">
      <GlassCard className="p-6 mb-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Form Groups (Steps)</h2>
          <Button onClick={handleAddGroup} variant="outline" size="sm" className="bg-white">
            <Plus className="h-4 w-4 mr-2" />
            Add Group
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Groups organize your study form into sections. Use the arrows to reorder.
        </p>

        <div className="space-y-2">
          {orderedGroups.map((group, index) => {
            const fieldCount = visibleFields.filter((f) => f.groupId === group.id).length;
            return (
              <div key={group.id} className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveGroup(group.id, "up")}
                    disabled={index === 0}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveGroup(group.id, "down")}
                    disabled={index === orderedGroups.length - 1}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-muted-foreground" />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="font-medium">{group.name}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {fieldCount} field{fieldCount !== 1 ? "s" : ""}
                    </span>
                  </div>
                  {group.description && (
                    <p className="text-sm text-muted-foreground">{group.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="ghost" size="icon" onClick={() => handleEditGroup(group)}>
                    <Pencil className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={() => openDeleteGroupDialog(group)}
                    className="text-destructive hover:text-destructive"
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            );
          })}

          {groups.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              No groups defined. Add a group to organize your form fields.
            </div>
          )}
        </div>
      </GlassCard>
      </div>

      {/* Study Fields - filled once per study */}
      <div id="study-fields-section" className="scroll-mt-28">
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-primary/10 flex items-center justify-center">
              <FileText className="h-4 w-4 text-primary" />
            </div>
            <h2 className="text-base font-semibold">Study Fields</h2>
          </div>
          <Button onClick={() => handleAddField(false)} variant="outline" size="sm" className="bg-white">
            <Plus className="h-4 w-4 mr-2" />
            Add Field
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
                    onClick={() => handleMoveField(field.id, false, "up")}
                    disabled={index === 0}
                    className="p-1 hover:bg-muted rounded disabled:opacity-30"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveField(field.id, false, "down")}
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
                    {field.groupId ? (
                      <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                        {groups.find((g) => g.id === field.groupId)?.name || "Unknown"}
                      </span>
                    ) : (
                      <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                        No group
                      </span>
                    )}
                  </div>
                </div>
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
      </div>

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

      {/* Per-Sample Fields - filled for each sample */}
      <div id="study-per-sample-section" className="scroll-mt-28">
      <GlassCard className="p-6 border-amber-200 bg-amber-50/30 mt-8">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-3">
            <div className="h-8 w-8 rounded-lg bg-amber-500/10 flex items-center justify-center">
              <Table className="h-4 w-4 text-amber-600" />
            </div>
            <h2 className="text-base font-semibold">Per-Sample Fields</h2>
          </div>
          <Button onClick={() => handleAddField(true)} variant="outline" size="sm" className="border-amber-300 hover:bg-amber-100">
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Fields filled <strong>for each sample</strong> in a table view. Use for sample-specific metadata like collection date, geographic location, or treatment conditions.
        </p>
        {hasMixsField && duplicateLegacyPerSampleFields.length > 0 && (
          <div className="mb-4 rounded-lg border border-amber-300 bg-amber-100/70 p-3 flex items-center justify-between gap-3">
            <p className="text-xs text-amber-800">
              MIxS is active and already provides collection date/location fields. Remove legacy duplicate fields to avoid showing both.
            </p>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="border-amber-400 text-amber-800 hover:bg-amber-200"
              onClick={removeLegacySubmgPerSampleFields}
            >
              Remove duplicates
            </Button>
          </div>
        )}

        <div className="space-y-3">
          {orderedPerSampleFields.map((field, index) => {
            return (
              <div key={field.id} className="flex items-center gap-3 p-4 rounded-lg bg-amber-100/50 border border-amber-200">
                <div className="flex flex-col gap-1">
                  <button
                    type="button"
                    onClick={() => handleMoveField(field.id, true, "up")}
                    disabled={index === 0}
                    className="p-1 hover:bg-amber-200 rounded disabled:opacity-30"
                  >
                    <ChevronUp className="h-3 w-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleMoveField(field.id, true, "down")}
                    disabled={index === orderedPerSampleFields.length - 1}
                    className="p-1 hover:bg-amber-200 rounded disabled:opacity-30"
                  >
                    <ChevronDown className="h-3 w-3" />
                  </button>
                </div>
                <GripVertical className="h-4 w-4 text-amber-400" />
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
            <div className="text-center py-6 text-amber-600/70 border border-dashed border-amber-300 rounded-lg bg-amber-50">
              No per-sample fields defined. Add fields here for data that varies between samples.
            </div>
          )}
        </div>
      </GlassCard>
      </div>

      {/* Suggested Per-Sample Fields */}
      <GlassCard className="p-6 mt-4 border-amber-200 bg-amber-50/30">
        <div className="mb-4">
          <h3 className="text-base font-medium flex items-center gap-2">
            <Table className="h-4 w-4 text-amber-600" />
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
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
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
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
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
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
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

      {/* Module Forms Section */}
      <div id="study-modules-section" className="mt-8 scroll-mt-28">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-lg bg-violet-500/10 flex items-center justify-center">
            <Package className="h-4 w-4 text-violet-600" />
          </div>
          <h2 className="text-base font-semibold">Module Forms</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Specialized form components for studies. Enable modules in Configuration &rarr; Modules.
        </p>

        <div className="space-y-4">
          {/* MIxS Metadata */}
          <GlassCard className="p-6 border-emerald-200 bg-emerald-50/30">
            <ModuleGate moduleId="mixs-metadata" adminView>
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Leaf className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold text-emerald-800">MIxS Metadata</h3>
                    <p className="text-sm text-emerald-700/80">
                      Adds two components: <strong>Study level</strong> for selecting the environment checklist (Soil, Water, Human Gut, etc.),
                      and <strong>Per-sample fields</strong> with environment-specific metadata based on the selected checklist.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={addMixsField}
                  disabled={fields.some((f) => f.type === "mixs")}
                  variant="outline"
                  size="sm"
                  className={fields.some((f) => f.type === "mixs")
                    ? "border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                    : "border-emerald-300 text-emerald-700 bg-white hover:bg-emerald-100"}
                >
                  {fields.some((f) => f.type === "mixs") ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Added
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add to Form
                    </>
                  )}
                </Button>
              </div>
              {fields.some((f) => f.type === "mixs") && (
                <div className="mt-3 p-3 rounded-lg bg-emerald-100/50 border border-emerald-300">
                  <p className="text-sm text-emerald-700">
                    <strong>Added to both sections:</strong> Checklist selector in Study Fields, and per-sample metadata fields in Per-Sample Fields.
                  </p>
                </div>
              )}
            </ModuleGate>
          </GlassCard>

          {/* Sample Association */}
          <GlassCard className="p-6 border-blue-200 bg-blue-50/30">
            <div className="flex items-center justify-between">
              <div className="flex items-start gap-3">
                <div className="h-10 w-10 rounded-lg bg-blue-500/20 flex items-center justify-center flex-shrink-0">
                  <Link2 className="h-5 w-5 text-blue-600" />
                </div>
                <div>
                  <h3 className="text-sm font-semibold text-blue-800">Sample Association</h3>
                  <p className="text-sm text-blue-700/80">
                    Provides an interface for users to select and associate samples from their orders to this study.
                    Samples can be added or removed from a study at any time.
                  </p>
                </div>
              </div>
              <Button
                onClick={fields.some((f) => f.name === "_sample_association") ? removeSampleAssociationField : addSampleAssociationField}
                variant="outline"
                size="sm"
                className={fields.some((f) => f.name === "_sample_association")
                  ? "border-blue-300 text-blue-700 hover:bg-blue-100"
                  : "border-blue-300 text-blue-700 bg-white hover:bg-blue-100"}
              >
                {fields.some((f) => f.name === "_sample_association") ? (
                  <>
                    <Check className="h-4 w-4 mr-2" />
                    Enabled
                  </>
                ) : (
                  <>
                    <Plus className="h-4 w-4 mr-2" />
                    Enable
                  </>
                )}
              </Button>
            </div>
            {fields.some((f) => f.name === "_sample_association") && (
              <div className="mt-3 p-3 rounded-lg bg-blue-100/50 border border-blue-300">
                <p className="text-sm text-blue-700">
                  <strong>Active:</strong> Users can associate samples to studies from the study detail page.
                </p>
              </div>
            )}
          </GlassCard>

          {/* Funding Information */}
          <GlassCard className="p-6">
            <ModuleGate moduleId="funding-info" adminView>
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-amber-500/10 flex items-center justify-center flex-shrink-0">
                    <Wallet className="h-5 w-5 text-amber-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-semibold">Funding Information</h3>
                    <p className="text-sm text-muted-foreground">
                      Collect grant and funding details including agency (NIH, DFG, ERC, etc.), grant number,
                      project title, and PI information. Supports multiple funding sources per study.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={addFundingField}
                  disabled={fields.some((f) => f.type === "funding")}
                  variant="outline"
                  size="sm"
                  className="border-amber-300 text-amber-700 bg-white hover:bg-amber-100"
                >
                  {fields.some((f) => f.type === "funding") ? (
                    <>
                      <Check className="h-4 w-4 mr-2" />
                      Added
                    </>
                  ) : (
                    <>
                      <Plus className="h-4 w-4 mr-2" />
                      Add to Form
                    </>
                  )}
                </Button>
              </div>
            </ModuleGate>
          </GlassCard>
        </div>
      </div>

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
                <Select value={fieldType} onValueChange={(v) => setFieldType(v as FieldType)}>
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
                <Label>Group</Label>
                <Select value={fieldGroupId || "none"} onValueChange={(v) => setFieldGroupId(v === "none" ? "" : v)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Select group..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No group</SelectItem>
                    {orderedGroups.map((group) => (
                      <SelectItem key={group.id} value={group.id}>
                        {group.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
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

      {/* Group Dialog */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingGroup ? "Edit Group" : "Add Group"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="groupName">Group Name</Label>
              <Input
                id="groupName"
                value={groupName}
                onChange={(e) => setGroupName(e.target.value)}
                placeholder="e.g., Study Details"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupDescription">Description</Label>
              <Input
                id="groupDescription"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="e.g., Basic information about the study"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setGroupDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveGroup}>
              {editingGroup ? "Update" : "Add"} Group
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

      {/* Delete Group Confirmation Dialog */}
      <Dialog open={deleteGroupDialogOpen} onOpenChange={setDeleteGroupDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Group</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete the group &quot;{groupToDelete?.name}&quot;? Fields in this group will become ungrouped.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setDeleteGroupDialogOpen(false);
              setGroupToDelete(null);
            }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleDeleteGroup}>
              <Trash2 className="h-4 w-4 mr-2" />
              Delete Group
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
