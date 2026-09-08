import { describe, expect, it } from "vitest";
import {
  castRowsToSchema,
  coerceCell,
  computeContentHash,
  inferSchema,
  normalizeColumnKey,
} from "./schema";

describe("explore schema inference", () => {
  it("infers column types from mixed rows", () => {
    const schema = inferSchema([
      { sample: "S1", reads: "120", ok: "true", collected: "2026-01-05", note: "x" },
      { sample: "S2", reads: 5.5, ok: false, collected: "2026-01-06", note: null },
    ]);
    expect(schema.columns.map((column) => [column.key, column.type])).toEqual([
      ["sample", "string"],
      ["reads", "number"],
      ["ok", "boolean"],
      ["collected", "date"],
      ["note", "string"],
    ]);
  });

  it("attaches roles, labels and groups", () => {
    const schema = inferSchema([{ id: "S1", taxon: "E. coli" }], {
      roles: { sample: "id", taxon: "taxon" },
      labels: { id: "Sample" },
      groups: { taxon: "pipeline" },
    });
    expect(schema.columns[0]).toMatchObject({ key: "id", label: "Sample", role: "sample" });
    expect(schema.columns[1]).toMatchObject({ key: "taxon", role: "taxon", group: "pipeline" });
  });

  it("casts rows to the declared types", () => {
    const schema = inferSchema([{ reads: "10", ok: "yes" }]);
    schema.columns[1].type = "boolean";
    expect(castRowsToSchema([{ reads: "10", ok: "yes" }, { reads: "n/a", ok: null }], schema)).toEqual([
      { reads: 10, ok: true },
      { reads: null, ok: null },
    ]);
  });

  it("coerces cells and normalizes column keys", () => {
    expect(coerceCell("  ")).toBeNull();
    expect(coerceCell(" a ")).toBe("a");
    expect(coerceCell(Number.NaN)).toBeNull();
    expect(coerceCell(new Date("2026-01-01T00:00:00Z"))).toBe("2026-01-01T00:00:00.000Z");
    expect(normalizeColumnKey("% human Pert")).toBe("%_human_Pert");
    expect(normalizeColumnKey("")).toBe("column");
  });
});

describe("explore content hash", () => {
  const schema = inferSchema([{ a: 1, b: "x" }]);

  it("is independent of row order and key order", () => {
    const one = computeContentHash(schema, [{ a: 1, b: "x" }, { a: 2, b: "y" }]);
    const two = computeContentHash(schema, [{ b: "y", a: 2 }, { b: "x", a: 1 }]);
    expect(one).toBe(two);
  });

  it("changes when a value or a column type changes", () => {
    const base = computeContentHash(schema, [{ a: 1, b: "x" }]);
    expect(computeContentHash(schema, [{ a: 1, b: "z" }])).not.toBe(base);
    const otherSchema = { columns: schema.columns.map((column) => ({ ...column, type: "string" as const })) };
    expect(computeContentHash(otherSchema, [{ a: 1, b: "x" }])).not.toBe(base);
  });
});
