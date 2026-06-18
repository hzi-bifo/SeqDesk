import fs from "fs/promises";
import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { encryptSecret } from "@/lib/security/secret-store";
import {
  DEFAULT_EXECUTION_SETTINGS,
  normalizePipelineExecutionOverrides,
  type PipelineExecutionOverride,
  type ExecutionSettings,
} from "@/lib/pipelines/execution-settings";
import { normalizeStudyFormSchema } from "@/lib/studies/fixed-sections";
import {
  ORDER_FORM_DEFAULTS_VERSION,
  STUDY_FORM_DEFAULTS_VERSION,
} from "@/lib/modules/default-form-fields";
import { buildOrderFormConfigSchema } from "@/lib/forms/order-form-schema.mjs";
import type { FormFieldDefinition, FormFieldGroup } from "@/types/form-config";

type JsonRecord = Record<string, unknown>;

interface InfrastructureImportRequest {
  config?: unknown;
  dryRun?: boolean;
}

interface InfrastructureImportValues {
  dataBasePath?: string;
  pipelineRunDir?: string;
  useSlurm?: boolean;
  slurmQueue?: string;
  slurmCores?: number;
  slurmMemory?: string;
  slurmTimeLimit?: number;
  slurmOptions?: string;
  condaPath?: string;
  condaEnv?: string;
  nextflowProfile?: string;
  weblogUrl?: string;
  weblogSecret?: string;
  pipelineOverrides?: Record<string, PipelineExecutionOverride>;
  port?: number;
}

// Install-only path-string / preset FORM presets the in-app importer cannot apply
// (they are installer-only filesystem PATHS, not embedded form definitions). These
// are warned/rejected. The EMBEDDED objects forms.order / forms.study /
// forms.runAssignment are NOT in this list — Phase 4 CONSUMES + projects them, so
// the bare "forms" key is intentionally absent here (its presence over-fired the
// warning for any settings.json carrying a forms blob).
const FORM_CONFIG_KEYS = [
  "orderFormSettings",
  "order_form_settings",
  "studyFormSettings",
  "study_form_settings",
  "orderFormConfig",
  "studyFormConfig",
  "orderForm",
  "studyForm",
];

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toRecord(value: unknown): JsonRecord | undefined {
  return isRecord(value) ? value : undefined;
}

function firstDefined(...values: unknown[]): unknown {
  for (const value of values) {
    if (value !== undefined) {
      return value;
    }
  }
  return undefined;
}

function toOptionalString(value: unknown): string | undefined {
  if (typeof value !== "string") {
    return undefined;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function firstOptionalString(...values: unknown[]): string | undefined {
  for (const value of values) {
    const normalized = toOptionalString(value);
    if (normalized !== undefined) {
      return normalized;
    }
  }
  return undefined;
}

function toOptionalBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "number") {
    if (value === 1) return true;
    if (value === 0) return false;
    return undefined;
  }
  if (typeof value !== "string") {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1", "on"].includes(normalized)) {
    return true;
  }
  if (["false", "no", "n", "0", "off"].includes(normalized)) {
    return false;
  }
  return undefined;
}

function toOptionalInt(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string" && value.trim().length > 0) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }
  return undefined;
}

function normalizeExecutionMode(value: unknown): string | undefined {
  const mode = toOptionalString(value)?.toLowerCase();
  if (mode === "inherit" || mode === "local" || mode === "slurm") {
    return mode;
  }
  return undefined;
}

function parsePipelineExecutionOverride(value: unknown): JsonRecord | undefined {
  const source = toRecord(value);
  if (!source) {
    return undefined;
  }

  const slurm = toRecord(source.slurm);
  const nextSlurm: JsonRecord = {};
  const mode = normalizeExecutionMode(source.mode);
  const queue = toOptionalString(firstDefined(source.slurmQueue, slurm?.queue));
  const cores = toOptionalInt(firstDefined(source.slurmCores, slurm?.cores));
  const memory = toOptionalString(firstDefined(source.slurmMemory, slurm?.memory));
  const timeLimit = toOptionalInt(firstDefined(source.slurmTimeLimit, slurm?.timeLimit));
  const options = toOptionalString(
    firstDefined(
      source.slurmOptions,
      source.clusterOptions,
      slurm?.options,
      slurm?.clusterOptions
    )
  );
  const nextflowProfile = toOptionalString(source.nextflowProfile);

  if (queue) nextSlurm.queue = queue;
  if (cores !== undefined && cores > 0) nextSlurm.cores = cores;
  if (memory) nextSlurm.memory = memory;
  if (timeLimit !== undefined && timeLimit > 0) nextSlurm.timeLimit = timeLimit;
  if (options !== undefined) nextSlurm.options = options;

  const override: JsonRecord = {};
  if (mode) override.mode = mode;
  if (Object.keys(nextSlurm).length > 0) override.slurm = nextSlurm;
  if (nextflowProfile) override.nextflowProfile = nextflowProfile;

  return Object.keys(override).length > 0 ? override : undefined;
}

function parsePipelineExecutionOverrides(config: unknown): Record<string, PipelineExecutionOverride> {
  const root = toRecord(config);
  const pipelines = toRecord(root?.pipelines);
  const execution = toRecord(pipelines?.execution);
  const rawOverrides: Record<string, unknown> = {};
  const candidateMaps = [
    toRecord(pipelines?.pipelineOverrides),
    toRecord(pipelines?.executionOverrides),
    toRecord(execution?.pipelineOverrides),
    toRecord(execution?.overrides),
  ];

  for (const candidate of candidateMaps) {
    if (!candidate) continue;
    for (const [pipelineId, rawOverride] of Object.entries(candidate)) {
      const id = pipelineId.trim();
      const override = parsePipelineExecutionOverride(rawOverride);
      if (id && override) {
        rawOverrides[id] = {
          ...(toRecord(rawOverrides[id]) || {}),
          ...override,
          slurm: {
            ...(toRecord(toRecord(rawOverrides[id])?.slurm) || {}),
            ...(toRecord(override.slurm) || {}),
          },
        };
      }
    }
  }

  if (pipelines) {
    for (const [pipelineId, rawPipelineConfig] of Object.entries(pipelines)) {
      const id = pipelineId.trim();
      const pipelineConfig = toRecord(rawPipelineConfig);
      if (!id || !pipelineConfig) continue;
      const override =
        parsePipelineExecutionOverride(pipelineConfig.execution) ||
        parsePipelineExecutionOverride(pipelineConfig.runtime);
      if (override) {
        rawOverrides[id] = {
          ...(toRecord(rawOverrides[id]) || {}),
          ...override,
          slurm: {
            ...(toRecord(toRecord(rawOverrides[id])?.slurm) || {}),
            ...(toRecord(override.slurm) || {}),
          },
        };
      }
    }
  }

  return normalizePipelineExecutionOverrides(rawOverrides);
}

