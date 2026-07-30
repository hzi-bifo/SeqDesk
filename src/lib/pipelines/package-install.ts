import fs from "fs/promises";
import path from "path";
import { randomUUID } from "crypto";
import { hostname } from "os";
import { lintPipelineDescriptor } from "./descriptor-linter";
import { advancePipelinePackageGeneration } from "./package-cache-generation";
import {
  assertValidPipelineId,
  resolvePipelinePackageDir,
} from "./pipeline-paths";

export interface StoreFileEntry {
  path: string;
  content: string;
  encoding?: string;
}

export function resolveStorePath(baseDir: string, relativePath: string): string {
  if (path.isAbsolute(relativePath)) {
    throw new Error(`Invalid absolute path from store: ${relativePath}`);
  }
  const baseResolved = path.resolve(baseDir);
  const resolved = path.resolve(baseResolved, relativePath);
  if (!resolved.startsWith(`${baseResolved}${path.sep}`)) {
    throw new Error(`Invalid path traversal from store: ${relativePath}`);
  }
  return resolved;
}

function readManifestIdFromFileMap(
  payloadFiles: Record<string, unknown>
): string | undefined {
  const manifestRaw = payloadFiles["manifest.json"];
  if (typeof manifestRaw !== "string") return undefined;
  try {
    const parsed = JSON.parse(manifestRaw) as { package?: { id?: string } };
    return parsed.package?.id;
  } catch {
    return undefined;
  }
}

export function assertPackageId(
  payload: Record<string, unknown>,
  pipelineId: string
): void {
  const manifest = payload.manifest as { package?: { id?: string } } | undefined;
  const metaPackage = payload.package as { id?: string } | undefined;
  const filePayloadId =
    payload.files && typeof payload.files === "object" && !Array.isArray(payload.files)
      ? readManifestIdFromFileMap(payload.files as Record<string, unknown>)
      : undefined;
  const payloadId =
    manifest?.package?.id ||
    metaPackage?.id ||
    filePayloadId ||
    (typeof payload.id === "string" ? payload.id : undefined);
  if (payloadId && payloadId !== pipelineId) {
    throw new Error(`Package ID mismatch. Expected ${pipelineId} but got ${payloadId}.`);
  }
}

export async function writePackageFiles(
  pipelineDir: string,
  payload: Record<string, unknown>,
  pipelineId: string
): Promise<void> {
  assertPackageId(payload, pipelineId);

  if (Array.isArray(payload.files)) {
    for (const file of payload.files as StoreFileEntry[]) {
      if (!file?.path || typeof file.path !== "string") {
        throw new Error("Invalid file entry from store.");
      }
      const filePath = resolveStorePath(pipelineDir, file.path);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      const buffer =
        file.encoding === "base64"
          ? Buffer.from(file.content, "base64")
          : Buffer.from(file.content, "utf8");
      await fs.writeFile(filePath, buffer);
    }
    return;
  }

  if (payload.files && typeof payload.files === "object") {
    for (const [filePathRaw, content] of Object.entries(
      payload.files as Record<string, string>
    )) {
      if (typeof content !== "string") {
        throw new Error(`Invalid file content for ${filePathRaw}`);
      }
      const filePath = resolveStorePath(pipelineDir, filePathRaw);
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, content, "utf8");
    }
    return;
  }

  if (payload.manifest && payload.definition && payload.registry) {
    await fs.writeFile(
      resolveStorePath(pipelineDir, "manifest.json"),
      `${JSON.stringify(payload.manifest, null, 2)}\n`
    );
    await fs.writeFile(
      resolveStorePath(pipelineDir, "definition.json"),
      `${JSON.stringify(payload.definition, null, 2)}\n`
    );
    await fs.writeFile(
      resolveStorePath(pipelineDir, "registry.json"),
      `${JSON.stringify(payload.registry, null, 2)}\n`
    );
    if (payload.samplesheet) {
      await fs.writeFile(
        resolveStorePath(pipelineDir, "samplesheet.yaml"),
        String(payload.samplesheet)
      );
    }
    if (payload.parsers && typeof payload.parsers === "object") {
      for (const [parserPath, parserContent] of Object.entries(
        payload.parsers as Record<string, string>
      )) {
        const filePath = resolveStorePath(pipelineDir, parserPath);
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, parserContent, "utf8");
      }
    }
    return;
  }

  throw new Error("Unsupported package payload format from store.");
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

export const PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID =
  "seqdesk-store-e2e-fixture";
export const PIPELINE_INSTALL_CLI_E2E_FAULT_PIPELINE_ID =
  "seqdesk-cli-e2e-fixture";
