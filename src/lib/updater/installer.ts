/**
 * Update Installer
 *
 * Downloads and installs updates.
 * The update process:
 * 1. Download new version tarball
 * 2. Verify checksum
 * 3. Extract to a staged release directory
 * 4. Install dependencies and generate Prisma client in staging
 * 5. Publish staged release and switch current symlink
 * 6. Run migrations from the activated release
 * 7. Restart application
 */

import { exec, type ExecOptions } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type { ReleaseInfo, UpdateProgress } from './types';
import {
  patchUpdateState,
  readUpdateState,
  releaseUpdateLock,
  touchUpdateLock,
  writeUpdateState,
} from './status';
import { requirePostgresDatabaseUrl } from '@/lib/database-url';
import {
  getDatabaseCompatibilityError,
  loadInstalledDatabaseConfig,
} from './database-config';
import { db } from '@/lib/db';

type DataSnapshot = { orders: number; samples: number; studies: number; users: number };

async function snapshotDataCounts(): Promise<DataSnapshot> {
  const [orders, samples, studies, users] = await Promise.all([
    db.order.count(),
    db.sample.count(),
    db.study.count(),
    db.user.count(),
  ]);
  return { orders, samples, studies, users };
}

function describeDataLoss(before: DataSnapshot, after: DataSnapshot): string | null {
  const lost: string[] = [];
  for (const key of ['orders', 'samples', 'studies', 'users'] as const) {
    if (after[key] < before[key]) {
      lost.push(`${key} ${before[key]} → ${after[key]}`);
    }
  }
  return lost.length > 0 ? lost.join(', ') : null;
}

const execAsync = promisify(exec);

const UPDATE_COMMAND_MAX_BUFFER = 128 * 1024 * 1024;
const NPM_CI_COMMAND = 'npm ci --omit=dev --no-audit --no-fund';
const NPM_INSTALL_COMMAND = 'npm install --omit=dev --no-audit --no-fund';
type RuntimeDependencyInstallMode = 'clean' | 'in-place';

function runUpdateCommand(command: string, options: ExecOptions = {}) {
  return execAsync(command, {
    maxBuffer: UPDATE_COMMAND_MAX_BUFFER,
    ...options,
  });
}

async function pathExists(filePath: string): Promise<boolean> {
  return fs.access(filePath).then(() => true).catch(() => false);
}

async function resolveInstallLayout(appDir: string = INSTALL_DIR): Promise<InstallLayout> {
  const parentDir = path.dirname(appDir);
  const grandparentDir = path.dirname(parentDir);
  let rootDir = appDir;

  if (
    path.basename(appDir) === CURRENT_LINK_NAME &&
    await pathExists(path.join(parentDir, RELEASES_DIR_NAME))
  ) {
    rootDir = parentDir;
  } else if (path.basename(parentDir) === RELEASES_DIR_NAME) {
    rootDir = grandparentDir;
  } else if (
    await pathExists(path.join(appDir, CURRENT_LINK_NAME)) ||
    await pathExists(path.join(appDir, RELEASES_DIR_NAME))
  ) {
    rootDir = appDir;
  }

  const currentLinkPath = path.join(rootDir, CURRENT_LINK_NAME);
  return {
    appDir,
    rootDir,
    releasesDir: path.join(rootDir, RELEASES_DIR_NAME),
    currentLinkPath,
    tempDir: path.join(rootDir, TEMP_DIR_NAME),
    hasCurrentLink: await pathExists(currentLinkPath),
  };
}

function getActiveRuntimeDir(layout: InstallLayout): string {
  return layout.hasCurrentLink ? layout.currentLinkPath : layout.appDir;
}

// Minimum required disk space in bytes (150MB)
const MIN_DISK_SPACE = 150 * 1024 * 1024;

// Progress callback type
type ProgressCallback = (progress: UpdateProgress) => void;

