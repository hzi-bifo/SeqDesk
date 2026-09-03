import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";

import { clearConfigCache } from "@/lib/config/loader";
import { getServerDeploymentProfile } from "./server";

const ENV_KEYS = [
  "SEQDESK_DEPLOYMENT_PROFILE",
  "SEQDESK_APP_SURFACE",
  "NEXT_PUBLIC_SEQDESK_APP_SURFACE",
  "NEXT_PUBLIC_SEQDESK_WORKBENCH_ONLY",
] as const;

describe("server deployment profile", () => {
  let originalCwd = "";
  let tempDir = "";
  let originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    originalCwd = process.cwd();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-profile-"));
    originalEnv = Object.fromEntries(
      ENV_KEYS.map((key) => [key, process.env[key]])
    );
    ENV_KEYS.forEach((key) => delete process.env[key]);
    process.chdir(tempDir);
    clearConfigCache();
  });

  afterEach(async () => {
    process.chdir(originalCwd);
    for (const key of ENV_KEYS) {
      const value = originalEnv[key];
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    clearConfigCache();
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("reads the canonical profile from settings.json", async () => {
    await fs.writeFile(
      path.join(tempDir, "settings.json"),
      JSON.stringify({ deployment: { profile: "shared-lab" } }),
      "utf8"
    );
    clearConfigCache();

    expect(getServerDeploymentProfile().id).toBe("shared-lab");
  });

  it("lets the canonical environment value override the file", async () => {
    await fs.writeFile(
      path.join(tempDir, "settings.json"),
      JSON.stringify({ deployment: { profile: "sequencing-center" } }),
      "utf8"
    );
    process.env.SEQDESK_DEPLOYMENT_PROFILE = "research-workbench";
    clearConfigCache();

    expect(getServerDeploymentProfile().id).toBe("research-workbench");
  });

  it("uses legacy surface variables only when canonical config is absent", async () => {
    process.env.SEQDESK_APP_SURFACE = "workbench";

    expect(getServerDeploymentProfile().id).toBe("research-workbench");

    await fs.writeFile(
      path.join(tempDir, "settings.json"),
      JSON.stringify({ deployment: { profile: "shared-lab" } }),
      "utf8"
    );
    clearConfigCache();

    expect(getServerDeploymentProfile().id).toBe("shared-lab");
  });

  it("fails closed on an invalid explicit canonical profile", async () => {
    await fs.writeFile(
      path.join(tempDir, "settings.json"),
      JSON.stringify({ deployment: { profile: "workbench-ish" } }),
      "utf8"
    );
    clearConfigCache();

    expect(() => getServerDeploymentProfile()).toThrow(
      "Invalid deployment.profile"
    );
  });
});
