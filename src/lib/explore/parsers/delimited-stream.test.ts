import { Readable } from "stream";
import { describe, expect, it } from "vitest";
import { parseDelimited, type DelimitedParseOptions } from "./delimited";
import { parseDelimitedStream, streamLines } from "./delimited-stream";

async function viaStream(text: string, options: DelimitedParseOptions = {}, chunk = 3) {
  const bytes = Buffer.from(text, "utf8");
  const pieces: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += chunk) pieces.push(bytes.subarray(at, at + chunk));
  const state: { header?: { columns: string[]; delimiter: string }; truncated?: boolean } = {};
  const rows = [];
  for await (const row of parseDelimitedStream(streamLines(Readable.from(pieces)), options, state)) rows.push(row);
  return { columns: state.header?.columns ?? [], rows, truncated: Boolean(state.truncated), delimiter: state.header?.delimiter ?? "\t" };
}

const cases: Array<[string, DelimitedParseOptions?]> = [
  ["sampleName\tnumReads\t% humanPert\nS1\t10\t95.5\nS2\t\t1\n"],
  ['a,b\n"x, y","she said ""hi"""\n'],
  ["# comment\nk\tv\n1\t2\n3\t4\n5\t6\n", { skipLinesStartingWith: "#", maxRows: 2 }],
  ["S1\tS2\nENSG1\t1.5\t2\nENSG2\t0\t3\n"],
  ["cfu\tCFU\tcfu\n1\t2\t3\n"],
  ["# Internal parser fixture\n@SampleID:parser-test\n@Version:0.10.0\n@@TAXID\tRANK\tTAXPATHSN\tPERCENTAGE\n1\tspecies\tTest taxon A\t60.5\n2\tspecies\tTest taxon B\t39.5\n", { headerLinePrefix: "@@", skipLinesStartingWith: "@", delimiter: "\t" }],
  ["\n\n"],
  ['sample,note\r\nA,"first\r\nsecond ""quoted"" line"\r\nB,ok\r\n'],
  ["# Constructed from biom file\n#OTU ID\tS1\tS2\nOTU1\t1\t2\n#q2:types\tnumeric\tnumeric\nOTU2\t3\t4", { hashComments: true }],
  ["gene;a;b\nx;1;2\ny;3;4\n"],
  ["ümlaut\tß\nä\t€\n"],
];

describe("parseDelimitedStream", () => {
  it("gives the same columns, rows and truncation as parseDelimited, whatever the chunk size", async () => {
    for (const [text, options] of cases) {
      const expected = parseDelimited(text, options);
      for (const chunk of [1, 2, 7, 1 << 16]) {
        expect(await viaStream(text, options, chunk)).toEqual({ columns: expected.columns, rows: expected.rows, truncated: expected.truncated, delimiter: expected.delimiter });
      }
    }
  });

  it("raises the same errors", async () => {
    for (const text of ["a\tb\n1\t2\t3\t4\n", 'sample,value\n"unterminated,1\n', 'sample,value\n"A"oops,1\n']) {
      let expected = "";
      try { parseDelimited(text); } catch (error) { expected = (error as Error).message; }
      await expect(viaStream(text)).rejects.toThrow(expected);
    }
    await expect(viaStream("@SampleID:x\n1\t42\n", { headerLinePrefix: "@@" })).rejects.toThrow("Declared table header was not found");
  });

  it("reads a large file row by row", async () => {
    const lines = ["gene\ts1\ts2"];
    for (let index = 0; index < 50_000; index += 1) lines.push(`g${index}\t${index}\t${index * 2}`);
    const result = await viaStream(`${lines.join("\n")}\n`, {}, 1 << 16);
    expect(result.rows).toHaveLength(50_000);
    expect(result.rows[49_999]).toEqual({ gene: "g49999", s1: "49999", s2: "99998" });
  });
});
