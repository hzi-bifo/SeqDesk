"use client";

import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export interface ParamsSchema {
  type?: string;
  properties?: Record<string, ParamProperty>;
  required?: string[];
}

export interface ParamProperty {
  type?: string | string[];
  title?: string;
  description?: string;
  default?: unknown;
  enum?: Array<string | number>;
  minimum?: number;
  maximum?: number;
}

interface ParamsFormProps {
  schema: ParamsSchema | null | undefined;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

function primaryType(property: ParamProperty): string {
  const type = Array.isArray(property.type) ? property.type.find((entry) => entry !== "null") : property.type;
  return type ?? (typeof property.default === "number" ? "number" : typeof property.default === "boolean" ? "boolean" : "string");
}

/**
 * A small form for kit parameters described by a JSON-schema-like object.
 * Supports integer, number, boolean, string and enum properties; anything
 * else is edited as JSON text.
 */
export function ParamsForm({ schema, values, onChange, disabled }: ParamsFormProps) {
  const properties = Object.entries(schema?.properties ?? {});
  if (properties.length === 0) {
    return <p className="text-sm text-muted-foreground">This analysis has no parameters.</p>;
  }
  const update = (key: string, value: unknown) => onChange({ ...values, [key]: value });

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {properties.map(([key, property]) => {
        const type = primaryType(property);
        const value = values[key] ?? property.default ?? (type === "boolean" ? false : "");
        const label = property.title ?? key;
        const required = schema?.required?.includes(key);
        const id = `param-${key}`;
        let control: React.ReactNode;
        if (property.enum) {
          control = (
            <Select value={String(value)} onValueChange={(next) => update(key, typeof property.enum?.[0] === "number" ? Number(next) : next)} disabled={disabled}>
              <SelectTrigger id={id} aria-label={label}><SelectValue /></SelectTrigger>
              <SelectContent>
                {property.enum.map((option) => (
                  <SelectItem key={String(option)} value={String(option)}>{String(option)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        } else if (type === "boolean") {
          control = (
            <label className="flex h-9 items-center gap-2 text-sm">
              <input id={id} type="checkbox" checked={Boolean(value)} disabled={disabled} onChange={(event) => update(key, event.target.checked)} />
              {Boolean(value) ? "enabled" : "disabled"}
            </label>
          );
        } else if (type === "integer" || type === "number") {
          control = (
            <Input
              id={id}
              type="number"
              step={type === "integer" ? 1 : "any"}
              min={property.minimum}
              max={property.maximum}
              value={value === null || value === undefined ? "" : String(value)}
              disabled={disabled}
              onChange={(event) => {
                const raw = event.target.value;
                if (raw === "") return update(key, null);
                const parsed = type === "integer" ? Number.parseInt(raw, 10) : Number(raw);
                update(key, Number.isFinite(parsed) ? parsed : null);
              }}
            />
          );
        } else if (type === "string") {
          control = <Input id={id} value={value === null || value === undefined ? "" : String(value)} disabled={disabled} onChange={(event) => update(key, event.target.value)} />;
        } else {
          control = (
            <Input
              id={id}
              className="font-mono text-xs"
              value={typeof value === "string" ? value : JSON.stringify(value)}
              disabled={disabled}
              onChange={(event) => {
                try {
                  update(key, JSON.parse(event.target.value));
                } catch {
                  update(key, event.target.value);
                }
              }}
            />
          );
        }
        return (
          <div key={key}>
            <label htmlFor={id} className="text-sm font-medium">
              {label}
              {required && <span className="text-destructive"> *</span>}
            </label>
            <div className="mt-1">{control}</div>
            {property.description && <p className="mt-1 text-xs text-muted-foreground">{property.description}</p>}
          </div>
        );
      })}
    </div>
  );
}
