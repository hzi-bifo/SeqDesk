import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/db", () => ({
  db: mocks.db,
}));

import { GET } from "./route";
import { DEFAULT_MODULE_STATES } from "@/lib/modules/types";

describe("GET /api/modules", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns defaults when module config is missing", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: null,
    });

    const response = await GET();

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      modules: DEFAULT_MODULE_STATES,
      globalDisabled: false,
    });
  });

  it("merges modern nested config with defaults", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        modules: {
          "funding-info": true,
        },
        globalDisabled: true,
      }),
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "funding-info": true,
      },
      globalDisabled: true,
    });
  });

  it("supports legacy flat config payloads", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: JSON.stringify({
        "account-validation": true,
      }),
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      modules: {
        ...DEFAULT_MODULE_STATES,
        "account-validation": true,
      },
      globalDisabled: false,
    });
  });

  it("falls back to defaults when stored config is invalid", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue({
      modulesConfig: "{bad-json",
    });

    const response = await GET();

    await expect(response.json()).resolves.toEqual({
      modules: DEFAULT_MODULE_STATES,
      globalDisabled: false,
    });
  });

  it("returns 500 when the database read fails", async () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("db down"));

    const response = await GET();

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to fetch module configuration",
    });
  });
});
