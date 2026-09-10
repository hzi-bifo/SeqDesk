import { describe, expect, it } from "vitest";
import { applyTableContract, computeContentHash, inferSchema } from "./schema";
import { datasetFitsInput } from "./dataset-kinds";
import { TableContractSchema } from "./table-contract";
import { parsePipelineTable } from "./parsers/pipeline-table";
import type { ExploreRoleMap } from "./types";

const contract = { schemaId: "lab.measurement", schemaVersion: "1", rowEntity: "sample", columns: {
  measured: { type: "number" as const, unit: "percent", label: "Measured abundance", required: true },
  optional: { type: "number" as const, unit: "reads", nullable: true },
} };
const rows = [{ measured: "12", optional: null }];
const dataset = () => ({ tableKind: "anything", roles: { value: "measured" } as ExploreRoleMap, schema: applyTableContract(inferSchema(rows), rows, contract) });

describe("pipeline-independent output contracts", () => {
  it("retains labels, units, schema identity and nullable numeric columns", () => {
    expect(dataset().schema).toMatchObject({ schemaId: "lab.measurement", schemaVersion: "1", rowEntity: "sample", columns: [
      { key: "measured", label: "Measured abundance", type: "number", unit: "percent" },
      { key: "optional", type: "number", unit: "reads", nullable: true },
    ] });
  });
  it("permits optional missing columns for single-end and partial outputs", () => {
    expect(() => applyTableContract(inferSchema([{ measured: 2 }]), [{ measured: 2 }], contract)).not.toThrow();
  });
  it("rejects missing required columns", () => {
    expect(() => applyTableContract({ columns: [] }, [], contract)).toThrow(/Required column/);
  });
  it.each(["bad", "NaN", "Infinity", true])("rejects invalid numeric cells (%s) instead of silently nulling them", value => {
    expect(() => applyTableContract(inferSchema([{ measured: value }]), [{ measured: value }], contract)).toThrow(/number values/);
  });
  it("distinguishes nullable values from optional columns", () => {
    expect(() => applyTableContract(inferSchema(rows), rows, { columns: { optional: { type: "number", nullable: false } } })).toThrow(/missing value/);
  });
  it("does not let package columns override server-owned sample identity", () => {
    const values = [{ sample_db_id: "owner-resolved-id" }];
    const schema = applyTableContract(inferSchema(values), values, { columns: { sample_db_id: { type: "number", label: "Forged identity" } } }, ["sample_db_id"]);
    expect(schema.columns[0]).toMatchObject({ label: "sample_db_id", type: "string" });
  });
  it("matches roles across different pipeline-specific column names", () => {
    expect(datasetFitsInput(dataset(), { requiredRoles: ["value"], requiredRoleTypes: { value: { type: "number", unit: "percent" } } })).toEqual({ ok: true });
  });
  it("does not confuse a generic summary with the columns required by a template", () => {
    expect(datasetFitsInput(dataset(), { requiredRoles: [], requiredColumns: { quality: { type: "number" } } })).toMatchObject({ ok: false, reason: "contract", message: expect.stringContaining("quality") });
  });
  it.each(["fraction", "reads"])("rejects incompatible units (%s)", unit => {
    expect(datasetFitsInput(dataset(), { requiredRoles: [], requiredColumns: { measured: { type: "number", unit } } })).toMatchObject({ ok: false, reason: "contract" });
  });
  it("does not assume units when they were not declared", () => {
    expect(datasetFitsInput({ ...dataset(), schema: inferSchema(rows) }, { requiredRoles: [], requiredColumns: { measured: { type: "number", unit: "percent" } } })).toMatchObject({ ok: false });
  });
  it.each([{ schemaVersions: ["2"] }, { schemaId: "another-schema" }, { rowEntity: "taxon" }])("rejects incompatible schema meaning (%o)", requirement => {
    expect(datasetFitsInput(dataset(), { requiredRoles: [], ...requirement })).toMatchObject({ ok: false });
  });
  it("keeps legacy role-only templates compatible", () => {
    expect(datasetFitsInput({ tableKind: null, roles: {} }, { requiredRoles: [] })).toEqual({ ok: true });
  });
  it("versions changed units even when numeric values are unchanged", () => {
    const first = dataset().schema;
    const second = applyTableContract(inferSchema(rows), rows, { ...contract, columns: { measured: { type: "number", unit: "fraction" } } });
    expect(computeContentHash(first, rows)).not.toBe(computeContentHash(second, rows));
  });
  it("rejects executable or unknown declarations", () => {
    expect(TableContractSchema.safeParse({ renderer: "eval(...)" }).success).toBe(false);
  });
  it("supports JSON row objects without a pipeline-specific parser", () => {
    expect(parsePipelineTable('[{"x": 1, "missing": null}, {"x": 2, "label": "hi"}]', { format: "json" })).toMatchObject({ columns: ["x", "missing", "label"], rows: [{ x: 1, missing: null }, { x: 2, label: "hi" }] });
  });
  it.each(['{"rows": []}', '[null]', '[1]', '[[1]]', 'bad'])('rejects unsupported JSON table shapes (%s)', value => {
    expect(() => parsePipelineTable(value, { format: "json" })).toThrow();
  });
});
