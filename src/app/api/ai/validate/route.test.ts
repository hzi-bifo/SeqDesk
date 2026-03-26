import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
  fetch: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

vi.mock("@/lib/config/runtime-env", () => ({
  bootstrapRuntimeEnv: vi.fn(),
}));

const originalFetch = globalThis.fetch;

import { POST, GET } from "./route";

describe("POST /api/ai/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    globalThis.fetch = mocks.fetch;
    // Default: AI module enabled, API key set
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({ modules: { "ai-validation": true }, globalDisabled: false }),
    });
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("returns 400 when value is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/ai/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ prompt: "Check this field" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("required");
  });

  it("returns 400 when prompt is missing", async () => {
    const request = new NextRequest("http://localhost:3000/api/ai/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "some value" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
    const json = await response.json();
    expect(json.error).toContain("required");
  });

  it("returns valid=true with moduleDisabled when AI module is disabled", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({ modules: { "ai-validation": false }, globalDisabled: false }),
    });

    const request = new NextRequest("http://localhost:3000/api/ai/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "test", prompt: "Validate this", fieldLabel: "Name" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.valid).toBe(true);
    expect(json.moduleDisabled).toBe(true);
  });

  it("returns valid=true when API key is not configured", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const request = new NextRequest("http://localhost:3000/api/ai/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "test", prompt: "Validate this", fieldLabel: "Name" }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.valid).toBe(true);
    expect(json.configured).toBe(false);
  });

  it("returns validation result on happy path", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        content: [
          {
            type: "tool_use",
            name: "validation_result",
            input: {
              valid: true,
              message: "The input looks correct.",
            },
          },
        ],
      }),
    });

    const request = new NextRequest("http://localhost:3000/api/ai/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: "Escherichia coli",
        fieldLabel: "Species",
        prompt: "A valid species name",
        strictness: "moderate",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.valid).toBe(true);
    expect(json.message).toBe("The input looks correct.");
    expect(json.configured).toBe(true);
  });

  it("returns 503 when Anthropic API fails", async () => {
    mocks.fetch.mockResolvedValueOnce({
      ok: false,
      text: async () => "Internal Server Error",
    });

    const request = new NextRequest("http://localhost:3000/api/ai/validate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        value: "test value",
        fieldLabel: "Field",
        prompt: "Validate",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(503);
    const json = await response.json();
    expect(json.error).toContain("unavailable");
  });
});

describe("GET /api/ai/validate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({ modules: { "ai-validation": true }, globalDisabled: false }),
    });
    process.env.ANTHROPIC_API_KEY = "test-key";
  });

  it("returns configured=true when API key is set and module enabled", async () => {
    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.configured).toBe(true);
    expect(json.moduleDisabled).toBe(false);
  });

  it("returns configured=false and moduleDisabled=true when module is disabled", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({ modules: { "ai-validation": false }, globalDisabled: false }),
    });

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.configured).toBe(false);
    expect(json.moduleDisabled).toBe(true);
  });

  it("returns configured=false when API key is missing", async () => {
    delete process.env.ANTHROPIC_API_KEY;

    const response = await GET();
    expect(response.status).toBe(200);
    const json = await response.json();
    expect(json.configured).toBe(false);
    expect(json.moduleDisabled).toBe(false);
  });
});
