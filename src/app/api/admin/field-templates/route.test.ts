import { beforeEach, describe, expect, it, vi } from "vitest";

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

describe("GET /api/admin/field-templates", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns 401 when not authenticated", async () => {
    mocks.getServerSession.mockResolvedValue(null);

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns 401 when user is not FACILITY_ADMIN", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "RESEARCHER" },
    });

    const response = await GET();

    expect(response.status).toBe(401);
  });

  it("returns templates sorted from JSON files", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.existsSync.mockReturnValue(true);
    mocks.readdirSync.mockReturnValue(["b-template.json", "a-template.json"]);
    mocks.readFileSync.mockImplementation((filePath: string) => {
      if (filePath.includes("b-template")) {
        return JSON.stringify({
          name: "Beta",
          description: "B",
          version: "1",
          fields: [],
        });
      }
      return JSON.stringify({
        name: "Alpha",
        description: "A",
        version: "1",
        fields: [],
      });
    });

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.templates).toHaveLength(2);
    expect(data.templates[0].name).toBe("Alpha");
  });

  it("returns empty array when directory does not exist", async () => {
    mocks.getServerSession.mockResolvedValue({
      user: { id: "u1", role: "FACILITY_ADMIN" },
    });
    mocks.existsSync.mockReturnValue(false);

    const response = await GET();
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data.templates).toEqual([]);
  });
});
