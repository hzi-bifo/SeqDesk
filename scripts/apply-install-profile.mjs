#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { PrismaClient } from "@prisma/client";

const SITE_SETTINGS_ID = "singleton";
const ORDER_FORM_ID = "singleton";
const SEQUENCING_TECH_CONFIG_KEY = "sequencingTechConfig";
const RUN_ASSIGNMENT_FIELDS_KEY = "sequencingRunSampleFormFields";
const RUN_ASSIGNMENT_GROUPS_KEY = "sequencingRunSampleFormGroups";
const RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY = "sequencingRunSampleFormDefaultsVersion";

function usage() {
  console.log(`Usage:
  node scripts/apply-install-profile.mjs --profile-config <file>

Options:
  --profile-config <file>  Resolved install profile JSON
  -h, --help              Show this help
`);
}

function parseArgs(argv) {
  const args = {
    profileConfig: process.env.SEQDESK_INSTALL_PROFILE_CONFIG || "",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      usage();
      process.exit(0);
    }
    if (arg === "--profile-config" || arg === "--profile_config") {
      args.profileConfig = argv[index + 1] || "";
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${arg}`);
  }

  if (!args.profileConfig) {
    throw new Error("--profile-config is required");
  }

  return args;
}

function isRecord(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function toRecord(value) {
  return isRecord(value) ? value : {};
}

function toOptionalString(value) {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function toOptionalBoolean(value) {
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

function toOptionalInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const intValue = Math.trunc(value);
    return intValue > 0 ? intValue : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const intValue = Math.trunc(parsed);
      return intValue > 0 ? intValue : undefined;
    }
  }
  return undefined;
}

function readJsonFile(filePath) {
  const resolved = path.resolve(filePath);
  const raw = fs.readFileSync(resolved, "utf8");
  const parsed = JSON.parse(raw);
  if (!isRecord(parsed)) {
    throw new Error(`${resolved} must contain a JSON object`);
  }
  return { resolved, parsed };
}

function loadDatabaseConfigFromConfig() {
  try {
    const raw = fs.readFileSync("seqdesk.config.json", "utf8");
    const parsed = JSON.parse(raw);
    const runtime = isRecord(parsed?.runtime) ? parsed.runtime : {};
    return {
      databaseUrl: toOptionalString(runtime.databaseUrl),
      directUrl: toOptionalString(runtime.directUrl),
    };
  } catch {
    return {};
  }
}

function ensureDatabaseEnv() {
  if (process.env.DATABASE_URL) return;
  const loaded = loadDatabaseConfigFromConfig();
  if (loaded.databaseUrl) {
    process.env.DATABASE_URL = loaded.databaseUrl;
    process.env.DIRECT_URL = loaded.directUrl || loaded.databaseUrl;
  }
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

function itemKey(item, fallbackPrefix) {
  if (typeof item.name === "string" && item.name.trim()) {
    return `name:${item.name.trim()}`;
  }
  if (typeof item.id === "string" && item.id.trim()) {
    return `id:${item.id.trim()}`;
  }
  return `${fallbackPrefix}:${JSON.stringify(item)}`;
}

function mergeByKey(existingItems, incomingItems, keyFn) {
  const merged = [];
  const indexByKey = new Map();

  for (const item of existingItems) {
    if (!isRecord(item)) continue;
    const key = keyFn(item);
    indexByKey.set(key, merged.length);
    merged.push(item);
  }

  for (const item of incomingItems) {
    if (!isRecord(item)) continue;
    const key = keyFn(item);
    const existingIndex = indexByKey.get(key);
    if (existingIndex === undefined) {
      indexByKey.set(key, merged.length);
      merged.push(item);
      continue;
    }
    merged[existingIndex] = {
      ...merged[existingIndex],
      ...item,
    };
  }

  return merged;
}

function sortByOrder(items) {
  return [...items].sort((a, b) => {
    const aOrder = typeof a.order === "number" ? a.order : 9999;
    const bOrder = typeof b.order === "number" ? b.order : 9999;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return String(a.label || a.name || a.id || "").localeCompare(
      String(b.label || b.name || b.id || "")
    );
  });
}

function mergeGroups(existingGroups, incomingGroups) {
  return sortByOrder(
    mergeByKey(
      Array.isArray(existingGroups) ? existingGroups : [],
      Array.isArray(incomingGroups) ? incomingGroups : [],
      (group) => `id:${group.id || group.name || ""}`
    )
  );
}

function mergeFields(existingFields, incomingFields) {
  return sortByOrder(
    mergeByKey(
      Array.isArray(existingFields) ? existingFields : [],
      Array.isArray(incomingFields) ? incomingFields : [],
      (field) => itemKey(field, "field")
    )
  );
}

function mergeStringArrays(existing, incoming) {
  return Array.from(
    new Set([
      ...(Array.isArray(existing) ? existing.filter((item) => typeof item === "string") : []),
      ...(Array.isArray(incoming) ? incoming.filter((item) => typeof item === "string") : []),
    ])
  );
}

function parseModulesConfig(raw) {
  const parsed = parseJsonObject(raw);
  if (isRecord(parsed.modules)) {
    return {
      modules: { ...parsed.modules },
      globalDisabled: parsed.globalDisabled === true,
    };
  }
  return {
    modules: { ...parsed },
    globalDisabled: false,
  };
}

function readFormConfig(profile, formKey) {
  const form = toRecord(toRecord(profile.forms)[formKey]);
  return {
    groups: Array.isArray(form.groups) ? form.groups : [],
    fields: Array.isArray(form.fields) ? form.fields : [],
    enabledMixsChecklists: Array.isArray(form.enabledMixsChecklists)
      ? form.enabledMixsChecklists
      : [],
    defaultsVersion: toOptionalInt(form.defaultsVersion) || 1,
  };
}

async function loadSiteSettings(prisma) {
  return prisma.siteSettings.findUnique({
    where: { id: SITE_SETTINGS_ID },
  });
}

async function updateSiteSettings(prisma, update) {
  await prisma.siteSettings.upsert({
    where: { id: SITE_SETTINGS_ID },
    update,
    create: {
      id: SITE_SETTINGS_ID,
      ...update,
    },
  });
}

async function applyOrderForm(prisma, profile) {
  const profileForm = readFormConfig(profile, "order");
  if (profileForm.fields.length === 0 && profileForm.groups.length === 0) {
    return false;
  }

  const existing = await prisma.orderFormConfig.findUnique({
    where: { id: ORDER_FORM_ID },
  });
  const existingSchema = parseJsonObject(existing?.schema);

  const nextSchema = {
    ...existingSchema,
    groups: mergeGroups(existingSchema.groups, profileForm.groups),
    fields: mergeFields(existingSchema.fields, profileForm.fields),
    enabledMixsChecklists: mergeStringArrays(
      existingSchema.enabledMixsChecklists,
      profileForm.enabledMixsChecklists
    ),
    installProfileDefaultsVersion: profileForm.defaultsVersion,
  };

  await prisma.orderFormConfig.upsert({
    where: { id: ORDER_FORM_ID },
    update: {
      schema: JSON.stringify(nextSchema),
      coreFieldConfig: existing?.coreFieldConfig || "{}",
      version: (existing?.version || 0) + 1,
    },
    create: {
      id: ORDER_FORM_ID,
      schema: JSON.stringify(nextSchema),
      coreFieldConfig: "{}",
      version: 1,
    },
  });

  return true;
}

async function applySiteProfile(prisma, profile) {
  const settings = await loadSiteSettings(prisma);
  const extra = parseJsonObject(settings?.extraSettings);
  const update = {};

  const modules = toRecord(profile.modules);
  if (Object.keys(modules).length > 0) {
    const modulesConfig = parseModulesConfig(settings?.modulesConfig);
    for (const [moduleId, enabled] of Object.entries(modules)) {
      const parsedEnabled = toOptionalBoolean(enabled);
      if (parsedEnabled !== undefined) {
        modulesConfig.modules[moduleId] = parsedEnabled;
      }
    }
    update.modulesConfig = JSON.stringify(modulesConfig);
  }

  const studyForm = readFormConfig(profile, "study");
  if (studyForm.fields.length > 0 || studyForm.groups.length > 0) {
    extra.studyFormFields = mergeFields(extra.studyFormFields, studyForm.fields);
    extra.studyFormGroups = mergeGroups(extra.studyFormGroups, studyForm.groups);
    extra.studyFormDefaultsVersion = studyForm.defaultsVersion;
  }

  const runAssignmentForm = readFormConfig(profile, "runAssignment");
  if (runAssignmentForm.fields.length > 0 || runAssignmentForm.groups.length > 0) {
    extra[RUN_ASSIGNMENT_FIELDS_KEY] = mergeFields(
      extra[RUN_ASSIGNMENT_FIELDS_KEY],
      runAssignmentForm.fields
    );
    extra[RUN_ASSIGNMENT_GROUPS_KEY] = mergeGroups(
      extra[RUN_ASSIGNMENT_GROUPS_KEY],
      runAssignmentForm.groups
    );
    extra[RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY] = runAssignmentForm.defaultsVersion;
  }

  const sequencingTech = toRecord(profile.sequencingTech);
  if (isRecord(sequencingTech.config)) {
    extra[SEQUENCING_TECH_CONFIG_KEY] = JSON.stringify(sequencingTech.config);
  }

  const telemetry = toRecord(profile.telemetry);
  const telemetryEnabled = toOptionalBoolean(telemetry.enabled);
  const telemetryEndpoint = toOptionalString(telemetry.endpoint);
  const telemetryIntervalHours = toOptionalInt(telemetry.intervalHours);
  if (
    telemetryEnabled !== undefined ||
    telemetryEndpoint !== undefined ||
    telemetryIntervalHours !== undefined
  ) {
    extra.telemetry = {
      ...(isRecord(extra.telemetry) ? extra.telemetry : {}),
      ...(telemetryEnabled !== undefined ? { enabled: telemetryEnabled } : {}),
      ...(telemetryEndpoint !== undefined ? { endpoint: telemetryEndpoint } : {}),
      ...(telemetryIntervalHours !== undefined
        ? { intervalHours: telemetryIntervalHours }
        : {}),
    };
  }

  const notifications = toRecord(profile.notifications);
  const notificationsEnabled = toOptionalBoolean(notifications.enabled);
  const notificationProvider = toOptionalString(notifications.provider);
  const notificationRelayUrl = toOptionalString(notifications.relayUrl);
  const notificationEvents = toRecord(notifications.events);
  const notificationUserDefaults = toRecord(notifications.userDefaults);
  if (
    notificationsEnabled !== undefined ||
    notificationProvider ||
    notificationRelayUrl ||
    Object.keys(notificationEvents).length > 0 ||
    Object.keys(notificationUserDefaults).length > 0
  ) {
    extra.notifications = {
      ...(isRecord(extra.notifications) ? extra.notifications : {}),
      ...(notificationsEnabled !== undefined ? { enabled: notificationsEnabled } : {}),
      ...(notificationProvider ? { provider: notificationProvider } : {}),
      ...(notificationRelayUrl ? { relayUrl: notificationRelayUrl } : {}),
      ...(Object.keys(notificationEvents).length > 0 ? { events: notificationEvents } : {}),
      ...(Object.keys(notificationUserDefaults).length > 0
        ? { userDefaults: notificationUserDefaults }
        : {}),
    };
  }

  const ena = toRecord(profile.ena);
  const enaUsername = toOptionalString(ena.username);
  const enaPassword = toOptionalString(ena.password);
  const enaTestMode = toOptionalBoolean(ena.testMode);
  const enaCenterName = toOptionalString(ena.centerName);
  const enaBrokerAccount = toOptionalBoolean(ena.brokerAccount);
  if (enaUsername) update.enaUsername = enaUsername;
  if (enaPassword) update.enaPassword = enaPassword;
  if (enaTestMode !== undefined) update.enaTestMode = enaTestMode;
  if (enaCenterName || enaBrokerAccount !== undefined) {
    extra.ena = {
      ...(isRecord(extra.ena) ? extra.ena : {}),
      ...(enaCenterName ? { centerName: enaCenterName } : {}),
      ...(enaBrokerAccount !== undefined ? { brokerAccount: enaBrokerAccount } : {}),
    };
  }

  const site = toRecord(profile.site);
  const dataBasePath = toOptionalString(site.dataBasePath);
  if (dataBasePath) {
    update.dataBasePath = dataBasePath;
  }

  const pipelines = toRecord(profile.pipelines);
  const execution = toRecord(pipelines.execution);
  if (Object.keys(execution).length > 0) {
    const slurm = toRecord(execution.slurm);
    const conda = toRecord(execution.conda);
    const currentExecution = isRecord(extra.pipelineExecution) ? extra.pipelineExecution : {};
    const nextExecution = {
      ...currentExecution,
      runtimeMode: "conda",
    };

    const mode = toOptionalString(execution.mode)?.toLowerCase();
    const runDirectory = toOptionalString(execution.runDirectory || execution.pipelineRunDir);
    const useSlurm = toOptionalBoolean(execution.useSlurm ?? slurm.enabled);
    const slurmQueue = toOptionalString(execution.slurmQueue || slurm.queue);
    const slurmCores = toOptionalInt(execution.slurmCores ?? slurm.cores);
    const slurmMemory = toOptionalString(execution.slurmMemory || slurm.memory);
    const slurmTimeLimit = toOptionalInt(execution.slurmTimeLimit ?? slurm.timeLimit);
    const slurmOptions = toOptionalString(
      execution.slurmOptions || execution.clusterOptions || slurm.options || slurm.clusterOptions
    );
    const condaPath = toOptionalString(execution.condaPath || conda.path);
    const condaEnv = toOptionalString(execution.condaEnv || conda.environment);
    const nextflowProfile = toOptionalString(execution.nextflowProfile);
    const weblogUrl = toOptionalString(execution.weblogUrl);
    const weblogSecret = toOptionalString(execution.weblogSecret);

    if (runDirectory && runDirectory !== "/") nextExecution.pipelineRunDir = runDirectory;
    if (mode === "slurm") nextExecution.useSlurm = true;
    if (mode === "local") nextExecution.useSlurm = false;
    if (useSlurm !== undefined) nextExecution.useSlurm = useSlurm;
    if (slurmQueue) nextExecution.slurmQueue = slurmQueue;
    if (slurmCores !== undefined) nextExecution.slurmCores = slurmCores;
    if (slurmMemory) nextExecution.slurmMemory = slurmMemory;
    if (slurmTimeLimit !== undefined) nextExecution.slurmTimeLimit = slurmTimeLimit;
    if (slurmOptions !== undefined) nextExecution.slurmOptions = slurmOptions;
    if (condaPath !== undefined) nextExecution.condaPath = condaPath;
    if (condaEnv !== undefined) nextExecution.condaEnv = condaEnv;
    if (nextflowProfile !== undefined) nextExecution.nextflowProfile = nextflowProfile;
    if (weblogUrl !== undefined) nextExecution.weblogUrl = weblogUrl;
    if (weblogSecret !== undefined) nextExecution.weblogSecret = weblogSecret;

    extra.pipelineExecution = nextExecution;
  }

  extra.installProfile = {
    id: toOptionalString(profile.id) || "unknown",
    version: toOptionalString(profile.version) || "unknown",
    name: toOptionalString(toRecord(profile.profile).name) || toOptionalString(profile.id) || "Install profile",
    appliedAt: new Date().toISOString(),
  };

  update.extraSettings = JSON.stringify(extra);
  await updateSiteSettings(prisma, update);

  return true;
}

async function applyPipelineEnablement(prisma, profile) {
  const pipelines = toRecord(profile.pipelines);
  const enabled = toOptionalBoolean(pipelines.enabled);
  const enableIds = Array.isArray(pipelines.enable)
    ? pipelines.enable.filter((item) => typeof item === "string" && item.trim())
    : [];

  if (enabled !== true || enableIds.length === 0) {
    return 0;
  }

  for (const pipelineId of enableIds) {
    const existing = await prisma.pipelineConfig.findUnique({
      where: { pipelineId },
    });
    await prisma.pipelineConfig.upsert({
      where: { pipelineId },
      update: {
        enabled: true,
        config: existing?.config || null,
      },
      create: {
        pipelineId,
        enabled: true,
        config: null,
      },
    });
  }

  return enableIds.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { resolved, parsed } = readJsonFile(args.profileConfig);
  ensureDatabaseEnv();

  const prisma = new PrismaClient();
  try {
    const appliedOrderForm = await applyOrderForm(prisma, parsed);
    await applySiteProfile(prisma, parsed);
    const enabledPipelines = await applyPipelineEnablement(prisma, parsed);

    console.log(`Applied install profile ${parsed.id || "unknown"} from ${resolved}`);
    console.log(
      `Profile changes: orderForm=${appliedOrderForm ? "yes" : "no"}, pipelinesEnabled=${enabledPipelines}`
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error("ERROR: Failed to apply install profile:", error?.message || error);
  process.exit(1);
});