function hasFormConfigKeys(config: unknown): boolean {
  const root = toRecord(config);
  if (!root) {
    return false;
  }

  if (FORM_CONFIG_KEYS.some((key) => root[key] !== undefined)) {
    return true;
  }

  // Only the PATH-STRING preset variants under `forms` still warn/reject — the
  // embedded objects forms.order / forms.study / forms.runAssignment are CONSUMED
  // (projected to OrderFormConfig + extraSettings), so they are intentionally not
  // listed here.
  const forms = toRecord(root.forms);
  return Boolean(
    forms &&
      [
        "orderFormSettings",
        "order_form_settings",
        "studyFormSettings",
        "study_form_settings",
      ].some((key) => forms[key] !== undefined)
  );
}

function getFormConfigWarnings(config: unknown): string[] {
  if (!hasFormConfigKeys(config)) {
    return [];
  }

  return [
    "Sequencing Order and study form settings were detected but were not imported here. Use the Sequencing Order Form or Study Form Import / Export tabs for full form definitions; installer-only form preset paths are ignored by this in-app infrastructure import.",
  ];
}

function toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const result: string[] = [];
  for (const item of value) {
    const str = toOptionalString(item);
    if (str) {
      result.push(str);
    }
  }
  return result;
}

// Install-only / secret / not-in-app blocks the in-app importer must NEVER apply
// but must SURFACE (so importing the same WEB profile here does not silently keep
// secrets or pretend to apply installer-only state). These mirror the
// "install-only" + "secret" dispositions in src/lib/install-profile/coverage.ts.
const INSTALL_ONLY_PROFILE_KEYS = [
  "nextAuthSecret",
  "anthropicApiKey",
  "adminSecret",
  "databaseUrl",
  "directUrl",
  "bootstrap",
] as const;

// Column writes the importer must add to the SiteSettings.upsert update payload
// (the same columns the per-section settings UI + installer apply-core write to).
// NOTE: enaPasswordPlain carries the RAW password as parsed from the profile. It is
// deliberately NOT encrypted in parseProfileBlocks so the dry-run preview is fully
// side-effect-free (encryptSecret needs key material and would otherwise throw on
// a preview where NEXTAUTH_SECRET/SEQDESK_ENCRYPTION_KEY is absent). The POST
// handler encrypts it via encryptSecret ONLY on a real save (audit A15).
interface ProfileColumnWrites {
  postSubmissionInstructions?: string;
  enaTestMode?: boolean;
  enaUsername?: string;
  enaPasswordPlain?: string;
  modulesConfig?: string;
  siteName?: string;
  contactEmail?: string;
}

interface ProfileBlockResult {
  // Surfaced in the response `applied` map (keyed by block name so F10 sees them).
  applied: Record<string, unknown>;
  // Warnings naming install-only / secret / unapplied blocks.
  warnings: string[];
  // Mutates the live extraSettings record in place (shallow-merge over siblings).
  applyExtraSettings: (extra: JsonRecord) => void;
  // Column writes folded into updateData (and the create payload) on real saves.
  columnWrites: ProfileColumnWrites;
  // Allowlist applied to extraSettings.installProfilePipelineAllowlist.
  pipelineAllowlist?: string[];
  // pipelines.databaseDirectory -> pipelineExecution.pipelineDatabaseDir.
  pipelineDatabaseDir?: string;
  // Raw forms.order blob ({fields, groups, enabledMixsChecklists, defaultsVersion})
  // parsed from settings.json. The POST handler manage-merges this over the EXISTING
  // OrderFormConfig.schema via the shared buildOrderFormConfigSchema (the SAME builder
  // the installer's applyOrderForm uses), then writes db.orderFormConfig.upsert (the
  // SAME store the in-app GET /api/admin/form-config reader uses). The order form must
  // KEEP landing in OrderFormConfig (NOT extraSettings) because the app's order-form
  // READ path uses OrderFormConfig. Carrying the raw blob (not a pre-built schema) lets
  // the merge run against the live existing schema so import == install.
  orderForm?: {
    fields: FormFieldDefinition[];
    groups: FormFieldGroup[];
    enabledMixsChecklists: string[];
    defaultsVersion: number;
  };
  // True when any block contributed a value (folds into hasAnyValue detection).
  hasAnyBlock: boolean;
}

// Read a single embedded form blob (forms.order / forms.study / forms.runAssignment)
// into the {groups, fields, enabledMixsChecklists, defaultsVersion} shape the
// installer's readFormConfig consumes (scripts/lib/install-profile-apply-core.mjs).
interface EmbeddedFormBlob {
  fields: FormFieldDefinition[];
  groups: FormFieldGroup[];
  enabledMixsChecklists: string[];
  defaultsVersion?: number;
}

function readEmbeddedFormBlob(
  value: unknown,
  { allowMixsOnly = false }: { allowMixsOnly?: boolean } = {}
): EmbeddedFormBlob | undefined {
  const form = toRecord(value);
  if (!form) {
    return undefined;
  }
  const fields = Array.isArray(form.fields)
    ? (form.fields as FormFieldDefinition[])
    : [];
  const groups = Array.isArray(form.groups)
    ? (form.groups as FormFieldGroup[])
    : [];
  const enabledMixsChecklists = toStringArray(form.enabledMixsChecklists);
  // Mirror the installer's readFormConfig + toOptionalInt: a non-positive
  // defaultsVersion is dropped to undefined so the caller's `?? DEFAULT`
  // substitutes the canonical default. The installer's toOptionalInt has a
  // `> 0` guard; without matching it here the importer would persist
  // moduleDefaultsVersion: 0 where the installer writes the default (4).
  const parsedDefaultsVersion = toOptionalInt(form.defaultsVersion);
  const defaultsVersion =
    parsedDefaultsVersion !== undefined && parsedDefaultsVersion > 0
      ? parsedDefaultsVersion
      : undefined;
  // Treat as populated when it carries fields or groups. The ORDER form is ALSO
  // populated by enabledMixsChecklists alone (allowMixsOnly), so a MIxS-only
  // forms.order is consumed by the importer exactly like the installer's
  // applyOrderForm, whose gate proceeds on enabledMixsChecklists.length > 0.
  // Study/runAssignment keep the fields-or-groups requirement: their consumers
  // OVERWRITE (normalizeStudyFormSchema), so admitting a MIxS-only blob there
  // would destructively blank an existing study/run-assignment form.
  const hasShape =
    fields.length > 0 ||
    groups.length > 0 ||
    (allowMixsOnly && enabledMixsChecklists.length > 0);
  if (!hasShape) {
    return undefined;
  }
  return { fields, groups, enabledMixsChecklists, defaultsVersion };
}

