import { db } from "@/lib/db";
import {
  DEFAULT_FORM_SCHEMA,
  type FormFieldDefinition,
  type FormFieldGroup,
} from "@/types/form-config";
import {
  ensureOrderModuleDefaultFields,
  isLegacyPlatformField,
  ORDER_FORM_DEFAULTS_VERSION,
} from "@/lib/modules/default-form-fields";
import {
  filterFieldsByModules,
  isModuleEnabled,
  parseModulesConfig,
} from "@/lib/modules/form-integration";
import {
  getFixedOrderSections,
  normalizeOrderFormSchema,
} from "@/lib/orders/fixed-sections";

export interface LoadedOrderFormSchema {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  version: number;
  enabledMixsChecklists: string[];
  perSampleFields: FormFieldDefinition[];
}

function filterFieldsForRole(
  fields: FormFieldDefinition[],
  isFacilityAdmin: boolean
): FormFieldDefinition[] {
  return isFacilityAdmin ? fields : fields.filter((field) => !field.adminOnly);
}

/**
 * Load the (global, singleton) Sequencing Order form schema: the full field list,
 * groups, and the role/module-filtered per-sample fields whose values are stored in
 * `Sample.customFields`. Extracted from /api/form-schema so the order-creation route
 * and other surfaces (e.g. the study Table Overview) resolve order columns the same way.
 */
export async function loadOrderFormSchema(
  options: { isFacilityAdmin?: boolean } = {}
): Promise<LoadedOrderFormSchema> {
  const { isFacilityAdmin = false } = options;

  const [config, siteSettings] = await Promise.all([
    db.orderFormConfig.findUnique({ where: { id: "singleton" } }),
    db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { modulesConfig: true },
    }),
  ]);
  const modulesConfig = parseModulesConfig(siteSettings?.modulesConfig ?? null);

  // No saved config yet — fall back to the default system fields.
  if (!config) {
    const defaultFields = ensureOrderModuleDefaultFields(DEFAULT_FORM_SCHEMA.fields, {
      sequencingTech: isModuleEnabled(modulesConfig, "sequencing-tech"),
    });
    const filteredFields = filterFieldsForRole(
      filterFieldsByModules(defaultFields, modulesConfig),
      isFacilityAdmin
    );
    return {
      fields: filteredFields,
      groups: getFixedOrderSections(),
      version: 1,
      enabledMixsChecklists: [],
      perSampleFields: filteredFields.filter(
        (field) => field.perSample && field.visible
      ),
    };
  }

  const parsed = JSON.parse(config.schema);
  const moduleDefaultsVersion =
    Array.isArray(parsed) || typeof parsed.moduleDefaultsVersion !== "number"
      ? 0
      : parsed.moduleDefaultsVersion;
  const baseFields = (
    (Array.isArray(parsed) ? parsed : parsed.fields || []) as FormFieldDefinition[]
  ).filter((field) => !isLegacyPlatformField(field));
  const fields =
    moduleDefaultsVersion < ORDER_FORM_DEFAULTS_VERSION
      ? ensureOrderModuleDefaultFields(baseFields, {
          sequencingTech: isModuleEnabled(modulesConfig, "sequencing-tech"),
        })
      : baseFields;
  const normalizedSchema = normalizeOrderFormSchema({
    fields,
    groups: Array.isArray(parsed) ? undefined : parsed.groups,
  });
  const filteredFields = filterFieldsForRole(
    filterFieldsByModules(normalizedSchema.fields, modulesConfig),
    isFacilityAdmin
  );
  const enabledMixsChecklists = isModuleEnabled(modulesConfig, "mixs-metadata")
    ? parsed.enabledMixsChecklists || []
    : [];

  return {
    fields: filteredFields,
    groups: normalizedSchema.groups,
    version: config.version,
    enabledMixsChecklists,
    perSampleFields: filteredFields.filter(
      (field) => field.perSample && field.visible
    ),
  };
}
