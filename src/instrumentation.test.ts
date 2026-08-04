import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { shouldAutostartPipelineMonitor } from "./instrumentation";

function environment(
  values: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  return values as NodeJS.ProcessEnv;
}

describe("pipeline monitor instrumentation", () => {
  it("starts only for self-hosted Node runtimes", () => {
    expect(
      shouldAutostartPipelineMonitor(environment({
        NEXT_RUNTIME: "nodejs",
      }))
    ).toBe(true);
    expect(
      shouldAutostartPipelineMonitor(environment({
        NEXT_RUNTIME: "edge",
      }))
    ).toBe(false);
  });

  it("never autostarts on Vercel or in the public demo", () => {
    expect(
      shouldAutostartPipelineMonitor(environment({
        NEXT_RUNTIME: "nodejs",
        VERCEL: "1",
      }))
    ).toBe(false);
    expect(
      shouldAutostartPipelineMonitor(environment({
        NEXT_RUNTIME: "nodejs",
        SEQDESK_ENABLE_PUBLIC_DEMO: "true",
      }))
    ).toBe(false);
    expect(
      shouldAutostartPipelineMonitor(environment({
        NEXT_RUNTIME: "nodejs",
        NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO: "true",
      }))
    ).toBe(false);
  });

  it("honors the explicit opt-out", () => {
    expect(
      shouldAutostartPipelineMonitor(environment({
        NEXT_RUNTIME: "nodejs",
        SEQDESK_DISABLE_WORKER_AUTOSTART: "1",
      }))
    ).toBe(false);
  });

  it("keeps Node-only worker dependencies out of Edge instrumentation", () => {
    const edgeSafeEntry = fs.readFileSync(
      path.join(process.cwd(), "src", "instrumentation.ts"),
      "utf8"
    );
    const nodeEntry = fs.readFileSync(
      path.join(process.cwd(), "src", "instrumentation-node.ts"),
      "utf8"
    );

    expect(edgeSafeEntry).toContain(
      'process.env.NEXT_RUNTIME === "nodejs"'
    );
    expect(edgeSafeEntry).toContain('"./instrumentation-node"');
    expect(edgeSafeEntry).not.toContain('"@/lib/workers/process"');
    expect(nodeEntry).toContain('from "@/lib/workers/process"');
  });
});
