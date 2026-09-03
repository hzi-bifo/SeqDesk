import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import * as fs from "node:fs/promises";
import * as path from "node:path";

import {
  getResolvedDataBasePath,
  type DataBasePathSource,
  type ResolvedDataBasePath,
} from "./data-base-path";

export const MANAGED_STORAGE_READINESS_VERSION = 1 as const;

export type ManagedStorageReadinessStatus = "ready" | "not-ready";
export type ManagedStorageCheckStatus = "pass" | "warning" | "fail";
export type ManagedStorageCheckId =
  | "configuration"
  | "path"
  | "capacity"
  | "read-access"
  | "write-probe";

export interface ManagedStorageReadinessCheck {
  id: ManagedStorageCheckId;
  status: ManagedStorageCheckStatus;
  message: string;
}

export interface ManagedStorageReadinessMetrics {
  configured: boolean;
  source: DataBasePathSource;
  implicit: boolean;
  readable: boolean;
  writable: boolean;
  /** Exact base-10 byte count. A string avoids losing precision in JSON. */
  availableBytes: string | null;
}

export interface ManagedStorageFingerprint {
  fingerprint: string;
  configurationState: "resolved" | "unavailable";
  configured: boolean;
  source: DataBasePathSource;
  implicit: boolean;
}

export interface ManagedStorageReadiness {
  ready: boolean;
  status: ManagedStorageReadinessStatus;
  checkedAt: string;
  summary: string;
  /** Hash of the effective storage configuration. Raw host paths are not exposed. */
  fingerprint: string;
  checks: ManagedStorageReadinessCheck[];
  metrics: ManagedStorageReadinessMetrics;
}

interface EffectiveStorageIdentity extends ManagedStorageFingerprint {
  configuredPath: string | null;
}

type BigIntStatFs = {
  bsize: bigint;
  bavail: bigint;
};

function hashFingerprintMaterial(material: Record<string, unknown>): string {
  return createHash("sha256").update(JSON.stringify(material)).digest("hex");
}

function normalizeConfiguredPath(value: string | null | undefined): string | null {
  const trimmed = value?.trim() ?? "";
  if (!trimmed) return null;
  return path.isAbsolute(trimmed) ? path.normalize(trimmed) : trimmed;
}

function resolveEffectiveStorageIdentity(
  resolved: ResolvedDataBasePath
): EffectiveStorageIdentity {
  const configuredPath = normalizeConfiguredPath(resolved.dataBasePath);

  const fingerprint = hashFingerprintMaterial({
    version: MANAGED_STORAGE_READINESS_VERSION,
    configuredPath,
    source: resolved.source,
    implicit: resolved.isImplicit,
  });

  return {
    fingerprint,
    configurationState: "resolved",
    configured: Boolean(configuredPath),
    source: resolved.source,
    implicit: resolved.isImplicit,
    configuredPath,
  };
}

function unavailableStorageIdentity(): EffectiveStorageIdentity {
  return {
    fingerprint: hashFingerprintMaterial({
      version: MANAGED_STORAGE_READINESS_VERSION,
      configurationState: "unavailable",
    }),
    configurationState: "unavailable",
    configured: false,
    source: "none",
    implicit: false,
    configuredPath: null,
  };
}

/**
 * Resolve the effective storage configuration without performing a write probe.
 *
 * This is suitable for comparing persisted onboarding evidence during normal
 * requests. It deliberately performs no filesystem access: a dead network
 * mount must not block login or dashboard rendering. The administrator-only
 * readiness action performs the real filesystem probe.
 */
export async function resolveManagedStorageFingerprint(): Promise<ManagedStorageFingerprint> {
  try {
    const resolved = await getResolvedDataBasePath();
    const identity = resolveEffectiveStorageIdentity(resolved);
    return {
      fingerprint: identity.fingerprint,
      configurationState: identity.configurationState,
      configured: identity.configured,
      source: identity.source,
      implicit: identity.implicit,
    };
  } catch {
    const identity = unavailableStorageIdentity();
    return {
      fingerprint: identity.fingerprint,
      configurationState: identity.configurationState,
      configured: identity.configured,
      source: identity.source,
      implicit: identity.implicit,
    };
  }
}

async function getAvailableBytes(canonicalPath: string): Promise<string | null> {
  const statfs = (fs as unknown as {
    statfs?: (target: string, options: { bigint: true }) => Promise<BigIntStatFs>;
  }).statfs;
  if (typeof statfs !== "function") return null;

  try {
    const stats = await statfs(canonicalPath, { bigint: true });
    if (stats.bsize < BigInt(0) || stats.bavail < BigInt(0)) return null;
    return (stats.bsize * stats.bavail).toString();
  } catch {
    return null;
  }
}

