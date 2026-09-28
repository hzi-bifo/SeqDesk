import { describe, expect, it } from "vitest";
import { parseImportFile, prepareImport } from "./file";

describe("explore file import", () => {
  it("parses a TSV and applies the INDIVO grammar", async () => {
    const text = "A-ID\ttaxonName\ttaxonID\tnumReads\tsample\tisIsolate\nA001_hd_U_D463\tEscherichia coli\t562\t10\tUrine\t0\nA001_hd_A_D463\tEscherichia coli\t562\t4\tAscites\t0\n";
    const parsed = await parseImportFile(Buffer.from(text, "utf8"), {
      fileName: "long.tsv",
      idGrammar: { kind: "indivo", idColumn: "A-ID", sampleTypeColumn: "sample", isolateColumn: "isIsolate" },
    });
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({ subject: "A001", timepoint: 463, specimen_type: "Urine", is_isolate: false });
    expect(parsed.columns).toContain("subject");

    const prepared = prepareImport(parsed, { tableKind: "taxon-profile-long", fileName: "long.tsv", checksum: "abc" });
    expect(prepared.roles).toMatchObject({ sample: "A-ID", taxon: "taxonName", taxon_id: "taxonID", count: "numReads", subject: "subject", timepoint: "timepoint", group: "specimen_type" });
    expect(prepared.sensitivity).toBe("pseudonymous");
    expect(prepared.keys).toEqual({ sample: "A-ID", subject: "subject", key: "taxonID" });
    expect(prepared.warnings).toEqual([]);
  });

  it("parses an XLSX workbook", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Sheet1");
    sheet.addRow(["sample_id", "reads", "ok"]);
    sheet.addRow(["S1", 10, true]);
    sheet.addRow(["S2", 5.5, false]);
    sheet.addRow([null, null, null]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const parsed = await parseImportFile(buffer, { fileName: "table.xlsx" });
    expect(parsed.sheet).toBe("Sheet1");
    expect(parsed.rows).toEqual([
      { sample_id: "S1", reads: 10, ok: true },
      { sample_id: "S2", reads: 5.5, ok: false },
    ]);
    const prepared = prepareImport(parsed, { tableKind: "sample-summary", fileName: "table.xlsx", checksum: "x" });
    expect(prepared.roles.sample).toBe("sample_id");
    expect(prepared.schema.columns.map((column) => column.type)).toEqual(["string", "number", "boolean"]);
  });

  it("warns when the grammar column is missing and when roles are missing", async () => {
    const parsed = await parseImportFile(Buffer.from("x,y\n1,2\n", "utf8"), {
      fileName: "t.csv",
      idGrammar: { kind: "indivo", idColumn: "A-ID" },
    });
    expect(parsed.warnings[0]).toMatch(/missing/);
    const prepared = prepareImport(parsed, { tableKind: "taxon-profile-long", fileName: "t.csv", checksum: "x" });
    expect(prepared.warnings.some((warning) => /Roles still missing/.test(warning))).toBe(true);
  });

  it("rejects oversized files", async () => {
    const big = Buffer.alloc(100 * 1024 * 1024 + 1);
    await expect(parseImportFile(big, { fileName: "big.tsv" })).rejects.toThrow(/limit/);
  });
});


it("keeps XLSX values when generated column names collide", async () => {
  const ExcelJS = await import("exceljs");
  const book = new ExcelJS.Workbook();
  const sheet = book.addWorksheet("Data");
  sheet.addRow(["value", "value", "value_2"]);
  sheet.addRow([1, 2, 3]);
  const result = await parseImportFile(Buffer.from(await book.xlsx.writeBuffer()), { fileName: "collision.xlsx" });
  expect(new Set(result.columns).size).toBe(3);
  expect(Object.values(result.rows[0])).toEqual([1, 2, 3]);
});

describe("workbooks with several sheets", () => {
  it("says which sheet it read when a workbook has several and none was chosen", async () => {
    const ExcelJS = await import("exceljs");
    const workbook = new ExcelJS.Workbook();
    workbook.addWorksheet("One").addRows([["a"], [1]]);
    workbook.addWorksheet("Two").addRows([["b"], [2]]);
    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    const first = await parseImportFile(buffer, { fileName: "two.xlsx" });
    expect(first.warnings).toEqual(["This workbook has 2 sheets (One, Two); this reads “One”."]);
    const chosen = await parseImportFile(buffer, { fileName: "two.xlsx", sheet: "Two" });
    expect(chosen.warnings).toEqual([]);
    expect(chosen.rows).toEqual([{ b: 2 }]);
  });
});

describe("large delimited files with quoted line breaks", () => {
  it("reads every row of a .csv and a .csv.gz once, with #N/A first cells and line breaks inside quotes across many chunks", async () => {
    const fs = await import("fs/promises");
    const os = await import("os");
    const path = await import("path");
    const zlib = await import("zlib");
    const { streamDelimitedFile } = await import("./file");
    const rowsWanted = 30_000;
    const lines = ["int_0,text_1,text_2"];
    for (let index = 0; index < rowsWanted; index += 1) lines.push(`${index % 7 === 0 ? "#N/A" : index},"a, b ""${index}""","line\nbreak${index}"`);
    const text = lines.join("\n") + "\n";
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "csv-breaks-"));
    try {
      await fs.writeFile(path.join(dir, "messy.csv"), text);
      await fs.writeFile(path.join(dir, "messy.csv.gz"), zlib.gzipSync(text));
      for (const name of ["messy.csv", "messy.csv.gz"]) {
        const { rows } = streamDelimitedFile(path.join(dir, name), name);
        let count = 0;
        let fragments = 0;
        for await (const batch of rows as AsyncIterable<Array<Record<string, unknown>>>) {
          for (const row of batch) {
            const expected = count;
            if (row.text_2 !== `line\nbreak${expected}` || row.int_0 !== (expected % 7 === 0 ? "#N/A" : String(expected))) fragments += 1;
            count += 1;
          }
        }
        expect({ name, count, fragments }).toEqual({ name, count: rowsWanted, fragments: 0 });
      }
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
