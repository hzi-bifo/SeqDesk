import { afterEach, describe, expect, it } from "vitest";
import {
  defaultProfileRegistryUrl,
  profileCodeEnvName,
  resolveProfileCodeFromEnv,
  summarizeInstallProfile,
} from "./reload";

const originalRegistryUrl = process.env.SEQDESK_PROFILE_REGISTRY_URL;

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
});

describe("install profile reload helpers", () => {
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
      "https://www.seqdesk.com/api/install-profiles"
    );

    process.env.SEQDESK_PROFILE_REGISTRY_URL = "https://profiles.example.test/api";
    expect(defaultProfileRegistryUrl()).toBe("https://profiles.example.test/api");
  });
});
