"use client";

import { useState, useEffect, useCallback, useRef, type ComponentType } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { GlassCard } from "@/components/ui/glass-card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
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
  FormInput,
  Plus,
  Pencil,
  Trash2,
  GripVertical,
  Loader2,
  Check,
  X,
  ChevronUp,
  ChevronDown,
  AlertTriangle,
  CheckCircle2,
  Zap,
  Leaf,
  Rocket,
  ExternalLink,
  Wallet,
  Receipt,
  Dna,
  Table,
  FileText,
  Database,
  Settings2,
  Shield,
} from "lucide-react";
import { PageContainer } from "@/components/layout/PageContainer";
import {
  FormFieldDefinition,
  FormFieldGroup,
  FieldType,
  SelectOption,
  SimpleValidation,
  AIValidation,
  FIELD_TYPE_LABELS,
  DEFAULT_SYSTEM_FIELDS,
  DEFAULT_GROUPS,
  PATTERN_PRESETS,
} from "@/types/form-config";
import { MixsAdminEditor } from "@/lib/field-types/mixs/MixsAdminEditor";
import type { MixsTemplate } from "@/lib/field-types/mixs";
import { FundingAdminEditor } from "@/lib/field-types/funding/FundingAdminEditor";
import { BillingAdminEditor } from "@/lib/field-types/billing/BillingAdminEditor";
import { SequencingTechAdminEditor } from "@/lib/field-types/sequencing-tech/SequencingTechAdminEditor";
import { useModule, useModules, ModuleGate } from "@/lib/modules";
import { mapPerSampleFieldToColumn } from "@/lib/sample-fields";

const DEFAULT_POST_SUBMISSION_INSTRUCTIONS = `## Thank you for your submission!

Your sequencing order has been received and is now being processed.

### Next Steps

1. **Prepare your samples** according to the guidelines provided
2. **Label each sample** with the Sample ID shown in your order
3. **Ship samples to:**

   Sequencing Facility
   123 Science Drive
   Lab Building, Room 456
   City, State 12345

4. **Include a printed copy** of your order summary in the package

### Important Notes

- Samples should be shipped on dry ice for overnight delivery
- Please notify us when samples are shipped by emailing sequencing@example.com
- Processing typically begins within 3-5 business days of sample receipt

### Questions?

Contact us at sequencing@example.com or call (555) 123-4567.`;

// Field template loaded from JSON files (same as MixsTemplate but more general)
interface FieldTemplate {
  name: string;
  description: string;
  version: string;
  source?: string;
  category?: string;
  fields: Omit<FormFieldDefinition, "id" | "order">[];
}

