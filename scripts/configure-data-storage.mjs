#!/usr/bin/env node

import { randomUUID } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ACTIONS = new Set(["configure", "status"]);

export class DataStorageCommandError extends Error {
  constructor(code, message, options = {}) {
    super(message, options);
    this.name = "DataStorageCommandError";
    this.code = code;
  }
}

function commandError(code, message, cause) {
  return new DataStorageCommandError(code, message, cause ? { cause } : {});
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function optionalString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isMissingError(error) {
  return Boolean(
    error &&
      typeof error === "object" &&
      "code" in error &&
      error.code === "ENOENT"
  );
}

async function canAccess(targetPath, mode) {
  try {
    await fs.access(targetPath, mode);
    return true;
  } catch {
    return false;
  }
}

async function syncDirectory(directory) {
  let handle;
  try {
    handle = await fs.open(directory, "r");
    await handle.sync();
  } catch {
    // The rename is already atomic. Directory fsync is not available on every
    // supported filesystem, so durability hardening remains best effort.
  } finally {
    await handle?.close().catch(() => {});
  }
}

function normalizeStoragePath(input) {
  const value = optionalString(input);
  if (!value) {
    throw commandError("PATH_REQUIRED", "A data storage path is required.");
  }
  if (!path.isAbsolute(value)) {
    throw commandError(
      "PATH_NOT_ABSOLUTE",
      "The data storage path must be absolute."
    );
  }

  const normalized = path.normalize(value);
  if (normalized === path.parse(normalized).root) {
    throw commandError(
      "PATH_IS_FILESYSTEM_ROOT",
      "The filesystem root cannot be used as SeqDesk data storage."
    );
  }
  return normalized;
}

async function canonicalPathForComparison(input) {
  const normalized = path.resolve(input);
  try {
    return await fs.realpath(normalized);
  } catch {
    return normalized;
  }
}

export async function inspectStoragePath(
  input,
  { create = false, strict = false } = {}
) {
  let requestedPath;
  try {
    requestedPath = normalizeStoragePath(input);
  } catch (error) {
    if (strict) throw error;
    return {
      configured: Boolean(optionalString(input)),
      requestedPath: optionalString(input),
      canonicalPath: null,
      absolute: false,
      exists: false,
      directory: false,
      readable: false,
      searchable: false,
      writable: false,
      ready: false,
      error:
        error instanceof Error ? error.message : "The storage path is invalid.",
    };
  }

  let created = false;
  let entry;
  try {
    entry = await fs.lstat(requestedPath);
  } catch (error) {
    if (!isMissingError(error)) {
      if (strict) {
        throw commandError(
          "PATH_INSPECTION_FAILED",
          `The data storage path cannot be inspected: ${requestedPath}`,
          error
        );
      }
      return {
        configured: true,
        requestedPath,
        canonicalPath: null,
        absolute: true,
        exists: false,
        directory: false,
        readable: false,
        searchable: false,
        writable: false,
        ready: false,
        error: "The data storage path cannot be inspected.",
      };
    }

    if (!create) {
      if (strict) {
        throw commandError(
          "PATH_NOT_FOUND",
          `The data storage directory does not exist: ${requestedPath}. Pass --create to create it explicitly.`
        );
      }
      return {
        configured: true,
        requestedPath,
        canonicalPath: null,
        absolute: true,
        exists: false,
        directory: false,
        readable: false,
        searchable: false,
        writable: false,
        ready: false,
        error: "The data storage directory does not exist.",
      };
    }

    try {
      const firstCreated = await fs.mkdir(requestedPath, {
        recursive: true,
        mode: 0o750,
      });
      created = typeof firstCreated === "string";
      entry = await fs.lstat(requestedPath);
    } catch (mkdirError) {
      throw commandError(
        "PATH_CREATE_FAILED",
        `The data storage directory could not be created: ${requestedPath}`,
        mkdirError
      );
    }
  }

  let stats;
  try {
    stats = entry.isSymbolicLink() ? await fs.stat(requestedPath) : entry;
  } catch (error) {
    if (strict) {
      throw commandError(
        "PATH_INSPECTION_FAILED",
        `The data storage path cannot be inspected: ${requestedPath}`,
        error
      );
    }
    return {
      configured: true,
      requestedPath,
      canonicalPath: null,
      absolute: true,
      exists: true,
      directory: false,
      readable: false,
      searchable: false,
      writable: false,
      ready: false,
      error: "The data storage path cannot be inspected.",
    };
  }

  if (!stats.isDirectory()) {
    if (strict) {
      throw commandError(
        "PATH_NOT_DIRECTORY",
        `The data storage path is not a directory: ${requestedPath}`
      );
    }
    return {
      configured: true,
      requestedPath,
      canonicalPath: null,
      absolute: true,
      exists: true,
      directory: false,
      readable: false,
      searchable: false,
      writable: false,
      ready: false,
      error: "The data storage path is not a directory.",
    };
  }

  let canonicalPath;
  try {
    canonicalPath = await fs.realpath(requestedPath);
  } catch (error) {
    if (strict) {
      throw commandError(
        "PATH_INSPECTION_FAILED",
        `The data storage path cannot be resolved: ${requestedPath}`,
        error
      );
    }
    return {
      configured: true,
      requestedPath,
      canonicalPath: null,
      absolute: true,
      exists: true,
      directory: true,
      readable: false,
      searchable: false,
      writable: false,
      ready: false,
      error: "The data storage path cannot be resolved.",
    };
  }

  if (canonicalPath === path.parse(canonicalPath).root) {
    if (strict) {
      throw commandError(
        "PATH_IS_FILESYSTEM_ROOT",
        "The filesystem root cannot be used as SeqDesk data storage."
      );
    }
    return {
      configured: true,
      requestedPath,
      canonicalPath,
      absolute: true,
      exists: true,
      directory: true,
      readable: false,
      searchable: false,
      writable: false,
      ready: false,
      error: "The filesystem root cannot be used as SeqDesk data storage.",
    };
  }

  const [readable, searchable, writable] = await Promise.all([
    canAccess(requestedPath, fsConstants.R_OK),
    canAccess(requestedPath, fsConstants.X_OK),
    canAccess(requestedPath, fsConstants.W_OK | fsConstants.X_OK),
  ]);

  if (strict && (!readable || !searchable)) {
    throw commandError(
      "PATH_NOT_ACCESSIBLE",
      `The data storage directory must be readable and searchable by the SeqDesk service user: ${requestedPath}`
    );
  }

  return {
    configured: true,
    requestedPath,
    canonicalPath,
    absolute: true,
    exists: true,
    directory: true,
    readable,
    searchable,
    writable,
    ready: readable && searchable,
    created,
    error:
      readable && searchable
        ? null
        : "The directory is not readable and searchable by this user.",
  };
}

async function resolveConfigTarget(configPath) {
  if (!optionalString(configPath)) {
    throw commandError("CONFIG_REQUIRED", "A root configuration path is required.");
  }
  if (!path.isAbsolute(configPath)) {
    throw commandError(
      "CONFIG_NOT_ABSOLUTE",
      "The root configuration path must be absolute."
    );
  }

  const displayPath = path.normalize(configPath);
  let entry;
  try {
    entry = await fs.lstat(displayPath);
  } catch (error) {
    if (isMissingError(error)) {
      return { displayPath, targetPath: displayPath, existed: false };
    }
    throw commandError(
      "CONFIG_READ_FAILED",
      `The SeqDesk configuration cannot be inspected: ${displayPath}`,
      error
    );
  }

  if (entry.isSymbolicLink()) {
    try {
      const targetPath = await fs.realpath(displayPath);
      return { displayPath, targetPath, existed: true };
    } catch (error) {
      throw commandError(
        "CONFIG_READ_FAILED",
        `The SeqDesk configuration symlink cannot be resolved: ${displayPath}`,
        error
      );
    }
  }

  if (!entry.isFile()) {
    throw commandError(
      "CONFIG_NOT_FILE",
      `The SeqDesk configuration path is not a regular file: ${displayPath}`
    );
  }
  return { displayPath, targetPath: displayPath, existed: true };
}

async function readConfigSnapshot(configPath) {
  const target = await resolveConfigTarget(configPath);
  if (!target.existed) {
    return {
      ...target,
      raw: null,
      config: {},
      uid: null,
      gid: null,
      mode: null,
    };
  }

  let raw;
  let stats;
  try {
    [raw, stats] = await Promise.all([
      fs.readFile(target.targetPath, "utf8"),
      fs.stat(target.targetPath),
    ]);
  } catch (error) {
    throw commandError(
      "CONFIG_READ_FAILED",
      `The SeqDesk configuration cannot be read: ${target.displayPath}`,
      error
    );
  }
  if (!stats.isFile()) {
    throw commandError(
      "CONFIG_NOT_FILE",
      `The SeqDesk configuration path is not a regular file: ${target.displayPath}`
    );
  }

  let config;
  try {
    config = JSON.parse(raw);
  } catch (error) {
    throw commandError(
      "CONFIG_INVALID_JSON",
      `The SeqDesk configuration is not valid JSON: ${target.displayPath}`,
      error
    );
  }
  if (!isRecord(config)) {
    throw commandError(
      "CONFIG_INVALID_ROOT",
      `The SeqDesk configuration root must be a JSON object: ${target.displayPath}`
    );
  }

  return {
    ...target,
    raw,
    config,
    uid: stats.uid,
    gid: stats.gid,
    mode: stats.mode & 0o777,
  };
}

function assertConfigOwnerCanBePreserved(snapshot) {
  if (!snapshot.existed || typeof process.getuid !== "function") return;
  const currentUid = process.getuid();
  if (currentUid !== 0 && currentUid !== snapshot.uid) {
    throw commandError(
      "CONFIG_OWNER_MISMATCH",
      `Refusing to replace a SeqDesk configuration owned by another user: ${snapshot.displayPath}`
    );
  }
}

async function assertExpectedConfigContents(snapshot, expectedRaw) {
  try {
    const current = await fs.readFile(snapshot.targetPath, "utf8");
    if (expectedRaw === null || current !== expectedRaw) {
      throw commandError(
        "CONFIG_CHANGED",
        `The SeqDesk configuration changed while storage was being configured: ${snapshot.displayPath}`
      );
    }
  } catch (error) {
    if (error instanceof DataStorageCommandError) throw error;
    if (isMissingError(error) && expectedRaw === null) return;
    if (isMissingError(error)) {
      throw commandError(
        "CONFIG_CHANGED",
        `The SeqDesk configuration disappeared while storage was being configured: ${snapshot.displayPath}`,
        error
      );
    }
    throw commandError(
      "CONFIG_READ_FAILED",
      `The SeqDesk configuration cannot be verified: ${snapshot.displayPath}`,
      error
    );
  }
}

async function atomicReplaceConfig(snapshot, contents, options = {}) {
  const expectedRaw =
    options.expectedRaw === undefined ? snapshot.raw : options.expectedRaw;
  await assertExpectedConfigContents(snapshot, expectedRaw);

  const directory = path.dirname(snapshot.targetPath);
  const temporaryPath = path.join(
    directory,
    `.${path.basename(snapshot.targetPath)}.seqdesk-${process.pid}-${randomUUID()}.tmp`
  );
  let handle;
  try {
    handle = await fs.open(temporaryPath, "wx", 0o600);
    await handle.writeFile(contents, "utf8");
    await handle.sync();
    await handle.close();
    handle = null;

    if (
      options.uid !== null &&
      options.uid !== undefined &&
      options.gid !== null &&
      options.gid !== undefined
    ) {
      await fs.chown(temporaryPath, options.uid, options.gid);
    }
    await fs.chmod(temporaryPath, options.mode ?? 0o600);
    await fs.rename(temporaryPath, snapshot.targetPath);
    await syncDirectory(directory);
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.unlink(temporaryPath).catch(() => {});
    if (error instanceof DataStorageCommandError) throw error;
    throw commandError(
      "CONFIG_WRITE_FAILED",
      `The SeqDesk configuration could not be updated: ${snapshot.displayPath}`,
      error
    );
  }
}

async function rollbackConfig(snapshot, writtenRaw) {
  if (!snapshot.existed) {
    let current;
    try {
      current = await fs.readFile(snapshot.targetPath, "utf8");
    } catch (error) {
      if (isMissingError(error)) return;
      throw error;
    }
    if (current !== writtenRaw) {
      throw commandError(
        "CONFIG_CHANGED",
        `The new SeqDesk configuration changed before it could be rolled back: ${snapshot.displayPath}`
      );
    }
    await fs.unlink(snapshot.targetPath);
    await syncDirectory(path.dirname(snapshot.targetPath));
    return;
  }

  await atomicReplaceConfig(snapshot, snapshot.raw, {
    expectedRaw: writtenRaw,
    uid: snapshot.uid,
    gid: snapshot.gid,
    mode: snapshot.mode,
  });
}

function readFileDataPath(config, displayPath) {
  if (config.site === undefined || config.site === null) return null;
  if (!isRecord(config.site)) {
    throw commandError(
      "CONFIG_INVALID_SITE",
      `The site section in the SeqDesk configuration must be a JSON object: ${displayPath}`
    );
  }
  if (
    config.site.dataBasePath !== undefined &&
    config.site.dataBasePath !== null &&
    typeof config.site.dataBasePath !== "string"
  ) {
    throw commandError(
      "CONFIG_INVALID_DATA_PATH",
      `site.dataBasePath in the SeqDesk configuration must be a string: ${displayPath}`
    );
  }
  return optionalString(config.site.dataBasePath);
}

async function readDatabasePath(prisma) {
  let settings;
  try {
    settings = await prisma.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true },
    });
  } catch (error) {
    throw commandError(
      "DATABASE_READ_FAILED",
      "The SeqDesk data storage setting could not be read from the database.",
      error
    );
  }
  return {
    rowExists: Boolean(settings),
    dataBasePath: optionalString(settings?.dataBasePath),
  };
}

