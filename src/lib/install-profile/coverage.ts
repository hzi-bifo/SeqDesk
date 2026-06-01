export type InstallProfileBehavior =
  | "reload-safe"
  | "install-only"
  | "metadata-only"
  | "unsupported";

export type InstallProfileOwnership =
  | "profile-managed"
  | "merge-only"
  | "operator-owned"
  | "secret"
  | "none";

export interface InstallProfileCoverageEntry {
  surface: string;
  profilePath: string;
  storage: string;
  install: InstallProfileBehavior;
  reload: InstallProfileBehavior;
  sensitive: boolean;
  ownership: InstallProfileOwnership;
}

export interface InstallProfileSectionDisposition {
  section: string;
  kind: "structured" | "scalar" | "array";
  reload: InstallProfileBehavior;
}

export const INSTALL_PROFILE_SECTION_DISPOSITIONS: InstallProfileSectionDisposition[] = [
  { section: "addons", kind: "structured", reload: "metadata-only" },
  { section: "access", kind: "structured", reload: "reload-safe" },
  { section: "app", kind: "structured", reload: "install-only" },
  { section: "auth", kind: "structured", reload: "reload-safe" },
  { section: "bootstrap", kind: "structured", reload: "install-only" },
  { section: "capabilities", kind: "array", reload: "metadata-only" },
  { section: "ena", kind: "structured", reload: "reload-safe" },
  { section: "enabled", kind: "scalar", reload: "metadata-only" },
  { section: "environment", kind: "scalar", reload: "metadata-only" },
  { section: "forms", kind: "structured", reload: "reload-safe" },
  { section: "hostedDatabase", kind: "structured", reload: "metadata-only" },
  { section: "id", kind: "scalar", reload: "metadata-only" },
  { section: "install", kind: "structured", reload: "install-only" },
  { section: "lastUpdated", kind: "scalar", reload: "metadata-only" },
  { section: "minSeqDeskVersion", kind: "scalar", reload: "metadata-only" },
  { section: "minknowStream", kind: "structured", reload: "unsupported" },
  { section: "modules", kind: "structured", reload: "reload-safe" },
  { section: "moduleSettings", kind: "structured", reload: "reload-safe" },
  { section: "name", kind: "scalar", reload: "metadata-only" },
  { section: "notifications", kind: "structured", reload: "reload-safe" },
  { section: "pipelineSmokeTests", kind: "structured", reload: "reload-safe" },
  { section: "pipelines", kind: "structured", reload: "reload-safe" },
  { section: "privatePipelines", kind: "structured", reload: "install-only" },
  { section: "profile", kind: "structured", reload: "metadata-only" },
  { section: "requiresAccessCode", kind: "scalar", reload: "metadata-only" },
  { section: "requiredSecrets", kind: "array", reload: "metadata-only" },
  { section: "runtime", kind: "structured", reload: "install-only" },
  { section: "seedData", kind: "structured", reload: "reload-safe" },
  { section: "sequencingFiles", kind: "structured", reload: "reload-safe" },
  { section: "sequencingTech", kind: "structured", reload: "reload-safe" },
  { section: "shortDescription", kind: "scalar", reload: "metadata-only" },
  { section: "site", kind: "structured", reload: "reload-safe" },
  { section: "telemetry", kind: "structured", reload: "reload-safe" },
  { section: "testing", kind: "structured", reload: "install-only" },
  { section: "version", kind: "scalar", reload: "metadata-only" },
];

