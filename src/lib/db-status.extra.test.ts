import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  bootstrapRuntimeEnv: vi.fn(),
  db: {
    siteSettings: {
      findUnique: vi.fn(),
    },
  },
}));

vi.mock("@/lib/config/runtime-env", () => ({
  bootstrapRuntimeEnv: mocks.bootstrapRuntimeEnv,
}));

vi.mock("./db", () => ({
  db: mocks.db,
}));

import { checkDatabaseStatus } from "./db-status";

describe("checkDatabaseStatus additional cases", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL =
      "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public";
  });

  it("reports an existing database that still needs seeding", async () => {
    mocks.db.siteSettings.findUnique.mockResolvedValue(null);

    await expect(checkDatabaseStatus()).resolves.toEqual({
      exists: true,
      configured: false,
      error: "Database exists but has not been seeded with initial data.",
    });
  });

  it("maps connection failures to the PostgreSQL unreachable message", async () => {
    mocks.db.siteSettings.findUnique.mockRejectedValue(
      new Error("P1001: Can't reach database server")
    );

    await expect(checkDatabaseStatus()).resolves.toEqual({
      exists: false,
      configured: false,
      error:
        "PostgreSQL is unreachable. Verify DATABASE_URL and DIRECT_URL, then retry.",
    });
  });

  it("maps missing schema errors to the migrate-deploy message", async () => {
    mocks.db.siteSettings.findUnique.mockRejectedValue(
      new Error('relation "SiteSettings" does not exist')
    );

    await expect(checkDatabaseStatus()).resolves.toEqual({
      exists: false,
      configured: false,
      error: "Database schema is missing. Run `npm run db:migrate:deploy` first.",
    });
  });

  it("returns unknown errors verbatim", async () => {
    mocks.db.siteSettings.findUnique.mockRejectedValue(new Error("boom"));

    await expect(checkDatabaseStatus()).resolves.toEqual({
      exists: false,
      configured: false,
      error: "boom",
    });
  });

  it("stringifies non-Error throws", async () => {
    mocks.db.siteSettings.findUnique.mockRejectedValue("plain failure");

    await expect(checkDatabaseStatus()).resolves.toEqual({
      exists: false,
      configured: false,
      error: "plain failure",
    });
  });
});
