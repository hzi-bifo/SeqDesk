import fs from "fs";
import path from "path";

const SITE_SETTINGS_ID = "singleton";
const ORDER_FORM_ID = "singleton";
const SEQUENCING_TECH_CONFIG_KEY = "sequencingTechConfig";
const RUN_ASSIGNMENT_FIELDS_KEY = "sequencingRunSampleFormFields";
const RUN_ASSIGNMENT_GROUPS_KEY = "sequencingRunSampleFormGroups";
const RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY = "sequencingRunSampleFormDefaultsVersion";
const INSTALL_PROFILE_PIPELINE_ALLOWLIST_KEY = "installProfilePipelineAllowlist";
const INSTALL_PROFILE_MANAGED_KEY = "installProfileManaged";
const ACCOUNT_VALIDATION_SETTINGS_KEY = "accountValidationSettings";
const BILLING_SETTINGS_KEY = "billingSettings";

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

function parseJsonObject(value) {
  if (isRecord(value)) return value;
  if (typeof value !== "string" || value.trim().length === 0) return {};
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : {};
  } catch {
    return {};
  }
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

function toOptionalNonNegativeInt(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    const intValue = Math.trunc(value);
    return intValue >= 0 ? intValue : undefined;
  }
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      const intValue = Math.trunc(parsed);
      return intValue >= 0 ? intValue : undefined;
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

function buildSafeInstallProfileMetadata(profile) {
  const profileDetails = toRecord(profile.profile);
  const metadata = {};
  const id = toOptionalString(profile.id);
  const name = toOptionalString(profileDetails.name) || toOptionalString(profile.name);
  const version = toOptionalString(profile.version);
  if (id) metadata.id = id;
  if (name) metadata.name = name;
  if (version) metadata.version = version;
  if (Object.keys(metadata).length === 0) return undefined;
  metadata.appliedAt = new Date().toISOString();
  return metadata;
}

function persistSafeInstallProfileMetadata(profile) {
  const metadata = buildSafeInstallProfileMetadata(profile);
  if (!metadata) return false;

  let config = {};
  try {
    if (fs.existsSync("seqdesk.config.json")) {
      const parsed = JSON.parse(fs.readFileSync("seqdesk.config.json", "utf8"));
      config = isRecord(parsed) ? parsed : {};
    }
  } catch {
    config = {};
  }

  config.installProfile = metadata;
  fs.writeFileSync("seqdesk.config.json", JSON.stringify(config, null, 2));
  return true;
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

function isLegacyOrderPlatformField(field) {
  return (
    field?.id === "system_platform" ||
    field?.name === "platform" ||
    field?.systemKey === "platform"
  );
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
      Array.isArray(existingFields)
        ? existingFields.filter((field) => !isLegacyOrderPlatformField(field))
        : [],
      Array.isArray(incomingFields)
        ? incomingFields.filter((field) => !isLegacyOrderPlatformField(field))
        : [],
      (field) => itemKey(field, "field")
    )
  );
}

function groupKey(group) {
  return `id:${group.id || group.name || ""}`;
}

function managedItemKeys(items, keyFn) {
  return normalizeStringArray(
    (Array.isArray(items) ? items : [])
      .filter((item) => isRecord(item))
      .map((item) => keyFn(item))
  );
}

function mergeManagedItems(existingItems, incomingItems, previousManagedKeys, keyFn) {
  const incoming = (Array.isArray(incomingItems) ? incomingItems : []).filter((item) =>
    isRecord(item)
  );
  const incomingKeys = new Set(managedItemKeys(incoming, keyFn));
  const previousKeys = new Set(normalizeStringArray(previousManagedKeys));
  const existing = (Array.isArray(existingItems) ? existingItems : []).filter((item) => {
    if (!isRecord(item)) return false;
    const key = keyFn(item);
    return !previousKeys.has(key) || incomingKeys.has(key);
  });
  return {
    items: sortByOrder(mergeByKey(existing, incoming, keyFn)),
    managedKeys: Array.from(incomingKeys).sort(),
  };
}

function mergeManagedGroups(existingGroups, incomingGroups, previousManagedKeys) {
  return mergeManagedItems(existingGroups, incomingGroups, previousManagedKeys, groupKey);
}

