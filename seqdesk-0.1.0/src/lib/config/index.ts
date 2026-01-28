/**
 * SeqDesk Configuration System
 *
 * Configuration sources (in priority order):
 * 1. Environment variables (SEQDESK_*)
 * 2. Config file (seqdesk.config.json)
 * 3. Database settings (UI-editable)
 * 4. Default values
 *
 * Usage:
 *   import { getConfig, getConfigValue } from '@/lib/config';
 *
 *   // Get full config
 *   const config = getConfig();
 *
 *   // Get specific value with source tracking
 *   const { value, source } = getConfigValue('pipelines.enabled');
 */

export * from './types';
export * from './loader';
export { mergeWithDatabase, getEffectiveConfig } from './database-merge';