function mergeObjectBlock(
  extra: JsonRecord,
  key: string,
  incoming: JsonRecord
): void {
  const current = toRecord(extra[key]) || {};
  extra[key] = { ...current, ...incoming };
}

// Merge incoming module flags over the existing SiteSettings.modulesConfig column
// (the same {modules,globalDisabled} envelope the installer apply-core writes).
function mergeModulesConfigColumn(
  existingRaw: string | null | undefined,
  incomingRaw: string
): string {
  let existingModules: Record<string, unknown> = {};
  let globalDisabled = false;
  if (existingRaw) {
    const parsed = toRecord(JSON.parse(safeJson(existingRaw)));
    if (parsed) {
      const nested = toRecord(parsed.modules);
      existingModules = nested ?? parsed;
      globalDisabled = parsed.globalDisabled === true;
    }
  }
  const incoming = toRecord(JSON.parse(incomingRaw));
  const incomingModules = toRecord(incoming?.modules) ?? {};
  return JSON.stringify({
    modules: { ...existingModules, ...incomingModules },
    globalDisabled,
  });
}

function safeJson(raw: string): string {
  try {
    JSON.parse(raw);
    return raw;
  } catch {
    return "{}";
  }
}

// Parse every non-infrastructure block of a WEB profile JSON into the SAME sinks
// the install-time apply-core + per-section settings UI use. Runs identically for
// dryRun (populating `applied`/`warnings`) and real saves (mutating extraSettings
// + column writes), so importing a WEB profile in-app matches the installer.
function parseProfileBlocks(config: unknown): ProfileBlockResult {
  const result: ProfileBlockResult = {
    applied: {},
    warnings: [],
    applyExtraSettings: () => {},
    columnWrites: {},
    hasAnyBlock: false,
  };

  const root = toRecord(config);
  if (!root) {
    return result;
  }

  const extraMutators: Array<(extra: JsonRecord) => void> = [];

  // --- access -> extraSettings keys (+ postSubmissionInstructions column) ---
  const access = toRecord(root.access);
  if (access) {
    const accessExtra: JsonRecord = {};
    const departmentSharing = toOptionalBoolean(access.departmentSharing);
    const allowDeleteSubmittedOrders = toOptionalBoolean(
      access.allowDeleteSubmittedOrders
    );
    const allowUserAssemblyDownload = toOptionalBoolean(
      access.allowUserAssemblyDownload
    );
    const orderNotesEnabled = toOptionalBoolean(access.orderNotesEnabled);
    const postSubmissionInstructions =
      typeof access.postSubmissionInstructions === "string"
        ? access.postSubmissionInstructions
        : undefined;

    if (departmentSharing !== undefined) {
      accessExtra.departmentSharing = departmentSharing;
    }
    if (allowDeleteSubmittedOrders !== undefined) {
      accessExtra.allowDeleteSubmittedOrders = allowDeleteSubmittedOrders;
    }
    if (allowUserAssemblyDownload !== undefined) {
      accessExtra.allowUserAssemblyDownload = allowUserAssemblyDownload;
    }
    if (orderNotesEnabled !== undefined) {
      accessExtra.orderNotesEnabled = orderNotesEnabled;
    }

    if (Object.keys(accessExtra).length > 0) {
      result.hasAnyBlock = true;
      result.applied.access = accessExtra;
      extraMutators.push((extra) => {
        Object.assign(extra, accessExtra);
      });
    }
    if (postSubmissionInstructions !== undefined) {
      result.hasAnyBlock = true;
      result.columnWrites.postSubmissionInstructions = postSubmissionInstructions;
      if (!result.applied.access) {
        result.applied.access = { postSubmissionInstructions };
      } else {
        (result.applied.access as JsonRecord).postSubmissionInstructions =
          postSubmissionInstructions;
      }
    }
  }

  // --- auth.allowRegistration -> extraSettings.auth.allowRegistration ---
  const auth = toRecord(root.auth);
  if (auth) {
    const allowRegistration = toOptionalBoolean(auth.allowRegistration);
    if (allowRegistration !== undefined) {
      result.hasAnyBlock = true;
      result.applied.auth = { allowRegistration };
      extraMutators.push((extra) => {
        mergeObjectBlock(extra, "auth", { allowRegistration });
      });
    }
  }

  // --- ena: testMode/username/password columns; centerName/brokerAccount extra ---
  const ena = toRecord(root.ena);
  if (ena) {
    const enaTestMode = toOptionalBoolean(ena.testMode);
    const enaUsername = firstOptionalString(
      ena.username,
      ena.webinUsername,
      ena.enaUsername,
      ena.webin_username,
      ena.ena_username
    );
    const enaPassword = firstOptionalString(
      ena.password,
      ena.webinPassword,
      ena.enaPassword,
      ena.webin_password,
      ena.ena_password
    );
    const enaCenterName = toOptionalString(ena.centerName);
    const enaBrokerAccount = toOptionalBoolean(ena.brokerAccount);
    const appliedEna: JsonRecord = {};

    if (enaTestMode !== undefined) {
      result.columnWrites.enaTestMode = enaTestMode;
      appliedEna.testMode = enaTestMode;
    }
    if (enaUsername !== undefined) {
      result.columnWrites.enaUsername = enaUsername;
      appliedEna.username = enaUsername;
    }
    if (enaPassword !== undefined) {
      // Carry the RAW password here; the POST handler encrypts it (encryptSecret,
      // matching the in-app ENA save path + installer apply-core) ONLY on a real
      // save. Encrypting here would run on the dry-run preview too and throw when
      // key material is absent (audit A15). The preview surfaces a masked marker.
      result.columnWrites.enaPasswordPlain = enaPassword;
      appliedEna.password = "***";
    }
    const enaExtra: JsonRecord = {};
    if (enaCenterName !== undefined) {
      enaExtra.centerName = enaCenterName;
      appliedEna.centerName = enaCenterName;
    }
    if (enaBrokerAccount !== undefined) {
      enaExtra.brokerAccount = enaBrokerAccount;
      appliedEna.brokerAccount = enaBrokerAccount;
    }
    if (Object.keys(enaExtra).length > 0) {
      extraMutators.push((extra) => {
        mergeObjectBlock(extra, "ena", enaExtra);
      });
    }
    if (Object.keys(appliedEna).length > 0) {
      result.hasAnyBlock = true;
      result.applied.ena = appliedEna;
    }
  }

  // --- telemetry -> extraSettings.telemetry (shallow-merge) ---
  const telemetry = toRecord(root.telemetry);
  if (telemetry) {
    const telemetryEnabled = toOptionalBoolean(telemetry.enabled);
    const telemetryEndpoint = toOptionalString(telemetry.endpoint);
    const telemetryIntervalHours = toOptionalInt(telemetry.intervalHours);
    const incoming: JsonRecord = {};
    if (telemetryEnabled !== undefined) incoming.enabled = telemetryEnabled;
    if (telemetryEndpoint !== undefined) incoming.endpoint = telemetryEndpoint;
    if (telemetryIntervalHours !== undefined) {
      incoming.intervalHours = telemetryIntervalHours;
    }
    if (Object.keys(incoming).length > 0) {
      result.hasAnyBlock = true;
      result.applied.telemetry = incoming;
      extraMutators.push((extra) => {
        mergeObjectBlock(extra, "telemetry", incoming);
      });
    }
  }

  // --- notifications -> extraSettings.notifications (shallow-merge) ---
  const notifications = toRecord(root.notifications);
  if (notifications) {
    const notificationsEnabled = toOptionalBoolean(notifications.enabled);
    const notificationsInApp = toOptionalBoolean(
      toRecord(notifications.inApp)?.enabled
    );
    const notificationProvider = toOptionalString(notifications.provider);
    const notificationRelayUrl = toOptionalString(notifications.relayUrl);
    const notificationEvents = toRecord(notifications.events) ?? {};
    const notificationUserDefaults = toRecord(notifications.userDefaults) ?? {};
    const incoming: JsonRecord = {};
    if (notificationsEnabled !== undefined) incoming.enabled = notificationsEnabled;
    if (notificationsInApp !== undefined) {
      incoming.inApp = { enabled: notificationsInApp };
    }
    if (notificationProvider !== undefined) incoming.provider = notificationProvider;
    if (notificationRelayUrl !== undefined) incoming.relayUrl = notificationRelayUrl;
    if (Object.keys(notificationEvents).length > 0) {
      incoming.events = notificationEvents;
    }
    if (Object.keys(notificationUserDefaults).length > 0) {
      incoming.userDefaults = notificationUserDefaults;
    }
    if (Object.keys(incoming).length > 0) {
      result.hasAnyBlock = true;
      result.applied.notifications = incoming;
      extraMutators.push((extra) => {
        mergeObjectBlock(extra, "notifications", incoming);
      });
    }
  }

  // --- moduleSettings -> accountValidationSettings / billingSettings ---
  const moduleSettings = toRecord(root.moduleSettings);
  if (moduleSettings) {
    const appliedModuleSettings: JsonRecord = {};
    const accountValidation = toRecord(moduleSettings["account-validation"]);
    if (accountValidation) {
      const incoming: JsonRecord = {};
      const allowedDomains = Array.from(
        new Set(
          toStringArray(accountValidation.allowedDomains)
            .map((domain) => domain.toLowerCase())
            .filter((domain) => domain.includes("."))
        )
      );
      const enforceValidation = toOptionalBoolean(
        accountValidation.enforceValidation
      );
      if (allowedDomains.length > 0) incoming.allowedDomains = allowedDomains;
      if (enforceValidation !== undefined) {
        incoming.enforceValidation = enforceValidation;
      }
      if (Object.keys(incoming).length > 0) {
        appliedModuleSettings["account-validation"] = incoming;
        extraMutators.push((extra) => {
          mergeObjectBlock(extra, "accountValidationSettings", incoming);
        });
      }
    }
    const billing = toRecord(moduleSettings["billing-info"]);
    if (billing) {
      const incoming: JsonRecord = {};
      const pspEnabled = toOptionalBoolean(billing.pspEnabled);
      const pspMainDigits = toOptionalInt(billing.pspMainDigits);
      const pspExample = toOptionalString(billing.pspExample);
      const costCenterEnabled = toOptionalBoolean(billing.costCenterEnabled);
      const costCenterPattern = toOptionalString(billing.costCenterPattern);
      const costCenterExample = toOptionalString(billing.costCenterExample);
      if (pspEnabled !== undefined) incoming.pspEnabled = pspEnabled;
      if (pspMainDigits !== undefined) incoming.pspMainDigits = pspMainDigits;
      if (pspExample !== undefined) incoming.pspExample = pspExample;
      if (costCenterEnabled !== undefined) {
        incoming.costCenterEnabled = costCenterEnabled;
      }
      if (costCenterPattern !== undefined) {
        incoming.costCenterPattern = costCenterPattern;
      }
      if (costCenterExample !== undefined) {
        incoming.costCenterExample = costCenterExample;
      }
      if (Object.keys(incoming).length > 0) {
        appliedModuleSettings["billing-info"] = incoming;
        extraMutators.push((extra) => {
          mergeObjectBlock(extra, "billingSettings", incoming);
        });
      }
    }
    if (Object.keys(appliedModuleSettings).length > 0) {
      result.hasAnyBlock = true;
      result.applied.moduleSettings = appliedModuleSettings;
    }
  }

  // --- sequencingFiles -> extraSettings.sequencingFiles (shallow-merge) ---
  const sequencingFiles = toRecord(root.sequencingFiles);
  if (sequencingFiles) {
    const incoming: JsonRecord = {};
    const allowedExtensions = toStringArray(
      sequencingFiles.allowedExtensions ?? sequencingFiles.extensions
    );
    const scanDepth = toOptionalInt(sequencingFiles.scanDepth);
    const ignorePatterns = toStringArray(sequencingFiles.ignorePatterns);
    const autoAssign = toOptionalBoolean(sequencingFiles.autoAssign);
    if (allowedExtensions.length > 0) incoming.allowedExtensions = allowedExtensions;
    if (scanDepth !== undefined) incoming.scanDepth = scanDepth;
    if (ignorePatterns.length > 0) incoming.ignorePatterns = ignorePatterns;
    if (autoAssign !== undefined) incoming.autoAssign = autoAssign;
    if (Object.keys(incoming).length > 0) {
      result.hasAnyBlock = true;
      result.applied.sequencingFiles = incoming;
      extraMutators.push((extra) => {
        mergeObjectBlock(extra, "sequencingFiles", incoming);
      });
    }
  }

  // --- sequencingTech -> extraSettings.sequencingTechConfig ---
  const sequencingTech = toRecord(root.sequencingTech);
  if (sequencingTech) {
    const techConfig = toRecord(sequencingTech.config) ?? sequencingTech;
    if (Object.keys(techConfig).length > 0) {
      result.hasAnyBlock = true;
      result.applied.sequencingTech = techConfig;
      extraMutators.push((extra) => {
        extra.sequencingTechConfig = JSON.stringify(techConfig);
      });
    }
  }

  // --- modules -> SiteSettings.modulesConfig column (merge) ---
  const modules = toRecord(root.modules);
  if (modules) {
    const incomingModules: Record<string, boolean> = {};
    for (const [moduleId, enabled] of Object.entries(modules)) {
      const parsed = toOptionalBoolean(enabled);
      if (parsed !== undefined) {
        incomingModules[moduleId] = parsed;
      }
    }
    if (Object.keys(incomingModules).length > 0) {
      result.hasAnyBlock = true;
      result.applied.modules = incomingModules;
      // Column write is folded in the POST handler (it needs the existing
      // modulesConfig to merge against); record the intent here.
      result.columnWrites.modulesConfig = JSON.stringify({
        modules: incomingModules,
        globalDisabled: false,
      });
    }
  }

  // --- site.name -> siteName column; site.contactEmail -> contactEmail column ---
  const site = toRecord(root.site);
  if (site) {
    const siteName = toOptionalString(site.name);
    const contactEmail = toOptionalString(site.contactEmail);
    const appliedSite: JsonRecord = {};
    if (siteName !== undefined) {
      result.columnWrites.siteName = siteName;
      appliedSite.name = siteName;
    }
    if (contactEmail !== undefined) {
      result.columnWrites.contactEmail = contactEmail;
      appliedSite.contactEmail = contactEmail;
    }
    if (Object.keys(appliedSite).length > 0) {
      result.hasAnyBlock = true;
      result.applied.site = appliedSite;
    }
  }

  // --- pipelines.enable / pipelines.enabled -> installProfilePipelineAllowlist ---
  const pipelines = toRecord(root.pipelines);
  if (pipelines) {
    const pipelinesEnabled = toOptionalBoolean(pipelines.enabled);
    const enablePipelineIds = toStringArray(pipelines.enable);
    if (pipelinesEnabled === false) {
      result.hasAnyBlock = true;
      result.pipelineAllowlist = [];
      result.applied.installProfilePipelineAllowlist = [];
    } else if (enablePipelineIds.length > 0) {
      result.hasAnyBlock = true;
      result.pipelineAllowlist = enablePipelineIds;
      result.applied.installProfilePipelineAllowlist = enablePipelineIds;
    }

    const databaseDirectory = toOptionalString(pipelines.databaseDirectory);
    if (databaseDirectory) {
      result.hasAnyBlock = true;
      result.pipelineDatabaseDir = databaseDirectory;
      result.applied.pipelineDatabaseDir = databaseDirectory;
    }
  }

  // --- forms (Phase 4): settings.json.forms is the SINGLE SOURCE of truth for the
  // order / study / runAssignment forms. The importer PROJECTS each embedded form
  // object to the SAME read store the in-app per-section UI + installer apply-core
  // write to, so importing the one forms blob matches the installer:
  //   forms.order        -> db.orderFormConfig.schema {fields, groups,
  //                         enabledMixsChecklists, moduleDefaultsVersion}
  //   forms.study        -> extraSettings.studyFormFields / studyFormGroups /
  //                         studyFormDefaultsVersion
  //   forms.runAssignment-> extraSettings.sequencingRunSampleFormFields /
  //                         sequencingRunSampleFormGroups /
  //                         sequencingRunSampleFormDefaultsVersion
  // The PATH-STRING preset variants (forms.orderFormSettings, etc.) are NOT consumed
  // here — they remain warned/rejected by hasFormConfigKeys / getFormConfigWarnings.
  const forms = toRecord(root.forms);
  if (forms) {
    const appliedForms: JsonRecord = {};

    // ORDER -> OrderFormConfig.schema (dedicated store; NOT extraSettings).
    // STOP normalizing/overwriting: manage-merge the raw forms.order blob over the
    // EXISTING schema with the SAME shared builder the installer's applyOrderForm
    // uses, so import == install for the same forms.order + existing state. The GET
    // /api/admin/form-config reader re-applies fixed-section normalization on every
    // read, so storing the installer-style un-normalized merged shape is correct.
    const orderBlob = readEmbeddedFormBlob(forms.order, { allowMixsOnly: true });
    if (orderBlob) {
      const orderForm = {
        fields: orderBlob.fields,
        groups: orderBlob.groups,
        enabledMixsChecklists: orderBlob.enabledMixsChecklists,
        defaultsVersion: orderBlob.defaultsVersion ?? ORDER_FORM_DEFAULTS_VERSION,
      };
      result.hasAnyBlock = true;
      result.orderForm = orderForm;
      // Preview against an empty existing schema (the POST handler recomputes
      // against the live OrderFormConfig before persisting).
      const previewSchema = buildOrderFormConfigSchema({
        profileForm: orderForm,
        existingSchema: {},
      });
      appliedForms.order = {
        fields: previewSchema.fields,
        groups: previewSchema.groups,
        enabledMixsChecklists: previewSchema.enabledMixsChecklists,
      };
    }

    // STUDY -> extraSettings.studyForm* (the keys study-form-config/route.ts reads).
    const studyBlob = readEmbeddedFormBlob(forms.study);
    if (studyBlob) {
      const normalized = normalizeStudyFormSchema({
        fields: studyBlob.fields,
        groups: studyBlob.groups,
      });
      result.hasAnyBlock = true;
      appliedForms.study = {
        fields: normalized.fields,
        groups: normalized.groups,
      };
      extraMutators.push((extra) => {
        extra.studyFormFields = normalized.fields;
        extra.studyFormGroups = normalized.groups;
        extra.studyFormDefaultsVersion = STUDY_FORM_DEFAULTS_VERSION;
      });
    }

    // RUN-ASSIGNMENT -> extraSettings.sequencingRunSampleForm* (the keys
    // src/lib/sequencing/run-plan.ts reads).
    const runAssignmentBlob = readEmbeddedFormBlob(forms.runAssignment);
    if (runAssignmentBlob) {
      result.hasAnyBlock = true;
      appliedForms.runAssignment = {
        fields: runAssignmentBlob.fields,
        groups: runAssignmentBlob.groups,
      };
      extraMutators.push((extra) => {
        extra.sequencingRunSampleFormFields = runAssignmentBlob.fields;
        extra.sequencingRunSampleFormGroups = runAssignmentBlob.groups;
        extra.sequencingRunSampleFormDefaultsVersion =
          runAssignmentBlob.defaultsVersion ?? 1;
      });
    }

    if (Object.keys(appliedForms).length > 0) {
      result.applied.forms = appliedForms;
    }
  }

  // --- install-only / secret blocks: surface a warning, never apply ---
  const detectedInstallOnly = INSTALL_ONLY_PROFILE_KEYS.filter(
    (key) => root[key] !== undefined
  );
  if (detectedInstallOnly.length > 0) {
    result.warnings.push(
      `Install-only and secret blocks were detected and intentionally NOT applied in-app (run the installer to apply them): ${detectedInstallOnly.join(
        ", "
      )}.`
    );
  }

  result.applyExtraSettings = (extra: JsonRecord) => {
    for (const mutate of extraMutators) {
      mutate(extra);
    }
  };

  return result;
}

