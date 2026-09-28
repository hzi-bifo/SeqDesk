import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: { siteSettings: { findUnique: vi.fn(), upsert: vi.fn() } },
}));
vi.mock("next-auth", () => ({ getServerSession: mocks.getServerSession }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/db", () => ({ db: mocks.db }));

import { GET, PUT } from "./route";
import { decryptSecret, isEncrypted } from "@/lib/security/secret-store";

process.env.NEXTAUTH_SECRET ||= "test-secret-for-secret-store-unit-tests";
const admin = { user: { id: "admin-1", role: "FACILITY_ADMIN" } };
const KEY = "abcdef0123456789abcdef0123456789ab";
const put = (body: unknown) => PUT(new Request("http://x/api/admin/settings/ncbi", { method: "PUT", body: JSON.stringify(body) }));

describe("/api/admin/settings/ncbi", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    let stored: string | null = JSON.stringify({ ena: { centerName: "HZI" } });
    mocks.db.siteSettings.findUnique.mockImplementation(async () => ({ extraSettings: stored }));
    mocks.db.siteSettings.upsert.mockImplementation(async ({ update }: { update: { extraSettings: string } }) => { stored = update.extraSettings; });
  });

  it("is for administrators only", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "u", role: "RESEARCHER" } });
    expect((await GET()).status).toBe(403);
    expect((await put({ apiKey: KEY })).status).toBe(403);
  });

  it("stores the key encrypted next to other settings and never returns it", async () => {
    mocks.getServerSession.mockResolvedValue(admin);
    const saved = await put({ apiKey: KEY });
    const body = await saved.json();
    expect(body).toEqual({ hasKey: true, source: "settings", requestsPerSecond: 10 });
    expect(JSON.stringify(body)).not.toContain(KEY);
    const extra = JSON.parse(mocks.db.siteSettings.upsert.mock.calls[0][0].update.extraSettings);
    expect(extra.ena).toEqual({ centerName: "HZI" });
    expect(isEncrypted(extra.ncbi.apiKey)).toBe(true);
    expect(decryptSecret(extra.ncbi.apiKey)).toBe(KEY);
    const removed = await (await put({ apiKey: "" })).json();
    expect(removed).toMatchObject({ hasKey: false, requestsPerSecond: 3 });
  });

  it("refuses something that is not a key", async () => {
    mocks.getServerSession.mockResolvedValue(admin);
    expect((await put({ apiKey: "short key!" })).status).toBe(400);
    expect(mocks.db.siteSettings.upsert).not.toHaveBeenCalled();
  });
});