// Active application directory. In release-layout installs this may be
// <root>/current or <root>/releases/<version>; flat installs use <root>.
const INSTALL_DIR = process.cwd();
const RELEASES_DIR_NAME = 'releases';
const CURRENT_LINK_NAME = 'current';
const TEMP_DIR_NAME = '.update-temp';
const SHARED_DIR_NAMES = ['data', 'pipelines', 'pipeline_runs'];
const SHARED_FILE_NAMES = ['settings.json', 'seqdesk.config.json'];
const SAFE_RELEASE_VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,127}$/;

interface InstallLayout {
  appDir: string;
  rootDir: string;
  releasesDir: string;
  currentLinkPath: string;
  tempDir: string;
  hasCurrentLink: boolean;
}

/**
 * Check available disk space
 */
async function checkDiskSpace(baseDir: string): Promise<{ free: number; required: number; sufficient: boolean }> {
  try {
    if (os.platform() === 'darwin' || os.platform() === 'linux') {
      const { stdout } = await runUpdateCommand(
        `df -k "${baseDir}" | tail -1 | awk '{print $4}'`
      );
      const freeKB = parseInt(String(stdout).trim(), 10);
      const freeBytes = freeKB * 1024;
      return {
        free: freeBytes,
        required: MIN_DISK_SPACE,
        sufficient: freeBytes >= MIN_DISK_SPACE,
      };
    }
    // Windows or unknown - skip check
    return { free: MIN_DISK_SPACE * 2, required: MIN_DISK_SPACE, sufficient: true };
  } catch {
    // If check fails, assume sufficient space
    return { free: MIN_DISK_SPACE * 2, required: MIN_DISK_SPACE, sufficient: true };
  }
}

/**
 * Install an update
 */
