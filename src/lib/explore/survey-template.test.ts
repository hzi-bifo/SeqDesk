import { describe, expect, it } from "vitest";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";

const python = spawnSync("python3", ["-c", "import pandas, scipy, matplotlib"]);
const dir = path.join(process.cwd(), "explore", "templates", "survey-likert", "steps");

// A stand-in for seqdesk_explore that prints what the steps record.
const STUB = `
import json, sys
import pandas as pd
_p = json.loads(sys.argv[1]) if len(sys.argv) > 1 else {}
out = {"drops": [], "notes": [], "metrics": {}, "tables": {}}
def input(alias):
    return pd.DataFrame({"q1": [1, 2, 3, 4, 5, 7, 0, "n/a"], "q2": [5, 4, 3, 2, 1, 1, 2, 3], "grp": ["a", "a", "a", "a", "b", "b", "b", "b"]})
def param(key, default=None):
    return {"items": ["q1", "q2"], "group": "grp"}.get(key, default)
def drop(rows, reason, **kw): out["drops"].append([int(len(rows)), reason])
def note(text): out["notes"].append(text)
def output(name, table, **kw): out["tables"][name] = table.to_dict("records")
def metric(name, value, **kw): out["metrics"][name] = value
def figure(name, fig, **kw): out["figure"] = name
def finish(): print("RESULT" + json.dumps(out, default=str))
`;

function run(step: string) {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "survey-"));
  fs.writeFileSync(path.join(work, "seqdesk_explore.py"), STUB);
  const result = spawnSync("python3", [path.join(dir, step)], { cwd: work, env: { ...process.env, PYTHONPATH: work, MPLBACKEND: "Agg" }, encoding: "utf8" });
  fs.rmSync(work, { recursive: true, force: true });
  expect(result.status, result.stderr).toBe(0);
  return JSON.parse(result.stdout.split("RESULT")[1]) as { drops: Array<[number, string]>; notes: string[]; metrics: Record<string, number>; tables: Record<string, Array<Record<string, unknown>>> };
}

describe.skipIf(python.status !== 0)("survey-likert steps agree on what they exclude", () => {
  it("summary and comparison drop the same out-of-range answers and say what text answers became", () => {
    const summary = run("summary.py");
    const compare = run("compare.py");
    const outside = (r: { drops: Array<[number, string]> }) => r.drops.filter(([, why]) => /outside 1 to 5/.test(why)).sort();
    expect(outside(summary)).toEqual([[2, "q1: answers outside 1 to 5"]]);
    expect(outside(compare)).toEqual(outside(summary));
    expect(summary.notes.join(" ")).toMatch(/q1: 1 answers that are not numbers/);
    expect(compare.notes.join(" ")).toMatch(/q1: 1 answers that are not numbers/);
    expect(summary.tables.item_summary.find((row) => row.item === "q1")?.answers).toBe(5);
  });
  it("the chart runs on the same valid answers", () => {
    expect(run("chart.py")).toMatchObject({ figure: "answers" });
  });
});
