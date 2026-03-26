import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  fetch: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { POST } from "./route";

function makeRequest(body?: unknown) {
  return new Request("http://localhost:3000/api/admin/settings/ena/test", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
}

describe("POST /api/admin/settings/ena/test", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);
    mocks.fetch.mockResolvedValue({
      status: 200,
      text: async () => '<RECEIPT success="true"/>',
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await POST(makeRequest({ enaUsername: "Webin-12345", enaPassword: "pass" }));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ error: "Unauthorized" });
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await POST(makeRequest({ enaUsername: "Webin-12345", enaPassword: "pass" }));

    expect(response.status).toBe(401);
  });

  it("succeeds with credentials in request body", async () => {
    const response = await POST(
      makeRequest({ enaUsername: "Webin-12345", enaPassword: "secret" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.message).toContain("Credentials verified");
    expect(data.username).toBe("Webin-12345");
    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining("wwwdev.ebi.ac.uk"),
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("uses production server when enaTestMode is false", async () => {
    await POST(
      makeRequest({
        enaUsername: "Webin-12345",
        enaPassword: "secret",
        enaTestMode: false,
      })
    );

    expect(mocks.fetch).toHaveBeenCalledWith(
      expect.stringContaining("www.ebi.ac.uk"),
      expect.anything(),
    );
  });

  it("falls back to saved credentials when no body credentials", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-99999",
      enaPassword: "saved-pass",
      enaTestMode: true,
    });

    const response = await POST(makeRequest({}));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.username).toBe("Webin-99999");
  });

  it("uses saved password with body username when useSavedPassword is true", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-11111",
      enaPassword: "saved-pass",
      enaTestMode: true,
    });

    const response = await POST(
      makeRequest({
        enaUsername: "Webin-22222",
        useSavedPassword: true,
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(true);
    expect(data.username).toBe("Webin-22222");
  });

  it("returns error when useSavedPassword but no saved password exists", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: "Webin-11111",
      enaPassword: null,
      enaTestMode: true,
    });

    const response = await POST(
      makeRequest({
        enaUsername: "Webin-22222",
        useSavedPassword: true,
      })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toContain("No saved password found");
  });

  it("returns error when no credentials available at all", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    const response = await POST(makeRequest({}));
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toBe("ENA credentials not provided");
  });

  it("returns error when saved credentials have no username", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      enaUsername: null,
      enaPassword: "pass",
      enaTestMode: true,
    });

    const response = await POST(makeRequest({}));
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toBe("ENA credentials not provided");
  });

  it("rejects invalid username format", async () => {
    const response = await POST(
      makeRequest({ enaUsername: "invalid-user", enaPassword: "pass" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid username format");
    expect(data.error).toContain("invalid-user");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("returns error when ENA returns 401", async () => {
    mocks.fetch.mockResolvedValue({
      status: 401,
      text: async () => "Unauthorized",
    });

    const response = await POST(
      makeRequest({ enaUsername: "Webin-12345", enaPassword: "wrong" })
    );
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toContain("Invalid credentials");
  });

  it("detects authentication error in ENA response body", async () => {
    mocks.fetch.mockResolvedValue({
      status: 200,
      text: async () => "Authentication failed for user",
    });

    const response = await POST(
      makeRequest({ enaUsername: "Webin-12345", enaPassword: "bad" })
    );
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication failed");
  });

  it("detects unauthorized in ENA response body", async () => {
    mocks.fetch.mockResolvedValue({
      status: 200,
      text: async () => "Unauthorized access",
    });

    const response = await POST(
      makeRequest({ enaUsername: "Webin-12345", enaPassword: "bad" })
    );
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toContain("Authentication failed");
  });

  it("returns ENA status code for other errors", async () => {
    mocks.fetch.mockResolvedValue({
      status: 503,
      text: async () => "Service unavailable",
    });

    const response = await POST(
      makeRequest({ enaUsername: "Webin-12345", enaPassword: "pass" })
    );
    const data = await response.json();

    expect(data.success).toBe(false);
    expect(data.error).toContain("503");
  });

  it("handles success='false' response as valid credentials", async () => {
    mocks.fetch.mockResolvedValue({
      status: 200,
      text: async () => '<RECEIPT success="false"><MESSAGES><ERROR>Invalid XML</ERROR></MESSAGES></RECEIPT>',
    });

    const response = await POST(
      makeRequest({ enaUsername: "Webin-12345", enaPassword: "pass" })
    );
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.message).toContain("Credentials verified");
  });

  it("handles fetch error gracefully", async () => {
    mocks.fetch.mockRejectedValue(new Error("Network timeout"));

    const response = await POST(
      makeRequest({ enaUsername: "Webin-12345", enaPassword: "pass" })
    );
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.success).toBe(false);
    expect(data.error).toBe("Network timeout");
  });

  it("trims whitespace from credentials", async () => {
    const response = await POST(
      makeRequest({ enaUsername: "  Webin-12345  ", enaPassword: "  pass  " })
    );
    const data = await response.json();

    expect(data.success).toBe(true);
    expect(data.username).toBe("Webin-12345");
  });
});
