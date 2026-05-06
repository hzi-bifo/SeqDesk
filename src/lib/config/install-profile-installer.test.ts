import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const repoRoot = process.cwd();
const installDist = fs.readFileSync(
  path.join(repoRoot, "scripts/install-dist.sh"),
  "utf8"
);
const buildRelease = fs.readFileSync(
  path.join(repoRoot, "scripts/build-release.sh"),
  "utf8"
);
const profileApplicator = fs.readFileSync(
  path.join(repoRoot, "scripts/apply-install-profile.mjs"),
  "utf8"
);
const profileAssetsApplicator = fs.readFileSync(
  path.join(repoRoot, "scripts/apply-install-profile-assets.mjs"),
  "utf8"
);
const profileAssetsLib = fs.readFileSync(
  path.join(repoRoot, "scripts/lib/install-profile-assets.mjs"),
  "utf8"
);
const profilePipelineSmokeRunner = fs.readFileSync(
  path.join(repoRoot, "scripts/run-install-profile-pipeline-smoke.mjs"),
  "utf8"
);
const profileAssert = fs.readFileSync(
  path.join(repoRoot, "scripts/assert-install-profile-applied.mjs"),
  "utf8"
);
const profileWorkflow = fs.readFileSync(
  path.join(repoRoot, ".github/workflows/install-profile-alma.yml"),
  "utf8"
);
const hostedProfileSmokeWorkflow = fs.readFileSync(
  path.join(repoRoot, ".github/workflows/install-profile-ubuntu-smoke.yml"),
  "utf8"
);