function parseImportValues(
  config: unknown,
  hasProfileBlocks = false
): InfrastructureImportValues {
  const root = toRecord(config);
  if (!root) {
    throw new Error("Infrastructure config must be a JSON object.");
  }

  const site = toRecord(root.site);
  const pipelines = toRecord(root.pipelines);
  const execution = toRecord(pipelines?.execution);
  const conda = toRecord(execution?.conda);
  const slurm = toRecord(execution?.slurm);
  const app = toRecord(root.app);
  const pipelineOverrides = parsePipelineExecutionOverrides(root);

  const executionMode = toOptionalString(execution?.mode)?.toLowerCase();
  const explicitUseSlurm = toOptionalBoolean(
    firstDefined(root.useSlurm, execution?.useSlurm, slurm?.enabled)
  );

  let useSlurm = explicitUseSlurm;
  if (useSlurm === undefined) {
    if (executionMode === "slurm") {
      useSlurm = true;
    } else if (executionMode === "local" || executionMode === "kubernetes") {
      useSlurm = false;
    }
  }

  const slurmCores = toOptionalInt(
    firstDefined(root.slurmCores, execution?.slurmCores, slurm?.cores)
  );
  const slurmTimeLimit = toOptionalInt(
    firstDefined(root.slurmTimeLimit, execution?.slurmTimeLimit, slurm?.timeLimit)
  );
  const port = toOptionalInt(firstDefined(root.port, root.appPort, app?.port));

  const values: InfrastructureImportValues = {
    dataBasePath: toOptionalString(
      firstDefined(
        root.sequencingDataDir,
        root.sequencingDataPath,
        root.dataBasePath,
        site?.dataBasePath
      )
    ),
    pipelineRunDir: toOptionalString(
      firstDefined(
        root.pipelineRunDir,
        root.runDirectory,
        execution?.runDirectory,
        execution?.pipelineRunDir
      )
    ),
    useSlurm,
    slurmQueue: toOptionalString(
      firstDefined(root.slurmQueue, execution?.slurmQueue, slurm?.queue)
    ),
    slurmMemory: toOptionalString(
      firstDefined(root.slurmMemory, execution?.slurmMemory, slurm?.memory)
    ),
    slurmOptions: toOptionalString(
      firstDefined(
        root.slurmOptions,
        root.clusterOptions,
        execution?.slurmOptions,
        execution?.clusterOptions,
        slurm?.options,
        slurm?.clusterOptions
      )
    ),
    condaPath: toOptionalString(
      firstDefined(root.condaPath, root.condaBase, execution?.condaPath, conda?.path)
    ),
    condaEnv: toOptionalString(
      firstDefined(
        root.condaEnv,
        root.condaEnvironment,
        execution?.condaEnv,
        conda?.environment
      )
    ),
    nextflowProfile: toOptionalString(
      firstDefined(root.nextflowProfile, execution?.nextflowProfile)
    ),
    weblogUrl: toOptionalString(
      firstDefined(
        root.nextflowWeblogUrl,
        root.weblogUrl,
        execution?.weblogUrl
      )
    ),
    weblogSecret: toOptionalString(
      firstDefined(root.weblogSecret, execution?.weblogSecret)
    ),
    pipelineOverrides:
      Object.keys(pipelineOverrides).length > 0 ? pipelineOverrides : undefined,
    port: port !== undefined && port > 0 ? port : undefined,
  };

  if (slurmCores !== undefined && slurmCores > 0) {
    values.slurmCores = slurmCores;
  }
  if (slurmTimeLimit !== undefined && slurmTimeLimit > 0) {
    values.slurmTimeLimit = slurmTimeLimit;
  }

  const hasAnyValue =
    Object.values(values).some((value) => value !== undefined) ||
    hasProfileBlocks;
  if (!hasAnyValue) {
    if (hasFormConfigKeys(root)) {
      throw new Error(
        "This JSON looks like form definitions, not a settings.json import. Import order and study form definitions from their Form Builder Import / Export tabs."
      );
    }
    throw new Error(
      "No supported settings found. Include keys like sequencingDataDir, pipelineRunDir, condaPath, condaEnv, useSlurm, nextflowWeblogUrl, or port."
    );
  }

  return values;
}

