import { describe, expect, it } from "vitest";
import {
  filterFieldsByModules,
  getFormModuleForField,
  hasModuleField,
  isFieldAvailableForModules,
  parseModulesConfig,
} from "./form-integration";
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
        label: "Sequencing Technology",
        name: "_sequencing_tech",
      })
    ).toBe("sequencing-tech");

    expect(
      getFormModuleForField({
        ...baseField,
        type: "text",
        label: "Sample Alias",
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
        label: "Sequencing Technology",
        name: "_sequencing_tech",
      }, config)
    ).toBe(true);
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
