import fs from "node:fs/promises";
import path from "node:path";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";
import { inspectDataStoragePath } from "@/lib/files/data-storage-path-validation";
import {
  DummySeedAlreadyExistsError,
  DummySeedCleanupPendingError,
  DummySeedInUseError,
  DummySeedReferencesError,
  DummySeedStorageMismatchError,
  DummySeedSubmissionError,
  getDummySeedFilesystemStatus,
  getDummySeedStatus,
  removeDummySeed,
  runDummySeed,
  type DummySeedFilesystemStatus,
  type DummySeedStatus,
} from "./run-seed";

export type DemoDataAction = "install" | "status" | "remove";

export interface DemoDataCommandOptions {
  action: DemoDataAction;
  configPath: string;
  userEmail?: string;
}

export interface DemoDataOwner {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface DemoDataCommandResult extends DummySeedStatus {
  ok: true;
  action: DemoDataAction;
  owner: DemoDataOwner & { displayName: string };
  dataBasePath: string | null;
  storageReady: boolean;
  storageError?: string;
  filesPresent: boolean;
  filesComplete: boolean;
  integrityComplete: boolean;
  referencedFilesCount: number;
  validFilesCount: number;
  invalidFilesCount: number;
  cleanupPending: boolean;
  message?: string;
  alreadyInstalled?: boolean;
  alreadyAbsent?: boolean;
  ordersCreated?: number;
  samplesCreated?: number;
  readsCreated?: number;
  filesCreated?: number;
  ordersDeleted?: number;
  ticketLinksCleared?: number;
  filesRemoved?: boolean;
  platform?: {
    platform: string;
    instrumentModel: string;
    pairedEnd: boolean;
    fromConfiguredDevice: boolean;
  };
}

export class DemoDataCommandError extends Error {
  constructor(
    public readonly code: string,
    message: string
  ) {
    super(message);
    this.name = "DemoDataCommandError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function configuredBootstrapAdminEmail(
  configPath: string
): Promise<string | null> {
  try {
    const parsed = JSON.parse(await fs.readFile(configPath, "utf8")) as unknown;
    if (!isRecord(parsed)) return null;
    const bootstrap = isRecord(parsed.bootstrap) ? parsed.bootstrap : {};
    const users = isRecord(bootstrap.users) ? bootstrap.users : {};
    const admin = isRecord(users.admin) ? users.admin : {};
    return optionalString(admin.email);
  } catch {
    // The launcher validates settings.json before invoking this worker. Keeping
    // this lookup best-effort also makes the worker usable in source installs.
    return null;
  }
}

function ownerDisplayName(owner: DemoDataOwner): string {
  return [owner.firstName, owner.lastName].filter(Boolean).join(" ").trim();
}

async function findAdminByEmail(email: string): Promise<DemoDataOwner | null> {
  const user = await db.user.findUnique({
    where: { email },
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
      role: true,
    },
  });
  if (!user) return null;
  if (user.role !== "FACILITY_ADMIN") {
    throw new DemoDataCommandError(
      "USER_NOT_FACILITY_ADMIN",
      `${email} exists, but is not a facility administrator. Choose a FACILITY_ADMIN account with --user-email.`
    );
  }
  return user;
}

/**
 * Resolve the owner deterministically without silently attaching demo records
 * to an arbitrary administrator on multi-admin installations.
 */
export async function resolveDemoDataOwner(
  options: Pick<DemoDataCommandOptions, "configPath" | "userEmail">
): Promise<DemoDataOwner> {
  const explicitEmail = optionalString(options.userEmail);
  if (explicitEmail) {
    const explicitOwner = await findAdminByEmail(explicitEmail);
    if (!explicitOwner) {
      throw new DemoDataCommandError(
        "USER_NOT_FOUND",
        `No SeqDesk account has the email ${explicitEmail}.`
      );
    }
    return explicitOwner;
  }

  const configuredEmail =
    optionalString(process.env.SEQDESK_BOOTSTRAP_ADMIN_EMAIL) ??
    (await configuredBootstrapAdminEmail(options.configPath));
  if (configuredEmail) {
    const configuredOwner = await findAdminByEmail(configuredEmail);
    if (configuredOwner) return configuredOwner;
  }

  // Fresh/default installs may not persist an explicit bootstrap block.
  const defaultOwner = await findAdminByEmail("admin@example.com");
  if (defaultOwner) return defaultOwner;

  const admins = await db.user.findMany({
    where: { role: "FACILITY_ADMIN" },
    orderBy: [{ createdAt: "asc" }, { email: "asc" }],
    take: 2,
    select: {
      id: true,
      email: true,
      firstName: true,
      lastName: true,
    },
  });

  if (admins.length === 0) {
    throw new DemoDataCommandError(
      "NO_FACILITY_ADMIN",
      "This SeqDesk database has no facility administrator to own the demo dataset."
    );
  }
  if (admins.length > 1) {
    throw new DemoDataCommandError(
      "MULTIPLE_FACILITY_ADMINS",
      "This installation has multiple facility administrators. Choose the owner explicitly with --user-email."
    );
  }
  return admins[0];
}

interface DemoDataStorage {
  dataBasePath: string | null;
  ready: boolean;
  error?: string;
  errorCode?: string;
}

async function inspectDemoDataStoragePath(
  requestedPath: string,
  requireWritable: boolean
): Promise<DemoDataStorage> {
  const inspection = await inspectDataStoragePath(requestedPath);
  if (!inspection.valid || !inspection.writable) {
    const message =
      `SeqDesk data storage is not ready: ${
        inspection.error ??
        (inspection.valid ? "directory is not writable" : "invalid path")
      } (${requestedPath}). ` +
      "Run `seqdesk storage status` for details.";
    const errorCode = inspection.valid
      ? "STORAGE_NOT_WRITABLE"
      : "STORAGE_PATH_INVALID";
    if (requireWritable) {
      throw new DemoDataCommandError(
        errorCode,
        message
      );
    }
    return {
      dataBasePath: requestedPath,
      ready: false,
      error: message,
      errorCode,
    };
  }
  return {
    dataBasePath: inspection.configuredPath ?? requestedPath,
    ready: true,
  };
}

async function resolveDemoDataStorage(options: {
  requireWritable: boolean;
}): Promise<DemoDataStorage> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { dataBasePath: true },
  });
  const resolved = resolveDataBasePathFromStoredValue(settings?.dataBasePath);
  if (!resolved.dataBasePath) {
    const message =
      "SeqDesk data storage is not configured. Run `seqdesk storage configure <absolute-path>` first.";
    if (options.requireWritable) {
      throw new DemoDataCommandError("STORAGE_NOT_CONFIGURED", message);
    }
    return {
      dataBasePath: null,
      ready: false,
      error: message,
      errorCode: "STORAGE_NOT_CONFIGURED",
    };
  }

  return inspectDemoDataStoragePath(
    path.resolve(resolved.dataBasePath),
    options.requireWritable
  );
}