function updateUrlPort(urlValue: string, port: number): string | undefined {
  try {
    const parsed = new URL(urlValue);
    parsed.port = String(port);
    const next = parsed.toString();
    return next.endsWith("/") ? next.slice(0, -1) : next;
  } catch {
    return undefined;
  }
}

// Preferred runtime config filename order. "settings.json" is the canonical
// name; older names stay as fallbacks so existing installs keep a single file
// (see CONFIG_FILE_NAMES in src/lib/config/loader.ts and friends).
const CONFIG_FILE_NAMES = [
  "settings.json",
  "seqdesk.config.json",
  ".seqdeskrc",
  ".seqdeskrc.json",
];

async function upsertPortInConfigFile(port: number): Promise<string> {
  // Write to the EXISTING resolved config file if one exists (so a legacy
  // seqdesk.config.json install keeps one file, not a split); otherwise create
  // the canonical settings.json.
  let target = CONFIG_FILE_NAMES[0];
  let current: JsonRecord = {};

  for (const candidate of CONFIG_FILE_NAMES) {
    let raw: string;
    try {
      raw = await fs.readFile(candidate, "utf8");
    } catch {
      // candidate missing — try the next fallback
      continue;
    }
    // The file exists, so reuse it as the write target even if its contents
    // are unparseable (avoids splitting an existing install into two files).
    target = candidate;
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (isRecord(parsed)) {
        current = parsed;
      }
    } catch {
      current = {};
    }
    break;
  }

  const next = { ...current } as JsonRecord;
  const app = toRecord(next.app) ?? {};
  app.port = port;
  next.app = app;

  const runtime = toRecord(next.runtime) ?? {};
  const existingNextAuthUrl = toOptionalString(runtime.nextAuthUrl);
  if (existingNextAuthUrl) {
    const updated = updateUrlPort(existingNextAuthUrl, port);
    if (updated) {
      runtime.nextAuthUrl = updated;
    }
  } else {
    runtime.nextAuthUrl = `http://localhost:${port}`;
  }
  next.runtime = runtime;

  await fs.writeFile(target, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return target;
}

