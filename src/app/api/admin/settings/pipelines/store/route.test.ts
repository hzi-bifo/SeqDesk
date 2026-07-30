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
    vi.useRealTimers();
    global.fetch = originalFetch;
    if (originalRegistryUrls === undefined) {
      delete process.env.SEQDESK_PIPELINE_REGISTRY_URLS;
    } else {
      process.env.SEQDESK_PIPELINE_REGISTRY_URLS = originalRegistryUrls;
    }
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
      "https://seqdesk.org/api/registry,https://example.org/api/registry";
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
              downloadUrl: "https://seqdesk.org/packages/mag.json",
              targets: {
                supported: ["study"],
              },
              versions: [
                {
                  version: "3.0.0",
                  downloadUrl:
                    "https://seqdesk.org/api/registry/pipelines/mag/3.0.0/download",
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
    expect(payload.registryErrors).toEqual([]);
    expect(mocks.fetch).toHaveBeenCalledWith(
      "https://seqdesk.org/api/registry",
      expect.objectContaining({
        cache: "no-store",
        signal: expect.any(AbortSignal),
      })
    );
  });

  it("returns successful registry data with a source-level error when another registry fails", async () => {
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS =
      "https://seqdesk.org/api/registry,https://unreachable.example/api/registry";
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });

    mocks.fetch
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          version: "1",
          lastUpdated: "2026-07-29T10:00:00.000Z",
          pipelines: [
            {
              id: "mag",
              latestVersion: "3.0.0",
              downloadUrl: "https://seqdesk.org/packages/mag.json",
              targets: {
                supported: ["study"],
              },
            },
          ],
          categories: [{ id: "metagenomics", name: "Metagenomics" }],
        }),
      })
      .mockRejectedValueOnce(new Error("connect ECONNREFUSED"));

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.registries).toHaveLength(2);
    expect(payload.pipelines).toEqual([
      expect.objectContaining({
        id: "mag",
        catalogs: ["study"],
      }),
    ]);
    expect(payload.categories).toEqual([
      { id: "metagenomics", name: "Metagenomics" },
    ]);
    expect(payload.version).toBe("1");
    expect(payload.lastUpdated).toBe("2026-07-29T10:00:00.000Z");
    expect(payload.registryErrors).toEqual([
      {
        sourceId: "registry:https://unreachable.example/api/registry",
        label: "unreachable.example",
        registryUrl: "https://unreachable.example/api/registry",
        error: "connect ECONNREFUSED",
      },
    ]);
  });

  it("isolates malformed category data to the registry that returned it", async () => {
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS =
      "https://seqdesk.org/api/registry,https://malformed.example/api/registry";
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
              downloadUrl: "https://seqdesk.org/packages/mag.json",
              targets: { supported: ["study"] },
            },
          ],
          categories: [{ id: "analysis", name: "Analysis" }],
        }),
      })
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          pipelines: [{ id: "broken" }],
          categories: [null],
        }),
      });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines).toEqual([
      expect.objectContaining({ id: "mag" }),
    ]);
    expect(payload.categories).toEqual([
      { id: "analysis", name: "Analysis" },
    ]);
    expect(payload.registryErrors).toEqual([
      expect.objectContaining({
        registryUrl: "https://malformed.example/api/registry",
        error: "Registry category at index 0 is invalid",
      }),
    ]);
  });

  it("skips a malformed pipeline without hiding valid siblings from the same registry", async () => {
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS =
      "https://seqdesk.org/api/registry";
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pipelines: [
          {
            id: "broken",
            versions: {},
          },
          {
            id: "mag",
            latestVersion: "3.0.0",
            versions: [
              {
                version: "3.0.0",
                downloadUrl: "https://seqdesk.org/packages/mag.json",
              },
            ],
            targets: { supported: ["study"] },
          },
        ],
        categories: [],
      }),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines).toEqual([
      expect.objectContaining({ id: "mag", version: "3.0.0" }),
    ]);
    expect(payload.registryErrors).toEqual([
      expect.objectContaining({
        registryUrl: "https://seqdesk.org/api/registry",
        error: expect.stringContaining(
          "Skipped invalid pipeline at index 0"
        ),
      }),
    ]);
  });

  it("does not advertise a one-click registry install without a download URL", async () => {
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS =
      "https://seqdesk.org/api/registry";
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.fetch.mockResolvedValue({
      ok: true,
      json: async () => ({
        pipelines: [
          {
            id: "missing-url",
            targets: { supported: ["study"] },
          },
          {
            id: "private-pipeline",
            isPrivate: true,
            targets: { supported: ["study"] },
          },
        ],
        categories: [],
      }),
    });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store")
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.pipelines).toEqual([
      expect.objectContaining({ id: "private-pipeline", isPrivate: true }),
    ]);
    expect(payload.registryErrors).toEqual([
      expect.objectContaining({
        error: expect.stringContaining(
          'Skipped pipeline "missing-url": registry installs require a download URL'
        ),
      }),
    ]);
  });

  it("times out an unresponsive registry without discarding successful registry data", async () => {
    vi.useFakeTimers();
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS =
      "https://seqdesk.org/api/registry,https://slow.example/api/registry";
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    let slowSignal: AbortSignal | undefined;

    mocks.fetch.mockImplementation(
      (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input) === "https://seqdesk.org/api/registry") {
          return Promise.resolve({
            ok: true,
            json: async () => ({
              pipelines: [
                {
                  id: "mag",
                  latestVersion: "3.0.0",
                  downloadUrl: "https://seqdesk.org/packages/mag.json",
                  targets: {
                    supported: ["study"],
                  },
                },
              ],
              categories: [],
            }),
          });
        }

        slowSignal = init?.signal ?? undefined;
        return new Promise((_resolve, reject) => {
          slowSignal?.addEventListener(
            "abort",
            () => {
              const abortError = new Error("The operation was aborted");
              abortError.name = "AbortError";
              reject(abortError);
            },
            { once: true }
          );
        });
      }
    );

    const responsePromise = GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store")
    );
    await vi.advanceTimersByTimeAsync(10_000);
    const response = await responsePromise;
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(slowSignal?.aborted).toBe(true);
    expect(payload.pipelines).toEqual([
      expect.objectContaining({
        id: "mag",
      }),
    ]);
    expect(payload.registryErrors).toEqual([
      expect.objectContaining({
        sourceId: "registry:https://slow.example/api/registry",
        registryUrl: "https://slow.example/api/registry",
        error: "Request timed out after 10000ms",
      }),
    ]);
  });

  it("keeps the existing error response when every configured registry fails", async () => {
    process.env.SEQDESK_PIPELINE_REGISTRY_URLS =
      "https://first.example/api/registry,https://second.example/api/registry";
    mocks.getServerSession.mockResolvedValue({
      user: { role: "FACILITY_ADMIN" },
    });
    mocks.fetch
      .mockRejectedValueOnce(new Error("first unavailable"))
      .mockResolvedValueOnce({
        ok: false,
        status: 503,
      });

    const response = await GET(
      new NextRequest("http://localhost/api/admin/settings/pipelines/store")
    );
    const payload = await response.json();

    expect(response.status).toBe(500);
    expect(payload.error).toBe("Failed to fetch pipeline registry");
    expect(payload.pipelines).toEqual([]);
    expect(payload.categories).toEqual([]);
    expect(payload.registryErrors).toEqual([
      expect.objectContaining({
        registryUrl: "https://first.example/api/registry",
        error: "first unavailable",
      }),
      expect.objectContaining({
        registryUrl: "https://second.example/api/registry",
        error: "Request failed with status 503",
      }),
    ]);
  });
});
