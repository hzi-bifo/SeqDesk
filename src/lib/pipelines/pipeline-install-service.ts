import path from "path";
import fs from "fs/promises";
import os from "os";
import crypto from "crypto";
import { execFile } from "child_process";
import { promisify } from "util";
import { db } from "@/lib/db";
import {
  clearPackageCache,
} from "./package-loader";
import { clearRegistryCache } from "./registry";
import {
  installPackageDirectory,
  PackageAlreadyInstalledError,
  writePackageFiles,
  type PackageInstallOptions,
} from "./package-install";
import {
  getPipelinesDir,
  isValidPipelineId,
  resolvePipelinePackageDir,
} from "./pipeline-paths";
import {
  classifyCloneFailure,
  installGitHubPipelineSnapshot,
  isValidGitRef,
  PipelineDescriptorValidationError,
} from "./metaxpath-import";
import {
  METAXPATH_PIPELINE_ID,
  resolveMetaxPathRef,
  resolveMetaxPathRepository,
} from "./metaxpath-config";
import {
  getManagedPipelineStatus,
  updateManagedPipeline,
  type ManagedPipelineCatalogEntry,
} from "./pipeline-management-service";
import {
  findUniqueStorePipeline,
  loadPipelineStoreCatalog,
  type LoadPipelineStoreCatalogOptions,
} from "./pipeline-store-service";
import {
  writePipelineInstallProvenanceToPackageDir,
} from "./pipeline-install-provenance";
import type {
  PipelineSourceDescriptor,
  StorePipelineResponse,
} from "./store-sources";

const execFileAsync = promisify(execFile);
const DEFAULT_GITHUB_REF = "main";
const PACKAGE_FETCH_TIMEOUT_MS = 30_000;
const GITHUB_CLONE_TIMEOUT_MS = 120_000;

export interface ManagedPipelineInstallCredentials {
  accessKey?: string;
  token?: string;
  sha256?: string;
}

export interface InstallManagedPipelineInput {
  pipelineId: string;
  version?: string;
  /**
   * true forces a replacement, false rejects an existing different package,
   * and undefined performs an idempotent no-op for the same version or updates
   * when the selected Store version is newer.
   */
  replace?: boolean;
  sourceId?: string;
  source?: Partial<PipelineSourceDescriptor>;
  credentials?: ManagedPipelineInstallCredentials;
  privatePackageUrl?: string;
  autoEnable?: boolean;
  store?: LoadPipelineStoreCatalogOptions;
}

export interface InstallManagedPipelineResult {
  success: true;
  message: string;
  pipelineId: string;
  version: string;
  source: string;
  sourceId: string;
  action: "install" | "update" | "noop";
  packageState: ManagedPipelineCatalogEntry["packageState"];
  setupState: ManagedPipelineCatalogEntry["setupState"];
  activationState: ManagedPipelineCatalogEntry["activationState"];
  setupRequired: boolean;
  autoEnabled: boolean;
  enabled: boolean;
  readiness: ManagedPipelineCatalogEntry["readiness"];
  nextActions: ManagedPipelineCatalogEntry["nextActions"];
  status: ManagedPipelineCatalogEntry | null;
  warnings: string[];
}

export class PipelineInstallError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly details?: string
  ) {
    super(message);
    this.name = "PipelineInstallError";
  }
}

function trimToUndefined(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function getExecErrorDetails(error: unknown): string {
  if (
    typeof error === "object" &&
    error !== null &&
    "stderr" in error &&
    typeof (error as { stderr?: unknown }).stderr === "string"
  ) {
    const stderr = ((error as { stderr: string }).stderr || "").trim();
    if (stderr) return stderr;
  }
  if (
    typeof error === "object" &&
    error !== null &&
    "stdout" in error &&
    typeof (error as { stdout?: unknown }).stdout === "string"
  ) {
    const stdout = ((error as { stdout: string }).stdout || "").trim();
    if (stdout) return stdout;
  }
  return error instanceof Error ? error.message : "Unknown error";
}

function assertSafePackageUrl(rawUrl: string): string {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new PipelineInstallError("Invalid pipeline package URL.", 400);
  }
  if (url.protocol === "https:") return url.toString();
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "127.0.0.1" ||
    url.hostname === "[::1]" ||
    url.hostname === "::1";
  if (
    url.protocol === "http:" &&
    (loopback || process.env.SEQDESK_ALLOW_INSECURE_PIPELINE_URLS === "1")
  ) {
    return url.toString();
  }
  throw new PipelineInstallError(
    "Pipeline package URLs must use HTTPS. Set SEQDESK_ALLOW_INSECURE_PIPELINE_URLS=1 only for a trusted private HTTP registry.",
    400
  );
}

