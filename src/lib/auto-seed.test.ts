import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { promises as fsp } from "fs";
import os from "os";
import path from "path";

// The hashes SeqDesk ships, i.e. the documented `admin` / `user` passwords.
// Anything that puts one of these into a database that did not ask for it is
// the regression these tests exist for.
const DEFAULT_ADMIN_PASSWORD_HASH =
  "$2b$12$x9euVVfr0IcQPHFKwCDO3OTz0cGPvO0AwwsgUnHOLmSVuT3wM1VzC";
const DEFAULT_USER_PASSWORD_HASH =
  "$2b$12$kbd8ye8jMpaIwxH8nVP79u/witxktRivlfVQ59IlUzyzVKCVIox2m";

const BOOTSTRAP_ENV_KEYS = [
  "SEQDESK_BOOTSTRAP_ADMIN_EMAIL",
  "SEQDESK_BOOTSTRAP_ADMIN_PASSWORD",
  "SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH",
  "SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME",
  "SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME",
  "SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME",
  "SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL",
  "SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD",
  "SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH",
  "SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME",
  "SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME",
  "SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION",
  "SEQDESK_BOOTSTRAP_RESEARCHER_ROLE",
  "SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED",
];

// Mock the db module before importing
const mockDb = {
  siteSettings: {
    findUnique: vi.fn(),
    update: vi.fn(),
    upsert: vi.fn(),
  },
  user: {
    upsert: vi.fn(),
    findUnique: vi.fn(),
    count: vi.fn(),
  },
  orderFormConfig: {
    upsert: vi.fn(),
  },
};

vi.mock("./db", () => ({ db: mockDb }));

// Use a fresh import for each test to reset the module-level seedingInProgress flag
let autoSeedIfNeeded: typeof import("./auto-seed").autoSeedIfNeeded;

beforeEach(async () => {
  vi.resetAllMocks();
  for (const key of BOOTSTRAP_ENV_KEYS) {
    delete process.env[key];
  }
  // Reset the module to clear the seedingInProgress flag
  vi.resetModules();
  vi.mock("./db", () => ({ db: mockDb }));
  const mod = await import("./auto-seed");
  autoSeedIfNeeded = mod.autoSeedIfNeeded;
});

let cwdBefore = "";
let tempInstallDir = "";

/**
 * Run the next seed pass from an install directory of our own, optionally with
 * a settings.json in it. The seed reads its bootstrap configuration relative to
 * the working directory, so this is what decides whether an account is
 * "configured" -- and it keeps the tests off whatever config file happens to
 * sit in the checkout.
 */
async function useInstallDir(config?: unknown): Promise<void> {
  tempInstallDir = await fsp.mkdtemp(path.join(os.tmpdir(), "seqdesk-auto-seed-"));
  if (config !== undefined) {
    await fsp.writeFile(
      path.join(tempInstallDir, "settings.json"),
      JSON.stringify(config, null, 2),
      "utf8"
    );
  }
  cwdBefore = process.cwd();
  process.chdir(tempInstallDir);
}

/** Every password this pass would have written into the database. */
function upsertedPasswords(): unknown[] {
  return mockDb.user.upsert.mock.calls.map(([args]) => args?.create?.password);
}

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

/** Mock a database that has never been seeded: no settings, no users. */
function mockEmptyDatabase() {
  mockDb.siteSettings.findUnique.mockResolvedValue(null);
  mockDb.user.findUnique.mockResolvedValue(null);
  mockDb.user.count.mockResolvedValue(0);
  mockDb.user.upsert.mockResolvedValue({});
  mockDb.siteSettings.upsert.mockResolvedValue({});
  mockDb.orderFormConfig.upsert.mockResolvedValue({});
  mockDb.siteSettings.update.mockResolvedValue({});
}

