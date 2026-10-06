import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/db", () => ({ db: {} }));
import { KitSchema, STEP_CATEGORIES } from "./kits/schema";
import { loadKits, type LoadedKit } from "./kits/loader";
import { kitAliasFor, ownAliasFor } from "./recipe-edit";
import { listTemplates, serializeTemplate } from "./templates";
import type { DatasetInfo, RecipeModel } from "./recipe";

const dataset = (id: string, over: Partial<DatasetInfo> = {}): DatasetInfo => ({
  id, name: `${id} (Step)`, kind: "derived", tableKind: null, roles: null, sensitivity: "standard", currentVersionId: null, producer: "s1", artifactName: id, current: null, ...over,
});
const model = (...datasets: DatasetInfo[]) => ({ datasets: new Map(datasets.map((d) => [d.id, d])) }) as unknown as RecipeModel;
const kit = (inputs: Array<{ alias: string; tableKind?: string }>) => ({
  manifest: KitSchema.parse({ kitVersion: 1, id: "two-tables", name: "Two tables", description: "x", language: "python", environment: "e", inputs: inputs.map((input) => ({ label: input.alias, requiredRoles: [], ...input })) }),
}) as unknown as LoadedKit;

describe("step picker: categories", () => {
  it("accepts a kit category and still accepts a kit without one", () => {
    const base = { kitVersion: 1, id: "k-1", name: "K", description: "d", language: "python", environment: "e", inputs: [{ alias: "data", label: "Data" }] };
    expect(KitSchema.parse({ ...base, category: "test" }).category).toBe("test");
    expect(KitSchema.parse(base).category).toBeUndefined();
    expect(() => KitSchema.parse({ ...base, category: "dance" })).toThrow();
  });

  it("gives every bundled kit a known category", async () => {
    const { kits, problems } = await loadKits();
    expect(problems).toEqual([]);
    for (const loaded of kits) expect(STEP_CATEGORIES).toContain(loaded.manifest.category);
  });
});

describe("step picker: template steps", () => {
  it("parses every bundled template and passes each step's category on", async () => {
    const templates = await listTemplates();
    expect(templates.length).toBeGreaterThan(0);
    for (const template of templates) {
      for (const step of serializeTemplate(template).steps) expect(STEP_CATEGORIES).toContain((step as { category?: string }).category);
    }
  });
});

describe("step picker: chosen inputs without an alias", () => {
  it("places a chosen table on the kit input it fits, then on the next open one", () => {
    const m = model(dataset("samples", { tableKind: "sample-sheet" }), dataset("counts", { tableKind: "count-matrix" }));
    const k = kit([{ alias: "counts", tableKind: "count-matrix" }, { alias: "samples", tableKind: "sample-sheet" }]);
    const taken = new Set<string>();
    const first = kitAliasFor(m, k, "samples", taken);
    expect(first).toBe("samples");
    taken.add(first);
    expect(kitAliasFor(m, k, "counts", taken)).toBe("counts");
  });

  it("refuses a table more than a kit reads", () => {
    const m = model(dataset("a"), dataset("b"));
    const k = kit([{ alias: "data" }]);
    expect(() => kitAliasFor(m, k, "b", new Set(["data"]))).toThrow(/reads one table; choose fewer/);
  });

  it("names own code's inputs after the table, unique and snake_case", () => {
    expect(ownAliasFor({ name: "counts_qc (QC)", artifactName: "counts_qc" }, new Set())).toBe("counts_qc");
    expect(ownAliasFor({ name: "Sample sheet (v2)", artifactName: null }, new Set())).toBe("sample_sheet");
    expect(ownAliasFor({ name: "x", artifactName: "counts_qc" }, new Set(["counts_qc"]))).toBe("counts_qc_2");
    expect(ownAliasFor({ name: "2024 table", artifactName: null }, new Set())).toBe("table");
    expect(ownAliasFor({ name: "--", artifactName: null }, new Set())).toBe("data");
  });
});
