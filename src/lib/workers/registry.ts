/**
 * Static manifest of background workers that can be controlled from the admin UI.
 *
 * Workers in this list are spawned via `child_process.spawn` from API routes
 * (see src/lib/workers/process.ts) and tracked through `BackgroundWorkerProcess`
 * rows in the DB.
 *
 * Adding a new worker: add an entry here and a UI card will surface
 * automatically. The script path is resolved relative to the repo root.
 */

export type WorkerName =
  | "stream-monitor"
  | "stream-simulator"
  | "discover-simulator"
  | "pipeline-monitor";

export interface WorkerSpec {
  name: WorkerName;
  /** Human label for the UI card. */
  label: string;
  /** One-line description shown next to the label. */
  description: string;
  /** Path to the tsx script, relative to the repo root. */
  script: string;
  /** Extra args passed to the script. */
  args?: string[];
  /** When true, expose Pause/Resume buttons; the worker is expected to honor `workerPause[name]` in SiteSettings. */
  supportsPause: boolean;
  /** When true, hide this worker in production builds (it's a dev/testing helper). */
  devOnly: boolean;
  /** Extra env vars to set when spawning. */
  envOverrides?: Record<string, string>;
  /** When set, the UI shows a "Settings" link button pointing here. */
  settingsHref?: string;
  /** Optional one-line note about how to change static args/env vars (rendered under the command line). */
  configNote?: string;
}

export const WORKER_REGISTRY: WorkerSpec[] = [
  {
    name: "stream-monitor",
    label: "MinKNOW stream monitor",
    description:
      "Watches the configured MinKNOW output directory and ingests FASTQ files into active stream runs.",
    script: "scripts/stream-monitor.ts",
    supportsPause: true,
    devOnly: false,
    settingsHref: "/admin/minknow-stream",
  },
  {
    name: "pipeline-monitor",
    label: "Pipeline monitor",
    description:
      "Polls SLURM and Nextflow trace files to keep PipelineRun status up to date.",
    script: "scripts/pipeline-monitor.ts",
    supportsPause: false,
    devOnly: false,
    settingsHref: "/admin/settings/pipelines",
  },
  {
    name: "stream-simulator",
    label: "Stream simulator (dev only)",
    description:
      "Drips small FASTQ files into a watched directory every few seconds, mimicking a live MinKNOW run. Use to test the Stream view without a real MinION.",
    script: "scripts/stream-monitor.ts",
    args: ["--simulate", "--output-dir=/tmp/seqdesk-sim"],
    envOverrides: { SIMULATE_INTERVAL_MS: "5000", SIMULATE_BARCODES: "barcode01,barcode02,barcode03" },
    supportsPause: false,
    devOnly: true,
    configNote:
      "Output dir / barcodes / interval are baked into the registry — to change them, edit src/lib/workers/registry.ts and restart the dev server.",
  },
  {
    name: "discover-simulator",
    label: "Discover & Associate simulator (dev only)",
    description:
      "Drops a one-shot batch of paired-end FASTQ files (Illumina-style naming) into a target directory and exits. Use to test the Discover & Associate scan without real data.",
    script: "scripts/stream-monitor.ts",
    args: ["--simulate-discover", "--output-dir=/tmp/seqdesk-discover"],
    envOverrides: { DISCOVER_SAMPLES_COUNT: "4", DISCOVER_READS_PER_FILE: "5000" },
    supportsPause: false,
    devOnly: true,
    configNote:
      "Drops 4 paired samples (8 .fastq files, ~1 MB each) then exits. To scan: set Application Settings → Data Storage path to the output dir, then click Discover on any order.",
  },
];

export function getWorkerSpec(name: string): WorkerSpec | null {
  return WORKER_REGISTRY.find((spec) => spec.name === name) ?? null;
}

/**
 * Workers that should be visible to the user given the runtime context.
 * Filters out `devOnly` workers in production.
 */
export function visibleWorkers(opts: { isProduction: boolean }): WorkerSpec[] {
  return WORKER_REGISTRY.filter((spec) => !spec.devOnly || !opts.isProduction);
}
