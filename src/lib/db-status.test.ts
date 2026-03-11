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

describe("checkDatabaseStatus", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    delete process.env.DATABASE_URL;
    delete process.env.DIRECT_URL;
  });

  it("returns a configuration error before touching Prisma when DATABASE_URL is missing", async () => {
    const result = await checkDatabaseStatus();

    expect(result).toEqual({
      exists: false,
      configured: false,
      error:
        "DATABASE_URL is not configured. SeqDesk now requires a PostgreSQL connection string.",
    });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("returns a configuration error for legacy SQLite URLs", async () => {
    process.env.DATABASE_URL = "file:./dev.db";

    const result = await checkDatabaseStatus();

    expect(result).toEqual({
      exists: false,
      configured: false,
      error:
        "SQLite is no longer supported. Configure PostgreSQL via DATABASE_URL. Use DIRECT_URL for migrations if your runtime URL is pooled.",
    });
    expect(mocks.db.siteSettings.findUnique).not.toHaveBeenCalled();
  });

  it("reports a configured database when SiteSettings exists", async () => {
    process.env.DATABASE_URL =
      "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk?schema=public";
    mocks.db.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });

    const result = await checkDatabaseStatus();

    expect(result).toEqual({
      exists: true,
      configured: true,
    });
  });
});
