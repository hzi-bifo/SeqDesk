import { describe, expect, it } from "vitest";
import { applyEditsToColumns, applyEditsToRows, rowKeyOf, validateEdit, type ExploreEditRecord } from "./edits";
import type { ExploreRowRecord } from "./types";

function edit(partial: Partial<ExploreEditRecord> & Pick<ExploreEditRecord, "kind" | "target">): ExploreEditRecord {
  return {
    id: partial.id ?? Math.random().toString(36).slice(2),
    datasetId: "d1",
    value: partial.value ?? null,
    reason: null,
    createdById: "u1",
    createdAt: "2026-09-04T00:00:00.000Z",
    revokedAt: null,
    ...partial,
  };
}

const rows: ExploreRowRecord[] = [
  { rowIndex: 0, sampleId: "S1", subjectId: null, key: "562", data: { sample: "S1", taxon: "E. coli", reads: 10 } },
  { rowIndex: 1, sampleId: "S1", subjectId: null, key: "1280", data: { sample: "S1", taxon: "S. aureus", reads: 5 } },
  { rowIndex: 2, sampleId: null, subjectId: null, key: null, data: { sample: null, taxon: "x", reads: 1 } },
];

describe("explore edits", () => {
  it("derives stable row keys", () => {
    expect(rowKeyOf(rows[0])).toBe("s:S1|k:562");
    expect(rowKeyOf({ rowIndex: 3, sampleId: "S2", key: null })).toBe("s:S2");
    expect(rowKeyOf(rows[2])).toBe("i:2");
  });

  it("applies cell overrides, flags and exclusions with later edits winning", () => {
    const edits = [
      edit({ kind: "cell", target: { rowKey: "s:S1|k:562", column: "reads" }, value: { value: 12 } }),
      edit({ kind: "cell", target: { rowKey: "s:S1|k:562", column: "reads" }, value: { value: 13 } }),
      edit({ kind: "row-flag", target: { rowKey: "s:S1|k:1280" }, value: "contaminant" }),
      edit({ kind: "row-exclude", target: { rowKey: "i:2" } }),
    ];
    const applied = applyEditsToRows(rows, edits);
    expect(applied).toHaveLength(2);
    expect(applied[0].data.reads).toBe(13);
    expect(applied[0].edited).toEqual(["reads"]);
    expect(applied[1].flags).toEqual(["contaminant"]);
    expect(rows[0].data.reads).toBe(10);

    const withExcluded = applyEditsToRows(rows, edits, { includeExcluded: true });
    expect(withExcluded).toHaveLength(3);
    expect(withExcluded[2].excluded).toBe(true);
  });

  it("adds and hides columns", () => {
    const result = applyEditsToColumns(
      [{ key: "reads", label: "reads", type: "number" }],
      [
        edit({ kind: "column-add", target: { column: "note" }, value: { label: "Note", type: "string" } }),
        edit({ kind: "column-hide", target: { column: "reads" } }),
      ]
    );
    expect(result.columns.map((column) => column.key)).toEqual(["reads", "note"]);
    expect(result.columns[1]).toMatchObject({ label: "Note", group: "curation" });
    expect(result.hidden).toEqual(["reads"]);
  });

  it("validates edit shapes", () => {
    expect(validateEdit({ kind: "cell", target: { rowKey: "a" } })).toMatch(/column/);
    expect(validateEdit({ kind: "row-flag", target: { rowKey: "a" }, value: "" })).toMatch(/text/);
    expect(validateEdit({ kind: "row-exclude", target: { rowKey: "a" } })).toBeNull();
    expect(validateEdit({ kind: "column-add", target: { column: "c" }, value: { type: "blob" } })).toMatch(/type/);
    expect(validateEdit({ kind: "nope" as never, target: {} })).toMatch(/Unknown/);
  });
});
