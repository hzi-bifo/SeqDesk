import fs from "fs";
import path from "path";
import { bootstrapRuntimeEnv } from "@/lib/config/runtime-env";
import type { DatabaseStatus, InstallProfileMetadata } from "@/lib/db-status";
import {
  detectDatabaseHosting,
  detectDatabaseProvider,
  isPooledDatabaseUrl,
  normalizeDatabaseUrl,
  type DatabaseHosting,
  type DatabaseProvider,
} from "@/lib/database-url";

export type SetupPhase =
  | "ready"
  | "database-config"
  | "database-unreachable"
  | "schema-missing"
  | "seeding"
  | "seed-failed"
  | "unknown-error";

export type SetupStepStatus = "complete" | "active" | "pending" | "error";

export type SetupStep = {
  id: string;
  label: string;
  status: SetupStepStatus;
  description: string;
  command?: string;
};

export type SetupNextAction = {
  label: string;
  description: string;
  href?: string;
  command?: string;
};

export type SetupDatabaseContext = {
  engine: DatabaseProvider;
  hosting: DatabaseHosting;
  usesPooler: boolean;
  directUrlConfigured: boolean;
};

export type SetupInstallContext = {
  mode: "managed" | "self-hosted";
  profile?: InstallProfileMetadata;
  usesDefaultBootstrapCredentials: boolean;
};

export type SetupStatusResponse = {
  exists: boolean;
  configured: boolean;
  error?: string;
  phase: SetupPhase;
  steps: SetupStep[];
  nextAction: SetupNextAction | null;
  database: SetupDatabaseContext;
  install: SetupInstallContext;
};

type ConfigFile = Record<string, unknown>;

type BuildSetupStatusOptions = {
  database?: SetupDatabaseContext;
  install?: SetupInstallContext;
  seedError?: string;
  seedInProgress?: boolean;
};

