/**
 * Shell (bash) steps: the inner script, the `sx` shell helper (explore/lib/shell/bin/sx, standard-library Python) and,
 * on macOS, the step run for real inside the Seatbelt sandbox: coreutils, pipes and process substitution work;
 * the network, the home directory and writes outside the run folder do not.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";
import { generateInnerScript } from "./run-script";
import { buildMountPlan, renderSeatbeltProfile } from "./sandbox/mount-plan";
import { analysisLanguageOf, baseEnvironmentFor } from "./analyses";
import { environmentLabel } from "./environment-lock";

const root = process.cwd();
const helper = path.join(root, "explore", "lib", "shell", "bin", "sx");
const python = spawnSync("python3", ["--version"], { encoding: "utf8" }).error ? null : "python3";
const made: string[] = [];
afterAll(() => { for (const dir of made) fs.rmSync(dir, { recursive: true, force: true }); });

/** A run folder like the runner prepares: inputs.json, a staged table and a staged file input. */
function runFolder(): string {
  const run = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), "shell-step-")));
  made.push(run);
  for (const dir of ["control", "logs", "outputs", "inputs/files/reads", "home", "tmp"]) fs.mkdirSync(path.join(run, dir), { recursive: true });
  fs.writeFileSync(path.join(run, "inputs", "samples.tsv"), "sample\treads\nA\t10\nB\t20\n");
  fs.writeFileSync(path.join(run, "inputs", "files", "reads", "r.fastq"), "@r1\nACGT\n+\nIIII\n@r2\nGGCC\n+\n####\n");
  fs.writeFileSync(path.join(run, "inputs.json"), JSON.stringify({
    inputs: { samples: { path: "inputs/samples.tsv", schemaPath: "inputs/samples.schema.json" } },
    files: { reads: { path: "inputs/files/reads/r.fastq" } },
    params: { min_len: 50, "q-cut": 30, flag: true, list: [1, 2] },
    outputDir: "outputs",
  }));
  fs.cpSync(path.join(root, "explore", "lib", "shell"), path.join(run, "lib", "shell"), { recursive: true });
  return run;
}

function sx(run: string, ...args: string[]) {
  return spawnSync("python3", [helper, ...args], { cwd: run, encoding: "utf8", env: { PATH: process.env.PATH ?? "/usr/bin:/bin", SEQDESK_EXPLORE_RUN_DIR: run } });
}

const manifest = (run: string) => JSON.parse(fs.readFileSync(path.join(run, "outputs", "manifest.json"), "utf8"));

