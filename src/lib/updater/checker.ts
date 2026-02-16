/**
 * Update Checker
 *
 * Checks seqdesk.com for new versions.
 */

import type { UpdateCheckResult, ReleaseInfo } from './types';
import fs from 'fs';
import fsPromises from 'fs/promises';
import path from 'path';

// Read current version from package.json
function readVersionFromPackageJson(): string {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    return pkg.version || '0.0.0';
  } catch {
    return '0.0.0';
  }
}

// Update server URL
const UPDATE_SERVER = process.env.SEQDESK_UPDATE_SERVER || 'https://seqdesk.com';

// Cache update check for 1 hour
let cachedResult: UpdateCheckResult | null = null;
let cacheTime = 0;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

/**
 * Check for updates
 */
export async function checkForUpdates(force = false): Promise<UpdateCheckResult> {
  const currentVersion = getCurrentVersion();

  // Return cached result if still valid
  if (
    !force &&
    cachedResult &&
    cachedResult.currentVersion === currentVersion &&
    Date.now() - cacheTime < CACHE_TTL
  ) {
    return cachedResult;
  }

  try {
    const response = await fetch(
      `${UPDATE_SERVER}/api/version?current=${currentVersion}&channel=stable`,
      {
        headers: {
          'User-Agent': `SeqDesk/${currentVersion}`,
        },
        // Timeout after 10 seconds
        signal: AbortSignal.timeout(10000),
      }
    );

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const data = await response.json();

    const result: UpdateCheckResult = {
      updateAvailable: data.updateAvailable || false,
      currentVersion: currentVersion,
      latest: data.latest as ReleaseInfo,
    };

    // Cache the result
    cachedResult = result;
    cacheTime = Date.now();

    return result;
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';

    return {
      updateAvailable: false,
      currentVersion: currentVersion,
      latest: null,
      error: `Failed to check for updates: ${errorMessage}`,
    };
  }
}

/**
 * Get current version
 */
export function getCurrentVersion(): string {
  return readVersionFromPackageJson();
}

/**
 * Get installed version from disk (not cached).
 */
export async function getInstalledVersion(): Promise<string> {
  try {
    const pkgPath = path.join(process.cwd(), 'package.json');
    const pkg = JSON.parse(await fsPromises.readFile(pkgPath, 'utf-8'));
    return pkg.version || getCurrentVersion();
  } catch {
    return getCurrentVersion();
  }
}

/**
 * Clear update cache
 */
export function clearUpdateCache(): void {
  cachedResult = null;
  cacheTime = 0;
}
