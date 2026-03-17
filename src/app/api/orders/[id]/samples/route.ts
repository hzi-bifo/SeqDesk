import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { DEFAULT_FORM_SCHEMA, type FormFieldDefinition } from "@/types/form-config";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";
import {
  ensureOrderModuleDefaultFields,
  ORDER_FORM_DEFAULTS_VERSION,
} from "@/lib/modules/default-form-fields";
import { normalizeOrderFormSchema } from "@/lib/orders/fixed-sections";
import { mapPerSampleFieldToColumn, type CoreSampleColumn } from "@/lib/sample-fields";

interface ModulesConfig {
  modules: Record<string, boolean>;
  globalDisabled: boolean;
}

const sampleSelect = {
  id: true,
  sampleId: true,
  sampleAlias: true,
  sampleTitle: true,
  sampleDescription: true,
  scientificName: true,
  taxId: true,
  checklistData: true,
  checklistUnits: true,
  customFields: true,
} as const;

interface SampleRecord {
  id: string;
  sampleId: string;
  sampleAlias: string | null;
  sampleTitle: string | null;
  sampleDescription: string | null;
  scientificName: string | null;
  taxId: string | null;
  checklistData: string | null;
  checklistUnits: string | null;
  customFields: string | null;
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

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value);
    if (typeof parsed === "object" && parsed !== null && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>;
    }
  } catch {
    // Ignore malformed JSON and fall back to an empty object.
  }

  return {};
}

function isEmptyFieldValue(value: unknown): boolean {
  return (
    value === undefined ||
    value === null ||
    value === "" ||
    (Array.isArray(value) && value.length === 0)
  );
}

function parseSampleCollection(
  samples: SampleRecord[]
) {
  return samples.map((sample) => ({
    ...sample,
    checklistData: sample.checklistData ? JSON.parse(sample.checklistData) : {},
    checklistUnits: sample.checklistUnits ? JSON.parse(sample.checklistUnits) : {},
    customFields: sample.customFields ? JSON.parse(sample.customFields) : {},
  }));
}

async function getAdminOnlyPerSampleFields(): Promise<FormFieldDefinition[]> {
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

  if (!config) {
    const defaultFields = ensureOrderModuleDefaultFields(DEFAULT_FORM_SCHEMA.fields, {
      sequencingTech: isModuleEnabled(modulesConfig, "sequencing-tech"),
    });
    return filterFieldsByModules(defaultFields, modulesConfig).filter(
      (field) => field.visible && field.perSample && field.adminOnly
    );
  }

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

  return filterFieldsByModules(normalizedSchema.fields, modulesConfig).filter(
    (field) => field.visible && field.perSample && field.adminOnly
  );
}

// GET samples for an order (also returns sampleset config)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    // Check order exists and user has access, include sampleset
    const order = await db.order.findUnique({
      where: { id },
      select: {
        userId: true,
        sampleset: {
          select: {
            checklists: true,
            selectedFields: true,
          },
        },
      },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!isFacilityAdmin && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const samples = await db.sample.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      select: sampleSelect,
    });

    const samplesWithParsedData = parseSampleCollection(samples);

    // Parse sampleset checklists
    const checklist = order.sampleset?.checklists
      ? JSON.parse(order.sampleset.checklists)
      : null;

    return NextResponse.json({
      samples: samplesWithParsedData,
      checklist: Array.isArray(checklist) ? checklist[0] : checklist,
    });
  } catch (error) {
    console.error("Error fetching samples:", error);
    return NextResponse.json(
      { error: "Failed to fetch samples" },
      { status: 500 }
    );
  }
}

