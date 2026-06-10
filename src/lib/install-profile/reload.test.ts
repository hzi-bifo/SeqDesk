import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  defaultProfileRegistryUrl,
  profileCodeEnvName,
  reloadHostedInstallProfile,
  resolveProfileCodeFromEnv,
  summarizeInstallProfile,
} from "./reload";

const originalRegistryUrl = process.env.SEQDESK_PROFILE_REGISTRY_URL;
const originalRegistryAllowlist = process.env.SEQDESK_PROFILE_REGISTRY_ALLOWLIST;
const originalFetch = globalThis.fetch;

function testEnv(values: Record<string, string>): NodeJS.ProcessEnv {
  return {
    NODE_ENV: process.env.NODE_ENV || "test",
    ...values,
  };
}

afterEach(() => {
  if (originalRegistryUrl === undefined) {
    delete process.env.SEQDESK_PROFILE_REGISTRY_URL;
  } else {
    process.env.SEQDESK_PROFILE_REGISTRY_URL = originalRegistryUrl;
  }
  if (originalRegistryAllowlist === undefined) {
    delete process.env.SEQDESK_PROFILE_REGISTRY_ALLOWLIST;
  } else {
    process.env.SEQDESK_PROFILE_REGISTRY_ALLOWLIST = originalRegistryAllowlist;
  }
  globalThis.fetch = originalFetch;
  vi.restoreAllMocks();
});

