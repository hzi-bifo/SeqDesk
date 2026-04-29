import type { FieldType, FormFieldDefinition } from "@/types/form-config";
import { DEFAULT_MODULE_STATES, isAlwaysEnabledModule } from "@/lib/modules/types";

export interface ModulesConfig {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
}

export type FormModuleTarget = "order" | "study";

export interface FormModuleIntegration {
  moduleId: string;
  targets: FormModuleTarget[];
  fieldTypes: FieldType[];
  fieldNames?: string[];
  moduleSources?: string[];
  settingsHref?: string;
  summary: string;
}

export const FORM_MODULE_INTEGRATIONS: FormModuleIntegration[] = [
  {
    moduleId: "mixs-metadata",
    targets: ["study"],
    fieldTypes: ["mixs"],
    fieldNames: ["_mixs"],
    moduleSources: ["mixs-metadata"],
    summary: "Adds MIxS study and sample metadata collection.",
  },
  {
    moduleId: "funding-info",
    targets: ["study"],
    fieldTypes: ["funding"],
    fieldNames: ["_funding", "study_funding"],
    summary: "Adds structured grant and external funding fields.",
  },
  {
    moduleId: "billing-info",
    targets: ["order"],
    fieldTypes: ["billing"],
    summary: "Adds internal cost center and PSP collection for orders.",
  },
  {
    moduleId: "sequencing-tech",
    targets: ["order"],
    fieldTypes: ["sequencing-tech", "barcode"],
    fieldNames: ["_sequencing_tech", "_barcode"],
    moduleSources: ["sequencing-tech"],
    settingsHref: "/admin/sequencing-tech",
    summary: "Adds the sequencing technology selector, kit registry, and barcode-aware sample fields.",
  },
  {
    moduleId: "ena-sample-fields",
    targets: ["order"],
    fieldTypes: ["organism"],
    fieldNames: ["_organism", "sample_title", "sample_alias"],
    moduleSources: ["ena-sample-fields"],
    summary: "Adds ENA-oriented organism, sample title, and sample alias fields.",
  },
];

const FIELD_TYPE_TO_MODULE = new Map<FieldType, string>();
const FIELD_NAME_TO_MODULE = new Map<string, string>();
const FIELD_SOURCE_TO_MODULE = new Map<string, string>();

for (const integration of FORM_MODULE_INTEGRATIONS) {
  for (const fieldType of integration.fieldTypes) {
    FIELD_TYPE_TO_MODULE.set(fieldType, integration.moduleId);
  }
  for (const fieldName of integration.fieldNames || []) {
    FIELD_NAME_TO_MODULE.set(fieldName, integration.moduleId);
  }
  for (const moduleSource of integration.moduleSources || []) {
    FIELD_SOURCE_TO_MODULE.set(moduleSource, integration.moduleId);
  }
}

export function parseModulesConfig(configString: string | null): ModulesConfig {
  if (!configString) {
    return { modules: { ...DEFAULT_MODULE_STATES }, globalDisabled: false };
  }

  try {
    const parsed = JSON.parse(configString);
    if (parsed && typeof parsed.modules === "object" && !Array.isArray(parsed.modules)) {
      return {
        modules: { ...DEFAULT_MODULE_STATES, ...parsed.modules },
        globalDisabled: parsed.globalDisabled ?? false,
      };
    }

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return {
        modules: { ...DEFAULT_MODULE_STATES, ...parsed },
        globalDisabled: false,
      };
    }
  } catch {
    // Fall back to defaults below.
  }

  return { modules: { ...DEFAULT_MODULE_STATES }, globalDisabled: false };
}

export function isModuleEnabled(config: ModulesConfig, moduleId: string): boolean {
  if (isAlwaysEnabledModule(moduleId)) return true;
  if (config.globalDisabled) return false;
  return config.modules[moduleId] ?? false;
}

export function getFormModuleForField(
  field: Pick<FormFieldDefinition, "type" | "name" | "moduleSource">
): string | undefined {
  if (field.moduleSource && FIELD_SOURCE_TO_MODULE.has(field.moduleSource)) {
    return FIELD_SOURCE_TO_MODULE.get(field.moduleSource);
  }

  return FIELD_TYPE_TO_MODULE.get(field.type) || FIELD_NAME_TO_MODULE.get(field.name);
}

export function isFieldAvailableForModules(
  field: Pick<FormFieldDefinition, "type" | "name" | "moduleSource">,
  modulesConfig: ModulesConfig
): boolean {
  const moduleId = getFormModuleForField(field);
  return moduleId ? isModuleEnabled(modulesConfig, moduleId) : true;
}

export function filterFieldsByModules<T extends Pick<FormFieldDefinition, "type" | "name" | "moduleSource">>(
  fields: T[],
  modulesConfig: ModulesConfig
): T[] {
  return fields.filter((field) => isFieldAvailableForModules(field, modulesConfig));
}

export function getFormModuleIntegration(moduleId: string): FormModuleIntegration | undefined {
  return FORM_MODULE_INTEGRATIONS.find((integration) => integration.moduleId === moduleId);
}

export function hasModuleField(
  moduleId: string,
  fields: Pick<FormFieldDefinition, "type" | "name" | "moduleSource">[]
): boolean {
  return fields.some((field) => getFormModuleForField(field) === moduleId);
}
