import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  pipelineConfigFindUnique: vi.fn(),
  siteSettingsFindUnique: vi.fn(),
  readPipelineInstallProvenance: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    pipelineConfig: {
      findUnique: mocks.pipelineConfigFindUnique,
    },
    siteSettings: {
      findUnique: mocks.siteSettingsFindUnique,
    },
  },
}));

vi.mock("@/lib/pipelines/pipeline-install-provenance", () => ({
  readPipelineInstallProvenance:
    mocks.readPipelineInstallProvenance,
}));

import { getPipelineEnabled } from "./enablement";

describe("pipeline enablement", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.pipelineConfigFindUnique.mockResolvedValue(null);
    mocks.siteSettingsFindUnique.mockResolvedValue(null);
    mocks.readPipelineInstallProvenance.mockResolvedValue(null);
  });

  it("keeps a newly Store-installed package disabled before a DB row exists", async () => {
    mocks.readPipelineInstallProvenance.mockResolvedValue({
      schemaVersion: 1,
      pipelineId: "fixture",
      version: "1.0.0",
      sourceId: "registry:test",
      sourceKind: "registry",
      installedAt: "2026-07-30T08:00:00.000Z",
    });

    await expect(getPipelineEnabled("fixture")).resolves.toBe(false);
  });

  it("keeps the legacy default for bundled packages without provenance", async () => {
    await expect(getPipelineEnabled("bundled")).resolves.toBe(true);
  });

  it("lets an explicit DB activation override install provenance", async () => {
    mocks.pipelineConfigFindUnique.mockResolvedValue({ enabled: true });
    mocks.readPipelineInstallProvenance.mockResolvedValue({
      schemaVersion: 1,
      pipelineId: "fixture",
      version: "1.0.0",
      sourceId: "registry:test",
      sourceKind: "registry",
      installedAt: "2026-07-30T08:00:00.000Z",
    });

    await expect(getPipelineEnabled("fixture")).resolves.toBe(true);
  });
});