function mergeManagedFields(existingFields, incomingFields, previousManagedKeys) {
  const withoutLegacy = (items) =>
    (Array.isArray(items) ? items : []).filter((field) => !isLegacyOrderPlatformField(field));
  return mergeManagedItems(
    withoutLegacy(existingFields),
    withoutLegacy(incomingFields),
    previousManagedKeys,
    (field) => itemKey(field, "field")
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

function mergeManagedStringArrays(existing, incoming, previousManagedValues) {
  const incomingValues = normalizeStringArray(incoming);
  const incomingSet = new Set(incomingValues);
  const previousSet = new Set(normalizeStringArray(previousManagedValues));
  return {
    items: Array.from(
      new Set([
        ...(Array.isArray(existing)
          ? existing.filter(
              (item) =>
                typeof item === "string" &&
                (!previousSet.has(item.trim()) || incomingSet.has(item.trim()))
            )
          : []),
        ...incomingValues,
      ])
    ),
    managedKeys: incomingValues,
  };
}

function mergeManagedObject(existingObject, incomingObject, previousManagedKeys) {
  const incoming = toRecord(incomingObject);
  const incomingKeys = new Set(Object.keys(incoming));
  const previousKeys = new Set(normalizeStringArray(previousManagedKeys));
  const next = { ...toRecord(existingObject) };
  for (const key of previousKeys) {
    if (!incomingKeys.has(key)) {
      delete next[key];
    }
  }
  Object.assign(next, incoming);
  return {
    object: next,
    managedKeys: Array.from(incomingKeys).sort(),
  };
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return Array.from(
    new Set(
      value
        .filter((item) => typeof item === "string")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

function normalizeExecutionMode(value) {
  const mode = toOptionalString(value)?.toLowerCase();
  if (mode === "inherit" || mode === "local" || mode === "slurm") return mode;
  return undefined;
}

function buildPipelineExecutionOverride(value) {
  const source = toRecord(value);
  if (Object.keys(source).length === 0) return undefined;

  const slurm = toRecord(source.slurm);
  const nextSlurm = {};
  const mode = normalizeExecutionMode(source.mode);
  const queue = toOptionalString(source.slurmQueue || slurm.queue);
  const cores = toOptionalInt(source.slurmCores ?? slurm.cores);
  const memory = toOptionalString(source.slurmMemory || slurm.memory);
  const timeLimit = toOptionalInt(source.slurmTimeLimit ?? slurm.timeLimit);
  const options = toOptionalString(
    source.slurmOptions || source.clusterOptions || slurm.options || slurm.clusterOptions
  );
  const nextflowProfile = toOptionalString(source.nextflowProfile);

  if (queue) nextSlurm.queue = queue;
  if (cores !== undefined) nextSlurm.cores = cores;
  if (memory) nextSlurm.memory = memory;
  if (timeLimit !== undefined) nextSlurm.timeLimit = timeLimit;
  if (options !== undefined) nextSlurm.options = options;

  const override = {};
  if (mode) override.mode = mode;
  if (Object.keys(nextSlurm).length > 0) override.slurm = nextSlurm;
  if (nextflowProfile) override.nextflowProfile = nextflowProfile;

  return Object.keys(override).length > 0 ? override : undefined;
}

function buildPipelineExecutionOverrides(pipelines, execution) {
  const merged = {};
  const candidates = [
    toRecord(pipelines.pipelineOverrides),
    toRecord(pipelines.executionOverrides),
    toRecord(execution.pipelineOverrides),
    toRecord(execution.overrides),
  ];

  for (const candidate of candidates) {
    for (const [pipelineId, rawOverride] of Object.entries(candidate)) {
      const id = pipelineId.trim();
      const override = buildPipelineExecutionOverride(rawOverride);
      if (id && override) {
        merged[id] = {
          ...(isRecord(merged[id]) ? merged[id] : {}),
          ...override,
          slurm: {
            ...toRecord(merged[id]?.slurm),
            ...toRecord(override.slurm),
          },
        };
      }
    }
  }

  const pipelineIds = new Set([
    ...Object.keys(pipelines),
    ...discoverInstalledPipelineIds(),
  ]);

  for (const pipelineId of pipelineIds) {
    const pipelineConfig = toRecord(pipelines[pipelineId]);
    const override =
      buildPipelineExecutionOverride(pipelineConfig.execution) ||
      buildPipelineExecutionOverride(pipelineConfig.runtime);
    if (override) {
      merged[pipelineId] = {
        ...(isRecord(merged[pipelineId]) ? merged[pipelineId] : {}),
        ...override,
        slurm: {
          ...toRecord(merged[pipelineId]?.slurm),
          ...toRecord(override.slurm),
        },
      };
    }
  }

  return merged;
}

function buildPipelineProfileConfig(pipelines, pipelineId) {
  const merged = {};
  const configMaps = [
    toRecord(pipelines.configs),
    toRecord(pipelines.pipelineConfigs),
  ];

  for (const configMap of configMaps) {
    Object.assign(merged, toRecord(configMap[pipelineId]));
  }

  const pipelineConfig = toRecord(pipelines[pipelineId]);
  Object.assign(merged, toRecord(pipelineConfig.config));

  return merged;
}

function mergePipelineConfig(existingConfig, profileConfig) {
  return mergePipelineConfigWithManagedKeys(existingConfig, profileConfig);
}

function mergePipelineConfigWithManagedKeys(existingConfig, profileConfig, previousManagedKeys = []) {
  const nextConfig = {
    ...parseJsonObject(existingConfig),
  };
  const incomingKeys = new Set(Object.keys(profileConfig));
  for (const key of normalizeStringArray(previousManagedKeys)) {
    if (!incomingKeys.has(key)) {
      delete nextConfig[key];
    }
  }
  Object.assign(nextConfig, profileConfig);
  return Object.keys(nextConfig).length > 0 ? JSON.stringify(nextConfig) : null;
}

function normalizeSequencingFilesConfig(profile) {
  const sequencingFiles = toRecord(profile.sequencingFiles);
  const incoming = {};
  const allowedExtensions = normalizeStringArray(
    sequencingFiles.allowedExtensions || sequencingFiles.extensions
  );
  const scanDepth = toOptionalInt(sequencingFiles.scanDepth);
  const ignorePatterns = normalizeStringArray(sequencingFiles.ignorePatterns);
  const autoAssign = toOptionalBoolean(sequencingFiles.autoAssign);
  const activeWriteMinAgeMs = toOptionalNonNegativeInt(sequencingFiles.activeWriteMinAgeMs);
  const simulationMode = toOptionalString(sequencingFiles.simulationMode);
  const simulationTemplateDir = toOptionalString(sequencingFiles.simulationTemplateDir);

  if (allowedExtensions.length > 0) incoming.allowedExtensions = allowedExtensions;
  if (scanDepth !== undefined) incoming.scanDepth = scanDepth;
  if (ignorePatterns.length > 0) incoming.ignorePatterns = ignorePatterns;
  if (autoAssign !== undefined) incoming.autoAssign = autoAssign;
  if (activeWriteMinAgeMs !== undefined) incoming.activeWriteMinAgeMs = activeWriteMinAgeMs;
  if (["auto", "synthetic", "template"].includes(simulationMode)) {
    incoming.simulationMode = simulationMode;
  }
  if (simulationTemplateDir !== undefined) {
    incoming.simulationTemplateDir = simulationTemplateDir;
  }

  return incoming;
}

function normalizeAccessSettings(profile) {
  const access = toRecord(profile.access);
  const incoming = {};
  const departmentSharing = toOptionalBoolean(access.departmentSharing);
  const allowDeleteSubmittedOrders = toOptionalBoolean(access.allowDeleteSubmittedOrders);
  const allowUserAssemblyDownload = toOptionalBoolean(access.allowUserAssemblyDownload);
  const orderNotesEnabled = toOptionalBoolean(access.orderNotesEnabled);
  const postSubmissionInstructions =
    typeof access.postSubmissionInstructions === "string"
      ? access.postSubmissionInstructions
      : undefined;

  if (departmentSharing !== undefined) incoming.departmentSharing = departmentSharing;
  if (allowDeleteSubmittedOrders !== undefined) {
    incoming.allowDeleteSubmittedOrders = allowDeleteSubmittedOrders;
  }
  if (allowUserAssemblyDownload !== undefined) {
    incoming.allowUserAssemblyDownload = allowUserAssemblyDownload;
  }
  if (orderNotesEnabled !== undefined) incoming.orderNotesEnabled = orderNotesEnabled;
  if (postSubmissionInstructions !== undefined) {
    incoming.postSubmissionInstructions = postSubmissionInstructions;
  }

  return incoming;
}

function normalizeAuthSettings(profile) {
  const auth = toRecord(profile.auth);
  const incoming = {};
  const allowRegistration = toOptionalBoolean(auth.allowRegistration);
  if (allowRegistration !== undefined) incoming.allowRegistration = allowRegistration;
  return incoming;
}

function normalizeNotificationManagedSettings(profile) {
  const notifications = toRecord(profile.notifications);
  const inApp = toRecord(notifications.inApp);
  const incoming = {};
  const inAppEnabled = toOptionalBoolean(inApp.enabled);
  if (inAppEnabled !== undefined) incoming.inApp = { enabled: inAppEnabled };
  return incoming;
}

function normalizeAccountValidationSettings(profile) {
  const moduleSettings = toRecord(profile.moduleSettings);
  const source = toRecord(moduleSettings["account-validation"]);
  const incoming = {};
  const allowedDomains = Array.from(
    new Set(
      normalizeStringArray(source.allowedDomains)
        .map((domain) => domain.toLowerCase())
        .filter((domain) => domain.includes("."))
    )
  );
  const enforceValidation = toOptionalBoolean(source.enforceValidation);
  if (allowedDomains.length > 0) incoming.allowedDomains = allowedDomains;
  if (enforceValidation !== undefined) incoming.enforceValidation = enforceValidation;
  return incoming;
}

function normalizeRange(value) {
  const range = toRecord(value);
  const min = toOptionalNonNegativeInt(range.min);
  const max = toOptionalNonNegativeInt(range.max);
  if (min === undefined || max === undefined) return undefined;
  return { min, max };
}

function normalizeBillingSettings(profile) {
  const moduleSettings = toRecord(profile.moduleSettings);
  const source = toRecord(moduleSettings["billing-info"]);
  const incoming = {};
  const pspEnabled = toOptionalBoolean(source.pspEnabled);
  const pspPrefixRange = normalizeRange(source.pspPrefixRange);
  const pspMainDigits = toOptionalInt(source.pspMainDigits);
  const pspSuffixRange = normalizeRange(source.pspSuffixRange);
  const pspExample = toOptionalString(source.pspExample);
  const costCenterEnabled = toOptionalBoolean(source.costCenterEnabled);
  const costCenterPattern = toOptionalString(source.costCenterPattern);
  const costCenterExample = toOptionalString(source.costCenterExample);

  if (pspEnabled !== undefined) incoming.pspEnabled = pspEnabled;
  if (pspPrefixRange) incoming.pspPrefixRange = pspPrefixRange;
  if (pspMainDigits !== undefined) incoming.pspMainDigits = pspMainDigits;
  if (pspSuffixRange) incoming.pspSuffixRange = pspSuffixRange;
  if (pspExample) incoming.pspExample = pspExample;
  if (costCenterEnabled !== undefined) incoming.costCenterEnabled = costCenterEnabled;
  if (costCenterPattern) incoming.costCenterPattern = costCenterPattern;
  if (costCenterExample) incoming.costCenterExample = costCenterExample;

  return incoming;
}

function applyManagedJsonStringSetting(extra, managed, moduleId, storageKey, incoming) {
  const previousModuleSettings = toRecord(managed.moduleSettings);
  const previousKeys = normalizeStringArray(previousModuleSettings[moduleId]);
  if (Object.keys(incoming).length === 0 && previousKeys.length === 0) {
    return;
  }

  const merged = mergeManagedObject(parseJsonObject(extra[storageKey]), incoming, previousKeys);
  if (Object.keys(merged.object).length > 0) {
    extra[storageKey] = JSON.stringify(merged.object);
  } else {
    delete extra[storageKey];
  }
  previousModuleSettings[moduleId] = merged.managedKeys;
  managed.moduleSettings = previousModuleSettings;
}

function discoverInstalledPipelineIds() {
  const candidates = [
    path.join(process.cwd(), "pipelines"),
    path.join(process.cwd(), "..", "pipelines"),
  ];
  const pipelineIds = new Set();

  for (const pipelinesDir of candidates) {
    if (!fs.existsSync(pipelinesDir)) continue;

    let entries = [];
    try {
      entries = fs.readdirSync(pipelinesDir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name.startsWith(".") || entry.name.startsWith("_")) {
        continue;
      }

      const manifestPath = path.join(pipelinesDir, entry.name, "manifest.json");
      let pipelineId = entry.name;
      try {
        const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
        const manifestId = toOptionalString(toRecord(manifest.package).id);
        if (manifestId) pipelineId = manifestId;
      } catch {
        // Missing or invalid manifests are ignored by the runtime loader too.
      }
      pipelineIds.add(pipelineId);
    }

    break;
  }

  return Array.from(pipelineIds).sort();
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
  const existing = await prisma.orderFormConfig.findUnique({
    where: { id: ORDER_FORM_ID },
  });
  const existingSchema = parseJsonObject(existing?.schema);
  const managed = toRecord(existingSchema.installProfileManaged);
  if (
    profileForm.fields.length === 0 &&
    profileForm.groups.length === 0 &&
    profileForm.enabledMixsChecklists.length === 0 &&
    normalizeStringArray(managed.orderFormFields).length === 0 &&
    normalizeStringArray(managed.orderFormGroups).length === 0 &&
    normalizeStringArray(managed.orderFormEnabledMixsChecklists).length === 0
  ) {
    return false;
  }
  const groups = mergeManagedGroups(
    existingSchema.groups,
    profileForm.groups,
    managed.orderFormGroups
  );
  const fields = mergeManagedFields(
    existingSchema.fields,
    profileForm.fields,
    managed.orderFormFields
  );
  const enabledMixsChecklists = mergeManagedStringArrays(
    existingSchema.enabledMixsChecklists,
    profileForm.enabledMixsChecklists,
    managed.orderFormEnabledMixsChecklists
  );

  const nextSchema = {
    ...existingSchema,
    groups: groups.items,
    fields: fields.items,
    enabledMixsChecklists: enabledMixsChecklists.items,
    installProfileDefaultsVersion: profileForm.defaultsVersion,
    installProfileManaged: {
      ...managed,
      orderFormGroups: groups.managedKeys,
      orderFormFields: fields.managedKeys,
      orderFormEnabledMixsChecklists: enabledMixsChecklists.managedKeys,
    },
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
  const managed = toRecord(extra[INSTALL_PROFILE_MANAGED_KEY]);
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
  if (
    studyForm.fields.length > 0 ||
    studyForm.groups.length > 0 ||
    normalizeStringArray(managed.studyFormFields).length > 0 ||
    normalizeStringArray(managed.studyFormGroups).length > 0
  ) {
    const fields = mergeManagedFields(
      extra.studyFormFields,
      studyForm.fields,
      managed.studyFormFields
    );
    const groups = mergeManagedGroups(
      extra.studyFormGroups,
      studyForm.groups,
      managed.studyFormGroups
    );
    extra.studyFormFields = fields.items;
    extra.studyFormGroups = groups.items;
    extra.studyFormDefaultsVersion = studyForm.defaultsVersion;
    managed.studyFormFields = fields.managedKeys;
    managed.studyFormGroups = groups.managedKeys;
  }

  const runAssignmentForm = readFormConfig(profile, "runAssignment");
  if (
    runAssignmentForm.fields.length > 0 ||
    runAssignmentForm.groups.length > 0 ||
    normalizeStringArray(managed[RUN_ASSIGNMENT_FIELDS_KEY]).length > 0 ||
    normalizeStringArray(managed[RUN_ASSIGNMENT_GROUPS_KEY]).length > 0
  ) {
    const fields = mergeManagedFields(
      extra[RUN_ASSIGNMENT_FIELDS_KEY],
      runAssignmentForm.fields,
      managed[RUN_ASSIGNMENT_FIELDS_KEY]
    );
    const groups = mergeManagedGroups(
      extra[RUN_ASSIGNMENT_GROUPS_KEY],
      runAssignmentForm.groups,
      managed[RUN_ASSIGNMENT_GROUPS_KEY]
    );
    extra[RUN_ASSIGNMENT_FIELDS_KEY] = fields.items;
    extra[RUN_ASSIGNMENT_GROUPS_KEY] = groups.items;
    extra[RUN_ASSIGNMENT_DEFAULTS_VERSION_KEY] = runAssignmentForm.defaultsVersion;
    managed[RUN_ASSIGNMENT_FIELDS_KEY] = fields.managedKeys;
    managed[RUN_ASSIGNMENT_GROUPS_KEY] = groups.managedKeys;
  }

  const sequencingTech = toRecord(profile.sequencingTech);
  if (isRecord(sequencingTech.config)) {
    extra[SEQUENCING_TECH_CONFIG_KEY] = JSON.stringify(sequencingTech.config);
  }

  const sequencingFiles = normalizeSequencingFilesConfig(profile);
  const previousSequencingFilesKeys = normalizeStringArray(managed.sequencingFilesKeys);
  if (Object.keys(sequencingFiles).length > 0 || previousSequencingFilesKeys.length > 0) {
    const merged = mergeManagedObject(
      extra.sequencingFiles,
      sequencingFiles,
      previousSequencingFilesKeys
    );
    if (Object.keys(merged.object).length > 0) {
      extra.sequencingFiles = merged.object;
    } else {
      delete extra.sequencingFiles;
    }
    managed.sequencingFilesKeys = merged.managedKeys;
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
  const notificationManagedSettings = normalizeNotificationManagedSettings(profile);
  const previousNotificationKeys = normalizeStringArray(managed.notificationKeys);
  if (
    Object.keys(notificationManagedSettings).length > 0 ||
    previousNotificationKeys.length > 0
  ) {
    const merged = mergeManagedObject(
      extra.notifications,
      notificationManagedSettings,
      previousNotificationKeys
    );
    if (Object.keys(merged.object).length > 0) {
      extra.notifications = merged.object;
    } else {
      delete extra.notifications;
    }
    managed.notificationKeys = merged.managedKeys;
  }

  const accessSettings = normalizeAccessSettings(profile);
  const previousAccessKeys = normalizeStringArray(managed.accessKeys);
  if (Object.keys(accessSettings).length > 0 || previousAccessKeys.length > 0) {
    const nextAccessKeys = new Set(Object.keys(accessSettings));
    for (const key of previousAccessKeys) {
      if (nextAccessKeys.has(key)) continue;
      if (key === "postSubmissionInstructions") {
        update.postSubmissionInstructions = null;
      } else {
        delete extra[key];
      }
    }
    for (const [key, value] of Object.entries(accessSettings)) {
      if (key === "postSubmissionInstructions") {
        update.postSubmissionInstructions = value;
      } else {
        extra[key] = value;
      }
    }
    managed.accessKeys = Array.from(nextAccessKeys).sort();
  }

  const authSettings = normalizeAuthSettings(profile);
  const previousAuthKeys = normalizeStringArray(managed.authKeys);
  if (Object.keys(authSettings).length > 0 || previousAuthKeys.length > 0) {
    const merged = mergeManagedObject(extra.auth, authSettings, previousAuthKeys);
    if (Object.keys(merged.object).length > 0) {
      extra.auth = merged.object;
    } else {
      delete extra.auth;
    }
    managed.authKeys = merged.managedKeys;
  }

  applyManagedJsonStringSetting(
    extra,
    managed,
    "account-validation",
    ACCOUNT_VALIDATION_SETTINGS_KEY,
    normalizeAccountValidationSettings(profile)
  );
  applyManagedJsonStringSetting(
    extra,
    managed,
    "billing-info",
    BILLING_SETTINGS_KEY,
    normalizeBillingSettings(profile)
  );

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
  const pipelinesEnabled = toOptionalBoolean(pipelines.enabled);
  const enablePipelineIds = normalizeStringArray(pipelines.enable);
  const databaseDirectory = toOptionalString(pipelines.databaseDirectory);
  if (pipelinesEnabled === false) {
    extra[INSTALL_PROFILE_PIPELINE_ALLOWLIST_KEY] = [];
  } else if (pipelinesEnabled === true && enablePipelineIds.length > 0) {
    extra[INSTALL_PROFILE_PIPELINE_ALLOWLIST_KEY] = enablePipelineIds;
  }
  const execution = toRecord(pipelines.execution);
  const pipelineOverrides = buildPipelineExecutionOverrides(pipelines, execution);
  const previousExecutionKeys = normalizeStringArray(managed.pipelineExecutionKeys);
  const previousPipelineOverrideIds = normalizeStringArray(managed.pipelineOverrideIds);
  if (
    Object.keys(execution).length > 0 ||
    databaseDirectory ||
    Object.keys(pipelineOverrides).length > 0 ||
    previousExecutionKeys.length > 0 ||
    previousPipelineOverrideIds.length > 0
  ) {
    const slurm = toRecord(execution.slurm);
    const conda = toRecord(execution.conda);
    const currentExecution = isRecord(extra.pipelineExecution) ? extra.pipelineExecution : {};
    const nextExecution = {
      ...currentExecution,
      runtimeMode: "conda",
    };
    const nextManagedExecutionKeys = new Set();

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

    if (runDirectory && runDirectory !== "/") {
      nextExecution.pipelineRunDir = runDirectory;
      nextManagedExecutionKeys.add("pipelineRunDir");
    }
    if (mode === "slurm") {
      nextExecution.useSlurm = true;
      nextManagedExecutionKeys.add("useSlurm");
    }
    if (mode === "local") {
      nextExecution.useSlurm = false;
      nextManagedExecutionKeys.add("useSlurm");
    }
    if (useSlurm !== undefined) {
      nextExecution.useSlurm = useSlurm;
      nextManagedExecutionKeys.add("useSlurm");
    }
    if (slurmQueue) {
      nextExecution.slurmQueue = slurmQueue;
      nextManagedExecutionKeys.add("slurmQueue");
    }
    if (slurmCores !== undefined) {
      nextExecution.slurmCores = slurmCores;
      nextManagedExecutionKeys.add("slurmCores");
    }
    if (slurmMemory) {
      nextExecution.slurmMemory = slurmMemory;
      nextManagedExecutionKeys.add("slurmMemory");
    }
    if (slurmTimeLimit !== undefined) {
      nextExecution.slurmTimeLimit = slurmTimeLimit;
      nextManagedExecutionKeys.add("slurmTimeLimit");
    }
    if (slurmOptions !== undefined) {
      nextExecution.slurmOptions = slurmOptions;
      nextManagedExecutionKeys.add("slurmOptions");
    }
    if (condaPath !== undefined) {
      nextExecution.condaPath = condaPath;
      nextManagedExecutionKeys.add("condaPath");
    }
    if (condaEnv !== undefined) {
      nextExecution.condaEnv = condaEnv;
      nextManagedExecutionKeys.add("condaEnv");
    }
    if (nextflowProfile !== undefined) {
      nextExecution.nextflowProfile = nextflowProfile;
      nextManagedExecutionKeys.add("nextflowProfile");
    }
    if (weblogUrl !== undefined) {
      nextExecution.weblogUrl = weblogUrl;
      nextManagedExecutionKeys.add("weblogUrl");
    }
    if (weblogSecret !== undefined) {
      nextExecution.weblogSecret = weblogSecret;
      nextManagedExecutionKeys.add("weblogSecret");
    }
    if (databaseDirectory) {
      nextExecution.pipelineDatabaseDir = databaseDirectory;
      nextManagedExecutionKeys.add("pipelineDatabaseDir");
    }

    for (const key of previousExecutionKeys) {
      if (!nextManagedExecutionKeys.has(key)) {
        delete nextExecution[key];
      }
    }

    if (Object.keys(pipelineOverrides).length > 0 || previousPipelineOverrideIds.length > 0) {
      const nextPipelineOverrides = {
        ...toRecord(currentExecution.pipelineOverrides),
      };
      for (const pipelineId of previousPipelineOverrideIds) {
        if (!Object.prototype.hasOwnProperty.call(pipelineOverrides, pipelineId)) {
          delete nextPipelineOverrides[pipelineId];
        }
      }
      Object.assign(nextPipelineOverrides, pipelineOverrides);
      if (Object.keys(nextPipelineOverrides).length > 0) {
        nextExecution.pipelineOverrides = nextPipelineOverrides;
      } else {
        delete nextExecution.pipelineOverrides;
      }
    }

    extra.pipelineExecution = nextExecution;
    managed.pipelineExecutionKeys = Array.from(nextManagedExecutionKeys).sort();
    managed.pipelineOverrideIds = Object.keys(pipelineOverrides).sort();
  }

  extra.installProfile = {
    id: toOptionalString(profile.id) || "unknown",
    version: toOptionalString(profile.version) || "unknown",
    name: toOptionalString(toRecord(profile.profile).name) || toOptionalString(profile.id) || "Install profile",
    appliedAt: new Date().toISOString(),
  };

  if (isRecord(profile.seedData)) {
    extra.installProfileSeedData = profile.seedData;
  } else {
    delete extra.installProfileSeedData;
  }

  if (isRecord(profile.pipelineSmokeTests)) {
    extra.installProfilePipelineSmokeTests = profile.pipelineSmokeTests;
  } else {
    delete extra.installProfilePipelineSmokeTests;
  }

  extra[INSTALL_PROFILE_MANAGED_KEY] = managed;
  update.extraSettings = JSON.stringify(extra);
  await updateSiteSettings(prisma, update);

  return true;
}

async function applyPipelineEnablement(prisma, profile) {
  const pipelines = toRecord(profile.pipelines);
  const enabled = toOptionalBoolean(pipelines.enabled);
  const enableIds = normalizeStringArray(pipelines.enable);
  const allowlist = new Set(enableIds);
  const settings = await loadSiteSettings(prisma);
  const extra = parseJsonObject(settings?.extraSettings);
  const managed = toRecord(extra[INSTALL_PROFILE_MANAGED_KEY]);
  const previousPipelineConfigKeys = toRecord(managed.pipelineConfigKeys);
  const managedIds = Array.from(
    new Set([...discoverInstalledPipelineIds(), ...enableIds, ...Object.keys(previousPipelineConfigKeys)])
  ).sort();
  const nextPipelineConfigKeys = {};

  if (enabled === false) {
    for (const pipelineId of managedIds) {
      const existing = await prisma.pipelineConfig.findUnique({
        where: { pipelineId },
      });
      const config = mergePipelineConfigWithManagedKeys(
        existing?.config,
        {},
        previousPipelineConfigKeys[pipelineId]
      );
      await prisma.pipelineConfig.upsert({
        where: { pipelineId },
        update: {
          enabled: false,
          config,
        },
        create: {
          pipelineId,
          enabled: false,
          config: null,
        },
      });
    }
    managed.pipelineConfigKeys = nextPipelineConfigKeys;
    extra[INSTALL_PROFILE_MANAGED_KEY] = managed;
    await updateSiteSettings(prisma, { extraSettings: JSON.stringify(extra) });
    return 0;
  }

  if (
    enabled !== true ||
    (enableIds.length === 0 && Object.keys(previousPipelineConfigKeys).length === 0)
  ) {
    return 0;
  }

  for (const pipelineId of managedIds) {
    const existing = await prisma.pipelineConfig.findUnique({
      where: { pipelineId },
    });
    const profileConfig = buildPipelineProfileConfig(pipelines, pipelineId);
    const previousKeys = previousPipelineConfigKeys[pipelineId];
    const config =
      Object.keys(profileConfig).length > 0 || normalizeStringArray(previousKeys).length > 0
        ? mergePipelineConfigWithManagedKeys(existing?.config, profileConfig, previousKeys)
        : existing?.config || null;
    if (Object.keys(profileConfig).length > 0) {
      nextPipelineConfigKeys[pipelineId] = Object.keys(profileConfig).sort();
    }
    await prisma.pipelineConfig.upsert({
      where: { pipelineId },
      update: {
        enabled: allowlist.has(pipelineId),
        config,
      },
      create: {
        pipelineId,
        enabled: allowlist.has(pipelineId),
        config,
      },
    });
  }

  managed.pipelineConfigKeys = nextPipelineConfigKeys;
  extra[INSTALL_PROFILE_MANAGED_KEY] = managed;
  await updateSiteSettings(prisma, { extraSettings: JSON.stringify(extra) });

  return enableIds.length;
}

export async function applyInstallProfile(prisma, profile) {
  const appliedOrderForm = await applyOrderForm(prisma, profile);
  await applySiteProfile(prisma, profile);
  const enabledPipelines = await applyPipelineEnablement(prisma, profile);
  const persistedProfile = persistSafeInstallProfileMetadata(profile);

  return {
    appliedOrderForm,
    enabledPipelines,
    persistedProfile,
  };
}

export {
  applyManagedJsonStringSetting,
  applyOrderForm,
  applyPipelineEnablement,
  applySiteProfile,
  buildPipelineExecutionOverrides,
  buildSafeInstallProfileMetadata,
  ensureDatabaseEnv,
  mergeManagedObject,
  mergePipelineConfigWithManagedKeys,
  normalizeAccessSettings,
  normalizeAccountValidationSettings,
  normalizeAuthSettings,
  normalizeBillingSettings,
  normalizeNotificationManagedSettings,
  normalizeSequencingFilesConfig,
  normalizeStringArray,
  parseJsonObject,
  persistSafeInstallProfileMetadata,
  readJsonFile,
};
