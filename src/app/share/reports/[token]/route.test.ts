import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({ find: vi.fn(), render: vi.fn() }));
vi.mock("@/lib/explore/module", () => ({ isExploreModuleEnabled: async () => true }));
vi.mock("@/lib/explore/report-export", () => ({ activeFiltersFromSearchParams: () => ({}), renderReportHtml: mocks.render }));
vi.mock("@/lib/explore/reports", async () => {
  const actual = await vi.importActual<typeof import("@/lib/explore/reports")>("@/lib/explore/reports");
  return { ...actual, findSharedReport: mocks.find };
});
vi.mock("@/lib/integration/viewer", () => ({ integrationConfig: () => null, redeemViewer: vi.fn(), viewerAllowed: vi.fn(), viewerCookie: vi.fn(), viewerCookieName: vi.fn(), viewerCookieValid: vi.fn() }));

import { GET } from "./route";
import { sharedPageCacheKey } from "@/lib/explore/reports";

const token = "abcdefghijklmnop1234";
const call = () => GET(new NextRequest(`http://localhost/share/reports/${token}`), { params: Promise.resolve({ token }) });
const shared = (over: Record<string, unknown> = {}) => ({ id: "r1", targetKey: "project:p1", mode: "link", token, updatedAt: "2026-10-01T10:00:00.000Z", ...over });

describe("shared report page cache", () => {
  beforeEach(() => { vi.clearAllMocks(); mocks.render.mockImplementation(async () => ({ html: `<p>${mocks.render.mock.calls.length}</p>` })); });

  it("serves one rendering for repeats of the same share state", async () => {
    mocks.find.mockResolvedValue(shared({ id: "same" }));
    await call();
    await call();
    expect(mocks.render).toHaveBeenCalledTimes(1);
  });

  it("renders again once the report changed or its share state did, and never serves a withdrawn share from cache", async () => {
    mocks.find.mockResolvedValue(shared({ id: "r2" }));
    await call();
    mocks.find.mockResolvedValue(shared({ id: "r2", updatedAt: "2026-10-01T10:05:00.000Z" }));
    await call();
    mocks.find.mockResolvedValue(shared({ id: "r2", updatedAt: "2026-10-01T10:05:00.000Z", mode: "named" }));
    await call().catch(() => null);
    expect(mocks.render).toHaveBeenCalledTimes(2);
    mocks.find.mockResolvedValue(null);
    const gone = await call();
    expect(gone.status).toBe(404);
    expect(mocks.render).toHaveBeenCalledTimes(2);
  });

  it("keys the cache by token, mode and last change", () => {
    const keys = new Set([shared(), shared({ token: "other" }), shared({ mode: "named" }), shared({ updatedAt: "2026-10-02T00:00:00.000Z" })].map((entry) => sharedPageCacheKey(entry as never, "")));
    expect(keys.size).toBe(4);
  });
});
