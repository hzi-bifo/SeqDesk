import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPackageManifest: vi.fn(),
}));

vi.mock("@/lib/pipelines/package-loader", () => ({
  getPackageManifest: mocks.getPackageManifest,
}));

import {
  findUniqueStorePipeline,
  loadPipelineStoreCatalog,
} from "./pipeline-store-service";

function registry(id: string, registryUrl: string) {
  return {
    id,
    registryUrl,
    browseUrl: `${registryUrl}/browse`,
    label: id,
  };
}

describe("pipeline Store service", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getPackageManifest.mockReturnValue({
      targets: { supported: ["study"] },
    });
  });

  it("uses explicit remote targets for the available version", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pipelines: [
          {
            id: "dual-version-targets",
            latestVersion: "2.0.0",
            downloadUrl: "https://packages.example/pipeline.json",
            targets: { supported: ["order"] },
          },
        ],
      }),
    });

    const result = await loadPipelineStoreCatalog({
      registrySources: [
        registry("official", "https://registry.example/api/registry"),
      ],
      fetchImpl,
    });

    expect(result.pipelines).toEqual([
      expect.objectContaining({
        id: "dual-version-targets",
        targets: { supported: ["order"] },
        catalogs: ["order"],
      }),
    ]);
  });

  it("omits ambiguous duplicate IDs until a source selector resolves them", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pipelines: [
            {
              id: "shared-id",
              latestVersion: "2.0.0",
              versions: [
                {
                  version: "2.0.0",
                  downloadUrl: "https://a.example/shared-2.json",
                },
                {
                  version: "1.0.0",
                  downloadUrl: "https://a.example/shared-1.json",
                  sha256: "a".repeat(64),
                },
              ],
              targets: { supported: ["study"] },
            },
          ],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pipelines: [
            {
              id: "shared-id",
              latestVersion: "3.0.0",
              downloadUrl: "https://b.example/shared-3.json",
              targets: { supported: ["order"] },
            },
          ],
        }),
      });

    const result = await loadPipelineStoreCatalog({
      registrySources: [
        registry("source-a", "https://a.example/api/registry"),
        registry("source-b", "https://b.example/api/registry"),
      ],
      fetchImpl,
    });

    expect(result.pipelines).toEqual([]);
    expect(result.duplicatePipelineIds).toEqual([
      expect.objectContaining({
        pipelineId: "shared-id",
        sources: expect.arrayContaining([
          expect.objectContaining({ sourceId: "source-a" }),
          expect.objectContaining({ sourceId: "source-b" }),
        ]),
      }),
    ]);
    expect(findUniqueStorePipeline(result, "shared-id")).toBeNull();
    expect(
      findUniqueStorePipeline(result, "shared-id", {
        sourceId: "source-a",
        version: "1.0.0",
      })
    ).toEqual(
      expect.objectContaining({
        version: "1.0.0",
        source: expect.objectContaining({
          sourceId: "source-a",
          downloadUrl: "https://a.example/shared-1.json",
          sha256: "a".repeat(64),
        }),
      })
    );
  });

  it("keeps requiresKey-only entries and classifies them as private", async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        pipelines: [
          {
            id: "licensed-pipeline",
            latestVersion: "1.0.0",
            privateInstall: {
              requiresKey: true,
              packageUrlDefault:
                "https://packages.example/licensed-pipeline.json",
            },
            targets: { supported: ["study"] },
          },
        ],
      }),
    });

    const result = await loadPipelineStoreCatalog({
      registrySources: [
        registry("official", "https://registry.example/api/registry"),
      ],
      fetchImpl,
    });

    expect(result.registryErrors).toEqual([]);
    expect(result.pipelines).toEqual([
      expect.objectContaining({
        id: "licensed-pipeline",
        isPrivate: true,
        source: expect.objectContaining({
          kind: "privateRegistry",
        }),
      }),
    ]);
  });
});