function resultWithStatus(
  action: DemoDataAction,
  owner: DemoDataOwner,
  storage: DemoDataStorage,
  status: DummySeedStatus,
  extra: Partial<DemoDataCommandResult> = {}
): DemoDataCommandResult {
  const databasePresent = status.databasePresent ?? status.seeded;
  const databaseComplete =
    status.databaseComplete ??
    (status.seeded && !(status.incomplete ?? false));
  return {
    ok: true,
    action,
    owner: {
      ...owner,
      displayName: ownerDisplayName(owner) || owner.email,
    },
    dataBasePath: storage.dataBasePath,
    storageReady: storage.ready,
    filesPresent: false,
    filesComplete: false,
    integrityComplete: false,
    referencedFilesCount: 0,
    validFilesCount: 0,
    invalidFilesCount: 0,
    cleanupPending: false,
    ...(storage.error ? { storageError: storage.error } : {}),
    ...status,
    databasePresent,
    databaseComplete,
    incomplete: status.incomplete ?? false,
    studiesCount: status.studiesCount ?? 0,
    samplesCount: status.samplesCount ?? 0,
    readsCount: status.readsCount ?? 0,
    samplesWithSeedMetadataCount:
      status.samplesWithSeedMetadataCount ?? 0,
    sampleMetadataComplete: status.sampleMetadataComplete ?? false,
    readPathsComplete: status.readPathsComplete ?? false,
    storedDataBasePath: status.storedDataBasePath ?? null,
    pendingCleanupDataBasePath:
      status.pendingCleanupDataBasePath ?? null,
    storagePathConflict: status.storagePathConflict ?? false,
    ...extra,
  };
}