describe("install profile reload helpers", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-profile-reload-test-"));
    await fs.mkdir(path.join(tempDir, "scripts"), { recursive: true });
    await fs.writeFile(
      path.join(tempDir, "package.json"),
      JSON.stringify({ version: "1.1.112" })
    );
    await fs.writeFile(
      path.join(tempDir, "scripts", "apply-install-profile.mjs"),
      "console.log('applied settings')\n"
    );
    await fs.writeFile(
      path.join(tempDir, "scripts", "apply-install-profile-assets.mjs"),
      "console.log('{\"success\":true}')\n"
    );
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("derives profile-specific setup code environment names", () => {
    expect(profileCodeEnvName("dev")).toBe("DEV_SETUP_CODE");
    expect(profileCodeEnvName("hzi-dev.2")).toBe("HZI_DEV_2_SETUP_CODE");
  });

  it("resolves setup codes from supported environment fallbacks", () => {
    expect(
      resolveProfileCodeFromEnv("dev", testEnv({
        DEV_SETUP_CODE: "dev-code",
      }))
    ).toBe("dev-code");
    expect(
      resolveProfileCodeFromEnv("dev", testEnv({
        SEQDESK_KEY: "generic-key",
        DEV_SETUP_CODE: "dev-code",
      }))
    ).toBe("generic-key");
    expect(
      resolveProfileCodeFromEnv("dev", testEnv({
        SEQDESK_PROFILE_CODE: "profile-code",
        SEQDESK_KEY: "generic-key",
        DEV_SETUP_CODE: "dev-code",
      }))
    ).toBe("profile-code");
  });

  it("summarizes hosted profiles without returning the full profile payload", () => {
    expect(
      summarizeInstallProfile({
        id: "dev",
        version: "2026.05.13",
        minSeqDeskVersion: "1.1.99",
        profile: {
          name: "Development Server",
          secret: "not-returned",
        },
        modules: {
          pipelines: ["simulate-reads"],
        },
      })
    ).toEqual({
      id: "dev",
      name: "Development Server",
      version: "2026.05.13",
      minSeqDeskVersion: "1.1.99",
    });
  });

  it("uses the default hosted profile registry unless overridden", () => {
    delete process.env.SEQDESK_PROFILE_REGISTRY_URL;
    expect(defaultProfileRegistryUrl()).toBe(
      "https://seqdesk.org/api/install-profiles"
    );

    process.env.SEQDESK_PROFILE_REGISTRY_URL = "https://profiles.example.test/api";
    expect(defaultProfileRegistryUrl()).toBe("https://profiles.example.test/api");
  });

  it("rejects non-local HTTP hosted profile registries", async () => {
    await expect(
      reloadHostedInstallProfile({
        profileId: "dev",
        profileCode: "setup-code",
        profileRegistryUrl: "http://profiles.example.test/api",
        cwd: tempDir,
      })
    ).rejects.toThrow("must use HTTPS");
  });

  it("requires an explicit setup code for non-default registries", async () => {
    process.env.SEQDESK_PROFILE_REGISTRY_ALLOWLIST = "https://profiles.example.test";

    await expect(
      reloadHostedInstallProfile({
        profileId: "dev",
        profileRegistryUrl: "https://profiles.example.test/api",
        cwd: tempDir,
        env: testEnv({ SEQDESK_PROFILE_CODE: "env-code" }),
      })
    ).rejects.toThrow("Explicit profile access code is required");
  });

  it("rejects resolved profiles whose id does not match the requested profile", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({ id: "qa", version: "1.0.0" }),
    }) as unknown as typeof fetch;

    await expect(
      reloadHostedInstallProfile({
        profileId: "dev",
        profileCode: "setup-code",
        cwd: tempDir,
      })
    ).rejects.toThrow("Hosted profile id mismatch");
  });

  it("rejects profiles that require a newer SeqDesk version", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "dev",
        version: "1.0.0",
        minSeqDeskVersion: "99.0.0",
      }),
    }) as unknown as typeof fetch;

    await expect(
      reloadHostedInstallProfile({
        profileId: "dev",
        profileCode: "setup-code",
        cwd: tempDir,
      })
    ).rejects.toThrow("requires SeqDesk 99.0.0+");
  });

  it("returns validation warnings for install-time-only sections", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "dev",
        version: "1.0.0",
        minSeqDeskVersion: "1.0.0",
        app: { port: 8000 },
        minknowStream: { enabled: true },
        pipelines: { enabled: true },
        forms: {},
      }),
    }) as unknown as typeof fetch;

    const result = await reloadHostedInstallProfile({
      profileId: "dev",
      profileCode: "setup-code",
      cwd: tempDir,
    });

    expect(result.validation).toMatchObject({
      ignoredSections: ["app", "minknowStream"],
      appliedSections: ["forms", "pipelines"],
    });
    expect(result.validation.warnings).toContain(
      "Hosted profile section is install-time only during reload: app"
    );
    expect(result.validation.warnings).toContain(
      "Hosted profile section is not supported during reload: minknowStream"
    );
  });

  it("reports all reload-safe hosted profile sections as applied", async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "dev",
        version: "1.0.0",
        minSeqDeskVersion: "1.0.0",
        access: {},
        auth: {},
        ena: {},
        forms: {},
        moduleSettings: {},
        modules: {},
        notifications: {},
        pipelineSmokeTests: {},
        pipelines: {},
        seedData: {},
        sequencingFiles: {},
        sequencingTech: {},
        site: {},
        telemetry: {},
      }),
    }) as unknown as typeof fetch;

    const result = await reloadHostedInstallProfile({
      profileId: "dev",
      profileCode: "setup-code",
      cwd: tempDir,
    });

    expect(result.validation.appliedSections).toEqual([
      "access",
      "auth",
      "ena",
      "forms",
      "moduleSettings",
      "modules",
      "notifications",
      "pipelineSmokeTests",
      "pipelines",
      "seedData",
      "sequencingFiles",
      "sequencingTech",
      "site",
      "telemetry",
    ]);
  });

  it("rejects malformed structured hosted profile sections before applying settings", async () => {
    const applyScriptPath = path.join(tempDir, "scripts", "apply-install-profile.mjs");
    await fs.writeFile(
      applyScriptPath,
      "throw new Error('settings script should not run for invalid profiles')\n"
    );
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "dev",
        version: "1.0.0",
        minSeqDeskVersion: "1.0.0",
        access: true,
      }),
    }) as unknown as typeof fetch;

    await expect(
      reloadHostedInstallProfile({
        profileId: "dev",
        profileCode: "setup-code",
        cwd: tempDir,
      })
    ).rejects.toThrow("Hosted profile section access must be a JSON object");
  });

  it("rejects concurrent hosted profile reloads", async () => {
    await fs.mkdir(path.join(tempDir, "pipelines"), { recursive: true });
    await fs.writeFile(path.join(tempDir, "pipelines", ".install-profile-reload.lock"), "{}");

    await expect(
      reloadHostedInstallProfile({
        profileId: "dev",
        profileCode: "setup-code",
        cwd: tempDir,
      })
    ).rejects.toThrow("already running");
  });

  it("recovers from stale hosted profile reload locks", async () => {
    const lockPath = path.join(tempDir, "pipelines", ".install-profile-reload.lock");
    await fs.mkdir(path.dirname(lockPath), { recursive: true });
    await fs.writeFile(lockPath, "{}");
    const staleDate = new Date(Date.now() - 2 * 60 * 60 * 1000);
    await fs.utimes(lockPath, staleDate, staleDate);
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: vi.fn().mockResolvedValue({
        id: "dev",
        version: "1.0.0",
        minSeqDeskVersion: "1.0.0",
      }),
    }) as unknown as typeof fetch;

    const result = await reloadHostedInstallProfile({
      profileId: "dev",
      profileCode: "setup-code",
      cwd: tempDir,
    });

    expect(result.profile.id).toBe("dev");
    await expect(fs.stat(lockPath)).rejects.toMatchObject({ code: "ENOENT" });
  });
});
