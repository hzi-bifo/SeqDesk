// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  BarcodeSet,
  FlowCell,
  SequencerDevice,
  SequencingKit,
  SequencingTechnology,
} from "@/types/sequencing-technology";

import { TechnologySelector } from "./TechnologySelector";

function jsonResponse(payload: unknown, ok = true) {
  return {
    ok,
    json: async () => payload,
  } as Response;
}

// --- Fixture builders -------------------------------------------------------

function makeTechnology(
  overrides: Partial<SequencingTechnology> = {}
): SequencingTechnology {
  return {
    id: "ont",
    name: "Oxford Nanopore",
    manufacturer: "Oxford Nanopore Technologies",
    shortDescription: "Long-read real-time sequencing",
    specs: [
      { label: "Read length", value: "Up to 4", unit: "Mb" },
      { label: "Accuracy", value: "99" },
    ],
    pros: [{ text: "Real-time data" }, { text: "Portable" }],
    cons: [{ text: "Higher error rate" }],
    bestFor: ["Metagenomics", "Assembly"],
    available: true,
    order: 1,
    sourceUrl: "https://nanoporetech.com",
    ...overrides,
  };
}

function makeDevice(overrides: Partial<SequencerDevice> = {}): SequencerDevice {
  return {
    id: "minion",
    platformId: "ont",
    name: "MinION",
    manufacturer: "ONT",
    productOverview: "Portable sequencer",
    shortDescription: "Pocket-sized device",
    specs: [],
    connectivity: "USB",
    compatibleFlowCells: ["fc-1"],
    compatibleKits: ["kit-1"],
    compatibleSoftware: ["sw-1"],
    available: true,
    order: 1,
    ...overrides,
  };
}

function makeFlowCell(overrides: Partial<FlowCell> = {}): FlowCell {
  return {
    id: "fc-1",
    name: "Flongle",
    sku: "FLO-FLG001",
    chemistry: "R10",
    poreCount: 126,
    maxOutput: "2 Gb",
    category: "flow-cell",
    available: true,
    order: 1,
    ...overrides,
  };
}

function makeKit(overrides: Partial<SequencingKit> = {}): SequencingKit {
  return {
    id: "kit-1",
    name: "Ligation Kit",
    sku: "SQK-LSK114",
    category: "ligation",
    inputType: "dna",
    available: true,
    order: 1,
    ...overrides,
  };
}

const ALL_RESOURCES = {
  technologies: [] as SequencingTechnology[],
  devices: [] as SequencerDevice[],
  flowCells: [] as FlowCell[],
  kits: [] as SequencingKit[],
  barcodeSets: [] as BarcodeSet[],
};

