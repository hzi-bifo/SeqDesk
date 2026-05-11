import chokidar, { type FSWatcher } from 'chokidar';
import path from 'path';
import { promises as fs } from 'fs';
import { createWriteStream } from 'fs';
import os from 'os';
import { randomUUID } from 'crypto';
import { parseBarcodeFromPath } from '../src/lib/sequencing/minion-paths';
import { countFastqStats } from '../src/lib/sequencing/fastq-stats';

/**
 * Tiny FIFO semaphore. Caps concurrent ingest jobs across ALL streams so a
 * busy run (or many streams) can't exhaust the DB pool / pegging CPU on
 * decompressing several large FASTQs at once. Tunable via INGEST_CONCURRENCY
 * env var (default 4 — fits comfortably under the default Prisma pool of 10).
 */
function makeSemaphore(maxConcurrent: number) {
  let inUse = 0;
  const waiters: Array<() => void> = [];
  async function acquire(): Promise<void> {
    if (inUse < maxConcurrent) {
      inUse += 1;
      return;
    }
    await new Promise<void>((resolve) => waiters.push(resolve));
    inUse += 1;
  }
  function release(): void {
    inUse -= 1;
    const next = waiters.shift();
    if (next) next();
  }
  return {
    async run<T>(fn: () => Promise<T>): Promise<T> {
      await acquire();
      try {
        return await fn();
      } finally {
        release();
      }
    },
    snapshot: () => ({ inUse, queued: waiters.length, max: maxConcurrent }),
  };
}

const INGEST_CONCURRENCY = Math.max(
  1,
  Number(process.env.INGEST_CONCURRENCY ?? 4) || 4,
);
const ingestSemaphore = makeSemaphore(INGEST_CONCURRENCY);

/**
 * Defensive re-check that a file's size has been stable for `quietMs`. Chokidar
 * already does this before emitting via `awaitWriteFinish`, but on slow shares
 * or atomic-rename patterns the file can still be mid-flight when we read it.
 * Polls every 500ms until two consecutive stats agree for at least `quietMs`,
 * or returns null on timeout.
 */
async function waitForStable(
  filePath: string,
  opts: { quietMs?: number; timeoutMs?: number } = {},
): Promise<{ size: number } | null> {
  const quietMs = opts.quietMs ?? 1500;
  const timeoutMs = opts.timeoutMs ?? 30_000;
  const pollMs = Math.max(250, Math.floor(quietMs / 3));
  const deadline = Date.now() + timeoutMs;
  let lastSize = -1;
  let lastChangedAt = Date.now();
  while (Date.now() < deadline) {
    let size: number;
    try {
      const st = await fs.stat(filePath);
      size = st.size;
    } catch {
      // File vanished mid-poll — treat as unstable, retry until timeout.
      await new Promise((r) => setTimeout(r, pollMs));
      continue;
    }
    if (size !== lastSize) {
      lastSize = size;
      lastChangedAt = Date.now();
    } else if (Date.now() - lastChangedAt >= quietMs) {
      return { size };
    }
    await new Promise((r) => setTimeout(r, pollMs));
  }
  return null;
}

// Stable identifier for THIS monitor process. Logged on every claim so that if two
// monitors ever run against the same DB by accident, you can tell from the events
// which one ingested what. Multi-monitor leasing/locking is a Phase 2 concern.
const MONITOR_ID = `${os.hostname()}:${process.pid}:${randomUUID().slice(0, 8)}`;

// Heavyweight imports (DB, config) loaded lazily so --simulate works without DATABASE_URL.
type DbModule = typeof import('../src/lib/db');
type ConfigModule = typeof import('../src/lib/minknow/config');
type PauseModule = typeof import('../src/lib/workers/pause');

let _db: DbModule['db'] | null = null;
async function getDb() {
  if (!_db) {
    const mod = (await import('../src/lib/db')) as DbModule;
    _db = mod.db;
  }
  return _db;
}

async function getMinknowConfig() {
  const mod = (await import('../src/lib/minknow/config')) as ConfigModule;
  return mod.loadMinknowConfig();
}

async function getIsPaused() {
  const mod = (await import('../src/lib/workers/pause')) as PauseModule;
  return mod.isWorkerPaused('stream-monitor');
}

