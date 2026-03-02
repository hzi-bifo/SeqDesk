import { describe, it, expect } from "vitest";
import {
  validateLicense,
  isFeatureEnabled,
  isUserLimitReached,
  getLicenseSummary,
} from "./validator";
import type { LicenseData, LicenseStatus } from "./types";

function makeLicense(overrides?: Partial<LicenseData>): LicenseData {
  return {
    id: "test-license",
    customer: "Test Org",
    email: "test@example.com",
    type: "enterprise",
    issuedAt: "2024-01-01T00:00:00Z",
    expiresAt: "2030-12-31T00:00:00Z",
    maxUsers: 10,
    features: {
      pipelines: true,
      enaSubmission: true,
      aiValidation: false,
      multiDepartment: true,
      api: true,
      customBranding: false,
    },
    ...overrides,
  };
}

describe("isFeatureEnabled", () => {
  it("returns true for enabled feature", () => {
    expect(isFeatureEnabled(makeLicense(), "pipelines")).toBe(true);
    expect(isFeatureEnabled(makeLicense(), "enaSubmission")).toBe(true);
  });

  it("returns false for disabled feature", () => {
    expect(isFeatureEnabled(makeLicense(), "aiValidation")).toBe(false);
    expect(isFeatureEnabled(makeLicense(), "customBranding")).toBe(false);
  });

  it("returns false when license is null", () => {
    expect(isFeatureEnabled(null, "pipelines")).toBe(false);
  });
});

describe("isUserLimitReached", () => {
  it("returns true when current users >= max", () => {
    expect(isUserLimitReached(makeLicense({ maxUsers: 5 }), 5)).toBe(true);
    expect(isUserLimitReached(makeLicense({ maxUsers: 5 }), 6)).toBe(true);
  });

  it("returns false when under limit", () => {
    expect(isUserLimitReached(makeLicense({ maxUsers: 10 }), 5)).toBe(false);
  });

  it("returns false for unlimited (maxUsers=0)", () => {
    expect(isUserLimitReached(makeLicense({ maxUsers: 0 }), 1000)).toBe(false);
  });

  it("returns true when license is null", () => {
    expect(isUserLimitReached(null, 1)).toBe(true);
  });
});

describe("getLicenseSummary", () => {
  it("returns license info for valid license", () => {
    const status: LicenseStatus = {
      valid: true,
      license: makeLicense(),
      daysRemaining: 365,
    };
    const summary = getLicenseSummary(status);
    expect(summary).toContain("Enterprise");
    expect(summary).toContain("Test Org");
    expect(summary).toContain("10 users");
  });

  it("shows expiration warning when <= 30 days", () => {
    const status: LicenseStatus = {
      valid: true,
      license: makeLicense(),
      daysRemaining: 15,
    };
    const summary = getLicenseSummary(status);
    expect(summary).toContain("Expires in 15 days");
  });

  it("does not show expiration warning when > 30 days", () => {
    const status: LicenseStatus = {
      valid: true,
      license: makeLicense(),
      daysRemaining: 365,
    };
    const summary = getLicenseSummary(status);
    expect(summary).not.toContain("Expires in");
  });

  it("shows unlimited for maxUsers=0", () => {
    const status: LicenseStatus = {
      valid: true,
      license: makeLicense({ maxUsers: 0 }),
      daysRemaining: 365,
    };
    expect(getLicenseSummary(status)).toContain("unlimited users");
  });

  it("returns error message for invalid license", () => {
    const status: LicenseStatus = {
      valid: false,
      license: null,
      error: "Invalid license key format",
    };
    expect(getLicenseSummary(status)).toBe("Invalid license key format");
  });

  it("returns fallback for invalid license without error", () => {
    const status: LicenseStatus = {
      valid: false,
      license: null,
    };
    expect(getLicenseSummary(status)).toBe("No valid license");
  });
});

describe("validateLicense", () => {
  it("rejects empty string", async () => {
    const result = await validateLicense("");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No license key");
  });

  it("rejects whitespace-only string", async () => {
    const result = await validateLicense("   ");
    expect(result.valid).toBe(false);
    expect(result.error).toContain("No license key");
  });

  it("rejects non-JWT string", async () => {
    const result = await validateLicense("not-a-jwt-token");
    expect(result.valid).toBe(false);
    expect(result.error).toBe("Invalid license key format");
  });

  it("rejects token with invalid JSON payload", async () => {
    // Create a token where the payload is not valid JSON
    const header = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
    const payload = Buffer.from("not json").toString("base64url");
    const result = await validateLicense(`${header}.${payload}.sig`);
    expect(result.valid).toBe(false);
  });
});