export async function POST(request: NextRequest) {
  try {
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== "FACILITY_ADMIN") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const body = (await request.json()) as InfrastructureImportRequest;
    const dryRun = body?.dryRun === true;
    // Parse the non-infrastructure blocks (access/auth/ena/telemetry/notifications/
    // moduleSettings/modules/sequencingFiles/sequencingTech/site/pipelines.allowlist)
    // into the SAME sinks the installer apply-core + per-section settings UI use, so
    // importing a WEB profile JSON in-app matches the installer.
    const blocks = parseProfileBlocks(body?.config);
    const values = parseImportValues(body?.config, blocks.hasAnyBlock);
    const formConfigWarnings = getFormConfigWarnings(body?.config);

    const settings = await db.siteSettings.findUnique({
      where: { id: "singleton" },
      select: { dataBasePath: true, extraSettings: true, modulesConfig: true },
    });

    let extraSettings: JsonRecord = {};
    if (settings?.extraSettings) {
      try {
        const parsed = JSON.parse(settings.extraSettings) as unknown;
        extraSettings = toRecord(parsed) || {};
      } catch {
        extraSettings = {};
      }
    }

    const currentExecution: ExecutionSettings = {
      ...DEFAULT_EXECUTION_SETTINGS,
      ...(toRecord(extraSettings.pipelineExecution) as Partial<ExecutionSettings>),
      runtimeMode: "conda",
    };

    const nextExecution: ExecutionSettings = {
      ...currentExecution,
      runtimeMode: "conda",
    };

    if (values.useSlurm !== undefined) {
      nextExecution.useSlurm = values.useSlurm;
    }
    if (values.slurmQueue !== undefined) {
      nextExecution.slurmQueue = values.slurmQueue;
    }
    if (values.slurmCores !== undefined) {
      nextExecution.slurmCores = values.slurmCores;
    }
    if (values.slurmMemory !== undefined) {
      nextExecution.slurmMemory = values.slurmMemory;
    }
    if (values.slurmTimeLimit !== undefined) {
      nextExecution.slurmTimeLimit = values.slurmTimeLimit;
    }
    if (values.slurmOptions !== undefined) {
      nextExecution.slurmOptions = values.slurmOptions;
    }
    if (values.condaPath !== undefined) {
      nextExecution.condaPath = values.condaPath;
    }
    if (values.condaEnv !== undefined) {
      nextExecution.condaEnv = values.condaEnv;
    }
    if (values.nextflowProfile !== undefined) {
      nextExecution.nextflowProfile = values.nextflowProfile;
    }
    if (values.weblogUrl !== undefined) {
      nextExecution.weblogUrl = values.weblogUrl;
    }
    if (values.weblogSecret !== undefined) {
      nextExecution.weblogSecret = values.weblogSecret;
    }
    if (values.pipelineRunDir !== undefined) {
      nextExecution.pipelineRunDir =
        values.pipelineRunDir === "/"
          ? DEFAULT_EXECUTION_SETTINGS.pipelineRunDir
          : values.pipelineRunDir;
    }
    if (values.pipelineOverrides !== undefined) {
      nextExecution.pipelineOverrides = {
        ...(currentExecution.pipelineOverrides || {}),
        ...values.pipelineOverrides,
      };
    }
    // pipelines.databaseDirectory -> pipelineExecution.pipelineDatabaseDir
    // (the exact key the installer apply-core writes at apply-core.mjs:1114).
    if (blocks.pipelineDatabaseDir !== undefined) {
      nextExecution.pipelineDatabaseDir = blocks.pipelineDatabaseDir;
    }

    const applied: Record<string, unknown> = { ...blocks.applied };
    if (values.dataBasePath !== undefined) applied.dataBasePath = values.dataBasePath;
    if (values.pipelineRunDir !== undefined) {
      applied.pipelineRunDir = nextExecution.pipelineRunDir;
    }
    if (values.useSlurm !== undefined) applied.useSlurm = values.useSlurm;
    if (values.condaPath !== undefined) applied.condaPath = values.condaPath;
    if (values.condaEnv !== undefined) applied.condaEnv = values.condaEnv;
    if (values.weblogUrl !== undefined) applied.weblogUrl = values.weblogUrl;
    if (values.weblogSecret !== undefined) applied.weblogSecret = values.weblogSecret;
    if (values.slurmQueue !== undefined) applied.slurmQueue = values.slurmQueue;
    if (values.slurmCores !== undefined) applied.slurmCores = values.slurmCores;
    if (values.slurmMemory !== undefined) applied.slurmMemory = values.slurmMemory;
    if (values.slurmTimeLimit !== undefined) {
      applied.slurmTimeLimit = values.slurmTimeLimit;
    }
    if (values.slurmOptions !== undefined) applied.slurmOptions = values.slurmOptions;
    if (values.nextflowProfile !== undefined) {
      applied.nextflowProfile = values.nextflowProfile;
    }
    if (values.pipelineOverrides !== undefined) {
      applied.pipelineOverrides = values.pipelineOverrides;
    }
    if (values.port !== undefined) applied.port = values.port;

    if (dryRun) {
      const warnings: string[] = [...formConfigWarnings, ...blocks.warnings];
      if (values.port !== undefined) {
        warnings.push("Saving will update app.port in settings.json and requires a restart.");
      }
      return NextResponse.json({
        success: true,
        message: "Configuration is valid.",
        applied,
        warnings,
      });
    }

    // Fold the non-infrastructure blocks into the SAME extraSettings store the
    // per-section settings UI writes (shallow-merge over existing sibling keys).
    blocks.applyExtraSettings(extraSettings);
    if (blocks.pipelineAllowlist !== undefined) {
      extraSettings.installProfilePipelineAllowlist = blocks.pipelineAllowlist;
    }

    extraSettings.pipelineExecution = nextExecution;

    const updateData: {
      extraSettings: string;
      dataBasePath?: string | null;
      postSubmissionInstructions?: string;
      enaTestMode?: boolean;
      enaUsername?: string;
      enaPassword?: string;
      modulesConfig?: string;
      siteName?: string;
      contactEmail?: string;
    } = {
      extraSettings: JSON.stringify(extraSettings),
    };
    if (values.dataBasePath !== undefined) {
      updateData.dataBasePath = values.dataBasePath;
    }
    // Column writes (the SAME SiteSettings columns the per-section UI + installer
    // apply-core write to). modules merges over the existing modulesConfig column.
    const columnWrites = blocks.columnWrites;
    if (columnWrites.postSubmissionInstructions !== undefined) {
      updateData.postSubmissionInstructions = columnWrites.postSubmissionInstructions;
    }
    if (columnWrites.enaTestMode !== undefined) {
      updateData.enaTestMode = columnWrites.enaTestMode;
    }
    if (columnWrites.enaUsername !== undefined) {
      updateData.enaUsername = columnWrites.enaUsername;
    }
    if (columnWrites.enaPasswordPlain !== undefined) {
      // Encrypt at rest on the REAL save only (the SAME enc:v1 format the
      // settings/ena PUT writer produces and submg-runner / submissions /
      // ena/test / database-merge decrypt via decryptSecret).
      updateData.enaPassword = encryptSecret(columnWrites.enaPasswordPlain);
    }
    if (columnWrites.siteName !== undefined) {
      updateData.siteName = columnWrites.siteName;
    }
    if (columnWrites.contactEmail !== undefined) {
      updateData.contactEmail = columnWrites.contactEmail;
    }
    if (columnWrites.modulesConfig !== undefined) {
      updateData.modulesConfig = mergeModulesConfigColumn(
        settings?.modulesConfig,
        columnWrites.modulesConfig
      );
    }

    await db.siteSettings.upsert({
      where: { id: "singleton" },
      update: updateData,
      create: {
        ...updateData,
        id: "singleton",
        dataBasePath:
          updateData.dataBasePath ??
          (settings?.dataBasePath?.trim() || null),
        extraSettings: updateData.extraSettings,
      },
    });

    // Phase 4 + A11: project forms.order into the DEDICATED OrderFormConfig store (the
    // same store the installer's applyOrderForm + the in-app GET /api/admin/form-config
    // reader use). schema is a JSON STRING column with moduleDefaultsVersion stamped.
    // Manage-merge over the EXISTING schema with the SAME shared builder the installer
    // uses, and PRESERVE the existing coreFieldConfig + bump version, so importing the
    // same forms.order over the same existing state writes exactly what the installer
    // would (import == install).
    if (blocks.orderForm) {
      const existingOrderForm = await db.orderFormConfig.findUnique({
        where: { id: "singleton" },
      });
      let existingSchema: Record<string, unknown> = {};
      if (existingOrderForm?.schema) {
        try {
          const parsed = JSON.parse(existingOrderForm.schema) as unknown;
          existingSchema = toRecord(parsed) || {};
        } catch {
          existingSchema = {};
        }
      }
      const nextSchema = buildOrderFormConfigSchema({
        profileForm: blocks.orderForm,
        existingSchema,
      });
      const orderSchemaJson = JSON.stringify(nextSchema);
      await db.orderFormConfig.upsert({
        where: { id: "singleton" },
        update: {
          schema: orderSchemaJson,
          // PRESERVE the admin-curated core field config (do NOT reset to "{}").
          coreFieldConfig: existingOrderForm?.coreFieldConfig || "{}",
          version: (existingOrderForm?.version || 0) + 1,
        },
        create: {
          id: "singleton",
          schema: orderSchemaJson,
          coreFieldConfig: "{}",
          version: 1,
        },
      });
    }

    const warnings: string[] = [...formConfigWarnings, ...blocks.warnings];
    let updatedConfigFile: string | undefined;
    if (values.port !== undefined) {
      try {
        updatedConfigFile = await upsertPortInConfigFile(values.port);
        warnings.push(
          `Updated app.port in ${updatedConfigFile}. Restart SeqDesk to apply the new port.`
        );
      } catch (error) {
        warnings.push(
          `Could not update app.port automatically: ${
            error instanceof Error ? error.message : "unknown error"
          }`
        );
      }
    }

    return NextResponse.json({
      success: true,
      message: "Infrastructure settings imported.",
      applied,
      warnings,
      updatedConfigFile,
      updatedEnvFile: updatedConfigFile,
    });
  } catch (error) {
    console.error("[Infrastructure Import] Error:", error);
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to import infrastructure settings",
      },
      { status: 400 }
    );
  }
}
