import { describe, expect, it } from "vitest";
import { formatCell, formatNumber } from "./client";

describe("formatCell", () => {
  it("shows large values compact and thousands without decimals", () => {
    expect(formatCell(48872104.6)).toBe("48.9M");
    expect(formatCell(2500000)).toBe("2.5M");
    expect(formatCell(99999.99)).toBe("100,000");
    expect(formatCell(120000.3)).toBe("120,000");
    expect(formatCell(1234.5)).toBe("1,235");
  });

  it("keeps two decimals for everyday values and three significant digits for small ones", () => {
    expect(formatNumber(7.597082490143883)).toBe("7.6");
    expect(formatNumber(39.87206828)).toBe("39.87");
    expect(formatNumber(0.123456789)).toBe("0.123");
    expect(formatNumber(0.001468835)).toBe("0.00147");
    expect(formatNumber(0.5)).toBe("0.5");
    expect(formatCell(42)).toBe("42");
  });

  it("renders empty, boolean and text cells", () => {
    expect(formatCell(null)).toBe("");
    expect(formatCell(undefined)).toBe("");
    expect(formatCell(true)).toBe("true");
    expect(formatCell("Escherichia coli")).toBe("Escherichia coli");
  });
});
