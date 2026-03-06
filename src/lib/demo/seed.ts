import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

export function getDemoProjectsField(): FormFieldDefinition {
  return {
    id: "demo_projects",
    type: "textarea",
    label: "Projects",
    name: "_projects",
    required: false,
    visible: true,
    placeholder: "Gut recovery cohort\nTimepoint atlas",
    helpText:
      "Optional project labels for this order. Enter one project name per line.",
    order: 2,
    groupId: "group_details",
  };
}

export function addDemoProjectsFieldToSchema(schema: string): string {
  try {
    const parsed = JSON.parse(schema) as unknown;

    if (Array.isArray(parsed)) {
      const fields = parsed as FormFieldDefinition[];
      if (fields.some((field) => field.name === "_projects")) {
        return schema;
      }

      return JSON.stringify(
        [...fields, getDemoProjectsField()].sort((a, b) => a.order - b.order),
        null,
        2
      );
    }

    if (!parsed || typeof parsed !== "object") {
      return schema;
    }

    const typedSchema = parsed as {
      fields?: FormFieldDefinition[];
      groups?: FormFieldGroup[];
      version?: number;
    };
    const fields = Array.isArray(typedSchema.fields) ? typedSchema.fields : [];

    if (fields.some((field) => field.name === "_projects")) {
      return schema;
    }

    return JSON.stringify(
      {
        ...typedSchema,
        fields: [...fields, getDemoProjectsField()].sort((a, b) => a.order - b.order),
      },
      null,
      2
    );
  } catch {
    return schema;
  }
}

export function getDemoSiteSettingsUpdate(existingExtraSettings: string | null) {
  let parsedExtra: Record<string, unknown> = {};

  if (existingExtraSettings) {
    try {
      const candidate = JSON.parse(existingExtraSettings);
      if (candidate && typeof candidate === "object" && !Array.isArray(candidate)) {
        parsedExtra = candidate as Record<string, unknown>;
      }
    } catch {
      parsedExtra = {};
    }
  }

  return {
    siteName: "SeqDesk Demo",
    contactEmail: "demo@seqdesk.com",
    helpText:
      "This is a disposable researcher demo. Changes stay private to this browser session and can be reset at any time.",
    modulesConfig: JSON.stringify({
      modules: DEFAULT_MODULE_STATES,
      globalDisabled: false,
    }),
    extraSettings: JSON.stringify({
      ...parsedExtra,
      departmentSharing: false,
    }),
  };
}
