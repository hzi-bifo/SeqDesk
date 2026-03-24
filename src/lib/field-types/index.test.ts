import { beforeEach, describe, expect, it, vi } from "vitest";

async function loadFieldTypeIndex() {
  vi.resetModules();
  return import("./index");
}

describe("field type registry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("registers plugins and exposes them through the registry helpers", async () => {
    const {
      getAllFieldTypes,
      getFieldType,
      isFieldTypeRegistered,
      registerFieldType,
    } = await loadFieldTypeIndex();

    const textPlugin = {
      type: "custom-text",
      label: "Custom Text",
      defaultConfig: {
        type: "text",
        label: "Custom Text",
        name: "customText",
      },
    };

    registerFieldType(textPlugin);

    expect(isFieldTypeRegistered("custom-text")).toBe(true);
    expect(getFieldType("custom-text")).toEqual(textPlugin);
    expect(getAllFieldTypes()).toEqual([textPlugin]);
  });

  it("separates standard and special field types", async () => {
    const {
      getSpecialFieldTypes,
      getStandardFieldTypes,
      registerFieldType,
    } = await loadFieldTypeIndex();

    registerFieldType({
      type: "text-like",
      label: "Text-like",
      defaultConfig: { type: "text", name: "textLike" },
    });
    registerFieldType({
      type: "special-metadata",
      label: "Special Metadata",
      isSpecial: true,
      defaultConfig: { type: "text", name: "specialMetadata" },
    });

    expect(getStandardFieldTypes().map((plugin) => plugin.type)).toEqual([
      "text-like",
    ]);
    expect(getSpecialFieldTypes().map((plugin) => plugin.type)).toEqual([
      "special-metadata",
    ]);
  });

  it("warns when a plugin type is overwritten and keeps the latest plugin", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const { getFieldType, registerFieldType } = await loadFieldTypeIndex();

    registerFieldType({
      type: "duplicate",
      label: "Original",
      defaultConfig: { type: "text", name: "duplicate" },
    });
    registerFieldType({
      type: "duplicate",
      label: "Replacement",
      defaultConfig: { type: "text", name: "duplicate" },
    });

    expect(warnSpy).toHaveBeenCalledWith(
      'Field type "duplicate" is already registered. Overwriting.'
    );
    expect(getFieldType("duplicate")?.label).toBe("Replacement");
  });
});
