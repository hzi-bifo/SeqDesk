/**
 * Update Installer
 *
 * Downloads and installs updates.
 * The update process:
 * 1. Download new version tarball
 * 2. Verify checksum
 * 3. Extract to temp directory
 * 4. Backup current installation
 * 5. Replace files
 * 6. Run migrations
 * 7. Restart application
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs/promises';
import { createReadStream } from 'fs';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import dotenv from 'dotenv';
import type { ReleaseInfo, UpdateProgress } from './types';
import { releaseUpdateLock } from './status';

const execAsync = promisify(exec);

// Minimum required disk space in bytes (150MB)
const MIN_DISK_SPACE = 150 * 1024 * 1024;

// Progress callback type
type ProgressCallback = (progress: UpdateProgress) => void;

// Installation directory (where SeqDesk is installed)
const INSTALL_DIR = process.cwd();
const PRISMA_DIR = path.join(INSTALL_DIR, 'prisma');
const BACKUP_DIR = path.join(INSTALL_DIR, '.update-backup');
const TEMP_DIR = path.join(INSTALL_DIR, '.update-temp');
const DB_SIDECAR_SUFFIXES = ['-wal', '-shm', '-journal'];

function isTruthy(value?: string | null): boolean {
  if (!value) {
    return false;
  }
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
}

async function loadDatabaseUrl(): Promise<string | null> {
  if (process.env.DATABASE_URL) {
    return process.env.DATABASE_URL;
  }

  try {
    const envPath = path.join(INSTALL_DIR, '.env');
    const envContents = await fs.readFile(envPath, 'utf-8');
    const parsed = dotenv.parse(envContents);
    return parsed.DATABASE_URL ?? null;
  } catch {
    // Fall through to runtime config file lookup.
  }

  try {
    const configPath = path.join(INSTALL_DIR, 'seqdesk.config.json');
    const configContents = await fs.readFile(configPath, 'utf-8');
    const parsed = JSON.parse(configContents) as { runtime?: { databaseUrl?: unknown } };
    const databaseUrl = parsed?.runtime?.databaseUrl;
    if (typeof databaseUrl === 'string' && databaseUrl.trim().length > 0) {
      return databaseUrl.trim();
    }
  } catch {
    // Ignore missing/invalid config and continue with null.
  }

  return null;
}

function resolveSqlitePath(databaseUrl: string): string | null {
  const trimmed = databaseUrl.trim();
  if (!trimmed.startsWith('file:')) {
    return null;
  }

  let pathPart = trimmed.slice('file:'.length);
  if (pathPart.startsWith('//')) {
    pathPart = pathPart.slice(2);
  }

  const rawPath = pathPart.split('?')[0] || '';
  if (!rawPath) {
    return null;
  }

  const decodedPath = decodeURIComponent(rawPath);
  if (path.isAbsolute(decodedPath)) {
    return decodedPath;
  }

  // Prisma resolves relative SQLite paths against the schema directory.
  // SeqDesk keeps schema.prisma in `<install>/prisma`.
  return path.resolve(PRISMA_DIR, decodedPath);
}

function relativeToInstall(filePath: string): string | null {
  const relative = path.relative(INSTALL_DIR, filePath);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return relative;
}

async function getDatabaseFiles(): Promise<string[]> {
  const files = new Set<string>();
  // Primary Prisma default.
  files.add(path.join(PRISMA_DIR, 'dev.db'));
  // Legacy/alternate location used in some historical installs.
  files.add(path.join(INSTALL_DIR, 'dev.db'));

  const databaseUrl = await loadDatabaseUrl();
  if (databaseUrl) {
    const resolved = resolveSqlitePath(databaseUrl);
    if (resolved) {
      files.add(resolved);
    }
  }

  for (const basePath of Array.from(files)) {
    for (const suffix of DB_SIDECAR_SUFFIXES) {
      files.add(`${basePath}${suffix}`);
    }
  }

  return Array.from(files);
}

async function stripDatabaseFilesFromExtract(extractDir: string): Promise<void> {
  const databaseFiles = await getDatabaseFiles();

  await Promise.all(
    databaseFiles.map(async (dbPath) => {
      const relative = relativeToInstall(dbPath);
      if (!relative) {
        return;
      }

      const extractPath = path.join(extractDir, relative);
      await fs.rm(extractPath, { force: true });
    })
  );
}

async function shouldSkipMigrations(): Promise<boolean> {
  if (isTruthy(process.env.SEQDESK_SKIP_MIGRATIONS)) {
    return true;
  }

  const databaseUrl = await loadDatabaseUrl();
  const isSqlite = !databaseUrl || databaseUrl.trim().startsWith('file:');
  if (isSqlite && !isTruthy(process.env.SEQDESK_AUTO_MIGRATE)) {
    return true;
  }

  return false;
}

/**
 * Check available disk space
 */
