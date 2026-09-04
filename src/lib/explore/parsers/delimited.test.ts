import { describe, expect, it } from "vitest";
import { parseDelimited } from "./delimited";

describe("parseDelimited", () => {
  it("parses a TSV with header normalization and cell coercion", () => {
    const result = parseDelimited("sampleName\tnumReads\t% humanPert\nS1\t10\t95.5\nS2\t\t1\n");
    expect(result.delimiter).toBe("\t");
    expect(result.columns).toEqual(["sampleName", "numReads", "%_humanPert"]);
    expect(result.rows).toEqual([
      { sampleName: "S1", numReads: "10", "%_humanPert": "95.5" },
      { sampleName: "S2", numReads: null, "%_humanPert": "1" },
    ]);
  });

  it("auto-detects CSV and honours quotes", () => {
    const result = parseDelimited('a,b\n"x, y","she said ""hi"""\n');
    expect(result.delimiter).toBe(",");
    expect(result.rows).toEqual([{ a: "x, y", b: 'she said "hi"' }]);
  });

  it("skips comment lines and truncates at maxRows", () => {
    const result = parseDelimited("# comment\nk\tv\n1\t2\n3\t4\n5\t6\n", {
      skipLinesStartingWith: "#",
      maxRows: 2,
    });
    expect(result.columns).toEqual(["k", "v"]);
    expect(result.rows).toHaveLength(2);
    expect(result.truncated).toBe(true);
  });

  it("makes duplicate headers unique", () => {
    const result = parseDelimited("cfu\tCFU\tcfu\n1\t2\t3\n");
    expect(result.columns).toEqual(["cfu", "CFU", "cfu_2"]);
  });

  it("returns an empty result for empty input", () => {
    expect(parseDelimited("\n\n").rows).toEqual([]);
  });
});
