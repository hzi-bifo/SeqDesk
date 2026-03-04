import { describe, expect, it } from "vitest";

import * as licenseIndex from "./index";
import {
  generateDevLicense,
  getLicenseSummary,
  isFeatureEnabled,
  isUserLimitReached,
  validateLicense,
} from "./validator";

describe("license index barrel exports", () => {
  it("re-exports validator functions", () => {
    expect(licenseIndex.validateLicense).toBe(validateLicense);
    expect(licenseIndex.isFeatureEnabled).toBe(isFeatureEnabled);
    expect(licenseIndex.isUserLimitReached).toBe(isUserLimitReached);
    expect(licenseIndex.getLicenseSummary).toBe(getLicenseSummary);
    expect(licenseIndex.generateDevLicense).toBe(generateDevLicense);
  });
});
