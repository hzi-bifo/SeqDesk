import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_FORM_SCHEMA, type FormFieldDefinition } from "@/types/form-config";
import {
  ensureOrderModuleDefaultFields,
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

function filterFieldsForRole(
  fields: FormFieldDefinition[],
  isFacilityAdmin: boolean
): FormFieldDefinition[] {
  return isFacilityAdmin ? fields : fields.filter((field) => !field.adminOnly);
}

// GET form schema for order creation (public to authenticated users)
export async function GET() {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

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
      const filteredFields = filterFieldsForRole(
        filterFieldsByModules(defaultFields, modulesConfig),
        isFacilityAdmin
      );
      const perSampleFields = filteredFields.filter(
        (field) => field.perSample && field.visible
      );
      return NextResponse.json({
        fields: filteredFields,
        groups: getFixedOrderSections(),
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
    const perSampleFields = filteredFields.filter((field) =>
      field.perSample && field.visible
    );
    return NextResponse.json({
      fields: filteredFields,
      groups: normalizedSchema.groups,
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
