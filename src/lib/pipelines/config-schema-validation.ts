import type {
  PipelineConfigProperty,
  PipelineConfigSchema,
} from "@/lib/pipelines/types";

export interface PipelineConfigSchemaValidationResult {
  /** Human-readable titles of required fields that do not have a value. */
  missingFields: string[];
  /** Required-field messages, kept separate for the guided setup checklist. */
  requiredIssues: string[];
  /** Type, enum, and numeric-bound messages for configured values. */
  valueIssues: string[];
  /** All schema issues in stable display order. */
  issues: string[];
}

function isMissingRequiredValue(value: unknown): boolean {
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim().length === 0;
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function valuesEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;

  if (
    (Array.isArray(left) && Array.isArray(right)) ||
    (
      left !== null &&
      right !== null &&
      typeof left === "object" &&
      typeof right === "object" &&
      !Array.isArray(left) &&
      !Array.isArray(right)
    )
  ) {
    try {
      return JSON.stringify(left) === JSON.stringify(right);
    } catch {
      return false;
    }
  }

  return false;
}

function formatEnumValue(value: unknown): string {
  if (typeof value === "string") return value;
  if (
    typeof value === "number" ||
    typeof value === "boolean" ||
    value === null
  ) {
    return String(value);
  }

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function getTypeIssue(
  property: PipelineConfigProperty,
  value: unknown,
  label: string
): string | null {
  switch (property.type) {
    case "string":
      return typeof value === "string" ? null : `${label} must be a string.`;
    case "number":
      return typeof value === "number" && Number.isFinite(value)
        ? null
        : `${label} must be a number.`;
    case "integer":
      return typeof value === "number" &&
        Number.isFinite(value) &&
        Number.isInteger(value)
        ? null
        : `${label} must be an integer.`;
    case "boolean":
      return typeof value === "boolean"
        ? null
        : `${label} must be true or false.`;
    case "array":
      return Array.isArray(value) ? null : `${label} must be an array.`;
    default:
      // Pipeline descriptors may carry UI-specific types. The generic validator
      // only enforces the JSON-schema primitives it understands.
      return null;
  }
}

/**
 * Validate configured values against the portable subset of PipelineConfigSchema.
 *
 * Optional null values are treated as unset. This is intentional because existing
 * descriptors use null defaults for optional numeric fields. Properties not
 * declared by the schema are preserved and ignored for forward compatibility.
 */
export function validatePipelineConfigSchema(
  schema: PipelineConfigSchema,
  config: Record<string, unknown>
): PipelineConfigSchemaValidationResult {
  const missingFields: string[] = [];
  const requiredIssues: string[] = [];
  const valueIssues: string[] = [];
  const missingKeys = new Set<string>();

  for (const key of new Set(schema.required || [])) {
    if (!isMissingRequiredValue(config[key])) continue;

    const label = schema.properties[key]?.title || key;
    missingKeys.add(key);
    missingFields.push(label);
    requiredIssues.push(`${label} is required.`);
  }

  for (const [key, property] of Object.entries(schema.properties)) {
    const value = config[key];

    // Undefined and null represent an omitted optional value. Required omitted
    // values (and required blank strings/arrays) already have one focused issue.
    if (value === undefined || value === null || missingKeys.has(key)) continue;

    const label = property.title || key;
    const typeIssue = getTypeIssue(property, value, label);
    if (typeIssue) {
      valueIssues.push(typeIssue);
      continue;
    }

    if (typeof value === 'string' && value.trim()) {
      if (property.pattern && !new RegExp(property.pattern).test(value.trim())) {
        valueIssues.push(`${label} has an invalid format.`);
      }
      if (property.format === 'absolute-path' && (!value.startsWith('/') || /[\x00-\x1f]/.test(value))) {
        valueIssues.push(`${label} must be an absolute path on the execution host.`);
      }
      if (property.format === 'identifier-list' && !value.split(',').every(part => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(part.trim()))) {
        valueIssues.push(`${label} must contain comma-separated identifiers.`);
      }
    }

    if (
      property.enum &&
      !property.enum.some((allowedValue) => valuesEqual(allowedValue, value))
    ) {
      valueIssues.push(
        `${label} must be one of: ${property.enum
          .map(formatEnumValue)
          .join(", ")}.`
      );
      continue;
    }

    if (typeof value !== "number" || !Number.isFinite(value)) continue;

    if (property.minimum !== undefined && value < property.minimum) {
      valueIssues.push(`${label} must be at least ${property.minimum}.`);
    }
    if (property.maximum !== undefined && value > property.maximum) {
      valueIssues.push(`${label} must be at most ${property.maximum}.`);
    }
  }

  return {
    missingFields,
    requiredIssues,
    valueIssues,
    issues: [...requiredIssues, ...valueIssues],
  };
}

/** Run forms may contain saved administrator defaults. Reload those on the server. */
export function pipelineRunOverrides(schema: { additionalProperties?: boolean; properties?: Record<string, PipelineConfigProperty> } | undefined, config: Record<string, unknown>): Record<string, unknown> {
  if (schema?.additionalProperties !== false) return config;
  return Object.fromEntries(Object.entries(config).filter(([key]) => {
    const property = schema.properties?.[key];
    return property && !['admin', 'hidden', 'derived'].includes(property['x-seqdesk']?.placement ?? '');
  }));
}

export function pipelineConfigOverrideIssues(schema: PipelineConfigSchema | undefined, config: Record<string, unknown>, canManageConfig: boolean): string[] {
  if (schema?.additionalProperties !== false) return [];
  return Object.keys(config).flatMap(key => {
    const property = Object.hasOwn(schema.properties, key) ? schema.properties[key] : undefined;
    if (!property) return [`Unsupported pipeline parameter: ${key}`];
    const placement = property['x-seqdesk']?.placement;
    if (placement === 'hidden' || placement === 'derived') return [`Parameter ${key} is supplied by the executor`];
    return !canManageConfig && placement === 'admin' ? [`Only administrators may override ${key}`] : [];
  });
}

export function pipelineSchemaRunIssues(schema: PipelineConfigSchema | undefined, config: Record<string, unknown>): string[] {
  if (!schema) return [];
  if (!schema.runRequirements && schema.additionalProperties !== false) return [];
  const issues = validatePipelineConfigSchema({ ...schema, required: [...(schema.required ?? []), ...(schema.runRequirements?.required ?? [])] }, config).issues;
  for (const [key, rule] of Object.entries(schema.runRequirements?.properties ?? {})) {
    const label = schema.properties[key]?.title || key;
    if (Object.hasOwn(rule, 'const') && !valuesEqual(config[key], rule.const)) issues.push(`${label} must be ${formatEnumValue(rule.const)}.`);
    if (rule.format === 'json-string-map') {
      try {
        const mapping: unknown = JSON.parse(String(config[key]));
        if (!mapping || typeof mapping !== 'object' || Array.isArray(mapping) || !Object.keys(mapping).length ||
          Object.entries(mapping).some(([name, value]) => !name.trim() || typeof value !== 'string' || !value.trim())) throw new Error();
      } catch { issues.push(`${label} must be a nonempty JSON mapping of names to strings.`); }
    }
  }
  return issues;
}
