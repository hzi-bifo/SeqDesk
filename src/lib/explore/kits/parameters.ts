import type { KitManifest } from "./schema";

type Schema = KitManifest["params"];
const propertyObject = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};

export function parameterDefaults(schema: Schema): Record<string, unknown> {
  return Object.fromEntries(Object.entries(schema?.properties ?? {}).flatMap(([key, value]) => {
    const property = propertyObject(value);
    return "default" in property ? [[key, property.default]] : [];
  }));
}

/** Validate the common parameter controls supported by ParamsForm, on both sides of a guided request. */
export function parameterProblems(schema: Schema, values: Record<string, unknown>): string[] {
  const problems: string[] = [];
  for (const [key, raw] of Object.entries(schema?.properties ?? {})) {
    const property = propertyObject(raw);
    const label = typeof property.title === "string" ? property.title : key;
    const value = values[key];
    const types = Array.isArray(property.type) ? property.type : typeof property.type === "string" ? [property.type] : [];
    if (value === undefined || (value === "" && schema?.required?.includes(key))) {
      if (schema?.required?.includes(key)) problems.push(`${label}: enter a value in Advanced options.`);
      continue;
    }
    if (value === null && !types.includes("null")) { problems.push(`${label}: enter a value in Advanced options.`); continue; }
    if (value === null && types.includes("null")) continue;
    const matchesType = !types.length || types.some(type => type === "integer" ? typeof value === "number" && Number.isInteger(value)
      : type === "number" ? typeof value === "number" && Number.isFinite(value)
        : type === "array" ? Array.isArray(value) : type === "object" ? Boolean(value) && typeof value === "object" && !Array.isArray(value) : typeof value === type);
    if (!matchesType) { problems.push(`${label}: check the value in Advanced options.`); continue; }
    if (Array.isArray(property.enum) && !property.enum.includes(value)) problems.push(`${label}: choose one of the offered options.`);
    if (typeof value === "number" && typeof property.minimum === "number" && value < property.minimum) problems.push(`${label}: use at least ${property.minimum}.`);
    if (typeof value === "number" && typeof property.maximum === "number" && value > property.maximum) problems.push(`${label}: use at most ${property.maximum}.`);
  }
  for (const key of schema?.required ?? []) {
    if (!(key in (schema?.properties ?? {})) && !(key in values)) problems.push(`${key}: this template requires an option not described by its form. Use the analysis editor.`);
  }
  return problems;
}