async function probeWritableDirectory(
  requestedPath: string,
  canonicalPath: string
): Promise<void> {
  let probeDirectory: string | null = null;
  let probeDirectoryIdentity: { device: number; inode: number } | null = null;
  let probeHandle: Awaited<ReturnType<typeof fs.open>> | null = null;

  try {
    probeDirectory = await fs.mkdtemp(
      path.join(canonicalPath, ".seqdesk-storage-readiness-")
    );
    await fs.chmod(probeDirectory, 0o700);

    const probeDirectoryStat = await fs.lstat(probeDirectory);
    probeDirectoryIdentity = {
      device: probeDirectoryStat.dev,
      inode: probeDirectoryStat.ino,
    };
    const canonicalProbeDirectory = await fs.realpath(probeDirectory);
    if (
      probeDirectoryStat.isSymbolicLink() ||
      !probeDirectoryStat.isDirectory() ||
      path.dirname(canonicalProbeDirectory) !== canonicalPath
    ) {
      throw new Error("Managed-storage readiness probe escaped its root.");
    }

    const temporaryFile = path.join(probeDirectory, "write-probe.tmp");
    const committedFile = path.join(probeDirectory, "write-probe");
    probeHandle = await fs.open(temporaryFile, "wx", 0o600);
    await probeHandle.chmod(0o600);
    await probeHandle.writeFile("seqdesk managed-storage readiness\n", "utf8");
    await probeHandle.sync();
    await probeHandle.close();
    probeHandle = null;

    const temporaryFileStat = await fs.lstat(temporaryFile);
    if (
      temporaryFileStat.isSymbolicLink() ||
      !temporaryFileStat.isFile() ||
      (temporaryFileStat.mode & 0o077) !== 0
    ) {
      throw new Error("Managed-storage readiness probe file has an unsafe type or mode.");
    }

    await fs.rename(temporaryFile, committedFile);
    const committedFileStat = await fs.lstat(committedFile);
    if (committedFileStat.isSymbolicLink() || !committedFileStat.isFile()) {
      throw new Error("Managed-storage readiness probe file has an unsafe type.");
    }
    await fs.unlink(committedFile);
    await fs.rmdir(probeDirectory);
    probeDirectory = null;

    if ((await fs.realpath(requestedPath)) !== canonicalPath) {
      throw new Error("Configured managed storage changed during its readiness probe.");
    }
  } finally {
    await probeHandle?.close().catch(() => undefined);

    if (probeDirectory) {
      try {
        const resolvedProbeDirectory = path.resolve(probeDirectory);
        const cleanupPathIsSafe =
          path.dirname(resolvedProbeDirectory) === canonicalPath &&
          path
            .basename(resolvedProbeDirectory)
            .startsWith(".seqdesk-storage-readiness-");

        if (cleanupPathIsSafe) {
          const current = await fs.lstat(resolvedProbeDirectory);
          if (current.isSymbolicLink()) {
            await fs.unlink(resolvedProbeDirectory);
          } else if (
            probeDirectoryIdentity &&
            current.dev === probeDirectoryIdentity.device &&
            current.ino === probeDirectoryIdentity.inode
          ) {
            await fs.rm(resolvedProbeDirectory, { recursive: true, force: true });
          } else if (!probeDirectoryIdentity) {
            // If the initial identity check failed, only remove an empty path.
            await fs.rmdir(resolvedProbeDirectory);
          }
        }
      } catch {
        // Best-effort cleanup of the uniquely named, private probe directory.
      }
    }
  }
}

function result(args: {
  identity: EffectiveStorageIdentity;
  checkedAt: string;
  ready: boolean;
  summary: string;
  checks: ManagedStorageReadinessCheck[];
  readable?: boolean;
  writable?: boolean;
  availableBytes?: string | null;
}): ManagedStorageReadiness {
  return {
    ready: args.ready,
    status: args.ready ? "ready" : "not-ready",
    checkedAt: args.checkedAt,
    summary: args.summary,
    fingerprint: args.identity.fingerprint,
    checks: args.checks,
    metrics: {
      configured: args.identity.configured,
      source: args.identity.source,
      implicit: args.identity.implicit,
      readable: args.readable ?? false,
      writable: args.writable ?? false,
      availableBytes: args.availableBytes ?? null,
    },
  };
}

/**
 * Verify the currently effective SeqDesk managed-storage root.
 *
 * The configured root must already exist. The write probe runs as the current
 * SeqDesk service process and removes its private artifacts before returning.
 * Capacity is reported when the filesystem supports statfs, but this helper
 * deliberately does not impose a product-specific minimum-capacity policy.
 */
