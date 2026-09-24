/**
 * The R helper (explore/lib/r) is tested with testthat; this runs that suite
 * when Rscript with jsonlite and testthat is installed and says why it skips
 * otherwise. The profile and wrapper wiring is checked without R.
 */
import { spawnSync } from "child_process";
import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";
import { generateInnerScript } from "./run-script";

const root = process.cwd();
const rLib = path.join(root, "explore", "lib", "r");

function rReady(): string | null {
  const probe = spawnSync("Rscript", ["-e", 'cat(all(vapply(c("jsonlite","testthat"), requireNamespace, logical(1), quietly = TRUE)))'], { encoding: "utf8", timeout: 30000 });
  if (probe.error) return "Rscript is not installed on this machine";
  if (probe.stdout.trim() !== "TRUE") return "R is installed but jsonlite or testthat is missing";
  return null;
}
const skipReason = rReady();

describe("R helper", () => {
  it("ships the package, its profile and the same manifest fields as the Python helper", () => {
    const source = fs.readFileSync(path.join(rLib, "seqdesk.explore", "R", "sx.R"), "utf8");
    for (const name of ["input", "param", "output", "figure", "drop", "metric", "note", "save_report_markdown", "finish"]) expect(source).toContain(`${name} = ${name}`);
    for (const field of ["manifestVersion", "metricMeta", "drops", "artifacts", "notes", "metrics"]) expect(source).toContain(field);
    expect(fs.readFileSync(path.join(rLib, "profile.R"), "utf8")).toContain("SEQDESK_EXPLORE_R_LIB");
    expect(fs.readFileSync(path.join(rLib, "seqdesk.explore", "NAMESPACE"), "utf8")).toContain("export(sx)");
  });

  it("wires the profile into R runs", () => {
    const script = generateInnerScript({ runId: "r1", runFolder: "/data/pipeline_runs/explore/EXP-20260924-001--id-r1", language: "r", entrypoint: "analysis.R", environmentPrefix: "/envs/r", condaPath: "/opt/conda", helperLibDir: "/srv/seqdesk/explore/lib" });
    expect(script).toContain('export SEQDESK_EXPLORE_R_LIB="$HELPER_LIB/r"');
    expect(script).toContain('export R_PROFILE_USER="$HELPER_LIB/r/profile.R"');
  });

  it.skipIf(skipReason !== null)(`passes its testthat suite${skipReason ? ` (skipped: ${skipReason})` : ""}`, () => {
    const result = spawnSync("Rscript", ["-e", 'res <- as.data.frame(testthat::test_dir("explore/lib/r/tests", reporter = "silent", stop_on_failure = FALSE)); cat("FAILED", sum(res$failed), "ERRORS", sum(res$error), "PASSED", sum(res$passed))'], { cwd: root, encoding: "utf8", timeout: 120000 });
    expect(result.stdout).toMatch(/FAILED 0 ERRORS 0 PASSED [1-9]/);
  }, 130000);
});
