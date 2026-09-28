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
const admin = { user: { id: "admin-1", name: "Mateus Oliveira", role: "FACILITY_ADMIN" } };
const put = (body: unknown) => PUT(new Request("http://x/api/admin/settings/dryad", { method: "PUT", body: JSON.stringify(body) }));

describe("/api/admin/settings/dryad", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.unstubAllEnvs();
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_ID", "");
    vi.stubEnv("SEQDESK_DRYAD_CLIENT_SECRET", "");
    let stored: string | null = JSON.stringify({ ena: { centerName: "HZI" } });
    mocks.db.siteSettings.findUnique.mockImplementation(async () => ({ extraSettings: stored }));
    mocks.db.siteSettings.upsert.mockImplementation(async ({ update }: { update: { extraSettings: string } }) => { stored = update.extraSettings; });
  });

  it("is for administrators only", async () => {
    mocks.getServerSession.mockResolvedValue({ user: { id: "u", role: "RESEARCHER" } });
    expect((await GET()).status).toBe(403);
    expect((await put({ clientId: "client-id-1", clientSecret: "client-secret-1" })).status).toBe(403);
  });

  it("stores the account encrypted, never returns it, and names who changed it", async () => {
    mocks.getServerSession.mockResolvedValue(admin);
    const body = await (await put({ clientId: "client-id-1", clientSecret: "client-secret-1" })).json();
    expect(body).toMatchObject({ hasAccount: true, source: "settings", changedBy: "Mateus Oliveira" });
    expect(JSON.stringify(body)).not.toContain("client-secret-1");
    const extra = JSON.parse(mocks.db.siteSettings.upsert.mock.calls.at(-1)![0].update.extraSettings);
    expect(extra.ena).toEqual({ centerName: "HZI" });
    expect(isEncrypted(extra.dryad.clientSecret)).toBe(true);
    expect(decryptSecret(extra.dryad.clientId)).toBe("client-id-1");
    expect(await (await put({ clientId: "", clientSecret: "" })).json()).toMatchObject({ hasAccount: false });
  });

  it("refuses half an account", async () => {
    mocks.getServerSession.mockResolvedValue(admin);
    expect((await put({ clientId: "client-id-1", clientSecret: "" })).status).toBe(400);
  });
});