export const PIPELINE_INSTALL_E2E_FAULT_PHASE =
  "after-backup-before-activate";
export const PIPELINE_INSTALL_E2E_FAULT_FILE =
  ".seqdesk-ci-install-fault.json";
export const PIPELINE_INSTALL_E2E_FAULT_ENV =
  "SEQDESK_PIPELINE_STORE_E2E_FAULTS";

interface PipelineInstallE2EFaultMarker {
  pipelineId?: unknown;
  phase?: unknown;
}

const PIPELINE_INSTALL_E2E_FAULT_PIPELINE_IDS = new Set([
  PIPELINE_INSTALL_E2E_FAULT_PIPELINE_ID,
  PIPELINE_INSTALL_CLI_E2E_FAULT_PIPELINE_ID,
]);

/**
 * Exercise the recovery branch through the real Store install API without
 * making arbitrary package installs fault-injectable. The hook is inert unless
 * all of these conditions hold:
 * - the narrowly scoped Store E2E fault switch is explicitly enabled;
 * - the package has one of the fixed Store/CLI E2E pipeline IDs;
 * - the staged package contains an exact pipeline/phase marker;
 * - the old package has already moved to the backup and the active path is free.
 */
async function injectStoreE2ESwapFailure(options: {
  pipelineId: string;
  pipelineDir: string;
  tempDir: string;
  backupDir: string;
}): Promise<void> {
  const { pipelineId, pipelineDir, tempDir, backupDir } = options;
  const faultInjectionEnabled =
    process.env[PIPELINE_INSTALL_E2E_FAULT_ENV] === "1";
  if (
    !faultInjectionEnabled ||
    !PIPELINE_INSTALL_E2E_FAULT_PIPELINE_IDS.has(pipelineId) ||
    !(await pathExists(backupDir)) ||
    (await pathExists(pipelineDir))
  ) {
    return;
  }

  const markerPath = path.join(tempDir, PIPELINE_INSTALL_E2E_FAULT_FILE);
  let markerRaw: string;
  try {
    const markerStats = await fs.lstat(markerPath);
    if (!markerStats.isFile() || markerStats.size > 1024) {
      return;
    }
    markerRaw = await fs.readFile(markerPath, "utf8");
  } catch {
    return;
  }

  let marker: PipelineInstallE2EFaultMarker;
  try {
    marker = JSON.parse(markerRaw) as PipelineInstallE2EFaultMarker;
  } catch {
    return;
  }
  if (
    marker.pipelineId !== pipelineId ||
    marker.phase !== PIPELINE_INSTALL_E2E_FAULT_PHASE
  ) {
    return;
  }

  throw new Error(
    `Invalid pipeline package: definition.pipeline activation deliberately failed at the E2E-only ${PIPELINE_INSTALL_E2E_FAULT_PHASE} phase for ${pipelineId}.`
  );
}

// Serializes installs/updates per package directory within this process so two
// concurrent admin requests cannot interleave the rename dance in
// performPackageInstall (which would leave the package missing or half-replaced).
const installChains = new Map<string, Promise<unknown>>();

export const PIPELINE_INSTALL_LOCKS_DIR = ".seqdesk-install-locks";
export const PIPELINE_INSTALL_LOCK_OWNER_FILE = "owner.json";

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const DEFAULT_LOCK_STALE_MS = 15 * 60_000;
const DEFAULT_LOCK_POLL_INTERVAL_MS = 50;

interface PipelineInstallLockOwner {
  token: string;
  pid: number;
  hostname: string;
  createdAt: string;
}

interface AcquiredPipelineInstallLock {
  release: () => Promise<void>;
}

export interface PackageInstallOptions {
  replaceExisting?: boolean;
  /**
   * Runs after the cross-process pipeline lock has been acquired and immediately
   * before the package is staged. Callers can use this to re-check assumptions
   * that were made before a download/clone without opening a time-of-check /
   * time-of-use race with another installer.
   */
  beforeLockedInstall?: (context: {
    pipelineId: string;
    pipelineDir: string;
    exists: boolean;
  }) => Promise<void>;
  /**
   * Internal tuning hooks used by diagnostics and tests. Normal callers should
   * use the defaults: wait briefly for another installer and only reap a lock
   * that is demonstrably abandoned or has stopped heartbeating.
   */
  lockTimeoutMs?: number;
  lockStaleMs?: number;
  lockPollIntervalMs?: number;
}

export class PackageAlreadyInstalledError extends Error {
  constructor(readonly pipelineId: string) {
    super(`Pipeline ${pipelineId} is already installed. Retry as an update.`);
    this.name = "PackageAlreadyInstalledError";
  }
}

