// Types for the MIxS (Minimum Information about any (x) Sequence) checklist
// registry. Checklist definitions originate from ENA/GSC and are curated and
// versioned upstream (seqdesk.com /api/registry/mixs). A SeqDesk instance can
// pull updates via the admin "MIxS Checklists" page; the synced config is
// stored in SiteSettings.extraSettings and falls back to the JSON files
// committed under data/field-templates/mixs-full.

export interface MixsFieldOption {
  value: string;
  label: string;
}

export interface MixsFieldUnit {
  value: string;
  label: string;
}

export interface MixsField {
  type: string;
  label: string;
  name: string;
  required: boolean;
  visible: boolean;
  helpText?: string;
  placeholder?: string;
  example?: string;
  group?: string;
  options?: MixsFieldOption[];
  units?: MixsFieldUnit[];
  simpleValidation?: {
    pattern?: string;
    patternMessage?: string;
  };
  aiValidation?: {
    enabled: boolean;
    prompt: string;
    strictness?: string;
  };
}

export interface MixsChecklist {
  name: string;
  description: string;
  version: string;
  source: string;
  category: string;
  accession: string;
  fields: MixsField[];
  /** Whether this checklist is offered in forms. Defaults to true. */
  available?: boolean;
  /** Set when an admin has hand-edited this checklist; protects it from being
   *  overwritten on sync. */
  localOverrides?: boolean;
  /** Set when the checklist was removed upstream but is retained so studies
   *  that reference it keep working. */
  deprecated?: boolean;
}

/** Lightweight summary returned by the checklist index endpoint. */
export interface MixsChecklistSummary {
  name: string;
  file?: string;
  accession?: string;
  description?: string;
  fieldCount: number;
  mandatoryCount: number;
  deprecated?: boolean;
}

/**
 * The synced/active MIxS configuration stored under
 * SiteSettings.extraSettings[MIXS_SETTINGS_KEY].
 */
export interface MixsConfig {
  /** Monotonic registry version. New studies pin this value. */
  version: number;
  /** Date string from the upstream registry (informational). */
  lastUpdated?: string;
  /** ISO timestamp of the last successful sync from the registry. */
  lastSyncedAt?: string;
  /** Registry URL this config was/will be synced from. */
  syncUrl?: string;
  /** Active checklists offered to users. */
  checklists: MixsChecklist[];
  /** Checklists removed upstream but kept so existing studies still resolve. */
  deprecated?: MixsChecklist[];
}

/**
 * Per-version snapshots of the active checklists, stored separately
 * (SiteSettings.extraSettings[MIXS_SNAPSHOTS_KEY]) so the hot read path never
 * pulls historical field definitions. Keyed by version number (as a string).
 * Used to render/validate studies pinned to an older mixsVersion.
 */
export type MixsSnapshots = Record<string, MixsChecklist[]>;

/** SiteSettings.extraSettings key for the active MIxS config. */
export const MIXS_SETTINGS_KEY = "mixsChecklistsConfig";
/** SiteSettings.extraSettings key for historical checklist snapshots. */
export const MIXS_SNAPSHOTS_KEY = "mixsChecklistsSnapshots";
/** How many historical version snapshots to retain. */
export const MIXS_SNAPSHOT_LIMIT = 5;
