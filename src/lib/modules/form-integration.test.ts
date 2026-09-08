import { describe, expect, it } from "vitest";
import {
  filterFieldsByModules,
  getFormModuleForField,
  hasModuleField,
  isFieldAvailableForModules,
  parseModulesConfig,
} from "./form-integration";
import { getDeploymentProfileDefinition } from "@/lib/deployment-profile/definitions";
import type { FormFieldDefinition } from "@/types/form-config";

const baseField = {
  id: "field",
  required: false,
  visible: true,
  order: 0,
} satisfies Pick<FormFieldDefinition, "id" | "required" | "visible" | "order">;

describe("form module integration", () => {
  it("maps special form fields to their owning modules", () => {
    expect(
      getFormModuleForField({
        ...baseField,
        type: "sequencing-tech",
        name: "_sequencing_tech",
      })
    ).toBe("sequencing-tech");

    expect(
      getFormModuleForField({
        ...baseField,
        type: "text",
        name: "sample_alias",
        moduleSource: "ena-sample-fields",
      })
    ).toBe("ena-sample-fields");
  });

  it("filters module-backed fields when their module is disabled", () => {
    const fields: FormFieldDefinition[] = [
      {
        ...baseField,
        type: "text",
        label: "Order Name",
        name: "name",
      },
      {
        ...baseField,
        id: "billing",
        type: "billing",
        label: "Billing",
        name: "_billing",
      },
    ];

    const config = parseModulesConfig(JSON.stringify({
      modules: { "billing-info": false },
    }));

    expect(isFieldAvailableForModules(fields[0], config)).toBe(true);
    expect(isFieldAvailableForModules(fields[1], config)).toBe(false);
    expect(filterFieldsByModules(fields, config).map((field) => field.name)).toEqual(["name"]);
  });

  it("keeps sequencing technology fields available as an always-on core registry", () => {
    const config = parseModulesConfig(JSON.stringify({
      modules: { "sequencing-tech": false },
      globalDisabled: true,
    }));

    expect(
      isFieldAvailableForModules({
        ...baseField,
        type: "sequencing-tech",
        name: "_sequencing_tech",
      }, config)
    ).toBe(true);
  });

  it("turns facility-only defaults and stored overrides off when their domains are unavailable", () => {
    const config = parseModulesConfig(
      JSON.stringify({
        modules: {
          "ai-validation": true,
          "billing-info": true,
          notifications: true,
        },
      }),
      {
        ...getDeploymentProfileDefinition("research-workbench"),
        domains: getDeploymentProfileDefinition("research-workbench").domains.filter(
          domain => domain !== "facility-intake" && domain !== "sequencing-operations"
        ),
      }
    );

    expect(config.modules["ai-validation"]).toBe(false);
    expect(config.modules["billing-info"]).toBe(false);
    expect(config.modules["sequencing-tech"]).toBe(false);
    expect(config.modules.notifications).toBe(true);
    expect(config.incompatibleModules).toEqual(
      expect.arrayContaining([
        "ai-validation",
        "billing-info",
        "sequencing-tech",
      ])
    );
    expect(isFieldAvailableForModules({
      ...baseField,
      type: "billing",
      name: "_billing",
    }, config)).toBe(false);
  });

  it("keeps imports and Reports available in the shared application research preset", () => {
    const config = parseModulesConfig(null, getDeploymentProfileDefinition("research-workbench"));
    expect(config.modules).toMatchObject({
      "sequencing-management": false, "import-cami": true, "import-sra": true, explore: true,
    });
  });

  it("detects whether a module has fields in a form schema", () => {
    const fields: FormFieldDefinition[] = [
      {
        ...baseField,
        id: "organism",
        type: "organism",
        label: "Organism",
        name: "_organism",
        perSample: true,
        moduleSource: "ena-sample-fields",
      },
    ];

    expect(hasModuleField("ena-sample-fields", fields)).toBe(true);
    expect(hasModuleField("billing-info", fields)).toBe(false);
  });
});
