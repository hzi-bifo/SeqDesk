import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { computeResultsRuntimeFingerprint, computeRuntimeFingerprint, listRuntimeFiles, runRuntimeInfo, runtimeIsStale, runtimeOfResults, RUNTIME_VERSION, RUNTIME_VERSION_FILE } from "./runtime-fingerprint";

let root: string;

beforeEach(() => {
  root = mkdtempSync(path.join(os.tmpdir(), "runtime-fp-"));
  mkdirSync(path.join(root, "src/lib/explore/__fixtures__"), { recursive: true });
  mkdirSync(path.join(root, "scripts"), { recursive: true });
  writeFileSync(path.join(root, "scripts/explore-monitor.ts"), "monitor");
  writeFileSync(path.join(root, "src/lib/explore/run-finalize.ts"), "finalize v1");
  writeFileSync(path.join(root, "src/lib/explore/run-finalize.test.ts"), "test");
  writeFileSync(path.join(root, "src/lib/explore/__fixtures__/x.ts"), "fixture");
  writeFileSync(path.join(root, "src/lib/explore/notes.md"), "doc");
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe("runtime fingerprint", () => {
  it("hashes runtime sources only, not tests, fixtures or docs", () => {
    const files = listRuntimeFiles(root).map((file) => path.relative(root, file));
    expect(files).toEqual(["scripts/explore-monitor.ts", "src/lib/explore/run-finalize.ts"]);
    const before = computeRuntimeFingerprint(root);
    writeFileSync(path.join(root, "src/lib/explore/run-finalize.test.ts"), "changed test");
    writeFileSync(path.join(root, "src/lib/explore/notes.md"), "changed doc");
    expect(computeRuntimeFingerprint(root)).toBe(before);
    expect(before).toMatch(/^[0-9a-f]{12}$/);
  });

  it("changes when the finalizer changes and reports the monitor stale", () => {
    const loaded = computeRuntimeFingerprint(root);
    expect(runtimeIsStale(loaded, root)).toBe(false);
    writeFileSync(path.join(root, "src/lib/explore/run-finalize.ts"), "finalize v2");
    expect(runtimeIsStale(loaded, root)).toBe(true);
    writeFileSync(path.join(root, "src/lib/explore/new-module.ts"), "new");
    expect(computeRuntimeFingerprint(root)).not.toBe(loaded);
  });

  it("prefers a version file written at build", () => {
    writeFileSync(path.join(root, RUNTIME_VERSION_FILE), "1.2.3+abc\n");
    const versioned = computeRuntimeFingerprint(root);
    writeFileSync(path.join(root, "src/lib/explore/run-finalize.ts"), "finalize v3");
    expect(computeRuntimeFingerprint(root)).toBe(versioned);
    writeFileSync(path.join(root, RUNTIME_VERSION_FILE), "1.2.4+def\n");
    expect(computeRuntimeFingerprint(root)).not.toBe(versioned);
  });

  it("records the helper that wrote the manifest", () => {
    expect(runRuntimeInfo("abc", { helperVersion: "0.2.0", language: "r" })).toEqual({ finalizer: "abc", version: RUNTIME_VERSION, helper: { language: "r", version: "0.2.0" } });
    expect(runRuntimeInfo("abc", null)).toEqual({ finalizer: "abc", version: RUNTIME_VERSION, helper: null });
  });

  it("results runtime ignores unrelated Explore code and follows the helpers", () => {
    mkdirSync(path.join(root, "explore/lib/r/seqdesk.explore/R"), { recursive: true });
    mkdirSync(path.join(root, "explore/lib/r/tests"), { recursive: true });
    mkdirSync(path.join(root, "explore/lib/shell/bin"), { recursive: true });
    writeFileSync(path.join(root, "explore/lib/r/seqdesk.explore/R/sx.R"), 'version <- "0.2.0"\n');
    writeFileSync(path.join(root, "explore/lib/r/tests/test-sx.R"), "test");
    writeFileSync(path.join(root, "explore/lib/shell/bin/sx"), 'VERSION = "0.1.0"\n');
    const before = computeResultsRuntimeFingerprint(root);
    writeFileSync(path.join(root, "src/lib/explore/reports.ts"), "unrelated view code");
    writeFileSync(path.join(root, "explore/lib/r/tests/test-sx.R"), "changed test");
    expect(computeResultsRuntimeFingerprint(root)).toBe(before);
    writeFileSync(path.join(root, "src/lib/explore/run-finalize.ts"), "finalize v2");
    const afterFinalizer = computeResultsRuntimeFingerprint(root);
    expect(afterFinalizer).not.toBe(before);
    writeFileSync(path.join(root, "explore/lib/shell/bin/sx"), 'VERSION = "0.1.1"\n');
    expect(computeResultsRuntimeFingerprint(root)).not.toBe(afterFinalizer);
  });

  it("reads runs finalized before versioning as current when their helper matches", () => {
    mkdirSync(path.join(root, "explore/lib/r/seqdesk.explore/R"), { recursive: true });
    writeFileSync(path.join(root, "explore/lib/r/seqdesk.explore/R/sx.R"), '  version <- "0.2.0"\n');
    const legacy = JSON.stringify({ runtime: { finalizer: "oldwholehash", helper: { language: "r", version: "0.2.0" } } });
    expect(runtimeOfResults(legacy, "cur123", root)?.finalizer).toBe("cur123");
    const olderHelper = JSON.stringify({ runtime: { finalizer: "oldwholehash", helper: { language: "r", version: "0.1.0" } } });
    expect(runtimeOfResults(olderHelper, "cur123", root)?.finalizer).toBe("oldwholehash");
    const versioned = JSON.stringify({ runtime: { finalizer: "other", version: "1", helper: { language: "r", version: "0.2.0" } } });
    expect(runtimeOfResults(versioned, "cur123", root)?.finalizer).toBe("other");
  });
});