async function assertNoDifferingEnvironmentOverride(
  requestedPath,
  environment = process.env
) {
  const environmentPath = optionalString(environment.SEQDESK_DATA_PATH);
  if (!environmentPath) return null;

  const [requestedCanonical, environmentCanonical] = await Promise.all([
    canonicalPathForComparison(requestedPath),
    canonicalPathForComparison(environmentPath),
  ]);
  if (requestedCanonical !== environmentCanonical) {
    throw commandError(
      "ENV_OVERRIDE_CONFLICT",
      "SEQDESK_DATA_PATH currently overrides settings.json with a different path. Remove or update that service environment variable before configuring storage."
    );
  }
  return environmentPath;
}

export async function configureDataStorage({
  storagePath,
  configPath,
  create = false,
  environment = process.env,
  prisma,
}) {
  if (!prisma?.siteSettings) {
    throw commandError(
      "DATABASE_CLIENT_REQUIRED",
      "The SeqDesk database client is unavailable."
    );
  }

  const normalizedPath = normalizeStoragePath(storagePath);
  const environmentPath = await assertNoDifferingEnvironmentOverride(
    normalizedPath,
    environment
  );
  const inspection = await inspectStoragePath(normalizedPath, {
    create,
    strict: true,
  });

  const snapshot = await readConfigSnapshot(configPath);
  assertConfigOwnerCanBePreserved(snapshot);
  readFileDataPath(snapshot.config, snapshot.displayPath);
  await readDatabasePath(prisma);

  const nextConfig = {
    ...snapshot.config,
    site: {
      ...(isRecord(snapshot.config.site) ? snapshot.config.site : {}),
      dataBasePath: normalizedPath,
    },
  };
  const writtenRaw = `${JSON.stringify(nextConfig, null, 2)}\n`;

  await atomicReplaceConfig(snapshot, writtenRaw, {
    uid: snapshot.uid,
    gid: snapshot.gid,
    mode: 0o600,
  });

  try {
    await prisma.siteSettings.upsert({
      where: { id: "singleton" },
      update: { dataBasePath: normalizedPath },
      create: {
        id: "singleton",
        dataBasePath: normalizedPath,
      },
    });
  } catch (databaseError) {
    try {
      await rollbackConfig(snapshot, writtenRaw);
    } catch (rollbackError) {
      throw commandError(
        "ROLLBACK_FAILED",
        `The database update failed and ${snapshot.displayPath} could not be rolled back. Inspect both settings before starting SeqDesk.`,
        new AggregateError([databaseError, rollbackError])
      );
    }
    throw commandError(
      "DATABASE_WRITE_FAILED",
      "The database update failed. The configuration file change was rolled back.",
      databaseError
    );
  }

  const warnings = [];
  if (!inspection.writable) {
    warnings.push(
      "The directory is readable but not writable. Discovery works, but uploads and pipeline writebacks may fail."
    );
  }
  if (environmentPath) {
    warnings.push(
      "SEQDESK_DATA_PATH is active and matches the configured directory."
    );
  }

  return {
    ok: true,
    action: "configure",
    path: normalizedPath,
    canonicalPath: inspection.canonicalPath,
    configPath: snapshot.displayPath,
    source: environmentPath ? "env" : "file",
    created: inspection.created === true,
    readable: inspection.readable,
    searchable: inspection.searchable,
    writable: inspection.writable,
    databaseUpdated: true,
    warnings,
  };
}

