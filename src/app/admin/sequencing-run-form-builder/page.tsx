"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notifyPanel } from "@/lib/notifications/client";
import { PageContainer } from "@/components/layout/PageContainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type {
  FieldType,
  FormFieldDefinition,
  FormFieldGroup,
  SelectOption,
} from "@/types/form-config";
import {
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Plus,
  Trash2,
} from "lucide-react";

const FIELD_TYPES: Array<{ value: FieldType; label: string }> = [
  { value: "text", label: "Text" },
  { value: "textarea", label: "Long text" },
  { value: "select", label: "Select" },
  { value: "number", label: "Number" },
  { value: "date", label: "Date" },
  { value: "checkbox", label: "Checkbox" },
  { value: "barcode", label: "Barcode" },
];

function slugifyFieldName(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function createField(order: number, groupId?: string): FormFieldDefinition {
  return {
    id: crypto.randomUUID(),
    type: "text",
    label: "New Field",
    name: `new_field_${order + 1}`,
    required: false,
    visible: true,
    adminOnly: true,
    order,
    groupId,
  };
}

function optionsToText(options?: SelectOption[]): string {
  return (options ?? [])
    .map((option) =>
      option.value === option.label
        ? option.value
        : `${option.value}|${option.label}`
    )
    .join("\n");
}

function textToOptions(value: string): SelectOption[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [rawValue, rawLabel] = line.split("|");
      const optionValue = rawValue.trim();
      return {
        value: optionValue,
        label: (rawLabel ?? rawValue).trim(),
      };
    });
}

