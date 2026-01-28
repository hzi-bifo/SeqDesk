/**
 * SeqDesk Auto-Update System
 *
 * Checks seqdesk.com for updates and can self-update.
 *
 * Usage:
 *   import { checkForUpdates, installUpdate } from '@/lib/updater';
 *
 *   // Check for updates
 *   const result = await checkForUpdates();
 *   if (result.updateAvailable) {
 *     console.log(`Update available: ${result.latest.version}`);
 *   }
 *
 *   // Install update
 *   await installUpdate(result.latest, (progress) => {
 *     console.log(`${progress.status}: ${progress.message}`);
 *   });
 */

export * from './types';
export { checkForUpdates, getCurrentVersion, clearUpdateCache } from './checker';
export { installUpdate } from './installer';
