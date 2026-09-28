import { Readable } from "stream";
import { describe, expect, it } from "vitest";
import { parseDelimited, type DelimitedParseOptions } from "./delimited";
import { parseDelimitedStream, streamLineBatches } from "./delimited-stream";

async function viaStream(text: string, options: DelimitedParseOptions = {}, chunk = 3) {
  const bytes = Buffer.from(text, "utf8");
  const pieces: Buffer[] = [];
  for (let at = 0; at < bytes.length; at += chunk) pieces.push(bytes.subarray(at, at + chunk));
  const state: { header?: { columns: string[]; delimiter: string }; truncated?: boolean } = {};
  const rows = [];
  for await (const batch of parseDelimitedStream(streamLineBatches(Readable.from(pieces)), options, state, 7)) rows.push(...batch);
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

  it("hands rows over in batches, not one promise per row", async () => {
    const lines = ["gene\ts1"];
    for (let index = 0; index < 50_000; index += 1) lines.push(`g${index}\t${index}`);
    let batches = 0, rows = 0;
    for await (const batch of parseDelimitedStream(streamLineBatches(Readable.from([Buffer.from(`${lines.join("\n")}\n`)])))) { batches += 1; rows += batch.length; }
    expect(rows).toBe(50_000);
    expect(batches).toBeLessThanOrEqual(51);
  });
});

describe("text tables people export from Excel", () => {
  const read = async (bytes: Buffer, delimiter: DelimitedParseOptions["delimiter"] = "csv") => {
    const pieces: Buffer[] = [];
    for (let at = 0; at < bytes.length; at += 5) pieces.push(bytes.subarray(at, at + 5));
    const state: { header?: { columns: string[]; delimiter: string } } = {};
    const rows = [];
    for await (const batch of parseDelimitedStream(streamLineBatches(Readable.from(pieces)), { delimiter }, state)) rows.push(...batch);
    return { columns: state.header?.columns ?? [], rows, delimiter: state.header?.delimiter };
  };

  it("reads a semicolon-separated .csv with decimal commas", async () => {
    const result = await read(Buffer.from("a;b;c\n1,5;2;3\n"));
    expect(result.delimiter).toBe(";");
    expect(result.rows).toEqual([{ a: "1,5", b: "2", c: "3" }]);
  });

  it("keeps a plain comma .csv on commas, quoted semicolons included", async () => {
    const result = await read(Buffer.from('a,b\n"x;y",2\n'));
    expect(result.delimiter).toBe(",");
    expect(result.rows).toEqual([{ a: "x;y", b: "2" }]);
  });

  it("reads Windows-1252 text instead of showing replacement characters", async () => {
    const result = await read(Buffer.from("nom,ville\nRené,Zürich\n", "latin1"));
    expect(result.rows).toEqual([{ nom: "René", ville: "Zürich" }]);
  });

  it("reads UTF-16 text with a byte-order mark", async () => {
    const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from("gène\tn\nα\t1\n", "utf16le")]);
    const result = await read(utf16, "auto");
    expect(result.columns).toEqual(["gène", "n"]);
    expect(result.rows).toEqual([{ gène: "α", n: "1" }]);
  });

  it("drops a UTF-8 byte-order mark in front of a quoted header", async () => {
    const result = await read(Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('"a","b"\n1,2\n')]));
    expect(result.columns).toEqual(["a", "b"]);
  });

  it("says a binary file is not text", async () => {
    await expect(read(Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00, 0x08, 0x00, 0x0a, 0x00]))).rejects.toThrow(/binary data/);
  });
});

describe("quoted line breaks and #N/A, wherever the chunks fall", () => {
  // Rows: a quoted line break, a first column of #N/A whose last column has a quoted line break (an Excel/R export),
  // a QIIME-style "#" directive that must still be left out, quoted commas, and a doubled quote next to a line break.
  const text = [
    "id,note,last",
    '1,"a, b","line\nbreak"',
    '#N/A,"x ""y""","line\nbreak2"',
    "#q2:types,categorical,categorical",
    '3,"multi\n\nblank line above",tail',
    '#NULL!,plain,"end\nquote"',
    "5,\"quote at end\"\"\",z",
  ].join("\n") + "\n";
  const expected = [
    { id: "1", note: "a, b", last: "line\nbreak" },
    { id: "#N/A", note: 'x "y"', last: "line\nbreak2" },
    { id: "3", note: "multi\n\nblank line above", last: "tail" },
    { id: "#NULL!", note: "plain", last: "end\nquote" },
    { id: "5", note: 'quote at end"', last: "z" },
  ];

  it("reads the same rows at every chunk size, so a line break inside quotes may fall on a chunk boundary", async () => {
    expect(parseDelimited(text, { delimiter: "csv", hashComments: true }).rows).toEqual(expected);
    for (let chunk = 1; chunk <= text.length; chunk += 1) {
      const result = await viaStream(text, { delimiter: "csv", hashComments: true }, chunk);
      expect(result.rows, `chunk size ${chunk}`).toEqual(expected);
    }
  });

  it("reads Windows line endings inside quotes the same way", async () => {
    const crlf = text.replace(/\n/g, "\r\n");
    for (const chunk of [1, 2, 7, 64, crlf.length]) {
      const result = await viaStream(crlf, { delimiter: "csv", hashComments: true }, chunk);
      expect(result.rows.map((row) => row.id), `chunk size ${chunk}`).toEqual(["1", "#N/A", "3", "#NULL!", "5"]);
      expect(result.rows[0].last).toMatch(/^line\r?\nbreak$/);
    }
  });
});

describe("a stored table is read back as UTF-8 exactly as written", () => {
  it("does not guess an encoding, drop a leading U+FEFF or stop at a NUL", async () => {
    const stored = Buffer.from("﻿first\tsecond\n\u0000\tx\n", "utf8");
    const lines: string[] = [];
    for await (const batch of streamLineBatches(Readable.from([stored.subarray(0, 4), stored.subarray(4)]), { utf8: true })) lines.push(...batch);
    expect(lines).toEqual(["﻿first\tsecond", "\u0000\tx", ""]);
  });
});