async function checkDiskSpace(): Promise<{ free: number; required: number; sufficient: boolean }> {
  try {
    if (os.platform() === 'darwin' || os.platform() === 'linux') {
      const { stdout } = await execAsync(`df -k "${INSTALL_DIR}" | tail -1 | awk '{print $4}'`);
      const freeKB = parseInt(stdout.trim(), 10);
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
    onProgress?.({ status, progress, message, error });
  };

  try {
    // Step 0: Check disk space
    report('downloading', 5, 'Checking disk space...');
    const diskSpace = await checkDiskSpace();
    if (!diskSpace.sufficient) {
      const freeMB = Math.round(diskSpace.free / 1024 / 1024);
      const requiredMB = Math.round(diskSpace.required / 1024 / 1024);
      throw new Error(`Insufficient disk space: ${freeMB}MB free, ${requiredMB}MB required`);
    }

    // Step 1: Download
    report('downloading', 10, `Downloading SeqDesk ${release.version}...`);
    const tarballPath = await downloadRelease(release);

    // Step 2: Verify checksum
    report('downloading', 30, 'Verifying download...');
    await verifyChecksum(tarballPath, release.checksum);

    // Step 3: Extract to temp
    report('extracting', 40, 'Extracting update...');
    await extractRelease(tarballPath);

    // Step 4: Backup current
    report('extracting', 60, 'Creating backup...');
    await createBackup();

    // Step 5: Apply update
    report('extracting', 80, 'Applying update...');
    await applyUpdate();

    // Step 5b: Verify version
    report('extracting', 85, 'Verifying update...');
    await verifyInstalledVersion(release.version);

    // Step 6: Run migrations
    report('extracting', 90, 'Running database migrations...');
    await runMigrations();

    // Step 7: Cleanup
    report('complete', 100, 'Update complete! Restarting...');
    await cleanup();

    // Step 8: Restart
    report('restarting', 100, 'Restarting application...');
    await releaseUpdateLock();
    await restartApplication();

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    report('error', 0, 'Update failed', errorMessage);

    // Try to restore backup
    try {
      await restoreBackup();
    } catch {
      // Backup restore failed - manual intervention needed
    }

    await releaseUpdateLock();
    throw error;
  }
}

/**
 * Download the release tarball
 */
async function downloadRelease(release: ReleaseInfo): Promise<string> {
  const tarballPath = path.join(TEMP_DIR, `seqdesk-${release.version}.tar.gz`);

  // Create temp directory
  await fs.mkdir(TEMP_DIR, { recursive: true });

  // Download using curl (more reliable than fetch for large files)
  await execAsync(`curl -fsSL "${release.downloadUrl}" -o "${tarballPath}"`);

  return tarballPath;
}

/**
 * Verify the checksum of the downloaded file
 */
async function verifyChecksum(filePath: string, expectedChecksum: string): Promise<void> {
  if (!expectedChecksum || expectedChecksum === 'sha256:placeholder') {
    // Skip verification if no checksum provided
    return;
  }

  const [algorithm, hash] = expectedChecksum.split(':');
  if (algorithm !== 'sha256') {
    throw new Error(`Unsupported checksum algorithm: ${algorithm}`);
  }

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
async function extractRelease(tarballPath: string): Promise<void> {
  const extractDir = path.join(TEMP_DIR, 'extracted');
  await fs.mkdir(extractDir, { recursive: true });
  await execAsync(`tar -xzf "${tarballPath}" -C "${extractDir}" --strip-components=1`);
}

/**
 * Create a backup of the current installation
 */
async function createBackup(): Promise<void> {
  // Remove old backup if exists
  await fs.rm(BACKUP_DIR, { recursive: true, force: true });
  await fs.mkdir(BACKUP_DIR, { recursive: true });

  // Backup important directories
  const dirsToBackup = ['.next', 'node_modules', 'prisma', 'public'];

  for (const dir of dirsToBackup) {
    const srcPath = path.join(INSTALL_DIR, dir);
    const destPath = path.join(BACKUP_DIR, dir);

    try {
      await fs.access(srcPath);
      await execAsync(`cp -r "${srcPath}" "${destPath}"`);
    } catch {
      // Directory doesn't exist, skip
    }
  }

  // Backup key files
  const filesToBackup = ['package.json', '.env', 'seqdesk.config.json'];

  for (const file of filesToBackup) {
    const srcPath = path.join(INSTALL_DIR, file);
    const destPath = path.join(BACKUP_DIR, file);

    try {
      await fs.access(srcPath);
      await fs.copyFile(srcPath, destPath);
    } catch {
      // File doesn't exist, skip
    }
  }
}

/**
 * Apply the update
 */
async function applyUpdate(): Promise<void> {
  const extractDir = path.join(TEMP_DIR, 'extracted');

  // Copy new files, preserving .env and config
  const preserveFiles = ['.env', 'seqdesk.config.json'];

  // Backup preserved files
  const preserved: Record<string, Buffer> = {};
  for (const file of preserveFiles) {
    const filePath = path.join(INSTALL_DIR, file);
    try {
      preserved[file] = await fs.readFile(filePath);
    } catch {
      // File doesn't exist
    }
  }

  // Backup database files to a safe location (more robust than just stripping from extract)
  // This ensures we preserve the database even if the strip function fails
  const dbBackupDir = path.join(TEMP_DIR, 'db-backup');
  await fs.mkdir(dbBackupDir, { recursive: true });
  const databaseFiles = await getDatabaseFiles();
  const dbBackups: Array<{ original: string; backup: string }> = [];

  for (const dbPath of databaseFiles) {
    try {
      await fs.access(dbPath);
      const relative = relativeToInstall(dbPath);
      const backupPath = relative
        ? path.join(dbBackupDir, relative)
        : path.join(
            dbBackupDir,
            `${crypto.createHash('sha1').update(dbPath).digest('hex')}-${path.basename(dbPath)}`
          );
      await fs.mkdir(path.dirname(backupPath), { recursive: true });
      await fs.copyFile(dbPath, backupPath);
      dbBackups.push({ original: dbPath, backup: backupPath });
    } catch {
      // File doesn't exist, skip
    }
  }

  await stripDatabaseFilesFromExtract(extractDir);

  // Copy new files
  await execAsync(`cp -R "${extractDir}/." "${INSTALL_DIR}/"`);

  // Restore preserved files
  for (const [file, content] of Object.entries(preserved)) {
    await fs.writeFile(path.join(INSTALL_DIR, file), content);
  }

  // Restore database files from backup
  for (const { original, backup } of dbBackups) {
    try {
      await fs.copyFile(backup, original);
    } catch {
      // Backup restore failed - this is critical
      console.error(`Failed to restore database file: ${original}`);
    }
  }
}

async function verifyInstalledVersion(expectedVersion: string): Promise<void> {
  try {
    const pkgPath = path.join(INSTALL_DIR, 'package.json');
    const pkg = JSON.parse(await fs.readFile(pkgPath, 'utf-8'));
    if (pkg.version !== expectedVersion) {
      throw new Error(`Expected ${expectedVersion}, found ${pkg.version || 'unknown'}`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Installed version check failed: ${message}`);
  }
}

/**
 * Run database migrations
 */
async function runMigrations(): Promise<void> {
  try {
    if (await shouldSkipMigrations()) {
      return;
    }
    await execAsync('npx prisma db push --skip-generate', { cwd: INSTALL_DIR });
  } catch {
    // Migration might fail if no changes - that's OK
  }
}

/**
 * Restore from backup
 */
async function restoreBackup(): Promise<void> {
  // This is a simplified restore - in production you'd want more robust logic
  await execAsync(`cp -r "${BACKUP_DIR}/"* "${INSTALL_DIR}/"`);
}

/**
 * Cleanup temp files
 */
async function cleanup(): Promise<void> {
  await fs.rm(TEMP_DIR, { recursive: true, force: true });
  // Keep backup for a while in case of issues
}

/**
 * Restart the application
 */
async function restartApplication(): Promise<void> {
  // This depends on how the app is run
  // For PM2:
  try {
    await execAsync('pm2 restart seqdesk');
    return;
  } catch {
    // Not running under PM2
  }

  // For systemd user service (no sudo required):
  try {
    await execAsync('systemctl --user restart seqdesk');
    return;
  } catch {
    // Not running as a user service
  }

  // For systemd system service.
  // Use non-interactive sudo to avoid hanging on password prompts during updates.
  try {
    await execAsync('sudo -n systemctl restart seqdesk');
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
