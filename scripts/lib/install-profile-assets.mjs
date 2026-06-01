import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawn, spawnSync } from "child_process";
import { gzipSync } from "zlib";

const SITE_SETTINGS_ID = "singleton";
const DB_DOWNLOAD_INDEX_FILE = ".pipeline-database-downloads.json";
const DB_DOWNLOAD_STATUS_FILE = ".pipeline-database-download-status.json";
const DB_DOWNLOAD_LOG_DIR = ".pipeline-database-download-logs";
const FIXTURE_DOWNLOAD_LOG_DIR = ".profile-fixture-download-logs";
const DEFAULT_PIPELINE_RUN_DIR = "/data/pipeline_runs";

export function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

export function toRecord(value) {
  return isRecord(value) ? value : {};
}

export function toOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function toOptionalBoolean(value) {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "n", "off"].includes(normalized)) return false;
  return undefined;
}

function parseJsonObject(raw) {
  if (!raw) return {};
  try {
    const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function normalizeProfileId(profile) {
  return (toOptionalString(profile.id) || "profile").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function normalizeFixtureId(fixture) {
  return (toOptionalString(fixture.id) || "fixture").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function uppercaseToken(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toUpperCase();
}

function toOptionalNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function toOptionalNonNegativeInt(value) {
  const parsed = toOptionalNumber(value);
  if (parsed === undefined) return undefined;
  return Math.max(0, Math.trunc(parsed));
}

function toJsonObject(value) {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || !value.trim()) return {};
  return parseJsonObject(value);
}

export function buildProfilePipelineDatabaseRoot(pipelineRunDir, databaseDirectory) {
  const configuredDirectory = toOptionalString(databaseDirectory);
  if (configuredDirectory) return path.resolve(configuredDirectory);
  return path.join(path.resolve(toOptionalString(pipelineRunDir) || DEFAULT_PIPELINE_RUN_DIR), "databases");
}

export function buildProfilePipelineDatabaseTargetPath({
  pipelineRunDir,
  databaseDirectory,
  pipelineId,
  databaseId,
  fileName,
}) {
  return path.join(
    buildProfilePipelineDatabaseRoot(pipelineRunDir, databaseDirectory),
    pipelineId,
    databaseId,
    fileName
  );
}

export function buildProfilePipelineDatabaseInstallDir({
  pipelineRunDir,
  databaseDirectory,
  pipelineId,
  databaseId,
}) {
  return path.join(
    buildProfilePipelineDatabaseRoot(pipelineRunDir, databaseDirectory),
    pipelineId,
    databaseId,
    "installed"
  );
}

function buildProfileDatabaseRequest({
  pipelineId,
  databaseId,
  required = true,
  mode,
  configKey,
  databasePath,
  sourceUrlOverride,
  sha256,
}) {
  return {
    pipelineId,
    databaseId,
    required,
    mode: mode === "skip" || mode === "overwrite" ? mode : "ensure",
    ...(configKey ? { configKey } : {}),
    ...(databasePath ? { path: databasePath } : {}),
    ...(sourceUrlOverride ? { sourceUrlOverride } : {}),
    ...(sha256 ? { sha256 } : {}),
  };
}

export function loadPipelineDatabaseDefinitions(rootDir = process.cwd()) {
  const definitionPath = path.join(rootDir, "data", "pipeline-databases.json");
  const parsed = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

export function resolveProfileDatabaseRequests(profile, definitions = {}) {
  const pipelines = toRecord(profile.pipelines);
  const databasesValue = pipelines.databases;
  const databases = toRecord(databasesValue);
  const rawDownloads = Array.isArray(databasesValue)
    ? databasesValue
    : Array.isArray(databases.downloads)
      ? databases.downloads
      : [];
  const autoDownload =
    Array.isArray(databasesValue) && rawDownloads.length > 0
      ? true
      : toOptionalBoolean(databases.autoDownload) === true;
  if (!autoDownload) {
    return { autoDownload: false, requests: [] };
  }

  const requests = [];

  if (rawDownloads.length > 0) {
    for (const item of rawDownloads) {
      if (!isRecord(item)) continue;
      const pipelineId = toOptionalString(item.pipelineId);
      const databaseId = toOptionalString(item.databaseId);
      if (!pipelineId || !databaseId) continue;
      const mode = toOptionalString(item.mode)?.toLowerCase();
      requests.push(buildProfileDatabaseRequest({
        pipelineId,
        databaseId,
        required: toOptionalBoolean(item.required) !== false,
        mode,
        configKey: toOptionalString(item.configKey),
        databasePath: toOptionalString(item.path),
        sourceUrlOverride: toOptionalString(item.sourceUrlOverride),
        sha256: toOptionalString(item.sha256),
      }));
    }
  } else if (Array.isArray(pipelines.enable)) {
    for (const pipelineId of pipelines.enable) {
      const normalizedPipelineId = toOptionalString(pipelineId);
      if (!normalizedPipelineId) continue;
      const databaseDefinitions = Array.isArray(definitions[normalizedPipelineId])
        ? definitions[normalizedPipelineId]
        : [];
      for (const database of databaseDefinitions) {
        if (database?.id) {
          requests.push(buildProfileDatabaseRequest({
            pipelineId: normalizedPipelineId,
            databaseId: database.id,
            required: true,
          }));
        }
      }
    }
  }

  const seen = new Set();
  return {
    autoDownload,
    requests: requests.filter((request) => {
      const key = `${request.pipelineId}:${request.databaseId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }),
  };
}

async function readSiteExecution(prisma) {
  const settings = await prisma.siteSettings.findUnique({
    where: { id: SITE_SETTINGS_ID },
    select: { extraSettings: true, dataBasePath: true },
  });
  const extra = parseJsonObject(settings?.extraSettings);
  return {
    settings,
    extra,
    execution: toRecord(extra.pipelineExecution),
  };
}

export async function resolveProfilePipelineAssetSettings(prisma, profile) {
  const { settings, execution } = await readSiteExecution(prisma);
  const pipelines = toRecord(profile.pipelines);
  const executionProfile = toRecord(pipelines.execution);
  const site = toRecord(profile.site);

  return {
    pipelineRunDir:
      toOptionalString(executionProfile.runDirectory) ||
      toOptionalString(executionProfile.pipelineRunDir) ||
      toOptionalString(execution.pipelineRunDir) ||
      DEFAULT_PIPELINE_RUN_DIR,
    databaseDirectory:
      toOptionalString(pipelines.databaseDirectory) ||
      toOptionalString(execution.pipelineDatabaseDir),
    dataBasePath:
      toOptionalString(settings?.dataBasePath) ||
      toOptionalString(site.dataBasePath),
  };
}

function getPipelinesDir(rootDir) {
  return path.join(rootDir, "pipelines");
}

async function readJsonIndex(filePath) {
  try {
    const parsed = JSON.parse(await fsp.readFile(filePath, "utf8"));
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

async function writeJsonIndex(filePath, value) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  await fsp.writeFile(filePath, JSON.stringify(value, null, 2));
}

function getDatabaseRecordKey(pipelineId, databaseId) {
  return `${pipelineId}:${databaseId}`;
}

async function writeDatabaseDownloadRecord(rootDir, pipelineId, databaseId, record) {
  const indexPath = path.join(getPipelinesDir(rootDir), DB_DOWNLOAD_INDEX_FILE);
  const index = await readJsonIndex(indexPath);
  index[getDatabaseRecordKey(pipelineId, databaseId)] = {
    ...(index[getDatabaseRecordKey(pipelineId, databaseId)] || {}),
    ...record,
    pipelineId,
    databaseId,
    updatedAt: record.updatedAt || new Date().toISOString(),
  };
  await writeJsonIndex(indexPath, index);
}

async function writeDatabaseDownloadStatus(rootDir, pipelineId, databaseId, status) {
  const indexPath = path.join(getPipelinesDir(rootDir), DB_DOWNLOAD_STATUS_FILE);
  const index = await readJsonIndex(indexPath);
  index[getDatabaseRecordKey(pipelineId, databaseId)] = {
    ...(index[getDatabaseRecordKey(pipelineId, databaseId)] || {}),
    ...status,
    pipelineId,
    databaseId,
  };
  await writeJsonIndex(indexPath, index);
}

async function createDatabaseDownloadLogPath(rootDir, pipelineId, databaseId) {
  const logDir = path.join(getPipelinesDir(rootDir), DB_DOWNLOAD_LOG_DIR);
  await fsp.mkdir(logDir, { recursive: true });
  return path.join(logDir, `${pipelineId}-${databaseId}-${Date.now()}.log`);
}

function appendLog(logPath, message) {
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] ${message}\n`);
}

function commandExists(command) {
  const result = spawnSync("sh", ["-c", `command -v ${command}`], {
    stdio: "ignore",
  });
  return result.status === 0;
}

function resolveDownloader() {
  if (commandExists("curl")) {
    return {
      command: "curl",
      args: (sourceUrl, targetPath) => [
        "-L",
        "-C",
        "-",
        "--fail",
        "--retry",
        "8",
        "--retry-delay",
        "5",
        "--connect-timeout",
        "30",
        "--speed-time",
        "60",
        "--speed-limit",
        "1024",
        "--output",
        targetPath,
        sourceUrl,
      ],
    };
  }

  if (commandExists("wget")) {
    return {
      command: "wget",
      args: (sourceUrl, targetPath) => [
        "-c",
        "--tries=8",
        "--waitretry=5",
        "--timeout=30",
        "-O",
        targetPath,
        sourceUrl,
      ],
    };
  }

  throw new Error("Neither curl nor wget is available on this server");
}

async function getRemoteContentLength(sourceUrl) {
  try {
    const response = await fetch(sourceUrl, { method: "HEAD" });
    if (!response.ok) return undefined;
    const header = response.headers.get("content-length");
    const parsed = header ? Number.parseInt(header, 10) : Number.NaN;
    return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

async function getFileSize(targetPath) {
  try {
    return (await fsp.stat(targetPath)).size;
  } catch {
    return 0;
  }
}

async function calculateSha256(filePath) {
  const hash = crypto.createHash("sha256");
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

function normalizeExpectedSha256(value) {
  const expected = toOptionalString(value);
  if (!expected) return undefined;
  return expected.replace(/^sha256:/i, "").trim().toLowerCase();
}

function isLocalhost(hostname) {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function parseAllowedRoots() {
  return normalizeStringList(process.env.SEQDESK_PROFILE_ASSET_ALLOWED_ROOTS);
}

function normalizeStringList(value) {
  if (typeof value !== "string" || !value.trim()) return [];
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function assertSafeSourceUrl(sourceUrl, label, { requireRemoteSha256 = false, sha256 } = {}) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error(`${label} must be a valid URL`);
  }

  const isLocalHttp = parsed.protocol === "http:" && isLocalhost(parsed.hostname);
  if (parsed.protocol !== "https:" && parsed.protocol !== "file:" && !isLocalHttp) {
    throw new Error(`${label} must use https, file, or localhost http`);
  }
  if (parsed.protocol === "http:" && !isLocalHttp) {
    throw new Error(`${label} must use HTTPS for remote downloads`);
  }
  if (requireRemoteSha256 && !normalizeExpectedSha256(sha256)) {
    throw new Error(`${label} requires sha256 when overriding a download URL`);
  }
}

function assertAllowedExistingAssetPath(targetPath, roots, label) {
  if (!path.isAbsolute(targetPath)) {
    throw new Error(`${label} must be an absolute path`);
  }
  const resolvedPath = path.resolve(targetPath);
  const resolvedRoots = roots
    .map((root) => toOptionalString(root))
    .filter(Boolean)
    .map((root) => path.resolve(root));
  if (resolvedRoots.length === 0) {
    throw new Error(`${label} cannot be validated because no allowed asset roots are configured`);
  }
  const allowed = resolvedRoots.some(
    (root) => resolvedPath === root || resolvedPath.startsWith(`${root}${path.sep}`)
  );
  if (!allowed) {
    throw new Error(
      `${label} must be under an allowed asset root: ${resolvedRoots.join(", ")}`
    );
  }
}

function runLoggedCommand(logPath, command, args, options = {}) {
  appendLog(logPath, `Command: ${command} ${args.join(" ")}`);
  const fd = fs.openSync(logPath, "a");
  try {
    const result = spawnSync(command, args, {
      ...options,
      stdio: ["ignore", fd, fd],
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      throw new Error(`${command} exited with code ${result.status ?? "unknown"}`);
    }
  } finally {
    fs.closeSync(fd);
  }
}

async function runLoggedCommandAsync(logPath, command, args, options = {}, onProgress) {
  appendLog(logPath, `Command: ${command} ${args.join(" ")}`);
  await new Promise((resolve, reject) => {
    const fd = fs.openSync(logPath, "a");
    let settled = false;
    let progressTimer = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (progressTimer) clearInterval(progressTimer);
      if (onProgress) {
        Promise.resolve(onProgress()).catch(() => {
          // Best-effort final progress update only.
        });
      }
      fs.closeSync(fd);
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };
    const child = spawn(command, args, {
      ...options,
      stdio: ["ignore", fd, fd],
    });
    progressTimer = onProgress
      ? setInterval(() => {
          Promise.resolve(onProgress()).catch(() => {
            // Best-effort progress reporting only.
          });
        }, 3000)
      : null;

    child.on("error", (error) => {
      finish(error);
    });
    child.on("close", (code, signal) => {
      if (signal) {
        finish(new Error(`${command} exited with signal ${signal}`));
        return;
      }
      if (code !== 0) {
        finish(new Error(`${command} exited with code ${code ?? "unknown"}`));
        return;
      }
      finish();
    });
  });
}

async function downloadDatabaseArchive({ database, targetPath, logPath }) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const totalBytes = await getRemoteContentLength(database.downloadUrl);
  const localBytes = await getFileSize(targetPath);

  if (localBytes > 0 && typeof totalBytes === "number" && localBytes >= totalBytes) {
    appendLog(logPath, `Archive already present: ${targetPath}`);
    return { bytesDownloaded: localBytes, totalBytes };
  }

  const downloader = resolveDownloader();
  runLoggedCommand(logPath, downloader.command, downloader.args(database.downloadUrl, targetPath));
  return {
    bytesDownloaded: await getFileSize(targetPath),
    totalBytes,
  };
}

async function removeFileIfExists(filePath) {
  try {
    await fsp.rm(filePath, { force: true });
  } catch {
    // Best effort. A failed cleanup should not hide the underlying install result.
  }
}

async function verifyExistingDatabasePath(targetPath, label) {
  const sizeBytes = await getFileSize(targetPath);
  if (sizeBytes <= 0) {
    throw new Error(`${label} does not exist or is empty: ${targetPath}`);
  }
  return {
    runtimePath: targetPath,
    sizeBytes,
  };
}

async function verifyOptionalSha256(filePath, expectedSha256, label) {
  const expected = normalizeExpectedSha256(expectedSha256);
  if (!expected) return;
  const stats = await fsp.stat(filePath);
  if (!stats.isFile()) {
    throw new Error(`${label} SHA256 verification requires a file path: ${filePath}`);
  }
  const actual = await calculateSha256(filePath);
  if (actual !== expected) {
    throw new Error(`${label} SHA256 mismatch: expected ${expected}, got ${actual}`);
  }
}

async function downloadFileArchive({ sourceUrl, targetPath, logPath, activity }) {
  assertSafeSourceUrl(sourceUrl, "Fixture source.url");
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const totalBytes = await getRemoteContentLength(sourceUrl);
  const localBytes = await getFileSize(targetPath);

  if (localBytes > 0 && typeof totalBytes === "number" && localBytes >= totalBytes) {
    appendLog(logPath, `Archive already present: ${targetPath}`);
    await activity?.update?.({
      phase: "downloading",
      targetPath,
      bytesDownloaded: localBytes,
      totalBytes,
      progressPercent: 100,
      logPath,
    });
    return { bytesDownloaded: localBytes, totalBytes };
  }

  const downloader = resolveDownloader();
  await activity?.update?.({
    phase: "downloading",
    targetPath,
    bytesDownloaded: localBytes,
    totalBytes,
    logPath,
  });
  await runLoggedCommandAsync(
    logPath,
    downloader.command,
    downloader.args(sourceUrl, targetPath),
    {},
    async () => {
      const bytesDownloaded = await getFileSize(targetPath);
      await activity?.update?.({
        phase: "downloading",
        targetPath,
        bytesDownloaded,
        totalBytes,
        logPath,
        progressPercent:
          typeof totalBytes === "number" && totalBytes > 0
            ? Math.max(0, Math.min(100, Math.round((bytesDownloaded / totalBytes) * 1000) / 10))
            : undefined,
      });
    }
  );
  return {
    bytesDownloaded: await getFileSize(targetPath),
    totalBytes,
  };
}

function listTarGzipEntries(archivePath) {
  const result = spawnSync("tar", ["-tzf", archivePath], {
    encoding: "utf8",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `tar -tzf failed for ${archivePath}: ${result.stderr || `exit ${result.status}`}`
    );
  }
  return result.stdout
    .split(/\r?\n/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function assertSafeTarEntries(entries) {
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, "/");
    const parts = normalized.split("/").filter(Boolean);
    if (
      normalized.startsWith("/") ||
      normalized.startsWith("../") ||
      normalized.includes("/../") ||
      parts.includes("..") ||
      /^[A-Za-z]:/.test(normalized)
    ) {
      throw new Error(`Unsafe archive entry: ${entry}`);
    }
  }
}

function normalizeFixtureRelativePath(value, label) {
  const raw = toOptionalString(value);
  if (!raw) {
    throw new Error(`${label} is required`);
  }
  const normalized = raw.replace(/\\/g, "/").replace(/^\.\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (
    normalized.startsWith("/") ||
    normalized.startsWith("../") ||
    normalized.includes("/../") ||
    parts.includes("..") ||
    /^[A-Za-z]:/.test(normalized)
  ) {
    throw new Error(`${label} must be a safe relative path`);
  }
  return parts.join("/");
}

async function extractVerifiedFastqBundle({
  source,
  profileId,
  fixtureId,
  dataBasePath,
  rootDir,
  logger = console,
  activity,
}) {
  const sourceUrl = toOptionalString(source.url);
  if (!sourceUrl) {
    throw new Error(`Fixture ${fixtureId} source.url is required`);
  }

  const expectedSha256 = normalizeExpectedSha256(source.sha256);
  if (!expectedSha256) {
    throw new Error(`Fixture ${fixtureId} source.sha256 is required`);
  }
  assertSafeSourceUrl(sourceUrl, `Fixture ${fixtureId} source.url`);

  const archivePath = path.join(
    dataBasePath,
    "fixtures",
    profileId,
    ".downloads",
    `${fixtureId}.tar.gz`
  );
  const logDir = path.join(rootDir, "pipelines", FIXTURE_DOWNLOAD_LOG_DIR);
  await fsp.mkdir(logDir, { recursive: true });
  const logPath = path.join(logDir, `${profileId}-${fixtureId}-${Date.now()}.log`);

  logger.log?.(`Downloading FASTQ fixture bundle ${fixtureId}`);
  const existingBytes = await getFileSize(archivePath);
  let download;
  if (existingBytes > 0 && (await calculateSha256(archivePath)) === expectedSha256) {
    appendLog(logPath, `Archive already present with expected SHA256: ${archivePath}`);
    download = { bytesDownloaded: existingBytes, totalBytes: existingBytes };
  } else {
    download = await downloadFileArchive({ sourceUrl, targetPath: archivePath, logPath, activity });
  }
  await activity?.update?.({
    phase: "verifying",
    targetPath: archivePath,
    bytesDownloaded: await getFileSize(archivePath),
    totalBytes: download.totalBytes,
    progressPercent: download.totalBytes ? 100 : undefined,
    logPath,
  });
  const actualSha256 = await calculateSha256(archivePath);
  if (actualSha256 !== expectedSha256) {
    throw new Error(
      `Fixture ${fixtureId} SHA256 mismatch: expected ${expectedSha256}, got ${actualSha256}`
    );
  }

  const entries = listTarGzipEntries(archivePath);
  assertSafeTarEntries(entries);

  const extractDir = path.join(dataBasePath, "fixtures", profileId, fixtureId);
  await fsp.mkdir(extractDir, { recursive: true });
  await activity?.update?.({
    phase: "extracting",
    targetPath: extractDir,
    logPath,
  });
  runLoggedCommand(logPath, "tar", ["-xzf", archivePath, "-C", extractDir]);

  return {
    archivePath,
    extractDir,
    logPath,
    sourceUrl,
    sha256: actualSha256,
    bytesDownloaded: download.bytesDownloaded,
    totalBytes: download.totalBytes,
  };
}

async function installDatabaseIfNeeded({
  rootDir,
  pipelineRunDir,
  databaseDirectory,
  pipelineId,
  databaseId,
  database,
  archivePath,
  logPath,
}) {
  if (database.install?.type !== "metaxpath_db_bundle") {
    return {
      runtimePath: archivePath,
      sizeBytes: await getFileSize(archivePath),
    };
  }

  const installerPath = path.join(
    rootDir,
    "pipelines",
    "metaxpath",
    "workflow",
    "scripts",
    "install_db_bundle.sh"
  );
  try {
    await fsp.access(installerPath);
  } catch {
    throw new Error(
      `MetaxPath DB installer not found at ${installerPath}. Install or update the private MetaxPath pipeline package first.`
    );
  }

  const installDir = buildProfilePipelineDatabaseInstallDir({
    pipelineRunDir,
    databaseDirectory,
    pipelineId,
    databaseId,
  });
  await fsp.mkdir(installDir, { recursive: true });

  runLoggedCommand(logPath, "bash", [
    installerPath,
    "--archive",
    archivePath,
    "--skip-download",
    "--dest",
    installDir,
    "--force",
  ]);

  const paramsPath = path.join(installDir, database.install.paramsFileName);
  const sizeBytes = await getFileSize(paramsPath);
  if (sizeBytes <= 0) {
    throw new Error(`Database installer did not create ${database.install.paramsFileName}`);
  }

  return {
    runtimePath: paramsPath,
    sizeBytes,
  };
}

async function setPipelineDatabaseConfig(prisma, pipelineId, configKey, targetPath) {
  const existing = await prisma.pipelineConfig.findUnique({
    where: { pipelineId },
    select: { enabled: true, config: true },
  });
  const config = {
    ...parseJsonObject(existing?.config),
    [configKey]: targetPath,
  };

  await prisma.pipelineConfig.upsert({
    where: { pipelineId },
    create: {
      pipelineId,
      enabled: existing?.enabled ?? true,
      config: JSON.stringify(config),
    },
    update: {
      config: JSON.stringify(config),
    },
  });
}

export async function applyProfilePipelineDatabases({
  prisma,
  profile,
  rootDir = process.cwd(),
  logger = console,
}) {
  const definitions = loadPipelineDatabaseDefinitions(rootDir);
  const { autoDownload, requests } = resolveProfileDatabaseRequests(profile, definitions);
  if (!autoDownload) {
    return { skipped: true, downloaded: 0, failed: 0 };
  }

  const settings = await resolveProfilePipelineAssetSettings(prisma, profile);
  const allowedExistingRoots = [
    settings.databaseDirectory,
    settings.pipelineRunDir,
    settings.dataBasePath,
    "/data",
    "/mnt",
    "/net",
    "/opt",
    "/scratch",
    ...parseAllowedRoots(),
  ].filter(Boolean);
  let downloaded = 0;
  let failed = 0;
  const results = [];

  for (const request of requests) {
    const database = (definitions[request.pipelineId] || []).find(
      (entry) => entry.id === request.databaseId
    );
    if (!database) {
      const message = `Database ${request.databaseId} is not defined for pipeline ${request.pipelineId}`;
      results.push({
        pipelineId: request.pipelineId,
        databaseId: request.databaseId,
        mode: request.mode || "ensure",
        status: "error",
        error: message,
      });
      if (request.required) throw new Error(message);
      logger.warn?.(message);
      continue;
    }

    const resolvedDatabase = {
      ...database,
      downloadUrl: request.sourceUrlOverride || database.downloadUrl,
    };
    if (request.sourceUrlOverride) {
      assertSafeSourceUrl(request.sourceUrlOverride, `${request.pipelineId}/${request.databaseId} sourceUrlOverride`, {
        requireRemoteSha256: true,
        sha256: request.sha256,
      });
    } else {
      assertSafeSourceUrl(resolvedDatabase.downloadUrl, `${request.pipelineId}/${request.databaseId} downloadUrl`);
    }
    const configKey = request.configKey || database.configKey;
    if (!configKey) {
      const message = `Database ${request.databaseId} for pipeline ${request.pipelineId} does not define a config key`;
      results.push({
        pipelineId: request.pipelineId,
        databaseId: request.databaseId,
        mode: request.mode || "ensure",
        status: "error",
        error: message,
      });
      if (request.required) throw new Error(message);
      logger.warn?.(message);
      continue;
    }

    const targetPath = buildProfilePipelineDatabaseTargetPath({
      pipelineRunDir: settings.pipelineRunDir,
      databaseDirectory: settings.databaseDirectory,
      pipelineId: request.pipelineId,
      databaseId: request.databaseId,
      fileName: resolvedDatabase.fileName,
    });
    const logPath = await createDatabaseDownloadLogPath(rootDir, request.pipelineId, request.databaseId);
    const startedAt = new Date().toISOString();
    const mode = request.mode || "ensure";
    const statusTargetPath = mode === "skip" && request.path ? request.path : targetPath;

    await writeDatabaseDownloadStatus(rootDir, request.pipelineId, request.databaseId, {
      state: "running",
      mode,
      sourceUrl: resolvedDatabase.downloadUrl,
      targetPath: statusTargetPath,
      startedAt,
      finishedAt: undefined,
      error: undefined,
      logPath,
    });

    try {
      let download = { bytesDownloaded: 0, totalBytes: undefined };
      let installed;
      if (mode === "skip") {
        if (!request.path) {
          throw new Error(
            `Database ${request.pipelineId}/${request.databaseId} uses mode=skip but no path was provided`
          );
        }
        assertAllowedExistingAssetPath(
          request.path,
          allowedExistingRoots,
          `Database ${request.pipelineId}/${request.databaseId} path`
        );
        appendLog(logPath, `Using existing database path without download: ${request.path}`);
        installed = await verifyExistingDatabasePath(request.path, `${request.pipelineId}/${request.databaseId}`);
        await verifyOptionalSha256(request.path, request.sha256, `${request.pipelineId}/${request.databaseId}`);
      } else {
        if (mode === "overwrite") {
          await removeFileIfExists(targetPath);
          appendLog(logPath, `Removed existing archive before overwrite download: ${targetPath}`);
        }
        logger.log?.(`Downloading database ${request.pipelineId}/${request.databaseId}`);
        download = await downloadDatabaseArchive({ database: resolvedDatabase, targetPath, logPath });
        await verifyOptionalSha256(targetPath, request.sha256, `${request.pipelineId}/${request.databaseId}`);
        installed = await installDatabaseIfNeeded({
          rootDir,
          pipelineRunDir: settings.pipelineRunDir,
          databaseDirectory: settings.databaseDirectory,
          pipelineId: request.pipelineId,
          databaseId: request.databaseId,
          database: resolvedDatabase,
          archivePath: targetPath,
          logPath,
        });
      }

      await setPipelineDatabaseConfig(
        prisma,
        request.pipelineId,
        configKey,
        installed.runtimePath
      );
      await writeDatabaseDownloadRecord(rootDir, request.pipelineId, request.databaseId, {
        version: resolvedDatabase.version,
        mode,
        path: installed.runtimePath,
        sourceUrl: resolvedDatabase.downloadUrl,
        sizeBytes: installed.sizeBytes,
      });
      await writeDatabaseDownloadStatus(rootDir, request.pipelineId, request.databaseId, {
        state: "success",
        mode,
        sourceUrl: resolvedDatabase.downloadUrl,
        targetPath: statusTargetPath,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
        progressPercent: 100,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: undefined,
        logPath,
      });
      results.push({
        pipelineId: request.pipelineId,
        databaseId: request.databaseId,
        mode,
        status: "success",
        path: installed.runtimePath,
        sourceUrl: resolvedDatabase.downloadUrl,
        sizeBytes: installed.sizeBytes,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
        logPath,
      });
      downloaded += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await writeDatabaseDownloadStatus(rootDir, request.pipelineId, request.databaseId, {
        state: "error",
        mode,
        sourceUrl: resolvedDatabase.downloadUrl,
        targetPath: statusTargetPath,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: message,
        logPath,
      });
      results.push({
        pipelineId: request.pipelineId,
        databaseId: request.databaseId,
        mode,
        status: "error",
        error: message,
        sourceUrl: resolvedDatabase.downloadUrl,
        targetPath: statusTargetPath,
        logPath,
      });
      if (request.required) throw error;
      logger.warn?.(`Optional database ${request.pipelineId}/${request.databaseId} failed: ${message}`);
    }
  }

  return { skipped: false, downloaded, failed, results };
}

function buildFastq(sampleId, index) {
  const sequenceA = "ACGT".repeat(30 + index);
  const sequenceB = "TGCA".repeat(28 + index);
  const qualityA = "I".repeat(sequenceA.length);
  const qualityB = "H".repeat(sequenceB.length);
  return [
    `@${sampleId}_read_1`,
    sequenceA,
    "+",
    qualityA,
    `@${sampleId}_read_2`,
    sequenceB,
    "+",
    qualityB,
    "",
  ].join("\n");
}

async function ensureUser(prisma, role, fallback) {
  const existing = await prisma.user.findFirst({
    where: { role },
    orderBy: { createdAt: "asc" },
  });
  if (existing) return existing;

  const { hashSync } = await import("bcryptjs");
  return prisma.user.create({
    data: {
      email: fallback.email,
      password: hashSync(crypto.randomBytes(18).toString("hex"), 10),
      firstName: fallback.firstName,
      lastName: fallback.lastName,
      role,
      ...(role === "FACILITY_ADMIN"
        ? { facilityName: fallback.facilityName || "SeqDesk Profile Smoke" }
        : { institution: fallback.institution || "SeqDesk Profile Smoke" }),
    },
  });
}

async function writeSmokeFastq(dataBasePath, relativePath, sampleId, index) {
  const absolutePath = path.join(dataBasePath, relativePath);
  await fsp.mkdir(path.dirname(absolutePath), { recursive: true });
  const gzipped = gzipSync(Buffer.from(buildFastq(sampleId, index), "utf8"));
  await fsp.writeFile(absolutePath, gzipped);
  return {
    absolutePath,
    sizeBytes: gzipped.length,
    checksum: crypto.createHash("md5").update(gzipped).digest("hex"),
  };
}

async function upsertSmokeSample(prisma, order, study, sample, dataBasePath, writeFastqFiles) {
  const existing = await prisma.sample.findFirst({
    where: { orderId: order.id, sampleId: sample.sampleId },
    include: { reads: { take: 1 } },
  });

  const sampleData = {
    sampleAlias: sample.sampleAlias,
    sampleTitle: sample.sampleTitle,
    scientificName: "metagenome",
    taxId: "256318",
    studyId: study.id,
    facilityStatus: writeFastqFiles ? "SEQUENCED" : "WAITING",
    facilityStatusUpdatedAt: new Date(),
    checklistData: JSON.stringify({
      collection_date: "2026-01-01",
      geographic_location: "Germany:Lower Saxony:Braunschweig",
      env_broad_scale: "clinical environment",
    }),
    customFields: JSON.stringify({
      internal_sample_code: sample.sampleAlias,
      material_body_site: sample.materialBodySite,
      _installProfileFixture: sample.marker,
    }),
  };

  const sampleRecord = existing
    ? await prisma.sample.update({
        where: { id: existing.id },
        data: sampleData,
        include: { reads: { take: 1 } },
      })
    : await prisma.sample.create({
        data: {
          orderId: order.id,
          sampleId: sample.sampleId,
          ...sampleData,
        },
        include: { reads: { take: 1 } },
      });

  if (!writeFastqFiles) return sampleRecord;

  const written = await writeSmokeFastq(
    dataBasePath,
    sample.relativeReadPath,
    sample.sampleId,
    sample.index
  );
  const readData = {
    file1: sample.relativeReadPath,
    file2: null,
    checksum1: written.checksum,
    checksum2: null,
    readCount1: 2,
    readCount2: null,
    avgQuality1: 39,
    avgQuality2: null,
    pipelineRunId: null,
    pipelineSources: null,
  };

  const existingRead = sampleRecord.reads[0];
  if (existingRead) {
    await prisma.read.update({
      where: { id: existingRead.id },
      data: readData,
    });
  } else {
    await prisma.read.create({
      data: {
        sampleId: sampleRecord.id,
        ...readData,
      },
    });
  }

  return sampleRecord;
}

async function readFastqBundleManifest(extractDir, fixtureId) {
  const manifestPath = path.join(extractDir, "manifest.json");
  let parsed;
  try {
    parsed = JSON.parse(await fsp.readFile(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(
      `Fixture ${fixtureId} bundle must contain manifest.json: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
  }
  const manifest = toRecord(parsed);
  const samples = Array.isArray(manifest.samples) ? manifest.samples.map(toRecord) : [];
  if (samples.length === 0) {
    throw new Error(`Fixture ${fixtureId} manifest must list at least one sample`);
  }
  return {
    dataset: toRecord(manifest.dataset),
    order: toRecord(manifest.order),
    study: toRecord(manifest.study),
    samples,
  };
}

async function upsertDownloadedFastqSample({
  prisma,
  order,
  study,
  sample,
  dataBasePath,
  baseRelativeDir,
  marker,
}) {
  const relativeBundlePath1 = normalizeFixtureRelativePath(sample.file1, "sample.file1");
  const relativeReadPath1 = path.posix.join(baseRelativeDir, relativeBundlePath1);
  const absoluteReadPath1 = path.join(dataBasePath, relativeReadPath1);
  const fileSize1 = await getFileSize(absoluteReadPath1);
  if (fileSize1 <= 0) {
    throw new Error(`Fixture FASTQ file is missing or empty: ${absoluteReadPath1}`);
  }

  const relativeBundlePath2 = toOptionalString(sample.file2)
    ? normalizeFixtureRelativePath(sample.file2, "sample.file2")
    : null;
  const relativeReadPath2 = relativeBundlePath2
    ? path.posix.join(baseRelativeDir, relativeBundlePath2)
    : null;
  if (relativeReadPath2) {
    const absoluteReadPath2 = path.join(dataBasePath, relativeReadPath2);
    const fileSize2 = await getFileSize(absoluteReadPath2);
    if (fileSize2 <= 0) {
      throw new Error(`Fixture FASTQ file is missing or empty: ${absoluteReadPath2}`);
    }
  }

  const existing = await prisma.sample.findFirst({
    where: { orderId: order.id, sampleId: sample.sampleId },
    include: { reads: true },
  });

  const checklistData = {
    collection_date: "2026-01-01",
    geographic_location: "Germany:Lower Saxony:Braunschweig",
    env_broad_scale: "laboratory environment",
    ...toJsonObject(sample.checklistData),
  };
  const customFields = {
    internal_sample_code: toOptionalString(sample.sampleAlias) || sample.sampleId,
    material_body_site: toOptionalString(sample.materialBodySite) || "control",
    ...toJsonObject(sample.customFields),
    _installProfileFixture: marker,
  };
  const sampleData = {
    sampleAlias: toOptionalString(sample.sampleAlias) || sample.sampleId,
    sampleTitle: toOptionalString(sample.sampleTitle) || sample.sampleId,
    sampleDescription: toOptionalString(sample.sampleDescription) || null,
    scientificName: toOptionalString(sample.scientificName) || "metagenome",
    taxId: toOptionalString(sample.taxId) || "256318",
    studyId: study.id,
    facilityStatus: "SEQUENCED",
    facilityStatusUpdatedAt: new Date(),
    checklistData: JSON.stringify(checklistData),
    customFields: JSON.stringify(customFields),
  };

  const sampleRecord = existing
    ? await prisma.sample.update({
        where: { id: existing.id },
        data: sampleData,
        include: { reads: true },
      })
    : await prisma.sample.create({
        data: {
          orderId: order.id,
          sampleId: sample.sampleId,
          ...sampleData,
        },
        include: { reads: true },
      });

  const existingRead =
    sampleRecord.reads.find((read) => read.file1 === relativeReadPath1) || sampleRecord.reads[0];
  const readData = {
    file1: relativeReadPath1,
    file2: relativeReadPath2,
    checksum1: toOptionalString(sample.checksum1) || existingRead?.checksum1 || null,
    checksum2: toOptionalString(sample.checksum2) || existingRead?.checksum2 || null,
    readCount1: toOptionalNonNegativeInt(sample.readCount1) ?? null,
    readCount2: toOptionalNonNegativeInt(sample.readCount2) ?? null,
    avgQuality1: toOptionalNumber(sample.avgQuality1) ?? null,
    avgQuality2: toOptionalNumber(sample.avgQuality2) ?? null,
    pipelineRunId: existingRead?.pipelineRunId ?? null,
    pipelineSources: existingRead?.pipelineSources ?? null,
    dataClass: toOptionalString(sample.dataClass) || "cleaned",
    dataClassSource: toOptionalString(sample.dataClassSource) || "profile_fixture_manifest",
    classificationNote:
      toOptionalString(sample.classificationNote) ||
      "Profile fixture read declared as cleaned input data.",
  };

  if (existingRead) {
    await prisma.read.update({
      where: { id: existingRead.id },
      data: readData,
    });
  } else {
    await prisma.read.create({
      data: {
        sampleId: sampleRecord.id,
        ...readData,
      },
    });
  }

  return sampleRecord;
}

async function seedDownloadedFastqBundleFixture({
  prisma,
  profile,
  fixture,
  dataBasePath,
  rootDir,
  logger = console,
  activity,
}) {
  const profileId = normalizeProfileId(profile);
  const fixtureId = normalizeFixtureId(fixture);
  const profileToken = uppercaseToken(profileId);
  const fixtureKind = toOptionalString(fixture.kind) || "orderPipelineSmoke";
  const source = toRecord(fixture.source);
  const marker = {
    profileId,
    fixtureId,
    kind: fixtureKind,
    source: "downloadedFastqBundle",
  };

  if (!dataBasePath) {
    throw new Error(`Fixture ${fixtureId} requires site.dataBasePath to extract FASTQ files`);
  }

  const extracted = await extractVerifiedFastqBundle({
    source,
    profileId,
    fixtureId,
    dataBasePath,
    rootDir,
    logger,
    activity,
  });
  const manifest = await readFastqBundleManifest(extracted.extractDir, fixtureId);
  await activity?.update?.({
    phase: "seeding",
    targetPath: extracted.extractDir,
    logPath: extracted.logPath,
  });

  const [admin, researcher] = await Promise.all([
    ensureUser(prisma, "FACILITY_ADMIN", {
      email: `${profileId}-smoke-admin@seqdesk.local`,
      firstName: "Profile",
      lastName: "Admin",
      facilityName: "SeqDesk Profile Smoke",
    }),
    ensureUser(prisma, "RESEARCHER", {
      email: `${profileId}-smoke-researcher@seqdesk.local`,
      firstName: "Profile",
      lastName: "Researcher",
      institution: "SeqDesk Profile Smoke",
    }),
  ]);

  const studyAlias =
    toOptionalString(manifest.study.alias) || `${profileId}-${fixtureId}`;
  const existingStudy = await prisma.study.findFirst({
    where: { userId: researcher.id, alias: studyAlias },
  });
  const principalInvestigator =
    toOptionalString(manifest.study.principalInvestigator) ||
    toOptionalString(manifest.study.principal_investigator) ||
    "SeqDesk Profile Fixture";
  const studyAbstract =
    toOptionalString(manifest.study.abstract) ||
    toOptionalString(manifest.study.study_abstract) ||
    "Profile-seeded data for validating profile-driven pipeline setup.";
  const studyMetadata = {
    principal_investigator: principalInvestigator,
    study_abstract: studyAbstract,
    ...toJsonObject(manifest.study.metadata),
    ...toJsonObject(manifest.study.studyMetadata),
    _installProfileFixture: marker,
  };
  const studyData = {
    title:
      toOptionalString(manifest.study.title) ||
      toOptionalString(manifest.order.name) ||
      "SeqDesk profile fixture study",
    alias: studyAlias,
    description:
      toOptionalString(manifest.study.description) ||
      "Profile-seeded study for a bundled example dataset.",
    checklistType:
      toOptionalString(manifest.study.checklistType) ||
      "Miscellaneous natural or artificial environment",
    studyMetadata: JSON.stringify(studyMetadata),
    userId: researcher.id,
  };
  const study = existingStudy
    ? await prisma.study.update({ where: { id: existingStudy.id }, data: studyData })
    : await prisma.study.create({ data: studyData });

  const orderNumber =
    toOptionalString(fixture.orderNumber) ||
    toOptionalString(manifest.order.orderNumber) ||
    `${profileToken}-SMOKE-001`;
  const sequencingTech = {
    technologyId: "ont-minion",
    technologyName: "MinION",
    platformFamily: "oxford-nanopore",
    readLengthClass: "long",
    supportedReadLayouts: ["single"],
    deviceId: "ont-minion-mk1d",
    deviceName: "MinION Mk1D",
    ...toJsonObject(manifest.order.sequencingTech),
  };
  const customFields = {
    run_type: toOptionalString(manifest.order.runType) || "metagenomics",
    _sequencing_tech: sequencingTech,
    ...toJsonObject(manifest.order.customFields),
    _installProfileFixture: marker,
  };
  const existingOrder = await prisma.order.findUnique({
    where: { orderNumber },
  });
  const orderData = {
    name: toOptionalString(manifest.order.name) || "SeqDesk profile fixture order",
    status: toOptionalString(manifest.order.status) || "SUBMITTED",
    statusUpdatedAt: new Date(),
    numberOfSamples: manifest.samples.length,
    contactName:
      toOptionalString(manifest.order.contactName) ||
      `${researcher.firstName} ${researcher.lastName}`.trim(),
    contactEmail: toOptionalString(manifest.order.contactEmail) || researcher.email,
    contactPhone: toOptionalString(manifest.order.contactPhone) || null,
    billingAddress:
      toOptionalString(manifest.order.billingAddress) || "SeqDesk profile fixture",
    platform: null,
    instrumentModel: toOptionalString(manifest.order.instrumentModel) || "MinION Mk1D",
    libraryStrategy: toOptionalString(manifest.order.libraryStrategy) || "WGS",
    librarySource: toOptionalString(manifest.order.librarySource) || "METAGENOMIC",
    librarySelection: toOptionalString(manifest.order.librarySelection) || null,
    customFields: JSON.stringify(customFields),
    userId: researcher.id,
  };
  const order = existingOrder
    ? await prisma.order.update({ where: { id: existingOrder.id }, data: orderData })
    : await prisma.order.create({ data: { orderNumber, ...orderData } });

  const baseRelativeDir = path.posix.join("fixtures", profileId, fixtureId);
  let sampleIndex = 0;
  for (const rawSample of manifest.samples) {
    sampleIndex += 1;
    const sample = {
      ...rawSample,
      sampleId:
        toOptionalString(rawSample.sampleId) ||
        `${profileToken}-FASTQ-${String(sampleIndex).padStart(2, "0")}`,
    };
    await upsertDownloadedFastqSample({
      prisma,
      order,
      study,
      sample,
      dataBasePath,
      baseRelativeDir,
      marker,
    });
  }

  logger.log?.(`Seeded downloaded FASTQ fixture ${fixtureId}: ${orderNumber}`);
  void admin;

  return {
    fixtureId,
    orderNumber,
    samples: manifest.samples.length,
    wroteFastqFiles: true,
    sourceUrl: extracted.sourceUrl,
    archivePath: extracted.archivePath,
    logPath: extracted.logPath,
    sha256: extracted.sha256,
  };
}

async function seedOrderPipelineSmokeFixture({
  prisma,
  profile,
  fixture,
  dataBasePath,
  rootDir,
  logger = console,
  activity,
}) {
  const source = toRecord(fixture.source);
  if (source.type === "downloadedFastqBundle") {
    return seedDownloadedFastqBundleFixture({
      prisma,
      profile,
      fixture,
      dataBasePath,
      rootDir,
      logger,
      activity,
    });
  }

  const profileId = normalizeProfileId(profile);
  const fixtureId = normalizeFixtureId(fixture);
  const profileToken = uppercaseToken(profileId);
  const marker = {
    profileId,
    fixtureId,
    kind: "orderPipelineSmoke",
  };
  const writeFastqFiles = toOptionalBoolean(fixture.writeFastqFiles) !== false;

  if (writeFastqFiles && !dataBasePath) {
    throw new Error(`Fixture ${fixtureId} requires site.dataBasePath to write FASTQ files`);
  }

  const [admin, researcher] = await Promise.all([
    ensureUser(prisma, "FACILITY_ADMIN", {
      email: `${profileId}-smoke-admin@seqdesk.local`,
      firstName: "Profile",
      lastName: "Admin",
      facilityName: "SeqDesk Profile Smoke",
    }),
    ensureUser(prisma, "RESEARCHER", {
      email: `${profileId}-smoke-researcher@seqdesk.local`,
      firstName: "Profile",
      lastName: "Researcher",
      institution: "SeqDesk Profile Smoke",
    }),
  ]);

  const studyAlias = `${profileId}-${fixtureId}`;
  const existingStudy = await prisma.study.findFirst({
    where: { userId: researcher.id, alias: studyAlias },
  });
  const studyData = {
    title: "TwinCore ONT smoke study",
    alias: studyAlias,
    description: "Profile-seeded smoke study for ONT pipeline validation.",
    checklistType: "Miscellaneous natural or artificial environment",
    studyMetadata: JSON.stringify({
      principal_investigator: "SeqDesk Profile Smoke",
      study_abstract: "Operational smoke data for validating profile-driven pipeline setup.",
      _installProfileFixture: marker,
    }),
    userId: researcher.id,
  };
  const study = existingStudy
    ? await prisma.study.update({ where: { id: existingStudy.id }, data: studyData })
    : await prisma.study.create({ data: studyData });

  const orderNumber = `${profileToken}-SMOKE-001`;
  const customFields = {
    run_type: "metagenomics",
    _sequencing_tech: {
      technologyId: "ont-minion",
      technologyName: "MinION",
      platformFamily: "oxford-nanopore",
      readLengthClass: "long",
      supportedReadLayouts: ["single"],
      deviceId: "ont-minion-mk1d",
      deviceName: "MinION Mk1D",
    },
    _installProfileFixture: marker,
  };
  const existingOrder = await prisma.order.findUnique({
    where: { orderNumber },
  });
  const orderData = {
    name: "TwinCore ONT smoke order",
    status: "SUBMITTED",
    statusUpdatedAt: new Date(),
    numberOfSamples: 2,
    contactName: `${researcher.firstName} ${researcher.lastName}`.trim(),
    contactEmail: researcher.email,
    billingAddress: "SeqDesk profile smoke fixture",
    platform: null,
    instrumentModel: "MinION Mk1D",
    libraryStrategy: "WGS",
    librarySource: "METAGENOMIC",
    customFields: JSON.stringify(customFields),
    userId: researcher.id,
  };
  const order = existingOrder
    ? await prisma.order.update({ where: { id: existingOrder.id }, data: orderData })
    : await prisma.order.create({ data: { orderNumber, ...orderData } });

  const baseRelativeDir = path.posix.join("fixtures", profileId, fixtureId);
  const samples = [
    {
      index: 1,
      sampleId: `${profileToken}-ONT-01`,
      sampleAlias: "ONT-SMOKE-01",
      sampleTitle: "ONT smoke sample 01",
      materialBodySite: "BAL",
      relativeReadPath: path.posix.join(baseRelativeDir, `${profileToken}-ONT-01.fastq.gz`),
      marker,
    },
    {
      index: 2,
      sampleId: `${profileToken}-ONT-02`,
      sampleAlias: "ONT-SMOKE-02",
      sampleTitle: "ONT smoke sample 02",
      materialBodySite: "urine",
      relativeReadPath: path.posix.join(baseRelativeDir, `${profileToken}-ONT-02.fastq.gz`),
      marker,
    },
  ];

  for (const sample of samples) {
    await upsertSmokeSample(prisma, order, study, sample, dataBasePath, writeFastqFiles);
  }

  logger.log?.(`Seeded profile smoke fixture ${fixtureId}: ${orderNumber}`);
  void admin;

  return {
    fixtureId,
    orderNumber,
    samples: samples.length,
    wroteFastqFiles: writeFastqFiles,
  };
}

export async function applyProfileSeedData({
  prisma,
  profile,
  rootDir = process.cwd(),
  logger = console,
  activity,
}) {
  const seedData = toRecord(profile.seedData);
  if (toOptionalBoolean(seedData.enabled) !== true) {
    return { skipped: true, seeded: 0 };
  }

  const fixtures = Array.isArray(seedData.fixtures) ? seedData.fixtures : [];
  const { dataBasePath } = await resolveProfilePipelineAssetSettings(prisma, profile);
  const results = [];

  for (const rawFixture of fixtures) {
    const fixture = toRecord(rawFixture);
    if (!["orderPipelineSmoke", "exampleDataset"].includes(fixture.kind)) continue;
    try {
      results.push(
        await seedOrderPipelineSmokeFixture({
          prisma,
          profile,
          fixture,
          dataBasePath,
          rootDir,
          logger,
          activity,
        })
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (toOptionalBoolean(fixture.required) === false) {
        logger.warn?.(`Optional fixture ${normalizeFixtureId(fixture)} failed: ${message}`);
        continue;
      }
      throw error;
    }
  }

  return { skipped: false, seeded: results.length, results };
}

export async function applyProfileAssets({
  prisma,
  profile,
  rootDir = process.cwd(),
  logger = console,
}) {
  const databases = await applyProfilePipelineDatabases({
    prisma,
    profile,
    rootDir,
    logger,
  });
  const seedData = await applyProfileSeedData({
    prisma,
    profile,
    rootDir,
    logger,
  });
  return { databases, seedData };
}
