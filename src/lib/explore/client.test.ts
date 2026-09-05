import { describe, expect, it } from "vitest";
import { formatCell, formatNumber } from "./client";

describe("formatCell", () => {
  it("keeps the integer part of large non-integer values", () => {
    // These used to collapse to "1", "12" and "12345": the trailing-zero strip
    // ate the integer digits when toPrecision(6) produced no decimal point.
    expect(formatCell(99999.99)).toBe("100000");
    expect(formatCell(120000.3)).toBe("120000");
    expect(formatCell(123450.4)).toBe("123450");
    expect(formatCell(1234.5)).toBe("1234.5");
  });

  it("rounds small values to six significant digits and prints integers verbatim", () => {
    expect(formatNumber(0.123456789)).toBe("0.123457");
    expect(formatNumber(0.5)).toBe("0.5");
    expect(formatCell(42)).toBe("42");
    expect(formatCell(2500000)).toBe("2500000");
  });

  it("renders empty, boolean and text cells", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
    expect(formatCell(true)).toBe("true");
    expect(formatCell("Escherichia coli")).toBe("Escherichia coli");
  });
});
