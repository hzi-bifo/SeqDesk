import { describe, expect, it } from "vitest";

import { INSTALL_PLAN_SCHEMA_VERSION, parseInstallPlan } from "./install-plan";

function validPlan() {
  return {
    schemaVersion: INSTALL_PLAN_SCHEMA_VERSION,
    operation: "install",
    target: { directory: "/srv/seqdesk", classification: "new" },
    release: {
      version: "1.2.3",
      source: "https://seqdesk.org/api/version",
      checksum: "sha256:abc",
      estimatedDownloadBytes: 1234,
    },
    preflight: {
      targetWritable: true,
      installationAvailableBytes: 10_000_000_000,
      installationRequiredBytes: 2_147_483_648,
      storageAvailableBytes: {
        managedData: 20_000_000_000,
        pipelineRuns: 20_000_000_000,
        pipelineCache: 20_000_000_000,
      },
    },
    deployment: {
      profile: "research-workbench",
      featureModules: { "account-validation": true },
    },
    access: {
      audience: "team-server",
      browserUrl: "https://seqdesk.example.org",
      bindHost: "127.0.0.1",
      port: 8000,
      localHealthUrl: "http://127.0.0.1:8000",
    },
    database: {
      mode: "existing",
      runtimeUrlRef: "protected-input:database-url",
      directUrlRef: "protected-input:database-direct-url",
    },
    storage: {
      managedDataRoot: "/srv/seqdesk-data",
      runRoot: "/srv/seqdesk-data/pipeline-runs",
      cacheRoot: "/srv/seqdesk-data/pipeline-databases",
    },
    execution: {
      prepareNow: true,
      executor: "local",
      starterPackages: [],
      runSmokeTest: false,
      runtimeDownload: { status: "resolved-at-apply" },
    },
    service: {
      manager: "pm2",
      startNow: true,
      startOnBootRequested: true,
    },
    enrollment: { policy: "invite-only" },
    bootstrap: {
      adminEmail: "admin@example.org",
      adminName: "",
      passwordRef: "protected-operator-input",
    },
    optional: { exampleData: false, telemetry: false },
    sources: { "deployment.profile": "answer", storage: "answer" },
    lockedPaths: [],
    warnings: [],
  } as const;
}

describe("InstallPlan", () => {
  it("parses a complete sanitized plan", () => {
    expect(parseInstallPlan(validPlan()).schemaVersion).toBe(1);
  });

  it("rejects connection URLs where a protected reference is required", () => {
    const plan = validPlan();
    expect(() =>
      parseInstallPlan({
        ...plan,
        database: {
          ...plan.database,
          runtimeUrlRef: "postgresql://seqdesk:secret@db.example/seqdesk",
        },
      })
    ).toThrow(/protected references/i);
  });

  it("rejects unsafe local and team-server access combinations", () => {
    const plan = validPlan();
    expect(() =>
      parseInstallPlan({
        ...plan,
        access: {
          ...plan.access,
          audience: "local",
          browserUrl: "https://seqdesk.example.org",
        },
      })
    ).toThrow(/loopback listener/i);

    expect(() =>
      parseInstallPlan({
        ...plan,
        access: {
          ...plan.access,
          audience: "team-server",
          browserUrl: "http://seqdesk.example.org",
        },
      })
    ).toThrow(/non-local HTTPS/i);
  });

  it("rejects unknown plan keys so new inputs fail closed", () => {
    expect(() => parseInstallPlan({ ...validPlan(), databasePassword: "secret" })).toThrow(
      /unrecognized key/i
    );
  });

  it("rejects service behavior that conflicts with the selected manager", () => {
    expect(() =>
      parseInstallPlan({
        ...validPlan(),
        service: { manager: "manual", startNow: true, startOnBootRequested: false },
      })
    ).toThrow(/service manager conflicts/i);
  });

  it("requires a size when workflow runtime downloads are estimated", () => {
    const plan = validPlan();
    expect(() =>
      parseInstallPlan({
        ...plan,
        execution: {
          ...plan.execution,
          runtimeDownload: { status: "estimated" },
        },
      })
    ).toThrow(/estimated byte size/i);
  });

  it("rejects feature modules that require a domain absent from the deployment profile", () => {
    const plan = validPlan();
    expect(() =>
      parseInstallPlan({
        ...plan,
        deployment: {
          ...plan.deployment,
          featureModules: { "billing-info": true },
        },
      })
    ).toThrow(
      /Research workbench cannot enable modules\.billing-info[\s\S]*facility-intake[\s\S]*Disable modules\.billing-info/
    );
  });

  it("fails closed when an install plan names an unknown feature module", () => {
    const plan = validPlan();
    expect(() =>
      parseInstallPlan({
        ...plan,
        deployment: {
          ...plan.deployment,
          featureModules: { "billing-inof": true },
        },
      })
    ).toThrow(/modules\.billing-inof is not a recognized SeqDesk feature module/);
  });

  it("keeps schema-version-one plans without module overrides backward compatible", () => {
    const plan = validPlan();
    const deployment = { profile: plan.deployment.profile };
    expect(parseInstallPlan({ ...plan, deployment }).deployment.featureModules).toEqual(
      {}
    );
  });
});
