import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

function makeTechnology(overrides: Record<string, unknown> = {}) {
  return {
    id: "tech-1",
    name: "Tech 1",
    manufacturer: "Acme",
    shortDescription: "Short description",
    specs: [],
    pros: [],
    cons: [],
    bestFor: [],
    available: true,
    order: 1,
    ...overrides,
  };
}

function makeDevice(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    platformId: "tech-1",
    name: id,
    manufacturer: "Acme",
    productOverview: "Overview",
    shortDescription: "Device",
    specs: [],
    compatibleFlowCells: [],
    compatibleKits: [],
    compatibleSoftware: [],
    available: true,
    order: 1,
    ...overrides,
  };
}

function makeFlowCell(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    sku: id.toUpperCase(),
    category: "flow-cell",
    available: true,
    order: 1,
    ...overrides,
  };
}

function makeKit(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    sku: id.toUpperCase(),
    category: "kit",
    available: true,
    order: 1,
    ...overrides,
  };
}

function makeSoftware(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    category: "software",
    available: true,
    order: 1,
    ...overrides,
  };
}

describe("sequencing-tech config", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
    vi.doUnmock("fs");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.doUnmock("fs");
  });

  it("normalizes missing arrays and resolves relative asset URLs against the registry origin", async () => {
    const { normalizeTechConfig, withResolvedTechAssetUrls } = await import("./config");

    const normalized = normalizeTechConfig({
      technologies: [makeTechnology()],
      version: 4,
    } as never);

    expect(normalized.devices).toEqual([]);
    expect(normalized.flowCells).toEqual([]);
    expect(normalized.kits).toEqual([]);
    expect(normalized.software).toEqual([]);
    expect(normalized.barcodeSchemes).toEqual([]);
    expect(normalized.barcodeSets).toEqual([]);

    const resolved = withResolvedTechAssetUrls(
      {
        technologies: [makeTechnology({ icon: "/icons/tech-1.svg" })],
        devices: [makeDevice("device-1", { image: "devices/device-1.png" })],
        flowCells: [makeFlowCell("flow-1", { image: "flowcells/flow-1.png" })],
        kits: [makeKit("kit-1", { image: "https://cdn.example.org/kit.png" })],
        version: 4,
      } as never,
      "https://registry.example.org/api/registry/sequencing-tech"
    );

    expect(resolved.syncUrl).toBe(
      "https://registry.example.org/api/registry/sequencing-tech"
    );
    expect(resolved.technologies[0].icon).toBe(
      "https://registry.example.org/icons/tech-1.svg"
    );
    expect(resolved.devices?.[0].image).toBe(
      "https://registry.example.org/devices/device-1.png"
    );
    expect(resolved.flowCells?.[0].image).toBe(
      "https://registry.example.org/flowcells/flow-1.png"
    );
    expect(resolved.kits?.[0].image).toBe("https://cdn.example.org/kit.png");
  });

  it("parses object and JSON config inputs and falls back to defaults on invalid input", async () => {
    const { parseTechConfig } = await import("./config");

    const fromObject = parseTechConfig({
      technologies: [makeTechnology({ id: "object-tech" })],
      version: 9,
    });
    expect(fromObject.technologies[0].id).toBe("object-tech");
    expect(fromObject.version).toBe(9);

    const fromString = parseTechConfig(
      JSON.stringify({
        technologies: [makeTechnology({ id: "string-tech" })],
        version: 12,
      })
    );
    expect(fromString.technologies[0].id).toBe("string-tech");
    expect(fromString.version).toBe(12);

    const invalid = parseTechConfig("{not-json");
    expect(invalid.technologies).toEqual([]);
    expect(invalid.version).toBe(1);
  });

  it("loads local defaults, merges device files, and warns on duplicates or parse failures", async () => {
    vi.stubEnv("SEQDESK_USE_LOCAL_TECH_DEFAULTS", "true");

    const mockFs = {
      existsSync: vi.fn((filePath: string) =>
        filePath.includes("data/sequencing-devices")
      ),
      readdirSync: vi.fn(() => ["nanopore.json", "duplicate.json", "broken.json"]),
      readFileSync: vi.fn((filePath: string) => {
        if (filePath.endsWith("defaults.json")) {
          return JSON.stringify({
            technologies: [makeTechnology()],
            devices: [makeDevice("base-device", { productOverview: "Base device" })],
            version: 7,
          });
        }
        if (filePath.endsWith("nanopore.json")) {
          return JSON.stringify({
            platformId: "tech-1",
            devices: [makeDevice("device-1", { productOverview: "Primary device" })],
            flowCells: [makeFlowCell("flow-1")],
            kits: [makeKit("kit-1")],
            software: [makeSoftware("software-1")],
          });
        }
        if (filePath.endsWith("duplicate.json")) {
          return JSON.stringify({
            platformId: "tech-1",
            devices: [makeDevice("device-1", { productOverview: "Override device" })],
          });
        }
        throw new Error(`cannot parse ${filePath}`);
      }),
    };

    vi.doMock("fs", () => ({
      default: mockFs,
      ...mockFs,
    }));

    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { loadDefaultTechConfig } = await import("./config");
    const config = loadDefaultTechConfig();

    expect(config.version).toBe(7);
    expect(config.devices?.map((device) => device.id)).toEqual([
      "base-device",
      "device-1",
    ]);
    expect(
      config.devices?.find((device) => device.id === "device-1")?.productOverview
    ).toBe("Override device");
    expect(config.flowCells?.map((flowCell) => flowCell.id)).toEqual(["flow-1"]);
    expect(config.kits?.map((kit) => kit.id)).toEqual(["kit-1"]);
    expect(config.software?.map((software) => software.id)).toEqual(["software-1"]);
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes("Duplicate device id 'device-1'")
      )
    ).toBe(true);
    expect(
      warnSpy.mock.calls.some(([message]) =>
        String(message).includes("Failed to parse sequencing devices file")
      )
    ).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