export async function installUpdate(
  release: ReleaseInfo,
  onProgress?: ProgressCallback
): Promise<void> {
  const report = (status: UpdateProgress['status'], progress: number, message: string, error?: string) => {
    void touchUpdateLock();
    onProgress?.({ status, progress, message, error });
  };
  let layout: InstallLayout | null = null;
  let previousCurrentTarget: string | null = null;
  let activatedRelease = false;
  let targetReleasePath: string | null = null;

  try {
    validateReleaseForInstall(release);

    layout = await resolveInstallLayout();
    previousCurrentTarget = await readCurrentReleaseTarget(layout);
    targetReleasePath = getReleaseDir(layout, release.version);
    const startedAt = new Date().toISOString();
    await writeUpdateState({
      phase: 'preparing',
      startedAt,
      previousRelease: previousCurrentTarget,
      targetRelease: targetReleasePath,
      activeRelease: previousCurrentTarget,
      targetVersion: release.version,
    });

    const installedDatabase = await loadInstalledDatabaseConfig(layout.rootDir);
    requirePostgresDatabaseUrl(installedDatabase.databaseUrl);
    const databaseCompatibilityError = getDatabaseCompatibilityError(
      installedDatabase.provider,
      release.databaseRequirement
    );
    if (databaseCompatibilityError) {
      throw new Error(databaseCompatibilityError);
    }

    // Step 0: Check disk space
    report('downloading', 5, 'Checking disk space...');
    const diskSpace = await checkDiskSpace(layout.rootDir);
    if (!diskSpace.sufficient) {
      const freeMB = Math.round(diskSpace.free / 1024 / 1024);
      const requiredMB = Math.round(diskSpace.required / 1024 / 1024);
      throw new Error(`Insufficient disk space: ${freeMB}MB free, ${requiredMB}MB required`);
    }

    // Step 1: Download
    report('downloading', 10, `Downloading SeqDesk ${release.version}...`);
    const tarballPath = await downloadRelease(release, layout.tempDir);

    // Step 2: Verify checksum
    report('downloading', 30, 'Verifying download...');
    await verifyChecksum(tarballPath, release.checksum);

    // Step 3: Extract to staged release directory
    report('extracting', 40, 'Preparing staged release...');
    const stagedDir = getStagedReleaseDir(layout, release.version);
    await fs.rm(stagedDir, { recursive: true, force: true });
    await extractRelease(tarballPath, stagedDir);
    await patchUpdateState({ phase: 'staged' });

    // Step 4: Verify staged version
    report('extracting', 55, 'Verifying staged release...');
    await verifyInstalledVersion(release.version, stagedDir);
    await linkSharedRuntimePaths(layout, stagedDir, { configOnly: true });

    // Step 5: Install dependencies in staging, away from the live tree
    report('extracting', 70, 'Installing staged dependencies...');
    await installRuntimeDependencies(stagedDir);

    report('extracting', 82, 'Generating staged Prisma client...');
    await generatePrismaClient(stagedDir);

    // Step 6: Publish and activate staged release
    report('extracting', 88, 'Activating staged release...');
    await patchUpdateState({ phase: 'activating' });
    await syncSharedRuntimePaths(layout, stagedDir);
    await linkSharedRuntimePaths(layout, stagedDir);
    await writeRootStartWrapper(layout.rootDir);
    await publishStagedRelease(layout, stagedDir, release.version);
    await switchCurrentRelease(layout, release.version);
    activatedRelease = true;

    // Step 7: Run migrations from the activated release
    report('extracting', 93, 'Running database migrations...');
    await patchUpdateState({
      phase: 'migrating',
      activeRelease: targetReleasePath,
    });
    // Take a best-effort logical backup before migrating. `migrate deploy` is
    // forward-only, so reverting the code symlink on failure does NOT undo a
    // schema change or restore dropped rows; this dump is the only restore point.
    const databaseBackup = await backupDatabaseBeforeMigration(
      layout.rootDir,
      installedDatabase.databaseUrl
    );
    const before = await snapshotDataCounts();
    await runMigrations(layout.currentLinkPath);
    const after = await snapshotDataCounts();
    const loss = describeDataLoss(before, after);
    if (loss) {
      throw new Error(
        `Aborting update: data loss detected after migrations (${loss}).` +
          ' The code symlink is reverted to the previous release, but the database was already migrated and is NOT rolled back automatically — ' +
          (databaseBackup
            ? `restore the pre-migration backup at ${databaseBackup} (pg_restore) before retrying.`
            : 'restore from your own backup before retrying (a pre-migration backup could not be created).')
      );
    }

    // Step 8: Cleanup
    report('complete', 100, 'Update complete! Restarting...');
    await patchUpdateState({
      phase: 'complete',
      activeRelease: targetReleasePath,
      finishedAt: new Date().toISOString(),
      error: undefined,
    });
    await cleanup(layout);

    // Step 9: Restart
    report('restarting', 100, 'Restarting application...');
    await releaseUpdateLock();
    await restartApplication();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    report('error', 0, 'Update failed', errorMessage);

    if (layout && activatedRelease && previousCurrentTarget) {
      try {
        await switchCurrentReleaseToTarget(layout, previousCurrentTarget);
        await patchUpdateState({ activeRelease: previousCurrentTarget });
      } catch {
        // Keep the original update error; manual restart/repair may be needed.
      }
    }

    if (layout) {
      await patchUpdateState({
        phase: 'error',
        error: errorMessage,
        finishedAt: new Date().toISOString(),
        activeRelease:
          activatedRelease && previousCurrentTarget
            ? previousCurrentTarget
            : await readCurrentReleaseTarget(layout),
      });
    }

    await releaseUpdateLock();
    throw error;
  }
}

function validateReleaseForInstall(release: ReleaseInfo): void {
  if (!SAFE_RELEASE_VERSION_PATTERN.test(release.version)) {
    throw new Error(`Invalid release version: ${release.version}`);
  }

  const downloadUrl = parseDownloadUrl(release.downloadUrl);
  // Require https so the download cannot be MITM'd. http is permitted only when
  // an operator explicitly opts in (e.g. an internal mirror over a trusted link).
  const allowInsecure = process.env.SEQDESK_ALLOW_INSECURE_UPDATE === 'true';
  if (
    downloadUrl.protocol !== 'https:' &&
    !(allowInsecure && downloadUrl.protocol === 'http:')
  ) {
    throw new Error(`Unsupported download URL protocol: ${downloadUrl.protocol}`);
  }

  validateChecksumFormat(release.checksum);
}

function parseDownloadUrl(downloadUrl: string): URL {
  try {
    return new URL(downloadUrl);
  } catch {
    throw new Error('Invalid release download URL');
  }
}

