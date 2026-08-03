import fs from "fs";
import { load } from "js-yaml";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const readWorkflow = (name: string) =>
  fs.readFileSync(path.join(repoRoot, ".github", "workflows", name), "utf8");

const canonical = readWorkflow("pipeline-slurm-e2e.yml");
const mirror = readWorkflow("mirror-to-private.yml");
const publicTests = readWorkflow("test.yml");
const publicInstaller = readWorkflow("install-e2e-ubuntu.yml");
const playwrightWorkflow = readWorkflow("playwright.yml");
const almaExtended = readWorkflow("install-profile-alma.yml");
const orderPipeline = readWorkflow("order-pipeline-e2e.yml");
const studyPipeline = readWorkflow("study-pipeline-e2e.yml");
const twincoreInstall = readWorkflow("install-twincore-alma.yml");
const krakenProbe = readWorkflow("kraken-db-probe.yml");
const readOnlySelfHostedWorkflows = [
  ["extended Alma install", almaExtended],
  ["order pipeline", orderPipeline],
  ["study pipeline", studyPipeline],
  ["Twincore canary install", twincoreInstall],
  ["Kraken DB probe", krakenProbe],
] as const;
const runtimeHarness = fs.readFileSync(
  path.join(repoRoot, "scripts", "run-pipeline-runtime-e2e.mjs"),
  "utf8"
);
const cancelHarness = fs.readFileSync(
  path.join(repoRoot, "scripts", "run-slurm-cancel-e2e.mjs"),
  "utf8"
);
const appcheckHarness = fs.readFileSync(
  path.join(repoRoot, "scripts", "run-pipeline-appcheck-e2e.mjs"),
  "utf8"
);
const storeHarness = fs.readFileSync(
  path.join(repoRoot, "scripts", "run-pipeline-store-e2e.mjs"),
  "utf8"
);
const pipelineCliHarness = fs.readFileSync(
  path.join(repoRoot, "scripts", "run-pipeline-cli-e2e.mjs"),
  "utf8"
);
const pipelineProofHarness = fs.readFileSync(
  path.join(repoRoot, "scripts", "lib", "pipeline-e2e-proof.mjs"),
  "utf8"
);
const realStoreBrowserSpec = fs.readFileSync(
  path.join(
    repoRoot,
    "playwright",
    "tests",
    "pipeline-store-real.admin.spec.ts"
  ),
  "utf8"
);
const externalStorePlaywrightConfig = fs.readFileSync(
  path.join(repoRoot, "playwright.pipeline-store.config.ts"),
  "utf8"
);
const commandProbeHarnesses = [
  ["run-pipeline-appcheck-e2e.mjs", appcheckHarness],
  ["run-pipeline-runtime-e2e.mjs", runtimeHarness],
  ["run-slurm-cancel-e2e.mjs", cancelHarness],
  ...["run-slurm-failure-e2e.mjs", "run-slurm-pipeline-e2e.mjs"].map(
    (name) =>
      [
        name,
        fs.readFileSync(path.join(repoRoot, "scripts", name), "utf8"),
      ] as const
  ),
] as const;
const metaxpathSlurmLeg = fs.readFileSync(
  path.join(repoRoot, "scripts", "metaxpath-slurm-leg.sh"),
  "utf8"
);
const magSlurmLeg = fs.readFileSync(
  path.join(repoRoot, "scripts", "mag-slurm-leg.sh"),
  "utf8"
);
const almaDbCleanup = fs.readFileSync(
  path.join(repoRoot, "scripts", "cleanup-db-pipeline-runs.sh"),
  "utf8"
);
const publicOnlyWorkflows = [
  "ena-submission-e2e.yml",
  "install-e2e-ubuntu.yml",
  "install-profile-ubuntu-smoke.yml",
  "install-real-network-smoke.yml",
  "mirror-to-private.yml",
  "pipeline-submg-e2e.yml",
  "playwright.yml",
  "published-installer-drift.yml",
  "reviewer-install-matrix.yml",
  "test.yml",
] as const;

interface WorkflowDocument {
  jobs?: Record<string, { if?: string }>;
}

interface PackageManifest {
  scripts?: Record<string, string>;
}

interface TypeScriptConfig {
  extends?: string;
  exclude?: string[];
}

