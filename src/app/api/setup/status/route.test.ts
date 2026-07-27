import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fsp } from "fs";
import os from "os";
import path from "path";

const mocks = vi.hoisted(() => ({
  checkDatabaseStatus: vi.fn(),
  autoSeedIfNeeded: vi.fn(),
}));

vi.mock("@/lib/db-status", () => ({
  checkDatabaseStatus: mocks.checkDatabaseStatus,
}));

vi.mock("@/lib/auto-seed", () => ({
  autoSeedIfNeeded: mocks.autoSeedIfNeeded,
}));

import { GET, dynamic, revalidate } from "./route";

describe("GET /api/setup/status", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.DATABASE_URL =
      "postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_test?schema=public";
    process.env.DIRECT_URL = process.env.DATABASE_URL;
  });

  it("exports uncached route settings", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(revalidate).toBe(0);
  });

  it("returns the database status when the seed guard reports nothing to do", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      reason: "configured",
    });
    mocks.autoSeedIfNeeded.mockResolvedValue({ seeded: false });

    const response = await GET();

    expect(response.headers.get("Cache-Control")).toBe("no-store, max-age=0");
    const body = await response.json();
    expect(body).toMatchObject({
      exists: true,
      configured: true,
      phase: "ready",
      nextAction: {
        href: "/login",
      },
    });
    expect(body.bootstrapAccounts).toBeUndefined();
    // Nothing was seeded, so the status is not re-read.
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(1);
  });

  it("does not attempt to seed when the database is not reachable", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: false,
      configured: false,
      reason: "unreachable",
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: false,
      configured: false,
      phase: "database-unreachable",
    });
    expect(mocks.autoSeedIfNeeded).not.toHaveBeenCalled();
  });

  it("seeds a schema-present database that reports configured but has no users", async () => {
    // `configured` only means the site settings row exists. A migrated but
    // never-seeded database looks configured while nothing can log in, so the
    // route must still hand the decision to the seed guard.
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      reason: "configured",
    });
    mocks.autoSeedIfNeeded.mockResolvedValue({
      seeded: true,
      accounts: {
        admin: { kind: "admin", email: "admin@example.com", outcome: "created" },
        researcher: {
          kind: "researcher",
          email: "user@example.com",
          outcome: "created",
        },
      },
    });

    const response = await GET();

    expect(mocks.autoSeedIfNeeded).toHaveBeenCalledTimes(1);
    await expect(response.json()).resolves.toMatchObject({
      configured: true,
      phase: "ready",
      bootstrapAccounts: {
        admin: { outcome: "created" },
        researcher: { outcome: "created" },
      },
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(2);
  });

  it("reports bootstrap accounts that were already present without naming them", async () => {
    mocks.checkDatabaseStatus
      .mockResolvedValueOnce({
        exists: true,
        configured: false,
        reason: "not_seeded",
      })
      .mockResolvedValueOnce({
        exists: true,
        configured: true,
        reason: "configured",
      });
    mocks.autoSeedIfNeeded.mockResolvedValue({
      seeded: true,
      accounts: {
        admin: { kind: "admin", email: "admin@example.com", outcome: "existing" },
        researcher: {
          kind: "researcher",
          email: "user@example.com",
          outcome: "created",
        },
      },
    });

    const response = await GET();

    // This route is unauthenticated, so the response says what happened to each
    // account and nothing else. On a facility install the admin address is a
    // real person's mailbox; an anonymous caller has no business reading it.
    const body = await response.json();
    expect(body).toMatchObject({ configured: true });
    expect(body.bootstrapAccounts).toEqual({
      admin: { kind: "admin", outcome: "existing" },
      researcher: { kind: "researcher", outcome: "created" },
    });
    expect(JSON.stringify(body)).not.toContain("admin@example.com");
    expect(JSON.stringify(body)).not.toContain("user@example.com");
  });

  it("keeps the reason for a skipped account out of the response", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      reason: "configured",
    });
    mocks.autoSeedIfNeeded.mockResolvedValue({
      seeded: true,
      accounts: {
        admin: { kind: "admin", email: "facility@example.org", outcome: "created" },
        researcher: {
          kind: "researcher",
          outcome: "skipped",
          reason: "Disabled by bootstrap configuration",
        },
      },
    });

    const response = await GET();

    const body = await response.json();
    expect(body.bootstrapAccounts).toEqual({
      admin: { kind: "admin", outcome: "created" },
      researcher: { kind: "researcher", outcome: "skipped" },
    });
    expect(JSON.stringify(body)).not.toContain("facility@example.org");
  });

  it("re-checks status after a successful auto-seed", async () => {
    mocks.checkDatabaseStatus
      .mockResolvedValueOnce({
        exists: true,
        configured: false,
        reason: "not_seeded",
      })
      .mockResolvedValueOnce({
        exists: true,
        configured: true,
        reason: "configured",
      });
    mocks.autoSeedIfNeeded.mockResolvedValue({ seeded: true });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: true,
      phase: "ready",
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(2);
  });

  it("surfaces an auto-seed result error without re-checking", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: false,
      reason: "not_seeded",
    });
    mocks.autoSeedIfNeeded.mockResolvedValue({
      seeded: false,
      error: "Seeding already in progress",
    });

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: false,
      phase: "seeding",
      error: "Seeding already in progress",
    });
    expect(mocks.checkDatabaseStatus).toHaveBeenCalledTimes(1);
  });

  it("handles thrown auto-seed errors", async () => {
    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: false,
      reason: "not_seeded",
    });
    mocks.autoSeedIfNeeded.mockRejectedValue(new Error("Automatic seeding failed hard"));

    const response = await GET();

    await expect(response.json()).resolves.toMatchObject({
      exists: true,
      configured: false,
      phase: "seed-failed",
      error: "Automatic seeding failed hard",
    });
  });
});

