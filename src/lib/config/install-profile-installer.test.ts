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
const profileAssert = fs.readFileSync(
  path.join(repoRoot, "scripts/assert-install-profile-applied.mjs"),
  "utf8"
);
const profileWorkflow = fs.readFileSync(
  path.join(repoRoot, ".github/workflows/install-profile-alma.yml"),
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
  });

  it("applies resolved profiles after database setup and includes the applicator in releases", () => {
    expect(installDist).toContain("node scripts/apply-install-profile.mjs --profile-config");
    expect(buildRelease).toContain("scripts/apply-install-profile.mjs");
  });

  it("keeps the profile applicator scoped to settings upserts", () => {
    expect(profileApplicator).toContain("sequencingRunSampleFormFields");
    expect(profileApplicator).toContain("sequencingTechConfig");
    expect(profileApplicator).toContain("installProfile");
    expect(profileApplicator).toContain("extra.telemetry");
    expect(profileApplicator).not.toContain("deleteMany");
  });

  it("has an install-profile assertion script for end-to-end canaries", () => {
    expect(profileAssert).toContain("installProfile");
    expect(profileAssert).toContain("sequencingRunSampleFormFields");
    expect(profileAssert).toContain("ont-minion-mk1d");
    expect(profileAssert).toContain("metaxpath");
  });

  it("defines a self-hosted AlmaLinux canary for hosted profiles", () => {
    expect(profileWorkflow).toContain("push:");
    expect(profileWorkflow).toContain('PROFILE_ID: ${{ github.event.inputs.profile_id || \'ci-twincore\' }}');
    expect(profileWorkflow).toContain("PROFILE_REGISTRY_URL: ${{ github.event.inputs.profile_registry_url || 'https://www.seqdesk.com/api/install-profiles' }}");
    expect(profileWorkflow).toContain("runs-on: [self-hosted, Linux, X64, db-local, twincore, alma]");
    expect(profileWorkflow).toContain("default: \"ci-twincore\"");
    expect(profileWorkflow).toContain("SEQDESK_CI_PROFILE_CODE");
    expect(profileWorkflow).toContain("scripts/assert-install-profile-applied.mjs");
    expect(profileWorkflow).toContain("install-private-metaxpath.sh");
    expect(profileWorkflow).toContain("0.0.0-ci");
  });
});
