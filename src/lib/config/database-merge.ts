/**
 * Database Configuration Merge
 *
 * Merges file/env config with database settings.
 * Database settings have lowest priority but are UI-editable.
 */

import { db } from '@/lib/db';
import { loadConfig, clearConfigCache } from './loader';
import type { SeqDeskConfig, ResolvedConfig, ConfigSource } from './types';

/**
 * Load settings from database and merge with file config
 */
export async function mergeWithDatabase(): Promise<ResolvedConfig> {
  const fileConfig = loadConfig();

  try {
    const siteSettings = await db.siteSettings.findFirst();
    if (!siteSettings) {
      return fileConfig;
    }

    // Parse extraSettings JSON
    const extraSettings = siteSettings.extraSettings
      ? JSON.parse(siteSettings.extraSettings)
      : {};

    // Build database config
    const dbConfig: SeqDeskConfig = {
      site: {
        name: siteSettings.siteName || undefined,
        dataBasePath: siteSettings.dataBasePath || undefined,
        contactEmail: siteSettings.contactEmail || undefined,
      },
      pipelines: extraSettings.pipelines || undefined,
      ena: {
        testMode: siteSettings.enaTestMode ?? undefined,
        username: siteSettings.enaUsername || undefined,
        password: siteSettings.enaPassword || undefined,
        centerName: extraSettings.ena?.centerName || undefined,
      },
      sequencingFiles: extraSettings.sequencingFiles || undefined,
      auth: {
        allowRegistration: extraSettings.auth?.allowRegistration ?? undefined,
      },
    };

    // Merge: file config takes priority over database
    // But we track database values as the source for unchanged values
    const mergedConfig = deepMergeWithTracking(
      dbConfig,
      fileConfig.config,
      fileConfig.sources
    );

    return {
      config: mergedConfig.config,
      sources: mergedConfig.sources,
      filePath: fileConfig.filePath,
      loadedAt: new Date(),
    };
  } catch (error) {
    console.warn('Could not load database settings:', error);
    return fileConfig;
  }
}

/**
 * Deep merge with source tracking
 * Source priorities: env > file > database
 */
function deepMergeWithTracking(
  dbConfig: SeqDeskConfig,
  fileConfig: SeqDeskConfig,
  fileSources: Record<string, ConfigSource>
): { config: SeqDeskConfig; sources: Record<string, ConfigSource> } {
  const sources: Record<string, ConfigSource> = { ...fileSources };

  function merge(
    db: Record<string, unknown>,
    file: Record<string, unknown>,
    path: string = ''
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    // Get all keys from both objects
    const allKeys = new Set([...Object.keys(db), ...Object.keys(file)]);

    for (const key of allKeys) {
      const fullPath = path ? `${path}.${key}` : key;
      const dbValue = db[key];
      const fileValue = file[key];
      const existingSource = fileSources[fullPath];

      // If file/env has a value with higher priority, use it
      if (existingSource === 'env' || existingSource === 'file') {
        result[key] = fileValue;
      }
      // If both are objects, recurse
      else if (
        dbValue &&
        fileValue &&
        typeof dbValue === 'object' &&
        typeof fileValue === 'object' &&
        !Array.isArray(dbValue) &&
        !Array.isArray(fileValue)
      ) {
        result[key] = merge(
          dbValue as Record<string, unknown>,
          fileValue as Record<string, unknown>,
          fullPath
        );
      }
      // If value only comes from defaults, database should override defaults
      else if (existingSource === 'default' && dbValue !== undefined) {
        result[key] = dbValue;
        sources[fullPath] = 'database';
      }
      // Prefer file value, fall back to database
      else if (fileValue !== undefined) {
        result[key] = fileValue;
      } else if (dbValue !== undefined) {
        result[key] = dbValue;
        sources[fullPath] = 'database';
      }
    }

    return result;
  }

  const mergedConfig = merge(
    dbConfig as Record<string, unknown>,
    fileConfig as Record<string, unknown>
  );

  return {
    config: mergedConfig as SeqDeskConfig,
    sources,
  };
}

/**
 * Get effective configuration (file + database merged)
 * This is the main function to use in the application
 */
export async function getEffectiveConfig(): Promise<ResolvedConfig> {
  return mergeWithDatabase();
}

/**
 * Save configuration changes to database
 * Only saves values that are different from file config
 */
export async function saveConfigToDatabase(
  updates: Partial<SeqDeskConfig>
): Promise<void> {
  const siteSettings = await db.siteSettings.findFirst();

  if (!siteSettings) {
    throw new Error('Site settings not initialized');
  }

  // Parse existing extraSettings
  const extraSettings = siteSettings.extraSettings
    ? JSON.parse(siteSettings.extraSettings)
    : {};

  // Build update object
  const updateData: Record<string, unknown> = {};

  // Site settings
  if (updates.site?.name !== undefined) {
    updateData.siteName = updates.site.name;
  }
  if (updates.site?.dataBasePath !== undefined) {
    updateData.dataBasePath = updates.site.dataBasePath;
  }
  if (updates.site?.contactEmail !== undefined) {
    updateData.contactEmail = updates.site.contactEmail;
  }

  // ENA settings
  if (updates.ena?.testMode !== undefined) {
    updateData.enaTestMode = updates.ena.testMode;
  }
  if (updates.ena?.username !== undefined) {
    updateData.enaUsername = updates.ena.username;
  }
  if (updates.ena?.password !== undefined) {
    updateData.enaPassword = updates.ena.password;
  }

  // Auth settings
  if (updates.auth?.allowRegistration !== undefined) {
    extraSettings.auth = {
      ...extraSettings.auth,
      allowRegistration: updates.auth.allowRegistration,
    };
  }

  // Pipeline settings go into extraSettings
  if (updates.pipelines) {
    extraSettings.pipelines = {
      ...extraSettings.pipelines,
      ...updates.pipelines,
    };
  }

  // Sequencing files settings go into extraSettings
  if (updates.sequencingFiles) {
    extraSettings.sequencingFiles = {
      ...extraSettings.sequencingFiles,
      ...updates.sequencingFiles,
    };
  }

  // ENA center name goes into extraSettings
  if (updates.ena?.centerName !== undefined) {
    extraSettings.ena = {
      ...extraSettings.ena,
      centerName: updates.ena.centerName,
    };
  }

  updateData.extraSettings = JSON.stringify(extraSettings);

  // Update database
  await db.siteSettings.update({
    where: { id: siteSettings.id },
    data: updateData,
  });

  // Clear cache so next load picks up changes
  clearConfigCache();
}

/**
 * Get configuration for a specific section
 */
export async function getConfigSection<K extends keyof SeqDeskConfig>(
  section: K
): Promise<SeqDeskConfig[K]> {
  const config = await getEffectiveConfig();
  return config.config[section];
}