// The route above is unauthenticated and seeds whenever the schema is
// reachable. These run it against the real seed guard, because the hole this
// pins was in the combination: a bootstrap entry left without a password plus a
// guard that seeds a database which already has settings rows.
describe("GET /api/setup/status against the real seed guard", () => {
  const dbMock = {
    siteSettings: { findUnique: vi.fn(), update: vi.fn(), upsert: vi.fn() },
    user: { findUnique: vi.fn(), count: vi.fn(), upsert: vi.fn() },
    orderFormConfig: { upsert: vi.fn() },
  };

  let cwdBefore = "";
  let tempInstallDir = "";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(async () => {
    if (cwdBefore) {
      process.chdir(cwdBefore);
      cwdBefore = "";
    }
    if (tempInstallDir) {
      await fsp.rm(tempInstallDir, { recursive: true, force: true });
      tempInstallDir = "";
    }
  });

  async function loadRouteWithRealSeed(settings: unknown) {
    tempInstallDir = await fsp.mkdtemp(path.join(os.tmpdir(), "seqdesk-setup-status-"));
    await fsp.writeFile(
      path.join(tempInstallDir, "settings.json"),
      JSON.stringify(settings, null, 2),
      "utf8"
    );
    cwdBefore = process.cwd();
    process.chdir(tempInstallDir);

    vi.doUnmock("@/lib/auto-seed");
    vi.doMock("@/lib/db", () => ({ db: dbMock }));
    vi.resetModules();
    return (await import("./route")).GET;
  }

  it("does not let an anonymous request create a default-password admin", async () => {
    // settings.json still names the accounts, but the installer removed the
    // password hashes it could not apply to the database it attached to. The
    // database has settings rows and no users -- the state the widened guard
    // seeds. Falling back to the shipped hash here would create
    // admin@example.com with the documented password `admin`, on nothing more
    // than an unauthenticated GET.
    const liveGET = await loadRouteWithRealSeed({
      bootstrap: {
        users: {
          admin: { email: "admin@example.com", firstName: "Admin" },
          researcher: { email: "user@example.com" },
        },
      },
    });

    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      reason: "configured",
    });
    dbMock.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    dbMock.user.count.mockResolvedValue(0);
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.user.upsert.mockResolvedValue({});

    const body = await (await liveGET()).json();

    expect(dbMock.user.upsert).not.toHaveBeenCalled();
    expect(body.bootstrapAccounts).toEqual({
      admin: { kind: "admin", outcome: "refused" },
      researcher: { kind: "researcher", outcome: "refused" },
    });
    expect(JSON.stringify(body)).not.toContain("admin@example.com");
  });

  it("still fills in an account whose password this install configured", async () => {
    // The legitimate case the guard was widened for: migrated and configured,
    // but never seeded, with a password of this install's own.
    const liveGET = await loadRouteWithRealSeed({
      bootstrap: {
        users: {
          admin: { email: "facility@example.org", passwordHash: "$2b$12$configured-admin-hash" },
          researcher: false,
        },
      },
    });

    mocks.checkDatabaseStatus.mockResolvedValue({
      exists: true,
      configured: true,
      reason: "configured",
    });
    dbMock.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    dbMock.user.count.mockResolvedValue(0);
    dbMock.user.findUnique.mockResolvedValue(null);
    dbMock.user.upsert.mockResolvedValue({});

    const body = await (await liveGET()).json();

    expect(dbMock.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "facility@example.org" },
        update: {},
        create: expect.objectContaining({ password: "$2b$12$configured-admin-hash" }),
      })
    );
    expect(body.bootstrapAccounts).toEqual({
      admin: { kind: "admin", outcome: "created" },
      researcher: { kind: "researcher", outcome: "skipped" },
    });
  });
});