function pathsDiffer(left, right) {
  const leftValue = optionalString(left);
  const rightValue = optionalString(right);
  if (!leftValue || !rightValue) return false;
  return path.resolve(leftValue) !== path.resolve(rightValue);
}

export async function getDataStorageStatus({
  configPath,
  environment = process.env,
  prisma,
}) {
  if (!prisma?.siteSettings) {
    throw commandError(
      "DATABASE_CLIENT_REQUIRED",
      "The SeqDesk database client is unavailable."
    );
  }

  const snapshot = await readConfigSnapshot(configPath);
  const filePath = readFileDataPath(snapshot.config, snapshot.displayPath);
  const database = await readDatabasePath(prisma);
  const environmentPath = optionalString(environment.SEQDESK_DATA_PATH);

  let source = "none";
  let effectivePath = null;
  if (environmentPath) {
    source = "env";
    effectivePath = environmentPath;
  } else if (filePath) {
    source = "file";
    effectivePath = filePath;
  } else if (database.dataBasePath) {
    source = "database";
    effectivePath = database.dataBasePath;
  }

  const inspection = effectivePath
    ? await inspectStoragePath(effectivePath)
    : {
        configured: false,
        requestedPath: null,
        canonicalPath: null,
        absolute: false,
        exists: false,
        directory: false,
        readable: false,
        searchable: false,
        writable: false,
        ready: false,
        error: "No data storage path is configured.",
      };

  const warnings = [];
  if (
    environmentPath &&
    (pathsDiffer(environmentPath, filePath) ||
      pathsDiffer(environmentPath, database.dataBasePath))
  ) {
    warnings.push(
      "SEQDESK_DATA_PATH overrides a different path stored in the configuration file or database."
    );
  } else if (pathsDiffer(filePath, database.dataBasePath)) {
    warnings.push(
      "The configuration file and database contain different data storage paths; the configuration file wins."
    );
  }
  if (inspection.ready && !inspection.writable) {
    warnings.push(
      "The directory is readable but not writable. Discovery works, but uploads and pipeline writebacks may fail."
    );
  }
  if (inspection.error) warnings.push(inspection.error);

  return {
    ok: true,
    action: "status",
    source,
    path: effectivePath,
    configPath: snapshot.displayPath,
    sources: {
      env: environmentPath,
      file: filePath,
      database: database.dataBasePath,
    },
    inspection,
    ready: inspection.ready,
    warnings: [...new Set(warnings)],
  };
}