describe("install profile installer wiring", () => {
  it("adds hosted profile flags and aliases to the distribution installer", () => {
    expect(installDist).toContain("--profile <id>");
    expect(installDist).toContain("--profile-code <code>");
    expect(installDist).toContain("--setting <id>");
    expect(installDist).toContain("--key <code>");
    expect(installDist).toContain("resolve_install_profile");
    expect(installDist).toContain('Authorization: Bearer ${SEQDESK_PROFILE_CODE}');
    expect(installDist).toContain("install?.dir");
    expect(installDist).toContain("install?.usePm2");
    expect(installDist).toContain("bootstrapUsers");
    expect(installDist).toContain("SEQDESK_CFG_BOOTSTRAP_ADMIN_PASSWORD");
    expect(installDist).toContain("passwordHash = hashBootstrapPassword(rawPassword)");
    expect(installDist).toContain("clear_bootstrap_plaintext_passwords");
    expect(installDist).toContain("redact_database_url");
    expect(installDist).toContain("Configured PostgreSQL is remote");
    expect(installDist).toContain("postgres_url_host");
    expect(installDist).toContain("Current DATABASE_URL: ${redacted_database_url}");
  });

  it("applies resolved profiles after database setup and includes the applicator in releases", () => {
    expect(installDist).toContain("node scripts/apply-install-profile.mjs --profile-config");
    expect(installDist).toContain("node scripts/apply-install-profile-assets.mjs --profile-config");
    expect(installDist).toContain("SEQDESK_PIPELINE_DATABASE_DIR");
    expect(buildRelease).toContain("scripts/apply-install-profile.mjs");
    expect(buildRelease).toContain("scripts/apply-install-profile-assets.mjs");
    expect(buildRelease).toContain("scripts/run-install-profile-pipeline-smoke.mjs");
    expect(buildRelease).toContain("scripts/setup-conda-env.sh");
    expect(buildRelease).toContain("data/pipeline-databases.json");
  });

  it("keeps the profile applicator scoped to settings upserts", () => {
    expect(profileApplicator).toContain("sequencingRunSampleFormFields");
    expect(profileApplicator).toContain("sequencingTechConfig");
    expect(profileApplicator).toContain("installProfile");
    expect(profileApplicator).toContain("installProfilePipelineAllowlist");
    expect(profileApplicator).toContain("discoverInstalledPipelineIds");
    expect(profileApplicator).toContain("pipelineDatabaseDir");
    expect(profileApplicator).toContain("extra.telemetry");
    expect(profileApplicator).toContain("installProfileSeedData");
    expect(profileApplicator).toContain("installProfilePipelineSmokeTests");
    expect(profileApplicator).not.toContain("deleteMany");
  });

  it("has a second profile asset pass for DB downloads and smoke fixtures", () => {
    expect(profileAssetsApplicator).toContain("applyProfileAssets");
    expect(profileAssetsApplicator).toContain("profile-config");
    expect(profileAssetsLib).toContain("downloadedFastqBundle");
    expect(profileAssetsLib).toContain("SHA256 mismatch");
  });

  it("has an API pipeline smoke runner for profile-declared tests", () => {
    expect(profilePipelineSmokeRunner).toContain("installProfilePipelineSmokeTests");
    expect(profilePipelineSmokeRunner).toContain("/api/pipelines/runs");
    expect(profilePipelineSmokeRunner).toContain("checksum1");
    expect(profilePipelineSmokeRunner).toContain("pipelineSources");
  });

  it("has an install-profile assertion script for end-to-end canaries", () => {
    expect(profileAssert).toContain("installProfile");
    expect(profileAssert).toContain("sequencingRunSampleFormFields");
    expect(profileAssert).toContain("ont-minion-mk1d");
    expect(profileAssert).toContain("metaxpath");
    expect(profileAssert).toContain("telemetry.intervalHours");
  });

  it("defines bifo_dmz AlmaLinux canaries for plain and hosted-profile installs", () => {
    expect(profileWorkflow).toContain("push:");
    expect(profileWorkflow).toContain('PROFILE_ID: ${{ github.event.inputs.profile_id || \'ci-runner\' }}');
    expect(profileWorkflow).toContain("PROFILE_REGISTRY_URL: ${{ github.event.inputs.profile_registry_url || 'https://www.seqdesk.com/api/install-profiles' }}");
    expect(profileWorkflow).toContain("group: bifo_dmz");
    expect(profileWorkflow).toContain("labels: [self-hosted, Linux, X64, db-local, twincore, alma]");
    expect(profileWorkflow).toContain("build-install-artifacts:");
    expect(profileWorkflow).toContain("install-without-profile:");
    expect(profileWorkflow).toContain("install-with-profile:");
    expect(profileWorkflow).toContain("default: \"ci-runner\"");
    expect(profileWorkflow).toContain("SEQDESK_CI_PROFILE_CODE");
    expect(profileWorkflow).toContain("npm run sync-version");
    expect(profileWorkflow).toContain("npm pack --pack-destination");
    expect(profileWorkflow).toContain("SEQDESK_INSTALL_URL");
    expect(profileWorkflow).toContain("seqdesk \\");
    expect(profileWorkflow).toContain("scripts/assert-install-profile-applied.mjs");
    expect(profileWorkflow).toContain("scripts/run-telemetry-e2e.mjs");
    expect(profileWorkflow).toContain("TELEMETRY_JSON");
    expect(profileWorkflow).toContain("PROFILE_DATA_DIR");
    expect(profileWorkflow).toContain("PROFILE_RUN_DIR");
    expect(profileWorkflow).toContain("PIPELINE_SMOKE_JSON");
    expect(profileWorkflow).toContain("scripts/run-install-profile-pipeline-smoke.mjs");
  });

  it("defines a GitHub-hosted ci-runner pipeline smoke canary", () => {
    expect(hostedProfileSmokeWorkflow).toContain("name: Hosted Profile Smoke");
    expect(hostedProfileSmokeWorkflow).toContain("runs-on: ubuntu-latest");
    expect(hostedProfileSmokeWorkflow).toContain("image: postgres:16");
    expect(hostedProfileSmokeWorkflow).toContain("POSTGRES_DB: seqdesk_profile_ubuntu");
    expect(hostedProfileSmokeWorkflow).toContain("PROFILE_ID: ci-runner");
    expect(hostedProfileSmokeWorkflow).toContain("SEQDESK_CI_PROFILE_CODE");
    expect(hostedProfileSmokeWorkflow).toContain("Setup Miniconda for pipeline tools");
    expect(hostedProfileSmokeWorkflow).toContain("--with-pipelines");
    expect(hostedProfileSmokeWorkflow).toContain("scripts/assert-install-profile-applied.mjs");
    expect(hostedProfileSmokeWorkflow).toContain("scripts/run-install-profile-pipeline-smoke.mjs");
  });
});
