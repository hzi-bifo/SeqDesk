import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  getFixedStudySections: vi.fn(),
  normalizeStudyFormSchema: vi.fn(),
  ensureStudyModuleDefaultFields: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/studies/fixed-sections", () => ({
  getFixedStudySections: mocks.getFixedStudySections,
  normalizeStudyFormSchema: mocks.normalizeStudyFormSchema,
}));

vi.mock("@/lib/modules/default-form-fields", () => ({
  ensureStudyModuleDefaultFields: mocks.ensureStudyModuleDefaultFields,
  STUDY_FORM_DEFAULTS_VERSION: 1,
}));

import {
  parseStudyModulesConfig,
  isStudyModuleEnabled,
  filterStudyFieldsByModules,
  filterStudyFieldsForRole,
  loadStudyFormSchema,
} from "./schema";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

function makeField(overrides: Partial<FormFieldDefinition> = {}): FormFieldDefinition {
  return {
    id: "field_1",
    type: "text",
    label: "Test",
    name: "test",
    required: false,
    visible: true,
    order: 0,
    ...overrides,
  };
}

describe("parseStudyModulesConfig", () => {
  it("returns defaults when configString is null", () => {
    const result = parseStudyModulesConfig(null);
    expect(result).toEqual({ modules: DEFAULT_MODULE_STATES, globalDisabled: false });
  });

  it("returns defaults when configString is empty string", () => {
    const result = parseStudyModulesConfig("");
    expect(result).toEqual({ modules: DEFAULT_MODULE_STATES, globalDisabled: false });
  });

  it("returns defaults when configString is invalid JSON", () => {
    const result = parseStudyModulesConfig("{not valid json}");
    expect(result).toEqual({ modules: DEFAULT_MODULE_STATES, globalDisabled: false });
  });

  it("parses new format with modules object and globalDisabled", () => {
    const config = JSON.stringify({
      modules: { "funding-info": true },
      globalDisabled: true,
    });
    const result = parseStudyModulesConfig(config);
    expect(result.modules["funding-info"]).toBe(true);
    expect(result.globalDisabled).toBe(true);
    // defaults are merged in
    expect(result.modules["ai-validation"]).toBe(DEFAULT_MODULE_STATES["ai-validation"]);
  });

  it("parses new format and defaults globalDisabled to false when missing", () => {
    const config = JSON.stringify({
      modules: { "funding-info": true },
    });
    const result = parseStudyModulesConfig(config);
    expect(result.globalDisabled).toBe(false);
  });

  it("parses legacy flat format (no modules wrapper)", () => {
    const config = JSON.stringify({ "funding-info": true, "mixs-metadata": false });
    const result = parseStudyModulesConfig(config);
    expect(result.modules["funding-info"]).toBe(true);
    expect(result.modules["mixs-metadata"]).toBe(false);
    expect(result.globalDisabled).toBe(false);
    // defaults are still merged
    expect(result.modules["ai-validation"]).toBe(DEFAULT_MODULE_STATES["ai-validation"]);
  });
});

describe("isStudyModuleEnabled", () => {
  it("returns false when globalDisabled is true, regardless of module state", () => {
    const config = { modules: { "funding-info": true }, globalDisabled: true };
    expect(isStudyModuleEnabled(config, "funding-info")).toBe(false);
  });

  it("returns true when module is enabled and not globally disabled", () => {
    const config = { modules: { "funding-info": true }, globalDisabled: false };
    expect(isStudyModuleEnabled(config, "funding-info")).toBe(true);
  });

  it("returns false when module is explicitly disabled", () => {
    const config = { modules: { "funding-info": false }, globalDisabled: false };
    expect(isStudyModuleEnabled(config, "funding-info")).toBe(false);
  });

  it("returns false when module key does not exist", () => {
    const config = { modules: {}, globalDisabled: false };
    expect(isStudyModuleEnabled(config, "nonexistent-module")).toBe(false);
  });
});

