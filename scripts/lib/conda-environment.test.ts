import { execFileSync } from "node:child_process";
import path from "node:path";
import { describe, expect, it } from "vitest";

const helperPath = path.join(
  process.cwd(),
  "scripts",
  "lib",
  "conda-environment.sh"
);

function runBash(script: string, environment: string): string[] {
  return execFileSync(
    "bash",
    ["-c", script, "seqdesk-conda-test", helperPath, environment],
    { encoding: "utf8" }
  )
    .trim()
    .split(/\r?\n/);
}

describe("pipeline E2E Conda shell helper", () => {
  it.each([
    ["reviewer-env", "-n"],
    ["/shared/conda/envs/reviewer", "-p"],
    ["shared/conda/envs/reviewer", "-p"],
  ])("selects %s with %s", (environment, selector) => {
    const output = runBash(
      'source "$1"; seqdesk_set_conda_environment "$2"; printf "%s\\n%s\\n" "$SEQDESK_CONDA_ENV_SELECTOR" "$SEQDESK_CONDA_ENVIRONMENT"',
      environment
    );

    expect(output).toEqual([selector, environment]);
  });

  it("passes the selector and environment as separate conda arguments", () => {
    const output = runBash(
      'conda() { printf "<%s>\\n" "$@"; }; source "$1"; seqdesk_set_conda_environment "$2"; seqdesk_conda_run nextflow -version',
      "/shared/conda env/reviewer"
    );

    expect(output).toEqual([
      "<run>",
      "<-p>",
      "</shared/conda env/reviewer>",
      "<nextflow>",
      "<-version>",
    ]);
  });
});