async function createAskPassScript(baseDir: string): Promise<string> {
  const scriptPath = path.join(baseDir, "git-askpass.sh");
  const script = [
    "#!/bin/sh",
    'case "$1" in',
    '  *Username*) echo "x-access-token" ;;',
    '  *Password*) echo "${GITHUB_TOKEN}" ;;',
    '  *) echo "${GITHUB_TOKEN}" ;;',
    "esac",
    "",
  ].join("\n");
  await fs.writeFile(scriptPath, script, { mode: 0o700 });
  await fs.chmod(scriptPath, 0o700);
  return scriptPath;
}

async function cloneGitHubRepository(
  repo: string,
  ref: string,
  token: string | undefined,
  cloneDir: string,
  askPassPath: string | undefined
): Promise<void> {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    GIT_TERMINAL_PROMPT: "0",
  };
  if (token && askPassPath) {
    env.GIT_ASKPASS = askPassPath;
    env.GITHUB_TOKEN = token;
  }

  await execFileAsync(
    "git",
    [
      "clone",
      "--depth",
      "1",
      "--branch",
      ref,
      `https://github.com/${repo}.git`,
      cloneDir,
    ],
    {
      env,
      maxBuffer: 10 * 1024 * 1024,
      timeout: GITHUB_CLONE_TIMEOUT_MS,
      killSignal: "SIGTERM",
    }
  );
}

async function fetchPackagePayload(
  rawUrl: string,
  accessKey?: string,
  expectedSha256?: string
): Promise<Record<string, unknown>> {
  const url = assertSafePackageUrl(rawUrl);
  const headers = new Headers();
  if (accessKey) {
    headers.set("authorization", `Bearer ${accessKey}`);
  }
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    PACKAGE_FETCH_TIMEOUT_MS
  );
  let raw: string;
  try {
    const response = await fetch(url, {
      cache: "no-store",
      headers,
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(
        `Failed to download pipeline package (${response.status})`
      );
    }
    raw = await response.text();
  } catch (error) {
    if (controller.signal.aborted) {
      throw new PipelineInstallError(
        `Pipeline package download timed out after ${PACKAGE_FETCH_TIMEOUT_MS}ms.`,
        504
      );
    }
    const details =
      error instanceof Error ? error.message : "Unknown error";
    throw new PipelineInstallError(
      "Pipeline package download failed",
      502,
      details
    );
  } finally {
    clearTimeout(timeout);
  }

  if (expectedSha256) {
    const expected = expectedSha256
      .replace(/^sha256:/i, "")
      .trim()
      .toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(expected)) {
      throw new PipelineInstallError(
        "Invalid sha256 checksum format for pipeline package.",
        400
      );
    }
    const actual = crypto
      .createHash("sha256")
      .update(raw, "utf8")
      .digest("hex");
    if (actual !== expected) {
      throw new PipelineInstallError(
        "Pipeline package checksum verification failed.",
        422
      );
    }
  }

  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch (error) {
    const details =
      error instanceof Error ? error.message : "Invalid JSON payload.";
    throw new PipelineInstallError(
      "Pipeline source returned an invalid package payload.",
      422,
      details
    );
  }
}