// Cached pause state, refreshed on each syncWatchers tick. Per-file callbacks
// read this flag instead of hitting the DB on every chokidar event.
let pausedSnapshot = false;
let lastPausedLogged: boolean | null = null;

interface RunningWatcher {
  streamRunId: string;
  outputDir: string;
  watcher: FSWatcher;
  // file path -> last seen size, used to dedupe chokidar add/change firing twice
  seen: Map<string, number>;
}

const watchers = new Map<string, RunningWatcher>();
let stopRequested = false;

function log(msg: string, ...rest: unknown[]) {
  console.log(`[stream-monitor] ${msg}`, ...rest);
}

function logError(msg: string, ...rest: unknown[]) {
  console.error(`[stream-monitor] ${msg}`, ...rest);
}

interface BarcodeMap {
  [barcode: string]: string;
}

function parseBarcodeMap(raw: string | null): BarcodeMap {
  if (!raw) return {};
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') return parsed as BarcodeMap;
  } catch {
    // ignore
  }
  return {};
}

async function recordEvent(streamRunId: string, kind: string, payload: Record<string, unknown>) {
  const db = await getDb();
  await db.streamRunEvent.create({
    data: {
      streamRunId,
      kind,
      payload: JSON.stringify(payload),
    },
  });
}

async function ingestFile(opts: {
  streamRunId: string;
  orderId: string;
  filePath: string;
  size: number;
  barcodeMap: BarcodeMap;
}) {
  const { streamRunId, orderId, filePath, size, barcodeMap } = opts;
  const parsed = parseBarcodeFromPath(filePath);

  if (!parsed) {
    await recordEvent(streamRunId, 'ERROR', {
      message: 'could not parse barcode from path',
      filePath,
    });
    return;
  }

  const sampleId = barcodeMap[parsed.barcode];
  if (!sampleId) {
    await recordEvent(streamRunId, 'FILE_INGESTED', {
      filePath,
      barcode: parsed.barcode,
      size,
      linkedSampleId: null,
      reason: 'barcode not mapped to a sample',
    });
    return;
  }

  const db = await getDb();
  const sample = await db.sample.findFirst({
    where: { id: sampleId, orderId },
    select: { id: true },
  });
  if (!sample) {
    await recordEvent(streamRunId, 'ERROR', {
      message: 'mapped sampleId not found in this order',
      sampleId,
      barcode: parsed.barcode,
      filePath,
    });
    return;
  }

  // For nanopore each chunk is logged as an event. The FIRST chunk for a sample
  // also seeds a Read row (file1 = first chunk path) so the sample shows linked
  // reads in the existing UI. Subsequent chunks are recorded as events only —
  // promoting them into a single concatenated Read is a follow-up "finalize"
  // step (out of scope for this MVP).
  const existingForSample = await db.read.findFirst({
    where: { sampleId: sample.id },
    select: { id: true },
  });

  if (!existingForSample) {
    try {
      await db.read.create({
        data: {
          sampleId: sample.id,
          file1: filePath,
        },
      });
    } catch (error) {
      // Race / constraint mismatch — non-fatal; the event log is still recorded below.
      logError(`could not seed Read for ${sample.id}`, error);
    }
  }

  // Defensive: wait until the file is size-stable before parsing. chokidar's
  // awaitWriteFinish covers the normal case but on slow shares / atomic-rename
  // patterns the file can still be growing when we get here.
  const stable = await waitForStable(filePath, { quietMs: 1500, timeoutMs: 15_000 });
  const stableSize = stable?.size ?? size;
  if (!stable) {
    await recordEvent(streamRunId, 'ERROR', {
      message: 'file did not stabilize within timeout — parsing anyway',
      filePath,
      size,
    });
  }

  // Count actual reads + bases (not just file count / byte count) so the UI can
  // show operator-meaningful numbers. Fall back to size-based estimates if the
  // FASTQ couldn't be parsed (malformed file, mid-write race, etc.).
  const stats = await countFastqStats(filePath);
  const reads = stats?.reads ?? 0;
  const bases = stats?.bases ?? 0;

  // Idempotent insert: the unique (streamRunId, filePath) index makes the create
  // throw P2002 if this exact file is already recorded for this run. We use the
  // throw to detect double-fire and skip the StreamRun totals increment so
  // chokidar duplicates (rename, atomic-write, restart re-scan) don't double-count.
  let alreadyIngested = false;
  try {
    await db.streamIngestedFile.create({
      data: {
        streamRunId,
        sampleId: sample.id,
        filePath,
        barcode: parsed.barcode,
        size: stableSize,
        reads,
        bases: BigInt(bases),
      },
    });
  } catch (err) {
    const code = (err as { code?: string }).code;
    if (code === 'P2002') {
      alreadyIngested = true;
    } else {
      throw err;
    }
  }

  if (alreadyIngested) {
    await recordEvent(streamRunId, 'FILE_INGESTED', {
      filePath,
      barcode: parsed.barcode,
      size: stableSize,
      reads,
      bases,
      linkedSampleId: sample.id,
      duplicate: true,
    });
    return;
  }

  await db.streamRun.update({
    where: { id: streamRunId },
    data: {
      totalReads: { increment: reads },
      totalBases: { increment: BigInt(bases) },
    },
  });

  await recordEvent(streamRunId, 'FILE_INGESTED', {
    filePath,
    barcode: parsed.barcode,
    size: stableSize,
    reads,
    bases,
    linkedSampleId: sample.id,
  });
}

