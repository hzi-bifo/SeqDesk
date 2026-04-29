import { db } from "@/lib/db";
import {
  ensureStudyModuleDefaultFields,
  STUDY_FORM_DEFAULTS_VERSION,
} from "@/lib/modules/default-form-fields";
import {
  filterFieldsByModules,
  isModuleEnabled,
  parseModulesConfig,
  type ModulesConfig,
} from "@/lib/modules/form-integration";
import {
  getFixedStudySections,
  normalizeStudyFormSchema,
} from "@/lib/studies/fixed-sections";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

export type StudyModulesConfig = ModulesConfig;

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

export const parseStudyModulesConfig = parseModulesConfig;

export function isStudyModuleEnabled(
  config: StudyModulesConfig,
  moduleId: string
): boolean {
  return isModuleEnabled(config, moduleId);
}

export function filterStudyFieldsByModules(
  fields: FormFieldDefinition[],
  modulesConfig: StudyModulesConfig
): FormFieldDefinition[] {
  return filterFieldsByModules(fields, modulesConfig);
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
