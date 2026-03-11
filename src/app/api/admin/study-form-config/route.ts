import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";
import {
  ensureStudyModuleDefaultFields,
  STUDY_FORM_DEFAULTS_VERSION,
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

// GET - retrieve study form configuration
export async function GET() {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true, modulesConfig: true },
    });

    if (!settings?.extraSettings) {
      return NextResponse.json({ fields: [], groups: [] });
    }

    const extra = JSON.parse(settings.extraSettings);
    const groups = extra.studyFormGroups || [];
    const fields =
      typeof extra.studyFormDefaultsVersion === "number" &&
      extra.studyFormDefaultsVersion >= STUDY_FORM_DEFAULTS_VERSION
        ? extra.studyFormFields || []
        : ensureStudyModuleDefaultFields(extra.studyFormFields || [], groups, {
            mixs: isModuleEnabled(
              parseModulesConfig(settings.modulesConfig ?? null),
              "mixs-metadata"
            ),
          });
    return NextResponse.json({
      fields,
      groups,
    });
  } catch {
    return NextResponse.json({ fields: [], groups: [] });
  }
}

// PUT - update study form configuration
export async function PUT(request: NextRequest) {
  const session = await getServerSession(authOptions);

  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await request.json();
    const { fields, groups } = body as {
      fields: FormFieldDefinition[];
      groups: FormFieldGroup[];
    };

    // Get current settings
    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
    });

    let extraSettings: Record<string, unknown> = {};
    if (settings?.extraSettings) {
      try {
        extraSettings = JSON.parse(settings.extraSettings);
      } catch {
        extraSettings = {};
      }
    }

    // Update study form config
    extraSettings.studyFormFields = fields || [];
    extraSettings.studyFormGroups = groups || [];
    extraSettings.studyFormDefaultsVersion = STUDY_FORM_DEFAULTS_VERSION;

    // Upsert the settings
    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: { extraSettings: JSON.stringify(extraSettings) },
      create: {
        id: "singleton",
        extraSettings: JSON.stringify(extraSettings),
      },
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("[Study Form Config] Error updating:", error);
    return NextResponse.json({ error: "Failed to save configuration" }, { status: 500 });
  }
}