describe("shell steps", () => {
  it("parse as their own language with the shell base environment and label", () => {
    expect(analysisLanguageOf("shell")).toBe("shell");
    expect(analysisLanguageOf("r")).toBe("r");
    expect(analysisLanguageOf("bash")).toBe("python");
    expect(baseEnvironmentFor("shell")).toBe("seqdesk-explore-shell");
    expect(environmentLabel("shell", "3.11.9", "abcdef123456")).toBe("Shell (Python 3.11.9) · lock abcdef");
    const spec = fs.readFileSync(path.join(root, "explore", "environments", "seqdesk-explore-shell.yml"), "utf8");
    for (const dependency of ["python=3.11", "coreutils", "gawk", "pigz", "seqkit"]) expect(spec).toContain(dependency);
  });

  it("run the step with bash -euo pipefail, sx on PATH, then record outputs", () => {
    const script = generateInnerScript({ runId: "s1", runFolder: "/data/runs/EXP-1--id-s1", language: "shell", entrypoint: "step.sh", environmentPrefix: "/envs/shell", helperLibDir: "/data/runs/EXP-1--id-s1/lib" });
    expect(script).toContain('export PATH="$ENV_PREFIX/bin:$HELPER_LIB/shell/bin:${PATH:-/usr/bin:/bin}"');
    expect(script).toContain('SX_ENV="$(python3 "$SX" _env)"');
    expect(script).toContain("bash -euo pipefail step.sh || STATUS=$?");
    expect(script).toContain('python3 "$SX" _finalize "$STATUS" step.sh');
    expect(script).toContain('exit "$STATUS"');
    expect(script).toContain('export TMPDIR="$RUN_DIR/tmp"');
    expect(script).not.toContain("Rscript");
  });

  it.skipIf(!python)("export $INPUT_<alias>, $PARAM_<key> and $OUT", () => {
    const run = runFolder();
    const result = sx(run, "_env");
    expect(result.status).toBe(0);
    expect(result.stdout).toContain(`export INPUT_samples=${run}/inputs/samples.tsv`);
    expect(result.stdout).toContain(`export INPUT_reads=${run}/inputs/files/reads/r.fastq`);
    expect(result.stdout).toContain("export PARAM_min_len=50");
    expect(result.stdout).toContain("export PARAM_q_cut=30");
    expect(result.stdout).toContain("export PARAM_flag=true");
    expect(result.stdout).not.toContain("PARAM_list");
    expect(result.stdout).toContain(`export OUT=${run}/outputs`);
    expect(sx(run, "param", "min_len").stdout.trim()).toBe("50");
    expect(sx(run, "param", "missing", "7").stdout.trim()).toBe("7");
    expect(sx(run, "input", "nope").stderr).toContain('input "nope" is not attached (attached: reads, samples)');
  });

  it.skipIf(!python)("write values, notes and outputs to the same manifest as the R and Python helpers", () => {
    const run = runFolder();
    expect(sx(run, "metric", "n_reads", "26986", "--label", "Reads in", "--unit", "reads", "--definition-json", '{"what":"reads before filtering","filters":[{"param":"min_len","op":">=","value":50}]}').status).toBe(0);
    expect(sx(run, "metric", "gc", "50.61").status).toBe(0);
    expect(sx(run, "metric", "gc", "50.61").stderr).toContain('value "gc" has no label');
    expect(sx(run, "note", "fastp", "with", "defaults").status).toBe(0);
    fs.writeFileSync(path.join(run, "outputs", "qc.tsv"), "metric\tvalue\nreads\t10\ngc\t50\n");
    fs.mkdirSync(path.join(run, "outputs", "plots"));
    fs.writeFileSync(path.join(run, "outputs", "plots", "lengths.png"), "png");
    fs.writeFileSync(path.join(run, "outputs", "table.csv"), "a,b,c\n1,2,3\n");
    fs.writeFileSync(path.join(run, "outputs", "trimmed.fastq.gz"), "x");
    expect(sx(run, "table", "read_qc", path.join(run, "outputs", "qc.tsv"), "--title", "Read QC").status).toBe(0);
    expect(sx(run, "table", "elsewhere", path.join(run, "inputs", "samples.tsv")).stderr).toContain("is not inside $OUT");
    expect(sx(run, "_finalize", "0", "step.sh").status).toBe(0);
    const document = manifest(run);
    expect(document).toMatchObject({ manifestVersion: 1, language: "shell", notes: ["fastp with defaults"], metrics: { n_reads: 26986, gc: 50.61 } });
    expect(document.metricMeta.n_reads).toEqual({ label: "Reads in", unit: "reads", definition: { what: "reads before filtering", filters: [{ param: "min_len", op: ">=", value: 50 }] } });
    expect(document.metricMeta.gc).toBeUndefined();
    const byPath = Object.fromEntries(document.artifacts.map((artifact: { path: string }) => [artifact.path, artifact]));
    expect(byPath["outputs/qc.tsv"]).toMatchObject({ name: "read_qc", kind: "table", format: "tsv", title: "Read QC", table: { rowCount: 2, colCount: 2 } });
    expect(byPath["outputs/table.csv"]).toMatchObject({ name: "table", kind: "table", format: "csv", table: { rowCount: 1, colCount: 3 } });
    expect(byPath["outputs/plots/lengths.png"]).toMatchObject({ name: "plots_lengths", kind: "figure", format: "png" });
    expect(byPath["outputs/trimmed.fastq.gz"]).toBeUndefined();
    expect(document.artifacts).toHaveLength(3);
  });

  it.skipIf(!python)("explain a failure caused by a network command", () => {
    const run = runFolder();
    fs.writeFileSync(path.join(run, "step.sh"), "# curl in a comment\nwget -q https://example.org/x -O \"$OUT/x\"\n");
    const result = sx(run, "_finalize", "4", path.join(run, "step.sh"));
    expect(result.stderr).toContain("ERROR: The step calls wget, which needs the network, but analysis runs have no network access (sandbox).");
    expect(manifest(run).notes[0]).toContain("wget");
    const ok = runFolder();
    fs.writeFileSync(path.join(ok, "step.sh"), "curl -s https://example.org\n");
    expect(sx(ok, "_finalize", "0", path.join(ok, "step.sh")).stderr).toBe("");
  });

  it("let a shell use its own descriptors (process substitution) in the macOS profile", () => {
    const plan = buildMountPlan({ platform: "darwin", runFolder: "/Users/x/runs/EXP-1", environmentPrefix: "/Users/x/envs/shell", roots: { hostHome: "/Users/x/home" }, host: {} });
    const profile = renderSeatbeltProfile(plan);
    expect(profile).toMatch(/\(allow file-read\* [^\n]*\(subpath "\/dev\/fd"\)/);
    expect(profile).toMatch(/\(allow file-write\* [^\n]*\(subpath "\/dev\/fd"\)/);
    expect(profile).toContain("(deny network*)");
  });
});

/** The real thing on macOS: the inner script under sandbox-exec with the plan's profile. */
const seatbelt = process.platform === "darwin" && !spawnSync("sandbox-exec", ["-n", "no-network", "/usr/bin/true"]).error;
describe.skipIf(!seatbelt || !python)("a shell step inside the macOS sandbox", () => {
  // No conda environment here: the host's python3 stands in for the one that runs sx.
  const prefix = fs.mkdtempSync(path.join(os.tmpdir(), "shell-env-"));
  made.push(prefix);
  fs.mkdirSync(path.join(prefix, "bin"));
  const hostPython = spawnSync("python3", ["-c", "import sys, os; print(os.path.realpath(sys.executable))"], { encoding: "utf8" }).stdout.trim();
  fs.symlinkSync(hostPython, path.join(prefix, "bin", "python3"));
  const pythonRoots = [...new Set([path.dirname(path.dirname(hostPython)), spawnSync("python3", ["-c", "import sys; print(sys.base_prefix)"], { encoding: "utf8" }).stdout.trim()])];

  function runStep(code: string) {
    const run = runFolder();
    fs.writeFileSync(path.join(run, "step.sh"), code);
    fs.writeFileSync(path.join(run, "control", "analysis.sh"), generateInnerScript({ runId: "s", runFolder: run, language: "shell", entrypoint: "step.sh", environmentPrefix: prefix, helperLibDir: path.join(run, "lib") }), { mode: 0o755 });
    const plan = buildMountPlan({ platform: "darwin", runFolder: run, environmentPrefix: fs.realpathSync(prefix), extraReadOnly: pythonRoots, roots: { hostHome: os.homedir() }, host: {} });
    fs.writeFileSync(path.join(run, "sandbox.sb"), renderSeatbeltProfile(plan));
    const result = spawnSync("env", ["-i", "PATH=/usr/bin:/bin", "LANG=C.UTF-8", "sandbox-exec", "-f", path.join(run, "sandbox.sb"), "/bin/bash", path.join(run, "control", "analysis.sh")], { cwd: run, encoding: "utf8", timeout: 60000 });
    return { ...result, run };
  }

  it("runs coreutils, awk, pipes and process substitution and records its values", () => {
    const result = runStep([
      'awk -F"\\t" \'NR>1{s+=$2}END{print "total\\t"s}\' "$INPUT_samples" | sort > "$OUT/sum.tsv"',
      'paste <(cut -f1 "$INPUT_samples") <(cut -f2 "$INPUT_samples") | tr "\\t" "," > "$OUT/copy.csv"',
      'n=$(awk "NR%4==2" "$INPUT_reads" | wc -l | tr -d " ")',
      'sx metric n_reads "$n" --label "Reads"',
      'echo "min $PARAM_min_len" | tee /dev/stderr',
    ].join("\n"));
    expect(result.stderr).not.toContain("Operation not permitted");
    expect(result.status).toBe(0);
    const document = manifest(result.run);
    expect(document.metrics.n_reads).toBe(2);
    expect(document.artifacts.map((artifact: { path: string }) => artifact.path).sort()).toEqual(["outputs/copy.csv", "outputs/sum.tsv"]);
  });

  it("has no network, and says so", () => {
    const result = runStep("curl -sS --max-time 10 https://example.org -o \"$OUT/page.html\"\n");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("ERROR: The step calls curl, which needs the network, but analysis runs have no network access (sandbox).");
  });

  it("cannot read the home directory or write outside the run folder", () => {
    const home = os.homedir();
    const read = runStep(`ls "${home}" > "$OUT/home.txt"\n`);
    expect(read.status).not.toBe(0);
    expect(read.stderr).toContain("Operation not permitted");
    const outside = path.join(os.tmpdir(), `shell-step-escape-${process.pid}`);
    const write = runStep(`echo x > "${outside}"\n`);
    expect(write.status).not.toBe(0);
    expect(fs.existsSync(outside)).toBe(false);
    const control = runStep('echo x > "$RUN_DIR/control/analysis.sh"\n');
    expect(control.status).not.toBe(0);
  });
});
