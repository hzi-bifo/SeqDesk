import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineConfig: {
      findUnique: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { mapPlatformForPipeline, validatePipelineMetadata } from "./metadata-validation";

describe("metadata-validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({ config: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue({ enaTestMode: false });
  });

  it("returns a study-not-found error when study does not exist", async () => {
    mocks.db.study.findUnique.mockResolvedValue(null);

    const result = await validatePipelineMetadata("study-1", "mag");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        field: "study",
        message: "Study not found",
        severity: "error",
      },
    ]);
  });

  it("returns no-samples error when study has no samples", async () => {
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      samples: [],
    });

    const result = await validatePipelineMetadata("study-1", "mag");

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        field: "samples",
        message: "No samples in study",
        severity: "error",
      },
    ]);
  });

  it("reports disallowed sequencing technology IDs for restricted runtime config", async () => {
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({
      config: JSON.stringify({
        runAt: "selected-technologies",
        allowedSequencingTechnologies: ["tech-illumina"],
      }),
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          checklistData: null,
          taxId: null,
          reads: [],
          assemblies: [],
          bins: [],
          order: {
            id: "order-1",
            platform: null,
            customFields: JSON.stringify({
              _sequencing_tech: {
                technologyId: "tech-nanopore",
                technologyName: "Oxford Nanopore",
              },
            }),
            instrumentModel: null,
            libraryStrategy: null,
            librarySelection: null,
            librarySource: null,
          },
        },
      ],
    });

    const result = await validatePipelineMetadata("study-1", "mag");

    const restrictionIssue = result.issues.find(
      (issue) => issue.field === "allowedSequencingTechnologies" && issue.severity === "error"
    );

    expect(restrictionIssue).toBeDefined();
    expect(restrictionIssue?.message).toContain("disallowed technology IDs: tech-nanopore");
    expect(result.valid).toBe(false);
  });

  it("emits warning when mag is restricted to selected technologies but none are configured", async () => {
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({
      config: JSON.stringify({
        runAt: "selected-technologies",
        allowedSequencingTechnologies: [],
      }),
    });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          checklistData: null,
          taxId: null,
          reads: [],
          assemblies: [],
          bins: [],
          order: {
            id: "order-1",
            platform: "Illumina",
            customFields: null,
            instrumentModel: "NovaSeq",
            libraryStrategy: "WGS",
            librarySelection: "RANDOM",
            librarySource: "METAGENOMIC",
          },
        },
      ],
    });

    const result = await validatePipelineMetadata("study-1", "mag");
    const warning = result.issues.find(
      (issue) => issue.field === "allowedSequencingTechnologies" && issue.severity === "warning"
    );

    expect(warning).toBeDefined();
    expect(warning?.message).toContain("none are selected");
    expect(result.valid).toBe(true);
  });
});

describe("mapPlatformForPipeline", () => {
  it("maps short-read platform aliases for mag", () => {
    expect(mapPlatformForPipeline("NovaSeq", "mag")).toBe("ILLUMINA");
    expect(mapPlatformForPipeline("ion_torrent", "mag")).toBe("ION_TORRENT");
  });

  it("rejects long-read platforms for mag", () => {
    expect(mapPlatformForPipeline("Oxford Nanopore", "mag")).toBeNull();
    expect(mapPlatformForPipeline("PacBio", "mag")).toBeNull();
  });

  it("passes through platform values for non-mag pipelines", () => {
    expect(mapPlatformForPipeline("Custom Platform", "submg")).toBe("Custom Platform");
  });
});
