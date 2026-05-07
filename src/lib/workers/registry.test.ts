import { describe, expect, it } from "vitest";

import {
  WORKER_REGISTRY,
  getWorkerSpec,
  visibleWorkers,
  type WorkerName,
} from "./registry";

describe("workers/registry", () => {
  describe("WORKER_REGISTRY", () => {
    it("contains the four canonical worker names", () => {
      const names = WORKER_REGISTRY.map((spec) => spec.name).sort();
      expect(names).toEqual(
        [
          "discover-simulator",
          "pipeline-monitor",
          "stream-monitor",
          "stream-simulator",
        ].sort(),
      );
    });

    it("marks the simulators as devOnly", () => {
      const devOnly = WORKER_REGISTRY.filter((spec) => spec.devOnly).map((spec) => spec.name);
      expect(devOnly.sort()).toEqual(["discover-simulator", "stream-simulator"].sort());
    });

    it("only the stream-monitor supports pause", () => {
      const pausable = WORKER_REGISTRY.filter((spec) => spec.supportsPause).map((spec) => spec.name);
      expect(pausable).toEqual(["stream-monitor"]);
    });

    it("each entry has a script path and a label", () => {
      for (const spec of WORKER_REGISTRY) {
        expect(spec.script.length).toBeGreaterThan(0);
        expect(spec.label.length).toBeGreaterThan(0);
        expect(spec.description.length).toBeGreaterThan(0);
      }
    });
  });

  describe("getWorkerSpec", () => {
    it("returns the entry for a known name", () => {
      const spec = getWorkerSpec("stream-monitor");
      expect(spec).not.toBeNull();
      expect(spec?.name).toBe("stream-monitor");
      expect(spec?.script).toBe("scripts/stream-monitor.ts");
      expect(spec?.supportsPause).toBe(true);
      expect(spec?.devOnly).toBe(false);
      expect(spec?.settingsHref).toBe("/admin/minknow-stream");
    });

    it("returns the entry for pipeline-monitor", () => {
      const spec = getWorkerSpec("pipeline-monitor");
      expect(spec?.name).toBe("pipeline-monitor");
      expect(spec?.supportsPause).toBe(false);
      expect(spec?.devOnly).toBe(false);
    });

    it("returns the entry for stream-simulator with envOverrides + args", () => {
      const spec = getWorkerSpec("stream-simulator");
      expect(spec?.devOnly).toBe(true);
      expect(spec?.args).toEqual(["--simulate", "--output-dir=/tmp/seqdesk-sim"]);
      expect(spec?.envOverrides).toMatchObject({
        SIMULATE_INTERVAL_MS: expect.any(String),
        SIMULATE_BARCODES: expect.any(String),
      });
      expect(spec?.configNote).toBeTruthy();
    });

    it("returns null for an unknown name", () => {
      expect(getWorkerSpec("nope")).toBeNull();
      expect(getWorkerSpec("")).toBeNull();
    });

    it("type-narrows correctly for valid WorkerName values", () => {
      const names: WorkerName[] = [
        "stream-monitor",
        "stream-simulator",
        "discover-simulator",
        "pipeline-monitor",
      ];
      for (const name of names) {
        expect(getWorkerSpec(name)).not.toBeNull();
      }
    });
  });

  describe("visibleWorkers", () => {
    it("returns all workers in development", () => {
      const visible = visibleWorkers({ isProduction: false });
      expect(visible.length).toBe(WORKER_REGISTRY.length);
    });

    it("filters out devOnly workers in production", () => {
      const visible = visibleWorkers({ isProduction: true });
      const names = visible.map((spec) => spec.name).sort();
      expect(names).toEqual(["pipeline-monitor", "stream-monitor"].sort());
      expect(visible.every((spec) => !spec.devOnly)).toBe(true);
    });

    it("preserves the order of the underlying registry", () => {
      const visibleDev = visibleWorkers({ isProduction: false });
      expect(visibleDev.map((spec) => spec.name)).toEqual(
        WORKER_REGISTRY.map((spec) => spec.name),
      );
    });
  });
});