describe("self-hosted pipeline CI contract", () => {
  it.each(publicOnlyWorkflows)(
    "keeps every %s job out of the private CI mirror",
    (workflowName) => {
      const workflow = load(readWorkflow(workflowName)) as WorkflowDocument;
      const jobs = Object.entries(workflow.jobs || {});

      expect(jobs.length).toBeGreaterThan(0);
      for (const [jobName, job] of jobs) {
        expect(
          job.if,
          `${workflowName}/${jobName} must be guarded to the public repository`
        ).toContain("github.repository == 'hzi-bifo/SeqDesk'");
      }
    }
  );

  it.each(readOnlySelfHostedWorkflows)(
    "keeps the %s workflow read-only and free of scheduled triggers",
    (_name, workflow) => {
      expect(workflow).toContain("permissions:\n  contents: read");
      expect(workflow).not.toContain("contents: write");
      expect(workflow).not.toMatch(/^\s*contents:\s*write\s*$/m);
      expect(workflow).not.toMatch(/^\s*git\b[^\n]*\bpush\b/m);
      expect(workflow).not.toContain("schedule:");
      expect(workflow).not.toContain("cron:");
    }
  );

  it("runs the canonical private acceptance gate on mirrored main changes, never a timer", () => {
    expect(canonical).toContain("push:\n    branches: [main]");
    expect(canonical).toContain("workflow_dispatch:");
    expect(canonical).not.toContain("schedule:");
    expect(canonical).not.toContain("cron:");
    expect(canonical).toContain(
      "github.repository == 'hzi-bifo/SeqDesk-ci'"
    );
  });

  it("publishes the commit-specific result from a separate least-privilege job", () => {
    const publisherJobStart = canonical.indexOf("\n  publish_private_result:");
    const pipelineJob = canonical.slice(
      canonical.indexOf("\n  slurm_app_e2e:"),
      publisherJobStart
    );
    const publisherJob = canonical.slice(publisherJobStart);

    expect(publisherJobStart).toBeGreaterThanOrEqual(0);
    expect(canonical).toContain("permissions:\n  contents: read");
    expect(pipelineJob).not.toContain("contents: write");
    expect(pipelineJob).not.toMatch(/^\s*git push\b/m);
    expect(publisherJob).toContain("needs: slurm_app_e2e");
    expect(publisherJob).toContain("runs-on: ubuntu-latest");
    expect(publisherJob).toContain("permissions:");
    expect(publisherJob).toContain("contents: write");
    expect(publisherJob).toContain(
      "if: ${{ always() && github.event_name == 'push' && github.repository == 'hzi-bifo/SeqDesk-ci' }}"
    );
    expect(publisherJob).toContain("ref: ${{ github.sha }}");
    expect(publisherJob).toContain(
      "PRIVATE_GATE_STATUS: ${{ needs.slurm_app_e2e.result }}"
    );
    expect(publisherJob).toContain(
      'RESULT_TAG="seqdesk-private-ci/${GITHUB_SHA}/${RESULT}"'
    );
    expect(publisherJob).toContain(
      'OPPOSITE_TAG="seqdesk-private-ci/${GITHUB_SHA}/${OPPOSITE}"'
    );
    expect(publisherJob).toContain(
      'if git ls-remote --exit-code origin "refs/tags/$OPPOSITE_TAG"'
    );
    expect(publisherJob).toContain(
      'git push origin ":refs/tags/$OPPOSITE_TAG"'
    );
    expect(publisherJob).toContain(
      'git push --force origin "refs/tags/$RESULT_TAG"'
    );
    expect(publisherJob).toContain(
      "Any non-success conclusion (failure, cancelled, skipped, timed out)"
    );
    expect(publisherJob).not.toContain("refs/heads/");
  });

  it("gates production types without treating test-only typing debt as a release failure", () => {
    const packageManifest = JSON.parse(
      fs.readFileSync(path.join(repoRoot, "package.json"), "utf8")
    ) as PackageManifest;
    const productionConfig = JSON.parse(
      fs.readFileSync(
        path.join(repoRoot, "tsconfig.production.json"),
        "utf8"
      )
    ) as TypeScriptConfig;
    const nextConfig = fs.readFileSync(
      path.join(repoRoot, "next.config.ts"),
      "utf8"
    );

    expect(packageManifest.scripts?.["typecheck:production"]).toContain(
      "tsc -p tsconfig.production.json"
    );
    expect(packageManifest.scripts?.["typecheck:all"]).toContain(
      "tsc -p tsconfig.json"
    );
    expect(productionConfig.extends).toBe("./tsconfig.json");
    expect(productionConfig.exclude).toEqual(
      expect.arrayContaining([
        "**/*.test.ts",
        "**/*.test.tsx",
        "**/*.spec.ts",
        "**/*.spec.tsx",
        "playwright/**",
      ])
    );
    expect(nextConfig).toContain(
      'tsconfigPath: "tsconfig.production.json"'
    );
    expect(publicTests).toContain("run: npm run typecheck:production");
    expect(canonical).toContain("npm run build -- --webpack");
  });

  it("runs focused Store, readiness, activation, rollback, and workflow contracts before full-tier coverage", () => {
    const focusedGate = publicTests.slice(
      publicTests.indexOf(
        "- name: Gate pipeline Store, readiness, enable, and rollback contracts"
      ),
      publicTests.indexOf("- name: Run tests with coverage")
    );

    expect(focusedGate).not.toContain("continue-on-error:");
    expect(focusedGate).toContain(
      "scripts/fastq-ground-truth.test.ts"
    );
    expect(focusedGate).toContain(
      "scripts/lib/conda-environment.test.ts"
    );
    expect(focusedGate).toContain(
      "scripts/pipeline-e2e-config.test.ts"
    );
    expect(focusedGate).toContain(
      "scripts/pipeline-e2e-proof.test.ts"
    );
    expect(focusedGate).toContain(
      "scripts/pipeline-e2e-sync.test.ts"
    );
    expect(focusedGate).toContain(
      "scripts/pipeline-cli-e2e.test.ts"
    );
    expect(focusedGate).toContain(
      "scripts/pipeline-store-e2e-fixture.test.ts"
    );
    expect(focusedGate).toContain(
      "src/app/admin/settings/pipelines/client-utils.test.ts"
    );
    expect(focusedGate).toContain(
      "src/app/api/admin/settings/pipelines/download-db/route.test.ts"
    );
    expect(focusedGate).toContain(
      "src/app/api/admin/settings/pipelines/install/route.test.ts"
    );
    expect(focusedGate).toContain(
      "src/app/api/admin/settings/pipelines/route.test.ts"
    );
    expect(focusedGate).toContain(
      "src/app/api/admin/settings/pipelines/store/route.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/config/miniconda-installer-selection.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/config/setup-conda-env-bootstrap.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/conda-environment.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/config-schema-validation.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/database-downloads.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/generic-executor.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/manifest-schema.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/multiqc-contract.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/package-descriptor-schema.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/package-install.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/pipeline-cli-script.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/pipeline-e2e-coverage.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/prior-run-artifact-staging.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/prerequisite-check.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/slurm-completion-attestation.test.ts"
    );
    expect(focusedGate).toContain(
      "src/lib/pipelines/ci-workflow-contract.test.ts"
    );
    expect(publicTests).toMatch(
      /^\s*run: npm run test:coverage:all\s*$/m
    );
    expect(publicTests).not.toMatch(
      /^\s*run: npm run test:coverage\s*$/m
    );
  });

  it("provisions and migrates the database required by the all-tier coverage run", () => {
    expect(publicTests).toContain("services:\n      postgres:");
    expect(publicTests).toContain("image: postgres:16");
    expect(publicTests).toContain("POSTGRES_DB: seqdesk_test");
    expect(publicTests).toContain(
      "DATABASE_URL: postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_test?schema=public"
    );
    expect(publicTests).toContain(
      "DIRECT_URL: postgresql://seqdesk:seqdesk@127.0.0.1:5432/seqdesk_test?schema=public"
    );
    expect(publicTests).toContain("- name: Prepare test database");
    expect(publicTests).toContain("run: npm run db:migrate:deploy");
    expect(publicTests.indexOf("- name: Prepare test database")).toBeLessThan(
      publicTests.indexOf("- name: Run tests with coverage")
    );
  });

  it("runs the real Store browser journey separately against an isolated package tree and fixture registry", () => {
    const broadBrowserGate = playwrightWorkflow.slice(
      playwrightWorkflow.indexOf("- name: Run Playwright tests"),
      playwrightWorkflow.indexOf("- name: Run real pipeline Store browser flow")
    );
    const realStoreGate = playwrightWorkflow.slice(
      playwrightWorkflow.indexOf("- name: Run real pipeline Store browser flow"),
      playwrightWorkflow.indexOf("- name: Upload Playwright report")
    );

    expect(broadBrowserGate).toContain("run: npm run test:e2e");
    expect(realStoreGate).not.toContain("continue-on-error:");
    expect(realStoreGate).toContain(
      "SEQDESK_PIPELINE_REGISTRY_URL: http://127.0.0.1:3219/registry"
    );
    expect(realStoreGate).toContain(
      "SEQDESK_PLAYWRIGHT_STORE_FIXTURE_URL: http://127.0.0.1:3219"
    );
    expect(realStoreGate).toContain(
      'SEQDESK_PIPELINE_STORE_E2E_FAULTS: "1"'
    );
    expect(realStoreGate).toContain(
      'STORE_PIPELINES_DIR="$RUNNER_TEMP/playwright-real-store-pipelines"'
    );
    expect(realStoreGate).toContain('mkdir -p "$STORE_PIPELINES_DIR"');
    expect(realStoreGate).toContain(
      'SEQDESK_PIPELINES_DIR="$STORE_PIPELINES_DIR"'
    );
    expect(realStoreGate).toContain(
      "playwright/tests/pipeline-store-real.admin.spec.ts"
    );
    expect(realStoreGate).toContain("--project=chromium-admin");
    expect(realStoreGate).toContain("--no-deps");
    expect(realStoreGate).toContain("--workers=1");
    expect(realStoreGate).toContain("--repeat-each=2");

    expect(realStoreBrowserSpec).toContain("startPipelineStoreFixture({");
    expect(realStoreBrowserSpec).toContain("fixtureUrl: fixtureUrl!");
    expect(realStoreBrowserSpec).not.toContain("page.route(");
    expect(realStoreBrowserSpec).not.toContain("route.fulfill(");
    expect(realStoreBrowserSpec).toContain(
      'getByRole("button", { name: "Install", exact: true })'
    );
    expect(realStoreBrowserSpec).toContain(
      'data-setup-action",\n        "configure"'
    );
    expect(realStoreBrowserSpec).toContain(
      'data-setup-action",\n        "download-db"'
    );
    expect(realStoreBrowserSpec).toContain(
      'data-setup-action",\n        "configure-runtime"'
    );
    expect(realStoreBrowserSpec).toContain(
      'data-setup-action",\n        "enable"'
    );
    expect(realStoreBrowserSpec).toContain(
      'data-setup-action",\n        "complete"'
    );
    expect(realStoreBrowserSpec).toContain(
      "activeFixture.advertiseBrokenUpdate()"
    );
    expect(realStoreBrowserSpec).toContain(
      "version: PIPELINE_STORE_FIXTURE_V1"
    );
    expect(realStoreBrowserSpec).toContain("enabled: true");
    expect(realStoreBrowserSpec).toContain(
      "fixtureLabel: CONFIGURED_LABEL"
    );
    expect(realStoreBrowserSpec).toContain(
      "provisionPipelineStoreFixtureResource({"
    );
    expect(realStoreBrowserSpec).not.toContain(
      'getByLabel("Fixture database")'
    );
    expect(realStoreBrowserSpec).toContain(
      '.endsWith("/api/admin/settings/pipelines/download-db")'
    );
    expect(realStoreBrowserSpec).toContain(
      'getByRole("button", { name: "Download", exact: true })'
    );
    expect(realStoreBrowserSpec).toContain("blockResourceDownload: true");
    expect(realStoreBrowserSpec).toContain(
      "await activeFixture.waitForResourceDownloadRequest()"
    );
    expect(realStoreBrowserSpec).toContain(
      "activeFixture.releaseResourceDownload()"
    );
    expect(realStoreBrowserSpec).toContain('state: "running"');
    expect(realStoreBrowserSpec).toContain('state: "success"');
    expect(realStoreBrowserSpec).toContain(
      "PIPELINE_STORE_FIXTURE_DATABASE_SHA256"
    );
    expect(realStoreBrowserSpec).toContain(
      'getByLabel("Pipeline Run Directory")'
    );
    expect(realStoreBrowserSpec).toContain(
      'name: "Save Runtime Settings"'
    );
    expect(realStoreBrowserSpec).toContain(
      'message: "Exists and writable"'
    );
    expect(realStoreBrowserSpec).toContain(
      "path: new URL(activeFixture.v1Url).pathname"
    );
    expect(realStoreBrowserSpec).toContain(
      "path: new URL(activeFixture.v2Url).pathname"
    );
    expect(realStoreBrowserSpec).toContain(
      "assertActiveFixturePackageOnDisk()"
    );
    expect(realStoreBrowserSpec).toContain(
      "buildValidPipelineStorePackage(PIPELINE_ID)"
    );
    expect(realStoreBrowserSpec).toContain(
      `/api/admin/settings/pipelines/\${encodeURIComponent(PIPELINE_ID)}/lint`
    );
    expect(realStoreBrowserSpec).toContain(
      "packageStats.isSymbolicLink()"
    );
  });

  it("runs the full real-browser guided setup as a required self-hosted gate", () => {
    const chromiumInstall = canonical.slice(
      canonical.indexOf(
        "- name: Install Chromium for the required guided Store browser gate"
      ),
      canonical.indexOf("- name: Set database connection environment")
    );
    const sourceBoot = canonical.slice(
      canonical.indexOf("- name: Boot SeqDesk app and verify readiness"),
      canonical.indexOf(
        "- name: Gate source app guided Store setup in a real browser"
      )
    );
    const browserGate = canonical.slice(
      canonical.indexOf(
        "- name: Gate source app guided Store setup in a real browser"
      ),
      canonical.indexOf(
        "- name: Gate source app pipeline Store, readiness, enable, and rollback"
      )
    );

    expect(canonical).toContain(
      "- name: Install Chromium for the required guided Store browser gate"
    );
    expect(chromiumInstall).toContain("at-spi2-atk=2.38.0");
    expect(chromiumInstall).toContain('ldd "$BROWSER_BIN"');
    expect(chromiumInstall).toContain(
      "libatk-bridge-2.0.so.0 => not found"
    );
    expect(chromiumInstall).toContain("Chromium still has unresolved runtime libraries");
    expect(chromiumInstall).toContain(
      "SEQDESK_PLAYWRIGHT_LD_LIBRARY_PATH=$PLAYWRIGHT_LD_LIBRARY_PATH"
    );
    expect(sourceBoot).not.toContain(
      'export SEQDESK_PIPELINE_RUN_DIR="$SEQDESK_RUN_DIR"'
    );
    expect(sourceBoot).toContain("unset SEQDESK_PIPELINE_RUN_DIR");
    expect(sourceBoot).toContain(
      'export SEQDESK_PLAYWRIGHT_STORE_FIXTURE_URL="http://127.0.0.1:${STORE_E2E_FIXTURE_PORT}"'
    );
    expect(sourceBoot).toContain(
      "export SEQDESK_PIPELINE_STORE_E2E_FAULTS=1"
    );
    expect(browserGate).not.toContain("continue-on-error:");
    expect(browserGate).toContain(
      "LD_LIBRARY_PATH: ${{ env.SEQDESK_PLAYWRIGHT_LD_LIBRARY_PATH }}"
    );
    expect(browserGate).toContain(
      "playwright/tests/pipeline-store-real.admin.spec.ts"
    );
    expect(browserGate).toContain(
      "--config=playwright.pipeline-store.config.ts"
    );
    expect(browserGate).toContain("--project=chromium-real-store");
    expect(browserGate).toContain("--repeat-each=2");
    expect(browserGate).toContain(
      "SEQDESK_PLAYWRIGHT_RUNTIME_READY_DIR: ${{ env.SEQDESK_RUN_DIR }}"
    );
    expect(browserGate).toContain(
      "SEQDESK_PLAYWRIGHT_HANDOFF_RUN_DIR: ${{ env.SEQDESK_RUN_DIR }}"
    );
    expect(browserGate).toContain(
      "SEQDESK_PLAYWRIGHT_HANDOFF_DATABASE_DIR: ${{ env.SEQDESK_DB_DIR }}"
    );
    expect(browserGate).toContain(
      "SEQDESK_PLAYWRIGHT_STORE_PIPELINES_ROOT: ${{ env.SEQDESK_STAGED_PIPELINES_DIR }}"
    );
    expect(externalStorePlaywrightConfig).toContain(
      'const baseURL = process.env.PLAYWRIGHT_BASE_URL'
    );
    expect(externalStorePlaywrightConfig).toContain("workers: 1");
    expect(externalStorePlaywrightConfig).not.toContain("webServer:");
    const realBrowserTestBody = realStoreBrowserSpec.slice(
      realStoreBrowserSpec.indexOf(
        '"drives the real Store install, config, database, runtime, enable, and failed-update flow"'
      )
    );
    expect(
      realBrowserTestBody.indexOf(
        "siteSettingsSnapshot = await readSiteSettingsSnapshot()"
      )
    ).toBeGreaterThanOrEqual(0);
    expect(
      realBrowserTestBody.indexOf(
        "siteSettingsSnapshot = await readSiteSettingsSnapshot()"
      )
    ).toBeLessThan(
      realBrowserTestBody.indexOf("await setPipelineExecutionPaths(")
    );
    expect(realStoreBrowserSpec).toMatch(
      /restoreSiteSettings\(\s*siteSettingsSnapshot,\s*persistentHandoff/
    );
    expect(realStoreBrowserSpec).toContain(
      "cannot point into the disposable Pipeline Store resource root"
    );
    expect(canonical).toContain(
      "${{ github.workspace }}/playwright-report"
    );
    expect(canonical).toContain("${{ github.workspace }}/test-results");
  });

  it("requires the deterministic Store/readiness/enable/rollback flow on source and freshly installed self-hosted apps", () => {
    const sourceBoot = canonical.slice(
      canonical.indexOf("- name: Boot SeqDesk app and verify readiness"),
      canonical.indexOf(
        "- name: Gate source app pipeline Store, readiness, enable, and rollback"
      )
    );
    const sourceStoreGate = canonical.slice(
      canonical.indexOf(
        "- name: Gate source app pipeline Store, readiness, enable, and rollback"
      ),
      canonical.indexOf(
        "- name: Run the Store-installed pipeline locally and through SLURM"
      )
    );
    const sourceStoreRuntimeGate = canonical.slice(
      canonical.indexOf(
        "- name: Run the Store-installed pipeline locally and through SLURM"
      ),
      canonical.indexOf(
        "- name: Run required fastq-checksum E2E"
      )
    );
    const installedGate = canonical.slice(
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      ),
      canonical.indexOf("- name: Collect SLURM + pipeline diagnostics")
    );
    const installedStoreRuntimeGate = installedGate.slice(
      installedGate.indexOf(
        "::group::installed Store pipeline -> local + real SLURM execution"
      ),
      installedGate.indexOf(
        "=== run pipelines through the INSTALLED app"
      )
    );

    expect(canonical).toContain(
      'echo "STORE_E2E_FIXTURE_PORT=$((PORT + 3))" >> "$GITHUB_ENV"'
    );
    expect(sourceBoot).toContain(
      'SHARED_PIPELINES_DIR="$SEQDESK_STAGED_PIPELINES_DIR"'
    );
    expect(sourceBoot).toContain(
      'export SEQDESK_PIPELINES_DIR="$SHARED_PIPELINES_DIR"'
    );
    expect(sourceBoot).toContain(
      'export SEQDESK_PIPELINE_REGISTRY_URL="http://127.0.0.1:${STORE_E2E_FIXTURE_PORT}/registry"'
    );
    expect(sourceStoreGate).not.toContain("continue-on-error:");
    expect(sourceStoreGate).toContain(
      'node "$GITHUB_WORKSPACE/scripts/run-pipeline-store-e2e.mjs"'
    );
    expect(sourceStoreGate).toContain(
      '--fixture-url "http://127.0.0.1:${STORE_E2E_FIXTURE_PORT}"'
    );
    expect(sourceStoreGate).toContain("--expect-readiness ready");
    expect(sourceStoreGate).toContain("--expected-execution-mode slurm");
    expect(sourceStoreGate).toContain(
      '--fixture-resource-root "$SEQDESK_DB_DIR/source-store-e2e"'
    );
    expect(sourceStoreGate).toContain('--result-file "$STORE_E2E_JSON"');
    expect(sourceStoreRuntimeGate).not.toContain("continue-on-error:");
    expect(sourceStoreRuntimeGate).toContain(
      'result?.fixture?.pipelineId'
    );
    expect(sourceStoreRuntimeGate).toContain(
      'result?.configuration?.value'
    );
    expect(sourceStoreRuntimeGate).toContain(
      "npm run pipeline:e2e:runtime --"
    );
    expect(sourceStoreRuntimeGate).toContain(
      '--pipeline-id "$FIXTURE_PIPELINE_ID"'
    );
    expect(sourceStoreRuntimeGate).toContain(
      '--expected-pipeline-root "$SEQDESK_STAGED_PIPELINES_DIR"'
    );
    expect(sourceStoreRuntimeGate).toContain("--saved-config-only");
    expect(sourceStoreRuntimeGate).not.toContain("--config-json");
    expect(sourceStoreRuntimeGate).not.toContain("FIXTURE_DATABASE");
    expect(sourceStoreRuntimeGate).not.toContain("FIXTURE_CONFIG");
    expect(sourceStoreRuntimeGate).toContain(
      "--required-relative-output output/results/fixture-report.txt"
    );
    expect(sourceStoreRuntimeGate).toContain(
      '--required-output-contains "$FIXTURE_LABEL"'
    );
    expect(sourceStoreRuntimeGate).toContain(
      "--required-artifact-output-id fixture_report"
    );
    expect(sourceStoreRuntimeGate).toContain(
      '--run-state-file "$STORE_RUNTIME_E2E_STATE"'
    );
    expect(sourceStoreRuntimeGate).toContain(
      "Runtime harness verified the saved Store configuration in every local and SLURM run."
    );
    expect(sourceStoreRuntimeGate).not.toContain("STORE_RUN_FOLDER=");
    expect(sourceStoreRuntimeGate).not.toContain("STORE_REPORT=");
    expect(installedGate).toContain(
      'export SEQDESK_PIPELINE_REGISTRY_URL="http://127.0.0.1:${STORE_E2E_FIXTURE_PORT}/registry"'
    );
    expect(installedGate).toContain(
      "::group::installed app Store -> configure -> readiness -> enable -> failed update -> rollback"
    );
    expect(installedGate).toContain(
      'node "$GITHUB_WORKSPACE/scripts/run-pipeline-store-e2e.mjs"'
    );
    expect(installedGate).toContain(
      '--result-file "$INSTALLED_STORE_E2E_JSON"'
    );
    expect(installedGate).toContain("--expect-readiness ready");
    expect(installedGate).toContain("--expected-execution-mode slurm");
    expect(installedGate).toContain(
      '--fixture-resource-root "$SEQDESK_DB_DIR/installed-store-e2e"'
    );
    expect(installedGate).toContain(
      'INSTALLED_STORE_E2E_JSON="$DIAG_OUT/installed-store-e2e-$GITHUB_RUN_ID-$GITHUB_RUN_ATTEMPT.json"'
    );
    expect(installedGate.indexOf("::group::installed app Store ->")).toBeLessThan(
      installedGate.indexOf(
        "::group::installed Store pipeline -> local + real SLURM execution"
      )
    );
    expect(installedGate).toContain(
      '--pipeline-id "$INSTALLED_FIXTURE_PIPELINE_ID"'
    );
    expect(installedStoreRuntimeGate).toContain(
      '--expected-pipeline-root "$PACKAGED_PIPELINES_ROOT"'
    );
    expect(installedGate).toContain("--saved-config-only");
    expect(installedGate).not.toContain("INSTALLED_FIXTURE_DATABASE");
    expect(installedGate).not.toContain("INSTALLED_FIXTURE_CONFIG");
    expect(installedStoreRuntimeGate).not.toContain("--config-json");
    expect(installedGate).toContain(
      "--required-relative-output output/results/fixture-report.txt"
    );
    expect(installedGate).toContain(
      '--required-output-contains "$INSTALLED_FIXTURE_LABEL"'
    );
    expect(installedGate).toContain(
      "--required-artifact-output-id fixture_report"
    );
    expect(installedGate).toContain(
      '--run-state-file "$INSTALLED_STORE_RUNTIME_STATE"'
    );
    expect(installedGate).toContain(
      "Runtime harness verified the installed app's saved Store configuration in every local and real SLURM run."
    );
    expect(installedGate).not.toContain("INSTALLED_STORE_RUN_FOLDER=");
    expect(installedGate).not.toContain("INSTALLED_STORE_REPORT=");
    expect(
      installedGate.indexOf(
        "::group::installed Store pipeline -> local + real SLURM execution"
      )
    ).toBeLessThan(
      installedGate.indexOf(
        "=== run pipelines through the INSTALLED app"
      )
    );
    expect(canonical).toContain("${{ env.STORE_E2E_LOG }}");
    expect(canonical).toContain("${{ env.STORE_E2E_JSON }}");
    expect(canonical).toContain("${{ env.STORE_RUNTIME_E2E_LOG }}");
    expect(canonical).toContain("${{ env.STORE_RUNTIME_E2E_STATE }}");
    expect(canonical.match(/--fixture-url/g)).toHaveLength(3);
    expect(canonical.match(/--required-relative-output/g)).toHaveLength(3);
    expect(canonical.match(/--required-output-contains/g)).toHaveLength(3);
    expect(canonical.match(/--required-artifact-output-id/g)).toHaveLength(3);
    expect(canonical.match(/--saved-config-only/g)).toHaveLength(3);

    expect(runtimeHarness).toContain('"saved-config-only"');
    expect(runtimeHarness).toContain(
      "buildRuntimeRunCreateBody({"
    );
    expect(runtimeHarness).toContain(
      'configSource: savedConfigOnly ? "saved-pipeline-config" : "per-run"'
    );

    expect(storeHarness).toContain("startPipelineStoreFixture({");
    expect(storeHarness).toContain(
      "AbortSignal.timeout(APP_REQUEST_TIMEOUT_MS)"
    );
    expect(storeHarness).toContain(
      "SeqDesk request timed out after ${APP_REQUEST_TIMEOUT_MS / 1000}s"
    );
    expect(storeHarness).toContain(
      'requiredConfigBefore?.status === "missing"'
    );
    expect(storeHarness).toContain(
      'configuredPipeline.readiness?.canEnable === true'
    );
    expect(storeHarness).toContain(
      'activation.response.status === 200'
    );
    expect(storeHarness).toContain("fixture.advertiseBrokenUpdate()");
    expect(storeHarness).toContain(
      'update.response.status === 422'
    );
    expect(storeHarness).toContain(
      'afterRollback?.version === PIPELINE_STORE_FIXTURE_V1'
    );
    expect(storeHarness).toContain(
      'afterRollback?.enabled === expectedEnabled'
    );
    expect(storeHarness).toContain(
      'afterRollback?.config?.fixtureLabel === configuredValue'
    );
  });

  it("runs the installed user CLI from a neutral directory and executes its installed package locally and on real SLURM", () => {
    const installedGate = canonical.slice(
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      ),
      canonical.indexOf("- name: Collect SLURM + pipeline diagnostics")
    );
    const cliGate = installedGate.slice(
      installedGate.indexOf(
        "::group::installed user CLI -> list -> install -> setup -> idempotence -> concurrency -> rollback"
      ),
      installedGate.indexOf(
        "::group::installed app Store -> configure -> readiness -> enable -> failed update -> rollback"
      )
    );
    const cliRuntimeGate = cliGate.slice(
      cliGate.indexOf(
        "::group::CLI-installed pipeline -> local + real SLURM execution"
      )
    );

    expect(installedGate).toContain(
      'USER_CLI_BIN="$WORK/user-bin"; USER_CLI_CONFIG_HOME="$WORK/user-config"'
    );
    expect(installedGate).toContain(
      'USER_CLI_COMMAND="$USER_CLI_BIN/seqdesk"'
    );
    expect(installedGate).toContain(
      'USER_CLI_POINTER="$USER_CLI_CONFIG_HOME/seqdesk/default-install"'
    );
    expect(installedGate).toContain(
      '"$USER_CLI_COMMAND" storage configure "$INSTALLED_DATA"'
    );
    expect(installedGate).toContain(
      '"$USER_CLI_COMMAND" storage status'
    );
    expect(installedGate).toContain(
      'status?.sources?.database !== storagePath'
    );
    expect(installedGate).toContain(
      'XDG_CONFIG_HOME="$USER_CLI_CONFIG_HOME"'
    );
    expect(installedGate).toContain(
      'SEQDESK_CLI_BIN_DIR="$USER_CLI_BIN"'
    );
    expect(installedGate).toContain(
      'if [ ! -x "$USER_CLI_COMMAND" ]'
    );
    expect(installedGate).toContain(
      'if [ ! -r "$USER_CLI_POINTER" ]'
    );
    expect(installedGate).toContain(
      'if [ "$USER_CLI_POINTER_VALUE" != "$APP_DIR" ]'
    );
    expect(installedGate).toContain(
      'if [ ! -L "$INSTALLED_RELEASE_DIR/pipelines" ]'
    );
    expect(installedGate).toContain(
      'ROOT_PIPELINES_REAL="$(cd "$APP_DIR/pipelines" && pwd -P)"'
    );
    expect(installedGate).toContain(
      'RELEASE_PIPELINES_REAL="$(cd "$INSTALLED_RELEASE_DIR/pipelines" && pwd -P)"'
    );
    expect(installedGate).toContain(
      'if [ "$ROOT_PIPELINES_REAL" != "$RELEASE_PIPELINES_REAL" ]'
    );

    expect(cliGate).not.toContain("continue-on-error:");
    expect(cliGate).toContain("env -u SEQDESK_DIR");
    expect(cliGate).toContain(
      'node "$GITHUB_WORKSPACE/scripts/run-pipeline-cli-e2e.mjs"'
    );
    expect(cliGate).toContain('--seqdesk-command "$USER_CLI_COMMAND"');
    expect(cliGate).toContain(
      '--neutral-cwd "$INSTALLED_CLI_NEUTRAL_CWD"'
    );
    expect(cliGate).toContain(
      '--fixture-resource-root "$SEQDESK_DB_DIR/installed-cli-e2e"'
    );
    expect(cliGate).toContain('--result-file "$INSTALLED_CLI_E2E_JSON"');
    expect(cliGate).not.toContain('--dir "$APP_DIR"');
    expect(cliGate).toContain("result?.primary?.pipelineId");
    expect(cliGate).toContain("result?.primary?.marker");

    expect(cliRuntimeGate).toContain("npm run pipeline:e2e:runtime --");
    expect(cliRuntimeGate).toContain(
      '--expected-pipeline-root "$PACKAGED_PIPELINES_ROOT"'
    );
    expect(cliRuntimeGate).toContain(
      '--pipeline-id "$INSTALLED_CLI_FIXTURE_PIPELINE_ID"'
    );
    expect(cliRuntimeGate).toContain("--saved-config-only");
    expect(cliRuntimeGate).toContain(
      "--required-relative-output output/results/fixture-report.txt"
    );
    expect(cliRuntimeGate).toContain(
      '--required-output-contains "$INSTALLED_CLI_FIXTURE_LABEL"'
    );
    expect(cliRuntimeGate).toContain(
      "--required-artifact-output-id fixture_report"
    );
    expect(cliRuntimeGate).toContain(
      '--run-state-file "$INSTALLED_CLI_RUNTIME_STATE"'
    );
    expect(cliRuntimeGate).not.toContain("--skip-local");
    expect(cliRuntimeGate).not.toContain("--skip-slurm");

    expect(pipelineCliHarness).toContain(
      "cwd: context.neutralCwd"
    );
    expect(pipelineCliHarness).toContain(
      'available?.packageState === "available"'
    );
    expect(pipelineCliHarness).toMatch(/"--catalog",\s*"order"/);
    expect(pipelineCliHarness).toMatch(/"--catalog",\s*"study"/);
    expect(pipelineCliHarness).toContain(
      '["pipelines", "install", pipelineId, "--json"]'
    );
    expect(pipelineCliHarness).toContain(
      'findReadiness(blockedPipeline, "required-config")?.status === "missing"'
    );
    expect(pipelineCliHarness).toContain(
      'findReadiness(blockedPipeline, "databases")?.status === "missing"'
    );
    expect(pipelineCliHarness).toContain(
      'readyPipeline?.activationState === "enabled"'
    );
    expect(pipelineCliHarness).toContain(
      '"--installed",'
    );
    expect(pipelineCliHarness).toContain(
      "fixture.advertiseBrokenUpdate()"
    );
    expect(pipelineCliHarness).toContain(
      "packageVersion(rollbackPipeline) === PIPELINE_STORE_FIXTURE_V1"
    );
    expect(pipelineCliHarness).toContain(
      "Promise.all([cliPromise, apiPromise])"
    );
    expect(pipelineCliHarness).toContain(
      "assertNoInstallDebris(path.dirname(packageDir), pipelineId)"
    );
  });

  it("isolates the core-only Conda bootstrap regression test on the self-hosted runner", () => {
    const bootstrapGate = canonical.slice(
      canonical.indexOf(
        "- name: Verify core-only pipeline runtime bootstrap"
      ),
      canonical.indexOf(
        "- name: Install Chromium for the required guided Store browser gate"
      )
    );

    expect(bootstrapGate).not.toContain("continue-on-error:");
    expect(bootstrapGate).toContain(
      "src/lib/config/miniconda-installer-selection.test.ts"
    );
    expect(bootstrapGate).toContain(
      "src/lib/config/setup-conda-env-bootstrap.test.ts"
    );
  });

  it("verifies the configured Store output inside every runtime run, not only the final run-state", () => {
    const sourceStoreRuntimeGate = canonical.slice(
      canonical.indexOf(
        "- name: Run the Store-installed pipeline locally and through SLURM"
      ),
      canonical.indexOf(
        "- name: Run required fastq-checksum E2E"
      )
    );
    const installedGate = canonical.slice(
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      ),
      canonical.indexOf("- name: Collect SLURM + pipeline diagnostics")
    );
    const runFilesGate = runtimeHarness.slice(
      runtimeHarness.indexOf("async function assertRunFiles"),
      runtimeHarness.indexOf("const MD5_HEX")
    );
    const localRuntime = runtimeHarness.slice(
      runtimeHarness.indexOf("if (!skipLocal)"),
      runtimeHarness.indexOf("if (!skipSlurm)")
    );
    const slurmRuntime = runtimeHarness.slice(
      runtimeHarness.indexOf("if (!skipSlurm)"),
      runtimeHarness.indexOf("if (includeDefaultPolicy)")
    );
    const defaultRuntime = runtimeHarness.slice(
      runtimeHarness.indexOf("if (includeDefaultPolicy)"),
      runtimeHarness.indexOf(
        "\n  return {",
        runtimeHarness.indexOf("if (includeDefaultPolicy)")
      )
    );

    expect(runtimeHarness).toContain('args["required-relative-output"]');
    expect(runtimeHarness).toContain('args["required-output-contains"]');
    expect(runtimeHarness).toContain(
      'args["required-artifact-output-id"]'
    );
    expect(runtimeHarness).toContain(
      "SEQDESK_RUNTIME_E2E_REQUIRED_RELATIVE_OUTPUT"
    );
    expect(runtimeHarness).toContain(
      "SEQDESK_RUNTIME_E2E_REQUIRED_OUTPUT_CONTAINS"
    );
    expect(runtimeHarness).toContain(
      '"--required-output-contains requires --required-relative-output"'
    );
    expect(runtimeHarness).toContain(
      '"--required-artifact-output-id requires --required-relative-output"'
    );
    expect(runFilesGate).toContain("assertRequiredRelativeOutput({");
    expect(runFilesGate).toContain(
      "relativePath: requiredOutputExpectation.relativePath"
    );
    expect(runFilesGate).toContain(
      "requiredContent: requiredOutputExpectation.requiredContent"
    );
    expect(localRuntime).toContain("requiredOutputExpectation,");
    expect(slurmRuntime).toContain("requiredOutputExpectation,");
    expect(defaultRuntime).toContain("requiredOutputExpectation,");
    expect(localRuntime).toContain("requiredArtifactOutputIds,");
    expect(slurmRuntime).toContain("requiredArtifactOutputIds,");
    expect(defaultRuntime).toContain("requiredArtifactOutputIds,");

    // The state file still captures the most recently started run for cleanup;
    // output correctness is now checked per run before that run is accepted.
    expect(sourceStoreRuntimeGate).not.toContain("STORE_RUN_FOLDER=");
    expect(installedGate).not.toContain("INSTALLED_STORE_RUN_FOLDER=");
  });

  it("boots a real managed runtime from the fresh core-only public install through its installed user CLI", () => {
    const publicInstallJob = publicInstaller.slice(
      publicInstaller.indexOf("\n  public-installer-ubuntu:"),
      publicInstaller.indexOf("\n  source-installer-ubuntu:")
    );
    const cliGate = publicInstallJob.slice(
      publicInstallJob.indexOf(
        "- name: Bootstrap pipeline runtime through the installed user CLI"
      ),
      publicInstallJob.indexOf(
        "- name: Verify public app startup and auth flows"
      )
    );
    const cliInstallCommand = cliGate.slice(
      cliGate.indexOf(
        'if ! "$PUBLIC_CLI_BIN_DIR/seqdesk" pipelines install simulate-reads'
      ),
      cliGate.indexOf(
        "then",
        cliGate.indexOf(
          'if ! "$PUBLIC_CLI_BIN_DIR/seqdesk" pipelines install simulate-reads'
        )
      )
    );

    expect(publicInstallJob).toContain("timeout-minutes: 60");
    expect(publicInstallJob).toContain(
      'echo "PUBLIC_CLI_BIN_DIR=$RUNNER_TEMP/seqdesk-public-cli-bin" >> "$GITHUB_ENV"'
    );
    expect(publicInstallJob).toContain(
      'echo "PUBLIC_CLI_CONFIG_HOME=$RUNNER_TEMP/seqdesk-public-cli-config" >> "$GITHUB_ENV"'
    );
    expect(publicInstallJob).toContain(
      'echo "PUBLIC_CLI_NEUTRAL_CWD=$RUNNER_TEMP/seqdesk-public-cli-neutral" >> "$GITHUB_ENV"'
    );
    expect(publicInstallJob).toContain(
      'echo "PUBLIC_CLI_CONDA_PREFIX=$RUNNER_TEMP/seqdesk-public-cli-miniconda" >> "$GITHUB_ENV"'
    );
    expect(publicInstallJob).toContain(
      'XDG_CONFIG_HOME="$PUBLIC_CLI_CONFIG_HOME"'
    );
    expect(publicInstallJob).toContain(
      'SEQDESK_CLI_BIN_DIR="$PUBLIC_CLI_BIN_DIR"'
    );
    expect(publicInstallJob).toContain(
      '-y --without-pipelines --no-pm2 --dir "$INSTALL_DIR"'
    );
    expect(
      publicInstallJob.indexOf("- name: Run public installer (headless)")
    ).toBeLessThan(
      publicInstallJob.indexOf(
        "- name: Bootstrap pipeline runtime through the installed user CLI"
      )
    );
    expect(
      publicInstallJob.indexOf("- name: Reconfigure public install in place")
    ).toBeLessThan(
      publicInstallJob.indexOf(
        "- name: Bootstrap pipeline runtime through the installed user CLI"
      )
    );

    expect(cliGate).not.toContain("continue-on-error:");
    expect(cliGate).toContain("timeout-minutes: 30");
    expect(cliGate).toContain('cd "$PUBLIC_CLI_NEUTRAL_CWD"');
    expect(cliGate).toContain(
      'test -x "$PUBLIC_CLI_BIN_DIR/seqdesk"'
    );
    expect(cliGate).toContain(
      'test -f "$PUBLIC_CLI_CONFIG_HOME/seqdesk/default-install"'
    );
    expect(cliGate).toContain(
      'test "$(sed -n \'1p\' "$PUBLIC_CLI_CONFIG_HOME/seqdesk/default-install")" = "$INSTALL_DIR"'
    );
    expect(cliGate).toContain(
      'test ! -e "$PUBLIC_CLI_CONDA_PREFIX"'
    );
    expect(cliGate).toContain(
      'config?.pipelines?.enabled !== false'
    );
    expect(cliGate).toContain(
      "the CLI bootstrap must start from a core-only install"
    );
    expect(cliGate).toContain(
      'export SEQDESK_CONDA_PATH="$PUBLIC_CLI_CONDA_PREFIX"'
    );
    expect(cliInstallCommand).toContain(
      '"$PUBLIC_CLI_BIN_DIR/seqdesk" pipelines install simulate-reads'
    );
    expect(cliInstallCommand).toContain("--runtime --yes --json");
    expect(cliInstallCommand).not.toContain("--dir");
    expect(cliGate).not.toContain("SEQDESK_PIPELINE_REGISTRY_URL");
    expect(cliGate).toContain(
      '"$PUBLIC_CLI_BIN_DIR/seqdesk" pipelines status simulate-reads --json'
    );
    expect(cliGate).toContain(
      'test -x "$PUBLIC_CLI_CONDA_PREFIX/bin/conda"'
    );
    expect(cliGate).toContain(
      'pipeline?.setupState !== "ready"'
    );
    expect(cliGate).toContain(
      'pipeline?.activationState !== "enabled"'
    );
    expect(cliGate).toContain(
      'pipeline?.readiness?.status !== "ready"'
    );
    expect(cliGate).toContain(
      '["runtime-nextflow", "runtime-java", "runtime-conda"]'
    );
    expect(cliGate).toContain(
      'config?.pipelines?.execution?.conda?.path !== condaPrefix'
    );
    expect(cliGate).toContain(
      'config?.pipelines?.enabled !== true'
    );
    expect(publicInstallJob).toContain(
      "${{ env.PUBLIC_CLI_INSTALL_JSON }}"
    );
    expect(publicInstallJob).toContain(
      "${{ env.PUBLIC_CLI_STATUS_JSON }}"
    );
    expect(publicInstallJob).toContain(
      "${{ env.PUBLIC_CLI_RUNTIME_LOG }}"
    );
  });

  it("proves the no-runtime installer fails activation closed while retaining a valid Store package", () => {
    const sourceInstallerGate = publicInstaller.slice(
      publicInstaller.indexOf(
        "- name: Verify source app auth and blocked-readiness Store rollback"
      ),
      publicInstaller.indexOf(
        "- name: Upload install e2e artifacts (source installer)"
      )
    );

    expect(publicInstaller).toContain(
      'echo "STORE_E2E_FIXTURE_PORT=$((PORT + 1))" >> "$GITHUB_ENV"'
    );
    expect(sourceInstallerGate).not.toContain("continue-on-error:");
    expect(sourceInstallerGate).toContain(
      'export SEQDESK_PIPELINES_DIR="$INSTALL_DIR/pipelines"'
    );
    expect(sourceInstallerGate).toContain(
      'export SEQDESK_PIPELINE_REGISTRY_URL="http://127.0.0.1:${STORE_E2E_FIXTURE_PORT}/registry"'
    );
    expect(sourceInstallerGate).toContain(
      "export SEQDESK_PIPELINE_STORE_E2E_FAULTS=1"
    );
    expect(sourceInstallerGate).toContain(
      'node "$GITHUB_WORKSPACE/scripts/run-pipeline-store-e2e.mjs"'
    );
    expect(sourceInstallerGate).toContain(
      '--fixture-url "http://127.0.0.1:${STORE_E2E_FIXTURE_PORT}"'
    );
    expect(sourceInstallerGate).toContain("--expect-readiness blocked");
    expect(sourceInstallerGate).toContain("--expected-execution-mode local");
    expect(sourceInstallerGate).toContain('--result-file "$STORE_E2E_JSON"');
    expect(publicInstaller).toContain("${{ env.STORE_E2E_LOG }}");
    expect(storeHarness).toContain(
      'runtimeItems.some((item) => item?.status !== "ready")'
    );
    expect(storeHarness).toContain(
      "The fixture was expected to be blocked by a missing runtime prerequisite"
    );
  });

  it("mirrors public main changes and propagates the matching private result", () => {
    expect(mirror).toContain("push:\n    branches: [main]");
    expect(mirror).toContain("workflow_dispatch:");
    expect(mirror).not.toContain("schedule:");
    expect(mirror).not.toContain("cron:");
    expect(mirror).toContain(
      "github.repository == 'hzi-bifo/SeqDesk'"
    );

    const missingSecretGuard = mirror.slice(
      mirror.indexOf('if [ -z "${MIRROR_SSH_KEY:-}" ]'),
      mirror.indexOf("mkdir -p ~/.ssh")
    );
    expect(missingSecretGuard).toContain("exit 1");
    expect(missingSecretGuard).not.toContain("exit 0");
    expect(missingSecretGuard).toContain(
      "the required private CI gate cannot run"
    );

    const resultWaiter = mirror.slice(
      mirror.indexOf("- name: Wait for the matching private acceptance result")
    );
    expect(mirror).toContain("cancel-in-progress: true");
    expect(mirror).toContain("timeout-minutes: 355");
    expect(resultWaiter).toContain(
      'SUCCESS_REF="refs/tags/seqdesk-private-ci/${PRIVATE_SHA}/success"'
    );
    expect(resultWaiter).toContain(
      'FAILURE_REF="refs/tags/seqdesk-private-ci/${PRIVATE_SHA}/failure"'
    );
    expect(resultWaiter).toContain("ls-remote --exit-code");
    expect(resultWaiter).toContain(
      "this public workflow for the same SHA intentionally reuses that"
    );
    expect(resultWaiter).toContain(
      'echo "ERROR: private acceptance gate failed for $PRIVATE_SHA."'
    );
    expect(resultWaiter).toContain(
      'echo "ERROR: timed out waiting for the private acceptance result for $PRIVATE_SHA."'
    );
    expect(resultWaiter).not.toContain("exit 0\n          done");
  });

  it("profiles both instrument-specific human-gut orders in the opt-in Kraken leg", () => {
    const humanGutKraken = canonical.slice(
      canonical.indexOf(
        "- name: Run kraken2-bracken on the REAL human-gut shotgun study"
      ),
      canonical.indexOf("- name: Run read-cleaning E2E")
    );

    expect(humanGutKraken).toContain(
      "HUMAN_ORDERS=(DEV-HUMAN-PRJEB54724-001 DEV-HUMAN-PRJEB54724-002)"
    );
    expect(humanGutKraken).toContain(
      "SEED_ARGS=(--seed-example-dataset human-gut-prjeb54724)"
    );
    expect(humanGutKraken).toContain('--order-number "$ORDER"');
    expect(humanGutKraken).toContain("failed_orders=%s");
  });

  it("pins supported Node 24 without adding the pipeline environment to the global PATH", () => {
    expect(canonical).toContain("nodejs=24");
    expect(canonical).toContain("SEQDESK_NODE_BIN=");
    expect(canonical).toContain("NODE_OPTIONS: --max-old-space-size=8192");
    expect(canonical).toContain("npm run build -- --webpack");
    expect(canonical).not.toContain(
      'echo "$SLURM_SHARED_CONDA_ENV/bin" >> "$GITHUB_PATH"'
    );
    expect(canonical).not.toContain(
      'echo "$CONDA_BASE/envs/$PIPELINE_CONDA_ENV/bin" >> "$GITHUB_PATH"'
    );
  });

  it("requires app and scheduler cancellation to be proved within bounded checks", () => {
    expect(cancelHarness).toContain(
      'slurm.options = [configuredOptions, "--hold"].filter(Boolean).join(" ")'
    );
    expect(cancelHarness).toContain(
      '"SLURM start response did not include a submitted numeric job id"'
    );
    expect(cancelHarness).toContain(
      '"--format=JobIDRaw,JobName%128,State,ExitCode,WorkDir%1024,NodeList"'
    );
    expect(cancelHarness).toContain(
      '"%A|%.128j|%T|%.1024Z|%N"'
    );
    expect(cancelHarness).toContain(
      "assertSlurmAccountingRecord(record, {"
    );
    expect(cancelHarness).toContain(
      'expectedOutcome: "cancelled"'
    );
    expect(cancelHarness).toContain(
      "if (!CANCELLED_STATES.has(statusAfterCancel))"
    );
    expect(cancelHarness).toContain(
      "SLURM accounting did not prove job ${jobId} reached CANCELLED within the bounded retry window"
    );
    expect(cancelHarness).toContain(
      'assertion: "app-and-slurm-cancellation-confirmed"'
    );
    expect(cancelHarness).toContain(
      "const syncPayload = assertSuccessfulSyncPayload("
    );
    expect(cancelHarness).toContain(
      "payload.success === true"
    );
    expect(cancelHarness).toContain(
      'typeof payload.synced === "boolean"'
    );
    expect(cancelHarness).toContain(
      "statusAfterSync && !CANCELLED_STATES.has(statusAfterSync)"
    );
    expect(cancelHarness).not.toContain(
      "await client.request(`/api/pipelines/runs/${runId}/sync`"
    );
    expect(cancelHarness).not.toContain(
      "sacct did not show a CANCELLED state for job"
    );

    const stuckCheck = appcheckHarness.slice(
      appcheckHarness.indexOf("async function checkStuck"),
      appcheckHarness.indexOf("const ctx = {}")
    );
    expect(appcheckHarness).toContain(
      'slurm.options = [configuredOptions, "--hold"].filter(Boolean).join(" ")'
    );
    expect(appcheckHarness).toContain(
      '"--format=JobIDRaw,JobName%128,State,ExitCode,WorkDir%1024,NodeList"'
    );
    expect(appcheckHarness).toContain(
      '"%A|%.128j|%T|%.1024Z|%N"'
    );
    expect(stuckCheck).toContain(
      "identityAccounting = assertSlurmAccountingIdentity(record, {"
    );
    expect(stuckCheck).toContain(
      "const query = await readSacctRecord(jobId)"
    );
    expect(stuckCheck).toContain(
      "assertSlurmAccountingRecord(record, {"
    );
    expect(stuckCheck).toContain(
      'expectedOutcome: "cancelled"'
    );
    expect(stuckCheck).toContain(
      "SLURM accounting did not prove out-of-band cancellation of job ${jobId} within the bounded retry window"
    );
    expect(stuckCheck).toContain(
      "const syncPayload = assertSuccessfulSyncPayload("
    );
    expect(appcheckHarness).toContain(
      "payload.success === true"
    );
    expect(appcheckHarness).toContain(
      'typeof payload.synced === "boolean"'
    );
    expect(stuckCheck).toContain(
      "successfulSync = {"
    );
    expect(stuckCheck).toContain(
      "persistedStatus,"
    );
    expect(stuckCheck).toContain(
      "responseStatus && responseStatus !== persistedStatus"
    );
    expect(stuckCheck).not.toContain(
      "await client.request(`/api/pipelines/runs/${runId}/sync`"
    );
    expect(stuckCheck).toContain("sacctCancelled: true");
  });

  it.each(commandProbeHarnesses)(
    "checks commands without deprecated shell argument concatenation in %s",
    (_name, harness) => {
      expect(harness).toContain(
        `["-c", 'command -v "$1" >/dev/null 2>&1', "sh", command]`
      );
      expect(harness).not.toContain(
        'execFileAsync("command", ["-v", command], { shell: true'
      );
    }
  );

  it("makes installation, readiness, auth, local execution, and SLURM execution required", () => {
    const installGate = canonical.slice(
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      ),
      canonical.indexOf("- name: Collect SLURM + pipeline diagnostics")
    );

    expect(installGate).not.toContain("continue-on-error:");
    expect(installGate).toContain('if [ "$INSTALLED_READY" != "1" ]');
    expect(installGate).toContain("Installed SeqDesk is ready and exposes authentication.");
    expect(installGate).toContain("run_installed fastq-checksum-default");
    expect(installGate).toContain("--include-default-policy --expect-default-mode slurm");
    expect(installGate).toContain(
      "run_installed fastq-checksum          --pipeline-id fastq-checksum"
    );
    expect(installGate).toContain(
      "run_installed fastqc                  --pipeline-id fastqc --dummy-order-index 4"
    );
    expect(installGate).toContain(
      "run_installed fastqc-long-read        --pipeline-id fastqc --dummy-order-index 3"
    );
    expect(installGate).toContain(
      "run_installed nanoplot                --pipeline-id nanoplot --dummy-order-index 3"
    );
    expect(installGate).toContain(
      "run_installed multiqc                 --pipeline-id multiqc"
    );
    expect(installGate).toContain('unset PORT DATABASE_URL DIRECT_URL');
    expect(installGate).toContain("unset SEQDESK_PIPELINES_DIR");
    expect(installGate).not.toContain(
      '[ -n "${SEQDESK_PIPELINES_DIR:-}" ] && export SEQDESK_PIPELINES_DIR'
    );
    expect(installGate).toContain('export SEQDESK_CONDA_CACHE_DIR="$INSTALLED_CONDA_CACHE"');
    expect(installGate).toContain(
      'if [ -L "$APP_DIR/start.sh" ] || [ ! -f "$APP_DIR/start.sh" ] || [ ! -x "$APP_DIR/start.sh" ]'
    );
    expect(installGate).toContain(
      `grep -F -q 'cd "$ROOT_DIR/current"' "$APP_DIR/start.sh"`
    );
    expect(installGate).toContain(
      `grep -F -q 'exec ./start.sh "$@"' "$APP_DIR/start.sh"`
    );
    expect(installGate).toContain('if [ ! -L "$APP_DIR/current" ]');
    expect(installGate).toContain(
      'INSTALLED_RELEASE_DIR="$(cd "$APP_DIR/current" && pwd -P)"'
    );
    expect(installGate).toContain(
      'EXPECTED_RELEASE_DIR="$INSTALL_ROOT/releases/$VERSION"'
    );
    expect(installGate).toContain(
      'if [ "$INSTALLED_RELEASE_DIR" != "$EXPECTED_RELEASE_DIR" ]'
    );
    expect(installGate).not.toContain(
      'elif [ -f "$APP_DIR/scripts/apply-install-profile.mjs" ]'
    );
    expect(installGate).toContain(
      '( cd "$INSTALLED_RELEASE_DIR" && DATABASE_URL="$INSTALLED_DB_URL"'
    );
    expect(installGate).toContain("assert.equal(config.pipelines?.enabled, true)");
    expect(installGate).toContain(
      'assert.equal(config.pipelines?.execution?.mode, "slurm")'
    );
    expect(installGate).toContain(
      "assert.equal(config.runtime?.directUrl, process.env.EXPECTED_DB_URL)"
    );
    expect(installGate).toContain("Installer persistence verified in config file and SiteSettings.");
    expect(installGate).toContain(
      'const { createRequire } = require("node:module")'
    );
    expect(installGate).toContain(
      'fs.existsSync(path.join("current", "package.json"))'
    );
    expect(installGate).toContain(
      'const { PrismaClient } = requireFromInstall("@prisma/client")'
    );
    expect(installGate).not.toContain(
      'const { PrismaClient } = require("@prisma/client")'
    );
    expect(installGate).toContain(
      'curl -fsS "http://127.0.0.1:$INSTALLED_PORT/api/version"'
    );
    expect(installGate).toContain(
      'INSTALLED_PROCESS_STATE="$(seqdesk_ci_pid_state "$INSTALLED_APP_PID")"'
    );
    expect(installGate).toContain(
      'PACKAGED_PIPELINES_ROOT="$INSTALLED_RELEASE_DIR/pipelines"'
    );
    expect(installGate).toContain(
      '--expected-pipeline-root "$PACKAGED_PIPELINES_ROOT"'
    );
    expect(installGate).not.toContain(
      'PACKAGED_PIPELINES_ROOT="$APP_DIR/current/pipelines"'
    );
    expect(installGate).toContain(
      'grep -R -F -l --include=\'run.sh\' -- "$expected_target" "$INSTALLED_RUNS"'
    );
    expect(installGate).toContain("SEQDESK_EXEC_SLURM_TIME_LIMIT=1");
    expect(installGate).toContain("SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=1");
    expect(installGate).not.toContain("SEQDESK_EXEC_SLURM_TIME_LIMIT=10");
    expect(installGate).not.toContain("SEQDESK_RUNTIME_E2E_SLURM_TIME_LIMIT=10");
  });

  it("requires correctness proofs for every lightweight built-in pipeline in source and installed modes", () => {
    const requiredSourceSteps = [
      "Run required fastq-checksum E2E",
      "Run fastqc E2E",
      "Run nanoplot E2E",
      "Run fastqc E2E (local + SLURM, long-read aggregation input)",
      "Run study-demo-report E2E",
      "Run simulate-reads E2E",
      "Run reads-qc E2E",
      "Run multiqc E2E",
    ];
    for (const stepName of requiredSourceSteps) {
      const start = canonical.indexOf(`- name: ${stepName}`);
      expect(start, `${stepName} must exist`).toBeGreaterThanOrEqual(0);
      const next = canonical.indexOf("\n      - name:", start + 1);
      const step = canonical.slice(start, next < 0 ? canonical.length : next);
      expect(step).not.toContain("continue-on-error:");
      expect(step).toContain("npm run pipeline:e2e:runtime --");
      expect(step).toContain(
        '--expected-pipeline-root "$SEQDESK_STAGED_PIPELINES_DIR"'
      );
    }

    expect(canonical).toContain("--pipeline-id fastqc \\\n            --dummy-order-index 4");
    expect(canonical).toContain("--pipeline-id fastqc \\\n            --dummy-order-index 3");
    expect(canonical).toContain("--pipeline-id nanoplot \\\n            --dummy-order-index 3");
    expect(canonical).toContain("--pipeline-id multiqc");
    expect(canonical.indexOf("- name: Run nanoplot E2E")).toBeLessThan(
      canonical.indexOf(
        "- name: Run fastqc E2E (local + SLURM, long-read aggregation input)"
      )
    );
    expect(
      canonical.indexOf(
        "- name: Run fastqc E2E (local + SLURM, long-read aggregation input)"
      )
    ).toBeLessThan(
      canonical.indexOf("- name: Run multiqc E2E")
    );
    expect(canonical).toContain(
      "inputs.runtime_pipeline_id != 'fastq-checksum'"
    );
    expect(canonical.indexOf("- name: Run required fastq-checksum E2E")).toBeLessThan(
      canonical.indexOf("- name: Run additionally requested runtime pipeline")
    );

    expect(runtimeHarness).toContain("nanoplot: 3");
    expect(runtimeHarness).toContain("fastqc: 4");
    expect(runtimeHarness).toContain(
      'requiredOutputIds: ["sample_report", "sample_stats", "summary_tsv"]'
    );
    expect(runtimeHarness).toContain(
      'requiredOutputIds: ["multiqc_report", "multiqc_data"]'
    );
    expect(runtimeHarness).toContain(
      "async function assertNanoplotSummaryMetrics"
    );
    expect(runtimeHarness).toContain(
      "async function assertMultiqcAggregation"
    );
    expect(runtimeHarness).toContain(
      "assertFastqcArtifactCoverage({"
    );
    expect(runtimeHarness).toContain(
      "assertMultiqcFastqcCoverage({"
    );
    expect(runtimeHarness).toContain("nanoplotInputs.length === 0");
    expect(runtimeHarness).toContain(
      "async function buildMultiqcNanoplotGroundTruth"
    );
    expect(runtimeHarness).toContain(
      "sourceSha256 !== stagedSha256"
    );
    expect(runtimeHarness).toContain(
      "parseNanoplotNanoStatsTsv({"
    );
    expect(runtimeHarness).toContain(
      "multiqcNanostatData: parsedData?.multiqc_nanostat"
    );
    const readsQcProof = runtimeHarness.slice(
      runtimeHarness.indexOf("async function assertReadsQcSummaryMetrics"),
      runtimeHarness.indexOf("async function assertNanoplotSummaryMetrics")
    );
    expect(readsQcProof).toContain("assertReadsQcSummaryRows({");
    expect(readsQcProof).toContain("header,");
    expect(readsQcProof).toContain("rows,");
    expect(readsQcProof).toContain("expectedSamples,");
    expect(readsQcProof).not.toContain("new Set(");
    expect(runtimeHarness).toContain(
      "No app-writeback contract is defined for pipeline"
    );
    expect(runtimeHarness).not.toContain(
      "no writeback spec defined for pipeline="
    );
    expect(runtimeHarness).toContain(
      "async function syncRun(client, runId)"
    );
    expect(runtimeHarness).toContain(
      "if (!response.ok)"
    );
    expect(runtimeHarness).toContain(
      'typeof payload?.status !== "string"'
    );
  });

  it("bounds cleanup to this run before switching apps or deleting shared trees", () => {
    const sourceBoot = canonical.slice(
      canonical.indexOf("- name: Boot SeqDesk app and verify readiness"),
      canonical.indexOf(
        "- name: Run required fastq-checksum E2E"
      )
    );
    const stopSource = canonical.slice(
      canonical.indexOf("- name: Stop SeqDesk app"),
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      )
    );
    const cleanup = canonical.slice(
      canonical.indexOf("- name: Cleanup resources")
    );

    expect(canonical).toContain("seqdesk_ci_process_group_identity_state()");
    expect(canonical).toContain("seqdesk_ci_process_group_state()");
    expect(canonical).toContain("seqdesk_ci_pid_state()");
    expect(canonical).toContain("seqdesk_ci_pid_identity_state()");
    expect(canonical).toContain("seqdesk_ci_slurm_job_state()");
    expect(canonical).toContain("seqdesk_ci_slurm_job_identity_state()");
    expect(canonical).toContain(
      'if ($field == script) found = 1'
    );
    expect(canonical).toContain(
      '[ "$job_name" = "$expected_job_name" ]'
    );
    expect(canonical).toContain(
      '[ "$resolved_actual_work_dir" = "$resolved_expected_work_dir" ]'
    );
    expect(canonical).toContain(
      "where coalesce(\\\"queueJobId\\\", '') <> ''"
    );
    expect(canonical).toContain(': > "$queue_file"');
    expect(canonical).toContain(
      "launch markers to stop jobs that never reached PostgreSQL"
    );
    expect(canonical).toContain(
      "-name '.seqdesk-launch-identity' -print0"
    );
    expect(canonical).toContain(
      '[[ "$marker_contents" =~ ^local\\|([1-9][0-9]*)\\|-$ ]]'
    );
    expect(canonical).toContain(
      '[[ "$marker_contents" =~ ^slurm\\|([1-9][0-9]*)\\|(seqdesk-[A-Za-z0-9_-]+)$ ]]'
    );
    expect(canonical).toContain(
      'sort -u "$identity_file" -o "$identity_file"'
    );
    expect(canonical).not.toContain(
      "where status in ('pending','queued','running')"
    );
    expect(canonical).toContain(
      '[[ "$resolved_run" != "$resolved_root/"* ]]'
    );
    expect(canonical).toContain(
      "SEQDESK_STAGED_PIPELINES_DIR=$SHARED_BASE/ci-seqdesk-pipelines-$RUN_SUFFIX"
    );
    expect(sourceBoot).toContain(
      'SHARED_PIPELINES_DIR="$SEQDESK_STAGED_PIPELINES_DIR"'
    );
    expect(sourceBoot).not.toContain(
      'SHARED_PIPELINES_DIR="$(dirname "$SLURM_SHARED_RUN_ROOT")/pipelines"'
    );
    expect(canonical).toContain("for _ in $(seq 1 30)");
    expect(canonical).toContain(
      "while IFS='|' read -r kind queue_id run_folder expected_job_name"
    );
    expect(canonical).toContain(
      'process_state="$(seqdesk_ci_process_group_state "$queue_id")"'
    );
    expect(canonical).toContain('kill -KILL -- "-$queue_id"');
    expect(stopSource).toContain(
      'seqdesk_ci_cancel_pipeline_runs "${DB_NAME:-}" "${SEQDESK_RUN_DIR:-}"'
    );
    expect(stopSource).toContain(
      'seqdesk_ci_stop_child "${APP_PID:-}" "source SeqDesk app" "$GITHUB_WORKSPACE"'
    );
    expect(stopSource).toContain('echo "APP_PID=" >> "$GITHUB_ENV"');
    expect(cleanup).toContain('if [ "$pipeline_cleanup_fail" = 0 ]');
    expect(cleanup).toContain('"${SEQDESK_STAGED_PIPELINES_DIR:-}"');
    expect(cleanup).not.toContain(
      'rm -rf "$(dirname "$SLURM_SHARED_RUN_ROOT")/pipelines"'
    );
    expect(cleanup).toContain(
      "preserving source data/run/pipeline trees because a scoped process survived cleanup"
    );
    expect(canonical).toContain(
      "its exact run.sh identity is $identity_state; preserving the run tree"
    );
    expect(canonical).toContain("printf '%s\\n' unknown");
    expect(canonical).toContain(
      "final SLURM state for $queue_id is unknown; preserving the run tree"
    );
    expect(canonical).toContain(
      "final process-group state for $queue_id is unknown; preserving the run tree"
    );
    expect(canonical).toContain(
      "state of $label PID $pid is unknown; preserving its tree"
    );
    expect(canonical).toContain(
      'if ! processes="$(ps -eo pgid=,stat= 2>/dev/null)"; then'
    );
    expect(canonical).toContain(
      'if ! processes="$(ps -eo pid=,stat= 2>/dev/null)"; then'
    );
  });

  it("drains all active stale canonical jobs only after revalidating exact identity", () => {
    const staleCleanup = canonical.slice(
      canonical.indexOf(
        "- name: Free stale SLURM jobs from prior runs (QOS submit-slot cleanup)"
      ),
      canonical.indexOf("- name: Create pipeline Conda environment")
    );
    const ownershipGuard =
      '[[ "$work_dir" == "$SLURM_SHARED_RUN_ROOT"/ci-seqdesk-runs-*/* ]]';
    const cancelCall = 'scancel "$job_id"';

    expect(canonical).toContain(
      'SEQDESK_RUN_DIR=$SHARED_BASE/ci-seqdesk-runs-$RUN_SUFFIX'
    );
    expect(staleCleanup).not.toContain("-t PENDING");
    expect(staleCleanup).toContain("-o '%i|%j|%T'");
    expect(staleCleanup).toContain('[[ "$listed_job_name" == seqdesk-* ]]');
    expect(staleCleanup).toContain(
      'if ! info="$(scontrol show job -o "$job_id" 2>/dev/null)"; then'
    );
    expect(staleCleanup).toContain(ownershipGuard);
    expect(staleCleanup).toContain(
      'seqdesk_ci_slurm_job_identity_state'
    );
    expect(staleCleanup).toContain(cancelCall);
    expect(staleCleanup.indexOf(ownershipGuard)).toBeLessThan(
      staleCleanup.indexOf(cancelCall)
    );
    expect(staleCleanup).toContain("for _ in $(seq 1 24)");
    expect(staleCleanup).toContain('done < "$STALE_FILE"');
    expect(staleCleanup).toContain(
      "is still active after the bounded canonical-CI drain"
    );
    expect(staleCleanup).toContain(
      "could not query active SLURM jobs; refusing to start"
    );
    expect(staleCleanup).not.toContain(
      "squeue -u \"$ME\" -h -o '%i|%j|%T' 2>/dev/null || true"
    );
    expect(staleCleanup).not.toContain("xargs");
  });

  it("requires a second ownership-checked source drain before the installed app starts", () => {
    const installGate = canonical.slice(
      canonical.indexOf(
        "- name: Install SeqDesk + run pipelines on the installed app (required)"
      ),
      canonical.indexOf(
        'if [ "$(node -p \'process.versions.node.split(".")[0]\')" != "24" ]'
      )
    );
    const lines = installGate.split("\n").map((line) => line.trim());
    const requiredSequence = [
      'source "$SEQDESK_CI_CLEANUP_HELPER"',
      'seqdesk_ci_cancel_pipeline_runs "$DB_NAME" "$SEQDESK_RUN_DIR"',
      'seqdesk_ci_stop_child "${APP_PID:-}" "source SeqDesk app" "$GITHUB_WORKSPACE"',
      'seqdesk_ci_stop_monitors "$GITHUB_WORKSPACE"',
      'echo "APP_PID=" >> "$GITHUB_ENV"',
    ];

    expect(installGate).toContain("set -euo pipefail");
    let previousIndex = -1;
    for (const command of requiredSequence) {
      expect(lines).toContain(command);
      const currentIndex = lines.indexOf(command);
      expect(currentIndex).toBeGreaterThan(previousIndex);
      previousIndex = currentIndex;
    }
  });

  it("collects only this CI run's SeqDesk SLURM accounting and log paths", () => {
    const diagnostics = canonical.slice(
      canonical.indexOf("- name: Collect SLURM + pipeline diagnostics"),
      canonical.indexOf("- name: Upload SLURM pipeline E2E artifacts")
    );

    expect(diagnostics).toContain("--starttime=now-4hours");
    expect(diagnostics).toContain("$2 ~ /^seqdesk-/");
    expect(diagnostics).toContain("beneath($6, source_root)");
    expect(diagnostics).toContain("beneath($6, installed_root)");
    expect(diagnostics).toContain(
      "Reason%128,WorkDir%1024,NodeList"
    );
    expect(diagnostics).toContain('done < "$CI_SLURM_IDS"');
    expect(diagnostics).not.toContain("--starttime=now-2hours");
    expect(diagnostics).not.toContain(
      'sacct -u "$USER" --starttime=now-2hours'
    );
  });

  it("keeps long infrastructure diagnostics out of the mirrored-push gate", () => {
    const readCleaningStep = canonical.slice(
      canonical.indexOf("- name: Run read-cleaning E2E"),
      canonical.indexOf("- name: Run SLURM-only pipeline smoke")
    );
    const canaryStep = canonical.slice(
      canonical.indexOf("- name: SLURM shared-filesystem canary"),
      canonical.indexOf("- name: Stop SeqDesk app")
    );

    expect(readCleaningStep).toContain(
      "github.event_name == 'workflow_dispatch'"
    );
    expect(canaryStep).toContain("github.event_name == 'workflow_dispatch'");
    expect(canaryStep).toContain(
      'CANARY_JOB_NAME="seqdesk-canary-$CANARY_SUFFIX"'
    );
    expect(canaryStep).toContain(
      'HOME_DIR="$HOME/seqdesk-ci-canary-$CANARY_SUFFIX"'
    );
    expect(canaryStep).toContain(
      'seqdesk_ci_slurm_job_identity_state'
    );
    expect(canaryStep).toContain('scancel "$job_id"');
    expect(canaryStep).toContain(
      'echo "SEQDESK_CANARY_CLEANUP_FAILED=1" >> "$GITHUB_ENV"'
    );
    expect(canaryStep).toContain(
      'preserving canary paths $HOME_DIR and $WORK_DIR'
    );
  });

  it("cancels only the exact captured read-cleaning PipelineRun after ownership checks", () => {
    const readCleaningStep = canonical.slice(
      canonical.indexOf("- name: Run read-cleaning E2E"),
      canonical.indexOf("- name: Run SLURM-only pipeline smoke")
    );

    expect(readCleaningStep).toContain(
      '--run-state-file "$RC_STATE_FILE"'
    );
    expect(readCleaningStep).toContain(
      'where id=\'$RC_RUN_ID\''
    );
    expect(readCleaningStep).toContain(
      '"$RC_JOB_ID" "$RC_DB_RUN_FOLDER" "seqdesk-$RC_RUN_ID"'
    );
    expect(readCleaningStep).toContain(
      'RC_JOB_STATE="$(seqdesk_ci_slurm_job_state "$RC_JOB_ID")"'
    );
    expect(readCleaningStep).toContain('scancel "$RC_JOB_ID"');
    expect(readCleaningStep).not.toContain("jobs_before");
    expect(readCleaningStep).not.toContain("new_jobs");
    expect(readCleaningStep).not.toContain("squeue -u");
  });

  it.each([
    ["metaxpath", metaxpathSlurmLeg],
    ["mag", magSlurmLeg],
  ])(
    "cancels only the exact captured %s PipelineRun allocation",
    (_name, script) => {
      expect(script).toContain('--run-state-file "$CURRENT_STATE_FILE"');
      expect(script).toContain("is_disabled_pipeline_state()");
      expect(script).toContain("is_proven_slurm_run_state()");
      expect(script).toContain('state?.pipelineId === expectedPipelineId');
      expect(script).toContain('/^[0-9]+$/.test(String(state?.jobId ?? ""))');
      expect(script).toContain('state?.resolvedExecutionMode === "slurm"');
      expect(script).toContain(
        "runtime harness exited successfully without a proven SLURM PipelineRun state"
      );
      expect(script).toContain("cancel_captured_run()");
      expect(script).toContain('expected_job_name="seqdesk-$safe_run_id"');
      expect(script).toContain("slurm_job_state()");
      expect(script).toContain("slurm_job_identity_state()");
      expect(script).toContain("printf '%s\\n' unknown");
      expect(script).toContain('[ "$actual_job_name" = "$expected_job_name" ]');
      expect(script).toContain('[ "$actual_work_dir" = "$run_folder" ]');
      expect(script).toContain(
        '[[ "$resolved_run" != "$profile_root/"* ]]'
      );
      expect(script).toContain('if [ -z "$job_id" ]; then');
      expect(script).toContain(
        'from \\"PipelineRun\\" where id=\'$run_id\''
      );
      expect(script).toContain('job_id="$db_job_id"');
      expect(script).toContain('run_folder="$db_run_folder"');
      expect(script).toContain("for _ in $(seq 1 24)");
      expect(script).toContain("SEQDESK_SLURM_CLEANUP_GUARD");
      expect(script).not.toContain("squeue -u");
      expect(script).not.toContain("xargs");
      expect(script).not.toContain("newjobs");
      expect(script).not.toContain('before="$(squeue');
    }
  );

  it("records disabled runtime skips without printing an undefined summary", () => {
    expect(runtimeHarness).toContain("const skipSummary = {");
    expect(runtimeHarness).toContain("writeRunState(runStateFile, skipSummary);");
    expect(runtimeHarness).toContain("return skipSummary;");
    expect(runtimeHarness).toContain("if (summary !== undefined) {");
    expect(runtimeHarness).not.toContain(
      'console.log(JSON.stringify({ skipped: true, reason: "pipeline-not-enabled"'
    );
  });

  it("DB-scopes every Alma queue id and preserves trees on cleanup uncertainty", () => {
    expect(almaExtended).toContain(
      "SEQDESK_SLURM_CLEANUP_GUARD=$RUNNER_TEMP/profile-slurm-cleanup-unsafe-$RUN_SUFFIX"
    );
    expect(almaExtended).toContain(
      'bash "$GITHUB_WORKSPACE/scripts/metaxpath-slurm-leg.sh" "$PORT"'
    );
    expect(almaExtended).toContain(
      'bash "$GITHUB_WORKSPACE/scripts/mag-slurm-leg.sh" "$PORT"'
    );
    expect(almaExtended).not.toContain(
      'bash "$GITHUB_WORKSPACE/scripts/metaxpath-slurm-leg.sh" "$PORT" || true'
    );
    expect(almaExtended).not.toContain(
      'bash "$GITHUB_WORKSPACE/scripts/mag-slurm-leg.sh" "$PORT" || true'
    );
    expect(almaExtended).toContain(
      '[ -e "$SEQDESK_SLURM_CLEANUP_GUARD" ]'
    );
    expect(almaExtended).toContain(
      'if [ "$cleanup_safe" = 1 ]; then'
    );
    expect(
      almaExtended.split("scripts/cleanup-db-pipeline-runs.sh").length - 1
    ).toBe(2);
    expect(almaExtended).not.toContain("-mtime +1 -exec rm -rf");
    expect(almaDbCleanup).toContain(
      "where coalesce(\\\"queueJobId\\\", '') <> ''"
    );
    expect(almaDbCleanup).toContain(': > "$queue_file"');
    expect(almaDbCleanup).toContain(
      "still drain any atomic launch markers"
    );
    expect(almaDbCleanup).toContain(
      "-name '.seqdesk-launch-identity' -print0"
    );
    expect(almaDbCleanup).toContain(
      '[[ "$marker_contents" =~ ^local\\|([1-9][0-9]*)\\|-$ ]]'
    );
    expect(almaDbCleanup).toContain(
      '[[ "$marker_contents" =~ ^slurm\\|([1-9][0-9]*)\\|(seqdesk-[A-Za-z0-9_-]+)$ ]]'
    );
    expect(almaDbCleanup).not.toContain(
      "where status in ('pending','queued','running')"
    );
    expect(almaDbCleanup).toContain("process_group_identity_state()");
    expect(almaDbCleanup).toContain("process_group_state()");
    expect(almaDbCleanup).toContain("slurm_job_state()");
    expect(almaDbCleanup).toContain("slurm_identity_state()");
    expect(almaDbCleanup).toContain("printf '%s\\n' unknown");
    expect(almaDbCleanup).toContain('kill -KILL -- "-$queue_id"');
    expect(almaDbCleanup).toContain('scancel "$queue_id"');
    expect(almaDbCleanup).toContain(
      'if [ "$job_state" != "inactive" ]; then'
    );
    expect(almaDbCleanup).toContain(
      'if [ "$process_state" != "inactive" ]; then'
    );
    expect(almaDbCleanup).toContain(
      'if ! processes="$(ps -eo pgid=,stat= 2>/dev/null)"; then'
    );
    expect(almaDbCleanup).toContain(
      'resolved_root="$(realpath -m "$run_root" 2>/dev/null || true)"'
    );
    expect(almaDbCleanup).toContain(
      'resolved_run="$(realpath -m "$run_folder" 2>/dev/null || true)"'
    );
    expect(almaDbCleanup).toContain(
      'resolved_actual_work_dir="$(realpath -m "$actual_work_dir" 2>/dev/null || true)"'
    );
    expect(almaDbCleanup).toContain(
      '[ "$resolved_actual_work_dir" = "$resolved_expected_work_dir" ]'
    );
    expect(canonical).toContain(
      'resolved_root="$(realpath -m "$run_root" 2>/dev/null || true)"'
    );
    expect(canonical).toContain(
      'resolved_actual_work_dir="$(realpath -m "$work_dir" 2>/dev/null || true)"'
    );
  });

  it("requires terminal, owned, allocated sacct evidence for every SLURM runtime run", () => {
    expect(runtimeHarness).toContain(
      "async function assertSlurmAccounting"
    );
    expect(runtimeHarness).toContain(
      "--format=JobIDRaw,JobName%128,State,ExitCode,WorkDir%1024,NodeList"
    );
    expect(runtimeHarness).toContain(
      "assertSlurmAccountingRecord(latest, {"
    );
    expect(runtimeHarness).toContain(
      'expectedOutcome: "success"'
    );
    expect(pipelineProofHarness).toContain(
      "const expectedJobName = expectedSeqDeskJobName(runId)"
    );
    expect(pipelineProofHarness).toContain(
      "record.jobName !== expectedJobName"
    );
    expect(pipelineProofHarness).toContain(
      "!pathIsWithin(record.workDir, runFolder)"
    );
    expect(pipelineProofHarness).toContain(
      'record.state !== "COMPLETED"'
    );
    expect(pipelineProofHarness).toContain(
      "!exitCodeIsZero(record.exitCode)"
    );
    expect(pipelineProofHarness).toContain(
      'requireAllocatedNode = expectedOutcome === "success"'
    );
    expect(pipelineProofHarness).toContain(
      "requireAllocatedNode &&"
    );
    expect(pipelineProofHarness).toContain(
      "!record.nodeList"
    );

    const runFilesGate = runtimeHarness.slice(
      runtimeHarness.indexOf("async function assertRunFiles"),
      runtimeHarness.indexOf("const MD5_HEX")
    );
    expect(runFilesGate).toContain(
      "await assertSlurmAccounting({ runId: run?.id, jobId, runFolder })"
    );
    expect(runFilesGate).toContain("await assertSlurmCompletionProof({");
    expect(runtimeHarness).toContain(
      '["show", "hostnames", nodeList.trim()]'
    );
    expect(runtimeHarness).toContain(
      "assertSlurmCompletionAttestation({"
    );
    expect(runtimeHarness).toContain(
      "slurmCompletionAttestationPath(runFolder, jobId)"
    );
    expect(runtimeHarness).toContain(
      "required files are missing after accounting completed"
    );
    expect(runtimeHarness).not.toContain(
      "SLURM capture logs not visible after wait (non-fatal)"
    );
    expect(pipelineProofHarness).toContain(
      'attestation.phase !== "completed"'
    );
    expect(pipelineProofHarness).toContain(
      'attestation.exitCode !== "0"'
    );
    expect(pipelineProofHarness).toContain(
      "attestation.jobId !== expectedJobId"
    );
    expect(pipelineProofHarness).toContain(
      "attested host is not part of the scheduler allocation"
    );
  });

  it("attributes every mode's read writeback to the exact pipeline run", () => {
    expect(runtimeHarness).toContain(
      "sources[pipelineId] !== runId"
    );
    expect(runtimeHarness).toContain(
      'read.pipelineRunId === runId'
    );
    expect(runtimeHarness).not.toContain("checksum1-fallback");

    const defaultPolicyBlock = runtimeHarness.slice(
      runtimeHarness.indexOf("if (includeDefaultPolicy)"),
      runtimeHarness.indexOf("\n  return {", runtimeHarness.indexOf("if (includeDefaultPolicy)"))
    );
    expect(defaultPolicyBlock).toContain(
      "const writeback = await assertPipelineWriteback"
    );
    expect(defaultPolicyBlock).toContain("writeback,");
  });

  it("keeps the extended Alma matrix manual and builds it on the self-hosted runner", () => {
    expect(almaExtended).toContain("workflow_dispatch:");
    expect(almaExtended).not.toContain("schedule:");

    const buildJob = almaExtended.slice(
      almaExtended.indexOf("build-install-artifacts:"),
      almaExtended.indexOf("install-without-profile:")
    );
    expect(buildJob).toContain("group: bifo_dmz");
    expect(buildJob).not.toContain("ubuntu-latest");
  });

  it.each([
    ["order", orderPipeline],
    ["study", studyPipeline],
  ])("routes %s package tests directly to the private runner", (_name, workflow) => {
    const selfHosted = workflow.slice(workflow.indexOf("  self_hosted:"));
    expect(selfHosted).not.toContain("needs: github_hosted");
    expect(selfHosted).toContain(
      "github.repository == 'hzi-bifo/SeqDesk-ci'"
    );
    expect(selfHosted).toContain(
      "github.event_name == 'workflow_dispatch'"
    );
    expect(selfHosted).toContain("inputs.run_self_hosted");
  });
});
