import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  effectiveConfig: vi.fn(),
  clearConfigCache: vi.fn(),
  siteSettings: { findUnique: vi.fn(), update: vi.fn(), create: vi.fn() },
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.session }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: { siteSettings: mocks.siteSettings } }));
vi.mock("@/lib/config", () => ({ getEffectiveConfig: mocks.effectiveConfig, clearConfigCache: mocks.clearConfigCache }));

import { GET, PUT } from "./route";

const originalRevision = "2026-09-10T10:00:00.000Z";
const nextRevision = "2026-09-10T10:01:00.000Z";
let stored: { siteName: string; contactEmail: string | null; updatedAt: Date } | null;
let sources: Record<string, string>;
let overrides: Record<string, string>;

const request = (body: unknown) => new Request("http://localhost/api/admin/settings/site", {
  method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});

beforeEach(() => {
  vi.resetAllMocks();
  stored = { siteName: "My lab", contactEmail: "lab@example.org", updatedAt: new Date(originalRevision) };
  sources = {};
  overrides = {};
  mocks.session.mockResolvedValue({ user: { id: "admin", role: "FACILITY_ADMIN", systemRole: "ADMIN" } });
  mocks.siteSettings.findUnique.mockImplementation(async () => stored);
  mocks.effectiveConfig.mockImplementation(async () => ({
    config: { site: { name: stored?.siteName || "SeqDesk", contactEmail: stored?.contactEmail || undefined, ...overrides } },
    sources: { "site.name": stored ? "database" : "default", "site.contactEmail": stored?.contactEmail ? "database" : "default", ...sources },
  }));
  mocks.siteSettings.update.mockImplementation(async ({ data }) => {
    stored = { ...stored!, ...data, updatedAt: new Date(nextRevision) };
    return stored;
  });
  mocks.siteSettings.create.mockImplementation(async ({ data }) => {
    stored = { siteName: "SeqDesk", contactEmail: null, ...data, updatedAt: new Date(nextRevision) };
    return stored;
  });
});

