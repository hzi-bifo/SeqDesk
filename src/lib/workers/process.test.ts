import { describe, expect, it } from "vitest";
import { isProcessAlive } from "./process";

describe("isProcessAlive", () => {
  it("returns true for the current process pid", () => {
    expect(isProcessAlive(process.pid)).toBe(true);
  });

  it("returns false for an obviously invalid pid", () => {
    expect(isProcessAlive(0)).toBe(false);
    expect(isProcessAlive(-1)).toBe(false);
    expect(isProcessAlive(Number.NaN)).toBe(false);
  });

  it("returns false for a pid that does not exist", () => {
    // 99999999 is virtually guaranteed not to be a real PID on a fresh system,
    // and process.kill returns ESRCH for it.
    expect(isProcessAlive(99_999_999)).toBe(false);
  });
});
