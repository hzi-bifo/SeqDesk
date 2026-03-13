import { db } from "@/lib/db";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";
import {
  ensureStudyModuleDefaultFields,
  STUDY_FORM_DEFAULTS_VERSION,
} from "@/lib/modules/default-form-fields";
import {
  getFixedStudySections,
  normalizeStudyFormSchema,
} from "@/lib/studies/fixed-sections";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

export interface StudyModulesConfig {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
}

export interface LoadedStudyFormSchema {
  fields: FormFieldDefinition[];
  studyFields: FormFieldDefinition[];
  perSampleFields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  modules: {
    mixs: boolean;
    sampleAssociation: boolean;
    funding: boolean;
  };
}

interface LoadStudyFormSchemaOptions {
  isFacilityAdmin?: boolean;
  applyRoleFilter?: boolean;
  applyModuleFilter?: boolean;
}

export function parseStudyModulesConfig(configString: string | null): StudyModulesConfig {
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

export function isStudyModuleEnabled(
  config: StudyModulesConfig,
  moduleId: string
): boolean {
  if (config.globalDisabled) return false;
  return config.modules[moduleId] ?? false;
}

export function filterStudyFieldsByModules(
  fields: FormFieldDefinition[],
  modulesConfig: StudyModulesConfig
): FormFieldDefinition[] {
  return fields.filter((field) => {
    if (field.type === "mixs" && !isStudyModuleEnabled(modulesConfig, "mixs-metadata")) {
      return false;
    }
    if (field.type === "funding" && !isStudyModuleEnabled(modulesConfig, "funding-info")) {
      return false;
    }
    return true;
  });
}

export function filterStudyFieldsForRole(
  fields: FormFieldDefinition[],
  isFacilityAdmin: boolean
): FormFieldDefinition[] {
  return isFacilityAdmin ? fields : fields.filter((field) => !field.adminOnly);
}

export async function loadStudyFormSchema(
  options: LoadStudyFormSchemaOptions = {}
): Promise<LoadedStudyFormSchema> {
  const {
    isFacilityAdmin = false,
    applyRoleFilter = true,
    applyModuleFilter = true,
  } = options;

  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { extraSettings: true, modulesConfig: true },
  });
  const modulesConfig = parseStudyModulesConfig(settings?.modulesConfig ?? null);
  const fixedGroups = getFixedStudySections();

  let fields: FormFieldDefinition[] = [];
  let groups: FormFieldGroup[] = fixedGroups;
  let studyFormDefaultsVersion = 0;

  if (settings?.extraSettings) {
    try {
      const extra = JSON.parse(settings.extraSettings);
      fields = extra.studyFormFields || [];
      groups = extra.studyFormGroups || fixedGroups;
      studyFormDefaultsVersion =
        typeof extra.studyFormDefaultsVersion === "number"
          ? extra.studyFormDefaultsVersion
          : 0;
    } catch {
      fields = [];
      groups = fixedGroups;
    }
  }

  if (studyFormDefaultsVersion < STUDY_FORM_DEFAULTS_VERSION) {
    fields = ensureStudyModuleDefaultFields(fields, groups, {
      mixs: isStudyModuleEnabled(modulesConfig, "mixs-metadata"),
    });
  }

  const normalizedSchema = normalizeStudyFormSchema({
    fields,
    groups,
  });
  const moduleVisibleFields = filterStudyFieldsByModules(
    normalizedSchema.fields,
    modulesConfig
  );
  const filteredFields = filterStudyFieldsForRole(
    applyModuleFilter ? moduleVisibleFields : normalizedSchema.fields,
    applyRoleFilter ? isFacilityAdmin : true
  );

  const sortedFields = filteredFields.slice().sort((a, b) => a.order - b.order);
  const studyFields = sortedFields.filter(
    (field) => !field.perSample && field.name !== "_sample_association"
  );
  const perSampleFields = sortedFields.filter((field) => field.perSample);

  return {
    fields: sortedFields,
    studyFields,
    perSampleFields,
    groups: normalizedSchema.groups,
    modules: {
      mixs:
        isStudyModuleEnabled(modulesConfig, "mixs-metadata") &&
        moduleVisibleFields.some((field) => field.type === "mixs"),
      sampleAssociation: moduleVisibleFields.some(
        (field) => field.name === "_sample_association"
      ),
      funding:
        isStudyModuleEnabled(modulesConfig, "funding-info") &&
        moduleVisibleFields.some((field) => field.type === "funding"),
    },
  };
}