export default function FormBuilderPage() {
  // Module states
  const { enabled: aiModuleEnabled } = useModule("ai-validation");
  const { enabled: mixsModuleEnabled } = useModule("mixs-metadata");
  const { enabled: fundingModuleEnabled } = useModule("funding-info");
  const { enabled: billingModuleEnabled } = useModule("billing-info");
  const { enabled: sequencingTechModuleEnabled } = useModule("sequencing-tech");
  const { enabled: enaSampleFieldsEnabled } = useModule("ena-sample-fields");
  const { loading: modulesLoading } = useModules();

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

  // Integration service banner
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [isNewSetup, setIsNewSetup] = useState(false);
  const showIntegrationServiceBanner = process.env.NODE_ENV === "production";

  // Group dialog state
  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [editingGroup, setEditingGroup] = useState<FormFieldGroup | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupDescription, setGroupDescription] = useState("");
  const [groupIcon, setGroupIcon] = useState("FileText");

  // Group delete confirmation dialog
  const [deleteGroupDialogOpen, setDeleteGroupDialogOpen] = useState(false);
  const [groupToDelete, setGroupToDelete] = useState<FormFieldGroup | null>(null);

  // Field delete confirmation dialog
  const [deleteFieldDialogOpen, setDeleteFieldDialogOpen] = useState(false);
  const [fieldToDelete, setFieldToDelete] = useState<FormFieldDefinition | null>(null);

  // Field templates loaded from JSON files
  const [fieldTemplates, setFieldTemplates] = useState<FieldTemplate[]>([]);
  const [templatesLoading, setTemplatesLoading] = useState(true);

  // MIxS checklists for field editor (when editing a mixs type field)
  const [fieldMixsChecklists, setFieldMixsChecklists] = useState<string[]>([]);

  // Group assignment for field editor
  const [fieldGroupId, setFieldGroupId] = useState<string>("");

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingField, setEditingField] = useState<FormFieldDefinition | null>(null);

  // Field form state
  const [fieldLabel, setFieldLabel] = useState("");
  const [fieldName, setFieldName] = useState("");
  const [fieldType, setFieldType] = useState<FieldType>("text");
  const [fieldRequired, setFieldRequired] = useState(false);
  const [fieldVisible, setFieldVisible] = useState(true);
  const [fieldPerSample, setFieldPerSample] = useState(false);
  const [fieldHelpText, setFieldHelpText] = useState("");
  const [fieldExample, setFieldExample] = useState("");
  const [fieldPlaceholder, setFieldPlaceholder] = useState("");
  const [fieldOptions, setFieldOptions] = useState<SelectOption[]>([]);
  const [newOptionLabel, setNewOptionLabel] = useState("");
  const [newOptionValue, setNewOptionValue] = useState("");

  // Simple validation state
  const [valMinLength, setValMinLength] = useState<string>("");
  const [valMaxLength, setValMaxLength] = useState<string>("");
  const [valMinValue, setValMinValue] = useState<string>("");
  const [valMaxValue, setValMaxValue] = useState<string>("");
  const [valPatternPreset, setValPatternPreset] = useState<string>("");
  const [valCustomPattern, setValCustomPattern] = useState("");
  const [valPatternMessage, setValPatternMessage] = useState("");

  // AI validation state
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiPrompt, setAiPrompt] = useState("");
  const [aiStrictness, setAiStrictness] = useState<"lenient" | "moderate" | "strict">("moderate");
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);

  // AI test panel state
  const [aiTestValue, setAiTestValue] = useState("");
  const [aiTestResult, setAiTestResult] = useState<{valid: boolean; message: string; suggestion?: string} | null>(null);
  const [aiTesting, setAiTesting] = useState(false);

  // Admin-only field state
  const [fieldAdminOnly, setFieldAdminOnly] = useState(false);

  // Post-submission instructions state
  const [postSubmissionInstructions, setPostSubmissionInstructions] = useState("");
  const [instructionsSaved, setInstructionsSaved] = useState(false);
  const [instructionsSaving, setInstructionsSaving] = useState(false);
  const [allowDeleteSubmittedOrders, setAllowDeleteSubmittedOrders] = useState(false);
  const [allowUserAssemblyDownload, setAllowUserAssemblyDownload] = useState(false);

  // Fetch form configuration
  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const res = await fetch("/api/admin/form-config");
        if (res.ok) {
          const data = await res.json();
          // Use fields if available, otherwise fall back to default system fields
          const loadedFields = data.fields || [];
          const loadedGroups = data.groups || DEFAULT_GROUPS;
          if (loadedFields.length === 0) {
            setFields(DEFAULT_SYSTEM_FIELDS);
            setIsNewSetup(true); // No saved config = new setup
          } else {
            setFields(loadedFields);
            // Check if only default system fields exist (new/uncustomized setup)
            const hasOnlySystemFields = loadedFields.every(
              (f: FormFieldDefinition) => f.isSystem
            );
            const hasDefaultGroups = loadedGroups.length <= DEFAULT_GROUPS.length;
            setIsNewSetup(hasOnlySystemFields && hasDefaultGroups);
          }
          setGroups(loadedGroups);
        } else {
          // No config yet, use defaults
          setFields(DEFAULT_SYSTEM_FIELDS);
          setGroups(DEFAULT_GROUPS);
          setIsNewSetup(true);
        }
      } catch {
        setError("Failed to load form configuration");
        setFields(DEFAULT_SYSTEM_FIELDS);
        setGroups(DEFAULT_GROUPS);
        setIsNewSetup(true);
      } finally {
        setLoading(false);
      }
    };

    fetchConfig();
  }, []);

  // Fetch field templates from JSON files
  useEffect(() => {
    const fetchTemplates = async () => {
      try {
        const res = await fetch("/api/admin/field-templates");
        if (res.ok) {
          const data = await res.json();
          setFieldTemplates(data.templates || []);
        }
      } catch (err) {
        console.error("Failed to load field templates:", err);
      } finally {
        setTemplatesLoading(false);
      }
    };

    fetchTemplates();
  }, []);

  // Check if AI is configured
  useEffect(() => {
    const checkAI = async () => {
      try {
        const res = await fetch("/api/ai/validate");
        if (res.ok) {
          const data = await res.json();
          setAiConfigured(data.configured);
        }
      } catch {
        setAiConfigured(false);
      }
    };
    checkAI();
  }, []);

  // Fetch post-submission instructions and order settings
  useEffect(() => {
    const fetchAccessSettings = async () => {
      try {
        const res = await fetch("/api/admin/settings/access");
        if (res.ok) {
          const data = await res.json();
          setPostSubmissionInstructions(data.postSubmissionInstructions ?? DEFAULT_POST_SUBMISSION_INSTRUCTIONS);
          setAllowDeleteSubmittedOrders(data.allowDeleteSubmittedOrders ?? false);
          setAllowUserAssemblyDownload(data.allowUserAssemblyDownload ?? false);
        }
      } catch {
        // Use defaults
        setPostSubmissionInstructions(DEFAULT_POST_SUBMISSION_INSTRUCTIONS);
      }
    };
    fetchAccessSettings();
  }, []);

  const handleSaveInstructions = async () => {
    setInstructionsSaving(true);
    setInstructionsSaved(false);

    try {
      await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ postSubmissionInstructions }),
      });
      setInstructionsSaved(true);
      setTimeout(() => setInstructionsSaved(false), 3000);
    } catch (error) {
      console.error("Failed to save instructions:", error);
    } finally {
      setInstructionsSaving(false);
    }
  };

  const handleResetInstructions = () => {
    setPostSubmissionInstructions(DEFAULT_POST_SUBMISSION_INSTRUCTIONS);
  };

  const handleAllowDeleteSubmittedChange = async (enabled: boolean) => {
    setAllowDeleteSubmittedOrders(enabled);

    try {
      await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowDeleteSubmittedOrders: enabled }),
      });
    } catch (error) {
      console.error("Failed to save setting:", error);
      setAllowDeleteSubmittedOrders(!enabled);
    }
  };

  const handleAllowUserAssemblyDownloadChange = async (enabled: boolean) => {
    setAllowUserAssemblyDownload(enabled);

    try {
      await fetch("/api/admin/settings/access", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allowUserAssemblyDownload: enabled }),
      });
    } catch (error) {
      console.error("Failed to save setting:", error);
      setAllowUserAssemblyDownload(!enabled);
    }
  };

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
    setFieldExample("");
    setFieldPlaceholder("");
    setFieldOptions([]);
    setNewOptionLabel("");
    setNewOptionValue("");
    // Reset validation
    setValMinLength("");
    setValMaxLength("");
    setValMinValue("");
    setValMaxValue("");
    setValPatternPreset("");
    setValCustomPattern("");
    setValPatternMessage("");
    // Reset AI validation
    setAiEnabled(false);
    setAiPrompt("");
    setAiStrictness("moderate");
    setAiTestValue("");
    setAiTestResult(null);
    // Reset MIxS checklists
    setFieldMixsChecklists([]);
    // Reset group
    setFieldGroupId("");
    // Reset admin-only
    setFieldAdminOnly(false);
    setEditingField(null);
  };

  // Open dialog for new field
  const handleAddField = (perSample: boolean = false, adminOnly: boolean = false) => {
    resetFieldForm();
    // Set perSample and adminOnly after reset
    setFieldPerSample(perSample);
    setFieldAdminOnly(adminOnly);
    // Auto-select first group if available (only for regular order fields, not per-sample or admin-only)
    if (!perSample && !adminOnly && groups.length > 0) {
      const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
      setFieldGroupId(sortedGroups[0].id);
    }
    setDialogOpen(true);
  };

  // Open dialog for editing
  const handleEditField = (field: FormFieldDefinition) => {
    setEditingField(field);
    setFieldLabel(field.label);
    setFieldName(field.name);
    setFieldType(field.type);
    setFieldRequired(field.required);
    setFieldVisible(field.visible !== false); // Default to true if not set
    setFieldPerSample(field.perSample || false);
    setFieldHelpText(field.helpText || "");
    setFieldExample(field.example || "");
    setFieldPlaceholder(field.placeholder || "");
    setFieldOptions(field.options || []);
    // Load validation settings
    const sv = field.simpleValidation;
    setValMinLength(sv?.minLength?.toString() || "");
    setValMaxLength(sv?.maxLength?.toString() || "");
    setValMinValue(sv?.minValue?.toString() || "");
    setValMaxValue(sv?.maxValue?.toString() || "");
    setValPatternPreset(sv?.patternPreset || "");
    setValCustomPattern(sv?.pattern || "");
    setValPatternMessage(sv?.patternMessage || "");
    // Load AI validation settings
    const ai = field.aiValidation;
    setAiEnabled(ai?.enabled || false);
    setAiPrompt(ai?.prompt || "");
    setAiStrictness(ai?.strictness || "moderate");
    setAiTestValue("");
    setAiTestResult(null);
    // Load MIxS checklists for mixs type
    setFieldMixsChecklists(field.mixsChecklists || []);
    // Load group
    setFieldGroupId(field.groupId || "");
    // Load admin-only
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

    const isSpecialFieldType = ["mixs", "funding", "billing", "sequencing-tech", "barcode"].includes(fieldType);
    if (name.startsWith("_") && !isSpecialFieldType) {
      const isExistingReserved = editingField?.name === name;
      if (!isExistingReserved) {
        setError("Field keys starting with '_' are reserved for system fields");
        return;
      }
    }

    if (fieldPerSample) {
      const mappedColumn = mapPerSampleFieldToColumn(name);
      const isRenaming = editingField && editingField.name !== name;
      if (mappedColumn && (!editingField || isRenaming)) {
        const confirmed = window.confirm(
          `This field name maps to a core sample column (${mappedColumn}). Continue?`
        );
        if (!confirmed) {
          return;
        }
      }
    }

    // Check for duplicate names
    const isDuplicate = fields.some(
      (f) => f.name === name && f.id !== editingField?.id
    );
    if (isDuplicate) {
      setError("A field with this name already exists");
      return;
    }

    // Build simple validation object
    const simpleValidation: SimpleValidation | undefined = (() => {
      const sv: SimpleValidation = {};
      if (valMinLength) sv.minLength = parseInt(valMinLength);
      if (valMaxLength) sv.maxLength = parseInt(valMaxLength);
      if (valMinValue) sv.minValue = parseFloat(valMinValue);
      if (valMaxValue) sv.maxValue = parseFloat(valMaxValue);
      if (valPatternPreset && valPatternPreset !== "custom" && valPatternPreset !== "none") {
        sv.patternPreset = valPatternPreset as SimpleValidation["patternPreset"];
        sv.pattern = PATTERN_PRESETS[valPatternPreset]?.pattern;
        sv.patternMessage = PATTERN_PRESETS[valPatternPreset]?.message;
      } else if (valPatternPreset === "custom" && valCustomPattern) {
        sv.patternPreset = "custom";
        sv.pattern = valCustomPattern;
        sv.patternMessage = valPatternMessage || "Invalid format";
      }
      return Object.keys(sv).length > 0 ? sv : undefined;
    })();

    // Build AI validation object
    const aiValidation: AIValidation | undefined = aiEnabled && aiPrompt.trim()
      ? { enabled: true, prompt: aiPrompt.trim(), strictness: aiStrictness }
      : undefined;

    const orderFieldCount = fields.filter((f) => !f.perSample).length;
    const perSampleFieldCount = fields.filter((f) => f.perSample).length;
    const changingSection = editingField && !!editingField.perSample !== fieldPerSample;
    const nextOrder = changingSection
      ? (fieldPerSample ? perSampleFieldCount : orderFieldCount)
      : (editingField?.order ?? (fieldPerSample ? perSampleFieldCount : orderFieldCount));

    const newField: FormFieldDefinition = {
      id: editingField?.id || `field_${Date.now()}`,
      type: fieldType,
      label: fieldLabel.trim(),
      name,
      required: fieldRequired,
      visible: fieldVisible,
      perSample: fieldPerSample,
      helpText: fieldHelpText.trim() || undefined,
      example: fieldExample.trim() || undefined,
      placeholder: fieldPlaceholder.trim() || undefined,
      options:
        fieldType === "select" || fieldType === "multiselect"
          ? fieldOptions
          : undefined,
      simpleValidation,
      aiValidation,
      order: nextOrder,
      groupId: fieldGroupId || undefined,
      // Preserve system field properties
      isSystem: editingField?.isSystem,
      systemKey: editingField?.systemKey,
      // MIxS checklists for mixs type
      mixsChecklists: fieldType === "mixs" ? fieldMixsChecklists : undefined,
      // Admin-only flag
      adminOnly: fieldAdminOnly || undefined,
    };

    if (editingField) {
      setFields(fields.map((f) => (f.id === editingField.id ? newField : f)));
    } else {
      setFields([...fields, newField]);
    }

    setDialogOpen(false);
    // Delay form reset until after dialog close animation (200ms)
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

  // Move field up/down within its section (order vs per-sample)
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
    [reordered[index], reordered[newIndex]] = [
      reordered[newIndex],
      reordered[index],
    ];

    const updatedFields = fields.map((field) => {
      const sectionIndex = reordered.findIndex((f) => f.id === field.id);
      if (sectionIndex === -1) return field;
      return { ...field, order: sectionIndex };
    });

    setFields(updatedFields);
  };

  // Add option to select field
  const handleAddOption = () => {
    if (!newOptionLabel.trim()) return;
    const value = newOptionValue.trim() || generateFieldName(newOptionLabel);
    setFieldOptions([...fieldOptions, { label: newOptionLabel.trim(), value }]);
    setNewOptionLabel("");
    setNewOptionValue("");
  };

  // Remove option
  const handleRemoveOption = (index: number) => {
    setFieldOptions(fieldOptions.filter((_, i) => i !== index));
  };

  // Test AI validation
  const handleTestAI = async () => {
    if (!aiTestValue.trim() || !aiPrompt.trim()) {
      setAiTestResult({ valid: false, message: "Enter a test value and AI prompt first" });
      return;
    }

    setAiTesting(true);
    setAiTestResult(null);

    try {
      const res = await fetch("/api/ai/validate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          value: aiTestValue,
          fieldLabel: fieldLabel || "Test Field",
          prompt: aiPrompt,
          strictness: aiStrictness,
        }),
      });

      if (res.ok) {
        const data = await res.json();
        setAiTestResult(data);
      } else {
        setAiTestResult({ valid: false, message: "Failed to run AI validation" });
      }
    } catch {
      setAiTestResult({ valid: false, message: "Error connecting to AI service" });
    } finally {
      setAiTesting(false);
    }
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
        const res = await fetch("/api/admin/form-config", {
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

  // Auto-save form config after edits (debounced)
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

  // Group management functions
  const handleAddGroup = () => {
    setEditingGroup(null);
    setGroupName("");
    setGroupDescription("");
    setGroupIcon("FileText");
    setGroupDialogOpen(true);
  };

  const handleEditGroup = (group: FormFieldGroup) => {
    setEditingGroup(group);
    setGroupName(group.name);
    setGroupDescription(group.description || "");
    setGroupIcon(group.icon || "FileText");
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
      icon: groupIcon,
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

  const handleDeleteGroup = (groupId: string) => {
    const group = groups.find((g) => g.id === groupId);
    if (!group) return;
    setGroupToDelete(group);
    setDeleteGroupDialogOpen(true);
  };

  const confirmDeleteGroup = () => {
    if (!groupToDelete) return;
    // Unassign fields from the deleted group
    const fieldsInGroup = fields.filter((f) => f.groupId === groupToDelete.id);
    if (fieldsInGroup.length > 0) {
      setFields(fields.map((f) => f.groupId === groupToDelete.id ? { ...f, groupId: undefined } : f));
    }
    setGroups(groups.filter((g) => g.id !== groupToDelete.id));
    setDeleteGroupDialogOpen(false);
    setGroupToDelete(null);
  };

  const handleMoveGroup = (groupId: string, direction: "up" | "down") => {
    const sortedGroups = [...groups].sort((a, b) => a.order - b.order);
    const index = sortedGroups.findIndex((g) => g.id === groupId);
    if (index === -1) return;

    const targetIndex = direction === "up" ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= sortedGroups.length) return;

    const reordered = [...sortedGroups];
    [reordered[index], reordered[targetIndex]] = [reordered[targetIndex], reordered[index]];
    setGroups(reordered.map((group, i) => ({ ...group, order: i })));
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

  // Get MIxS templates only
  const mixsTemplates = fieldTemplates.filter((t) => t.category === "mixs");
  const generalTemplates = fieldTemplates.filter((t) => t.category !== "mixs");

  // Toggle MIxS checklist in field editor
  const toggleFieldMixsChecklist = (checklistName: string) => {
    setFieldMixsChecklists((prev) =>
      prev.includes(checklistName)
        ? prev.filter((n) => n !== checklistName)
        : [...prev, checklistName]
    );
  };

  // Add MIxS metadata field
  const addMixsField = () => {
    // Check if MIxS field already exists
    if (fields.some((f) => f.type === "mixs")) {
      setError("A MIxS Metadata field already exists in the form");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const newField: FormFieldDefinition = {
      id: `field_mixs_${Date.now()}`,
      type: "mixs",
      label: "Sample Metadata (MIxS)",
      name: "_mixs",
      required: false,
      visible: true,
      helpText: "Select the environment type for your samples to see MIxS standard metadata fields",
      order: fields.filter((f) => !f.perSample).length,
      mixsChecklists: mixsTemplates.map((t) => t.name), // Enable all by default
    };

    setFields([...fields, newField]);
  };

  // Add Funding field
  const addFundingField = () => {
    // Check if Funding field already exists
    if (fields.some((f) => f.type === "funding")) {
      setError("A Funding Information field already exists in the form");
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
      helpText: "Add your grant or funding source information",
      order: fields.filter((f) => !f.perSample).length,
    };

    setFields([...fields, newField]);
  };

  // Add Billing field
  const addBillingField = () => {
    // Check if Billing field already exists
    if (fields.some((f) => f.type === "billing")) {
      setError("A Billing Information field already exists in the form");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const newField: FormFieldDefinition = {
      id: `field_billing_${Date.now()}`,
      type: "billing",
      label: "Billing Information",
      name: "_billing",
      required: false,
      visible: true,
      helpText: "Enter your internal billing codes for cost allocation",
      order: fields.filter((f) => !f.perSample).length,
    };

    setFields([...fields, newField]);
  };

  // Add Sequencing Technology field
  const addSequencingTechField = () => {
    // Check if Sequencing Tech field already exists
    if (fields.some((f) => f.type === "sequencing-tech")) {
      setError("A Sequencing Technology field already exists in the form");
      setTimeout(() => setError(""), 3000);
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
      order: fields.filter((f) => !f.perSample).length,
      groupId: "group_sequencing",
      moduleSource: "sequencing-tech",
    };

    setFields([...fields, newField]);
  };

  // Add Barcode per-sample field (part of Sequencing Technologies module)
  const addBarcodeField = () => {
    if (fields.some((f) => f.type === "barcode" || f.name === "_barcode")) {
      setError("A Barcode field already exists in the form");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const currentPerSampleCount = fields.filter((f) => f.perSample).length;

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
      order: currentPerSampleCount,
      moduleSource: "sequencing-tech",
    };

    setFields([...fields, newField]);
  };

  const hasBarcodeField = fields.some(
    (f) => f.type === "barcode" || f.name === "_barcode"
  );

  const hasSequencingTechField = fields.some(
    (f) => f.type === "sequencing-tech"
  );

  // Add ENA Sample Fields - adds essential per-sample fields for ENA submission
  const addEnaSampleFields = () => {
    // Check if organism field already exists
    if (fields.some((f) => f.type === "organism" || f.name === "_organism")) {
      setError("ENA Sample Fields are already added to the form");
      setTimeout(() => setError(""), 3000);
      return;
    }

    const currentPerSampleCount = fields.filter((f) => f.perSample).length;

    // Add three per-sample fields for ENA
    const newFields: FormFieldDefinition[] = [
      {
        id: `field_organism_${Date.now()}`,
        type: "organism",
        label: "Organism",
        name: "_organism",
        required: true,
        visible: true,
        perSample: true,
        helpText: "The source organism or metagenome type. Examples: 'human gut metagenome', 'soil metagenome', 'Escherichia coli'. Start typing to search NCBI taxonomy.",
        placeholder: "e.g., human gut metagenome",
        order: currentPerSampleCount,
        moduleSource: "ena-sample-fields",
      },
      {
        id: `field_sample_title_${Date.now() + 1}`,
        type: "text",
        label: "Sample Title",
        name: "sample_title",
        required: true,
        visible: true,
        perSample: true,
        helpText: "A short descriptive title for this sample. Required for ENA submission.",
        placeholder: "e.g., Human gut sample from healthy adult",
        order: currentPerSampleCount + 1,
        moduleSource: "ena-sample-fields",
      },
      {
        id: `field_sample_alias_${Date.now() + 2}`,
        type: "text",
        label: "Sample Alias",
        name: "sample_alias",
        required: false,
        visible: true,
        perSample: true,
        helpText: "A unique identifier for this sample. If left empty, will be auto-generated.",
        placeholder: "e.g., HG-001-A",
        order: currentPerSampleCount + 2,
        moduleSource: "ena-sample-fields",
      },
    ];

    setFields([...fields, ...newFields]);
  };

  // Check if ENA sample fields are added
  const hasEnaSampleFields = fields.some((f) => f.type === "organism" || f.name === "_organism");

  const isFieldAvailableForModules = (field: FormFieldDefinition) => {
    if (field.type === "mixs" && !mixsModuleEnabled) return false;
    if (field.type === "funding" && !fundingModuleEnabled) return false;
    if (field.type === "billing" && !billingModuleEnabled) return false;
    if (field.type === "sequencing-tech" && !sequencingTechModuleEnabled) return false;
    if (field.type === "barcode" && !sequencingTechModuleEnabled) return false;
    if (field.moduleSource === "ena-sample-fields" && !enaSampleFieldsEnabled) return false;
    return true;
  };

  const visibleFields = fields.filter(isFieldAvailableForModules);
  const hiddenByDisabledModulesCount = fields.length - visibleFields.length;

  const orderFields = visibleFields
    .filter((f) => !f.perSample && !f.adminOnly)
    .sort((a, b) => a.order - b.order);
  const perSampleFieldsList = visibleFields
    .filter((f) => f.perSample && !f.adminOnly)
    .sort((a, b) => a.order - b.order);
  const adminOnlyFields = visibleFields
    .filter((f) => f.adminOnly)
    .sort((a, b) => a.order - b.order);
  const orderedGroups = [...groups].sort((a, b) => a.order - b.order);

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

  const moduleFieldMeta: Record<
    string,
    { label: string; className: string; icon: ComponentType<{ className?: string }> }
  > = {
    "sequencing-tech": {
      label: "Sequencing Tech",
      className: "bg-sky-500/15 text-sky-700",
      icon: Dna,
    },
    mixs: {
      label: "MIxS",
      className: "bg-emerald-500/15 text-emerald-700",
      icon: Leaf,
    },
    funding: {
      label: "Funding",
      className: "bg-amber-500/15 text-amber-700",
      icon: Wallet,
    },
    billing: {
      label: "Billing",
      className: "bg-teal-500/15 text-teal-700",
      icon: Receipt,
    },
    barcode: {
      label: "Barcode",
      className: "bg-sky-500/15 text-sky-700",
      icon: Dna,
    },
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
                <SelectItem value="order-groups-section">Form Groups</SelectItem>
                <SelectItem value="order-fields-section">Order Fields</SelectItem>
                <SelectItem value="order-per-sample-section">Per-Sample Fields</SelectItem>
                <SelectItem value="order-facility-section">Facility-Only Fields</SelectItem>
                <SelectItem value="order-modules-section">Module Forms</SelectItem>
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
        <h1 className="text-xl font-semibold">Order Configuration</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          Define what information users provide when creating sequencing orders
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

      {/* Integration Service Banner */}
      {showIntegrationServiceBanner && !bannerDismissed && (
        <div className="mb-6 relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-r from-primary/5 via-primary/10 to-violet-500/10">
          <div className="absolute top-0 right-0 w-64 h-64 bg-primary/5 rounded-full blur-3xl -translate-y-1/2 translate-x-1/2" />
          <div className="relative p-6">
            <button
              onClick={() => setBannerDismissed(true)}
              className="absolute top-4 right-4 p-1 rounded-md hover:bg-muted/50 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="Dismiss"
            >
              <X className="h-4 w-4" />
            </button>

            <div className="flex items-start gap-4">
              <div className="h-12 w-12 rounded-xl bg-primary/10 flex items-center justify-center flex-shrink-0">
                <Rocket className="h-6 w-6 text-primary" />
              </div>
              <div className="flex-1 pr-8">
                <h3 className="text-base font-semibold mb-1">Need help setting up SeqDesk?</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Our integration team can configure your forms, set up workflows, and customize SeqDesk
                  to match your sequencing facility&apos;s specific requirements. Get a tailored solution
                  without the hassle of manual configuration.
                </p>
                <div className="flex items-center gap-3">
                  <a
                    href="mailto:hello@seqdesk.com?subject=SeqDesk Integration Service Inquiry&body=Hi,%0A%0AI'm interested in learning more about SeqDesk integration services for our sequencing facility.%0A%0APlease send me a quote for:%0A- Form configuration and customization%0A- Workflow setup%0A- Integration with our existing systems%0A%0AThank you!"
                    className="inline-flex items-center gap-2 px-4 py-2 rounded-lg bg-primary text-primary-foreground font-medium text-sm hover:bg-primary/90 transition-colors"
                  >
                    Get a Quote
                    <ExternalLink className="h-4 w-4" />
                  </a>
                  <button
                    onClick={() => setBannerDismissed(true)}
                    className="text-sm text-muted-foreground hover:text-foreground transition-colors"
                  >
                    Maybe later
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Form Groups */}
      <div id="order-groups-section" className="scroll-mt-28">
        <GlassCard className="p-6 mb-6">
          <div className="flex items-center justify-between mb-2">
            <h2 className="text-base font-semibold">Form Groups (Steps)</h2>
            <Button onClick={handleAddGroup} variant="outline" size="sm" className="bg-white">
              <Plus className="h-4 w-4 mr-2" />
              Add Group
            </Button>
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Groups organize your form into steps. When users create a new order, they&apos;ll navigate through each group as a separate step in a wizard.
            Use the arrows to reorder groups - the order here determines the step order in the form.
          </p>

          <div className="space-y-2">
            {orderedGroups.map((group, index) => {
              const fieldCount = visibleFields.filter((f) => f.groupId === group.id).length;
              return (
                <div
                  key={group.id}
                  className="flex items-center gap-3 p-3 rounded-lg bg-muted/30 border border-border"
                >
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
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleEditGroup(group)}
                    >
                      <Pencil className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => handleDeleteGroup(group.id)}
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
                No groups defined. Add a group to organize your form fields into steps.
              </div>
            )}
          </div>
        </GlassCard>
      </div>

      {/* Order Fields - filled once per order */}
      <div id="order-fields-section" className="scroll-mt-28">
      <GlassCard className="p-6">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Order Fields</h2>
          <Button onClick={() => handleAddField(false)} variant="outline" size="sm" className="bg-white">
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Fields filled <strong>once per order</strong>. Information that applies to the entire order, such as project name, sequencing parameters, or billing details.
          <span className="block mt-1 text-xs text-muted-foreground">
            Module-provided fields are marked with a colored badge.
          </span>
        </p>

        <div className="space-y-3">
          {orderFields.map((field) => {
            const indexInSection = orderFields.findIndex(f => f.id === field.id);
            return (
            <div
              key={field.id}
              className="flex items-center gap-3 p-4 rounded-lg bg-muted/30"
            >
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => handleMoveField(field.id, false, "up")}
                  disabled={indexInSection === 0}
                  className="p-1 hover:bg-muted rounded disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveField(field.id, false, "down")}
                  disabled={indexInSection === orderFields.length - 1}
                  className="p-1 hover:bg-muted rounded disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              <GripVertical className="h-4 w-4 text-muted-foreground" />

              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{field.label}</span>
                  {!moduleFieldMeta[field.type] && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                      {FIELD_TYPE_LABELS[field.type] || field.type}
                    </span>
                  )}
                  {field.isSystem && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-medium">
                      System
                    </span>
                  )}
                  {moduleFieldMeta[field.type] && (
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded font-medium flex items-center gap-1 ${moduleFieldMeta[field.type].className}`}
                    >
                      {(() => {
                        const Icon = moduleFieldMeta[field.type].icon;
                        return <Icon className="h-2.5 w-2.5" />;
                      })()}
                      {moduleFieldMeta[field.type].label}
                    </span>
                  )}
                  {/* Module disabled warnings */}
                  {!modulesLoading && field.type === "mixs" && !mixsModuleEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-medium flex items-center gap-1" title="MIxS module is disabled">
                      <AlertTriangle className="h-3 w-3" />
                      Module Off
                    </span>
                  )}
                  {!modulesLoading && field.type === "funding" && !fundingModuleEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-medium flex items-center gap-1" title="Funding module is disabled">
                      <AlertTriangle className="h-3 w-3" />
                      Module Off
                    </span>
                  )}
                  {!modulesLoading && field.type === "billing" && !billingModuleEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-medium flex items-center gap-1" title="Billing module is disabled">
                      <AlertTriangle className="h-3 w-3" />
                      Module Off
                    </span>
                  )}
                  {!modulesLoading &&
                    field.type === "sequencing-tech" &&
                    !sequencingTechModuleEnabled && (
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 font-medium flex items-center gap-1" title="Sequencing Technologies module is disabled">
                        <AlertTriangle className="h-3 w-3" />
                        Module Off
                      </span>
                    )}
                  {/* Group badge */}
                  {field.groupId ? (
                    <span className="text-xs px-2 py-0.5 rounded bg-primary/10 text-primary">
                      {groups.find((g) => g.id === field.groupId)?.name || "Unknown Group"}
                    </span>
                  ) : (
                    <span className="text-xs px-2 py-0.5 rounded bg-muted text-muted-foreground">
                      No group
                    </span>
                  )}
                  {/* AI validation indicator */}
                  {field.aiValidation?.enabled && aiModuleEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 font-medium">
                      AI
                    </span>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleEditField(field)}
                  title="Edit field"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openDeleteFieldDialog(field)}
                  className="text-destructive hover:text-destructive"
                  title="Delete field"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )})}
          {orderFields.length === 0 && (
            <div className="text-center py-6 text-muted-foreground border border-dashed rounded-lg">
              No order fields defined yet.
            </div>
          )}
        </div>
      </GlassCard>
      </div>

      {/* General Suggested Fields - for Order Fields */}
      {generalTemplates.length > 0 && (
        <GlassCard className="p-6 mt-4">
          <div className="mb-4">
            <h3 className="text-sm font-medium">Suggested Order Fields</h3>
            <p className="text-sm text-muted-foreground">
              Common fields for sequencing orders. Click to add.
            </p>
          </div>

          {generalTemplates.map((template) => (
            <div key={template.name} className="mb-4 last:mb-0">
              {generalTemplates.length > 1 && (
                <h4 className="text-sm font-medium text-muted-foreground mb-2">{template.name}</h4>
              )}
              <div className="flex flex-wrap gap-2">
                {template.fields.map((fieldTemplate) => {
                  const alreadyAdded = fields.some((f) => f.name === fieldTemplate.name);
                  return (
                    <button
                      key={fieldTemplate.name}
                      type="button"
                      onClick={() => !alreadyAdded && addSuggestedField(fieldTemplate)}
                      disabled={alreadyAdded}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                        alreadyAdded
                          ? "bg-muted/30 border-border text-muted-foreground cursor-not-allowed"
                          : "bg-background border-border hover:border-primary hover:bg-primary/5 cursor-pointer"
                      }`}
                    >
                      <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                      <span>{fieldTemplate.label}</span>
                      {fieldTemplate.aiValidation?.enabled && (
                        <span className="text-[10px] px-1 py-0.5 rounded bg-violet-500/20 text-violet-600 font-medium">
                          AI
                        </span>
                      )}
                      {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </GlassCard>
      )}

      {/* Per-Sample Fields - filled for each sample */}
      <div id="order-per-sample-section" className="scroll-mt-28">
      <GlassCard className="p-6 border-amber-200 bg-amber-50/30 mt-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold">Per-Sample Fields</h2>
          <Button onClick={() => handleAddField(true)} variant="outline" size="sm" className="border-amber-300 hover:bg-amber-100">
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Fields filled <strong>for each sample</strong> in a table view. Use for sample-specific data like volume (ml), concentration, storage conditions, or quality control metrics.
        </p>

        <div className="space-y-3">
          {perSampleFieldsList.map((field) => {
            const indexInSection = perSampleFieldsList.findIndex(f => f.id === field.id);
            return (
            <div
              key={field.id}
              className="flex items-center gap-3 p-4 rounded-lg bg-amber-100/50 border border-amber-200"
            >
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => handleMoveField(field.id, true, "up")}
                  disabled={indexInSection === 0}
                  className="p-1 hover:bg-amber-200 rounded disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveField(field.id, true, "down")}
                  disabled={indexInSection === perSampleFieldsList.length - 1}
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
                  {/* AI validation indicator */}
                  {field.aiValidation?.enabled && aiModuleEnabled && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-violet-500/15 text-violet-600 font-medium">
                      AI
                    </span>
                  )}
                  {/* Module source indicator */}
                  {field.moduleSource === "ena-sample-fields" && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-100 text-emerald-700 font-medium flex items-center gap-1">
                      <Database className="h-2.5 w-2.5" />
                      ENA
                    </span>
                  )}
                </div>
                {field.helpText && (
                  <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleEditField(field)}
                  title="Edit field"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openDeleteFieldDialog(field)}
                  className="text-destructive hover:text-destructive"
                  title="Delete field"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )})}
          {perSampleFieldsList.length === 0 && (
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
          <h3 className="text-sm font-medium flex items-center gap-2">
            <Table className="h-4 w-4 text-amber-600" />
            Suggested Per-Sample Fields
          </h3>
          <p className="text-sm text-muted-foreground">
            Common fields for sample-level data. Click to add.
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          {/* Sample Volume */}
          {(() => {
            const volumeField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "number",
              label: "Sample Volume (µl)",
              name: "sample_volume_ul",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Volume of the sample in microliters",
              placeholder: "e.g., 50",
              simpleValidation: { minValue: 0.1, maxValue: 1000 },
            };
            const alreadyAdded = fields.some((f) => f.name === volumeField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(volumeField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Sample Volume (µl)</span>
                <span className="text-[10px] px-1 py-0.5 rounded bg-amber-200 text-amber-700 font-medium">0.1-1000</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* DNA Concentration */}
          {(() => {
            const concField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "number",
              label: "DNA Concentration (ng/µl)",
              name: "dna_concentration",
              required: false,
              visible: true,
              perSample: true,
              helpText: "DNA concentration measured by Qubit or NanoDrop",
              placeholder: "e.g., 25.5",
              simpleValidation: { minValue: 0, maxValue: 5000 },
            };
            const alreadyAdded = fields.some((f) => f.name === concField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(concField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>DNA Concentration (ng/µl)</span>
                <span className="text-[10px] px-1 py-0.5 rounded bg-amber-200 text-amber-700 font-medium">0-5000</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Storage Temperature */}
          {(() => {
            const storageField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "select",
              label: "Storage Temperature",
              name: "storage_temperature",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Temperature at which the sample was stored before submission",
              options: [
                { label: "Room Temperature (20-25°C)", value: "room_temp" },
                { label: "Refrigerated (4°C)", value: "4c" },
                { label: "Frozen (-20°C)", value: "-20c" },
                { label: "Deep Frozen (-80°C)", value: "-80c" },
              ],
            };
            const alreadyAdded = fields.some((f) => f.name === storageField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(storageField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Storage Temperature</span>
                <span className="text-[10px] px-1 py-0.5 rounded bg-amber-200 text-amber-700 font-medium">4 options</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Alias */}
          {(() => {
            const aliasField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Alias",
              name: "sample_alias",
              required: false,
              visible: true,
              perSample: true,
              helpText: "A unique identifier or alias for this sample",
              placeholder: "e.g., Sample_001",
            };
            const alreadyAdded = fields.some((f) => f.name === aliasField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(aliasField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Alias</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Title */}
          {(() => {
            const titleField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Title",
              name: "sample_title",
              required: false,
              visible: true,
              perSample: true,
              helpText: "A short descriptive title for this sample",
              placeholder: "e.g., Soil sample from forest site A",
            };
            const alreadyAdded = fields.some((f) => f.name === titleField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(titleField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Title</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Description */}
          {(() => {
            const descField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "textarea",
              label: "Description",
              name: "sample_description",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Detailed description of the sample, including collection method and any relevant notes",
              placeholder: "Describe the sample...",
            };
            const alreadyAdded = fields.some((f) => f.name === descField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(descField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Description</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Scientific Name */}
          {(() => {
            const sciNameField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Scientific Name",
              name: "scientific_name",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Scientific name of the organism (e.g., Homo sapiens, Escherichia coli)",
              placeholder: "e.g., Escherichia coli",
            };
            const alreadyAdded = fields.some((f) => f.name === sciNameField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(sciNameField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Scientific Name</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Tax ID */}
          {(() => {
            const taxIdField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Tax ID",
              name: "tax_id",
              required: false,
              visible: true,
              perSample: true,
              helpText: "NCBI Taxonomy ID for the organism (e.g., 9606 for human, 562 for E. coli)",
              placeholder: "e.g., 9606",
              simpleValidation: {
                minLength: 1,
                maxLength: 10,
                pattern: "^[0-9]+$",
                patternMessage: "Use digits only",
              },
            };
            const alreadyAdded = fields.some((f) => f.name === taxIdField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(taxIdField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Tax ID</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Index i7 */}
          {(() => {
            const indexI7Field: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Index i7",
              name: "index_i7",
              required: false,
              visible: true,
              perSample: true,
              helpText: "i7 index sequence (A/C/G/T/N)",
              placeholder: "e.g., ATCACG",
              simpleValidation: {
                minLength: 4,
                maxLength: 12,
                pattern: "^[ACGTN]+$",
                patternMessage: "Use only A,C,G,T,N characters",
              },
            };
            const alreadyAdded = fields.some((f) => f.name === indexI7Field.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(indexI7Field)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Index i7</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Index i5 */}
          {(() => {
            const indexI5Field: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Index i5",
              name: "index_i5",
              required: false,
              visible: true,
              perSample: true,
              helpText: "i5 index sequence (A/C/G/T/N)",
              placeholder: "e.g., AGATCT",
              simpleValidation: {
                minLength: 4,
                maxLength: 12,
                pattern: "^[ACGTN]+$",
                patternMessage: "Use only A,C,G,T,N characters",
              },
            };
            const alreadyAdded = fields.some((f) => f.name === indexI5Field.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(indexI5Field)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Index i5</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Plate ID */}
          {(() => {
            const plateField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Plate ID",
              name: "plate_id",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Plate or batch identifier",
              placeholder: "e.g., PLATE-01",
              simpleValidation: { minLength: 2, maxLength: 50 },
            };
            const alreadyAdded = fields.some((f) => f.name === plateField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(plateField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Plate ID</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Well Position */}
          {(() => {
            const wellField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Well Position",
              name: "well_position",
              required: false,
              visible: true,
              perSample: true,
              helpText: "96-well position (A1-H12)",
              placeholder: "e.g., A1",
              simpleValidation: {
                pattern: "^[A-H](?:[1-9]|1[0-2])$",
                patternMessage: "Use A1-H12 format",
              },
            };
            const alreadyAdded = fields.some((f) => f.name === wellField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(wellField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Well Position</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Collection Date */}
          {(() => {
            const collectionDateField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "date",
              label: "Collection Date",
              name: "collection_date",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Date the sample was collected",
            };
            const alreadyAdded = fields.some((f) => f.name === collectionDateField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(collectionDateField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Collection Date</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Extraction Method */}
          {(() => {
            const extractionField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Extraction Method",
              name: "extraction_method",
              required: false,
              visible: true,
              perSample: true,
              helpText: "DNA/RNA extraction method",
              placeholder: "e.g., PowerSoil kit",
            };
            const alreadyAdded = fields.some((f) => f.name === extractionField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(extractionField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Extraction Method</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}

          {/* Sample Matrix */}
          {(() => {
            const matrixField: Omit<FormFieldDefinition, "id" | "order"> = {
              type: "text",
              label: "Sample Matrix",
              name: "sample_matrix",
              required: false,
              visible: true,
              perSample: true,
              helpText: "Sample matrix or material (e.g., soil, tissue, water)",
              placeholder: "e.g., soil",
            };
            const alreadyAdded = fields.some((f) => f.name === matrixField.name);
            return (
              <button
                type="button"
                onClick={() => !alreadyAdded && addSuggestedField(matrixField)}
                disabled={alreadyAdded}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border text-sm transition-all ${
                  alreadyAdded
                    ? "bg-amber-100/50 border-amber-200 text-amber-400 cursor-not-allowed"
                    : "bg-amber-50 border-amber-300 hover:border-amber-500 hover:bg-amber-100 cursor-pointer text-amber-700"
                }`}
              >
                <Plus className={`h-3 w-3 ${alreadyAdded ? "opacity-30" : ""}`} />
                <span>Sample Matrix</span>
                {alreadyAdded && <Check className="h-3 w-3 text-green-500" />}
              </button>
            );
          })()}
        </div>
      </GlassCard>

      {/* Facility-Only Fields - visible only to admins */}
      <div id="order-facility-section" className="scroll-mt-28">
      <GlassCard className="p-6 border-slate-300 bg-slate-50/50 mt-8">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-base font-semibold flex items-center gap-2">
            <Shield className="h-4 w-4 text-slate-500" />
            Facility-Only Fields
          </h2>
          <Button onClick={() => handleAddField(false, true)} variant="outline" size="sm" className="border-slate-300 hover:bg-slate-100">
            <Plus className="h-4 w-4 mr-2" />
            Add Field
          </Button>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Fields visible <strong>only to facility admins</strong>. Researchers will not see these fields.
          Use for internal tracking, QC notes, cost codes, or other facility-specific information.
        </p>

        <div className="space-y-3">
          {adminOnlyFields.map((field) => {
            const indexInSection = adminOnlyFields.findIndex(f => f.id === field.id);
            return (
            <div
              key={field.id}
              className="flex items-center gap-3 p-4 rounded-lg bg-slate-100/50 border border-slate-200"
            >
              <div className="flex flex-col gap-1">
                <button
                  type="button"
                  onClick={() => handleMoveField(field.id, !!field.perSample, "up")}
                  disabled={indexInSection === 0}
                  className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                >
                  <ChevronUp className="h-3 w-3" />
                </button>
                <button
                  type="button"
                  onClick={() => handleMoveField(field.id, !!field.perSample, "down")}
                  disabled={indexInSection === adminOnlyFields.length - 1}
                  className="p-1 hover:bg-slate-200 rounded disabled:opacity-30"
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              </div>

              <GripVertical className="h-4 w-4 text-slate-400" />

              <div className="flex-1">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium">{field.label}</span>
                  <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
                    {FIELD_TYPE_LABELS[field.type] || field.type}
                  </span>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-200 text-slate-600 font-medium flex items-center gap-1">
                    <Shield className="h-2.5 w-2.5" />
                    Admin only
                  </span>
                  {field.perSample && (
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-amber-100 text-amber-700 font-medium">
                      Per-sample
                    </span>
                  )}
                  {field.required && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-red-100 text-red-600">
                      Required
                    </span>
                  )}
                </div>
                {field.helpText && (
                  <p className="text-xs text-muted-foreground mt-1">{field.helpText}</p>
                )}
              </div>

              <div className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => handleEditField(field)}
                  title="Edit field"
                >
                  <Pencil className="h-4 w-4" />
                </Button>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => openDeleteFieldDialog(field)}
                  className="text-destructive hover:text-destructive"
                  title="Delete field"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )})}
          {adminOnlyFields.length === 0 && (
            <div className="text-center py-6 text-slate-500/70 border border-dashed border-slate-300 rounded-lg bg-slate-50">
              No facility-only fields defined. Add fields here for internal tracking visible only to admins.
            </div>
          )}
        </div>
      </GlassCard>
      </div>

      {/* Module Forms Section */}
      <div id="order-modules-section" className="mt-8 scroll-mt-28">
        <h2 className="text-base font-semibold mb-2">Module Forms</h2>
        <p className="text-sm text-muted-foreground mb-4">
          Modules extend SeqDesk with specialized form components. Enable modules in Configuration &rarr; Modules to unlock additional form features.
          Each module adds domain-specific fields, validation, and workflows tailored to your needs.
        </p>

        <div className="space-y-4">
          {/* Billing Information */}
          <GlassCard className="p-6">
            <ModuleGate moduleId="billing-info" adminView>
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-teal-500/10 flex items-center justify-center flex-shrink-0">
                    <Receipt className="h-5 w-5 text-teal-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">Billing Information</h3>
                    <p className="text-sm text-muted-foreground">
                      Add a billing field to collect Cost Center and PSP Element (SAP project structure plan) for internal cost allocation.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={addBillingField}
                  disabled={fields.some((f) => f.type === "billing")}
                  variant="outline"
                  size="sm"
                  className="bg-white"
                >
                  {fields.some((f) => f.type === "billing") ? (
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
              {fields.some((f) => f.type === "billing") && (
                <p className="text-sm text-teal-600 mt-3">
                  Billing field added. Edit it in the Form Fields list above to configure the label and help text.
                </p>
              )}
            </ModuleGate>
          </GlassCard>

          {/* Sequencing Technologies */}
          <GlassCard className="p-6">
            <ModuleGate moduleId="sequencing-tech" adminView>
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0">
                    <Dna className="h-5 w-5 text-primary" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium">Sequencing Technologies</h3>
                    <p className="text-sm text-muted-foreground">
                      Add a technology selector with pre-configured information about sequencing platforms, specs, pros/cons, and best-use cases.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={addSequencingTechField}
                  disabled={fields.some((f) => f.type === "sequencing-tech")}
                  variant="outline"
                  size="sm"
                  className="bg-white"
                >
                  {fields.some((f) => f.type === "sequencing-tech") ? (
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
              {fields.some((f) => f.type === "sequencing-tech") && (
                <p className="text-sm text-primary mt-3">
                  Technology selector added. Configure available technologies in{" "}
                  <a href="/admin/sequencing-tech" className="underline hover:text-primary/80">
                    Configuration &gt; Sequencing Technologies
                  </a>.
                </p>
              )}

              {/* Barcode per-sample field (sub-feature of Sequencing Tech) */}
              {hasSequencingTechField && (
                <div className="mt-4 pt-4 border-t border-border/50">
                  <div className="flex items-center justify-between">
                    <div>
                      <h4 className="text-sm font-medium">Per-Sample Barcode Assignment</h4>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Adds a barcode dropdown to each sample. Options are automatically determined from the selected kit.
                      </p>
                    </div>
                    <Button
                      onClick={addBarcodeField}
                      disabled={hasBarcodeField}
                      variant="outline"
                      size="sm"
                      className="bg-white ml-4 flex-shrink-0"
                    >
                      {hasBarcodeField ? (
                        <>
                          <Check className="h-4 w-4 mr-2" />
                          Added
                        </>
                      ) : (
                        <>
                          <Plus className="h-4 w-4 mr-2" />
                          Add to Samples
                        </>
                      )}
                    </Button>
                  </div>
                  {hasBarcodeField && (
                    <p className="text-xs text-muted-foreground mt-2">
                      <strong>Added to Per-Sample Fields.</strong> The barcode dropdown will appear in the sample entry table when a barcoding-capable kit is selected.
                    </p>
                  )}
                </div>
              )}
            </ModuleGate>
          </GlassCard>

          {/* ENA Sample Fields */}
          <GlassCard className="p-6 border-emerald-200 bg-emerald-50/30">
            <ModuleGate moduleId="ena-sample-fields" adminView>
              <div className="flex items-center justify-between">
                <div className="flex items-start gap-3">
                  <div className="h-10 w-10 rounded-lg bg-emerald-500/20 flex items-center justify-center flex-shrink-0">
                    <Database className="h-5 w-5 text-emerald-600" />
                  </div>
                  <div>
                    <h3 className="text-sm font-medium text-emerald-800">ENA Sample Fields</h3>
                    <p className="text-sm text-emerald-700/80">
                      Essential per-sample fields for ENA (European Nucleotide Archive) submission.
                      Includes <strong>Organism</strong> with NCBI taxonomy lookup, <strong>Sample Title</strong>, and <strong>Sample Alias</strong>.
                    </p>
                    <p className="text-xs text-emerald-600 mt-1">
                      Strongly recommended if you plan to submit sequencing data to public repositories.
                    </p>
                  </div>
                </div>
                <Button
                  onClick={addEnaSampleFields}
                  disabled={hasEnaSampleFields}
                  variant="outline"
                  size="sm"
                  className="bg-white border-emerald-300 text-emerald-700 hover:bg-emerald-100"
                >
                  {hasEnaSampleFields ? (
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
              {hasEnaSampleFields && (
                <div className="mt-3 p-3 rounded-lg bg-emerald-100/50 border border-emerald-300">
                  <p className="text-sm text-emerald-700">
                    <strong>Added to Per-Sample Fields:</strong> Organism (with taxonomy lookup), Sample Title, and Sample Alias.
                    These fields appear in the sample entry table when users fill in sample data.
                  </p>
                </div>
              )}
            </ModuleGate>
          </GlassCard>

          {/* Custom Module Development CTA */}
          <GlassCard className="p-6 border-dashed border-2 border-muted-foreground/20">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-muted flex items-center justify-center flex-shrink-0">
                <Plus className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-medium text-muted-foreground">Your Custom Module</h3>
                <p className="text-sm text-muted-foreground">
                  Need specialized fields for your workflow? We can develop a custom module tailored to your facility&apos;s specific requirements.{" "}
                  <a
                    href="mailto:hello@seqdesk.com?subject=Custom Module Development Inquiry&body=Hi,%0A%0AI'm interested in a custom module for SeqDesk.%0A%0AOur requirements:%0A-%20%0A%0APlease send me a quote.%0A%0AThank you!"
                    className="text-primary hover:underline"
                  >
                    Contact us
                  </a>
                </p>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Advanced Settings */}
      <div className="mt-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-8 w-8 rounded-lg bg-muted flex items-center justify-center">
            <Settings2 className="h-4 w-4 text-muted-foreground" />
          </div>
          <h2 className="text-base font-semibold">Advanced Settings</h2>
        </div>
        <p className="text-sm text-muted-foreground mb-4">
          Configure post-submission behavior and data handling policies for orders.
        </p>

        <div className="space-y-4">
          {/* Post-Submission Instructions */}
          <GlassCard className="p-6">
            <div className="flex items-start gap-3 mb-4">
              <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <FileText className="h-5 w-5 text-muted-foreground" />
              </div>
              <div>
                <h3 className="text-sm font-medium">Post-Submission Instructions</h3>
                <p className="text-sm text-muted-foreground">
                  Instructions shown to users after they submit an order (supports Markdown)
                </p>
              </div>
            </div>

            <div className="border-t pt-4 space-y-4">
              <div>
                <Textarea
                  value={postSubmissionInstructions}
                  onChange={(e) => setPostSubmissionInstructions(e.target.value)}
                  placeholder="Enter instructions shown to users after order submission..."
                  className="min-h-[200px] font-mono text-sm"
                  disabled={instructionsSaving}
                />
                <p className="text-xs text-muted-foreground mt-2">
                  Use Markdown formatting: **bold**, *italic*, ## headings, - lists, etc.
                </p>
              </div>

              <div className="flex items-center gap-2">
                <Button size="sm" onClick={handleSaveInstructions} disabled={instructionsSaving}>
                  {instructionsSaving ? (
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  ) : instructionsSaved ? (
                    <Check className="h-4 w-4 mr-2 text-green-500" />
                  ) : null}
                  {instructionsSaved ? "Saved!" : "Save Instructions"}
                </Button>
                <Button size="sm" variant="outline" onClick={handleResetInstructions} disabled={instructionsSaving}>
                  Reset to Default
                </Button>
              </div>
            </div>
          </GlassCard>

          {/* Data Handling */}
          <GlassCard className="p-6">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-secondary flex items-center justify-center flex-shrink-0">
                <Database className="h-5 w-5 text-muted-foreground" />
              </div>
              <div className="flex-1">
                <h3 className="text-sm font-medium">Data Handling</h3>
                <p className="text-sm text-muted-foreground mb-4">
                  Control data deletion and modification policies
                </p>
                <div className="border-t pt-4">
                  <div className="flex items-center justify-between">
                    <div className="space-y-1">
                      <Label htmlFor="allow-delete-submitted" className="text-sm font-medium flex items-center gap-2">
                        Allow Deletion of Submitted Orders
                        <AlertTriangle className="h-4 w-4 text-amber-500" />
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        When enabled, facility admins can delete orders even after they have been submitted.
                        This is useful for testing but should be disabled in production to prevent data loss.
                      </p>
                    </div>
                    <Switch
                      id="allow-delete-submitted"
                      checked={allowDeleteSubmittedOrders}
                      onCheckedChange={handleAllowDeleteSubmittedChange}
                    />
                  </div>
                  <div className="flex items-center justify-between mt-6 pt-6 border-t">
                    <div className="space-y-1">
                      <Label htmlFor="allow-user-assembly-download" className="text-sm font-medium">
                        Allow User Assembly Downloads
                      </Label>
                      <p className="text-sm text-muted-foreground">
                        When enabled, users can download final assemblies from the
                        Assemblies view and study pages.
                      </p>
                    </div>
                    <Switch
                      id="allow-user-assembly-download"
                      checked={allowUserAssemblyDownload}
                      onCheckedChange={handleAllowUserAssemblyDownloadChange}
                    />
                  </div>
                </div>
              </div>
            </div>
          </GlassCard>
        </div>
      </div>

      {/* Field Editor Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className={(fieldType === "mixs" || fieldType === "funding" || fieldType === "billing") ? "!w-[90vw] !max-w-[800px] max-h-[90vh] overflow-y-auto" : "!w-[90vw] !max-w-[1200px] max-h-[90vh] overflow-y-auto"}>
          <DialogHeader>
            <DialogTitle className="text-xl flex items-center gap-2">
              {fieldType === "mixs" && <Leaf className="h-5 w-5 text-emerald-600" />}
              {fieldType === "funding" && <Wallet className="h-5 w-5 text-amber-600" />}
              {fieldType === "billing" && <Receipt className="h-5 w-5 text-teal-600" />}
              {editingField ? "Edit Field" : "Add New Field"}
              {fieldType === "mixs" && <span className="text-sm font-normal text-muted-foreground ml-2">MIxS Metadata Configuration</span>}
              {fieldType === "funding" && <span className="text-sm font-normal text-muted-foreground ml-2">Funding Information Configuration</span>}
              {fieldType === "billing" && <span className="text-sm font-normal text-muted-foreground ml-2">Billing Information Configuration</span>}
            </DialogTitle>
          </DialogHeader>

          {/* Special MIxS field editor - uses plugin component */}
          {fieldType === "mixs" ? (
            <MixsAdminEditor
              label={fieldLabel}
              helpText={fieldHelpText}
              visible={fieldVisible}
              required={fieldRequired}
              mixsChecklists={fieldMixsChecklists}
              templates={mixsTemplates as MixsTemplate[]}
              templatesLoading={templatesLoading}
              onLabelChange={setFieldLabel}
              onHelpTextChange={setFieldHelpText}
              onVisibleChange={setFieldVisible}
              onRequiredChange={setFieldRequired}
              onChecklistToggle={toggleFieldMixsChecklist}
              onSelectAll={() => setFieldMixsChecklists(mixsTemplates.map(t => t.name))}
              onClearAll={() => setFieldMixsChecklists([])}
            />
          ) : fieldType === "funding" ? (
            <FundingAdminEditor
              label={fieldLabel}
              helpText={fieldHelpText}
              visible={fieldVisible}
              required={fieldRequired}
              onLabelChange={setFieldLabel}
              onHelpTextChange={setFieldHelpText}
              onVisibleChange={setFieldVisible}
              onRequiredChange={setFieldRequired}
            />
          ) : fieldType === "billing" ? (
            <BillingAdminEditor
              label={fieldLabel}
              helpText={fieldHelpText}
              visible={fieldVisible}
              required={fieldRequired}
              onLabelChange={setFieldLabel}
              onHelpTextChange={setFieldHelpText}
              onVisibleChange={setFieldVisible}
              onRequiredChange={setFieldRequired}
            />
          ) : fieldType === "sequencing-tech" ? (
            <SequencingTechAdminEditor />
          ) : (
            /* Standard field editor */
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 py-4">
              {/* Column 1 - Basic Settings */}
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Basic Settings</h3>

                <div className="space-y-2">
                  <Label htmlFor="fieldLabel">
                    Label <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="fieldLabel"
                    value={fieldLabel}
                    onChange={(e) => {
                      setFieldLabel(e.target.value);
                      if (!editingField) {
                        setFieldName(generateFieldName(e.target.value));
                      }
                    }}
                    placeholder="e.g., Sample Type"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fieldName">Field Key</Label>
                  <Input
                    id="fieldName"
                    value={fieldName}
                    onChange={(e) => setFieldName(e.target.value)}
                    placeholder="e.g., sample_type"
                    className="font-mono text-sm"
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label htmlFor="fieldType">Field Type</Label>
                    <Select
                      value={fieldType}
                      onValueChange={(v) => setFieldType(v as FieldType)}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        {(Object.keys(FIELD_TYPE_LABELS) as FieldType[]).filter(t => t !== "mixs").map(
                          (type) => (
                            <SelectItem key={type} value={type}>
                              {FIELD_TYPE_LABELS[type]}
                            </SelectItem>
                          )
                        )}
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="fieldGroup">Group (Step)</Label>
                    <Select
                      value={fieldGroupId || "none"}
                      onValueChange={(v) => setFieldGroupId(v === "none" ? "" : v)}
                    >
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

                <div className="space-y-3 py-2">
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
                    <label className="flex items-center gap-2 cursor-pointer" title="Only visible to facility admins">
                      <input
                        type="checkbox"
                        checked={fieldAdminOnly}
                        onChange={(e) => setFieldAdminOnly(e.target.checked)}
                        className="rounded border-input h-4 w-4"
                      />
                      <span className="text-sm flex items-center gap-1">
                        <Shield className="h-3 w-3 text-slate-500" />
                        Admin only
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
                        Order-level
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
                    Examples: volume (ml), concentration, storage temperature, quality metrics.
                  </div>
                )}
                {!fieldPerSample && (
                  <div className="p-3 rounded-lg bg-muted/50 border border-border text-sm text-muted-foreground">
                    <strong>Order Field:</strong> This field will be filled once when creating the order.
                  </div>
                )}

                {fieldAdminOnly && (
                  <div className="p-3 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600">
                    <strong>Facility-Only:</strong> This field is only visible to facility admins. Researchers will not see it.
                  </div>
                )}

                <div className="space-y-2">
                  <Label htmlFor="fieldPlaceholder">Placeholder</Label>
                  <Input
                    id="fieldPlaceholder"
                    value={fieldPlaceholder}
                    onChange={(e) => setFieldPlaceholder(e.target.value)}
                    placeholder="e.g., Enter project code..."
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fieldHelpText">Help Text</Label>
                  <Input
                    id="fieldHelpText"
                    value={fieldHelpText}
                    onChange={(e) => setFieldHelpText(e.target.value)}
                    placeholder="Explanatory text for users"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="fieldExample">Example Value</Label>
                  <Input
                    id="fieldExample"
                    value={fieldExample}
                    onChange={(e) => setFieldExample(e.target.value)}
                    placeholder="e.g., PROJ-2024-001"
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
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="h-8"
                        onClick={handleAddOption}
                      >
                        <Plus className="h-3 w-3" />
                      </Button>
                    </div>
                  </div>
                )}
              </div>

            {/* Column 2 - Validation Rules */}
            <div className="space-y-4">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Validation</h3>

              <div className="p-4 rounded-lg border border-border bg-muted/10 space-y-4">
                {/* Length validation for text fields */}
                {(fieldType === "text" || fieldType === "textarea") && (
                  <>
                    <div className="grid grid-cols-2 gap-3">
                      <div className="space-y-1">
                        <Label className="text-xs">Min Length</Label>
                        <Input
                          type="number"
                          min="0"
                          value={valMinLength}
                          onChange={(e) => setValMinLength(e.target.value)}
                          placeholder="0"
                        />
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Max Length</Label>
                        <Input
                          type="number"
                          min="0"
                          value={valMaxLength}
                          onChange={(e) => setValMaxLength(e.target.value)}
                          placeholder="No limit"
                        />
                      </div>
                    </div>

                    <div className="space-y-2">
                      <Label className="text-xs">Format</Label>
                      <Select value={valPatternPreset} onValueChange={setValPatternPreset}>
                        <SelectTrigger>
                          <SelectValue placeholder="No format required" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">None</SelectItem>
                          <SelectItem value="email">Email address</SelectItem>
                          <SelectItem value="url">URL (http/https)</SelectItem>
                          <SelectItem value="phone">Phone number</SelectItem>
                          <SelectItem value="alphanumeric">Alphanumeric only</SelectItem>
                          <SelectItem value="custom">Custom regex</SelectItem>
                        </SelectContent>
                      </Select>

                      {valPatternPreset === "custom" && (
                        <div className="space-y-2 mt-2">
                          <Input
                            value={valCustomPattern}
                            onChange={(e) => setValCustomPattern(e.target.value)}
                            placeholder="^[A-Z]{2,4}-\d{4}$"
                            className="font-mono text-xs"
                          />
                          <Input
                            value={valPatternMessage}
                            onChange={(e) => setValPatternMessage(e.target.value)}
                            placeholder="Error message"
                          />
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Value validation for number fields */}
                {fieldType === "number" && (
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1">
                      <Label className="text-xs">Min Value</Label>
                      <Input
                        type="number"
                        value={valMinValue}
                        onChange={(e) => setValMinValue(e.target.value)}
                        placeholder="No min"
                      />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Max Value</Label>
                      <Input
                        type="number"
                        value={valMaxValue}
                        onChange={(e) => setValMaxValue(e.target.value)}
                        placeholder="No max"
                      />
                    </div>
                  </div>
                )}

                {(fieldType === "select" || fieldType === "multiselect" || fieldType === "checkbox" || fieldType === "date") && (
                  <p className="text-sm text-muted-foreground py-4 text-center">
                    No validation rules for this field type
                  </p>
                )}
              </div>
            </div>

            {/* Column 3 - AI Validation */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">AI Validation</h3>
                {aiModuleEnabled && aiConfigured === true && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-green-500/15 text-green-600 font-medium">
                    Ready
                  </span>
                )}
                {aiModuleEnabled && aiConfigured === false && (
                  <span className="text-[10px] px-2 py-0.5 rounded bg-amber-500/15 text-amber-600 font-medium">
                    Not configured
                  </span>
                )}
              </div>

              <ModuleGate moduleId="ai-validation" adminView>
              <div className="p-4 rounded-lg border border-violet-500/20 bg-gradient-to-br from-violet-500/5 via-purple-500/5 to-fuchsia-500/5 space-y-4">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={aiEnabled}
                    onChange={(e) => setAiEnabled(e.target.checked)}
                    className="rounded border-input h-5 w-5"
                    disabled={aiConfigured === false}
                  />
                  <div>
                    <span className="font-medium">Enable AI validation</span>
                    <p className="text-xs text-muted-foreground">Uses AI to check if input makes sense</p>
                  </div>
                </label>

                {aiEnabled && (
                  <>
                    <div className="space-y-2">
                      <Label className="text-sm">Validation Prompt</Label>
                      <textarea
                        value={aiPrompt}
                        onChange={(e) => setAiPrompt(e.target.value)}
                        placeholder="Describe what valid input looks like in plain language...

Example: A project code in format PROJ-XXXX where XXXX is a 4-digit number. Should look like an official identifier."
                        className="w-full min-h-[160px] px-3 py-2 rounded-md border border-input bg-background text-sm resize-y focus:outline-none focus:ring-2 focus:ring-violet-500/50"
                      />
                    </div>

                    <div className="space-y-2">
                      <Label className="text-sm">Strictness Level</Label>
                      <div className="grid grid-cols-3 gap-2">
                        {(["lenient", "moderate", "strict"] as const).map((level) => (
                          <button
                            key={level}
                            type="button"
                            onClick={() => setAiStrictness(level)}
                            className={`px-3 py-2 rounded-md text-sm font-medium transition-all ${
                              aiStrictness === level
                                ? "bg-violet-500 text-white"
                                : "bg-muted hover:bg-muted/80"
                            }`}
                          >
                            {level.charAt(0).toUpperCase() + level.slice(1)}
                          </button>
                        ))}
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {aiStrictness === "lenient" && "Only flags obvious errors"}
                        {aiStrictness === "moderate" && "Balanced - allows reasonable variations"}
                        {aiStrictness === "strict" && "Requires close match to expected format"}
                      </p>
                    </div>

                    {/* Live Test Section */}
                    <div className="pt-4 border-t border-border/50">
                      <h4 className="text-sm font-medium mb-3">Live Test</h4>
                      <div className="space-y-3">
                        <div className="flex gap-2">
                          <Input
                            value={aiTestValue}
                            onChange={(e) => setAiTestValue(e.target.value)}
                            placeholder="Type a test value..."
                            className="flex-1"
                            onKeyDown={(e) => e.key === "Enter" && !aiTesting && aiPrompt.trim() && handleTestAI()}
                          />
                          <Button
                            type="button"
                            onClick={handleTestAI}
                            disabled={aiTesting || !aiPrompt.trim() || !aiTestValue.trim()}
                            className="bg-violet-500 hover:bg-violet-600"
                          >
                            {aiTesting ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              "Test"
                            )}
                          </Button>
                        </div>

                        {aiTestResult && (
                          <div className={`p-4 rounded-lg ${
                            aiTestResult.valid
                              ? "bg-green-500/10 border border-green-500/30"
                              : "bg-red-500/10 border border-red-500/30"
                          }`}>
                            <div className="flex items-start gap-3">
                              {aiTestResult.valid ? (
                                <CheckCircle2 className="h-5 w-5 text-green-600 flex-shrink-0 mt-0.5" />
                              ) : (
                                <AlertTriangle className="h-5 w-5 text-red-600 flex-shrink-0 mt-0.5" />
                              )}
                              <div className="flex-1 min-w-0">
                                <p className={`font-semibold ${aiTestResult.valid ? "text-green-700" : "text-red-700"}`}>
                                  {aiTestResult.valid ? "Valid Input" : "Invalid Input"}
                                </p>
                                <p className="text-sm mt-1 text-muted-foreground">
                                  {aiTestResult.message}
                                </p>
                                {aiTestResult.suggestion && (
                                  <p className="text-sm mt-2 text-muted-foreground italic">
                                    Suggestion: {aiTestResult.suggestion}
                                  </p>
                                )}
                              </div>
                            </div>
                          </div>
                        )}

                        {!aiTestResult && aiPrompt.trim() && (
                          <p className="text-xs text-muted-foreground text-center py-2">
                            Enter a value and click Test to see how AI validates it
                          </p>
                        )}
                      </div>
                    </div>
                  </>
                )}

                {aiConfigured === false && (
                  <div className="py-4 text-center">
                    <p className="text-sm text-muted-foreground">
                      Add ANTHROPIC_API_KEY to .env to enable AI validation
                    </p>
                  </div>
                )}
              </div>
              </ModuleGate>
            </div>
          </div>
          )}

          <DialogFooter className="border-t pt-4">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSaveField} disabled={fieldType === "mixs" && fieldMixsChecklists.length === 0}>
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
                placeholder="e.g., Sequencing Parameters"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupDescription">Description</Label>
              <Input
                id="groupDescription"
                value={groupDescription}
                onChange={(e) => setGroupDescription(e.target.value)}
                placeholder="e.g., Configure sequencing settings"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="groupIcon">Icon</Label>
              <Select value={groupIcon} onValueChange={setGroupIcon}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="FileText">FileText (Documents)</SelectItem>
                  <SelectItem value="Settings">Settings (Gear)</SelectItem>
                  <SelectItem value="Leaf">Leaf (MIxS/Bio)</SelectItem>
                  <SelectItem value="ClipboardList">ClipboardList (Forms)</SelectItem>
                  <SelectItem value="User">User (Contact)</SelectItem>
                  <SelectItem value="Beaker">Beaker (Lab)</SelectItem>
                  <SelectItem value="Database">Database (Data)</SelectItem>
                </SelectContent>
              </Select>
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

      {/* Delete Group Confirmation Dialog */}
      <Dialog open={deleteGroupDialogOpen} onOpenChange={setDeleteGroupDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Delete Group
            </DialogTitle>
          </DialogHeader>

          <div className="py-4">
            {groupToDelete && (
              <>
                <p className="text-sm text-muted-foreground mb-4">
                  Are you sure you want to delete the group <span className="font-semibold text-foreground">&quot;{groupToDelete.name}&quot;</span>?
                </p>
                {(() => {
                  const fieldsInGroup = fields.filter((f) => f.groupId === groupToDelete.id);
                  if (fieldsInGroup.length > 0) {
                    return (
                      <div className="rounded-lg bg-amber-500/10 border border-amber-500/30 p-3">
                        <p className="text-sm font-medium text-amber-700 dark:text-amber-400 mb-2">
                          This group contains {fieldsInGroup.length} field{fieldsInGroup.length > 1 ? "s" : ""}:
                        </p>
                        <ul className="text-sm text-amber-600 dark:text-amber-500 list-disc list-inside space-y-1">
                          {fieldsInGroup.slice(0, 5).map((f) => (
                            <li key={f.id}>{f.label}</li>
                          ))}
                          {fieldsInGroup.length > 5 && (
                            <li>...and {fieldsInGroup.length - 5} more</li>
                          )}
                        </ul>
                        <p className="text-xs text-amber-600 dark:text-amber-500 mt-2">
                          These fields will be moved to &quot;Additional Details&quot; step in the order form.
                        </p>
                      </div>
                    );
                  }
                  return null;
                })()}
              </>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setDeleteGroupDialogOpen(false);
              setGroupToDelete(null);
            }}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={confirmDeleteGroup}>
              Delete Group
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
  );
}