async function attachWatcher(run: {
  id: string;
  orderId: string;
  outputDir: string;
  barcodeMap: string | null;
}) {
  if (watchers.has(run.id)) return;

  try {
    const stat = await fs.stat(run.outputDir);
    if (!stat.isDirectory()) {
      logError(`outputDir is not a directory for stream ${run.id}: ${run.outputDir}`);
      return;
    }
  } catch (error) {
    logError(`outputDir missing for stream ${run.id}: ${run.outputDir}`, error);
    await recordEvent(run.id, 'ERROR', { message: 'outputDir missing', outputDir: run.outputDir });
    return;
  }

  const barcodeMap = parseBarcodeMap(run.barcodeMap);
  const watchGlob = path.join(run.outputDir, 'fastq_pass');

  // Pull tunables from the per-installation config so ops can dial up polling
  // and stability thresholds for slow shares without code changes.
  const config = await getMinknowConfig();
  const stabilityThreshold = Math.max(500, config.stabilityThresholdMs);

  const watcher = chokidar.watch(watchGlob, {
    persistent: true,
    ignoreInitial: false,
    usePolling: config.usePolling,
    // 1s polling interval is a sane default — only kicks in when usePolling=true.
    interval: 1000,
    binaryInterval: 1000,
    awaitWriteFinish: {
      stabilityThreshold,
      pollInterval: Math.min(500, Math.floor(stabilityThreshold / 4)),
    },
  });
  log(`attached watcher for stream ${run.id} → ${watchGlob} (usePolling=${config.usePolling}, stability=${stabilityThreshold}ms)`);

  const tracker: RunningWatcher = {
    streamRunId: run.id,
    outputDir: run.outputDir,
    watcher,
    seen: new Map(),
  };
  watchers.set(run.id, tracker);

  const handle = async (filePath: string, stats?: { size: number }) => {
    if (!filePath.endsWith('.fastq.gz') && !filePath.endsWith('.fastq') && !filePath.endsWith('.fq.gz') && !filePath.endsWith('.fq')) {
      return;
    }
    // Soft-pause: skip ingest while paused but DON'T mark as seen, so the file
    // gets a chance on resume if chokidar re-emits (e.g. file growth).
    if (pausedSnapshot) {
      return;
    }
    const size = stats?.size ?? 0;
    if (tracker.seen.get(filePath) === size) {
      return; // dedupe
    }
    tracker.seen.set(filePath, size);

    try {
      // Gate every ingest through the global semaphore so a burst of new files
      // (e.g. chokidar's initial-add storm on attach, or a busy multi-barcode
      // run) can't oversaturate the DB pool / CPU. Queued work is processed
      // FIFO; the semaphore.snapshot() shows live depth in the logs below.
      await ingestSemaphore.run(() =>
        ingestFile({
          streamRunId: run.id,
          orderId: run.orderId,
          filePath,
          size,
          barcodeMap,
        }),
      );
    } catch (error) {
      logError(`ingest failed for ${filePath}`, error);
      await recordEvent(run.id, 'ERROR', {
        message: 'ingest failed',
        filePath,
        error: error instanceof Error ? error.message : String(error),
      }).catch(() => undefined);
    }
  };

  watcher.on('add', (p, stats) => void handle(p, stats));
  watcher.on('change', (p, stats) => void handle(p, stats));
  watcher.on('error', (err) => {
    logError(`watcher error for stream ${run.id}`, err);
  });
}