export function parseDataStorageArgs(argv) {
  const [action, ...tokens] = argv;
  if (!ACTIONS.has(action)) {
    throw commandError(
      "USAGE",
      "Usage: configure --path <absolute> --config <root-config-path> [--create] --json | status --config <root-config-path> --json"
    );
  }

  const parsed = {
    action,
    storagePath: null,
    configPath: null,
    create: false,
    json: false,
  };
  const seen = new Set();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token === "--create" || token === "--json") {
      if (seen.has(token)) {
        throw commandError("USAGE", `Duplicate option: ${token}`);
      }
      seen.add(token);
      if (token === "--create") parsed.create = true;
      if (token === "--json") parsed.json = true;
      continue;
    }

    if (token === "--path" || token === "--config") {
      if (seen.has(token)) {
        throw commandError("USAGE", `Duplicate option: ${token}`);
      }
      const value = tokens[index + 1];
      if (!value || value.startsWith("--")) {
        throw commandError("USAGE", `${token} requires a value.`);
      }
      seen.add(token);
      if (token === "--path") parsed.storagePath = value;
      if (token === "--config") parsed.configPath = value;
      index += 1;
      continue;
    }

    throw commandError("USAGE", `Unknown option: ${token}`);
  }

  if (!parsed.configPath) {
    throw commandError("USAGE", "--config is required.");
  }
  if (action === "configure" && !parsed.storagePath) {
    throw commandError("USAGE", "--path is required for configure.");
  }
  if (action === "status" && (parsed.storagePath || parsed.create)) {
    throw commandError(
      "USAGE",
      "--path and --create are only valid with configure."
    );
  }
  return parsed;
}