const EMPTY_FILESYSTEM_STATUS: DummySeedFilesystemStatus = {
  folderPresent: false,
  referencedFilesCount: 0,
  validFilesCount: 0,
  invalidFilesCount: 0,
  filesComplete: false,
};

function getDemoDataHealth(
  status: DummySeedStatus,
  filesystem: DummySeedFilesystemStatus
): Pick<
  DemoDataCommandResult,
  | "seeded"
  | "databaseComplete"
  | "filesPresent"
  | "filesComplete"
  | "integrityComplete"
  | "referencedFilesCount"
  | "validFilesCount"
  | "invalidFilesCount"
  | "cleanupPending"
> {
  const databasePresent = status.databasePresent ?? status.seeded;
  const databaseComplete =
    status.databaseComplete ??
    (status.seeded && !(status.incomplete ?? false));
  const integrityComplete =
    databaseComplete &&
    filesystem.filesComplete &&
    !(status.storagePathConflict ?? false);
  return {
    seeded: integrityComplete,
    databaseComplete,
    filesPresent: filesystem.folderPresent,
    filesComplete: filesystem.filesComplete,
    integrityComplete,
    referencedFilesCount: filesystem.referencedFilesCount,
    validFilesCount: filesystem.validFilesCount,
    invalidFilesCount: filesystem.invalidFilesCount,
    cleanupPending:
      Boolean(status.pendingCleanupDataBasePath) ||
      (status.incomplete ?? false) ||
      (status.storagePathConflict ?? false) ||
      (databasePresent
        ? !integrityComplete
        : filesystem.folderPresent),
  };
}

