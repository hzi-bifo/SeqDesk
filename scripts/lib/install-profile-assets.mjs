import crypto from "crypto";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { spawnSync } from "child_process";
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
  return (toOptionalString(fixture.id) || "smoke").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
}

function uppercaseToken(value) {
  return value.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toUpperCase();
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

export function loadPipelineDatabaseDefinitions(rootDir = process.cwd()) {
  const definitionPath = path.join(rootDir, "data", "pipeline-databases.json");
  const parsed = JSON.parse(fs.readFileSync(definitionPath, "utf8"));
  return isRecord(parsed) ? parsed : {};
}

export function resolveProfileDatabaseRequests(profile, definitions = {}) {
  const pipelines = toRecord(profile.pipelines);
  const databases = toRecord(pipelines.databases);
  const autoDownload = toOptionalBoolean(databases.autoDownload) === true;
  if (!autoDownload) {
    return { autoDownload: false, requests: [] };
  }

  const rawDownloads = Array.isArray(databases.downloads) ? databases.downloads : [];
  const requests = [];

  if (rawDownloads.length > 0) {
    for (const item of rawDownloads) {
      if (!isRecord(item)) continue;
      const pipelineId = toOptionalString(item.pipelineId);
      const databaseId = toOptionalString(item.databaseId);
      if (!pipelineId || !databaseId) continue;
      requests.push({
        pipelineId,
        databaseId,
        required: toOptionalBoolean(item.required) !== false,
      });
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
          requests.push({
            pipelineId: normalizedPipelineId,
            databaseId: database.id,
            required: true,
          });
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

async function downloadFileArchive({ sourceUrl, targetPath, logPath }) {
  await fsp.mkdir(path.dirname(targetPath), { recursive: true });
  const totalBytes = await getRemoteContentLength(sourceUrl);
  const localBytes = await getFileSize(targetPath);

  if (localBytes > 0 && typeof totalBytes === "number" && localBytes >= totalBytes) {
    appendLog(logPath, `Archive already present: ${targetPath}`);
    return { bytesDownloaded: localBytes, totalBytes };
  }

  const downloader = resolveDownloader();
  runLoggedCommand(logPath, downloader.command, downloader.args(sourceUrl, targetPath));
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
}) {
  const sourceUrl = toOptionalString(source.url);
  if (!sourceUrl) {
    throw new Error(`Fixture ${fixtureId} source.url is required`);
  }

  const expectedSha256 = normalizeExpectedSha256(source.sha256);
  if (!expectedSha256) {
    throw new Error(`Fixture ${fixtureId} source.sha256 is required`);
  }

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
    download = await downloadFileArchive({ sourceUrl, targetPath: archivePath, logPath });
  }
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
  let downloaded = 0;
  let failed = 0;

  for (const request of requests) {
    const database = (definitions[request.pipelineId] || []).find(
      (entry) => entry.id === request.databaseId
    );
    if (!database) {
      const message = `Database ${request.databaseId} is not defined for pipeline ${request.pipelineId}`;
      if (request.required) throw new Error(message);
      logger.warn?.(message);
      continue;
    }

    const targetPath = buildProfilePipelineDatabaseTargetPath({
      pipelineRunDir: settings.pipelineRunDir,
      databaseDirectory: settings.databaseDirectory,
      pipelineId: request.pipelineId,
      databaseId: request.databaseId,
      fileName: database.fileName,
    });
    const logPath = await createDatabaseDownloadLogPath(rootDir, request.pipelineId, request.databaseId);
    const startedAt = new Date().toISOString();

    await writeDatabaseDownloadStatus(rootDir, request.pipelineId, request.databaseId, {
      state: "running",
      sourceUrl: database.downloadUrl,
      targetPath,
      startedAt,
      finishedAt: undefined,
      error: undefined,
      logPath,
    });

    try {
      logger.log?.(`Downloading database ${request.pipelineId}/${request.databaseId}`);
      const download = await downloadDatabaseArchive({ database, targetPath, logPath });
      const installed = await installDatabaseIfNeeded({
        rootDir,
        pipelineRunDir: settings.pipelineRunDir,
        databaseDirectory: settings.databaseDirectory,
        pipelineId: request.pipelineId,
        databaseId: request.databaseId,
        database,
        archivePath: targetPath,
        logPath,
      });

      await setPipelineDatabaseConfig(
        prisma,
        request.pipelineId,
        database.configKey,
        installed.runtimePath
      );
      await writeDatabaseDownloadRecord(rootDir, request.pipelineId, request.databaseId, {
        version: database.version,
        path: installed.runtimePath,
        sourceUrl: database.downloadUrl,
        sizeBytes: installed.sizeBytes,
      });
      await writeDatabaseDownloadStatus(rootDir, request.pipelineId, request.databaseId, {
        state: "success",
        sourceUrl: database.downloadUrl,
        targetPath,
        bytesDownloaded: download.bytesDownloaded,
        totalBytes: download.totalBytes,
        progressPercent: 100,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: undefined,
        logPath,
      });
      downloaded += 1;
    } catch (error) {
      failed += 1;
      const message = error instanceof Error ? error.message : String(error);
      await writeDatabaseDownloadStatus(rootDir, request.pipelineId, request.databaseId, {
        state: "error",
        sourceUrl: database.downloadUrl,
        targetPath,
        startedAt,
        finishedAt: new Date().toISOString(),
        error: message,
        logPath,
      });
      if (request.required) throw error;
      logger.warn?.(`Optional database ${request.pipelineId}/${request.databaseId} failed: ${message}`);
    }
  }

  return { skipped: false, downloaded, failed };
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
  const relativeBundlePath = normalizeFixtureRelativePath(sample.file1, "sample.file1");
  const relativeReadPath = path.posix.join(baseRelativeDir, relativeBundlePath);
  const absoluteReadPath = path.join(dataBasePath, relativeReadPath);
  const fileSize = await getFileSize(absoluteReadPath);
  if (fileSize <= 0) {
    throw new Error(`Fixture FASTQ file is missing or empty: ${absoluteReadPath}`);
  }

  const existing = await prisma.sample.findFirst({
    where: { orderId: order.id, sampleId: sample.sampleId },
    include: { reads: true },
  });

  const sampleData = {
    sampleAlias: toOptionalString(sample.sampleAlias) || sample.sampleId,
    sampleTitle: toOptionalString(sample.sampleTitle) || sample.sampleId,
    scientificName: toOptionalString(sample.scientificName) || "metagenome",
    taxId: toOptionalString(sample.taxId) || "256318",
    studyId: study.id,
    facilityStatus: "SEQUENCED",
    facilityStatusUpdatedAt: new Date(),
    checklistData: JSON.stringify({
      collection_date: "2026-01-01",
      geographic_location: "Germany:Lower Saxony:Braunschweig",
      env_broad_scale: "laboratory environment",
    }),
    customFields: JSON.stringify({
      internal_sample_code: toOptionalString(sample.sampleAlias) || sample.sampleId,
      material_body_site: toOptionalString(sample.materialBodySite) || "control",
      _installProfileFixture: marker,
    }),
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
    sampleRecord.reads.find((read) => read.file1 === relativeReadPath) || sampleRecord.reads[0];
  const readData = {
    file1: relativeReadPath,
    file2: null,
    checksum1: existingRead?.checksum1 ?? null,
    checksum2: null,
    readCount1:
      typeof sample.readCount1 === "number" && Number.isFinite(sample.readCount1)
        ? Math.max(0, Math.trunc(sample.readCount1))
        : null,
    readCount2: null,
    avgQuality1:
      typeof sample.avgQuality1 === "number" && Number.isFinite(sample.avgQuality1)
        ? sample.avgQuality1
        : null,
    avgQuality2: null,
    pipelineRunId: existingRead?.pipelineRunId ?? null,
    pipelineSources: existingRead?.pipelineSources ?? null,
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
}) {
  const profileId = normalizeProfileId(profile);
  const fixtureId = normalizeFixtureId(fixture);
  const profileToken = uppercaseToken(profileId);
  const source = toRecord(fixture.source);
  const marker = {
    profileId,
    fixtureId,
    kind: "orderPipelineSmoke",
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
  });
  const manifest = await readFastqBundleManifest(extracted.extractDir, fixtureId);

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
  const studyData = {
    title:
      toOptionalString(manifest.study.title) ||
      toOptionalString(manifest.order.name) ||
      "CI runner FASTQ checksum smoke study",
    alias: studyAlias,
    description:
      toOptionalString(manifest.study.description) ||
      "Profile-seeded smoke study for FASTQ checksum pipeline validation.",
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

  const orderNumber =
    toOptionalString(fixture.orderNumber) ||
    toOptionalString(manifest.order.orderNumber) ||
    `${profileToken}-SMOKE-001`;
  const customFields = {
    run_type: "metagenomics",
    _sequencing_tech: {
      technologyId: "ont-minion-mk1d",
      technologyName: "MinION Mk1D",
      platformName: "Oxford Nanopore",
      deviceId: "ont-minion-mk1d",
    },
    _installProfileFixture: marker,
  };
  const existingOrder = await prisma.order.findUnique({
    where: { orderNumber },
  });
  const orderData = {
    name: toOptionalString(manifest.order.name) || "CI runner FASTQ checksum smoke order",
    status: "SUBMITTED",
    statusUpdatedAt: new Date(),
    numberOfSamples: manifest.samples.length,
    contactName: `${researcher.firstName} ${researcher.lastName}`.trim(),
    contactEmail: researcher.email,
    billingAddress: "SeqDesk profile smoke fixture",
    platform: "Nanopore",
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
      technologyId: "ont-minion-mk1d",
      technologyName: "MinION Mk1D",
      platformName: "Oxford Nanopore",
      deviceId: "ont-minion-mk1d",
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
    platform: "Nanopore",
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
    if (fixture.kind !== "orderPipelineSmoke") continue;
    try {
      results.push(
        await seedOrderPipelineSmokeFixture({
          prisma,
          profile,
          fixture,
          dataBasePath,
          rootDir,
          logger,
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
