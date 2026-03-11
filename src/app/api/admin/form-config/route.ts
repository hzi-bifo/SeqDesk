import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  FormFieldDefinition,
  FormFieldGroup,
  DEFAULT_FORM_SCHEMA,
  DEFAULT_GROUPS,
} from "@/types/form-config";
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

// GET current form configuration
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
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
      return NextResponse.json({
        id: "singleton",
        fields: defaultFields,
        groups: DEFAULT_FORM_SCHEMA.groups,
        version: 1,
        enabledMixsChecklists: [],
      });
    }

    // Parse JSON fields and return
    const parsed = JSON.parse(config.schema);
    const moduleDefaultsVersion =
      Array.isArray(parsed) || typeof parsed.moduleDefaultsVersion !== "number"
        ? 0
        : parsed.moduleDefaultsVersion;
    const baseFields = Array.isArray(parsed) ? parsed : parsed.fields || [];
    const fields =
      moduleDefaultsVersion < ORDER_FORM_DEFAULTS_VERSION
        ? ensureOrderModuleDefaultFields(baseFields, {
            sequencingTech: isModuleEnabled(modulesConfig, "sequencing-tech"),
          })
        : baseFields;
    const groups = parsed.groups || DEFAULT_GROUPS;
    const enabledMixsChecklists = parsed.enabledMixsChecklists || [];
    return NextResponse.json({
      id: config.id,
      fields,
      groups,
      version: config.version,
      updatedAt: config.updatedAt,
      enabledMixsChecklists,
    });
  } catch (error) {
    console.error("Error fetching form config:", error);
    return NextResponse.json(
      { error: "Failed to fetch form configuration" },
      { status: 500 }
    );
  }
}

// PUT update form configuration
export async function PUT(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);

    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = await request.json();
    const { fields, groups, enabledMixsChecklists } = body as {
      fields?: FormFieldDefinition[];
      groups?: FormFieldGroup[];
      enabledMixsChecklists?: string[];
    };

    // Validate fields array
    if (fields && !Array.isArray(fields)) {
      return NextResponse.json(
        { error: "Fields must be an array" },
        { status: 400 }
      );
    }

    // Validate groups array
    if (groups && !Array.isArray(groups)) {
      return NextResponse.json(
        { error: "Groups must be an array" },
        { status: 400 }
      );
    }

    // Get existing config or create new one
    const existing = await db.orderFormConfig.findUnique({
      where: { id: "singleton" },
    });

    const newVersion = (existing?.version || 0) + 1;

    // Build schema object with fields, groups, and enabledMixsChecklists
    const schemaObj = {
      fields: fields || DEFAULT_FORM_SCHEMA.fields,
      groups: groups || DEFAULT_FORM_SCHEMA.groups,
      enabledMixsChecklists: enabledMixsChecklists || [],
      moduleDefaultsVersion: ORDER_FORM_DEFAULTS_VERSION,
    };

    // Note: coreFieldConfig column kept for backward compatibility but no longer used
    const config = await db.orderFormConfig.upsert({
      where: { id: "singleton" },
      update: {
        schema: JSON.stringify(schemaObj),
        coreFieldConfig: "{}", // Deprecated - kept for DB compatibility
        version: newVersion,
      },
      create: {
        id: "singleton",
        schema: JSON.stringify(schemaObj),
        coreFieldConfig: "{}", // Deprecated - kept for DB compatibility
        version: 1,
      },
    });

    const savedParsed = JSON.parse(config.schema);
    const savedFields = Array.isArray(savedParsed) ? savedParsed : savedParsed.fields || [];
    const savedGroups = savedParsed.groups || DEFAULT_GROUPS;
    const savedChecklists = savedParsed.enabledMixsChecklists || [];
    return NextResponse.json({
      id: config.id,
      fields: savedFields,
      groups: savedGroups,
      version: config.version,
      updatedAt: config.updatedAt,
      enabledMixsChecklists: savedChecklists,
    });
  } catch (error) {
    console.error("Error updating form config:", error);
    return NextResponse.json(
      { error: "Failed to update form configuration" },
      { status: 500 }
    );
  }
}
