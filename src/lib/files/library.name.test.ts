import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { cleanFileName } from "./library";

describe("cleanFileName", () => {
  it("keeps the last path segment and drops control characters", () => {
    expect(cleanFileName("../../evil.csv")).toBe("evil.csv");
    expect(cleanFileName("C:\\Users\\me\\data\\table.tsv")).toBe("table.tsv");
    expect(cleanFileName("  a\u0000b.csv ")).toBe("ab.csv");
    expect(cleanFileName("")).toBe("file");
  });
  it("shortens a very long stem but keeps the extension, so the file is still recognised as a table", () => {
    const long = `${"long".repeat(70)}.csv`;
    const short = cleanFileName(long);
    expect(short).toHaveLength(240);
    expect(short.endsWith(".csv")).toBe(true);
    expect(cleanFileName(`${"x".repeat(300)}.tsv.gz`).endsWith(".tsv.gz")).toBe(true);
    expect(cleanFileName("y".repeat(300))).toHaveLength(240);
  });
});
