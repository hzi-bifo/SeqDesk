import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parsePipelineCliE2EArgs } from "./run-pipeline-cli-e2e.mjs";

const harnessSource = fs.readFileSync(
  path.join(process.cwd(), "scripts", "run-pipeline-cli-e2e.mjs"),
  "utf8"
);

describe("installed pipeline CLI E2E harness", () => {
  it("parses the explicit harness inputs without changing their values", () => {
    expect(
      parsePipelineCliE2EArgs([
        "--install-dir",
        "/srv/seqdesk",
        "--seqdesk-command",
        "/home/operator/.local/bin/seqdesk",
        "--neutral-cwd",
        "/tmp/neutral",
        "--base-url",
        "http://127.0.0.1:8000",
        "--fixture-url",
        "http://127.0.0.1:8003",
        "--fixture-resource-root",
        "/srv/seqdesk-data/fixture",
        "--result-file",
        "/tmp/result.json",
      ])
    ).toEqual({
      "install-dir": "/srv/seqdesk",
      "seqdesk-command": "/home/operator/.local/bin/seqdesk",
      "neutral-cwd": "/tmp/neutral",
      "base-url": "http://127.0.0.1:8000",
      "fixture-url": "http://127.0.0.1:8003",
      "fixture-resource-root": "/srv/seqdesk-data/fixture",
      "result-file": "/tmp/result.json",
    });
  });

  it("rejects positional or valueless harness arguments", () => {
    expect(() => parsePipelineCliE2EArgs(["unexpected"])).toThrow(
      "Unexpected argument: unexpected"
    );
    expect(() => parsePipelineCliE2EArgs(["--base-url"])).toThrow(
      "Missing value for --base-url"
    );
    expect(() =>
      parsePipelineCliE2EArgs(["--base-url", "--fixture-url"])
    ).toThrow("Missing value for --base-url");
  });

  it("keeps every user CLI command directory-free and runs it from the neutral cwd", () => {
    const cliRunner = harnessSource.slice(
      harnessSource.indexOf("async function runCli("),
      harnessSource.indexOf("function getPipelines(")
    );
    const primaryFlow = harnessSource.slice(
      harnessSource.indexOf("async function runPrimaryCliFlow("),
      harnessSource.indexOf("async function runConcurrentBrowserCliInstall(")
    );
    const concurrentFlow = harnessSource.slice(
      harnessSource.indexOf("async function runConcurrentBrowserCliInstall("),
      harnessSource.indexOf("export async function runPipelineCliE2E(")
    );

    expect(cliRunner).toContain("cwd: context.neutralCwd");
    expect(cliRunner).toContain("runCommand(context.seqdeskCommand, argv");
    expect(primaryFlow).not.toContain('"--dir"');
    expect(concurrentFlow).not.toContain('"--dir"');
    expect(primaryFlow).toContain(
      '["pipelines", "install", pipelineId, "--json"]'
    );
    expect(concurrentFlow).toContain(
      '["pipelines", "install", pipelineId, "--json"]'
    );
  });

  it("checks that the installed human-readable list hands the operator to the next action", () => {
    const primaryFlow = harnessSource.slice(
      harnessSource.indexOf("async function runPrimaryCliFlow("),
      harnessSource.indexOf("async function runConcurrentBrowserCliInstall(")
    );

    expect(primaryFlow).toContain(
      'runHumanCli(context, ["pipelines", "list"])'
    );
    expect(primaryFlow).toContain('"What to do next:"');
    expect(primaryFlow).toContain(
      '"seqdesk pipelines install <pipeline-id>"'
    );
    expect(primaryFlow).toContain(
      '"https://seqdesk.org/docs/pipelines/installing-pipelines"'
    );
  });

  it("orders setup, idempotence, rollback, and browser concurrency as required", () => {
    const primaryFlow = harnessSource.slice(
      harnessSource.indexOf("async function runPrimaryCliFlow("),
      harnessSource.indexOf("async function runConcurrentBrowserCliInstall(")
    );
    const setup = primaryFlow.indexOf('"pipelines",\n    "setup"');
    const repeatInstall = primaryFlow.indexOf(
      "const repeat = await runCli(context"
    );
    const brokenUpdate = primaryFlow.indexOf(
      "fixture.advertiseBrokenUpdate()"
    );

    expect(setup).toBeGreaterThanOrEqual(0);
    expect(repeatInstall).toBeGreaterThan(setup);
    expect(brokenUpdate).toBeGreaterThan(repeatInstall);
    expect(primaryFlow).toContain(
      'repeat.payload?.action === "noop"'
    );
    expect(primaryFlow).toContain(
      "Repeated install changed the saved setup or activation"
    );
    expect(primaryFlow).toContain(
      'findReadiness(blockedPipeline, "required-config")?.status === "missing"'
    );
    expect(primaryFlow).toContain(
      'findReadiness(blockedPipeline, "databases")?.status === "missing"'
    );
    expect(primaryFlow).toContain(
      "packageVersion(rollbackPipeline) === PIPELINE_STORE_FIXTURE_V1"
    );
    expect(harnessSource).toContain(
      "Promise.all([cliPromise, apiPromise])"
    );
    expect(harnessSource).toContain(
      "assertNoInstallDebris(path.dirname(packageDir), pipelineId)"
    );
    expect(harnessSource).toContain(
      'path.join(pipelinesDir, ".seqdesk-install-locks")'
    );
    expect(harnessSource).toContain(
      'name.startsWith(`${pipelineId}.lock.stale-`)'
    );
  });
});
