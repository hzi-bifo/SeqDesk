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

  it("names the unlabelled row-name column of an R write.table matrix", () => {
    const result = parseDelimited("S1\tS2\nENSG1\t1.5\t2\nENSG2\t0\t3\n");
    expect(result.columns).toEqual(["row_name", "S1", "S2"]);
    expect(result.rows[0]).toMatchObject({ row_name: "ENSG1" });
    expect(Object.keys(result.rows[1])).toEqual(["row_name", "S1", "S2"]);
  });

  it("still rejects a line with two fields more than the header", () => {
    expect(() => parseDelimited("a\tb\n1\t2\t3\t4\n")).toThrow(/more fields/);
  });

  it("makes duplicate headers unique", () => {
    const result = parseDelimited("cfu\tCFU\tcfu\n1\t2\t3\n");
    expect(result.columns).toEqual(["cfu", "CFU", "cfu_2"]);
  });

  it("reads a CAMI marked header without mistaking metadata or the first taxon for columns", () => {
    const result = parseDelimited("# Internal parser fixture\n@SampleID:parser-test\n@Version:0.10.0\n@@TAXID\tRANK\tTAXPATHSN\tPERCENTAGE\n1\tspecies\tTest taxon A\t60.5\n2\tspecies\tTest taxon B\t39.5\n", {
      headerLinePrefix: "@@", skipLinesStartingWith: "@", delimiter: "\t",
    });
    expect(result.columns).toEqual(["TAXID", "RANK", "TAXPATHSN", "PERCENTAGE"]);
    expect(result.rows).toHaveLength(2);
    expect(result.rows[0]).toEqual({ TAXID: "1", RANK: "species", TAXPATHSN: "Test taxon A", PERCENTAGE: "60.5" });
  });

  it("fails explicitly when a manifest-declared marked header is missing", () => {
    expect(() => parseDelimited("@SampleID:internal-test\n1\t42\n", { headerLinePrefix: "@@" }))
      .toThrow("Declared table header was not found");
  });

  it("returns an empty result for empty input", () => {
    expect(parseDelimited("\n\n").rows).toEqual([]);
  });
});


describe("delimited import edge cases", () => {
  it("preserves quoted newlines and escaped quotes as one cell", () => {
    const parsed = parseDelimited('sample,note\r\nA,"first\r\nsecond ""quoted"" line"\r\nB,ok\r\n');
    expect(parsed.rows).toEqual([{ sample: "A", note: 'first\nsecond "quoted" line' }, { sample: "B", note: "ok" }]);
  });
  it("rejects an unclosed quote rather than importing damaged data", () => {
    expect(() => parseDelimited('sample,value\n"unterminated,1\n')).toThrow("Unclosed quoted field");
  });
  it("rejects extra fields rather than silently dropping values", () => {
    expect(() => parseDelimited('sample,value\nA,1,2\n')).toThrow("more fields than the header");
  });
  it("rejects text after a closing quote", () => {
    expect(() => parseDelimited('sample,value\n"A"oops,1\n')).toThrow("Unexpected text");
  });
  it("keeps columns whose original names collide with generated suffixes", () => {
    const result = parseDelimited('value,value,value_2\n1,2,3\n');
    expect(new Set(result.columns).size).toBe(3);
    expect(Object.values(result.rows[0])).toEqual(["1", "2", "3"]);
  });
});


it("detects delimiters outside quoted header fields", () => {
  const parsed = parseDelimited('sample\t"note,with,many,commas"\nS1\tok\n');
  expect(parsed.delimiter).toBe("\t");
  expect(parsed.columns).toHaveLength(2);
});

describe("parseDelimited with hashComments (QIIME exports)", () => {
  it("skips the biom preamble and keeps the #OTU ID header", async () => {
    const { MP_FEATURE_TABLE, MP_SAMPLES } = await import("../__fixtures__/moving-pictures");
    const parsed = parseDelimited(MP_FEATURE_TABLE, { delimiter: "auto", hashComments: true });
    expect(parsed.columns).toEqual(["OTU_ID", ...MP_SAMPLES]);
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ OTU_ID: "4b5eeb300368260019c1fbc7a3c718fc", L1S8: "2595.0" });
  });

  it("leaves the #q2:types directive out of the sample metadata rows", async () => {
    const { MP_SAMPLE_METADATA } = await import("../__fixtures__/moving-pictures");
    const parsed = parseDelimited(MP_SAMPLE_METADATA, { delimiter: "auto", hashComments: true });
    expect(parsed.columns.slice(0, 3)).toEqual(["sample-id", "barcode-sequence", "body-site"]);
    expect(parsed.rows.map((row) => row["sample-id"])).not.toContain("#q2:types");
    expect(parsed.rows).toHaveLength(6);
  });

  it("keeps a lone #SampleID header and leaves plain files alone", () => {
    expect(parseDelimited("#SampleID\tsite\nA\tgut\n", { hashComments: true }).columns).toEqual(["SampleID", "site"]);
    expect(() => parseDelimited("# Constructed from biom file\n#OTU ID\tS1\tS2\nf\t1\t2\n")).toThrow();
  });
});