describe("filterStudyFieldsByModules", () => {
  const enabledConfig = { modules: { "mixs-metadata": true, "funding-info": true }, globalDisabled: false };
  const disabledConfig = { modules: { "mixs-metadata": false, "funding-info": false }, globalDisabled: false };

  it("keeps mixs fields when mixs-metadata module is enabled", () => {
    const fields = [makeField({ type: "mixs", name: "_mixs" })];
    const result = filterStudyFieldsByModules(fields, enabledConfig);
    expect(result).toHaveLength(1);
  });

  it("removes mixs fields when mixs-metadata module is disabled", () => {
    const fields = [makeField({ type: "mixs", name: "_mixs" })];
    const result = filterStudyFieldsByModules(fields, disabledConfig);
    expect(result).toHaveLength(0);
  });

  it("keeps funding fields when funding-info module is enabled", () => {
    const fields = [makeField({ type: "funding", name: "study_funding" })];
    const result = filterStudyFieldsByModules(fields, enabledConfig);
    expect(result).toHaveLength(1);
  });

  it("removes funding fields when funding-info module is disabled", () => {
    const fields = [makeField({ type: "funding", name: "study_funding" })];
    const result = filterStudyFieldsByModules(fields, disabledConfig);
    expect(result).toHaveLength(0);
  });

  it("keeps non-module fields regardless of module config", () => {
    const fields = [
      makeField({ type: "text", name: "description" }),
      makeField({ type: "select", name: "category" }),
    ];
    const result = filterStudyFieldsByModules(fields, disabledConfig);
    expect(result).toHaveLength(2);
  });

  it("filters a mix of module and non-module fields correctly", () => {
    const fields = [
      makeField({ type: "text", name: "title", order: 0 }),
      makeField({ type: "mixs", name: "_mixs", order: 1 }),
      makeField({ type: "funding", name: "study_funding", order: 2 }),
      makeField({ type: "text", name: "notes", order: 3 }),
    ];
    const result = filterStudyFieldsByModules(fields, disabledConfig);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.name)).toEqual(["title", "notes"]);
  });

  it("removes mixs and funding fields when globalDisabled is true", () => {
    const globalDisabledConfig = { modules: { "mixs-metadata": true, "funding-info": true }, globalDisabled: true };
    const fields = [
      makeField({ type: "mixs", name: "_mixs" }),
      makeField({ type: "funding", name: "study_funding" }),
      makeField({ type: "text", name: "title" }),
    ];
    const result = filterStudyFieldsByModules(fields, globalDisabledConfig);
    // globalDisabled causes isStudyModuleEnabled to return false
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe("title");
  });
});

describe("filterStudyFieldsForRole", () => {
  it("returns all fields for facility admin", () => {
    const fields = [
      makeField({ adminOnly: true, name: "admin_field" }),
      makeField({ adminOnly: false, name: "user_field" }),
      makeField({ name: "no_flag" }), // adminOnly undefined
    ];
    const result = filterStudyFieldsForRole(fields, true);
    expect(result).toHaveLength(3);
  });

  it("filters out adminOnly fields for non-admin users", () => {
    const fields = [
      makeField({ adminOnly: true, name: "admin_field" }),
      makeField({ adminOnly: false, name: "user_field" }),
      makeField({ name: "no_flag" }),
    ];
    const result = filterStudyFieldsForRole(fields, false);
    expect(result).toHaveLength(2);
    expect(result.map((f) => f.name)).toEqual(["user_field", "no_flag"]);
  });

  it("returns empty array when all fields are adminOnly for non-admin", () => {
    const fields = [makeField({ adminOnly: true })];
    const result = filterStudyFieldsForRole(fields, false);
    expect(result).toHaveLength(0);
  });
});