export async function executeDemoDataCommand(
  options: DemoDataCommandOptions
): Promise<DemoDataCommandResult> {
  const owner = await resolveDemoDataOwner(options);
  const configuredStorage = await resolveDemoDataStorage({
    requireWritable: false,
  });
  const current = await getDummySeedStatus(owner.id);
  if (
    current.databasePresent &&
    current.storagePathConflict &&
    options.action !== "status"
  ) {
    throw new DemoDataCommandError(
      "STORAGE_PATH_CONFLICT",
      "Demo fixture records disagree about their original storage path. Resolve the fixture metadata before mutating it."
    );
  }
  const storage =
    current.storedDataBasePath &&
    current.storedDataBasePath !== configuredStorage.dataBasePath
      ? await inspectDemoDataStoragePath(
          current.storedDataBasePath,
          false
        )
      : configuredStorage;
  const filesystem = current.storagePathConflict
    ? EMPTY_FILESYSTEM_STATUS
    : await getDummySeedFilesystemStatus(
        owner.id,
        storage.dataBasePath
      );
  const databasePresent = current.databasePresent ?? current.seeded;
  const durableCleanupPending = Boolean(
    current.pendingCleanupDataBasePath
  );
  const currentHealth = getDemoDataHealth(current, filesystem);

  if (options.action === "status") {
    return resultWithStatus(
      options.action,
      owner,
      storage,
      current,
      {
        ...currentHealth,
        ...(storage.error ? { message: storage.error } : {}),
      }
    );
  }

  if (options.action === "remove") {
    if (
      !databasePresent &&
      !currentHealth.filesPresent &&
      !durableCleanupPending
    ) {
      return resultWithStatus(
        options.action,
        owner,
        storage,
        current,
        {
          ...currentHealth,
          alreadyAbsent: true,
          ordersDeleted: 0,
          filesRemoved: false,
        }
      );
    }
    if (
      (databasePresent || durableCleanupPending) &&
      !storage.ready
    ) {
      throw new DemoDataCommandError(
        storage.errorCode ?? "STORAGE_NOT_WRITABLE",
        `${
          storage.error ??
          "The original demo-data storage path is unavailable"
        } ${
          databasePresent
            ? "Database rows were left intact so the original file location remains recoverable."
            : "The cleanup pointer was retained; restore the original path and retry removal."
        }`
      );
    }
    let removed;
    try {
      removed = await removeDummySeed({
        ownerUserId: owner.id,
        resolvedBase: storage.ready ? storage.dataBasePath : null,
      });
    } catch (error) {
      if (error instanceof DummySeedInUseError) {
        throw new DemoDataCommandError(
          "PIPELINE_RUNS_PRESENT",
          error.message
        );
      }
      if (error instanceof DummySeedSubmissionError) {
        throw new DemoDataCommandError(
          "SUBMISSIONS_PRESENT",
          error.message
        );
      }
      if (error instanceof DummySeedReferencesError) {
        throw new DemoDataCommandError(
          "REFERENCES_PRESENT",
          error.message
        );
      }
      if (error instanceof DummySeedStorageMismatchError) {
        throw new DemoDataCommandError(
          "STORAGE_PATH_MISMATCH",
          error.message
        );
      }
      throw error;
    }
    const status = await getDummySeedStatus(owner.id);
    const remainingFilesystem = await getDummySeedFilesystemStatus(
      owner.id,
      storage.dataBasePath
    );
    const remainingHealth = getDemoDataHealth(
      status,
      remainingFilesystem
    );
    return resultWithStatus(
      options.action,
      owner,
      storage,
      status,
      {
        ...removed,
        ...remainingHealth,
      }
    );
  }

  if (durableCleanupPending) {
    throw new DemoDataCommandError(
      "CLEANUP_PENDING",
      "A previous demo-data removal still needs filesystem cleanup. Run `seqdesk demo-data remove --yes` before installing again."
    );
  }

  if (databasePresent) {
    if (!currentHealth.integrityComplete) {
      throw new DemoDataCommandError(
        "CLEANUP_PENDING",
        "A partial demo dataset remains. Run `seqdesk demo-data remove --yes` before installing again."
      );
    }
    return resultWithStatus(
      options.action,
      owner,
      storage,
      current,
      { ...currentHealth, alreadyInstalled: true }
    );
  }
  if (currentHealth.filesPresent) {
    throw new DemoDataCommandError(
      "CLEANUP_PENDING",
      "Demo-data files remain without matching database rows. Run `seqdesk demo-data remove --yes` before installing again."
    );
  }
  if (!configuredStorage.ready || !configuredStorage.dataBasePath) {
    throw new DemoDataCommandError(
      configuredStorage.errorCode ?? "STORAGE_NOT_WRITABLE",
      configuredStorage.error ??
        "SeqDesk data storage must be readable and writable before installing demo data."
    );
  }

  try {
    const installed = await runDummySeed({
      ownerUserId: owner.id,
      resolvedBase: configuredStorage.dataBasePath,
      ownerEmail: owner.email,
      ownerDisplayName: ownerDisplayName(owner) || owner.email,
    });
    const status = await getDummySeedStatus(owner.id);
    const installedFilesystem = await getDummySeedFilesystemStatus(
      owner.id,
      configuredStorage.dataBasePath
    );
    const installedHealth = getDemoDataHealth(
      status,
      installedFilesystem
    );
    if (!installedHealth.integrityComplete) {
      throw new DemoDataCommandError(
        "CLEANUP_PENDING",
        "The demo dataset installation did not pass its integrity check. Run `seqdesk demo-data remove --yes` before installing again."
      );
    }
    return resultWithStatus(
      options.action,
      owner,
      configuredStorage,
      status,
      {
        ordersCreated: installed.ordersCreated,
        samplesCreated: installed.samplesCreated,
        readsCreated: installed.readsCreated,
        filesCreated: installed.filesCreated,
        ...installedHealth,
        platform: installed.platform,
      }
    );
  } catch (error) {
    // A concurrent Settings/CLI request may have won the advisory lock after
    // the status read above. Treat that race as the same idempotent success.
    if (error instanceof DummySeedAlreadyExistsError) {
      const status = await getDummySeedStatus(owner.id);
      const installedFilesystem = await getDummySeedFilesystemStatus(
        owner.id,
        configuredStorage.dataBasePath
      );
      const installedHealth = getDemoDataHealth(
        status,
        installedFilesystem
      );
      if (!installedHealth.integrityComplete) {
        throw new DemoDataCommandError(
          "CLEANUP_PENDING",
          "A partial demo dataset remains. Run `seqdesk demo-data remove --yes` before installing again."
        );
      }
      return resultWithStatus(
        options.action,
        owner,
        configuredStorage,
        status,
        {
          ...installedHealth,
          alreadyInstalled: true,
        }
      );
    }
    if (error instanceof DummySeedCleanupPendingError) {
      throw new DemoDataCommandError(
        "CLEANUP_PENDING",
        "Demo-data files remain without matching database rows. Run `seqdesk demo-data remove --yes` before installing again."
      );
    }
    throw error;
  }
}
