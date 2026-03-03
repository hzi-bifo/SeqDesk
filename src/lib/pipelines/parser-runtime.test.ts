import fs from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getPackage: vi.fn(),
}));

vi.mock("./package-loader", () => ({
  getPackage: mocks.getPackage,
}));

import { runAllParsers, runParser } from "./parser-runtime";

let tempDir: string;

function createParserConfig(options: {
  id: string;
  type: "tsv" | "csv" | "json";
  filePattern: string;
  skipHeader?: boolean;
  columns: Array<{ name: string; index: number; type?: "string" | "int" | "float" | "boolean" }>;
}) {
  return {
    parser: {
      id: options.id,
      type: options.type,
      description: `${options.id} parser`,
      trigger: { filePattern: options.filePattern },
      skipHeader: options.skipHeader,
      columns: options.columns,
    },
  };
}

describe("parser-runtime", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "seqdesk-parser-runtime-"));
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("returns error when package is not found", async () => {
    mocks.getPackage.mockReturnValue(undefined);

    const result = await runParser("mag", "checkm", tempDir);

    expect(result.rows.size).toBe(0);
    expect(result.errors).toEqual(["Package not found: mag"]);
  });

  it("returns error when parser is not found in package", async () => {
    mocks.getPackage.mockReturnValue({ parsers: new Map() });

    const result = await runParser("mag", "checkm", tempDir);

    expect(result.rows.size).toBe(0);
    expect(result.errors).toEqual(["Parser not found: checkm"]);
  });

  it("returns empty result when trigger file does not exist", async () => {
    const parser = createParserConfig({
      id: "checkm",
      type: "tsv",
      filePattern: "**/checkm_summary.tsv",
      skipHeader: true,
      columns: [
        { name: "bin", index: 0 },
        { name: "completeness", index: 1, type: "float" },
      ],
    });
    mocks.getPackage.mockReturnValue({
      parsers: new Map([["checkm", parser]]),
    });

    const result = await runParser("mag", "checkm", tempDir);

    expect(result.rows.size).toBe(0);
    expect(result.errors).toEqual([]);
  });

  it("parses TSV data with typed conversions", async () => {
    const filePath = path.join(tempDir, "results", "checkm_summary.tsv");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      [
        "bin\tcompleteness\tvalid",
        "bin.1\t95.2\tyes",
        "bin.2\tNA\tno",
      ].join("\n")
    );

    const parser = createParserConfig({
      id: "checkm",
      type: "tsv",
      filePattern: "**/checkm_summary.tsv",
      skipHeader: true,
      columns: [
        { name: "bin", index: 0, type: "string" },
        { name: "completeness", index: 1, type: "float" },
        { name: "valid", index: 2, type: "boolean" },
      ],
    });
    mocks.getPackage.mockReturnValue({
      parsers: new Map([["checkm", parser]]),
    });

    const result = await runParser("mag", "checkm", tempDir);

    expect(result.errors).toEqual([]);
    expect(result.rows.get("bin.1")).toEqual({
      bin: "bin.1",
      completeness: 95.2,
      valid: true,
    });
    expect(result.rows.get("bin.2")).toEqual({
      bin: "bin.2",
      completeness: null,
      valid: false,
    });
  });

  it("parses CSV data and handles invalid booleans as null", async () => {
    const filePath = path.join(tempDir, "results", "metrics.csv");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      [
        "id,score,active",
        "row1,10,true",
        "row2,11,maybe",
      ].join("\n")
    );

    const parser = createParserConfig({
      id: "metrics",
      type: "csv",
      filePattern: "**/metrics.csv",
      skipHeader: true,
      columns: [
        { name: "id", index: 0 },
        { name: "score", index: 1, type: "int" },
        { name: "active", index: 2, type: "boolean" },
      ],
    });
    mocks.getPackage.mockReturnValue({
      parsers: new Map([["metrics", parser]]),
    });

    const result = await runParser("mag", "metrics", tempDir);

    expect(result.errors).toEqual([]);
    expect(result.rows.get("row1")).toEqual({
      id: "row1",
      score: 10,
      active: true,
    });
    expect(result.rows.get("row2")).toEqual({
      id: "row2",
      score: 11,
      active: null,
    });
  });

  it("parses JSON array payloads", async () => {
    const filePath = path.join(tempDir, "results", "taxonomy.json");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      JSON.stringify([
        { id: "bin1", confidence: "0.99", assigned: "1" },
        { id: "bin2", confidence: "N/A", assigned: "0" },
      ])
    );

    const parser = createParserConfig({
      id: "taxonomy",
      type: "json",
      filePattern: "**/taxonomy.json",
      columns: [
        { name: "id", index: 0 },
        { name: "confidence", index: 1, type: "float" },
        { name: "assigned", index: 2, type: "boolean" },
      ],
    });
    mocks.getPackage.mockReturnValue({
      parsers: new Map([["taxonomy", parser]]),
    });

    const result = await runParser("mag", "taxonomy", tempDir);

    expect(result.errors).toEqual([]);
    expect(result.rows.get("bin1")).toEqual({
      id: "bin1",
      confidence: 0.99,
      assigned: true,
    });
    expect(result.rows.get("bin2")).toEqual({
      id: "bin2",
      confidence: null,
      assigned: false,
    });
  });

  it("reports unknown parser types", async () => {
    const filePath = path.join(tempDir, "results", "weird.dat");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "dummy");

    const parser = {
      parser: {
        id: "weird",
        type: "xml",
        description: "unsupported parser type",
        trigger: { filePattern: "**/weird.dat" },
        columns: [{ name: "id", index: 0 }],
      },
    } as unknown as { parser: { id: string; type: "tsv" | "csv" | "json" } };
    mocks.getPackage.mockReturnValue({
      parsers: new Map([["weird", parser]]),
    });

    const result = await runParser("mag", "weird", tempDir);
    expect(result.rows.size).toBe(0);
    expect(result.errors).toEqual(["Unknown parser type: xml"]);
  });

  it("returns parse errors for invalid JSON data", async () => {
    const filePath = path.join(tempDir, "results", "bad.json");
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, "{ this is invalid json");

    const parser = createParserConfig({
      id: "bad-json",
      type: "json",
      filePattern: "**/bad.json",
      columns: [
        { name: "id", index: 0 },
      ],
    });
    mocks.getPackage.mockReturnValue({
      parsers: new Map([["bad-json", parser]]),
    });

    const result = await runParser("mag", "bad-json", tempDir);
    expect(result.rows.size).toBe(0);
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("Failed to parse JSON file");
  });

  it("runs all package parsers and returns results by parser id", async () => {
    const aPath = path.join(tempDir, "parsed", "a.tsv");
    const bPath = path.join(tempDir, "parsed", "b.csv");
    await fs.mkdir(path.dirname(aPath), { recursive: true });
    await fs.writeFile(aPath, "id\tvalue\nr1\t5\n");
    await fs.writeFile(bPath, "id,value\nr2,8\n");

    const parserA = createParserConfig({
      id: "a",
      type: "tsv",
      filePattern: "**/a.tsv",
      skipHeader: true,
      columns: [
        { name: "id", index: 0 },
        { name: "value", index: 1, type: "int" },
      ],
    });
    const parserB = createParserConfig({
      id: "b",
      type: "csv",
      filePattern: "**/b.csv",
      skipHeader: true,
      columns: [
        { name: "id", index: 0 },
        { name: "value", index: 1, type: "int" },
      ],
    });

    mocks.getPackage.mockReturnValue({
      parsers: new Map([
        ["a", parserA],
        ["b", parserB],
      ]),
    });

    const results = await runAllParsers("mag", tempDir);

    expect(results.size).toBe(2);
    expect(results.get("a")?.rows.get("r1")).toEqual({ id: "r1", value: 5 });
    expect(results.get("b")?.rows.get("r2")).toEqual({ id: "r2", value: 8 });
  });

  it("returns empty map when running all parsers for unknown package", async () => {
    mocks.getPackage.mockReturnValue(undefined);

    const results = await runAllParsers("mag", tempDir);

    expect(results.size).toBe(0);
  });
});
