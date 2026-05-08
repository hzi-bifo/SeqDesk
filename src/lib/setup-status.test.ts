import { describe, expect, it } from "vitest";

import {
  buildSetupStatusResponse,
  type SetupDatabaseContext,
  type SetupInstallContext,
} from "./setup-status";
import type { DatabaseStatus } from "./db-status";

const selfHostedDatabase: SetupDatabaseContext = {
  engine: "postgresql",
  hosting: "self-hosted-postgres",
  usesPooler: false,
  directUrlConfigured: true,
};

const selfHostedInstall: SetupInstallContext = {
  mode: "self-hosted",
  usesDefaultBootstrapCredentials: true,
};

function build(
  status: DatabaseStatus,
  overrides: {
    database?: Partial<SetupDatabaseContext>;
    install?: Partial<SetupInstallContext>;
    seedError?: string;
    seedInProgress?: boolean;
  } = {}
) {
  return buildSetupStatusResponse(status, {
    database: {
      ...selfHostedDatabase,
      ...overrides.database,
    },
    install: {
      ...selfHostedInstall,
      ...overrides.install,
    } as SetupInstallContext,
    ...(overrides.seedError ? { seedError: overrides.seedError } : {}),
    ...(overrides.seedInProgress ? { seedInProgress: true } : {}),
  });
}

describe("buildSetupStatusResponse", () => {
  it("classifies missing database configuration", () => {
    const response = build(
      {
        exists: false,
        configured: false,
        reason: "not_configured",
        error:
          "DATABASE_URL is not configured. SeqDesk now requires a PostgreSQL connection string.",
      },
      {
        database: {
          engine: "unknown",
          hosting: "unknown",
          directUrlConfigured: false,
        },
      }
    );

    expect(response.phase).toBe("database-config");
    expect(response.nextAction?.label).toBe("Configure database");
    expect(response.steps.find((step) => step.id === "database")?.status).toBe(
      "error"
    );
  });

  it("classifies unreachable self-hosted PostgreSQL", () => {
    const response = build({
      exists: false,
      configured: false,
      reason: "unreachable",
      error: "PostgreSQL is unreachable.",
    });

    expect(response.phase).toBe("database-unreachable");
    expect(response.nextAction?.label).toBe("Check PostgreSQL");
  });

  it("shows Neon-specific unreachable guidance", () => {
    const response = build(
      {
        exists: false,
        configured: false,
        reason: "unreachable",
        error: "PostgreSQL is unreachable.",
      },
      {
        database: {
          hosting: "neon",
        },
        install: {
          mode: "managed",
          usesDefaultBootstrapCredentials: false,
          profile: {
            id: "twincore",
            name: "TWINCORE",
            version: "1.0.0",
            source: "config",
          },
        },
      }
    );

    expect(response.phase).toBe("database-unreachable");
    expect(response.install.mode).toBe("managed");
    expect(response.nextAction?.label).toBe("Check managed database");
    expect(response.nextAction?.description).toContain("seqdesk.com/admin");
  });

  it("prioritizes DIRECT_URL guidance for Neon pooler URLs", () => {
    const response = build(
      {
        exists: false,
        configured: false,
        reason: "schema_missing",
        error: "Database schema is missing.",
      },
      {
        database: {
          hosting: "neon",
          usesPooler: true,
          directUrlConfigured: false,
        },
      }
    );

    expect(response.phase).toBe("database-config");
    expect(response.nextAction?.label).toBe("Add DIRECT_URL");
    expect(response.steps.find((step) => step.id === "direct-url")?.status).toBe(
      "error"
    );
  });

  it("classifies missing schema with migration command", () => {
    const response = build({
      exists: false,
      configured: false,
      reason: "schema_missing",
      error: "Database schema is missing.",
    });

    expect(response.phase).toBe("schema-missing");
    expect(response.nextAction?.command).toBe("npm run db:migrate:deploy");
    expect(response.steps.find((step) => step.id === "schema")?.status).toBe(
      "error"
    );
  });

  it("classifies seeding progress and seed failures", () => {
    const inProgress = build(
      {
        exists: true,
        configured: false,
        reason: "not_seeded",
      },
      { seedInProgress: true }
    );
    const failed = build(
      {
        exists: true,
        configured: false,
        reason: "not_seeded",
      },
      { seedError: "Seed failed" }
    );

    expect(inProgress.phase).toBe("seeding");
    expect(inProgress.steps.find((step) => step.id === "seed")?.status).toBe(
      "active"
    );
    expect(failed.phase).toBe("seed-failed");
    expect(failed.nextAction?.command).toBe("npm run db:seed");
  });

  it("returns ready state and hosted profile status", () => {
    const response = build(
      {
        exists: true,
        configured: true,
        reason: "configured",
        installProfile: {
          id: "twincore",
          name: "TWINCORE",
          version: "1.0.0",
          appliedAt: "2026-05-07T10:00:00.000Z",
          source: "database",
        },
      },
      {
        install: {
          mode: "managed",
          usesDefaultBootstrapCredentials: false,
          profile: {
            id: "twincore",
            name: "TWINCORE",
            version: "1.0.0",
            appliedAt: "2026-05-07T10:00:00.000Z",
            source: "database",
          },
        },
      }
    );

    expect(response.phase).toBe("ready");
    expect(response.nextAction?.href).toBe("/login");
    expect(response.install.profile?.source).toBe("database");
    expect(response.steps.find((step) => step.id === "hosted-profile")?.status).toBe(
      "complete"
    );
  });
});
