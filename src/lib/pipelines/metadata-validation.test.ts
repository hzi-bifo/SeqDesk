import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    pipelineConfig: {
      findUnique: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
    order: {
      findUnique: vi.fn(),
    },
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  getPackage: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackage: mocks.getPackage,
}));

import { mapPlatformForPipeline, validatePipelineMetadata } from "./metadata-validation";

describe("metadata-validation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({ config: null });
    mocks.db.siteSettings.findUnique.mockResolvedValue({ enaTestMode: false });
    mocks.getPackage.mockReturnValue(null);
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

  it("returns an order-not-found error when the order target does not exist", async () => {
    mocks.db.order.findUnique.mockResolvedValue(null);

    const result = await validatePipelineMetadata(
      { type: "order", orderId: "order-1" },
      "fastq-checksum"
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        field: "order",
        message: "Order not found",
        severity: "error",
      },
    ]);
  });

  it("rejects order targets for packages with required study-scoped inputs", async () => {
    mocks.getPackage.mockReturnValue({
      manifest: {
        inputs: [
          {
            id: "study-accession",
            scope: "study",
            source: "study.studyAccessionId",
            required: true,
          },
        ],
      },
    });
    mocks.db.order.findUnique.mockResolvedValue({
      id: "order-1",
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
            instrumentModel: null,
            libraryStrategy: null,
            librarySelection: null,
            librarySource: null,
          },
        },
      ],
    });

    const result = await validatePipelineMetadata(
      { type: "order", orderId: "order-1" },
      "study-bound"
    );

    expect(result.valid).toBe(false);
    expect(result.issues).toEqual([
      {
        field: "study-accession",
        message:
          "STUDY-BOUND requires study-scoped input study.studyAccessionId and cannot run on an order target",
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

  it("flags samples missing sequencing technology metadata when tech restriction is enabled", async () => {
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
            platform: "Illumina",
            customFields: JSON.stringify({
              _sequencing_tech: {
                technologyId: "tech-illumina",
              },
            }),
            instrumentModel: null,
            libraryStrategy: null,
            librarySelection: null,
            librarySource: null,
          },
        },
        {
          id: "sample-2",
          sampleId: "SAMPLE-2",
          checklistData: null,
          taxId: null,
          reads: [],
          assemblies: [],
          bins: [],
          order: null,
        },
      ],
    });

    const result = await validatePipelineMetadata("study-1", "mag");
    const issue = result.issues.find(
      (entry) =>
        entry.field === "allowedSequencingTechnologies" &&
        entry.severity === "error"
    );

    expect(issue).toBeDefined();
    expect(issue?.message).toContain(
      "Some selected samples are missing order/technology selection metadata."
    );
    expect(result.valid).toBe(false);
  });

  it("accepts a valid selected-technology configuration and skips restriction errors", async () => {
    mocks.db.pipelineConfig.findUnique.mockResolvedValue({
      config: "not-valid-json",
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
            customFields: JSON.stringify({
              _sequencing_tech: {
                technologyId: "tech-illumina",
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

    expect(result.issues.some((entry) => entry.field === "allowedSequencingTechnologies")).toBe(
      false
    );
    expect(result.valid).toBe(true);
    expect(result.metadata.platform).toBe("Illumina");
  });

  it("returns platform missing error when one sample has no order", async () => {
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
            instrumentModel: null,
            libraryStrategy: null,
            librarySelection: null,
            librarySource: null,
          },
        },
        {
          id: "sample-2",
          sampleId: "SAMPLE-2",
          checklistData: null,
          taxId: null,
          reads: [],
          assemblies: [],
          bins: [],
          order: null,
        },
      ],
    });

    const result = await validatePipelineMetadata("study-1", "mag");
    const issue = result.issues.find((entry) => entry.field === "platform" && entry.severity === "error");

    expect(result.valid).toBe(false);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("Some selected samples are missing sequencing platform metadata");
    expect(issue?.fixUrl).toBe("/orders/order-1/edit");
  });

  it("flags unsupported platform values for MAG when not mapped", async () => {
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
            platform: "Weird Sequencer",
            customFields: null,
            instrumentModel: null,
            libraryStrategy: null,
            librarySelection: null,
            librarySource: null,
          },
        },
      ],
    });

    const result = await validatePipelineMetadata("study-1", "mag");
    const issue = result.issues.find(
      (entry) => entry.field === "platform" && entry.severity === "error"
    );

    expect(result.valid).toBe(false);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("not recognized");
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

  it("emits SubMG readiness issues when ENA metadata is incomplete", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({ enaTestMode: true });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      studyAccessionId: null,
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          checklistData: null,
          taxId: null,
          reads: [
            {
              file1: "/tmp/sample-1_R1.fastq.gz",
              file2: "/tmp/sample-1_R2.fastq.gz",
              checksum1: "abc",
              checksum2: null,
            },
          ],
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

    const result = await validatePipelineMetadata("study-1", "submg");
    const issueFields = result.issues.map((issue) => issue.field);

    expect(result.valid).toBe(false);
    expect(issueFields).toContain("studyAccessionId");
    expect(issueFields).toContain("sampleMetadata");
    expect(issueFields).toContain("taxId");
    expect(issueFields).toContain("checksums");
    expect(issueFields).toContain("assemblies");
    expect(issueFields).toContain("bins");
  });

  it("checks ENA test registration age for SubMG studies on test mode", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({ enaTestMode: true });
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      studyAccessionId: "PRJ123456",
      testRegisteredAt: new Date(Date.now() - 25 * 60 * 60 * 1000),
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          checklistData: JSON.stringify({
            "collection date": "2026-03-01",
            "geographic_location": "Global",
          }),
          taxId: "9606",
          reads: [
            {
              file1: "/tmp/sample-1_R1.fastq.gz",
              file2: "/tmp/sample-1_R2.fastq.gz",
              checksum1: "abc",
              checksum2: "def",
            },
          ],
          assemblies: [
            {
              id: "asm-1",
              assemblyFile: "/tmp/assembly.fa",
              createdByPipelineRunId: null,
              createdByPipelineRun: null,
            },
          ],
          bins: [
            {
              id: "bin-1",
            },
          ],
          order: {
            id: "order-1",
            platform: "Illumina",
            customFields: null,
            instrumentModel: null,
            libraryStrategy: null,
            librarySelection: null,
            librarySource: null,
          },
        },
      ],
    });

    const result = await validatePipelineMetadata("study-1", "submg");
    const issue = result.issues.find((entry) => entry.field === "studyAccessionId");

    expect(issue?.message).toContain("may be expired");
    expect(result.valid).toBe(false);
  });

  it("flags MAG as invalid for long-read platform selections", async () => {
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      samples: [
        {
          id: "sample-1",
          sampleId: "SAMPLE-1",
          checklistData: "{}",
          taxId: null,
          reads: [],
          assemblies: [],
          bins: [],
          order: {
            id: "order-1",
            platform: "Oxford Nanopore",
            customFields: null,
            instrumentModel: null,
            libraryStrategy: null,
            librarySelection: null,
            librarySource: null,
          },
        },
      ],
    });

    const result = await validatePipelineMetadata("study-1", "mag");
    const issue = result.issues.find(
      (entry) => entry.field === "platform" && entry.severity === "error"
    );

    expect(result.valid).toBe(false);
    expect(issue).toBeDefined();
    expect(issue?.message).toContain("long-read");
  });
});

describe("mapPlatformForPipeline", () => {
  it("maps short-read platform aliases for mag", () => {
    expect(mapPlatformForPipeline("NovaSeq", "mag")).toBe("ILLUMINA");
    expect(mapPlatformForPipeline("ion_torrent", "mag")).toBe("ION_TORRENT");
  });

  it("maps partial platform aliases for mag", () => {
    expect(mapPlatformForPipeline("illumina hiseq", "mag")).toBe("ILLUMINA");
    expect(mapPlatformForPipeline("x_illumina_hiseq", "mag")).toBe("ILLUMINA");
  });

  it("rejects long-read platforms for mag", () => {
    expect(mapPlatformForPipeline("Oxford Nanopore", "mag")).toBeNull();
    expect(mapPlatformForPipeline("PacBio", "mag")).toBeNull();
  });

  it("passes through platform values for non-mag pipelines", () => {
    expect(mapPlatformForPipeline("Custom Platform", "submg")).toBe("Custom Platform");
  });
});
