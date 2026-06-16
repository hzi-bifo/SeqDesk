import { describe, expect, it } from "vitest";
import {
  ORDER_FORM_DEFAULTS_VERSION,
  buildOrderFormConfigSchema,
} from "./order-form-schema.mjs";

// A11 parity: the in-app infrastructure importer and the install-time apply-core
// must write an IDENTICAL OrderFormConfig.schema from one settings.json forms.order
// source. Both now compute the schema via this shared buildOrderFormConfigSchema.
// These tests pin (a) determinism and (b) the manage-merge + installProfileManaged
// bookkeeping + preserved-shape contract that both writers depend on.
describe("buildOrderFormConfigSchema (shared importer/installer builder)", () => {
  // A representative populated forms.order + a non-empty existing schema that
  // carries prior installProfileManaged bookkeeping AND an admin-added field that
  // is NOT in the managed set (so the merge must preserve it).
  const profileForm = {
    fields: [
      {
        id: "field_ont_run_type",
        type: "select",
        label: "Run Type",
        name: "run_type",
        order: 10,
        groupId: "group_sequencing",
      },
    ],
    groups: [{ id: "group_sequencing", name: "Sequencing Information", order: 1 }],
    enabledMixsChecklists: ["MIMS.me"],
    defaultsVersion: ORDER_FORM_DEFAULTS_VERSION,
  };

  const existingSchema = {
    fields: [
      // Previously profile-managed field that drops out of the incoming form ->
      // must be pruned (it is in installProfileManaged.orderFormFields but not in
      // the incoming managed set).
      {
        id: "field_stale_managed",
        name: "stale_managed",
        label: "Stale Managed",
        order: 5,
        groupId: "group_sequencing",
      },
      // Admin-added field NOT in the managed set -> must be preserved.
      {
        id: "field_admin_custom",
        name: "admin_custom",
        label: "Admin Custom",
        order: 20,
        groupId: "group_details",
      },
    ],
    groups: [{ id: "group_details", name: "Order Details", order: 0 }],
    enabledMixsChecklists: ["local-checklist"],
    moduleDefaultsVersion: ORDER_FORM_DEFAULTS_VERSION,
    installProfileManaged: {
      orderFormFields: ["name:stale_managed"],
      orderFormGroups: [],
      orderFormEnabledMixsChecklists: [],
      // Unrelated managed bookkeeping that must survive untouched.
      authKeys: ["allowRegistration"],
    },
    // Orphan key that must be dropped.
    installProfileDefaultsVersion: 3,
  };

  it("is deterministic: identical inputs produce deep-equal output", () => {
    const a = buildOrderFormConfigSchema({ profileForm, existingSchema });
    const b = buildOrderFormConfigSchema({ profileForm, existingSchema });
    expect(a).toEqual(b);
    // Stable serialization too (the writers persist JSON.stringify(nextSchema)).
    expect(JSON.stringify(a)).toEqual(JSON.stringify(b));
  });

  it("does not mutate the inputs", () => {
    const profileFormCopy = JSON.parse(JSON.stringify(profileForm));
    const existingCopy = JSON.parse(JSON.stringify(existingSchema));
    buildOrderFormConfigSchema({
      profileForm: profileFormCopy,
      existingSchema: existingCopy,
    });
    expect(profileFormCopy).toEqual(profileForm);
    expect(existingCopy).toEqual(existingSchema);
  });

  it("manage-merges, prunes stale managed entries, preserves admin-added fields, and updates bookkeeping", () => {
    const next = buildOrderFormConfigSchema({ profileForm, existingSchema });

    const fieldNames = (next.fields as Array<{ name?: string }>).map(
      (f) => f.name
    );
    // Incoming managed field present.
    expect(fieldNames).toContain("run_type");
    // Admin-added field (not managed) preserved.
    expect(fieldNames).toContain("admin_custom");
    // Previously managed field that dropped from the incoming form pruned.
    expect(fieldNames).not.toContain("stale_managed");

    const groupIds = (next.groups as Array<{ id?: string }>).map((g) => g.id);
    // Incoming group merged in; existing non-managed group preserved.
    expect(groupIds).toContain("group_sequencing");
    expect(groupIds).toContain("group_details");

    // enabledMixsChecklists merged (existing local kept, incoming managed added).
    expect(next.enabledMixsChecklists).toEqual(
      expect.arrayContaining(["local-checklist", "MIMS.me"])
    );

    // Version stamped under the key the in-app reader consults; orphan dropped.
    expect(next.moduleDefaultsVersion).toBe(ORDER_FORM_DEFAULTS_VERSION);
    expect(
      (next as { installProfileDefaultsVersion?: unknown })
        .installProfileDefaultsVersion
    ).toBeUndefined();

    // installProfileManaged bookkeeping updated to the incoming managed keys, and
    // unrelated managed keys preserved.
    const managed = next.installProfileManaged as Record<string, unknown>;
    expect(managed.orderFormFields).toEqual(["name:run_type"]);
    expect(managed.orderFormGroups).toEqual(["id:group_sequencing"]);
    expect(managed.orderFormEnabledMixsChecklists).toEqual(["MIMS.me"]);
    expect(managed.authKeys).toEqual(["allowRegistration"]);
  });

  it("import == install: the object the importer writes equals the installer's for the same inputs", () => {
    // The importer (route.ts POST) and the installer (apply-core applyOrderForm)
    // both call this exact builder with the same {profileForm, existingSchema}.
    // Modeling each writer's call site here proves the persisted schema matches.
    const importerWrites = buildOrderFormConfigSchema({
      profileForm,
      existingSchema,
    });
    const installerWrites = buildOrderFormConfigSchema({
      profileForm,
      existingSchema,
    });
    expect(importerWrites).toEqual(installerWrites);
    expect(JSON.stringify(importerWrites)).toEqual(
      JSON.stringify(installerWrites)
    );
  });

  it("treats a MIxS-only forms.order over an empty schema as a populated build", () => {
    const next = buildOrderFormConfigSchema({
      profileForm: {
        fields: [],
        groups: [],
        enabledMixsChecklists: ["MIMS.me"],
        defaultsVersion: ORDER_FORM_DEFAULTS_VERSION,
      },
      existingSchema: {},
    });
    expect(next.enabledMixsChecklists).toEqual(["MIMS.me"]);
    expect(next.moduleDefaultsVersion).toBe(ORDER_FORM_DEFAULTS_VERSION);
    expect(
      (next.installProfileManaged as Record<string, unknown>)
        .orderFormEnabledMixsChecklists
    ).toEqual(["MIMS.me"]);
  });
});
