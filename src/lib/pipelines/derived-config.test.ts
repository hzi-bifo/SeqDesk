import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    sample: {
      findMany: vi.fn(),
    },
  },
  registry: {
    metaxpath: {
      id: "metaxpath",
      name: "MetaxPath",
      configSchema: {
        properties: {
          sequencer: {
            type: "string",
            title: "Sequencing Mode",
            "x-seqdesk": {
              placement: "derived",
              derive: {
                source: "order.sequencingTechnology.platformFamily",
                map: {
                  "oxford-nanopore": "Nanopore",
                  "ont-minion": "Nanopore",
                  pacbio: "PacBio",
                  "pacbio-revio": "PacBio",
                },
                requireSingleValue: true,
              },
            },
          },
        },
      },
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/pipelines", () => ({
  PIPELINE_REGISTRY: mocks.registry,
}));

import {
  mergePipelineDerivedConfig,
  resolvePipelineDerivedConfig,
} from "./derived-config";

function sample(sampleId: string, sequencingTech: unknown) {
  return {
    id: sampleId.toLowerCase(),
    sampleId,
    order: {
      id: `order-${sampleId}`,
      orderNumber: `ORD-${sampleId}`,
      name: null,
      platform: null,
      customFields: JSON.stringify({
        _sequencing_tech: sequencingTech,
      }),
    },
  };
}

describe("pipeline derived config", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("derives Nanopore mode from Oxford Nanopore order technology", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      sample("S1", {
        technologyId: "ont-minion",
        technologyName: "MinION",
        platformFamily: "oxford-nanopore",
      }),
    ]);

    const result = await resolvePipelineDerivedConfig({
      pipelineId: "metaxpath",
      target: { type: "study", studyId: "study-1", sampleIds: ["s1"] },
    });

    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({ sequencer: "Nanopore" });
    expect(result.settings[0]?.message).toBe("MetaxPath will run in Nanopore mode.");
  });

  it("derives PacBio mode from PacBio order technology", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      sample("S1", {
        technologyId: "pacbio-revio",
        technologyName: "Revio",
        platformFamily: "pacbio",
      }),
    ]);

    const result = await resolvePipelineDerivedConfig({
      pipelineId: "metaxpath",
      target: { type: "order", orderId: "order-1" },
    });

    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({ sequencer: "PacBio" });
  });

  it("rejects mixed Nanopore and PacBio selected samples", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      sample("S1", { technologyId: "ont-minion", platformFamily: "oxford-nanopore" }),
      sample("S2", { technologyId: "pacbio-revio", platformFamily: "pacbio" }),
    ]);

    const result = await resolvePipelineDerivedConfig({
      pipelineId: "metaxpath",
      target: { type: "study", studyId: "study-1" },
    });

    expect(result.config).toEqual({});
    expect(result.issues).toEqual([
      expect.objectContaining({
        field: "sequencer",
        severity: "error",
        message: expect.stringContaining("mixed Sequencing Mode values"),
      }),
    ]);
  });

  it("rejects missing or unmapped order sequencing technology", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      sample("S1", { technologyId: "illumina-novaseq", platformFamily: "illumina" }),
    ]);

    const result = await resolvePipelineDerivedConfig({
      pipelineId: "metaxpath",
      target: { type: "study", studyId: "study-1" },
    });

    expect(result.config).toEqual({});
    expect(result.issues).toEqual([
      expect.objectContaining({
        field: "sequencer",
        severity: "error",
        message: expect.stringContaining("missing a supported Nanopore or PacBio technology"),
      }),
    ]);
  });

  it("overrides stale client config when merging derived values", async () => {
    mocks.db.sample.findMany.mockResolvedValue([
      sample("S1", { technologyId: "ont-minion", platformFamily: "oxford-nanopore" }),
    ]);

    const result = await mergePipelineDerivedConfig({
      pipelineId: "metaxpath",
      target: { type: "study", studyId: "study-1" },
      config: { sequencer: "PacBio", threads: 20 },
    });

    expect(result.issues).toEqual([]);
    expect(result.config).toEqual({ sequencer: "Nanopore", threads: 20 });
  });
});