export class PackageInstallLockTimeoutError extends Error {
  constructor(readonly pipelineId: string, readonly timeoutMs: number) {
    super(
      `Timed out after ${timeoutMs}ms waiting for another installation of pipeline ${pipelineId} to finish.`
    );
    this.name = "PackageInstallLockTimeoutError";
  }
}

function isErrno(error: unknown, code: string): boolean {
  return (error as NodeJS.ErrnoException)?.code === code;
}

function positiveDuration(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  if (value === undefined) return fallback;
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative finite number.`);
  }
  return value;
}

function sleep(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readLockOwner(
  lockPath: string
): Promise<PipelineInstallLockOwner | null> {
  try {
    const raw = await fs.readFile(
      path.join(lockPath, PIPELINE_INSTALL_LOCK_OWNER_FILE),
      "utf8"
    );
    const parsed = JSON.parse(raw) as Partial<PipelineInstallLockOwner>;
    if (
      typeof parsed.token !== "string" ||
      typeof parsed.pid !== "number" ||
      typeof parsed.hostname !== "string" ||
      typeof parsed.createdAt !== "string"
    ) {
      return null;
    }
    return parsed as PipelineInstallLockOwner;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isSafeInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return isErrno(error, "EPERM");
  }
}

async function reapStaleInstallLock(
  lockPath: string,
  staleMs: number
): Promise<boolean> {
  let lockStats;
  try {
    lockStats = await fs.stat(lockPath);
  } catch (error) {
    return isErrno(error, "ENOENT");
  }

  const owner = await readLockOwner(lockPath);
  const locallyDead =
    owner?.hostname === hostname() && !isProcessAlive(owner.pid);
  const heartbeatExpired = Date.now() - lockStats.mtimeMs >= staleMs;
  if (!locallyDead && !heartbeatExpired) {
    return false;
  }

  // Claim the stale directory with a rename before deleting it. Competing
  // installers can then race safely: exactly one rename succeeds.
  const stalePath = `${lockPath}.stale-${randomUUID()}`;
  try {
    await fs.rename(lockPath, stalePath);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return true;
    return false;
  }
  await fs.rm(stalePath, { recursive: true, force: true });
  return true;
}

async function acquirePipelineInstallLock(
  pipelinesDir: string,
  pipelineId: string,
  options: PackageInstallOptions
): Promise<AcquiredPipelineInstallLock> {
  const timeoutMs = positiveDuration(
    options.lockTimeoutMs,
    DEFAULT_LOCK_TIMEOUT_MS,
    "lockTimeoutMs"
  );
  const staleMs = positiveDuration(
    options.lockStaleMs,
    DEFAULT_LOCK_STALE_MS,
    "lockStaleMs"
  );
  const pollIntervalMs = positiveDuration(
    options.lockPollIntervalMs,
    DEFAULT_LOCK_POLL_INTERVAL_MS,
    "lockPollIntervalMs"
  );
  const lockRoot = path.join(
    path.resolve(pipelinesDir),
    PIPELINE_INSTALL_LOCKS_DIR
  );
  const lockPath = path.join(lockRoot, `${pipelineId}.lock`);
  const deadline = Date.now() + timeoutMs;

  await fs.mkdir(lockRoot, { recursive: true, mode: 0o700 });

  while (true) {
    const token = randomUUID();
    try {
      await fs.mkdir(lockPath, { mode: 0o700 });
      const owner: PipelineInstallLockOwner = {
        token,
        pid: process.pid,
        hostname: hostname(),
        createdAt: new Date().toISOString(),
      };
      try {
        await fs.writeFile(
          path.join(lockPath, PIPELINE_INSTALL_LOCK_OWNER_FILE),
          `${JSON.stringify(owner)}\n`,
          { encoding: "utf8", mode: 0o600, flag: "wx" }
        );
      } catch (error) {
        await fs.rm(lockPath, { recursive: true, force: true });
        throw error;
      }

      const heartbeatIntervalMs = Math.max(
        25,
        Math.min(Math.floor(Math.max(staleMs, 1) / 3), 30_000)
      );
      const heartbeat = setInterval(() => {
        const now = new Date();
        void fs.utimes(lockPath, now, now).catch(() => {});
      }, heartbeatIntervalMs);
      heartbeat.unref();

      return {
        release: async () => {
          clearInterval(heartbeat);
          const currentOwner = await readLockOwner(lockPath);
          if (currentOwner?.token === token) {
            await fs.rm(lockPath, { recursive: true, force: true });
          }
        },
      };
    } catch (error) {
      if (!isErrno(error, "EEXIST")) {
        throw error;
      }
    }

    if (await reapStaleInstallLock(lockPath, staleMs)) {
      continue;
    }
    if (Date.now() >= deadline) {
      throw new PackageInstallLockTimeoutError(pipelineId, timeoutMs);
    }
    await sleep(Math.min(Math.max(pollIntervalMs, 1), deadline - Date.now()));
  }
}

export function installPackageDirectory(
  pipelinesDir: string,
  pipelineId: string,
  writer: (tempDir: string) => Promise<void>,
  options: PackageInstallOptions = {}
): Promise<"install" | "update"> {
  assertValidPipelineId(pipelineId);
  const key = resolvePipelinePackageDir(pipelinesDir, pipelineId);
  const run = (installChains.get(key) ?? Promise.resolve())
    .catch(() => {})
    .then(() =>
      performPackageInstall(pipelinesDir, pipelineId, writer, options)
    );
  installChains.set(key, run);
  // Drop the chain entry once it settles so the map does not grow unbounded.
  run
    .finally(() => {
      if (installChains.get(key) === run) {
        installChains.delete(key);
      }
    })
    .catch(() => {});
  return run;
}

async function performPackageInstall(
  pipelinesDir: string,
  pipelineId: string,
  writer: (tempDir: string) => Promise<void>,
  options: PackageInstallOptions
): Promise<"install" | "update"> {
  const lock = await acquirePipelineInstallLock(
    pipelinesDir,
    pipelineId,
    options
  );
  try {
    return await performLockedPackageInstall(
      pipelinesDir,
      pipelineId,
      writer,
      options
    );
  } finally {
    await lock.release();
  }
}

async function performLockedPackageInstall(
  pipelinesDir: string,
  pipelineId: string,
  writer: (tempDir: string) => Promise<void>,
  options: PackageInstallOptions
): Promise<"install" | "update"> {
  const pipelineDir = resolvePipelinePackageDir(pipelinesDir, pipelineId);
  const exists = await pathExists(pipelineDir);
  await options.beforeLockedInstall?.({
    pipelineId,
    pipelineDir,
    exists,
  });
  if (exists && options.replaceExisting === false) {
    throw new PackageAlreadyInstalledError(pipelineId);
  }
  // Use a unique suffix so two installs that start in the same millisecond do not
  // collide on the same temp/backup paths.
  const unique = randomUUID();
  const tempDir = path.join(pipelinesDir, `${pipelineId}.__tmp-${unique}`);
  const backupDir = path.join(pipelinesDir, `${pipelineId}.__backup-${unique}`);

  await fs.mkdir(pipelinesDir, { recursive: true });
  await fs.mkdir(tempDir, { recursive: true });

  try {
    await writer(tempDir);
    const validation = await lintPipelineDescriptor(tempDir, pipelineId);
    if (!validation.valid) {
      const details = validation.issues
        .filter((issue) => issue.level === "error")
        .map((issue) => `${issue.file ? `${issue.file}: ` : ""}${issue.message}`)
        .join(" ");
      throw new Error(
        `Invalid pipeline package${details ? `: ${details}` : "."}`
      );
    }
    if (exists) {
      await fs.rename(pipelineDir, backupDir);
    }
    try {
      if (exists) {
        await injectStoreE2ESwapFailure({
          pipelineId,
          pipelineDir,
          tempDir,
          backupDir,
        });
      }
      await fs.rename(tempDir, pipelineDir);
      await advancePipelinePackageGeneration(pipelinesDir);
    } catch (error) {
      if (exists && (await pathExists(backupDir))) {
        if (await pathExists(pipelineDir)) {
          // The staged package was activated but the generation marker could
          // not be committed. Move it back out before restoring the old package
          // so callers never observe a successful-looking partial update.
          await fs.rename(pipelineDir, tempDir);
        }
        await fs.rename(backupDir, pipelineDir);
      } else if (!exists && (await pathExists(pipelineDir))) {
        await fs.rm(pipelineDir, { recursive: true, force: true });
      }
      throw error;
    }
    if (exists) {
      try {
        await fs.rm(backupDir, { recursive: true, force: true });
      } catch (error) {
        // The new package is already active. A stale recovery backup should not
        // turn a successful install into an error response that prompts the
        // admin to retry an update that has actually completed.
        console.warn(
          `Pipeline ${pipelineId} was updated, but its backup could not be removed:`,
          error
        );
      }
    }
  } catch (error) {
    await fs.rm(tempDir, { recursive: true, force: true });
    throw error;
  }

  return exists ? "update" : "install";
}
