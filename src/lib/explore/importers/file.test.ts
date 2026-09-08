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
