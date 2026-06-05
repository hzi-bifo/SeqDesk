"use client";

import {
  useMemo,
  useState,
  type Dispatch,
  type SetStateAction,
} from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
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
import type { PipelineConfigProperty } from "@/lib/pipelines/types";
import { CheckCircle2, ChevronDown, SlidersHorizontal } from "lucide-react";

export interface PipelineRunDerivedSetting {
  key: string;
  title: string;
  value: string;
  message: string;
  source: string;
}

interface PipelineRunSettingsProps {
  configSchema?: {
    properties?: Record<string, PipelineConfigProperty>;
  } | null;
  localConfig: Record<string, unknown>;
  setLocalConfig: Dispatch<SetStateAction<Record<string, unknown>>>;
  derivedSettings?: PipelineRunDerivedSetting[];
  enumLabels?: Record<string, Record<string, string>>;
  /**
   * Config keys that already have a non-empty server-side (install-profile)
   * value. Fields flagged `x-seqdesk.hideWhenServerConfigured` are hidden from
   * the form when their key is in this set, since the facility manages them.
   */
  serverManagedKeys?: Set<string>;
}

interface ConfigEntry {
  key: string;
  property: PipelineConfigProperty;
}

function getPlacement(property: PipelineConfigProperty): string | undefined {
  return property["x-seqdesk"]?.placement;
}

function getHelpText(property: PipelineConfigProperty): string | undefined {
  return property["x-seqdesk"]?.helpText || property.description;
}

function isEditableRunSetting(property: PipelineConfigProperty): boolean {
  const placement = getPlacement(property);
  return placement !== "derived" && placement !== "admin" && placement !== "hidden";
}

function isDefaultVisibleProperty(property: PipelineConfigProperty): boolean {
  return property.type === "boolean" || property.type === "number" || Boolean(property.enum?.length);
}

function getBooleanChecked(
  property: PipelineConfigProperty,
  value: unknown
): boolean {
  const inverse = property["x-seqdesk"]?.booleanMode === "inverse";
  return inverse ? !value : Boolean(value);
}

function getBooleanStoredValue(
  property: PipelineConfigProperty,
  checked: boolean
): boolean {
  const inverse = property["x-seqdesk"]?.booleanMode === "inverse";
  return inverse ? !checked : checked;
}

function renderHelp(property: PipelineConfigProperty) {
  const help = getHelpText(property);
  if (!help) return null;
  return <p className="text-xs leading-relaxed text-muted-foreground">{help}</p>;
}

export function PipelineRunSettings({
  configSchema,
  localConfig,
  setLocalConfig,
  derivedSettings = [],
  enumLabels = {},
  serverManagedKeys,
}: PipelineRunSettingsProps) {
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const entries = useMemo<ConfigEntry[]>(
    () =>
      Object.entries(configSchema?.properties || {}).map(([key, property]) => ({
        key,
        property,
      })),
    [configSchema?.properties]
  );

  const editableEntries = entries
    .filter(({ property }) => isEditableRunSetting(property))
    .filter(
      ({ key, property }) =>
        !(
          property["x-seqdesk"]?.hideWhenServerConfigured === true &&
          serverManagedKeys?.has(key)
        )
    );
  const basicEntries = editableEntries.filter(({ property }) => {
    const placement = getPlacement(property);
    return placement === "basic" || (!placement && isDefaultVisibleProperty(property));
  });
  const advancedEntries = editableEntries.filter(
    ({ property }) => getPlacement(property) === "advanced"
  );
  const hasContent =
    derivedSettings.length > 0 || basicEntries.length > 0 || advancedEntries.length > 0;

  if (!hasContent) return null;

  const renderControl = ({ key, property }: ConfigEntry) => {
    const fieldId = `config-${key}`;
    const value = localConfig[key] ?? property.default;
    const title = property.title || key;

    if (property.type === "boolean") {
      const checked = getBooleanChecked(property, value);
      return (
        <div key={key} className="flex min-w-[13rem] items-start gap-2.5">
          <Switch
            id={fieldId}
            checked={checked}
            onCheckedChange={(nextChecked) =>
              setLocalConfig((prev) => ({
                ...prev,
                [key]: getBooleanStoredValue(property, Boolean(nextChecked)),
              }))
            }
          />
          <div className="min-w-0 space-y-1">
            <Label htmlFor={fieldId} className="cursor-pointer text-sm font-medium">
              {title}
            </Label>
            {renderHelp(property)}
          </div>
        </div>
      );
    }

    if (property.enum?.length) {
      return (
        <div key={key} className="min-w-[11rem] space-y-1">
          <Label className="text-xs font-medium" htmlFor={fieldId}>
            {title}
          </Label>
          <Select
            value={String(value ?? property.enum[0] ?? "")}
            onValueChange={(nextValue) =>
              setLocalConfig((prev) => ({ ...prev, [key]: nextValue }))
            }
          >
            <SelectTrigger id={fieldId} aria-label={title} className="h-8 text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {property.enum.map((option) => {
                const optionValue = String(option);
                return (
                  <SelectItem key={optionValue} value={optionValue}>
                    {enumLabels[key]?.[optionValue] || optionValue}
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
          {renderHelp(property)}
        </div>
      );
    }

    if (property.type === "number" || property.type === "string") {
      return (
        <div key={key} className="min-w-[9rem] space-y-1">
          <Label className="text-xs font-medium" htmlFor={fieldId}>
            {title}
          </Label>
          <Input
            id={fieldId}
            type={property.type === "number" ? "number" : "text"}
            min={property.minimum}
            max={property.maximum}
            className="h-8 text-xs"
            value={value == null ? "" : String(value)}
            onChange={(event) => {
              const nextValue = event.target.value;
              setLocalConfig((prev) => {
                const next = { ...prev };
                if (nextValue === "") {
                  delete next[key];
                } else {
                  next[key] = property.type === "number" ? Number(nextValue) : nextValue;
                }
                return next;
              });
            }}
          />
          {renderHelp(property)}
        </div>
      );
    }

    return null;
  };

  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">Settings</h3>
        {advancedEntries.length > 0 && (
          <Badge variant="outline" className="text-xs font-normal">
            {advancedEntries.length} advanced
          </Badge>
        )}
      </div>

      {derivedSettings.length > 0 && (
        <div className="mt-3 space-y-2">
          {derivedSettings.map((setting) => (
            <div
              key={setting.key}
              className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900"
            >
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" />
              <div className="min-w-0">
                <p className="font-medium">{setting.message}</p>
                <p className="text-xs text-emerald-800/80">
                  Derived from order sequencing technology.
                </p>
              </div>
            </div>
          ))}
        </div>
      )}

      {basicEntries.length > 0 && (
        <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {basicEntries.map(renderControl)}
        </div>
      )}

      {advancedEntries.length > 0 && (
        <Collapsible
          open={advancedOpen}
          onOpenChange={setAdvancedOpen}
          className="mt-4 border-t pt-3"
        >
          <CollapsibleTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 gap-2 px-0 text-xs"
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Advanced settings
              <ChevronDown
                className={`h-3.5 w-3.5 transition-transform ${
                  advancedOpen ? "rotate-180" : ""
                }`}
              />
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-3 flex flex-wrap items-start gap-4">
              {advancedEntries.map(renderControl)}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}
