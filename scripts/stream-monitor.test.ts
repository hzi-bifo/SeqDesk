import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { promises as fs } from "fs";
import os from "os";
import path from "path";
import type { Stats } from "fs";

// The watcher is the one part of stream ingest that reads the filesystem on its
// own. Containment under the configured outputRoot is checked ONCE, against
// outputDir, when the run is created (validateOutputDirUnderRoot realpaths both
// sides) — so a symlink planted inside fastq_pass/ afterwards is the way past
// that check. The watcher must neither walk one nor ingest one.

const mocks = vi.hoisted(() => ({
  watch: vi.fn(),
  loadMinknowConfig: vi.fn(),
  db: {
    streamRunEvent: { create: vi.fn() },
    streamIngestedFile: { create: vi.fn() },
    sample: { findFirst: vi.fn() },
    read: { findFirst: vi.fn(), create: vi.fn() },
    streamRun: { update: vi.fn() },
  },
}));

vi.mock("chokidar", () => ({ default: { watch: mocks.watch } }));
vi.mock("../src/lib/minknow/config", () => ({ loadMinknowConfig: mocks.loadMinknowConfig }));
vi.mock("../src/lib/db", () => ({ db: mocks.db }));
vi.mock("../src/lib/workers/pause", () => ({ isWorkerPaused: vi.fn().mockResolvedValue(false) }));

import { attachWatcher } from "./stream-monitor";

type AddHandler = (filePath: string, stats?: Stats) => void;

let tmpRoot: string;
let runCounter = 0;
let handlers: Map<string, AddHandler>;

function fakeStats(over: Partial<Stats> & { size: number; symlink: boolean }): Stats {
  return {
    size: over.size,
    isSymbolicLink: () => over.symlink,
  } as unknown as Stats;
}

// The module keeps one watcher per streamRunId for the lifetime of the process,
// so each test needs its own run id or attachWatcher no-ops.
async function attach(outputDir: string) {
  runCounter += 1;
  const run = {
    id: `stream-${runCounter}`,
    orderId: "order-1",
    outputDir,
    barcodeMap: null,
  };
  await attachWatcher(run);
  const options = mocks.watch.mock.calls.at(-1)?.[1] as Record<string, unknown>;
  return { run, options };
}

beforeEach(async () => {
  vi.clearAllMocks();
  tmpRoot = await fs.mkdtemp(path.join(os.tmpdir(), "stream-monitor-"));
  handlers = new Map();
  mocks.loadMinknowConfig.mockResolvedValue({
    usePolling: false,
    stabilityThresholdMs: 2000,
  });
  mocks.watch.mockImplementation(() => ({
    on: (event: string, cb: AddHandler) => {
      handlers.set(event, cb);
    },
    close: async () => undefined,
  }));
  mocks.db.streamRunEvent.create.mockResolvedValue({});
});

afterEach(async () => {
  await fs.rm(tmpRoot, { recursive: true, force: true });
});

describe("stream-monitor attachWatcher", () => {
  it("watches fastq_pass without following symlinks", async () => {
    const { options } = await attach(tmpRoot);

    expect(mocks.watch).toHaveBeenCalledWith(path.join(tmpRoot, "fastq_pass"), expect.anything());
    // chokidar's default is true, which would walk a symlinked directory dropped
    // into fastq_pass/ and ingest every file under its target.
    expect(options.followSymlinks).toBe(false);
  });

  it("skips a symlinked FASTQ instead of ingesting what it points at", async () => {
    const { run } = await attach(tmpRoot);
    const linkPath = path.join(tmpRoot, "fastq_pass", "barcode01", "escape.fastq.gz");

    handlers.get("add")?.(linkPath, fakeStats({ size: 42, symlink: true }));

    await vi.waitFor(() => expect(mocks.db.streamRunEvent.create).toHaveBeenCalled());
    expect(mocks.db.streamIngestedFile.create).not.toHaveBeenCalled();
    expect(mocks.db.sample.findFirst).not.toHaveBeenCalled();
    const event = mocks.db.streamRunEvent.create.mock.calls[0][0].data;
    expect(event.streamRunId).toBe(run.id);
    expect(event.kind).toBe("ERROR");
    expect(JSON.parse(event.payload)).toMatchObject({ filePath: linkPath });
    expect(JSON.parse(event.payload).message).toMatch(/skipped symlink/);
  });

  it("still ingests a real FASTQ under the watched directory", async () => {
    await attach(tmpRoot);
    const realPath = path.join(tmpRoot, "fastq_pass", "barcode01", "FAS00000_pass_barcode01_abc_def_0.fastq.gz");

    handlers.get("add")?.(realPath, fakeStats({ size: 4096, symlink: false }));

    // barcodeMap is empty, so ingest stops at "barcode not mapped to a sample" —
    // reaching that event proves the symlink guard let a real file through.
    await vi.waitFor(() => expect(mocks.db.streamRunEvent.create).toHaveBeenCalled());
    const event = mocks.db.streamRunEvent.create.mock.calls[0][0].data;
    expect(event.kind).toBe("FILE_INGESTED");
    expect(JSON.parse(event.payload)).toMatchObject({ barcode: "barcode01", linkedSampleId: null });
  });

  // Guards the dependency, not our code: chokidar's own default is followSymlinks
  // true, so an upgrade that changed how the flag behaves would re-open the hole
  // silently. Runs the REAL watcher over a real directory to prove it doesn't.
  it("does not walk into a symlinked directory planted in fastq_pass", async () => {
    const { options } = await attach(tmpRoot);
    const barcodeDir = path.join(tmpRoot, "fastq_pass", "barcode01");
    await fs.mkdir(barcodeDir, { recursive: true });
    await fs.writeFile(path.join(barcodeDir, "real.fastq"), "@r\nACGT\n+\nIIII\n");
    const outside = path.join(tmpRoot, "outside");
    await fs.mkdir(outside);
    await fs.writeFile(path.join(outside, "secret.fastq"), "@r\nACGT\n+\nIIII\n");
    await fs.symlink(outside, path.join(barcodeDir, "escape"));

    const real = await vi.importActual<typeof import("chokidar")>("chokidar");
    const added: string[] = [];
    const watcher = real.default.watch(path.join(tmpRoot, "fastq_pass"), {
      ...options,
      // Only shortened so the test doesn't sit through the production threshold.
      awaitWriteFinish: { stabilityThreshold: 100, pollInterval: 50 },
    });
    watcher.on("add", (p) => added.push(path.relative(tmpRoot, p)));
    await new Promise<void>((resolve) => watcher.on("ready", () => resolve()));
    await vi.waitFor(() => expect(added).toContain(path.join("fastq_pass", "barcode01", "real.fastq")));
    await watcher.close();

    expect(added).not.toContain(path.join("fastq_pass", "barcode01", "escape", "secret.fastq"));
  });

  it("records the skip once even when chokidar re-emits the same symlink", async () => {
    await attach(tmpRoot);
    const linkPath = path.join(tmpRoot, "fastq_pass", "barcode01", "escape.fastq.gz");

    handlers.get("add")?.(linkPath, fakeStats({ size: 42, symlink: true }));
    await vi.waitFor(() => expect(mocks.db.streamRunEvent.create).toHaveBeenCalledTimes(1));
    handlers.get("change")?.(linkPath, fakeStats({ size: 42, symlink: true }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.db.streamRunEvent.create).toHaveBeenCalledTimes(1);
  });
});