describe("loadStudyFormSchema", () => {
  const fixedGroups: FormFieldGroup[] = [
    { id: "group_study_info", name: "Study Information", order: 0 },
    { id: "group_metadata", name: "Metadata", order: 1 },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getFixedStudySections.mockReturnValue(fixedGroups);
    mocks.ensureStudyModuleDefaultFields.mockImplementation((fields: FormFieldDefinition[]) => fields);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uses defaults when no settings exist", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    const normalizedFields = [
      makeField({ type: "text", name: "title", order: 0 }),
    ];
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: normalizedFields,
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.fields).toHaveLength(1);
    expect(result.groups).toEqual(fixedGroups);
    expect(mocks.ensureStudyModuleDefaultFields).toHaveBeenCalled();
  });

  it("parses extraSettings JSON and uses stored fields and groups", async () => {
    const storedFields = [makeField({ name: "stored_field", order: 0 })];
    const storedGroups = [{ id: "custom_group", name: "Custom", order: 0 }];
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        studyFormFields: storedFields,
        studyFormGroups: storedGroups,
        studyFormDefaultsVersion: 1,
      }),
      modulesConfig: null,
    });
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: storedFields,
      groups: storedGroups,
    });

    const result = await loadStudyFormSchema();
    // version matches STUDY_FORM_DEFAULTS_VERSION (1), so ensureStudyModuleDefaultFields should NOT be called
    expect(mocks.ensureStudyModuleDefaultFields).not.toHaveBeenCalled();
    expect(mocks.normalizeStudyFormSchema).toHaveBeenCalledWith({
      fields: storedFields,
      groups: storedGroups,
    });
  });

  it("falls back to empty fields when extraSettings is invalid JSON", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: "not json",
      modulesConfig: null,
    });
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(mocks.normalizeStudyFormSchema).toHaveBeenCalledWith({
      fields: [],
      groups: fixedGroups,
    });
  });

  it("calls ensureStudyModuleDefaultFields when stored version is below current", async () => {
    const storedFields = [makeField({ name: "old_field", order: 0 })];
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: JSON.stringify({
        studyFormFields: storedFields,
        studyFormDefaultsVersion: 0,
      }),
      modulesConfig: null,
    });
    mocks.ensureStudyModuleDefaultFields.mockReturnValueOnce(storedFields);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: storedFields,
      groups: fixedGroups,
    });

    await loadStudyFormSchema();
    expect(mocks.ensureStudyModuleDefaultFields).toHaveBeenCalled();
  });

  it("separates study fields from perSample fields and excludes _sample_association", async () => {
    const fields = [
      makeField({ name: "title", order: 1, perSample: false }),
      makeField({ name: "sample_name", order: 2, perSample: true }),
      makeField({ name: "_sample_association", order: 0, perSample: false }),
    ];
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields,
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.studyFields.map((f) => f.name)).toEqual(["title"]);
    expect(result.perSampleFields.map((f) => f.name)).toEqual(["sample_name"]);
    // _sample_association is excluded from studyFields but included in sorted fields
    expect(result.fields).toHaveLength(3);
  });

  it("sorts fields by order", async () => {
    const fields = [
      makeField({ name: "c", order: 3 }),
      makeField({ name: "a", order: 1 }),
      makeField({ name: "b", order: 2 }),
    ];
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields,
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.fields.map((f) => f.name)).toEqual(["a", "b", "c"]);
  });

  it("skips module filter when applyModuleFilter is false", async () => {
    const mixsField = makeField({ type: "mixs", name: "_mixs", order: 0 });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: null,
      modulesConfig: JSON.stringify({ modules: { "mixs-metadata": false } }),
    });
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [mixsField],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema({ applyModuleFilter: false });
    // mixs field should be present since module filter is skipped
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe("_mixs");
  });

  it("skips role filter when applyRoleFilter is false", async () => {
    const adminField = makeField({ adminOnly: true, name: "admin_only", order: 0 });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [adminField],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema({ applyRoleFilter: false });
    // adminOnly field should be present since role filter is skipped (treated as admin)
    expect(result.fields).toHaveLength(1);
  });

  it("filters adminOnly fields when isFacilityAdmin is false and applyRoleFilter is true", async () => {
    const adminField = makeField({ adminOnly: true, name: "admin_only", order: 0 });
    const userField = makeField({ name: "user_field", order: 1 });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [adminField, userField],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema({ isFacilityAdmin: false, applyRoleFilter: true });
    expect(result.fields).toHaveLength(1);
    expect(result.fields[0].name).toBe("user_field");
  });

  it("includes adminOnly fields when isFacilityAdmin is true", async () => {
    const adminField = makeField({ adminOnly: true, name: "admin_only", order: 0 });
    const userField = makeField({ name: "user_field", order: 1 });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [adminField, userField],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema({ isFacilityAdmin: true, applyRoleFilter: true });
    expect(result.fields).toHaveLength(2);
  });

  it("populates modules.mixs correctly based on config and field presence", async () => {
    const mixsField = makeField({ type: "mixs", name: "_mixs", order: 0 });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: null,
      modulesConfig: JSON.stringify({ modules: { "mixs-metadata": true, "funding-info": false } }),
    });
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [mixsField],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.modules.mixs).toBe(true);
    expect(result.modules.funding).toBe(false);
  });

  it("sets modules.mixs to false when module is enabled but no mixs field exists", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: null,
      modulesConfig: JSON.stringify({ modules: { "mixs-metadata": true } }),
    });
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [makeField({ type: "text", name: "title", order: 0 })],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.modules.mixs).toBe(false);
  });

  it("populates modules.sampleAssociation when _sample_association field exists", async () => {
    const saField = makeField({ name: "_sample_association", type: "text", order: 0 });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [saField],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.modules.sampleAssociation).toBe(true);
  });

  it("sets modules.sampleAssociation to false when no _sample_association field", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce(null);
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [makeField({ name: "title", order: 0 })],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.modules.sampleAssociation).toBe(false);
  });

  it("populates modules.funding correctly", async () => {
    const fundingField = makeField({ type: "funding", name: "study_funding", order: 0 });
    mocks.db.siteSettings.findUnique.mockResolvedValueOnce({
      extraSettings: null,
      modulesConfig: JSON.stringify({ modules: { "funding-info": true } }),
    });
    mocks.normalizeStudyFormSchema.mockReturnValueOnce({
      fields: [fundingField],
      groups: fixedGroups,
    });

    const result = await loadStudyFormSchema();
    expect(result.modules.funding).toBe(true);
  });
});
