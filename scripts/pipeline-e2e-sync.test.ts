import fs from "node:fs";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  assertPipelineSyncPayload,
  syncPipelineRunFailClosed,
} from "./lib/pipeline-e2e-sync.mjs";

function clientReturning(response: Response) {
  return {
    request: vi.fn().mockResolvedValue(response),
  };
}

describe("pipeline E2E sync proof", () => {
  it("posts to the exact run sync endpoint and accepts its success contract", async () => {
    const client = clientReturning(
      Response.json({ success: true, synced: false, status: "running" }),
    );

    await expect(
      syncPipelineRunFailClosed(client, "run/with spaces"),
    ).resolves.toMatchObject({
      success: true,
      synced: false,
      status: "running",
    });
    expect(client.request).toHaveBeenCalledWith(
      "/api/pipelines/runs/run%2Fwith%20spaces/sync",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{}",
      },
    );
  });

  it("rejects a non-success HTTP response with its diagnostic body", async () => {
    const client = clientReturning(
      Response.json(
        { error: "finalization failed" },
        { status: 503 },
      ),
    );

    await expect(
      syncPipelineRunFailClosed(client, "run-1", {
        context: "Final writeback sync",
      }),
    ).rejects.toThrow(
      /Final writeback sync failed \(503\)[\s\S]*finalization failed/,
    );
  });

  it("rejects malformed JSON even when HTTP reports success", async () => {
    const client = clientReturning(
      new Response("<html>upstream error</html>", { status: 200 }),
    );

    await expect(
      syncPipelineRunFailClosed(client, "run-1"),
    ).rejects.toThrow(/returned invalid JSON[\s\S]*upstream error/);
  });

  it.each([
    ["a null payload", null, /non-object payload/],
    ["success=false", { success: false, synced: true }, /did not report success/],
    ["a missing success flag", { synced: true }, /did not report success/],
    ["a missing synced flag", { success: true }, /no boolean synced state/],
    [
      "a malformed status",
      { success: true, synced: true, status: 200 },
      /invalid status/,
    ],
    [
      "an embedded error",
      { success: true, synced: true, error: "writeback failed" },
      /error payload despite HTTP success/,
    ],
    [
      "an object-valued embedded error",
      { success: true, synced: true, error: { message: "writeback failed" } },
      /error payload despite HTTP success/,
    ],
  ])("rejects %s so a bad payload cannot false-green", (_label, payload, pattern) => {
    expect(() => assertPipelineSyncPayload(payload, "Final sync")).toThrow(
      pattern,
    );
  });

  it("keeps every legacy single-SLURM sync behind the fail-closed helper", () => {
    const harness = fs.readFileSync(
      path.join(process.cwd(), "scripts/run-slurm-pipeline-e2e.mjs"),
      "utf8",
    );

    expect(harness).toContain(
      'import { syncPipelineRunFailClosed } from "./lib/pipeline-e2e-sync.mjs"',
    );
    expect(harness.match(/await syncPipelineRunFailClosed\(/g)).toHaveLength(3);
    expect(harness).not.toMatch(
      /client\.request\(`\/api\/pipelines\/runs\/\$\{runId\}\/sync/,
    );
  });

  it("keeps the canonical runtime and failure-path syncs behind the same contract", () => {
    const runtimeHarness = fs.readFileSync(
      path.join(process.cwd(), "scripts/run-pipeline-runtime-e2e.mjs"),
      "utf8",
    );
    const failureHarness = fs.readFileSync(
      path.join(process.cwd(), "scripts/run-slurm-failure-e2e.mjs"),
      "utf8",
    );

    expect(runtimeHarness).toContain(
      'import { syncPipelineRunFailClosed } from "./lib/pipeline-e2e-sync.mjs"',
    );
    expect(runtimeHarness).toContain(
      "const payload = await syncPipelineRunFailClosed(client, runId, {",
    );
    expect(runtimeHarness).not.toMatch(
      /client\.request\(`\/api\/pipelines\/runs\/\$\{runId\}\/sync/,
    );

    expect(failureHarness).toContain(
      'import { syncPipelineRunFailClosed } from "./lib/pipeline-e2e-sync.mjs"',
    );
    expect(failureHarness.match(/await syncPipelineRunFailClosed\(/g)).toHaveLength(2);
    expect(failureHarness).not.toMatch(
      /client\.request\(`\/api\/pipelines\/runs\/\$\{runId\}\/sync/,
    );
  });
});