function validateChecksumFormat(checksum: string): void {
  if (!checksum || checksum === 'sha256:placeholder') {
    throw new Error('Release is missing a checksum; refusing to install an unverified download');
  }

  const parts = checksum.split(':');
  if (parts.length !== 2) {
    throw new Error('Invalid checksum format');
  }

  const [algorithm, hash] = parts;
  if (algorithm !== 'sha256') {
    throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
  }

  if (!/^[a-fA-F0-9]{64}$/.test(hash)) {
    throw new Error('Invalid sha256 checksum');
  }
}

/**
 * Download the release tarball
 */
async function downloadRelease(release: ReleaseInfo, tempDir: string): Promise<string> {
  const tarballPath = path.join(tempDir, `seqdesk-${release.version}.tar.gz`);

  // Create temp directory
  await fs.mkdir(tempDir, { recursive: true });

  // Download using curl (more reliable than fetch for large files).
  // The URL is passed via an environment variable rather than interpolated into
  // the command string: bash does not re-evaluate the contents of an expanded
  // variable, so a download URL containing $(...), backticks, or other shell
  // metacharacters cannot inject commands here.
  await runUpdateCommand(`curl -fsSL "$SEQDESK_DOWNLOAD_URL" -o "${tarballPath}"`, {
    env: { ...process.env, SEQDESK_DOWNLOAD_URL: parseDownloadUrl(release.downloadUrl).href },
  });

  return tarballPath;
}

/**
 * Verify the checksum of the downloaded file
 */
async function verifyChecksum(filePath: string, expectedChecksum: string): Promise<void> {
  validateChecksumFormat(expectedChecksum);
  const [, hash] = expectedChecksum.split(':');
  const actualHash = await hashFile(filePath, 'sha256');

  if (actualHash !== hash) {
    throw new Error('Checksum verification failed - download may be corrupted');
  }
}

