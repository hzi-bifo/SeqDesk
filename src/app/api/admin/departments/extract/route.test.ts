import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    department: {
      findMany: vi.fn(),
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

vi.mock("@/lib/config/runtime-env", () => ({
  bootstrapRuntimeEnv: vi.fn(),
}));

// Mock global fetch
const originalFetch = globalThis.fetch;

import { POST } from "./route";

describe("POST /api/admin/departments/extract", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch;
    mocks.getServerSession.mockResolvedValue({
      user: { id: "admin-1", role: "FACILITY_ADMIN" },
    });
    mocks.db.department.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "user-1", role: "RESEARCHER" },
    });

    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(401);
  });

  it("returns 400 when URL is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({}),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("URL is required");
  });

  it("returns 400 when URL is invalid", async () => {
    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "not-a-url" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toBe("Invalid URL");
  });

  it("returns 503 when ANTHROPIC_API_KEY is not set", async () => {
    const originalKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/departments" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error).toContain("not configured");

    if (originalKey !== undefined) process.env.ANTHROPIC_API_KEY = originalKey;
  });

  it("extracts departments and marks duplicates on happy path", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    // Mock webpage fetch
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body><h1>Departments</h1><p>Microbiology Group</p></body></html>",
    });

    // Mock Anthropic API call
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            name: "department_list",
            input: {
              departments: [
                { name: "Microbiology Group", description: "Studies microbes" },
                { name: "Genomics Lab", description: null },
              ],
              source_info: "Institute overview page",
            },
          },
        ],
      }),
    });

    // One existing department to test duplicate detection
    mocks.db.department.findMany.mockResolvedValue([
      { name: "Microbiology Group" },
    ]);

    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/departments" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);

    const json = await response.json();
    expect(json.departments).toHaveLength(2);
    expect(json.departments[0].name).toBe("Microbiology Group");
    expect(json.departments[0].isDuplicate).toBe(true);
    expect(json.departments[1].name).toBe("Genomics Lab");
    expect(json.departments[1].isDuplicate).toBe(false);
    expect(json.sourceInfo).toBe("Institute overview page");
    expect(json.url).toBe("https://example.com/departments");
  });

  it("returns 400 when webpage fetch fails", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      status: 404,
    });

    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/not-found" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("Failed to fetch webpage");
  });

  it("returns 503 when Anthropic API returns error", async () => {
    process.env.ANTHROPIC_API_KEY = "test-key";

    // Webpage fetch succeeds
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      text: async () => "<html><body>Content</body></html>",
    });

    // Anthropic API fails
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Rate limited",
    });

    const request = new NextRequest("http://localhost:3000/api/admin/departments/extract", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ url: "https://example.com/departments" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error).toBe("AI service temporarily unavailable");
  });
});
