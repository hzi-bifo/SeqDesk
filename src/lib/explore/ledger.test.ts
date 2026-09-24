import fs from "fs/promises";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import { buildLedger, parseDrops, scanTable } from "./ledger";

describe("data ledger", () => {
  it("pairs a single input with every output and keeps drop reasons", () => {
    const ledger = buildLedger(
      [{ alias: "counts", dims: { rows: 100, cols: 5 }, samples: 4 }],
      [{ name: "filtered", dims: { rows: 60, cols: 5 }, samples: 3 }],
      [{ input: "counts", count: 40, reason: "fewer than 10 reads", axis: "rows", keys: ["g1", 2] }, { count: "x", reason: "bad" }],
    );
    expect(ledger).toEqual([{ label: "counts → filtered", alias: "counts", output: "filtered", in: { rows: 100, cols: 5 }, out: { rows: 60, cols: 5 }, samples: { in: 4, out: 3 },
      reasons: [{ count: 40, reason: "fewer than 10 reads", axis: "rows", keys: ["g1"] }] }]);
  });

  it("never invents reasons: counts only without drops", () => {
    const ledger = buildLedger([{ alias: "a", dims: { rows: 3, cols: 2 }, samples: null }], [{ name: "out", dims: { rows: 3, cols: 3 }, samples: null }], undefined);
    expect(ledger[0].reasons).toEqual([]);
    expect(ledger[0].samples).toBeNull();
  });

  it("with several inputs pairs outputs only through the input the drops name", () => {
    const inputs = [{ alias: "counts", dims: { rows: 10, cols: 3 }, samples: null }, { alias: "meta", dims: { rows: 4, cols: 2 }, samples: null }];
    const named = buildLedger(inputs, [{ name: "joined", dims: { rows: 8, cols: 4 }, samples: null }], [{ input: "counts", count: 2, reason: "no metadata" }]);
    expect(named.map((line) => line.label)).toEqual(["counts → joined"]);
    const unnamed = buildLedger(inputs, [{ name: "joined", dims: { rows: 8, cols: 4 }, samples: null }], [{ count: 2, reason: "somewhere" }]);
    expect(unnamed.map((line) => line.label)).toEqual(["joined", "other"]);
    expect(unnamed[1].reasons[0].reason).toBe("somewhere");
  });

  it("gives inputs without outputs their own line when drops name them", () => {
    const ledger = buildLedger([{ alias: "a", dims: { rows: 3, cols: 1 }, samples: null }], [], [{ input: "a", count: 1, reason: "r", axis: "columns" }]);
    expect(ledger).toEqual([{ label: "a", alias: "a", output: null, in: { rows: 3, cols: 1 }, out: null, samples: null, reasons: [{ count: 1, reason: "r", axis: "columns", keys: [] }] }]);
  });

  it("parses only well-formed drops", () => {
    expect(parseDrops("nope")).toEqual([]);
    expect(parseDrops([{ count: -3, reason: " x " }])).toEqual([{ input: null, count: 0, reason: "x", axis: "rows", keys: [] }]);
  });

  it("scans rows, columns and distinct samples", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-"));
    const file = path.join(dir, "t.tsv");
    await fs.writeFile(file, "gene\tsample\tcount\ng1\tS1\t4\ng2\tS1\t5\ng3\tS2\t6\n\n");
    expect(await scanTable(file, { sampleColumn: "sample" })).toEqual({ dims: { rows: 3, cols: 3 }, samples: 2 });
    expect(await scanTable(file)).toEqual({ dims: { rows: 3, cols: 3 }, samples: null });
    expect(await scanTable(path.join(dir, "missing.tsv"))).toBeNull();
    await fs.rm(dir, { recursive: true, force: true });
  });
});