async function hashFile(filePath: string, algorithm: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash(algorithm);
    const stream = createReadStream(filePath);

    stream.on('error', reject);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

/**
 * Extract the release tarball
 */
async function extractRelease(tarballPath: string, extractDir: string): Promise<void> {
  await fs.mkdir(extractDir, { recursive: true });
  await runUpdateCommand(`tar -xzf "${tarballPath}" -C "${extractDir}" --strip-components=1`);
}

async function verifyInstalledVersion(expectedVersion: string, baseDir: string): Promise<void> {
  try {
    const pkgPath = path.join(baseDir, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    if (pkg.version !== expectedVersion) {
      throw new Error(`Expected ${expectedVersion}, found ${pkg.version || 'unknown'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Installed version check failed: ${message}`);
  }
}

function getStagedReleaseDir(layout: InstallLayout, version: string): string {
  return path.join(layout.tempDir, `staged-${version}`);
}

function getReleaseDir(layout: InstallLayout, version: string): string {
  return path.join(layout.releasesDir, version);
}

function relativeLinkTarget(fromPath: string, targetPath: string): string {
  return path.relative(path.dirname(fromPath), targetPath) || '.';
}

async function replaceWithSymlink(linkPath: string, targetPath: string, type: 'file' | 'dir'): Promise<void> {
  await fs.rm(linkPath, { recursive: true, force: true });
  await fs.symlink(relativeLinkTarget(linkPath, targetPath), linkPath, type);
}

async function linkSharedRuntimePaths(
  layout: InstallLayout,
  releaseDir: string,
  options: { configOnly?: boolean } = {}
): Promise<void> {
  for (const fileName of SHARED_FILE_NAMES) {
    const rootPath = path.join(layout.rootDir, fileName);
    const releasePath = path.join(releaseDir, fileName);

    if (!(await pathExists(rootPath)) && await pathExists(releasePath)) {
      await fs.copyFile(releasePath, rootPath);
    }

    await replaceWithSymlink(releasePath, rootPath, 'file');
  }

  if (options.configOnly) {
    return;
  }

  for (const dirName of SHARED_DIR_NAMES) {
    const rootPath = path.join(layout.rootDir, dirName);
    const releasePath = path.join(releaseDir, dirName);
    await fs.mkdir(rootPath, { recursive: true });
    await replaceWithSymlink(releasePath, rootPath, 'dir');
  }
}

async function syncSharedRuntimePaths(layout: InstallLayout, releaseDir: string): Promise<void> {
  const stagedDataDir = path.join(releaseDir, 'data');
  if (await pathExists(stagedDataDir)) {
    await fs.mkdir(path.join(layout.rootDir, 'data'), { recursive: true });
    await fs.cp(stagedDataDir, path.join(layout.rootDir, 'data'), {
      recursive: true,
      force: true,
    });
  }

  const stagedPipelinesDir = path.join(releaseDir, 'pipelines');
  if (await pathExists(stagedPipelinesDir)) {
    const rootPipelinesDir = path.join(layout.rootDir, 'pipelines');
    await fs.mkdir(rootPipelinesDir, { recursive: true });
    for (const entry of await fs.readdir(stagedPipelinesDir)) {
      await fs.cp(path.join(stagedPipelinesDir, entry), path.join(rootPipelinesDir, entry), {
        recursive: true,
        force: true,
      });
    }
  }

  await fs.mkdir(path.join(layout.rootDir, 'pipeline_runs'), { recursive: true });
}

async function publishStagedRelease(
  layout: InstallLayout,
  stagedDir: string,
  version: string
): Promise<void> {
  const releaseDir = getReleaseDir(layout, version);
  const currentTarget = await readCurrentReleaseTarget(layout);

  if (currentTarget && path.resolve(currentTarget) === path.resolve(releaseDir)) {
    throw new Error(`Release ${version} is already active`);
  }

  await fs.mkdir(layout.releasesDir, { recursive: true });
  await fs.rm(releaseDir, { recursive: true, force: true });
  await fs.rename(stagedDir, releaseDir);
}

async function readCurrentReleaseTarget(layout: InstallLayout): Promise<string | null> {
  try {
    const stat = await fs.lstat(layout.currentLinkPath);
    if (!stat.isSymbolicLink()) {
      return null;
    }
    const target = await fs.readlink(layout.currentLinkPath);
    return path.resolve(layout.rootDir, target);
  } catch {
    return null;
  }
}

async function switchCurrentRelease(layout: InstallLayout, version: string): Promise<void> {
  await switchCurrentReleaseToTarget(layout, getReleaseDir(layout, version));
}

async function switchCurrentReleaseToTarget(layout: InstallLayout, targetPath: string): Promise<void> {
  const tempLinkPath = path.join(
    layout.rootDir,
    `.current-next-${process.pid}-${Date.now()}`
  );
  await fs.rm(tempLinkPath, { recursive: true, force: true });
  await fs.symlink(relativeLinkTarget(layout.currentLinkPath, targetPath), tempLinkPath, 'dir');
  await fs.rename(tempLinkPath, layout.currentLinkPath);
  layout.hasCurrentLink = true;
}

async function writeRootStartWrapper(rootDir: string): Promise<void> {
  const wrapper = `#!/usr/bin/env bash
set -e
ROOT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$ROOT_DIR/${CURRENT_LINK_NAME}"
exec ./start.sh "$@"
`;
  const wrapperPath = path.join(rootDir, 'start.sh');
  await fs.writeFile(wrapperPath, wrapper, { mode: 0o755 });
  await fs.chmod(wrapperPath, 0o755);
}

async function installRuntimeDependencies(
  baseDir: string,
  mode: RuntimeDependencyInstallMode = 'clean'
): Promise<void> {
  const hasLockfile = await fs
    .access(path.join(baseDir, 'package-lock.json'))
    .then(() => true)
    .catch(() => false);
  const installCommand =
    hasLockfile && mode === 'clean' ? NPM_CI_COMMAND : NPM_INSTALL_COMMAND;

  try {
    await runUpdateCommand(installCommand, {
      cwd: baseDir,
    });
  } catch (error) {
    if (installCommand === NPM_CI_COMMAND && isNfsPrismaBusyUnlinkError(error)) {
      console.warn(
        'npm ci could not remove an NFS-held Prisma client artifact; retrying with npm install.'
      );
      await runUpdateCommand(NPM_INSTALL_COMMAND, {
        cwd: baseDir,
      });
    } else {
      throw error;
    }
  }

  try {
    await fs.access(path.join(baseDir, 'node_modules', '.bin', 'next'));
  } catch {
    throw new Error('Runtime dependency install did not create node_modules/.bin/next');
  }

  try {
    await fs.access(path.join(baseDir, 'node_modules', '.bin', 'prisma'));
  } catch {
    throw new Error('Runtime dependency install did not create node_modules/.bin/prisma');
  }
}

function isNfsPrismaBusyUnlinkError(error: unknown): boolean {
  const details = [
    error instanceof Error ? error.message : '',
    typeof error === 'object' && error && 'stdout' in error ? String(error.stdout || '') : '',
    typeof error === 'object' && error && 'stderr' in error ? String(error.stderr || '') : '',
  ].join('\n');

  return (
    /\bEBUSY\b/.test(details) &&
    /\bunlink\b/i.test(details) &&
    /node_modules[\/\\]\.prisma[\/\\]client[\/\\]\.nfs/i.test(details)
  );
}

async function generatePrismaClient(baseDir: string): Promise<void> {
  await runUpdateCommand('node scripts/run-prisma.mjs generate', { cwd: baseDir });
}

/**
 * Run database migrations
 */
async function runMigrations(baseDir: string): Promise<void> {
  await runUpdateCommand('node scripts/run-prisma.mjs migrate deploy', { cwd: baseDir });
}

/**
 * Take a best-effort logical backup of the database before migrations run.
 *
 * `prisma migrate deploy` is forward-only: a failed or destructive migration
 * cannot be undone by reverting the code symlink, so this dump is the restore
 * point if migrations drop data. It is best-effort — if pg_dump is unavailable
 * the update still proceeds (returning null), and the caller surfaces that in
 * its abort message. The connection string is passed via the environment so the
 * password never appears in argv/the command string.
 */
async function backupDatabaseBeforeMigration(
  rootDir: string,
  databaseUrl: string | null
): Promise<string | null> {
  if (!databaseUrl) {
    return null;
  }
  try {
    const backupDir = path.join(rootDir, 'backups');
    await fs.mkdir(backupDir, { recursive: true });
    const backupPath = path.join(
      backupDir,
      `pre-update-${new Date().toISOString().replace(/[:.]/g, '-')}.dump`
    );
    await runUpdateCommand(`pg_dump -Fc -f "${backupPath}" "$SEQDESK_DB_URL"`, {
      env: { ...process.env, SEQDESK_DB_URL: databaseUrl },
    });
    return backupPath;
  } catch (error) {
    console.warn(
      'Pre-migration database backup failed; continuing without a restore point:',
      error instanceof Error ? error.message : error
    );
    return null;
  }
}

export async function repairInstalledUpdate(
  targetVersion?: string,
  onProgress?: ProgressCallback
): Promise<void> {
  const report = (status: UpdateProgress['status'], progress: number, message: string, error?: string) => {
    void touchUpdateLock();
    onProgress?.({ status, progress, message, error });
  };

  try {
    const layout = await resolveInstallLayout();
    const runtimeDir = getActiveRuntimeDir(layout);
    const installedDatabase = await loadInstalledDatabaseConfig(layout.rootDir);
    requirePostgresDatabaseUrl(installedDatabase.databaseUrl);

    report('extracting', 20, 'Repairing runtime dependencies...');
    await installRuntimeDependencies(runtimeDir, 'in-place');

    report('extracting', 45, 'Regenerating Prisma client...');
    await generatePrismaClient(runtimeDir);

    report('extracting', 70, 'Running database migrations...');
    const databaseBackup = await backupDatabaseBeforeMigration(
      layout.rootDir,
      installedDatabase.databaseUrl
    );
    const before = await snapshotDataCounts();
    await runMigrations(runtimeDir);
    const after = await snapshotDataCounts();
    const loss = describeDataLoss(before, after);
    if (loss) {
      throw new Error(
        `Aborting repair: data loss detected after migrations (${loss}).` +
          (databaseBackup
            ? ` Restore the pre-migration backup at ${databaseBackup} (pg_restore) before retrying.`
            : ' Restore from your own backup before retrying (a pre-migration backup could not be created).')
      );
    }

    const suffix = targetVersion ? ` to ${targetVersion}` : '';
    report('complete', 100, `Update repair complete${suffix}. Restarting...`);
    report('restarting', 100, 'Restarting application...');
    await releaseUpdateLock();
    await restartApplication();
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    report('error', 0, 'Update repair failed', errorMessage);
    await releaseUpdateLock();
    throw error;
  }
}

export async function rollbackInstalledUpdate(
  onProgress?: ProgressCallback
): Promise<{ fromRelease: string; toRelease: string }> {
  const report = (status: UpdateProgress['status'], progress: number, message: string, error?: string) => {
    void touchUpdateLock();
    onProgress?.({ status, progress, message, error });
  };

  try {
    const layout = await resolveInstallLayout();
    const state = await readUpdateState();
    const rollbackTarget = state?.previousRelease || null;
    const currentTarget = await readCurrentReleaseTarget(layout);

    if (!layout.hasCurrentLink || !currentTarget) {
      throw new Error('Rollback is only available for release-layout installations.');
    }

    if (!rollbackTarget) {
      throw new Error('No previous release is recorded for rollback.');
    }

    if (!(await pathExists(rollbackTarget))) {
      throw new Error(`Previous release is missing: ${rollbackTarget}`);
    }

    if (path.resolve(currentTarget) === path.resolve(rollbackTarget)) {
      throw new Error('SeqDesk is already running the recorded previous release.');
    }

    report('checking', 5, 'Preparing release rollback...');
    await patchUpdateState({
      phase: 'rollback_started',
      previousRelease: currentTarget,
      targetRelease: rollbackTarget,
      activeRelease: currentTarget,
      finishedAt: undefined,
      error: undefined,
    });

    report('extracting', 60, 'Activating previous release...');
    await switchCurrentReleaseToTarget(layout, rollbackTarget);

    report('complete', 100, 'Rollback complete! Restarting...');
    await patchUpdateState({
      phase: 'rolled_back',
      previousRelease: currentTarget,
      targetRelease: rollbackTarget,
      activeRelease: rollbackTarget,
      finishedAt: new Date().toISOString(),
      error: undefined,
    });

    report('restarting', 100, 'Restarting application...');
    await releaseUpdateLock();
    await restartApplication();

    return { fromRelease: currentTarget, toRelease: rollbackTarget };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    report('error', 0, 'Release rollback failed', errorMessage);
    await patchUpdateState({
      phase: 'error',
      error: errorMessage,
      finishedAt: new Date().toISOString(),
    });
    await releaseUpdateLock();
    throw error;
  }
}

/**
 * Cleanup temp files
 */
async function cleanup(layout: InstallLayout): Promise<void> {
  await fs.rm(layout.tempDir, { recursive: true, force: true });
}

/**
 * Restart the application
 */
async function restartApplication(): Promise<void> {
  // This depends on how the app is run
  // For PM2:
  try {
    await runUpdateCommand('pm2 restart seqdesk');
    return;
  } catch {
    // Not running under PM2
  }

  // For systemd user service (no sudo required):
  try {
    await runUpdateCommand('systemctl --user restart seqdesk');
    return;
  } catch {
    // Not running as a user service
  }

  // For systemd system service.
  // Use non-interactive sudo to avoid hanging on password prompts during updates.
  try {
    await runUpdateCommand('sudo -n systemctl restart seqdesk');
    return;
  } catch {
    // Not running under systemd or sudo requires a password
  }

  // Fallback: Exit with non-zero so process managers configured with
  // Restart=on-failure can relaunch us.
  console.log(
    'Update complete. Automatic restart command unavailable. Exiting for supervisor restart; if SeqDesk does not come back, restart it manually.'
  );
  process.exit(1);
}
