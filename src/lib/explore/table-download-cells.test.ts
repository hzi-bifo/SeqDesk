import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { csvCell, tsvCell } from "./table-download";

describe("exported cells keep what was stored", () => {
  it("quotes a TSV cell with a tab, line break or quote instead of flattening it", () => {
    expect(tsvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(tsvCell("a\tb")).toBe('"a\tb"');
    expect(tsvCell('say "hi"')).toBe('"say ""hi"""');
    expect(tsvCell("001")).toBe("001");
    expect(tsvCell(null)).toBe("");
  });

  it("quotes a CSV cell with a comma, quote or line break", () => {
    expect(csvCell("line one\nline two")).toBe('"line one\nline two"');
    expect(csvCell("a,b")).toBe('"a,b"');
    expect(csvCell("plain")).toBe("plain");
  });
});
