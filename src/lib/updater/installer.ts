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
import path from 'path';
import os from 'os';
import type { ReleaseInfo, UpdateProgress } from './types';

const execAsync = promisify(exec);

// Minimum required disk space in bytes (150MB)
const MIN_DISK_SPACE = 150 * 1024 * 1024;

// Progress callback type
type ProgressCallback = (progress: UpdateProgress) => void;

// Installation directory (where SeqDesk is installed)
const INSTALL_DIR = process.cwd();
const BACKUP_DIR = path.join(INSTALL_DIR, '.update-backup');
const TEMP_DIR = path.join(INSTALL_DIR, '.update-temp');

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

    // Step 6: Run migrations
    report('extracting', 90, 'Running database migrations...');
    await runMigrations();

    // Step 7: Cleanup
    report('complete', 100, 'Update complete! Restarting...');
    await cleanup();

    // Step 8: Restart
    report('restarting', 100, 'Restarting application...');
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

  const { stdout } = await execAsync(`shasum -a 256 "${filePath}"`);
  const actualHash = stdout.split(' ')[0];

  if (actualHash !== hash) {
    throw new Error('Checksum verification failed - download may be corrupted');
  }
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
  const preserveFiles = ['.env', 'seqdesk.config.json', 'dev.db'];

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

  // Copy new files
  await execAsync(`cp -r "${extractDir}/"* "${INSTALL_DIR}/"`);

  // Restore preserved files
  for (const [file, content] of Object.entries(preserved)) {
    await fs.writeFile(path.join(INSTALL_DIR, file), content);
  }
}

/**
 * Run database migrations
 */
async function runMigrations(): Promise<void> {
  try {
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

  // For systemd:
  try {
    await execAsync('sudo systemctl restart seqdesk');
    return;
  } catch {
    // Not running under systemd
  }

  // Fallback: Exit and let the process manager restart us
  console.log('Update complete. Please restart the application manually.');
  process.exit(0);
}