describe("autoSeedIfNeeded", () => {
  it("returns seeded: false when site settings and users already exist", async () => {
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    mockDb.user.count.mockResolvedValue(4);

    const result = await autoSeedIfNeeded();

    expect(result).toEqual({ seeded: false });
    expect(mockDb.user.upsert).not.toHaveBeenCalled();
  });

  it("does not re-query the database once the install is confirmed bootstrapped", async () => {
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    mockDb.user.count.mockResolvedValue(4);

    await autoSeedIfNeeded();
    const second = await autoSeedIfNeeded();

    expect(second).toEqual({ seeded: false });
    expect(mockDb.siteSettings.findUnique).toHaveBeenCalledTimes(1);
    expect(mockDb.user.count).toHaveBeenCalledTimes(1);
  });

  it("uses configured bootstrap account metadata and password hashes", async () => {
    process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL = "facility@example.org";
    process.env.SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH = "$2b$12$admin-profile-hash";
    process.env.SEQDESK_BOOTSTRAP_ADMIN_FIRST_NAME = "Facility";
    process.env.SEQDESK_BOOTSTRAP_ADMIN_LAST_NAME = "Owner";
    process.env.SEQDESK_BOOTSTRAP_ADMIN_FACILITY_NAME = "SeqDesk Dev";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_EMAIL = "researcher@example.org";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH = "$2b$12$researcher-profile-hash";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_FIRST_NAME = "Internal";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_LAST_NAME = "User";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_INSTITUTION = "HZI";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_ROLE = "POSTDOC";

    vi.resetModules();
    vi.mock("./db", () => ({ db: mockDb }));
    const mod = await import("./auto-seed");
    autoSeedIfNeeded = mod.autoSeedIfNeeded;

    mockEmptyDatabase();

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(true);
    expect(result.accounts).toEqual({
      admin: { kind: "admin", email: "facility@example.org", outcome: "created" },
      researcher: {
        kind: "researcher",
        email: "researcher@example.org",
        outcome: "created",
      },
    });
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "facility@example.org" },
        create: expect.objectContaining({
          email: "facility@example.org",
          password: "$2b$12$admin-profile-hash",
          firstName: "Facility",
          lastName: "Owner",
          facilityName: "SeqDesk Dev",
          role: "FACILITY_ADMIN",
        }),
      })
    );
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "researcher@example.org" },
        create: expect.objectContaining({
          email: "researcher@example.org",
          password: "$2b$12$researcher-profile-hash",
          firstName: "Internal",
          lastName: "User",
          institution: "HZI",
          researcherRole: "POSTDOC",
          role: "RESEARCHER",
        }),
      })
    );
  });

  it("seeds database when no site settings exist", async () => {
    // A deliberately unconfigured install: nothing names an account, so the
    // documented default credentials are the intended ones and still apply.
    await useInstallDir();
    mockEmptyDatabase();

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(true);
    // Both bootstrap accounts are reported as freshly created, so the
    // credentials the installer prints are the ones now stored.
    expect(result.accounts).toEqual({
      admin: { kind: "admin", email: "admin@example.com", outcome: "created" },
      researcher: {
        kind: "researcher",
        email: "user@example.com",
        outcome: "created",
      },
    });
    // Should create admin and test user
    expect(mockDb.user.upsert).toHaveBeenCalledTimes(2);
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "admin@example.com" },
        create: expect.objectContaining({
          role: "FACILITY_ADMIN",
          password: DEFAULT_ADMIN_PASSWORD_HASH,
        }),
      })
    );
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "user@example.com" },
        create: expect.objectContaining({
          role: "RESEARCHER",
          password: DEFAULT_USER_PASSWORD_HASH,
        }),
      })
    );
    // Should create site settings
    expect(mockDb.siteSettings.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "singleton" },
        create: expect.objectContaining({
          siteName: "SeqDesk",
        }),
      })
    );
    // Should create order form config
    expect(mockDb.orderFormConfig.upsert).toHaveBeenCalledOnce();
    // Should update site settings with study form config
    expect(mockDb.siteSettings.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "singleton" },
        data: expect.objectContaining({
          extraSettings: expect.any(String),
        }),
      })
    );
  });

  it("does not create a researcher when bootstrap configuration disables it", async () => {
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_ENABLED = "0";
    await useInstallDir();
    mockEmptyDatabase();

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(true);
    expect(result.accounts?.researcher).toEqual({
      kind: "researcher",
      outcome: "skipped",
      reason: "Disabled by bootstrap configuration",
    });
    expect(mockDb.user.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "admin@example.com" },
      })
    );
  });

  it("reports a pre-existing bootstrap account and leaves its password alone", async () => {
    process.env.SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH = "$2b$12$fresh-install-hash";
    vi.resetModules();
    vi.mock("./db", () => ({ db: mockDb }));
    const mod = await import("./auto-seed");
    autoSeedIfNeeded = mod.autoSeedIfNeeded;

    await useInstallDir();
    mockEmptyDatabase();
    // The attached database already holds the admin account from an earlier
    // install; the researcher is new.
    mockDb.user.findUnique.mockImplementation(async ({ where }: { where: { email: string } }) =>
      where.email === "admin@example.com" ? { id: "existing-admin" } : null
    );

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(true);
    expect(result.accounts).toEqual({
      admin: { kind: "admin", email: "admin@example.com", outcome: "existing" },
      researcher: {
        kind: "researcher",
        email: "user@example.com",
        outcome: "created",
      },
    });
    // The stored hash must survive: the upsert may only fill in a missing row.
    const adminUpsert = mockDb.user.upsert.mock.calls.find(
      ([args]) => args.where.email === "admin@example.com"
    );
    expect(adminUpsert?.[0].update).toEqual({});
    expect(adminUpsert?.[0].create.password).toBe("$2b$12$fresh-install-hash");
  });

  it("creates bootstrap accounts when the schema is present but has no users", async () => {
    // Migrated (and settings written) but never seeded: nothing can log in.
    // This install configured a password for both accounts -- what the
    // installer does -- so they can be filled in.
    process.env.SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH = "$2b$12$install-admin-hash";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH = "$2b$12$install-researcher-hash";
    await useInstallDir();
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    mockDb.user.count.mockResolvedValue(0);
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.upsert.mockResolvedValue({});

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(true);
    expect(result.accounts).toEqual({
      admin: { kind: "admin", email: "admin@example.com", outcome: "created" },
      researcher: {
        kind: "researcher",
        email: "user@example.com",
        outcome: "created",
      },
    });
    expect(mockDb.user.upsert).toHaveBeenCalledTimes(2);
    expect(upsertedPasswords()).toEqual([
      "$2b$12$install-admin-hash",
      "$2b$12$install-researcher-hash",
    ]);
    // Existing site settings and form configuration are not rewritten.
    expect(mockDb.siteSettings.upsert).not.toHaveBeenCalled();
    expect(mockDb.siteSettings.update).not.toHaveBeenCalled();
    expect(mockDb.orderFormConfig.upsert).not.toHaveBeenCalled();
  });

  it("stops after filling in the missing accounts instead of seeding repeatedly", async () => {
    process.env.SEQDESK_BOOTSTRAP_ADMIN_PASSWORD_HASH = "$2b$12$install-admin-hash";
    process.env.SEQDESK_BOOTSTRAP_RESEARCHER_PASSWORD_HASH = "$2b$12$install-researcher-hash";
    await useInstallDir();
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    mockDb.user.count.mockResolvedValue(0);
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.upsert.mockResolvedValue({});

    await autoSeedIfNeeded();
    const second = await autoSeedIfNeeded();

    expect(second).toEqual({ seeded: false });
    expect(mockDb.user.upsert).toHaveBeenCalledTimes(2);
  });

  it("never creates a default-password account from a bootstrap entry whose hash was stripped", async () => {
    // The distribution installer removes a bootstrap passwordHash it cannot
    // apply (strip_unapplied_bootstrap_password_hashes) and leaves the address
    // behind. Reading that leftover address as "create this account with the
    // shipped default" would put admin@example.com / admin into a database the
    // installer deliberately generated no password for -- and /api/setup/status
    // is unauthenticated, so any anonymous request would trigger it.
    await useInstallDir({
      bootstrap: {
        users: {
          admin: { email: "admin@example.com", firstName: "Admin", lastName: "User" },
          researcher: { email: "user@example.com" },
        },
      },
    });
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    mockDb.user.count.mockResolvedValue(0);
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.upsert.mockResolvedValue({});

    const result = await autoSeedIfNeeded();

    expect(mockDb.user.upsert).not.toHaveBeenCalled();
    expect(upsertedPasswords()).not.toContain(DEFAULT_ADMIN_PASSWORD_HASH);
    expect(upsertedPasswords()).not.toContain(DEFAULT_USER_PASSWORD_HASH);
    expect(result.seeded).toBe(false);
    expect(result.accounts).toEqual({
      admin: { kind: "admin", outcome: "refused", reason: expect.any(String) },
      researcher: { kind: "researcher", outcome: "refused", reason: expect.any(String) },
    });
    // The refusal report names no address either.
    expect(result.accounts?.admin.email).toBeUndefined();
  });

  it("refuses the built-in default password on a configured database even with no bootstrap entry", async () => {
    // Site settings exist, so something configured this install before. A login
    // nobody chose does not belong in it, whatever settings.json says.
    await useInstallDir();
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    mockDb.user.count.mockResolvedValue(0);
    mockDb.user.findUnique.mockResolvedValue(null);
    mockDb.user.upsert.mockResolvedValue({});

    const result = await autoSeedIfNeeded();

    expect(mockDb.user.upsert).not.toHaveBeenCalled();
    expect(result.seeded).toBe(false);
    expect(result.accounts?.admin.outcome).toBe("refused");
    expect(result.accounts?.researcher.outcome).toBe("refused");
  });

  it("refuses the built-in default password for a named account on a first seed too", async () => {
    // Same stripped settings.json, this time pointed at an empty database: the
    // named admin still gets no password nobody chose. The researcher was not
    // named, so the documented default is still its intended credential.
    await useInstallDir({
      bootstrap: { users: { admin: { email: "facility@example.org" } } },
    });
    mockEmptyDatabase();

    const result = await autoSeedIfNeeded();

    expect(result.accounts?.admin).toEqual({
      kind: "admin",
      outcome: "refused",
      reason: expect.any(String),
    });
    expect(upsertedPasswords()).not.toContain(DEFAULT_ADMIN_PASSWORD_HASH);
    expect(mockDb.user.upsert).toHaveBeenCalledTimes(1);
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({ where: { email: "user@example.com" } })
    );
    // The rest of the first-install seed still runs.
    expect(mockDb.siteSettings.upsert).toHaveBeenCalledOnce();
  });

  it("creates a named account once its password is configured", async () => {
    await useInstallDir({
      bootstrap: {
        users: {
          admin: { email: "facility@example.org", passwordHash: "$2b$12$chosen-admin-hash" },
        },
      },
    });
    mockEmptyDatabase();

    const result = await autoSeedIfNeeded();

    expect(result.accounts?.admin).toEqual({
      kind: "admin",
      email: "facility@example.org",
      outcome: "created",
    });
    expect(mockDb.user.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: "facility@example.org" },
        create: expect.objectContaining({ password: "$2b$12$chosen-admin-hash" }),
      })
    );
  });

  it("returns error when database operation fails", async () => {
    mockDb.siteSettings.findUnique.mockRejectedValue(
      new Error("Connection refused")
    );

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(false);
    expect(result.error).toBe("Connection refused");
  });

  it("stringifies non-Error exceptions", async () => {
    mockDb.siteSettings.findUnique.mockRejectedValue("raw string error");

    const result = await autoSeedIfNeeded();

    expect(result.seeded).toBe(false);
    expect(result.error).toBe("raw string error");
  });

  it("prevents concurrent seeding calls", async () => {
    // First call: simulate slow seeding by making user.upsert block
    let resolveUpsert!: () => void;
    const upsertPromise = new Promise<void>((r) => (resolveUpsert = r));

    mockEmptyDatabase();
    mockDb.user.upsert.mockImplementation(async () => {
      await upsertPromise;
      return {};
    });

    const first = autoSeedIfNeeded();

    // Give the first call time to pass the findUnique check and set seedingInProgress
    await new Promise((r) => setTimeout(r, 10));

    // Second call should return immediately since seeding is in progress
    const secondResult = await autoSeedIfNeeded();
    expect(secondResult).toEqual({
      seeded: false,
      error: "Seeding already in progress",
    });

    // Let the first call proceed
    resolveUpsert();
    const firstResult = await first;
    expect(firstResult.seeded).toBe(true);
  });

  it("resets seedingInProgress flag after an error", async () => {
    mockDb.siteSettings.findUnique.mockRejectedValue(new Error("fail"));

    const result1 = await autoSeedIfNeeded();
    expect(result1.seeded).toBe(false);

    // Second call should not say "seeding already in progress"
    mockDb.siteSettings.findUnique.mockResolvedValue({ id: "singleton" });
    mockDb.user.count.mockResolvedValue(2);
    const result2 = await autoSeedIfNeeded();
    expect(result2).toEqual({ seeded: false });
  });
});
