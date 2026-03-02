import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { getSequencingFilesConfig } from "./sequencing-config";

describe("getSequencingFilesConfig", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when settings are missing", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const result = await getSequencingFilesConfig();

    expect(result.dataBasePath).toBeNull();
    expect(result.config).toMatchObject({
      allowedExtensions: [".fastq.gz", ".fq.gz", ".fastq", ".fq"],
      scanDepth: 2,
      ignorePatterns: ["**/tmp/**", "**/undetermined/**"],
      allowSingleEnd: true,
      autoAssign: false,
      simulationMode: "auto",
      simulationTemplateDir: "",
    });
  });

  it("merges sequencingFiles from extraSettings and enforces allowSingleEnd=true", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/mnt/data",
      extraSettings: JSON.stringify({
        sequencingFiles: {
          allowedExtensions: [".fq.gz"],
          scanDepth: 5,
          ignorePatterns: ["**/ignore/**"],
          allowSingleEnd: false,
          autoAssign: true,
          simulationMode: "template",
          simulationTemplateDir: "/templates",
        },
      }),
    });

    const result = await getSequencingFilesConfig();

    expect(result.dataBasePath).toBe("/mnt/data");
    expect(result.config).toMatchObject({
      allowedExtensions: [".fq.gz"],
      scanDepth: 5,
      ignorePatterns: ["**/ignore/**"],
      allowSingleEnd: true,
      autoAssign: true,
      simulationMode: "template",
      simulationTemplateDir: "/templates",
    });
  });

  it("ignores invalid extraSettings JSON", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      dataBasePath: "/mnt/data",
      extraSettings: "{bad-json",
    });

    const result = await getSequencingFilesConfig();

    expect(result.dataBasePath).toBe("/mnt/data");
    expect(result.config.scanDepth).toBe(2);
    expect(result.config.allowSingleEnd).toBe(true);
  });
});
