import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    sample: {
      findMany: vi.fn(),
    },
    study: {
      findUnique: vi.fn(),
    },
  },
  getPackageSamplesheet: vi.fn(),
  resolveOrderPlatform: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("./package-loader", () => ({
  getPackageSamplesheet: mocks.getPackageSamplesheet,
}));

vi.mock("./order-platform", () => ({
  resolveOrderPlatform: mocks.resolveOrderPlatform,
}));

import {
  SamplesheetGenerator,
  generateSamplesheetFromConfig,
  hasSamplesheetConfig,
} from "./samplesheet-generator";

function makeConfig(format: "csv" | "tsv" = "csv") {
  return {
    samplesheet: {
      format,
      filename: `samplesheet.${format}`,
      rows: {
        scope: "sample",
      },
      columns: [
        {
          name: "sample",
          source: "sample.sampleId",
          required: true,
        },
        {
          name: "r1",
          source: "read.file1",
          required: true,
        },
        {
          name: "r2",
          source: "sample.reads[paired].file2",
          required: false,
          default: "NA",
        },
        {
          name: "platform",
          source: "order.platform",
          transform: { type: "to_upper" },
          required: false,
          default: "UNKNOWN",
        },
        {
          name: "study",
          source: "study.title",
          required: true,
        },
        {
          name: "r1_full",
          source: "read.file1",
          transform: {
            type: "prepend_path",
            base: "${DATA_BASE_PATH}",
          },
        },
        {
          name: "mapped",
          source: "order.platform",
          transform: {
            type: "map_value",
            mapping: {
              illumina: "ILMN",
              nanopore: "ONT",
            },
          },
          default: "UNK",
        },
      ],
    },
  };
}

