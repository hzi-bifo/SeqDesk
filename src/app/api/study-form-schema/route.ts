import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";
import {
  ensureStudyModuleDefaultFields,
  STUDY_FORM_DEFAULTS_VERSION,
} from "@/lib/modules/default-form-fields";

// Default study form groups
const DEFAULT_STUDY_GROUPS: FormFieldGroup[] = [
  { id: "group_study_info", name: "Study Information", order: 0 },
  { id: "group_metadata", name: "Metadata", order: 1 },
];

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

// GET study form schema (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { extraSettings: true, modulesConfig: true },
    });
    const modulesConfig = parseModulesConfig(settings?.modulesConfig ?? null);
    const mixsModuleEnabled = isModuleEnabled(modulesConfig, "mixs-metadata");
    const fundingModuleEnabled = isModuleEnabled(modulesConfig, "funding-info");

    // Parse configuration
    let fields: FormFieldDefinition[] = [];
    let groups: FormFieldGroup[] = DEFAULT_STUDY_GROUPS;
    let studyFormDefaultsVersion = 0;

    if (settings?.extraSettings) {
      try {
        const extra = JSON.parse(settings.extraSettings);
        fields = extra.studyFormFields || [];
        groups = extra.studyFormGroups || DEFAULT_STUDY_GROUPS;
        studyFormDefaultsVersion =
          typeof extra.studyFormDefaultsVersion === "number"
            ? extra.studyFormDefaultsVersion
            : 0;
      } catch {
        // Use defaults on parse error
      }
    }

    if (studyFormDefaultsVersion < STUDY_FORM_DEFAULTS_VERSION) {
      fields = ensureStudyModuleDefaultFields(fields, groups, {
        mixs: mixsModuleEnabled,
      });
    }

    const filteredFields = fields.filter((field) => {
      if (field.type === "mixs" && !mixsModuleEnabled) {
        return false;
      }
      if (field.type === "funding" && !fundingModuleEnabled) {
        return false;
      }
      return true;
    });

    // Determine which modules are enabled and configured
    const hasMixsModule = mixsModuleEnabled && filteredFields.some((f) => f.type === "mixs");
    const hasSampleAssociation = filteredFields.some((f) => f.name === "_sample_association");
    const hasFundingModule = fundingModuleEnabled && filteredFields.some((f) => f.type === "funding");

    // Separate study-level fields from per-sample fields
    const studyFields = filteredFields.filter((f) => !f.perSample && f.name !== "_sample_association");
    const perSampleFields = filteredFields.filter((f) => f.perSample);

    // Return configuration
    return NextResponse.json({
      fields: filteredFields,
      studyFields,
      perSampleFields,
      groups,
      modules: {
        mixs: hasMixsModule,
        sampleAssociation: hasSampleAssociation,
        funding: hasFundingModule,
      },
    });
  } catch (error) {
    console.error("Error fetching study form schema:", error);
    return NextResponse.json(
      { error: "Failed to fetch study form schema" },
      { status: 500 }
    );
  }
}
