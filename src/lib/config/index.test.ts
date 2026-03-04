import { describe, expect, it } from "vitest";

import * as configIndex from "./index";
import {
  clearConfigCache,
  getConfigValue,
  getDefaultConfig,
  loadConfig,
  validateConfig,
} from "./loader";
import { getEffectiveConfig, mergeWithDatabase } from "./database-merge";

describe("config index barrel exports", () => {
  it("re-exports loader functions", () => {
    expect(configIndex.loadConfig).toBe(loadConfig);
    expect(configIndex.getConfigValue).toBe(getConfigValue);
    expect(configIndex.clearConfigCache).toBe(clearConfigCache);
    expect(configIndex.getDefaultConfig).toBe(getDefaultConfig);
    expect(configIndex.validateConfig).toBe(validateConfig);
  });

  it("re-exports database merge functions", () => {
    expect(configIndex.mergeWithDatabase).toBe(mergeWithDatabase);
    expect(configIndex.getEffectiveConfig).toBe(getEffectiveConfig);
  });
});
