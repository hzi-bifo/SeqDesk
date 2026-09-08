import { describe, expect, it } from "vitest";
import { formatSequencingIdentifier } from "./format-identifier";

describe("sequencing identifier display", () => {
  it("keeps the distinguishing start and end of long import identifiers", () => {
    expect(formatSequencingIdentifier("IMP-2c94f52e501c734e6267e77342c7ed55cddab51c"))
      .toBe("IMP-2c94f52e…dab51c");
  });
  it.each(["", "SEQ-2026-0001", "123456789012345678901234"])("leaves short identifiers unchanged: %s", identifier => {
    expect(formatSequencingIdentifier(identifier)).toBe(identifier);
  });
  it("shortens an identifier just beyond the display limit", () => {
    expect(formatSequencingIdentifier("1234567890123456789012345")).toBe("123456789012…012345");
  });
});