export default function SequencingRunFormBuilderPage() {
  const [fields, setFields] = useState<FormFieldDefinition[]>([]);
  const [groups, setGroups] = useState<FormFieldGroup[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const sortedFields = useMemo(
    () => [...fields].sort((a, b) => a.order - b.order),
    [fields]
  );

  const loadConfig = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch("/api/admin/sequencing-run-form-config");
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to load run-assignment fields");
      }
      setFields((payload?.fields ?? []) as FormFieldDefinition[]);
      setGroups((payload?.groups ?? []) as FormFieldGroup[]);
    } catch (error) {
      notifyPanel.error(
        error instanceof Error ? error.message : "Failed to load run-assignment fields"
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadConfig();
  }, [loadConfig]);

  const updateField = (
    fieldId: string,
    updater: (field: FormFieldDefinition) => FormFieldDefinition
  ) => {
    setFields((current) =>
      current.map((field) => (field.id === fieldId ? updater(field) : field))
    );
  };

  const addField = () => {
    setFields((current) => [
      ...current,
      createField(current.length, groups[0]?.id),
    ]);
  };

  const removeField = (fieldId: string) => {
    setFields((current) => current.filter((field) => field.id !== fieldId));
  };

  const saveConfig = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/admin/sequencing-run-form-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fields, groups }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.error || "Failed to save run-assignment fields");
      }
      setFields((payload?.fields ?? []) as FormFieldDefinition[]);
      setGroups((payload?.groups ?? []) as FormFieldGroup[]);
      notifyPanel.success("Saved run-assignment fields");
    } catch (error) {
      notifyPanel.error(
        error instanceof Error ? error.message : "Failed to save run-assignment fields"
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <PageContainer>
      <div className="space-y-6">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <Button variant="ghost" size="sm" asChild className="-ml-2 mb-2">
              <Link href="/admin/settings">
                <ArrowLeft className="mr-2 h-4 w-4" />
                Admin Settings
              </Link>
            </Button>
            <h1 className="text-xl font-semibold">Sequencing Run Fields</h1>
            <p className="mt-0.5 text-sm text-muted-foreground">
              Configure internal questionnaire fields stored on each run-sample assignment.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" onClick={addField} disabled={loading || saving}>
              <Plus className="mr-2 h-4 w-4" />
              Add Field
            </Button>
            <Button onClick={() => void saveConfig()} disabled={loading || saving}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <CheckCircle2 className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>
          </div>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Run-Assignment Questionnaire</CardTitle>
            <CardDescription>
              These fields appear in the run plan table and Excel import/export, separate from order and sample metadata.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex items-center justify-center py-10 text-sm text-muted-foreground">
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Loading fields...
              </div>
            ) : sortedFields.length === 0 ? (
              <div className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                No run-assignment fields configured.
              </div>
            ) : (
              <div className="space-y-4">
                {sortedFields.map((field, index) => (
                  <div key={field.id} className="rounded-lg border p-4">
                    <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <p className="font-medium">{field.label}</p>
                          {field.adminOnly && <Badge variant="outline">Internal</Badge>}
                          {!field.visible && <Badge variant="secondary">Hidden</Badge>}
                        </div>
                        <p className="mt-1 font-mono text-xs text-muted-foreground">
                          {field.name}
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        onClick={() => removeField(field.id)}
                        aria-label={`Remove ${field.label}`}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>

                    <div className="grid gap-4 lg:grid-cols-4">
                      <div className="space-y-2">
                        <Label htmlFor={`${field.id}-label`}>Label</Label>
                        <Input
                          id={`${field.id}-label`}
                          value={field.label}
                          onChange={(event) => {
                            const label = event.target.value;
                            updateField(field.id, (current) => ({
                              ...current,
                              label,
                              name:
                                current.name.startsWith("new_field_") || !current.name
                                  ? slugifyFieldName(label)
                                  : current.name,
                            }));
                          }}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${field.id}-name`}>Field key</Label>
                        <Input
                          id={`${field.id}-name`}
                          value={field.name}
                          onChange={(event) =>
                            updateField(field.id, (current) => ({
                              ...current,
                              name: slugifyFieldName(event.target.value),
                            }))
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Type</Label>
                        <Select
                          value={field.type}
                          onValueChange={(value) =>
                            updateField(field.id, (current) => ({
                              ...current,
                              type: value as FieldType,
                              options:
                                value === "select"
                                  ? current.options ?? []
                                  : current.options,
                            }))
                          }
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {FIELD_TYPES.map((type) => (
                              <SelectItem key={type.value} value={type.value}>
                                {type.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`${field.id}-order`}>Order</Label>
                        <Input
                          id={`${field.id}-order`}
                          type="number"
                          value={field.order}
                          onChange={(event) =>
                            updateField(field.id, (current) => ({
                              ...current,
                              order: Number(event.target.value) || index,
                            }))
                          }
                        />
                      </div>
                    </div>

                    <div className="mt-4 grid gap-4 lg:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`${field.id}-help`}>Help text</Label>
                        <Input
                          id={`${field.id}-help`}
                          value={field.helpText ?? ""}
                          onChange={(event) =>
                            updateField(field.id, (current) => ({
                              ...current,
                              helpText: event.target.value || undefined,
                            }))
                          }
                        />
                      </div>
                      {field.type === "select" && (
                        <div className="space-y-2">
                          <Label htmlFor={`${field.id}-options`}>Options</Label>
                          <Textarea
                            id={`${field.id}-options`}
                            value={optionsToText(field.options)}
                            onChange={(event) =>
                              updateField(field.id, (current) => ({
                                ...current,
                                options: textToOptions(event.target.value),
                              }))
                            }
                            placeholder={"value|Label\nother|Other"}
                            className="min-h-24"
                          />
                        </div>
                      )}
                    </div>

                    <div className="mt-4 flex flex-wrap items-center gap-5">
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={field.required}
                          onCheckedChange={(checked) =>
                            updateField(field.id, (current) => ({
                              ...current,
                              required: checked,
                            }))
                          }
                        />
                        Required
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={field.visible}
                          onCheckedChange={(checked) =>
                            updateField(field.id, (current) => ({
                              ...current,
                              visible: checked,
                            }))
                          }
                        />
                        Visible
                      </label>
                      <label className="flex items-center gap-2 text-sm">
                        <Switch
                          checked={Boolean(field.adminOnly)}
                          onCheckedChange={(checked) =>
                            updateField(field.id, (current) => ({
                              ...current,
                              adminOnly: checked,
                            }))
                          }
                        />
                        Internal only
                      </label>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </PageContainer>
  );
}
