import { describe, expect, it } from "vitest";
import { shouldAutostartPipelineMonitor } from "./instrumentation";

describe("pipeline monitor instrumentation", () => {
  it("starts only for self-hosted Node runtimes", () => {
    expect(
      shouldAutostartPipelineMonitor({
        NEXT_RUNTIME: "nodejs",
      })
    ).toBe(true);
    expect(
      shouldAutostartPipelineMonitor({
        NEXT_RUNTIME: "edge",
      })
    ).toBe(false);
  });

  it("never autostarts on Vercel or in the public demo", () => {
    expect(
      shouldAutostartPipelineMonitor({
        NEXT_RUNTIME: "nodejs",
        VERCEL: "1",
      })
    ).toBe(false);
    expect(
      shouldAutostartPipelineMonitor({
        NEXT_RUNTIME: "nodejs",
        SEQDESK_ENABLE_PUBLIC_DEMO: "true",
      })
    ).toBe(false);
    expect(
      shouldAutostartPipelineMonitor({
        NEXT_RUNTIME: "nodejs",
        NEXT_PUBLIC_SEQDESK_ENABLE_PUBLIC_DEMO: "true",
      })
    ).toBe(false);
  });

  it("honors the explicit opt-out", () => {
    expect(
      shouldAutostartPipelineMonitor({
        NEXT_RUNTIME: "nodejs",
        SEQDESK_DISABLE_WORKER_AUTOSTART: "1",
      })
    ).toBe(false);
  });
});