async function installFromPackagePayload(
  pipelineId: string,
  payload: Record<string, unknown>,
  replaceExisting: boolean,
  beforeLockedInstall: PackageInstallOptions["beforeLockedInstall"],
  provenance: {
    version: string;
    sourceId: string;
    sourceKind: "registry" | "privateRegistry";
  }
): Promise<"install" | "update"> {
  try {
    return await installPackageDirectory(
      getPipelinesDir(),
      pipelineId,
      async (tempDir) => {
        await writePackageFiles(tempDir, payload, pipelineId);
        await writePipelineInstallProvenanceToPackageDir(
          {
            pipelineId,
            version: provenance.version,
            sourceId: provenance.sourceId,
            sourceKind: provenance.sourceKind,
          },
          tempDir
        );
      },
      {
        replaceExisting,
        beforeLockedInstall,
      }
    );
  } catch (error) {
    if (error instanceof PackageAlreadyInstalledError) throw error;
    const details =
      error instanceof Error ? error.message : "Unknown error";
    if (
      details.startsWith("Invalid pipeline package") ||
      details.startsWith("Unsupported package payload") ||
      details.startsWith("Package ID mismatch") ||
      details.startsWith("Invalid file") ||
      details.startsWith("Invalid path") ||
      details.startsWith("Invalid absolute path") ||
      details.startsWith("Invalid file content")
    ) {
      throw new PipelineInstallError(details, 422);
    }
    throw error;
  }
}

async function installFromGitHub(
  pipelineId: string,
  source: Partial<PipelineSourceDescriptor>,
  credentials: ManagedPipelineInstallCredentials | undefined,
  replaceExisting: boolean,
  beforeLockedInstall: PackageInstallOptions["beforeLockedInstall"],
  sourceId: string
): Promise<{
  action: "install" | "update";
  version?: string;
  source: string;
}> {
  const requestedRepo = trimToUndefined(source.repository);
  const requestedRef = trimToUndefined(source.refDefault);
  const repo =
    pipelineId === METAXPATH_PIPELINE_ID
      ? resolveMetaxPathRepository(requestedRepo)
      : requestedRepo;
  const ref =
    pipelineId === METAXPATH_PIPELINE_ID
      ? resolveMetaxPathRef(requestedRef, requestedRepo)
      : requestedRef || DEFAULT_GITHUB_REF;
  const token = trimToUndefined(credentials?.token);

  if (!repo) {
    throw new PipelineInstallError(
      "GitHub installs require a repository.",
      400
    );
  }
  if (!isValidGitRef(ref)) {
    throw new PipelineInstallError(
      "Invalid Git reference format.",
      400
    );
  }

  const tempRoot = await fs.mkdtemp(
    path.join(os.tmpdir(), "seqdesk-github-pipeline-")
  );
  const cloneDir = path.join(tempRoot, "repo");
  const askPassPath = token
    ? await createAskPassScript(tempRoot)
    : undefined;

  try {
    try {
      await cloneGitHubRepository(
        repo,
        ref,
        token,
        cloneDir,
        askPassPath
      );
    } catch (error) {
      const details = getExecErrorDetails(error);
      if (
        typeof error === "object" &&
        error !== null &&
        (("killed" in error && error.killed === true) ||
          ("signal" in error && error.signal === "SIGTERM"))
      ) {
        throw new PipelineInstallError(
          `GitHub clone timed out after ${GITHUB_CLONE_TIMEOUT_MS}ms.`,
          504
        );
      }
      const classification = classifyCloneFailure(details);
      const diagnostic = details.slice(0, 500);
      throw new PipelineInstallError(
        diagnostic && !classification.error.includes(diagnostic)
          ? `${classification.error} ${diagnostic}`
          : classification.error,
        classification.status
      );
    }
    const result = await installGitHubPipelineSnapshot({
      pipelineId,
      cloneDir,
      repo,
      ref,
      descriptorPath: trimToUndefined(source.descriptorPath),
      includeWorkflow:
        typeof source.includeWorkflow === "boolean"
          ? source.includeWorkflow
          : undefined,
      replaceExisting,
      beforeLockedInstall,
      installProvenance: {
        sourceId,
        sourceKind: "github",
      },
    });
    return {
      action: result.action,
      version: result.manifest?.package.version,
      source: `github:${repo}@${ref}`,
    };
  } finally {
    try {
      await fs.rm(tempRoot, { recursive: true, force: true });
    } catch (error) {
      console.warn(
        `[Pipeline Install] Could not clean up temporary GitHub checkout ${tempRoot}:`,
        error
      );
    }
  }
}

