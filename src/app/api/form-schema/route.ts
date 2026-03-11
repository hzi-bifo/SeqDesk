import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_FORM_SCHEMA, DEFAULT_GROUPS, type FormFieldDefinition } from "@/types/form-config";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";
import {
  ensureOrderModuleDefaultFields,
  ORDER_FORM_DEFAULTS_VERSION,
} from "@/lib/modules/default-form-fields";

interface ModulesConfig {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
}

function parseModulesConfig(configString: string | null): ModulesConfig {
  if (!configString) {
    return { modules: DEFAULT_MODULE_STATES, globalDisabled: false };
  }

  try {
    const parsed = JSON.parse(configString);
    if (typeof parsed.modules === "object") {
      return {
        modules: { ...DEFAULT_MODULE_STATES, ...parsed.modules },
        globalDisabled: parsed.globalDisabled ?? false,
      };
    }

    return {
      modules: { ...DEFAULT_MODULE_STATES, ...parsed },
      globalDisabled: false,
    };
  } catch {
    return { modules: DEFAULT_MODULE_STATES, globalDisabled: false };
  }
}

function isModuleEnabled(config: ModulesConfig, moduleId: string): boolean {
  if (config.globalDisabled) return false;
  return config.modules[moduleId] ?? false;
}

function filterFieldsByModules(
  fields: FormFieldDefinition[],
  modulesConfig: ModulesConfig
): FormFieldDefinition[] {
  return fields.filter((field) => {
    if (field.type === "mixs" && !isModuleEnabled(modulesConfig, "mixs-metadata")) {
      return false;
    }
    if (field.type === "funding" && !isModuleEnabled(modulesConfig, "funding-info")) {
      return false;
    }
    if (field.type === "billing" && !isModuleEnabled(modulesConfig, "billing-info")) {
      return false;
    }
    if (
      field.type === "sequencing-tech" &&
      !isModuleEnabled(modulesConfig, "sequencing-tech")
    ) {
      return false;
    }
    if (
      field.moduleSource === "ena-sample-fields" &&
      !isModuleEnabled(modulesConfig, "ena-sample-fields")
    ) {
      return false;
    }

    return true;
  });
}

// GET form schema for order creation (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const [config, siteSettings] = await Promise.all([
      db.orderFormConfig.findUnique({
        where: { id: "singleton" },
      }),
      db.siteSettings.findUnique({
        where: { id: "singleton" },
        select: { modulesConfig: true },
      }),
    ]);
    const modulesConfig = parseModulesConfig(siteSettings?.modulesConfig ?? null);

    // If no config exists, return default system fields and groups
    if (!config) {
      const defaultFields = ensureOrderModuleDefaultFields(DEFAULT_FORM_SCHEMA.fields, {
        sequencingTech: isModuleEnabled(modulesConfig, "sequencing-tech"),
      });
      const filteredFields = filterFieldsByModules(defaultFields, modulesConfig);
      const perSampleFields = filteredFields.filter(
        (field) => field.perSample && field.visible
      );
      return NextResponse.json({
        fields: filteredFields,
        groups: DEFAULT_FORM_SCHEMA.groups,
        version: 1,
        enabledMixsChecklists: [],
        perSampleFields,
      });
    }

    // Parse JSON fields and return
    const parsed = JSON.parse(config.schema);
    const moduleDefaultsVersion =
      Array.isArray(parsed) || typeof parsed.moduleDefaultsVersion !== "number"
        ? 0
        : parsed.moduleDefaultsVersion;
    const baseFields = (Array.isArray(parsed) ? parsed : parsed.fields || []) as FormFieldDefinition[];
    const fields =
      moduleDefaultsVersion < ORDER_FORM_DEFAULTS_VERSION
        ? ensureOrderModuleDefaultFields(baseFields, {
            sequencingTech: isModuleEnabled(modulesConfig, "sequencing-tech"),
          })
        : baseFields;
    const filteredFields = filterFieldsByModules(fields, modulesConfig);
    const groups = parsed.groups || DEFAULT_GROUPS;
    const enabledMixsChecklists = isModuleEnabled(modulesConfig, "mixs-metadata")
      ? parsed.enabledMixsChecklists || []
      : [];
    const perSampleFields = filteredFields.filter((field) =>
      field.perSample && field.visible
    );
    return NextResponse.json({
      fields: filteredFields,
      groups,
      version: config.version,
      enabledMixsChecklists,
      perSampleFields,
    });
  } catch (error) {
    console.error("Error fetching form schema:", error);
    return NextResponse.json(
      { error: "Failed to fetch form schema" },
      { status: 500 }
    );
  }
}