function failureResult(error) {
  if (error instanceof DataStorageCommandError) {
    return { ok: false, code: error.code, error: error.message };
  }
  return {
    ok: false,
    code: "INTERNAL_ERROR",
    error: "The data storage command failed unexpectedly.",
  };
}

export async function runDataStorageCommand(
  argv,
  { environment = process.env, createPrismaClient } = {}
) {
  let prisma;
  try {
    const parsed = parseDataStorageArgs(argv);
    if (!optionalString(environment.DATABASE_URL)) {
      throw commandError(
        "DATABASE_URL_MISSING",
        "DATABASE_URL is not configured for this SeqDesk installation."
      );
    }

    const makeClient =
      createPrismaClient ||
      (async () => {
        const { PrismaClient } = await import("@prisma/client");
        return new PrismaClient();
      });
    try {
      prisma = await makeClient();
    } catch (error) {
      throw commandError(
        "DATABASE_CLIENT_UNAVAILABLE",
        "The installed SeqDesk database client could not be loaded.",
        error
      );
    }

    if (parsed.action === "configure") {
      return await configureDataStorage({
        storagePath: parsed.storagePath,
        configPath: parsed.configPath,
        create: parsed.create,
        environment,
        prisma,
      });
    }
    return await getDataStorageStatus({
      configPath: parsed.configPath,
      environment,
      prisma,
    });
  } catch (error) {
    return failureResult(error);
  } finally {
    try {
      await prisma?.$disconnect?.();
    } catch {
      // The command result is already determined. Disconnect failures must not
      // replace it or print connection details.
    }
  }
}

async function main() {
  const result = await runDataStorageCommand(process.argv.slice(2));
  process.stdout.write(`${JSON.stringify(result)}\n`);
  if (!result.ok) process.exitCode = 1;
}

async function isInvokedDirectly() {
  if (!process.argv[1]) return false;

  const invokedPath = path.resolve(process.argv[1]);
  try {
    const [invokedRealPath, moduleRealPath] = await Promise.all([
      fs.realpath(invokedPath),
      fs.realpath(fileURLToPath(import.meta.url)),
    ]);
    return invokedRealPath === moduleRealPath;
  } catch {
    return import.meta.url === pathToFileURL(invokedPath).href;
  }
}

const invokedDirectly = await isInvokedDirectly();
if (invokedDirectly) {
  await main();
}
