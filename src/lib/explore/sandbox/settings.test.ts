import { describe, expect, it } from "vitest";
import { DEFAULT_SANDBOX_SETTINGS, normalizeSandboxSettings } from "./settings";

describe("sandbox settings", () => {
  it("falls back to confining when available and no network", () => {
    expect(normalizeSandboxSettings(undefined)).toEqual(DEFAULT_SANDBOX_SETTINGS);
    expect(normalizeSandboxSettings({ mode: "sometimes", network: "all" })).toMatchObject({ mode: "auto", network: "none" });
  });

  it("keeps only absolute, shell-safe extra paths and bounds the time limit", () => {
    const settings = normalizeSandboxSettings({ mode: "required", network: "host", extraReadOnly: ["/vol/biotools", "relative", "/", "/bad$(x)", "  /net/refs  "], localTimeLimitHours: 99999 });
    expect(settings.mode).toBe("required");
    expect(settings.network).toBe("host");
    expect(settings.extraReadOnly).toEqual(["/vol/biotools", "/net/refs"]);
    expect(settings.localTimeLimitHours).toBe(720);
    expect(normalizeSandboxSettings({ localTimeLimitHours: -3 }).localTimeLimitHours).toBe(0);
  });
});