async function detachWatcher(streamRunId: string) {
  const tracker = watchers.get(streamRunId);
  if (!tracker) return;
  await tracker.watcher.close();
  watchers.delete(streamRunId);
  log(`detached watcher for stream ${streamRunId}`);
}

async function syncWatchers() {
  const db = await getDb();

  // Refresh the cached pause flag once per tick. Per-file callbacks read this
  // synchronously to avoid hitting the DB on every chokidar event.
  try {
    pausedSnapshot = await getIsPaused();
  } catch (error) {
    logError('failed to read pause flag, assuming not paused', error);
    pausedSnapshot = false;
  }
  if (pausedSnapshot !== lastPausedLogged) {
    log(pausedSnapshot ? 'PAUSED — ingest skipped, watchers stay attached' : 'RESUMED — ingesting');
    lastPausedLogged = pausedSnapshot;
  }

  // 1. Honor stop requests from the API. Anything STOPPING gets its watcher torn
  //    down and is moved to STOPPED. The monitor owns this transition because
  //    the watcher itself lives in this process.
  const stopping = await db.streamRun.findMany({
    where: { status: 'STOPPING' },
    select: { id: true },
  });
  for (const run of stopping) {
    await detachWatcher(run.id);
    await db.streamRun.update({
      where: { id: run.id },
      data: { status: 'STOPPED', stoppedAt: new Date() },
    });
    await recordEvent(run.id, 'RUN_STOPPED', { monitorId: MONITOR_ID });
  }

  // 2. Reconcile watcher set against currently ACTIVE rows.
  const active = await db.streamRun.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true, orderId: true, outputDir: true, barcodeMap: true, monitorId: true },
  });
  const activeIds = new Set(active.map((r) => r.id));

  for (const id of Array.from(watchers.keys())) {
    if (!activeIds.has(id)) {
      await detachWatcher(id);
    }
  }

  for (const run of active) {
    if (!watchers.has(run.id)) {
      await attachWatcher(run);
      // Claim ownership in the DB so other processes (and the UI) can see who
      // is ingesting this run.
      await db.streamRun.update({
        where: { id: run.id },
        data: { monitorId: MONITOR_ID, heartbeatAt: new Date() },
      });
    }
  }

  // 3. Heartbeat. Touch lastSeenAt + heartbeatAt for everything we own so a
  //    stale monitor process is detectable later.
  if (active.length > 0) {
    await db.streamRun.updateMany({
      where: { id: { in: active.map((r) => r.id) }, monitorId: MONITOR_ID },
      data: { lastSeenAt: new Date(), heartbeatAt: new Date() },
    });
  }

  // 4. Surface semaphore depth when it's non-trivial. Quiet during normal use,
  //    noisy when the ingest queue actually backs up — which is exactly when
  //    you want to see it.
  const sem = ingestSemaphore.snapshot();
  if (sem.queued > 0 || sem.inUse >= sem.max) {
    log(`ingest semaphore: inUse=${sem.inUse}/${sem.max} queued=${sem.queued}`);
  }
}

// --- simulate mode ----------------------------------------------------------

async function ensureDir(p: string) {
  await fs.mkdir(p, { recursive: true });
}

async function writeFakeFastq(filePath: string, readCount: number) {
  await ensureDir(path.dirname(filePath));
  const stream = createWriteStream(filePath);
  for (let i = 0; i < readCount; i++) {
    const id = `@sim_read_${Date.now()}_${i}`;
    const seq = 'ACGT'.repeat(50);
    const qual = 'I'.repeat(seq.length);
    stream.write(`${id}\n${seq}\n+\n${qual}\n`);
  }
  await new Promise<void>((resolve, reject) => {
    stream.end((err?: Error | null) => (err ? reject(err) : resolve()));
  });
}