// POST create/update/delete samples (bulk operation)
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await getServerSession(authOptions);

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const { id } = await params;
    const isFacilityAdmin = session.user.role === "FACILITY_ADMIN";

    // Check order exists and user has access
    const order = await db.order.findUnique({
      where: { id },
      select: { userId: true, status: true },
    });

    if (!order) {
      return NextResponse.json({ error: "Order not found" }, { status: 404 });
    }

    if (!isFacilityAdmin && order.userId !== session.user.id) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { samples, checklist, facilityFieldsOnly } = body;

    if (!Array.isArray(samples)) {
      return NextResponse.json(
        { error: "Samples must be an array" },
        { status: 400 }
      );
    }

    if (facilityFieldsOnly) {
      if (!isFacilityAdmin) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      const adminOnlyPerSampleFields = await getAdminOnlyPerSampleFields();
      const editableColumnNames = new Set<CoreSampleColumn>(
        adminOnlyPerSampleFields
          .map((field) => mapPerSampleFieldToColumn(field.name))
          .filter((value): value is CoreSampleColumn => Boolean(value))
      );
      const editableCustomFieldNames = new Set(
        adminOnlyPerSampleFields
          .filter((field) => !mapPerSampleFieldToColumn(field.name))
          .map((field) => field.name)
      );
      const existingSamples = await db.sample.findMany({
        where: { orderId: id },
        select: {
          id: true,
          customFields: true,
        },
      });
      const existingSamplesById = new Map(existingSamples.map((sample) => [sample.id, sample]));

      for (const sample of samples) {
        if (!sample.id || sample.isDeleted || sample.isNew) {
          return NextResponse.json(
            { error: "Facility sample edits can only update existing samples" },
            { status: 400 }
          );
        }

        const existingSample = existingSamplesById.get(sample.id);
        if (!existingSample) {
          return NextResponse.json(
            { error: "Sample not found on this order" },
            { status: 404 }
          );
        }

        const data: Partial<Record<CoreSampleColumn, string | null>> & {
          customFields?: string | null;
        } = {};
        const customFields = parseJsonObject(existingSample.customFields);
        const incomingCustomFields =
          typeof sample.customFields === "object" && sample.customFields !== null
            ? sample.customFields as Record<string, unknown>
            : {};

        for (const fieldName of editableCustomFieldNames) {
          if (!(fieldName in incomingCustomFields)) continue;
          const value = incomingCustomFields[fieldName];
          if (isEmptyFieldValue(value)) {
            delete customFields[fieldName];
          } else {
            customFields[fieldName] = value;
          }
        }

        for (const columnName of editableColumnNames) {
          if (!(columnName in sample)) continue;
          const value = sample[columnName];
          data[columnName] =
            typeof value === "string" && value.trim()
              ? value.trim()
              : null;
        }

        if (editableCustomFieldNames.size > 0) {
          data.customFields =
            Object.keys(customFields).length > 0 ? JSON.stringify(customFields) : null;
        }

        if (Object.keys(data).length === 0) {
          continue;
        }

        await db.sample.update({
          where: { id: sample.id },
          data,
          select: sampleSelect,
        });
      }

      const allSamples = await db.sample.findMany({
        where: { orderId: id },
        orderBy: { createdAt: "asc" },
        select: sampleSelect,
      });

      return NextResponse.json({ samples: parseSampleCollection(allSamples) });
    }

    // Only allow editing in DRAFT status
    if (order.status !== "DRAFT") {
      return NextResponse.json(
        { error: "Cannot modify samples after order submission" },
        { status: 400 }
      );
    }

    // Update or create Sampleset with selected checklist
    if (checklist) {
      await db.sampleset.upsert({
        where: { orderId: id },
        update: {
          checklists: JSON.stringify([checklist]),
        },
        create: {
          orderId: id,
          checklists: JSON.stringify([checklist]),
        },
      });
    }

    // Process samples
    const results = [];

    for (const sample of samples) {
      // Prepare JSON fields
      const checklistDataJson = sample.checklistData
        ? JSON.stringify(sample.checklistData)
        : null;
      const checklistUnitsJson = sample.checklistUnits
        ? JSON.stringify(sample.checklistUnits)
        : null;
      const customFieldsJson = sample.customFields
        ? JSON.stringify(sample.customFields)
        : null;

      if (sample.isDeleted && sample.id) {
        // Delete existing sample
        await db.sample.delete({
          where: { id: sample.id },
        });
      } else if (sample.isNew) {
        // Create new sample
        const newSample = await db.sample.create({
          data: {
            sampleId: sample.sampleId.trim(),
            sampleAlias: sample.sampleAlias?.trim() || null,
            sampleTitle: sample.sampleTitle?.trim() || null,
            sampleDescription: sample.sampleDescription?.trim() || null,
            scientificName: sample.scientificName?.trim() || null,
            taxId: sample.taxId?.trim() || null,
            checklistData: checklistDataJson,
            checklistUnits: checklistUnitsJson,
            customFields: customFieldsJson,
            orderId: id,
          },
          select: sampleSelect,
        });
        results.push(newSample);
      } else if (sample.id) {
        // Update existing sample
        const updatedSample = await db.sample.update({
          where: { id: sample.id },
          data: {
            sampleId: sample.sampleId.trim(),
            sampleAlias: sample.sampleAlias?.trim() || null,
            sampleTitle: sample.sampleTitle?.trim() || null,
            sampleDescription: sample.sampleDescription?.trim() || null,
            scientificName: sample.scientificName?.trim() || null,
            taxId: sample.taxId?.trim() || null,
            checklistData: checklistDataJson,
            checklistUnits: checklistUnitsJson,
            customFields: customFieldsJson,
          },
          select: sampleSelect,
        });
        results.push(updatedSample);
      }
    }

    // Return all current samples with parsed JSON fields
    const allSamples = await db.sample.findMany({
      where: { orderId: id },
      orderBy: { createdAt: "asc" },
      select: sampleSelect,
    });

    const samplesWithParsedData = parseSampleCollection(allSamples);

    // Update order's numberOfSamples to match actual count
    await db.order.update({
      where: { id },
      data: { numberOfSamples: allSamples.length },
    });

    return NextResponse.json({ samples: samplesWithParsedData });
  } catch (error) {
    console.error("Error saving samples:", error);
    return NextResponse.json(
      { error: "Failed to save samples" },
      { status: 500 }
    );
  }
}
