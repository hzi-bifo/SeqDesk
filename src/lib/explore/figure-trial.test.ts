import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ db: {} }));

import { figureCheck, samePlottedData } from "./figure-trial";
import { continualfigLines, generateInnerScript } from "./run-script";
import { stageHelperLibrary } from "./kits/loader";

const rRecord = (rows: number, sum: number) => ({ data_rows: rows, data_summary: { rows, columns: { log2FoldChange: { n: rows, sum, min: -4.6, max: 9.5 } } } });

describe("figure records", () => {
  it("counts the same plotted data as the same, whatever else the new code adds", () => {
    const before = rRecord(15617, -99.34352369);
    const after = { ...rRecord(15617, -99.34352369), data_summary: { rows: 15617, columns: { log2FoldChange: { n: 15617, sum: -99.34352369, min: -4.6, max: 9.5 }, label_rank: { n: 10, sum: 55, min: 1, max: 10 } } } };
    expect(samePlottedData(before, after)).toBe(true);
    expect(samePlottedData(before, rRecord(15600, -99.34352369))).toBe(false);
    expect(samePlottedData(before, rRecord(15617, -98))).toBe(false);
    expect(samePlottedData(before, null)).toBeNull();
    expect(samePlottedData({ data_summary: { axes: [{ points: 5, point_sum: 38, image_cells: 0, image_sum: 0 }] } }, { data_summary: { axes: [{ points: 5, point_sum: 38, image_cells: 0, image_sum: 0 }] } })).toBe(true);
  });

  it("compares the data each layer carries, not only the plot's main data", () => {
    const layered = (rows: number, sum: number) => ({ data_summary: { rows: 15617, columns: {}, layers: [{ rows: 15617, columns: { x: { n: 15617, sum: 1, min: 0, max: 2 } } }, { rows, columns: { x: { n: rows, sum, min: 0, max: 2 } } }] } });
    expect(samePlottedData(layered(10, 5), layered(10, 5))).toBe(true);
    expect(samePlottedData(layered(10, 5), layered(100, 5))).toBe(false);
    expect(samePlottedData(layered(10, 5), layered(10, 6))).toBe(false);
    const inherited = { data_summary: { rows: 3, columns: {}, layers: [{ rows: null, columns: {}, inherited: true }] } };
    expect(samePlottedData(inherited, inherited)).toBe(true);
    expect(samePlottedData(inherited, { data_summary: { rows: 3, columns: {}, layers: [{ rows: 100, columns: {} }] } })).toBe(false);
  });

  it("passes the numbers check only when values, tables and plotted data are unchanged", () => {
    const side = (value: number, checksum: string, record: ReturnType<typeof rRecord> | null) => ({
      stepRunId: "s", status: "completed", code: "", errorTail: null,
      values: [{ key: "n_de", label: "DE genes", value }],
      tables: [{ name: "de_results", checksum }],
      figures: [{ name: "volcano", png: "p", svg: null, record }],
    });
    expect(figureCheck(side(925, "a", rRecord(10, 1)), side(925, "a", rRecord(10, 1))).same).toBe(true);
    // Unknown plotted data is not proof of sameness.
    const unknown = figureCheck(side(925, "a", null), side(925, "a", rRecord(10, 1)));
    expect(unknown.same).toBe(false);
    expect(unknown.unverified).toEqual(["volcano"]);
    expect(figureCheck(side(925, "a", rRecord(10, 1)), side(924, "a", rRecord(10, 1))).same).toBe(false);
    expect(figureCheck(side(925, "a", rRecord(10, 1)), side(925, "b", rRecord(10, 1))).same).toBe(false);
    expect(figureCheck(side(925, "a", rRecord(10, 1)), side(925, "a", rRecord(9, 1))).same).toBe(false);
  });
});

describe("the figure hook in runs", () => {
  it("is off unless a run asks for it, and style adds the start-up hooks", () => {
    const off = continualfigLines(undefined);
    expect(off[off.length - 1]).toBe('export CONTINUALFIG="off"');
    expect(off.join("\n")).toContain('CONTINUALFIG_HOOK_R="$CONTINUALFIG_HOME/r/continualfig.R"');
    const record = continualfigLines("record").join("\n");
    expect(record).toContain("export CONTINUALFIG=record");
    expect(record).toContain('CONTINUALFIG_HOME="$HELPER_LIB/figure/continualfig"');
    expect(record).not.toContain("pyhook");
    const style = continualfigLines("style").join("\n");
    expect(style).toContain("export CONTINUALFIG=on");
    expect(style).toContain("pyhook");
    expect(style).toContain('CONTINUALFIG_HOOK_R="$CONTINUALFIG_HOME/r/continualfig.R"');
    const inner = generateInnerScript({ runId: "r", runFolder: "/runs/r", language: "r", entrypoint: "analysis.R", environmentPrefix: "/envs/r", helperLibDir: "/runs/r/lib", continualfig: "record" });
    expect(inner.indexOf("export CONTINUALFIG=record")).toBeLessThan(inner.indexOf("exec Rscript"));
  });

  it("stages the vendored continualfig with the run's helper library, inside the run folder", async () => {
    const runFolder = await fs.mkdtemp(path.join(os.tmpdir(), "explore-figure-"));
    try {
      const libDir = await stageHelperLibrary(runFolder);
      const staged = path.join(libDir, "figure", "continualfig");
      const vendored = path.join(process.cwd(), "explore", "lib", "figure", "continualfig");
      for (const file of ["python/continualfig.py", "python/pyhook/sitecustomize.py", "r/continualfig.R"]) {
        expect(await fs.readFile(path.join(staged, file), "utf8")).toBe(await fs.readFile(path.join(vendored, file), "utf8"));
      }
    } finally {
      await fs.rm(runFolder, { recursive: true, force: true });
    }
  });
});