async function runSimulator(opts: { outputDir: string; intervalMs: number; barcodes: string[] }) {
  log(`SIMULATE mode: writing fake FASTQs to ${opts.outputDir} every ${opts.intervalMs}ms across barcodes [${opts.barcodes.join(', ')}]`);
  let counter = 0;
  while (!stopRequested) {
    counter += 1;
    const barcode = opts.barcodes[counter % opts.barcodes.length];
    const fname = `FAS00000_pass_${barcode}_${String(counter).padStart(4, '0')}.fastq`;
    const target = path.join(opts.outputDir, 'fastq_pass', barcode, fname);
    try {
      await writeFakeFastq(target, 50);
      log(`wrote ${target}`);
    } catch (error) {
      logError(`simulator failed to write ${target}`, error);
    }
    await sleep(opts.intervalMs);
  }
}

async function runDiscoverSimulator(opts: {
  outputDir: string;
  sampleCount: number;
  readsPerFile: number;
}) {
  log(
    `SIMULATE DISCOVER mode: writing ${opts.sampleCount} paired samples (${opts.readsPerFile} reads/file) to ${opts.outputDir}, then exiting`,
  );
  await ensureDir(opts.outputDir);
  for (let i = 1; i <= opts.sampleCount; i += 1) {
    const num = String(i).padStart(2, '0');
    // Illumina-style naming so Discover's name matcher has something to chew on.
    const r1 = path.join(opts.outputDir, `Sample-${num}_S${i}_L001_R1_001.fastq`);
    const r2 = path.join(opts.outputDir, `Sample-${num}_S${i}_L001_R2_001.fastq`);
    try {
      await writeFakeFastq(r1, opts.readsPerFile);
      await writeFakeFastq(r2, opts.readsPerFile);
      log(`wrote pair Sample-${num} (${r1} + ${r2})`);
    } catch (error) {
      logError(`discover-simulator failed to write Sample-${num}`, error);
    }
  }
  log(`done — ${opts.sampleCount * 2} files written under ${opts.outputDir}`);
  log(`next: point Data Storage path at this dir (or copy elsewhere), then click Discover on an order`);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

// --- entry point ------------------------------------------------------------

async function main() {
  const args = new Set(process.argv.slice(2));
  const once = args.has('--once');
  const simulate = args.has('--simulate');
  const simulateDiscover = args.has('--simulate-discover');

  if (simulateDiscover) {
    const outputDirArg = process.argv.find((a) => a.startsWith('--output-dir='))?.split('=')[1]
      ?? '/tmp/seqdesk-discover';
    const sampleCount = Number(process.env.DISCOVER_SAMPLES_COUNT ?? 4);
    const readsPerFile = Number(process.env.DISCOVER_READS_PER_FILE ?? 5000);
    await runDiscoverSimulator({ outputDir: outputDirArg, sampleCount, readsPerFile });
    return;
  }

  if (simulate) {
    const outputDirArg = process.argv.find((a) => a.startsWith('--output-dir='))?.split('=')[1]
      ?? '/tmp/fake-minknow';
    const intervalMs = Number(process.env.SIMULATE_INTERVAL_MS ?? 5000);
    const barcodes = (process.env.SIMULATE_BARCODES ?? 'barcode01,barcode02,barcode03').split(',');
    await runSimulator({ outputDir: outputDirArg, intervalMs, barcodes });
    return;
  }

  const config = await getMinknowConfig();
  const interval = Number(process.env.STREAM_MONITOR_INTERVAL_MS ?? config.pollIntervalMs ?? 5000);

  if (once) {
    await syncWatchers();
    // Give chokidar a moment to fire any initial-add events, then exit.
    await sleep(2000);
    for (const id of Array.from(watchers.keys())) {
      await detachWatcher(id);
    }
    return;
  }

  log(`running every ${interval}ms (gRPC enrichment: not configured in MVP)`);
  await syncWatchers();
  const handle = setInterval(() => {
    syncWatchers().catch((err) => logError('syncWatchers failed', err));
  }, interval);

  const shutdown = async () => {
    stopRequested = true;
    clearInterval(handle);
    log('shutting down');
    for (const id of Array.from(watchers.keys())) {
      await detachWatcher(id);
    }
    if (_db) await _db.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown());
  process.on('SIGTERM', () => void shutdown());
}

main().catch((error) => {
  logError('fatal', error);
  process.exit(1);
});