describe("Installation details API", () => {
  it.each([
    [null, 401],
    [{ user: { id: "member", role: "RESEARCHER" } }, 403],
    [{ user: { id: "operator", role: "FACILITY_ADMIN", systemRole: "MEMBER", facilityWorkflowRole: "OPERATOR" } }, 403],
  ])("protects both routes for a non-administrator", async (session, status) => {
    mocks.session.mockResolvedValue(session);
    expect((await GET()).status).toBe(status);
    expect((await PUT(request({ name: "New lab", expectedRevision: originalRevision }))).status).toBe(status);
    expect(mocks.siteSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it("returns only identity values, source information and a revision", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toEqual({
      settings: { name: "My lab", contactEmail: "lab@example.org" },
      sources: { name: "database", contactEmail: "database" },
      editable: { name: true, contactEmail: true },
      revision: originalRevision,
      readOnlyReason: null,
    });
    expect(mocks.clearConfigCache).toHaveBeenCalled();
  });

  it("exposes defaults for a genuine fresh installation and creates only identity columns", async () => {
    stored = null;
    expect((await (await GET()).json()).revision).toBeNull();
    const response = await PUT(request({ contactEmail: "ops@example.org", expectedRevision: null }));
    expect(response.status).toBe(200);
    expect(mocks.siteSettings.create).toHaveBeenCalledWith(expect.objectContaining({ data: { id: "singleton", contactEmail: "ops@example.org" } }));
    expect((await response.json()).settings).toEqual({ name: "SeqDesk", contactEmail: "ops@example.org" });
  });

  it("blocks demo mutations at the API even when demo administrators can view settings", async () => {
    mocks.session.mockResolvedValue({ user: { id: "demo-admin", role: "FACILITY_ADMIN", isDemo: true } });
    const read = await (await GET()).json();
    expect(read.editable).toEqual({ name: false, contactEmail: false });
    expect(read.readOnlyReason).toMatch(/demo/);
    mocks.siteSettings.findUnique.mockClear();
    expect((await PUT(request({ name: "Changed demo", expectedRevision: originalRevision }))).status).toBe(403);
    expect(mocks.siteSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it.each([
    null, [], "name", {}, { expectedRevision: originalRevision },
    { name: "", expectedRevision: originalRevision },
    { name: "   ", expectedRevision: originalRevision },
    { name: "First\nSecond", expectedRevision: originalRevision },
    { name: "a".repeat(121), expectedRevision: originalRevision },
    { contactEmail: "not-an-email", expectedRevision: originalRevision },
    { contactEmail: "test@example.org\nBcc:other@example.org", expectedRevision: originalRevision },
    { contactEmail: null, expectedRevision: originalRevision },
    { name: 123, expectedRevision: originalRevision },
    { name: "Lab", siteName: "Unexpected", expectedRevision: originalRevision },
    { name: "Lab", expectedRevision: "invalid-date" },
    { name: "Lab" },
  ])("rejects malformed, invalid or unknown fields: %j", async body => {
    expect((await PUT(request(body))).status).toBe(400);
    expect(mocks.siteSettings.findUnique).not.toHaveBeenCalled();
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it("rejects invalid JSON without writing", async () => {
    expect((await PUT(new Request("http://localhost", { method: "PUT", body: "{" }))).status).toBe(400);
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it.each(["file", "env"])("locks %s-managed names while allowing a contact-only update", async source => {
    sources["site.name"] = source;
    overrides.name = "Operator name";
    const read = await (await GET()).json();
    expect(read.settings.name).toBe("Operator name");
    expect(read.editable).toEqual({ name: false, contactEmail: true });
    const rejected = await PUT(request({ name: "Shadow", expectedRevision: originalRevision }));
    expect(rejected.status).toBe(409);
    expect((await rejected.json()).code).toBe("settings-managed");
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
    const saved = await PUT(request({ contactEmail: "new@example.org", expectedRevision: originalRevision }));
    expect(saved.status).toBe(200);
    expect(mocks.siteSettings.update).toHaveBeenCalledWith(expect.objectContaining({ data: { contactEmail: "new@example.org" } }));
    expect((await saved.json()).settings.name).toBe("Operator name");
  });

  it("refuses a shadowed email even if the client submits its unchanged value", async () => {
    sources["site.contactEmail"] = "env";
    const response = await PUT(request({ contactEmail: "lab@example.org", expectedRevision: originalRevision }));
    expect(response.status).toBe(409);
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it("trims and saves just the changed identity columns, then returns effective values immediately", async () => {
    const response = await PUT(request({ name: " New lab ", expectedRevision: originalRevision }));
    expect(response.status).toBe(200);
    expect(mocks.siteSettings.update).toHaveBeenCalledWith({
      where: { id: "singleton", updatedAt: new Date(originalRevision) },
      data: { siteName: "New lab" },
      select: { siteName: true, contactEmail: true, updatedAt: true },
    });
    const body = await response.json();
    expect(body.settings).toEqual({ name: "New lab", contactEmail: "lab@example.org" });
    expect(body.revision).toBe(nextRevision);
    expect(mocks.clearConfigCache.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("supports clearing the optional email without touching the name", async () => {
    const response = await PUT(request({ contactEmail: "   ", expectedRevision: originalRevision }));
    expect(response.status).toBe(200);
    expect(mocks.siteSettings.update).toHaveBeenCalledWith(expect.objectContaining({ data: { contactEmail: null } }));
    expect((await response.json()).settings.contactEmail).toBe("");
  });

  it("rejects a stale revision before writing", async () => {
    const response = await PUT(request({ name: "Stale update", expectedRevision: nextRevision }));
    expect(response.status).toBe(409);
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it.each(["P2025", "P2002"])("handles a concurrent write race (%s) as a conflict", async code => {
    mocks.siteSettings.update.mockRejectedValueOnce({ code });
    const response = await PUT(request({ name: "Concurrent update", expectedRevision: originalRevision }));
    expect(response.status).toBe(409);
    expect((await response.json()).code).toBe("settings-conflict");
  });

  it("does not pretend a database failure returned initial-install defaults", async () => {
    mocks.siteSettings.findUnique.mockRejectedValue(new Error("Offline"));
    expect((await GET()).status).toBe(500);
    expect((await PUT(request({ name: "Cannot save", expectedRevision: originalRevision }))).status).toBe(500);
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it("rejects effective-config fallback values inconsistent with stored identity", async () => {
    mocks.effectiveConfig.mockResolvedValue({ config: { site: { name: "SeqDesk" } }, sources: { "site.name": "default" } });
    expect((await GET()).status).toBe(500);
    expect((await PUT(request({ name: "Cannot save", expectedRevision: originalRevision }))).status).toBe(500);
    expect(mocks.siteSettings.update).not.toHaveBeenCalled();
  });

  it("reports a successful write followed by reload failure honestly", async () => {
    mocks.siteSettings.update.mockImplementationOnce(async () => {
      mocks.siteSettings.findUnique.mockRejectedValueOnce(new Error("Read unavailable"));
    });
    const response = await PUT(request({ name: "Saved name", expectedRevision: originalRevision }));
    expect(response.status).toBe(500);
    expect(await response.json()).toMatchObject({ code: "saved-refresh-failed", error: expect.stringContaining("were saved") });
  });
});
