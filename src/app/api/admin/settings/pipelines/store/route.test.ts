import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  fetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

import { GET } from "./route";

describe("GET /api/admin/settings/pipelines/store", () => {
  const originalFetch = global.fetch;
  const originalRegistryUrls = process.env.SEQDESK_PIPELINE_REGISTRY_URLS;

  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = mocks.fetch as typeof global.fetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS = originalRegistryUrls;
  });

  it("rejects non-admin requests", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store")
    );

    expect(response.status).toBe(403);
  });

  it("aggregates multiple registries and preserves source metadata", async () => {
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS =
      "https://seqdesk.com/api/registry,https://example.org/api/registry";
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });

    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pipelines: [
            {
              id: "mag",
              latestVersion: "3.0.0",
              targets: {
                supported: ["study"],
              },
              versions: [
                {
                  version: "3.0.0",
                  downloadUrl:
                    "https://seqdesk.com/api/registry/pipelines/mag/3.0.0/download",
                },
              ],
            },
          ],
          categories: [{ id: "metagenomics", name: "Metagenomics" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pipelines: [
            {
              id: "metaxpath",
              latestVersion: "0.1.0",
              isPrivate: true,
              targets: {
                supported: ["order"],
              },
              source: {
                kind: "github",
                label: "GitHub",
                repository: "hzi-bifo/MetaxPath",
                refDefault: "Nextflow",
              },
            },
          ],
          categories: [{ id: "metagenomics", name: "Metagenomics" }],
        }),
      });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store?catalog=order")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.registries).toHaveLength(2);
    expect(payload.pipelines).toEqual(
      [
        expect.objectContaining({
          id: "metaxpath",
          catalogs: ["order"],
          targets: { supported: ["order"] },
          source: expect.objectContaining({
            kind: "github",
            repository: "hzi-bifo/MetaxPath-Nextflow",
            refDefault: "main",
          }),
        }),
      ]
    );
  });
});