const CONFIG_FILE_NAMES = [
  "seqdesk.config.json",
  ".seqdeskrc",
  ".seqdeskrc.json",
];

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function readString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function findConfigPath(baseDir: string): string | null {
  for (const fileName of CONFIG_FILE_NAMES) {
    const candidate = path.join(baseDir, fileName);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function readConfigFile(baseDir = process.cwd()): ConfigFile {
  const configPath = findConfigPath(baseDir);
  if (!configPath) {
    return {};
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf8")) as unknown;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function readProfileMetadata(
  value: unknown,
  source: InstallProfileMetadata["source"]
): InstallProfileMetadata | undefined {
  if (!isRecord(value)) {
    return undefined;
  }

  const id = readString(value.id);
  const name = readString(value.name);
  const version = readString(value.version);
  const appliedAt = readString(value.appliedAt);

  if (!id && !name && !version && !appliedAt) {
    return undefined;
  }

  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(version ? { version } : {}),
    ...(appliedAt ? { appliedAt } : {}),
    source,
  };
}

export function readInstallProfileFromConfig(
  baseDir = process.cwd()
): InstallProfileMetadata | undefined {
  const config = readConfigFile(baseDir);
  return readProfileMetadata(config.installProfile, "config");
}

function hasConfiguredBootstrapUser(value: unknown): boolean {
  if (!isRecord(value)) {
    return false;
  }

  return [
    "email",
    "password",
    "passwordHash",
    "firstName",
    "lastName",
    "facilityName",
    "institution",
    "researcherRole",
  ].some((key) => readString(value[key]) !== undefined);
}

function hasBootstrapOverrides(baseDir = process.cwd()): boolean {
  const config = readConfigFile(baseDir);
  const bootstrap = isRecord(config.bootstrap) ? config.bootstrap : {};
  const users = isRecord(bootstrap.users) ? bootstrap.users : {};
  const hasConfigOverrides =
    hasConfiguredBootstrapUser(users.admin) ||
    hasConfiguredBootstrapUser(users.researcher);

  if (hasConfigOverrides) {
    return true;
  }

  return Object.entries(process.env).some(([key, value]) => {
    const isBootstrapKey =
      key.startsWith("SEQDESK_BOOTSTRAP_ADMIN_") ||
      key.startsWith("SEQDESK_BOOTSTRAP_RESEARCHER_");
    return isBootstrapKey && readString(value) !== undefined;
  });
}

export function readSetupDatabaseContext(
  baseDir = process.cwd()
): SetupDatabaseContext {
  bootstrapRuntimeEnv(baseDir);

  const databaseUrl = normalizeDatabaseUrl(process.env.DATABASE_URL);
  const directUrl = normalizeDatabaseUrl(process.env.DIRECT_URL);
  const usesPooler = isPooledDatabaseUrl(databaseUrl);
  const directUrlConfigured = Boolean(
    directUrl && !(usesPooler && isPooledDatabaseUrl(directUrl))
  );

  return {
    engine: detectDatabaseProvider(databaseUrl),
    hosting: detectDatabaseHosting(databaseUrl),
    usesPooler,
    directUrlConfigured,
  };
}

export function readSetupInstallContext(
  databaseProfile?: InstallProfileMetadata,
  baseDir = process.cwd()
): SetupInstallContext {
  const configProfile = readInstallProfileFromConfig(baseDir);
  const profile = databaseProfile || configProfile;
  const mode = profile ? "managed" : "self-hosted";

  return {
    mode,
    ...(profile ? { profile } : {}),
    usesDefaultBootstrapCredentials:
      mode === "self-hosted" && !hasBootstrapOverrides(baseDir),
  };
}

function getPhase(
  status: DatabaseStatus,
  options: BuildSetupStatusOptions,
  database: SetupDatabaseContext
): SetupPhase {
  if (status.configured) {
    return "ready";
  }

  if (options.seedInProgress) {
    return "seeding";
  }

  if (options.seedError) {
    return "seed-failed";
  }

  if (
    status.reason === "not_configured" ||
    status.reason === "legacy_sqlite" ||
    status.reason === "unsupported_url" ||
    (database.usesPooler && !database.directUrlConfigured)
  ) {
    return "database-config";
  }

  if (status.reason === "unreachable") {
    return "database-unreachable";
  }

  if (status.reason === "schema_missing") {
    return "schema-missing";
  }

  if (status.reason === "not_seeded") {
    return "seeding";
  }

  return "unknown-error";
}

function statusForDatabaseStep(phase: SetupPhase): SetupStepStatus {
  if (
    phase === "database-config" ||
    phase === "database-unreachable" ||
    phase === "unknown-error"
  ) {
    return "error";
  }
  return "complete";
}

function buildSteps(
  status: DatabaseStatus,
  phase: SetupPhase,
  database: SetupDatabaseContext,
  install: SetupInstallContext,
  seedError?: string
): SetupStep[] {
  const steps: SetupStep[] = [
    {
      id: "database",
      label:
        database.hosting === "neon" ? "Neon database" : "PostgreSQL database",
      status: statusForDatabaseStep(phase),
      description:
        database.hosting === "neon"
          ? "SeqDesk can identify the configured Neon connection without exposing it."
          : "SeqDesk needs a reachable PostgreSQL database connection.",
    },
  ];

  if (database.usesPooler) {
    steps.push({
      id: "direct-url",
      label: "Migration connection",
      status: database.directUrlConfigured ? "complete" : "error",
      description: database.directUrlConfigured
        ? "DIRECT_URL is configured for Prisma migrations."
        : "Pooled Neon URLs need a non-pooled DIRECT_URL before migrations can run.",
    });
  }

  steps.push({
    id: "schema",
    label: "Database schema",
    status:
      phase === "schema-missing"
        ? "error"
        : status.exists
          ? "complete"
          : "pending",
    description:
      phase === "schema-missing"
        ? "The database is reachable, but Prisma tables are not installed."
        : "Prisma migrations create the SeqDesk tables.",
    command: phase === "schema-missing" ? "npm run db:migrate:deploy" : undefined,
  });

  steps.push({
    id: "seed",
    label: "Initial data",
    status:
      status.configured
        ? "complete"
        : phase === "seed-failed"
          ? "error"
          : phase === "seeding"
            ? "active"
            : "pending",
    description: seedError
      ? seedError
      : status.configured
        ? "Users, site settings, and default forms are available."
        : "SeqDesk is creating the initial admin data and form configuration.",
    command: phase === "seed-failed" ? "npm run db:seed" : undefined,
  });

  if (install.mode === "managed") {
    steps.push({
      id: "hosted-profile",
      label: "Hosted profile",
      status: install.profile?.source === "database" ? "complete" : "active",
      description:
        install.profile?.source === "database"
          ? "Managed configuration from SeqDesk admin has been applied."
          : "Managed configuration from SeqDesk admin is available and will be applied by the installer.",
    });
  }

  steps.push({
    id: "login",
    label: "Admin login",
    status: status.configured ? "complete" : "pending",
    description: status.configured
      ? "Setup is complete. Continue to the login screen."
      : "Login is available after the setup checks pass.",
  });

  return steps;
}

function buildNextAction(
  phase: SetupPhase,
  status: DatabaseStatus,
  database: SetupDatabaseContext,
  install: SetupInstallContext,
  seedError?: string
): SetupNextAction | null {
  if (phase === "ready") {
    return {
      label: "Continue to login",
      description: "Setup is complete and SeqDesk is ready for admins.",
      href: "/login",
    };
  }

  if (database.usesPooler && !database.directUrlConfigured) {
    return {
      label: "Add DIRECT_URL",
      description:
        "Use the non-pooled Neon connection string as DIRECT_URL, then restart SeqDesk and rerun migrations.",
    };
  }

  if (phase === "database-config") {
    return {
      label: "Configure database",
      description:
        status.reason === "legacy_sqlite"
          ? "SQLite installs must be migrated to PostgreSQL before this release can run."
          : "Set DATABASE_URL to a PostgreSQL connection string in seqdesk.config.json or the process environment.",
    };
  }

  if (phase === "database-unreachable") {
    if (database.hosting === "neon") {
      return {
        label: install.mode === "managed" ? "Check managed database" : "Check Neon project",
        description:
          install.mode === "managed"
            ? "Verify the booked Neon database in seqdesk.org/admin, then restart SeqDesk after provisioning finishes."
            : "Verify the Neon project is active, the credentials are current, and the network can reach Neon.",
      };
    }

    return {
      label: "Check PostgreSQL",
      description:
        "Start PostgreSQL, verify the database exists, and confirm DATABASE_URL/DIRECT_URL point at it.",
    };
  }

  if (phase === "schema-missing") {
    return {
      label: "Run migrations",
      description: "Install the Prisma schema before SeqDesk can seed initial data.",
      command: "npm run db:migrate:deploy",
    };
  }

  if (phase === "seed-failed") {
    return {
      label: "Run seed",
      description: seedError || "Automatic seeding failed. Run the seed command manually.",
      command: "npm run db:seed",
    };
  }

  if (phase === "seeding") {
    return {
      label: "Seeding initial data",
      description: "Keep this page open while SeqDesk creates initial users and settings.",
    };
  }

  return {
    label: "Review setup error",
    description: status.error || "SeqDesk could not classify the current setup issue.",
  };
}

export function buildSetupStatusResponse(
  status: DatabaseStatus,
  options: BuildSetupStatusOptions = {}
): SetupStatusResponse {
  const database = options.database || readSetupDatabaseContext();
  const install =
    options.install || readSetupInstallContext(status.installProfile);
  const phase = getPhase(status, options, database);
  const error = options.seedError || status.error;

  return {
    exists: status.exists,
    configured: status.configured,
    ...(error ? { error } : {}),
    phase,
    steps: buildSteps(status, phase, database, install, options.seedError),
    nextAction: buildNextAction(phase, status, database, install, options.seedError),
    database,
    install,
  };
}
