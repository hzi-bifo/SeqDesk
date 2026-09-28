import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ stored: null as string | null, db: { siteSettings: { findUnique: vi.fn(), upsert: vi.fn() } } }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));
vi.mock("@/lib/modules/input-modules.server", () => ({ requireRawReadImporter: async () => undefined }));
vi.mock("@/lib/workbench/server", () => ({
  authorizeWorkbenchRequest: (session: { user?: { role?: string } } | null) => session?.user ? { allowed: true, userId: "u" } : { allowed: false, response: new Response("{}", { status: 401 }) },
}));

import { handleDataSourcesRequest } from "./data-sources";
import type { IntegrationSession } from "./identity";

process.env.NEXTAUTH_SECRET ||= "test-secret-for-secret-store-unit-tests";
const admin = { user: { id: "a", name: "Alex Morgan", role: "FACILITY_ADMIN" }, integration: {} } as unknown as IntegrationSession;
const member = { user: { id: "m", name: "Anna Weber", role: "RESEARCHER" }, integration: {} } as unknown as IntegrationSession;
const call = (session: IntegrationSession, route: string, body?: unknown, fetcher?: typeof fetch) => handleDataSourcesRequest(
  new Request(`http://x/api/integration/v1/importers/sources${route}`, body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }),
  session, ["importers", "sources", ...route.split("/").filter(Boolean)], new Headers(), fetcher);

describe("integration importers/sources", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("NCBI_API_KEY", "");
    mocks.stored = null;
    mocks.db.siteSettings.findUnique.mockImplementation(async () => ({ extraSettings: mocks.stored }));
    mocks.db.siteSettings.upsert.mockImplementation(async ({ update }: { update: { extraSettings: string } }) => { mocks.stored = update.extraSettings; });
  });

  it("lets members read the status and the history, and says whether they can manage", async () => {
    const status = await (await call(member, "")).json();
    expect(status.canManage).toBe(false);
    expect(status.sources.map((s: { id: string }) => s.id)).toContain("ncbi");
    expect((await call(member, "/history")).status).toBe(200);
  });

  it("keeps every write and every test for admins", async () => {
    expect((await call(member, "/settings", { maxBytes: 1024 })).status).toBe(403);
    expect((await call(member, "/secrets", { secret: "ncbi-key", apiKey: "abcdef0123456789abcdef0123456789ab" })).status).toBe(403);
    expect((await call(member, "/test", { source: "ena" })).status).toBe(403);
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });

  it("changes settings, sets secrets and tests as an admin, with the admin's name in the history", async () => {
    expect((await call(admin, "/settings", { sources: { geo: { enabled: false } } })).status).toBe(200);
    expect((await call(admin, "/secrets", { secret: "dryad-account", clientId: "client-id-123", clientSecret: "client-secret-456" })).status).toBe(200);
    const tested = await (await call(admin, "/test", { source: "records" }, (async () => new Response("{}")) as typeof fetch)).json();
    expect(tested.results[0]).toMatchObject({ id: "records", result: "passed" });
    const { history } = await (await call(admin, "/history")).json();
    expect(history.map((h: { what: string; by: string }) => `${h.by}: ${h.what}`)).toEqual([
      "Alex Morgan: Tested Zenodo and figshare · passed", "Alex Morgan: Dryad API account set", "Alex Morgan: GEO turned off"]);
    expect(JSON.stringify(await (await call(admin, "")).json())).not.toContain("client-secret-456");
  });

  it("answers bad input in words", async () => {
    expect((await call(admin, "/secrets", { secret: "github" })).status).toBe(400);
    expect((await call(admin, "/test", { source: "nope" })).status).toBe(404);
    const bad = await call(admin, "/settings", { askAboveBytes: "big" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toMatch(/size/);
  });
});