export const INSTALL_PROFILE_COVERAGE: InstallProfileCoverageEntry[] = [
  entry("site.name", "site.name", "SiteSettings.siteName", "reload-safe", "reload-safe", "profile-managed"),
  entry("site.dataBasePath", "site.dataBasePath", "SiteSettings.dataBasePath", "reload-safe", "reload-safe", "profile-managed"),
  entry("site.contactEmail", "site.contactEmail", "SiteSettings.contactEmail", "reload-safe", "reload-safe", "profile-managed"),
  entry("site.logoUrl", "site.logoUrl", "SiteSettings.logoUrl", "unsupported", "unsupported", "operator-owned"),
  entry("site.faviconUrl", "site.faviconUrl", "SiteSettings.faviconUrl", "unsupported", "unsupported", "operator-owned"),
  entry("site.primaryColor", "site.primaryColor", "SiteSettings.primaryColor", "unsupported", "unsupported", "operator-owned"),
  entry("site.secondaryColor", "site.secondaryColor", "SiteSettings.secondaryColor", "unsupported", "unsupported", "operator-owned"),
  entry("site.helpText", "site.helpText", "SiteSettings.helpText", "unsupported", "unsupported", "operator-owned"),
  entry("app.port", "app.port", "seqdesk.config.json app.port", "install-only", "install-only", "none"),
  entry("runtime.databaseUrl", "runtime.databaseUrl", ".env / seqdesk.config.json runtime.databaseUrl", "install-only", "install-only", "secret", true),
  entry("runtime.directUrl", "runtime.directUrl", ".env / seqdesk.config.json runtime.directUrl", "install-only", "install-only", "secret", true),
  entry("runtime.nextAuthUrl", "runtime.nextAuthUrl", ".env / seqdesk.config.json runtime.nextAuthUrl", "install-only", "install-only", "none"),
  entry("runtime.nextAuthSecret", "runtime.nextAuthSecret", ".env / seqdesk.config.json runtime.nextAuthSecret", "install-only", "install-only", "secret", true),
  entry("runtime.anthropicApiKey", "runtime.anthropicApiKey", ".env / seqdesk.config.json runtime.anthropicApiKey", "install-only", "install-only", "secret", true),
  entry("runtime.adminSecret", "runtime.adminSecret", ".env / seqdesk.config.json runtime.adminSecret", "install-only", "install-only", "secret", true),
  entry("runtime.blobReadWriteToken", "runtime.blobReadWriteToken", ".env / seqdesk.config.json runtime.blobReadWriteToken", "install-only", "install-only", "secret", true),
  entry("runtime.updateServer", "runtime.updateServer", ".env / seqdesk.config.json runtime.updateServer", "install-only", "install-only", "none"),
  entry("installProfile.id", "id", "seqdesk.config.json installProfile.id", "metadata-only", "metadata-only", "none"),
  entry("installProfile.name", "profile.name", "seqdesk.config.json installProfile.name", "metadata-only", "metadata-only", "none"),
  entry("installProfile.version", "version", "seqdesk.config.json installProfile.version", "metadata-only", "metadata-only", "none"),
  entry("installProfile.appliedAt", "appliedAt", "seqdesk.config.json installProfile.appliedAt", "metadata-only", "metadata-only", "none"),
  entry("ena.testMode", "ena.testMode", "SiteSettings.enaTestMode", "reload-safe", "reload-safe", "profile-managed"),
  entry("ena.username", "ena.username", "SiteSettings.enaUsername", "reload-safe", "reload-safe", "secret", true),
  entry("ena.password", "ena.password", "SiteSettings.enaPassword", "reload-safe", "reload-safe", "secret", true),
  entry("ena.brokerAccount", "ena.brokerAccount", "SiteSettings.extraSettings.ena.brokerAccount", "reload-safe", "reload-safe", "profile-managed"),
  entry("ena.centerName", "ena.centerName", "SiteSettings.extraSettings.ena.centerName", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.enabled", "pipelines.enabled", "SiteSettings.extraSettings.installProfilePipelineAllowlist", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.enable", "pipelines.enable", "SiteSettings.extraSettings.installProfilePipelineAllowlist", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.databaseDirectory", "pipelines.databaseDirectory", "SiteSettings.extraSettings.pipelineExecution.pipelineDatabaseDir", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.mode", "pipelines.execution.mode", "SiteSettings.extraSettings.pipelineExecution.useSlurm", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.runDirectory", "pipelines.execution.runDirectory", "SiteSettings.extraSettings.pipelineExecution.pipelineRunDir", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.pipelineRunDir", "pipelines.execution.pipelineRunDir", "SiteSettings.extraSettings.pipelineExecution.pipelineRunDir", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.conda.enabled", "pipelines.execution.conda.enabled", "ignored; runtimeMode is always conda", "unsupported", "unsupported", "none"),
  entry("pipelines.execution.conda.path", "pipelines.execution.conda.path", "SiteSettings.extraSettings.pipelineExecution.condaPath", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.conda.environment", "pipelines.execution.conda.environment", "SiteSettings.extraSettings.pipelineExecution.condaEnv", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.slurm.enabled", "pipelines.execution.slurm.enabled", "SiteSettings.extraSettings.pipelineExecution.useSlurm", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.slurm.queue", "pipelines.execution.slurm.queue", "SiteSettings.extraSettings.pipelineExecution.slurmQueue", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.slurm.cores", "pipelines.execution.slurm.cores", "SiteSettings.extraSettings.pipelineExecution.slurmCores", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.slurm.memory", "pipelines.execution.slurm.memory", "SiteSettings.extraSettings.pipelineExecution.slurmMemory", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.slurm.timeLimit", "pipelines.execution.slurm.timeLimit", "SiteSettings.extraSettings.pipelineExecution.slurmTimeLimit", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.slurm.options", "pipelines.execution.slurm.options", "SiteSettings.extraSettings.pipelineExecution.slurmOptions", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.execution.pipelineOverrides", "pipelines.execution.pipelineOverrides", "SiteSettings.extraSettings.pipelineExecution.pipelineOverrides", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.mag.enabled", "pipelines.mag.enabled", "PipelineConfig.enabled for mag", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.mag.version", "pipelines.mag.version", "PipelineConfig.config for mag", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.mag.stubMode", "pipelines.mag.stubMode", "PipelineConfig.config for mag", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.mag.skipProkka", "pipelines.mag.skipProkka", "PipelineConfig.config for mag", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.mag.skipConcoct", "pipelines.mag.skipConcoct", "PipelineConfig.config for mag", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.configs", "pipelines.configs", "PipelineConfig.config by pipeline id", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelines.databases", "pipelines.databases", "Pipeline database asset pass", "reload-safe", "reload-safe", "profile-managed"),
  entry("forms.order", "forms.order", "OrderFormConfig.schema", "reload-safe", "reload-safe", "profile-managed"),
  entry("forms.study", "forms.study", "SiteSettings.extraSettings.studyForm*", "reload-safe", "reload-safe", "profile-managed"),
  entry("forms.runAssignment", "forms.runAssignment", "SiteSettings.extraSettings.sequencingRunSampleForm*", "reload-safe", "reload-safe", "profile-managed"),
  entry("hostedDatabase", "hostedDatabase", "SeqDesk.com profile metadata", "metadata-only", "metadata-only", "none"),
  entry("modules", "modules", "SiteSettings.modulesConfig", "reload-safe", "reload-safe", "merge-only"),
  entry("sequencingTech", "sequencingTech.config", "SiteSettings.extraSettings.sequencingTechConfig", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.extensions", "sequencingFiles.extensions", "SiteSettings.extraSettings.sequencingFiles.allowedExtensions", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.allowedExtensions", "sequencingFiles.allowedExtensions", "SiteSettings.extraSettings.sequencingFiles.allowedExtensions", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.scanDepth", "sequencingFiles.scanDepth", "SiteSettings.extraSettings.sequencingFiles.scanDepth", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.allowSingleEnd", "sequencingFiles.allowSingleEnd", "forced true in runtime", "unsupported", "unsupported", "operator-owned"),
  entry("sequencingFiles.ignorePatterns", "sequencingFiles.ignorePatterns", "SiteSettings.extraSettings.sequencingFiles.ignorePatterns", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.autoAssign", "sequencingFiles.autoAssign", "SiteSettings.extraSettings.sequencingFiles.autoAssign", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.activeWriteMinAgeMs", "sequencingFiles.activeWriteMinAgeMs", "SiteSettings.extraSettings.sequencingFiles.activeWriteMinAgeMs", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.simulationMode", "sequencingFiles.simulationMode", "SiteSettings.extraSettings.sequencingFiles.simulationMode", "reload-safe", "reload-safe", "profile-managed"),
  entry("sequencingFiles.simulationTemplateDir", "sequencingFiles.simulationTemplateDir", "SiteSettings.extraSettings.sequencingFiles.simulationTemplateDir", "reload-safe", "reload-safe", "profile-managed"),
  entry("auth.allowRegistration", "auth.allowRegistration", "SiteSettings.extraSettings.auth.allowRegistration", "reload-safe", "reload-safe", "profile-managed"),
  entry("auth.requireEmailVerification", "auth.requireEmailVerification", "not implemented by auth runtime", "unsupported", "unsupported", "none"),
  entry("auth.sessionTimeout", "auth.sessionTimeout", "not implemented by auth runtime", "unsupported", "unsupported", "none"),
  entry("notifications.enabled", "notifications.enabled", "SiteSettings.extraSettings.notifications.enabled", "reload-safe", "reload-safe", "merge-only"),
  entry("notifications.inApp.enabled", "notifications.inApp.enabled", "SiteSettings.extraSettings.notifications.inApp.enabled", "reload-safe", "reload-safe", "profile-managed"),
  entry("notifications.provider", "notifications.provider", "SiteSettings.extraSettings.notifications.provider", "reload-safe", "reload-safe", "merge-only"),
  entry("notifications.relayUrl", "notifications.relayUrl", "SiteSettings.extraSettings.notifications.relayUrl", "reload-safe", "reload-safe", "merge-only"),
  entry("notifications.relayToken", "notifications.relayToken", "config/env only; never DB profile metadata", "install-only", "install-only", "secret", true),
  entry("notifications.events", "notifications.events", "SiteSettings.extraSettings.notifications.events", "reload-safe", "reload-safe", "merge-only"),
  entry("notifications.userDefaults", "notifications.userDefaults", "SiteSettings.extraSettings.notifications.userDefaults", "reload-safe", "reload-safe", "merge-only"),
  entry("telemetry.enabled", "telemetry.enabled", "SiteSettings.extraSettings.telemetry.enabled", "reload-safe", "reload-safe", "merge-only"),
  entry("telemetry.endpoint", "telemetry.endpoint", "SiteSettings.extraSettings.telemetry.endpoint", "reload-safe", "reload-safe", "merge-only"),
  entry("telemetry.intervalHours", "telemetry.intervalHours", "SiteSettings.extraSettings.telemetry.intervalHours", "reload-safe", "reload-safe", "merge-only"),
  entry("access.departmentSharing", "access.departmentSharing", "SiteSettings.extraSettings.departmentSharing", "reload-safe", "reload-safe", "profile-managed"),
  entry("access.allowDeleteSubmittedOrders", "access.allowDeleteSubmittedOrders", "SiteSettings.extraSettings.allowDeleteSubmittedOrders", "reload-safe", "reload-safe", "profile-managed"),
  entry("access.allowUserAssemblyDownload", "access.allowUserAssemblyDownload", "SiteSettings.extraSettings.allowUserAssemblyDownload", "reload-safe", "reload-safe", "profile-managed"),
  entry("access.orderNotesEnabled", "access.orderNotesEnabled", "SiteSettings.extraSettings.orderNotesEnabled", "reload-safe", "reload-safe", "profile-managed"),
  entry("access.postSubmissionInstructions", "access.postSubmissionInstructions", "SiteSettings.postSubmissionInstructions", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.account-validation.allowedDomains", "moduleSettings.account-validation.allowedDomains", "SiteSettings.extraSettings.accountValidationSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.account-validation.enforceValidation", "moduleSettings.account-validation.enforceValidation", "SiteSettings.extraSettings.accountValidationSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.pspEnabled", "moduleSettings.billing-info.pspEnabled", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.pspPrefixRange", "moduleSettings.billing-info.pspPrefixRange", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.pspMainDigits", "moduleSettings.billing-info.pspMainDigits", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.pspSuffixRange", "moduleSettings.billing-info.pspSuffixRange", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.pspExample", "moduleSettings.billing-info.pspExample", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.costCenterEnabled", "moduleSettings.billing-info.costCenterEnabled", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.costCenterPattern", "moduleSettings.billing-info.costCenterPattern", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("moduleSettings.billing-info.costCenterExample", "moduleSettings.billing-info.costCenterExample", "SiteSettings.extraSettings.billingSettings", "reload-safe", "reload-safe", "profile-managed"),
  entry("minknowStream", "minknowStream", "SiteSettings.extraSettings.minknowStream", "unsupported", "unsupported", "operator-owned"),
  entry("seedData", "seedData", "SiteSettings.extraSettings.installProfileSeedData + asset pass", "reload-safe", "reload-safe", "profile-managed"),
  entry("pipelineSmokeTests", "pipelineSmokeTests", "SiteSettings.extraSettings.installProfilePipelineSmokeTests", "reload-safe", "reload-safe", "profile-managed"),
  entry("privatePipelines", "privatePipelines", "installer package acquisition", "install-only", "install-only", "secret", true),
  entry("bootstrap.users", "bootstrap.users", "initial seed env", "install-only", "install-only", "secret", true),
  entry("install.dir", "install.dir", "distribution installer", "install-only", "install-only", "none"),
  entry("install.usePm2", "install.usePm2", "distribution installer", "install-only", "install-only", "none"),
  entry("testing.runtimeSmoke", "testing.runtimeSmoke", "install canary metadata", "install-only", "install-only", "none"),
];

export const KNOWN_INSTALL_PROFILE_SECTIONS = new Set(
  INSTALL_PROFILE_SECTION_DISPOSITIONS.map((item) => item.section)
);

export const STRUCTURED_INSTALL_PROFILE_SECTIONS = new Set(
  INSTALL_PROFILE_SECTION_DISPOSITIONS
    .filter((item) => item.kind === "structured")
    .map((item) => item.section)
);

export const INSTALL_ONLY_PROFILE_SECTIONS = new Set(
  INSTALL_PROFILE_SECTION_DISPOSITIONS
    .filter((item) => item.reload === "install-only")
    .map((item) => item.section)
);

export const UNSUPPORTED_PROFILE_SECTIONS = new Set(
  INSTALL_PROFILE_SECTION_DISPOSITIONS
    .filter((item) => item.reload === "unsupported")
    .map((item) => item.section)
);

export function isCoveredProfileSurface(surface: string): boolean {
  return INSTALL_PROFILE_COVERAGE.some(
    (entry) => entry.surface === surface || wildcardMatches(entry.surface, surface)
  );
}

function wildcardMatches(pattern: string, value: string): boolean {
  if (!pattern.includes("*")) return false;
  const [prefix, suffix] = pattern.split("*", 2);
  return value.startsWith(prefix) && value.endsWith(suffix ?? "");
}

function entry(
  surface: string,
  profilePath: string,
  storage: string,
  install: InstallProfileBehavior,
  reload: InstallProfileBehavior,
  ownership: InstallProfileOwnership,
  sensitive = false
): InstallProfileCoverageEntry {
  return {
    surface,
    profilePath,
    storage,
    install,
    reload,
    sensitive,
    ownership,
  };
}
