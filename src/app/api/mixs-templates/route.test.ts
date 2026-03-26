import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const mocks = vi.hoisted(() => ({
  getServerSession: vi.fn(),
  existsSync: vi.fn(),
  readdirSync: vi.fn(),
  readFileSync: vi.fn(),
}));

vi.mock("next-auth", () => ({
  getServerSession: mocks.getServerSession,
}));

vi.mock("@/lib/auth", () => ({
  authOptions: {},
}));

vi.mock("fs", () => ({
  default: {
    existsSync: mocks.existsSync,
    readdirSync: mocks.readdirSync,
    readFileSync: mocks.readFileSync,
  },
  existsSync: mocks.existsSync,
  readdirSync: mocks.readdirSync,
  readFileSync: mocks.readFileSync,
}));

import { GET } from "./route";

describe("GET /api/mixs-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const request = new NextRequest("http://localhost:3000/api/mixs-templates");
    const response = await GET(request);

    expect(response.status).toBe(401);
  });

  it("returns MIxS templates from JSON files", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readdirSync.mockReturnValue([
      { name: "mixs-soil.json", isDirectory: () => false },
      { name: "general.json", isDirectory: () => false },
    ]);
    mocks.readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes("mixs-soil")) {
        return JSON.stringify({
          name: "MIxS Soil",
          description: "Soil",
          version: "6",
          category: "mixs",
          fields: [{ type: "text", label: "Depth", name: "depth", required: true, visible: true }],
        });
      }
      return JSON.stringify({
        name: "General",
        description: "General fields",
        version: "1",
        fields: [],
      });
    });

    const request = new NextRequest("http://localhost:3000/api/mixs-templates");
    const response = await GET(request);
    const data = await response.json();

    expect(response.status).toBe(200);
    // Only MIxS templates (category === "mixs") should be returned
    expect(data.templates).toHaveLength(1);
    expect(data.templates[0].name).toBe("MIxS Soil");
  });

  it("returns 404 when filtering by name with no match", async () => {
    mocks.existsSync.mockReturnValue(true);
    mocks.readdirSync.mockReturnValue([
      { name: "mixs-soil.json", isDirectory: () => false },
    ]);
    mocks.readFileSync.mockReturnValue(
      JSON.stringify({
        name: "MIxS Soil",
        description: "Soil",
        version: "6",
        category: "mixs",
        fields: [],
      })
    );

    const request = new NextRequest(
      "http://localhost:3000/api/mixs-templates?name=NonExistent"
    );
    const response = await GET(request);

    expect(response.status).toBe(404);
  });
});