async function pathExists(targetPath: string): Promise<boolean> {
  try {
    await fs.access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function readInstalledPackageVersion(
  pipelineId: string,
  packageDir = resolvePipelinePackageDir(getPipelinesDir(), pipelineId)
): Promise<string | null> {
  const manifestPath = path.join(
    packageDir,
    "manifest.json"
  );
  try {
    const stats = await fs.lstat(manifestPath);
    if (
      stats.isSymbolicLink() ||
      !stats.isFile() ||
      stats.size > 2 * 1024 * 1024
    ) {
      return null;
    }
    const manifest = JSON.parse(
      await fs.readFile(manifestPath, "utf8")
    ) as { package?: { version?: unknown } };
    return trimToUndefined(manifest.package?.version) || null;
  } catch {
    return null;
  }
}

function parseComparableVersion(
  value: string
): { numbers: number[]; prerelease: string | null } | null {
  const normalized = value.trim().replace(/^v/i, "");
  const match = normalized.match(
    /^(\d+(?:\.\d+)*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/
  );
  if (!match) return null;
  return {
    numbers: match[1].split(".").map((part) => Number(part)),
    prerelease: match[2] || null,
  };
}

export function comparePipelineVersions(
  left: string,
  right: string
): number | null {
  const leftVersion = parseComparableVersion(left);
  const rightVersion = parseComparableVersion(right);
  if (!leftVersion || !rightVersion) return null;
  const length = Math.max(
    leftVersion.numbers.length,
    rightVersion.numbers.length
  );
  for (let index = 0; index < length; index += 1) {
    const difference =
      (leftVersion.numbers[index] || 0) -
      (rightVersion.numbers[index] || 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  if (leftVersion.prerelease === rightVersion.prerelease) return 0;
  if (!leftVersion.prerelease) return 1;
  if (!rightVersion.prerelease) return -1;
  return leftVersion.prerelease.localeCompare(rightVersion.prerelease);
}

class LockedPipelineInstallNoop extends Error {
  constructor(readonly installedVersion: string) {
    super(`Pipeline version ${installedVersion} was installed concurrently.`);
    this.name = "LockedPipelineInstallNoop";
  }
}

function buildLockedInstallGuard(args: {
  pipelineId: string;
  initialExists: boolean;
  initialVersion: string | null;
  selectedVersion: string;
  replace: boolean | undefined;
}): NonNullable<PackageInstallOptions["beforeLockedInstall"]> {
  return async ({ pipelineDir, exists }) => {
    const freshVersion = exists
      ? await readInstalledPackageVersion(args.pipelineId, pipelineDir)
      : null;

    // --replace is the explicit escape hatch for intentional reinstalls and
    // downgrades. In particular, it must not turn a same-version request into
    // an idempotent no-op.
    if (args.replace === true) {
      return;
    }

    const selectedMatchesFresh =
      exists &&
      freshVersion &&
      args.selectedVersion !== "unknown" &&
      (freshVersion === args.selectedVersion ||
        comparePipelineVersions(freshVersion, args.selectedVersion) === 0);
    if (selectedMatchesFresh) {
      throw new LockedPipelineInstallNoop(freshVersion);
    }

    const stateChanged =
      exists !== args.initialExists ||
      (exists && freshVersion !== args.initialVersion);
    if (!stateChanged) {
      return;
    }

    // Another installer removed the package while this request downloaded its
    // payload. Installing into the now-free slot cannot overwrite newer work.
    if (!exists) {
      return;
    }

    if (args.replace === false) {
      throw new PipelineInstallError(
        "Pipeline is already installed",
        409,
        "Another installation completed while this package was being prepared."
      );
    }

    const comparison =
      freshVersion && args.selectedVersion !== "unknown"
        ? comparePipelineVersions(args.selectedVersion, freshVersion)
        : null;
    if (comparison !== null && comparison > 0) {
      // The prepared package is still newer than the package that won the
      // intervening race, so applying it preserves monotonic version order.
      return;
    }

    throw new PipelineInstallError(
      "Pipeline changed while this installation was being prepared",
      409,
      freshVersion && args.selectedVersion !== "unknown"
        ? `Installed version ${freshVersion} is not older than selected version ${args.selectedVersion}. Retry with --replace only if this downgrade is intentional.`
        : "The installed package changed concurrently and the versions cannot be ordered safely. Retry the command against the current state."
    );
  };
}

async function resolveStoreSource(
  input: InstallManagedPipelineInput
): Promise<{
  storePipeline: StorePipelineResponse | null;
  source: Partial<PipelineSourceDescriptor>;
  version?: string;
}> {
  if (input.source) {
    return {
      storePipeline: null,
      source: input.source,
      version: trimToUndefined(input.version),
    };
  }

  const store = await loadPipelineStoreCatalog(input.store);
  const selected = findUniqueStorePipeline(store, input.pipelineId, {
    sourceId: trimToUndefined(input.sourceId),
    version: trimToUndefined(input.version),
  });
  if (!selected) {
    const duplicate = store.duplicatePipelineIds.find(
      (entry) => entry.pipelineId === input.pipelineId
    );
    if (duplicate) {
      throw new PipelineInstallError(
        `Pipeline "${input.pipelineId}" is provided by multiple registries.`,
        409,
        `Select one source with --source (${duplicate.sources
          .map((source) => source.sourceId)
          .join(", ")}) and, if needed, --version.`
      );
    }
    if (store.successfulRegistryCount === 0) {
      throw new PipelineInstallError(
        "No pipeline registry could be loaded.",
        502,
        store.registryErrors.map((entry) => entry.error).join("; ")
      );
    }
    throw new PipelineInstallError(
      `Pipeline "${input.pipelineId}" was not found for the requested source/version.`,
      404
    );
  }
  return {
    storePipeline: selected,
    source: selected.source,
    version: selected.version,
  };
}

async function rollbackNewPipeline(pipelineId: string): Promise<void> {
  const packageDir = resolvePipelinePackageDir(
    getPipelinesDir(),
    pipelineId
  );
  await fs.rm(packageDir, { recursive: true, force: true });
  clearPackageCache();
  clearRegistryCache();
}

async function recordNewPipelineAsDisabled(
  pipelineId: string
): Promise<void> {
  try {
    await db.pipelineConfig.upsert({
      where: { pipelineId },
      create: {
        pipelineId,
        enabled: false,
      },
      update: {
        enabled: false,
      },
    });
  } catch (error) {
    try {
      await rollbackNewPipeline(pipelineId);
    } catch (cleanupError) {
      console.error(
        `[Pipeline Install] Could not roll back ${pipelineId} after its disabled state failed to persist:`,
        cleanupError
      );
    }
    console.error(
      `[Pipeline Install] Could not persist the initial disabled state for ${pipelineId}:`,
      error
    );
    throw new PipelineInstallError(
      "The pipeline package was rolled back because its initial disabled state could not be saved.",
      500
    );
  }
}

function buildFallbackInstallResult(args: {
  pipelineId: string;
  version: string;
  source: string;
  sourceId: string;
  action: "install" | "update" | "noop";
  warning: string;
}): InstallManagedPipelineResult {
  return {
    success: true,
    message: `Pipeline ${args.pipelineId} ${
      args.action === "noop"
        ? "is already installed"
        : args.action === "update"
          ? "updated"
          : "installed"
    }; setup still needs to be checked`,
    pipelineId: args.pipelineId,
    version: args.version,
    source: args.source,
    sourceId: args.sourceId,
    action: args.action,
    packageState: "installed",
    setupState: "needs-attention",
    activationState: "disabled",
    setupRequired: true,
    autoEnabled: false,
    enabled: false,
    readiness: null,
    nextActions: [],
    status: null,
    warnings: [args.warning],
  };
}

export async function installManagedPipeline(
  input: InstallManagedPipelineInput
): Promise<InstallManagedPipelineResult> {
  const pipelineId = trimToUndefined(input.pipelineId);
  if (!pipelineId) {
    throw new PipelineInstallError("Pipeline ID required", 400);
  }
  if (!isValidPipelineId(pipelineId)) {
    throw new PipelineInstallError(
      "Invalid pipeline ID. Use letters, numbers, dots, underscores, or hyphens, starting with a letter or number.",
      400
    );
  }

  const packageDir = resolvePipelinePackageDir(
    getPipelinesDir(),
    pipelineId
  );
  const alreadyInstalled = await pathExists(packageDir);
  const installedVersion = alreadyInstalled
    ? await readInstalledPackageVersion(pipelineId)
    : null;
  let resolved: Awaited<ReturnType<typeof resolveStoreSource>>;
  try {
    resolved = await resolveStoreSource({
      ...input,
      pipelineId,
    });
  } catch (error) {
    const canUseLocalPackage =
      alreadyInstalled &&
      installedVersion &&
      !input.source &&
      !trimToUndefined(input.sourceId) &&
      !trimToUndefined(input.version) &&
      error instanceof PipelineInstallError &&
      (error.status === 404 || error.status === 502);
    if (!canUseLocalPackage) throw error;
    resolved = {
      storePipeline: null,
      source: {
        kind: "registry",
        sourceId: `bundled:${pipelineId}`,
        label: "Bundled with SeqDesk",
      },
      version: installedVersion,
    };
  }
  const source = resolved.source;
  const selectedVersion =
    trimToUndefined(resolved.version) ||
    trimToUndefined(input.version) ||
    "unknown";
  const sourceId =
    trimToUndefined(input.sourceId) ||
    trimToUndefined(source.sourceId) ||
    `${source.kind || "registry"}:${pipelineId}`;
  const credentials = {
    accessKey: trimToUndefined(input.credentials?.accessKey),
    token: trimToUndefined(input.credentials?.token),
    sha256:
      trimToUndefined(input.credentials?.sha256) ||
      trimToUndefined(source.sha256),
  };
  let replaceExisting = input.replace === true;
  let action: "install" | "update" | "noop";
  let resolvedVersion = selectedVersion;
  let resolvedSource = sourceId;

  if (alreadyInstalled) {
    if (input.replace === true) {
      replaceExisting = true;
      action = "update";
    } else if (
      installedVersion &&
      selectedVersion !== "unknown" &&
      (installedVersion === selectedVersion ||
        comparePipelineVersions(installedVersion, selectedVersion) === 0)
    ) {
      action = "noop";
      resolvedVersion = installedVersion;
    } else if (input.replace === false) {
      throw new PipelineInstallError(
        "Pipeline is already installed",
        409,
        "Retry this action as an update to replace the installed package."
      );
    } else {
      const comparison =
        installedVersion && selectedVersion !== "unknown"
          ? comparePipelineVersions(selectedVersion, installedVersion)
          : null;
      if (comparison !== null && comparison > 0) {
        replaceExisting = true;
        action = "update";
      } else if (
        input.version &&
        installedVersion &&
        selectedVersion !== installedVersion
      ) {
        // An explicit version is also an explicit update/downgrade selection.
        replaceExisting = true;
        action = "update";
      } else {
        throw new PipelineInstallError(
          "Pipeline is already installed",
          409,
          installedVersion && selectedVersion !== "unknown"
            ? `Installed version ${installedVersion} is not older than selected version ${selectedVersion}.`
            : "Use --replace or select a newer Store version."
        );
      }
    }
  } else {
    action = "install";
  }

  try {
    if (action !== "noop") {
      const beforeLockedInstall = buildLockedInstallGuard({
        pipelineId,
        initialExists: alreadyInstalled,
        initialVersion: installedVersion,
        selectedVersion,
        replace: input.replace,
      });
      try {
        if (source.kind === "github") {
          const result = await installFromGitHub(
            pipelineId,
            source,
            credentials,
            replaceExisting,
            beforeLockedInstall,
            sourceId
          );
          action = result.action;
          resolvedVersion = result.version || resolvedVersion;
          resolvedSource = result.source;
        } else if (source.kind === "privateRegistry") {
          const packageUrl =
            trimToUndefined(source.packageUrlDefault) ||
            trimToUndefined(source.downloadUrl) ||
            trimToUndefined(input.privatePackageUrl);
          if (!packageUrl || !credentials.accessKey) {
            throw new PipelineInstallError(
              "Private package installs require package URL and access key.",
              400
            );
          }
          action = await installFromPackagePayload(
            pipelineId,
            await fetchPackagePayload(
              packageUrl,
              credentials.accessKey,
              credentials.sha256
            ),
            replaceExisting,
            beforeLockedInstall,
            {
              version: resolvedVersion,
              sourceId,
              sourceKind: "privateRegistry",
            }
          );
          resolvedSource = assertSafePackageUrl(packageUrl);
        } else {
          const downloadUrl =
            trimToUndefined(source.downloadUrl) ||
            trimToUndefined(input.privatePackageUrl);
          if (!downloadUrl) {
            throw new PipelineInstallError(
              "Registry installs require a download URL.",
              400
            );
          }
          action = await installFromPackagePayload(
            pipelineId,
            await fetchPackagePayload(
              downloadUrl,
              undefined,
              credentials.sha256
            ),
            replaceExisting,
            beforeLockedInstall,
            {
              version: resolvedVersion,
              sourceId,
              sourceKind: "registry",
            }
          );
          resolvedSource = assertSafePackageUrl(downloadUrl);
        }
      } catch (error) {
        if (!(error instanceof LockedPipelineInstallNoop)) {
          throw error;
        }
        action = "noop";
        resolvedVersion = error.installedVersion;
      }

      if (action === "install") {
        await recordNewPipelineAsDisabled(pipelineId);
      }
      clearPackageCache();
      clearRegistryCache();
    }

    let status: ManagedPipelineCatalogEntry | null;
    const warnings: string[] = [];
    try {
      status = await getManagedPipelineStatus(pipelineId, {
        includeAvailable: false,
      });
    } catch (error) {
      return buildFallbackInstallResult({
        pipelineId,
        version: resolvedVersion,
        source: resolvedSource,
        sourceId,
        action,
        warning: `Readiness assessment failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      });
    }

    if (!status) {
      return buildFallbackInstallResult({
        pipelineId,
        version: resolvedVersion,
        source: resolvedSource,
        sourceId,
        action,
        warning:
          "The installed package could not be loaded for its readiness assessment.",
      });
    }

    let autoEnabled = false;
    if (status.readiness?.canEnable && input.autoEnable !== false) {
      try {
        await updateManagedPipeline({
          pipelineId,
          enabled: true,
        });
        autoEnabled = true;
        status =
          (await getManagedPipelineStatus(pipelineId, {
            includeAvailable: false,
          })) || status;
      } catch (error) {
        warnings.push(
          `Automatic activation was skipped: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    } else if (
      status.enabled &&
      status.readiness &&
      !status.readiness.canEnable
    ) {
      // A newly installed package is already disabled. This branch protects an
      // enabled update whose new requirements are no longer ready.
      await updateManagedPipeline({
        pipelineId,
        enabled: false,
      });
      status =
        (await getManagedPipelineStatus(pipelineId, {
          includeAvailable: false,
        })) || status;
    }

    const setupRequired = status.readiness
      ? !status.readiness.canEnable
      : true;
    return {
      success: true,
      message: `Pipeline ${pipelineId} ${
        action === "noop"
          ? "is already installed"
          : action === "update"
            ? "updated"
            : "installed"
      } successfully${
        setupRequired ? "; setup is still required" : ""
      }`,
      pipelineId,
      version: resolvedVersion,
      source: resolvedSource,
      sourceId,
      action,
      packageState: status.packageState,
      setupState: status.setupState,
      activationState: status.activationState,
      setupRequired,
      autoEnabled,
      enabled: status.enabled,
      readiness: status.readiness,
      nextActions: status.nextActions,
      status,
      warnings,
    };
  } catch (error) {
    clearPackageCache();
    clearRegistryCache();
    if (error instanceof PipelineInstallError) throw error;
    if (error instanceof PackageAlreadyInstalledError) {
      throw new PipelineInstallError(error.message, 409);
    }
    if (error instanceof PipelineDescriptorValidationError) {
      throw new PipelineInstallError(error.message, 422);
    }
    const details =
      error instanceof Error ? error.message : "Unknown error";
    throw new PipelineInstallError(
      "Failed to install pipeline",
      details.startsWith("Invalid pipeline package") ? 422 : 500,
      details
    );
  }
}
