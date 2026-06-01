import { describe, expect, it } from "vitest";
import {
  INSTALL_PROFILE_COVERAGE,
  INSTALL_PROFILE_SECTION_DISPOSITIONS,
  isCoveredProfileSurface,
} from "./coverage";

const seqDeskConfigSurfaces = [
  "app.port",
  "installProfile.id",
  "installProfile.name",
  "installProfile.version",
  "installProfile.appliedAt",
  "site.name",
  "site.dataBasePath",
  "site.contactEmail",
  "pipelines.enabled",
  "pipelines.databaseDirectory",
  "pipelines.execution.mode",
  "pipelines.execution.runDirectory",
  "pipelines.execution.conda.enabled",
  "pipelines.execution.conda.path",
  "pipelines.execution.conda.environment",
  "pipelines.execution.slurm.enabled",
  "pipelines.execution.slurm.queue",
  "pipelines.execution.slurm.cores",
  "pipelines.execution.slurm.memory",
  "pipelines.execution.slurm.timeLimit",
  "pipelines.execution.slurm.options",
  "pipelines.execution.pipelineOverrides",
  "pipelines.mag.enabled",
  "pipelines.mag.version",
  "pipelines.mag.stubMode",
  "pipelines.mag.skipProkka",
  "pipelines.mag.skipConcoct",
  "ena.testMode",
  "ena.username",
  "ena.password",
  "ena.brokerAccount",
  "ena.centerName",
  "sequencingFiles.extensions",
  "sequencingFiles.scanDepth",
  "sequencingFiles.allowSingleEnd",
  "sequencingFiles.ignorePatterns",
  "sequencingFiles.simulationMode",
  "sequencingFiles.simulationTemplateDir",
  "auth.allowRegistration",
  "auth.requireEmailVerification",
  "auth.sessionTimeout",
  "telemetry.enabled",
  "telemetry.endpoint",
  "telemetry.intervalHours",
  "notifications.enabled",
  "notifications.inApp.enabled",
  "notifications.provider",
  "notifications.relayUrl",
  "notifications.relayToken",
  "notifications.events",
  "notifications.userDefaults",
  "runtime.databaseUrl",
  "runtime.directUrl",
  "runtime.nextAuthUrl",
  "runtime.nextAuthSecret",
  "runtime.anthropicApiKey",
  "runtime.adminSecret",
  "runtime.blobReadWriteToken",
  "runtime.updateServer",
];

const siteSettingsSurfaces = [
  "site.name",
  "site.logoUrl",
  "site.faviconUrl",
  "site.primaryColor",
  "site.secondaryColor",
  "site.contactEmail",
  "site.helpText",
  "ena.username",
  "ena.password",
  "ena.testMode",
  "site.dataBasePath",
  "access.postSubmissionInstructions",
  "modules",
];

const adminSettingsSurfaces = [
  "sequencingFiles.allowedExtensions",
  "sequencingFiles.scanDepth",
  "sequencingFiles.ignorePatterns",
  "sequencingFiles.autoAssign",
  "sequencingFiles.activeWriteMinAgeMs",
  "sequencingFiles.simulationMode",
  "sequencingFiles.simulationTemplateDir",
  "access.departmentSharing",
  "access.allowDeleteSubmittedOrders",
  "access.allowUserAssemblyDownload",
  "access.orderNotesEnabled",
  "access.postSubmissionInstructions",
  "moduleSettings.account-validation.allowedDomains",
  "moduleSettings.account-validation.enforceValidation",
  "moduleSettings.billing-info.pspEnabled",
  "moduleSettings.billing-info.pspPrefixRange",
  "moduleSettings.billing-info.pspMainDigits",
  "moduleSettings.billing-info.pspSuffixRange",
  "moduleSettings.billing-info.pspExample",
  "moduleSettings.billing-info.costCenterEnabled",
  "moduleSettings.billing-info.costCenterPattern",
  "moduleSettings.billing-info.costCenterExample",
  "minknowStream",
];

describe("install profile coverage matrix", () => {
  it("classifies every known app, database, module, and admin setting surface", () => {
    const expectedSurfaces = [
      ...seqDeskConfigSurfaces,
      ...siteSettingsSurfaces,
      ...adminSettingsSurfaces,
    ];
    const missing = expectedSurfaces.filter((surface) => !isCoveredProfileSurface(surface));

    expect(missing).toEqual([]);
  });

  it("classifies every supported top-level profile section for reload behavior", () => {
    const expectedSections = [
      "addons",
      "access",
      "app",
      "auth",
      "bootstrap",
      "capabilities",
      "ena",
      "enabled",
      "environment",
      "forms",
      "hostedDatabase",
      "id",
      "install",
      "lastUpdated",
      "minSeqDeskVersion",
      "minknowStream",
      "modules",
      "moduleSettings",
      "name",
      "notifications",
      "pipelineSmokeTests",
      "pipelines",
      "privatePipelines",
      "profile",
      "requiresAccessCode",
      "requiredSecrets",
      "runtime",
      "seedData",
      "sequencingFiles",
      "sequencingTech",
      "shortDescription",
      "site",
      "telemetry",
      "testing",
      "version",
    ];
    const sections = INSTALL_PROFILE_SECTION_DISPOSITIONS.map((entry) => entry.section);

    expect(sections.sort()).toEqual(expectedSections.sort());
  });

  it("marks secret-bearing surfaces as sensitive", () => {
    const secretSurfaces = INSTALL_PROFILE_COVERAGE.filter(
      (entry) => entry.ownership === "secret" || entry.storage.includes("secret")
    );

    expect(secretSurfaces.length).toBeGreaterThan(0);
    expect(secretSurfaces.every((entry) => entry.sensitive)).toBe(true);
  });
});