describe("samplesheet-generator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.resolveOrderPlatform.mockImplementation((order: { platform?: string | null } | null) =>
      order?.platform ?? null
    );
  });

  it("reports missing config and hasSamplesheetConfig=false", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(null);

    expect(hasSamplesheetConfig("mag")).toBe(false);

    const generator = new SamplesheetGenerator("mag");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/db",
    });

    expect(result).toEqual({
      content: "",
      sampleCount: 0,
      errors: ["No samplesheet configuration found for pipeline: mag"],
      warnings: [],
    });
  });

  it("returns error when no samples match query", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig());
    mocks.db.sample.findMany.mockResolvedValue([]);

    const generator = new SamplesheetGenerator("mag");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1", sampleIds: ["sample-x"] },
      dataBasePath: "/db",
    });

    expect(mocks.db.sample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studyId: "study-1", id: { in: ["sample-x"] } },
      })
    );
    expect(result.errors).toEqual(["No samples found for the specified pipeline target"]);
    expect(result.sampleCount).toBe(0);
  });

  it("returns error when study lookup fails", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig());
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: "S1",
        reads: [{ file1: "reads/S1_R1.fastq.gz", file2: "reads/S1_R2.fastq.gz" }],
        order: { id: "order-1", platform: "illumina", customFields: null },
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue(null);

    const generator = new SamplesheetGenerator("mag");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/db",
    });

    expect(result.errors).toEqual(["Study not found"]);
    expect(result.content).toBe("");
  });

  it("prefers paired reads when optional R2 inputs are available", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig("csv"));
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: "S1",
        reads: [
          { file1: "reads/S1_single.fastq.gz", file2: null },
          { file1: "reads/S1_R1.fastq.gz", file2: "reads/S1_R2.fastq.gz" },
        ],
        order: { id: "order-1", platform: "illumina", customFields: null },
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study Title",
    });

    const generator = new SamplesheetGenerator("mag");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/data/base",
    });

    expect(result.errors).toEqual([]);
    expect(result.sampleCount).toBe(1);
    expect(result.content).toBe(
      [
        "sample,r1,r2,platform,study,r1_full,mapped",
        "S1,reads/S1_R1.fastq.gz,reads/S1_R2.fastq.gz,ILLUMINA,Study Title,/data/base/reads/S1_R1.fastq.gz,ILMN",
      ].join("\n")
    );
  });

  it("falls back to single-end reads when no paired record exists", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig("csv"));
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: "S1",
        reads: [{ file1: "reads/S1_single.fastq.gz", file2: null }],
        order: { id: "order-1", platform: "illumina", customFields: null },
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study Title",
    });

    const generator = new SamplesheetGenerator("mag");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/data/base",
    });

    expect(result.errors).toEqual([]);
    expect(result.sampleCount).toBe(1);
    expect(result.content).toBe(
      [
        "sample,r1,r2,platform,study,r1_full,mapped",
        "S1,reads/S1_single.fastq.gz,NA,ILLUMINA,Study Title,/data/base/reads/S1_single.fastq.gz,ILMN",
      ].join("\n")
    );
  });

  it("uses TSV delimiter when configured", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig("tsv"));
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: "S1",
        reads: [{ file1: "reads/S1_R1.fastq.gz", file2: "reads/S1_R2.fastq.gz" }],
        order: { id: "order-1", platform: "nanopore", customFields: null },
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study Title",
    });

    const generator = new SamplesheetGenerator("mag");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/db",
    });

    expect(result.content.split("\n")[0]).toContain("\t");
    expect(result.content).toContain("ONT");
  });

  it("fails required strict map_value columns when platform is unmapped", async () => {
    mocks.getPackageSamplesheet.mockReturnValue({
      samplesheet: {
        format: "csv",
        filename: "samplesheet.csv",
        rows: { scope: "sample" },
        columns: [
          {
            name: "sample",
            source: "sample.sampleId",
            required: true,
          },
          {
            name: "sequencer",
            source: "order.platform",
            required: true,
            transform: {
              type: "map_value",
              strict: true,
              mapping: {
                nanopore: "Nanopore",
                pacbio: "PacBio",
              },
            },
          },
        ],
      },
    });

    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: "S1",
        reads: [{ file1: "reads/S1_R1.fastq.gz", file2: null }],
        order: { id: "order-1", platform: "Sequel II/IIe", customFields: null },
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study Title",
    });

    const generator = new SamplesheetGenerator("metaxpath");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/db",
    });

    expect(result.sampleCount).toBe(0);
    expect(result.errors).toContain(
      "Sample S1: Missing required value for column 'sequencer'"
    );
    expect(result.errors).toContain("No samples with valid data for samplesheet");
  });

  it("skips invalid samples on required-column errors and fails if all are invalid", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig("csv"));
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: "S1",
        reads: [{ file1: null, file2: null }],
        order: { id: "order-1", platform: null, customFields: null },
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study Title",
    });

    const generator = new SamplesheetGenerator("mag");
    const result = await generator.generate({
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/db",
    });

    expect(result.sampleCount).toBe(0);
    expect(result.errors).toContain(
      "Sample S1: Missing required value for column 'r1'"
    );
    expect(result.errors).toContain("No samples with valid data for samplesheet");
  });

  it("describeFormat includes required/default annotations", () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig("csv"));

    const generator = new SamplesheetGenerator("mag");
    const description = generator.describeFormat();

    expect(description).toContain("Samplesheet columns:");
    expect(description).toContain("- sample:");
    expect(description).toContain("(required)");
    expect(description).toContain('[default: "NA"]');
  });

  it("generateSamplesheetFromConfig returns null without config and delegates with config", async () => {
    mocks.getPackageSamplesheet.mockReturnValueOnce(null);

    const noConfig = await generateSamplesheetFromConfig("mag", {
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/db",
    });
    expect(noConfig).toBeNull();

    mocks.getPackageSamplesheet.mockReturnValueOnce(makeConfig("csv"));
    mocks.db.sample.findMany.mockResolvedValue([
      {
        sampleId: "S1",
        reads: [{ file1: "reads/S1_R1.fastq.gz", file2: "reads/S1_R2.fastq.gz" }],
        order: { id: "order-1", platform: "illumina", customFields: null },
      },
    ]);
    mocks.db.study.findUnique.mockResolvedValue({
      id: "study-1",
      title: "Study Title",
    });

    const generated = await generateSamplesheetFromConfig("mag", {
      target: { type: "study", studyId: "study-1" },
      dataBasePath: "/db",
    });

    expect(generated).not.toBeNull();
    expect(generated?.sampleCount).toBe(1);
    expect(generated?.content).toContain("sample,r1,r2,platform,study,r1_full,mapped");
  });

  it("supports order targets and resolves study fields from the sample relation", async () => {
    mocks.getPackageSamplesheet.mockReturnValue(makeConfig("csv"));
    mocks.db.sample.findMany.mockResolvedValue([
      {
        id: "sample-1",
        sampleId: "S1",
        reads: [{ file1: "reads/S1_R1.fastq.gz", file2: "reads/S1_R2.fastq.gz" }],
        order: { id: "order-1", platform: "illumina", customFields: null },
        study: { id: "study-99", title: "Linked Study" },
      },
    ]);

    const generator = new SamplesheetGenerator("fastq-checksum");
    const result = await generator.generate({
      target: { type: "order", orderId: "order-1", sampleIds: ["sample-1"] },
      dataBasePath: "/db",
    });

    expect(mocks.db.sample.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { orderId: "order-1", id: { in: ["sample-1"] } },
      })
    );
    expect(mocks.db.study.findUnique).not.toHaveBeenCalled();
    expect(result.errors).toEqual([]);
    expect(result.sampleCount).toBe(1);
    expect(result.content).toContain("Linked Study");
  });
});