export async function checkManagedStorageReadiness(): Promise<ManagedStorageReadiness> {
  const checkedAt = new Date().toISOString();
  const checks: ManagedStorageReadinessCheck[] = [];
  let resolved: ResolvedDataBasePath;

  try {
    resolved = await getResolvedDataBasePath();
  } catch {
    const identity = unavailableStorageIdentity();
    checks.push({
      id: "configuration",
      status: "fail",
      message: "Managed storage configuration could not be resolved.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "Managed storage configuration is unavailable.",
      checks,
    });
  }

  const identity = resolveEffectiveStorageIdentity(resolved);
  const configuredPath = identity.configuredPath;

  if (!configuredPath) {
    checks.push({
      id: "configuration",
      status: "fail",
      message: "No managed storage path is configured.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "Managed storage is not configured.",
      checks,
    });
  }
  if (identity.implicit) {
    checks.push({
      id: "configuration",
      status: "fail",
      message: "The local development fallback is not a durable storage configuration.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "Managed storage must be configured explicitly.",
      checks,
    });
  }

  checks.push({
    id: "configuration",
    status: "pass",
    message: "An explicit managed storage path is configured.",
  });

  if (!path.isAbsolute(configuredPath)) {
    checks.push({
      id: "path",
      status: "fail",
      message: "Managed storage must use an absolute path.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The managed storage path is invalid.",
      checks,
    });
  }

  const normalizedPath = path.normalize(configuredPath);
  if (normalizedPath === path.parse(normalizedPath).root) {
    checks.push({
      id: "path",
      status: "fail",
      message: "The filesystem root cannot be used as managed storage.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The managed storage path is unsafe.",
      checks,
    });
  }

  let entry;
  try {
    entry = await fs.lstat(normalizedPath);
  } catch {
    checks.push({
      id: "path",
      status: "fail",
      message: "The configured managed storage directory does not exist or is inaccessible.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The managed storage directory is unavailable.",
      checks,
    });
  }

  try {
    const stats = entry.isSymbolicLink() ? await fs.stat(normalizedPath) : entry;
    if (!stats.isDirectory()) {
      checks.push({
        id: "path",
        status: "fail",
        message: "The configured managed storage path is not a directory.",
      });
      return result({
        identity,
        checkedAt,
        ready: false,
        summary: "The managed storage path is not a directory.",
        checks,
      });
    }
  } catch {
    checks.push({
      id: "path",
      status: "fail",
      message: "The configured managed storage directory cannot be inspected.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The managed storage directory is unavailable.",
      checks,
    });
  }

  let canonicalPath: string;
  try {
    canonicalPath = await fs.realpath(normalizedPath);
  } catch {
    checks.push({
      id: "path",
      status: "fail",
      message: "The configured managed storage directory cannot be resolved.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The managed storage directory is unavailable.",
      checks,
    });
  }
  if (canonicalPath === path.parse(canonicalPath).root) {
    checks.push({
      id: "path",
      status: "fail",
      message: "The filesystem root cannot be used as managed storage.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The managed storage path is unsafe.",
      checks,
    });
  }

  checks.push({
    id: "path",
    status: "pass",
    message: "The managed storage path resolves to a directory.",
  });

  const availableBytes = await getAvailableBytes(canonicalPath);
  checks.push({
    id: "capacity",
    status: availableBytes === null ? "warning" : "pass",
    message:
      availableBytes === null
        ? "Available storage capacity could not be measured."
        : "Available storage capacity was measured.",
  });

  try {
    await fs.access(normalizedPath, fsConstants.R_OK | fsConstants.X_OK);
  } catch {
    checks.push({
      id: "read-access",
      status: "fail",
      message: "Managed storage is not readable and searchable by the SeqDesk service.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The SeqDesk service cannot read managed storage.",
      checks,
      availableBytes,
    });
  }

  checks.push({
    id: "read-access",
    status: "pass",
    message: "Managed storage is readable by the SeqDesk service.",
  });

  try {
    await probeWritableDirectory(normalizedPath, canonicalPath);
  } catch {
    checks.push({
      id: "write-probe",
      status: "fail",
      message: "The SeqDesk service could not complete a managed storage write probe.",
    });
    return result({
      identity,
      checkedAt,
      ready: false,
      summary: "The SeqDesk service cannot safely write managed storage.",
      checks,
      readable: true,
      availableBytes,
    });
  }

  checks.push({
    id: "write-probe",
    status: "pass",
    message: "The SeqDesk service completed a private write and rename probe.",
  });

  return result({
    identity,
    checkedAt,
    ready: true,
    summary: "Managed storage is ready for SeqDesk writes.",
    checks,
    readable: true,
    writable: true,
    availableBytes,
  });
}