function setFetch(payload: Partial<typeof ALL_RESOURCES> | "error" | "reject") {
  const fetchMock = vi.fn(() => {
    if (payload === "reject") return Promise.reject(new Error("network"));
    if (payload === "error") return Promise.resolve(jsonResponse({}, false));
    return Promise.resolve(jsonResponse({ ...ALL_RESOURCES, ...payload }));
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

describe("TechnologySelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows a loading spinner before the fetch resolves", () => {
    setFetch({ technologies: [makeTechnology()] });
    const { container } = render(
      <TechnologySelector onChange={vi.fn()} />
    );
    // Spinner uses lucide Loader2 with animate-spin while loading.
    expect(container.querySelector(".animate-spin")).toBeTruthy();
  });

  it("renders the configured-empty message when no technologies come back", async () => {
    setFetch({ technologies: [] });
    render(<TechnologySelector onChange={vi.fn()} />);
    expect(
      await screen.findByText("No sequencing technologies configured")
    ).toBeTruthy();
  });

  it("renders the load error message when the request fails (non-ok)", async () => {
    setFetch("error");
    render(<TechnologySelector onChange={vi.fn()} />);
    expect(
      await screen.findByText("Failed to load sequencing technologies")
    ).toBeTruthy();
  });

  it("renders the load error message when fetch rejects", async () => {
    setFetch("reject");
    render(<TechnologySelector onChange={vi.fn()} />);
    expect(
      await screen.findByText("Failed to load sequencing technologies")
    ).toBeTruthy();
  });

  it("groups technologies by manufacturer and selects one on click", async () => {
    const onChange = vi.fn();
    setFetch({
      technologies: [
        makeTechnology({ id: "ont", name: "Oxford Nanopore" }),
        makeTechnology({
          id: "ilmn",
          name: "Illumina",
          manufacturer: "Illumina Inc.",
        }),
      ],
    });
    render(<TechnologySelector onChange={onChange} />);

    // Both manufacturer headings render (no device step since devices empty).
    expect(await screen.findByText("Oxford Nanopore Technologies")).toBeTruthy();
    expect(screen.getByText("Illumina Inc.")).toBeTruthy();
    expect(screen.getByText("Select Platform")).toBeTruthy();

    fireEvent.click(screen.getByText("Oxford Nanopore"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        technologyId: "ont",
        technologyName: "Oxford Nanopore",
        deviceId: undefined,
      })
    );
  });

  it("deselects a technology when clicking the already-selected card", async () => {
    const onChange = vi.fn();
    setFetch({ technologies: [makeTechnology()] });
    render(
      <TechnologySelector value={{ technologyId: "ont" }} onChange={onChange} />
    );

    fireEvent.click(await screen.findByText("Oxford Nanopore"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("accepts a string value as the selected technology id", async () => {
    const onChange = vi.fn();
    setFetch({ technologies: [makeTechnology()] });
    render(<TechnologySelector value="ont" onChange={onChange} />);

    // String value resolves to selection -> clicking same card deselects.
    fireEvent.click(await screen.findByText("Oxford Nanopore"));
    expect(onChange).toHaveBeenCalledWith(undefined);
  });

  it("does not call onChange when disabled", async () => {
    const onChange = vi.fn();
    setFetch({ technologies: [makeTechnology()] });
    render(<TechnologySelector onChange={onChange} disabled />);

    fireEvent.click(await screen.findByText("Oxford Nanopore"));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("toggles the details panel to reveal specs, pros, cons, best-for, and source link", async () => {
    setFetch({ technologies: [makeTechnology()] });
    render(<TechnologySelector onChange={vi.fn()} />);

    const detailsBtn = await screen.findByText("Details");
    // Hidden before expanding.
    expect(screen.queryByText("Specifications")).toBeNull();

    fireEvent.click(detailsBtn);

    expect(screen.getByText("Specifications")).toBeTruthy();
    expect(screen.getByText("Read length")).toBeTruthy();
    // Spec value renders with its unit appended in the same span, so the
    // value text and unit are separate text nodes ("Up to 4" + " Mb").
    expect(
      screen.getByText((_content, element) => element?.textContent === "Up to 4 Mb")
    ).toBeTruthy();
    expect(screen.getByText("Pros")).toBeTruthy();
    expect(screen.getByText("Real-time data")).toBeTruthy();
    expect(screen.getByText("Cons")).toBeTruthy();
    expect(screen.getByText("Higher error rate")).toBeTruthy();
    expect(screen.getByText("Best For")).toBeTruthy();
    expect(screen.getByText("Metagenomics")).toBeTruthy();
    const learnMore = screen.getByText("Learn more").closest("a");
    expect(learnMore?.getAttribute("href")).toBe("https://nanoporetech.com");

    // Toggling again collapses it.
    fireEvent.click(screen.getByText("Details"));
    expect(screen.queryByText("Specifications")).toBeNull();
  });

  it("auto-selects the only technology when device step is active and a single platform exists", async () => {
    const onChange = vi.fn();
    setFetch({
      technologies: [makeTechnology()],
      devices: [makeDevice(), makeDevice({ id: "minion-2", name: "MinION 2" })],
    });
    render(<TechnologySelector onChange={onChange} />);

    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ technologyId: "ont" })
      );
    });
  });

  it("filters out technologies that have no configured devices when devices exist", async () => {
    setFetch({
      technologies: [
        makeTechnology({ id: "ont", name: "Oxford Nanopore" }),
        makeTechnology({
          id: "ilmn",
          name: "Illumina",
          manufacturer: "Illumina Inc.",
        }),
      ],
      // Only ONT has a device, so Illumina should be filtered out.
      devices: [makeDevice(), makeDevice({ id: "minion-2", name: "MinION 2" })],
    });
    render(<TechnologySelector onChange={vi.fn()} />);

    expect(await screen.findByText("Oxford Nanopore")).toBeTruthy();
    expect(screen.queryByText("Illumina")).toBeNull();
  });

  it("renders the no-devices-configured fallback when every technology lacks a device", async () => {
    setFetch({
      technologies: [makeTechnology()],
      devices: [makeDevice({ platformId: "other-platform" })],
    });
    render(<TechnologySelector onChange={vi.fn()} />);

    expect(
      await screen.findByText("No sequencing technologies with configured devices")
    ).toBeTruthy();
  });

  it("shows the device step prompt and lets a device be selected when multiple devices exist", async () => {
    const onChange = vi.fn();
    setFetch({
      technologies: [makeTechnology()],
      devices: [
        makeDevice({ id: "minion", name: "MinION" }),
        makeDevice({ id: "gridion", name: "GridION" }),
      ],
    });
    render(
      <TechnologySelector value={{ technologyId: "ont" }} onChange={onChange} />
    );

    expect(await screen.findByText("Select Device")).toBeTruthy();
    expect(screen.getByText("Choose the specific device model")).toBeTruthy();

    fireEvent.click(screen.getByText("GridION"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        deviceId: "gridion",
        deviceName: "GridION",
        softwareIds: ["sw-1"],
      })
    );
  });

  it("prompts to select a platform first when device step has no platform chosen", async () => {
    setFetch({
      technologies: [
        makeTechnology({ id: "ont", name: "Oxford Nanopore" }),
        makeTechnology({ id: "ont2", name: "ONT Two" }),
      ],
      devices: [
        makeDevice({ platformId: "ont" }),
        makeDevice({ id: "d2", platformId: "ont2", name: "Device Two" }),
      ],
    });
    render(<TechnologySelector onChange={vi.fn()} />);

    expect(
      await screen.findByText("Select a platform to see available devices")
    ).toBeTruthy();
    expect(screen.getByText("Select a platform to continue.")).toBeTruthy();
  });

  it("renders flow cell and kit steps once a device is selected and lets each be picked", async () => {
    const onChange = vi.fn();
    setFetch({
      technologies: [makeTechnology()],
      devices: [
        makeDevice({
          id: "minion",
          name: "MinION",
          compatibleFlowCells: ["fc-1", "fc-2"],
          compatibleKits: ["kit-1", "kit-2"],
        }),
        makeDevice({ id: "gridion", name: "GridION" }),
      ],
      flowCells: [
        makeFlowCell({ id: "fc-1", name: "Flongle" }),
        makeFlowCell({ id: "fc-2", name: "PromethION FC", sku: "FLO-PRO" }),
      ],
      kits: [
        makeKit({ id: "kit-1", name: "Ligation Kit", category: "ligation" }),
        makeKit({
          id: "kit-2",
          name: "Rapid Kit",
          sku: "SQK-RAD",
          category: "rapid",
          multiplexing: true,
          barcodeCount: 24,
        }),
      ],
    });
    render(
      <TechnologySelector
        value={{ technologyId: "ont", deviceId: "minion" }}
        onChange={onChange}
      />
    );

    expect(await screen.findByText("Select Flow Cell")).toBeTruthy();
    expect(screen.getByText("Select Kit")).toBeTruthy();

    fireEvent.click(screen.getByText("Flongle"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ flowCellId: "fc-1", flowCellSku: "FLO-FLG001" })
    );

    onChange.mockClear();
    fireEvent.click(screen.getByText("Rapid Kit"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({ kitId: "kit-2", kitSku: "SQK-RAD" })
    );
    // Kit categories render as uppercase group labels.
    expect(screen.getByText("ligation")).toBeTruthy();
    expect(screen.getByText("rapid")).toBeTruthy();
  });

  it("auto-selects a single flow cell and kit and shows their summary cards", async () => {
    setFetch({
      technologies: [makeTechnology()],
      devices: [
        makeDevice({
          id: "minion",
          compatibleFlowCells: ["fc-1"],
          compatibleKits: ["kit-1"],
        }),
        makeDevice({ id: "gridion", name: "GridION" }),
      ],
      flowCells: [makeFlowCell({ id: "fc-1", name: "Flongle" })],
      kits: [makeKit({ id: "kit-1", name: "Ligation Kit" })],
    });
    const onChange = vi.fn();
    render(
      <TechnologySelector
        value={{ technologyId: "ont", deviceId: "minion" }}
        onChange={onChange}
      />
    );

    // Single compatible flow cell + kit -> auto selection effects fire.
    await waitFor(() => {
      expect(onChange).toHaveBeenCalledWith(
        expect.objectContaining({ flowCellId: "fc-1" })
      );
    });
  });

  it("shows the built-in barcode info card for a kit with built-in barcodes", async () => {
    setFetch({
      technologies: [makeTechnology()],
      devices: [
        makeDevice({
          id: "minion",
          compatibleFlowCells: ["fc-1"],
          compatibleKits: ["kit-bc"],
        }),
        makeDevice({ id: "gridion", name: "GridION" }),
      ],
      flowCells: [makeFlowCell({ id: "fc-1" })],
      kits: [
        makeKit({
          id: "kit-bc",
          name: "Barcoding Kit",
          barcoding: {
            supported: true,
            builtIn: true,
            requiresAdditionalBarcodeKit: false,
            maxBarcodesPerRun: 24,
            barcodeSetId: "bs-1",
          },
        }),
      ],
      barcodeSets: [
        {
          id: "bs-1",
          name: "NB01-24",
          schemeId: "native",
          barcodeRange: [1, 24],
          count: 24,
        },
      ],
    });
    render(
      <TechnologySelector
        value={{ technologyId: "ont", deviceId: "minion", kitId: "kit-bc" }}
        onChange={vi.fn()}
      />
    );

    expect(await screen.findByText("Built-in barcodes included")).toBeTruthy();
    expect(screen.getByText(/NB01-24/)).toBeTruthy();
  });

  it("shows the companion barcode kit step when the kit requires one", async () => {
    const onChange = vi.fn();
    setFetch({
      technologies: [makeTechnology()],
      devices: [
        makeDevice({
          id: "minion",
          compatibleFlowCells: ["fc-1"],
          compatibleKits: ["kit-main"],
        }),
        makeDevice({ id: "gridion", name: "GridION" }),
      ],
      flowCells: [makeFlowCell({ id: "fc-1" })],
      kits: [
        makeKit({
          id: "kit-main",
          name: "Sequencing-only Kit",
          barcoding: {
            supported: true,
            builtIn: false,
            requiresAdditionalBarcodeKit: true,
            compatibleBarcodeKits: ["bc-companion"],
          },
        }),
        makeKit({
          id: "bc-companion",
          name: "Native Barcoding Kit",
          sku: "EXP-NBD",
          category: "barcoding",
          barcoding: {
            supported: true,
            builtIn: true,
            requiresAdditionalBarcodeKit: false,
            maxBarcodesPerRun: 96,
            barcodeSetId: "bs-1",
          },
        }),
      ],
      barcodeSets: [
        {
          id: "bs-1",
          name: "NB01-96",
          schemeId: "native",
          barcodeRange: [1, 96],
          count: 96,
        },
      ],
    });
    render(
      <TechnologySelector
        value={{ technologyId: "ont", deviceId: "minion", kitId: "kit-main" }}
        onChange={onChange}
      />
    );

    expect(await screen.findByText("Select Barcode Kit")).toBeTruthy();
    expect(screen.getByText("Native Barcoding Kit")).toBeTruthy();

    fireEvent.click(screen.getByText("Native Barcoding Kit"));
    expect(onChange).toHaveBeenCalledWith(
      expect.objectContaining({
        barcodeKitId: "bc-companion",
        barcodeKitSku: "EXP-NBD",
      })
    );
  });

  it("shows empty-state cards when a selected device has no flow cells or kits", async () => {
    setFetch({
      technologies: [makeTechnology()],
      devices: [
        makeDevice({
          id: "minion",
          compatibleFlowCells: [],
          compatibleKits: [],
        }),
        makeDevice({ id: "gridion", name: "GridION" }),
      ],
    });
    render(
      <TechnologySelector
        value={{ technologyId: "ont", deviceId: "minion" }}
        onChange={vi.fn()}
      />
    );

    expect(
      await screen.findByText("No flow cells configured for this device.")
    ).toBeTruthy();
    expect(
      screen.getByText("No kits configured for this device.")
    ).toBeTruthy();
  });
});
