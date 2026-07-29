import fs from "fs/promises";
import path from "path";
import type { Prisma } from "@prisma/client";

import { db } from "@/lib/db";

import { createGenericAdapter } from "./generic-adapter";
import { getAdapter, registerAdapter } from "./adapters";
import { resolveOutputs, saveRunResults } from "./output-resolver";
import { getPackage } from "./package-loader";
import { processSubmgRunResults } from "./submg/submg-runner";
import type { DiscoverOutputsResult } from "./adapters/types";
import type { PipelineTarget } from "./types";

// Bounded settle-retry for shared-filesystem flush races. The last process may
// finish before every declared output is visible to a finalizer. A silent miss
// followed by terminal status would otherwise be permanent because monitors
// only revisit non-terminal runs.
const OUTPUT_SETTLE_ATTEMPTS = 3;
const OUTPUT_SETTLE_DELAY_MS = 1000;
const ACTIVE_RUN_STATUSES = ["pending", "queued", "running"] as const;
const FINALIZATION_CLAIM_STALE_MS = 30 * 60 * 1000;
const FINALIZATION_CLAIM_HEARTBEAT_MS = 60 * 1000;

type RequiredOutput = {
  id: string;
  scope: "sample" | "study" | "order" | "run";
};

function parseRunConfig(rawConfig: string | null | undefined): Record<string, unknown> {
  if (!rawConfig) return {};
  try {
    const parsed = JSON.parse(rawConfig) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

function isOutputRequired(
  pipelineId: string,
  output: { id: string; required?: boolean },
  config: Record<string, unknown>
): boolean {
  // These outputs are optional in the package contract because their workflows
  // have config-controlled branches. Require them whenever that branch is
  // enabled so an enabled-but-broken branch cannot silently pass finalization.
  if (pipelineId === "read-cleaning" && output.id === "removed_reads") {
    return config.outputRemovedReads === true;
  }
  if (pipelineId === "kraken2-bracken" && output.id === "krona_html") {
    return config.krona !== false;
  }
  return output.required !== false;
}

function getRequiredOutputs(
  pipelineId: string,
  rawConfig: string | null | undefined
): RequiredOutput[] {
  const pkg = getPackage(pipelineId);
  if (!pkg) return [];
  const config = parseRunConfig(rawConfig);
  return pkg.manifest.outputs
    .filter((output) => isOutputRequired(pipelineId, output, config))
    .map((output) => ({ id: output.id, scope: output.scope }));
}

function missingRequiredOutputs(
  discovered: DiscoverOutputsResult,
  requiredOutputs: RequiredOutput[],
  samples: Array<{ id: string; sampleId: string }>
): string[] {
  const missing: string[] = [];
  for (const output of requiredOutputs) {
    const matches = discovered.files.filter(
      (file) => file.outputId === output.id
    );
    if (output.scope !== "sample") {
      if (matches.length === 0) missing.push(output.id);
      continue;
    }

    const matchedSampleIds = new Set(
      matches.map((file) => file.sampleId).filter(Boolean)
    );
    for (const sample of samples) {
      if (!matchedSampleIds.has(sample.id)) {
        missing.push(`${output.id}[sample:${sample.sampleId}]`);
      }
    }
  }
  return missing;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listNonemptyFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  const pending = [directory];
  while (pending.length > 0) {
    const current = pending.pop()!;
    const entries = await fs.readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const entryPath = path.join(current, entry.name);
      if (entry.isFile()) {
        const stat = await fs.stat(entryPath);
        if (stat.size > 0) files.push(entryPath);
      }
      if (entry.isDirectory()) {
        pending.push(entryPath);
      }
    }
  }
  return files;
}

type SubmgCompletionExpectation = {
  samples: number;
  reads: number;
  assemblies: number;
  bins: number;
};

function configBoolean(
  config: Record<string, unknown>,
  key: string,
  fallback: boolean
): boolean {
  const value = config[key];
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    if (value.toLowerCase() === "true") return true;
    if (value.toLowerCase() === "false") return false;
  }
  return fallback;
}

async function inspectSubmgOutputs(
  runFolder: string,
  rawConfig: string | null | undefined
): Promise<SubmgCompletionExpectation | null> {
  try {
    const metadataPath = path.join(runFolder, "submg-metadata.json");
    const metadataStat = await fs.stat(metadataPath);
    if (!metadataStat.isFile() || metadataStat.size === 0) return null;
    const parsed = JSON.parse(await fs.readFile(metadataPath, "utf8")) as {
      submission?: {
        samples?: unknown;
        reads?: unknown;
        assembly?: unknown;
        bins?: unknown;
      };
      entries?: Array<{
        index?: unknown;
        sampleId?: unknown;
        readIds?: unknown;
        assemblyId?: unknown;
        bins?: unknown;
      }>;
    };
    if (!Array.isArray(parsed.entries) || parsed.entries.length === 0) {
      return null;
    }

    const config = parseRunConfig(rawConfig);
    const submission = {
      samples:
        typeof parsed.submission?.samples === "boolean"
          ? parsed.submission.samples
          : true,
      reads:
        typeof parsed.submission?.reads === "boolean"
          ? parsed.submission.reads
          : configBoolean(config, "submitReads", true),
      assembly:
        typeof parsed.submission?.assembly === "boolean"
          ? parsed.submission.assembly
          : configBoolean(config, "submitAssembly", true),
      bins:
        typeof parsed.submission?.bins === "boolean"
          ? parsed.submission.bins
          : configBoolean(config, "submitBins", true),
    };
    const expectation: SubmgCompletionExpectation = {
      samples: 0,
      reads: 0,
      assemblies: 0,
      bins: 0,
    };
    const expectedIndexes = new Set<number>();

    for (const entry of parsed.entries) {
      if (
        typeof entry.index !== "number" ||
        !Number.isInteger(entry.index) ||
        entry.index < 0 ||
        expectedIndexes.has(entry.index) ||
        typeof entry.sampleId !== "string" ||
        !Array.isArray(entry.readIds) ||
        !entry.readIds.every((readId) => typeof readId === "string") ||
        !Array.isArray(entry.bins)
      ) {
        return null;
      }
      expectedIndexes.add(entry.index);

      const candidates = [path.join(runFolder, `logging_${entry.index}`)];
      if (entry.index === 0) candidates.push(path.join(runFolder, "logging"));
      let files: string[] | null = null;
      for (const directory of candidates) {
        try {
          const candidateFiles = await listNonemptyFiles(directory);
          if (candidateFiles.length > 0) {
            files = candidateFiles;
            break;
          }
        } catch {
          // Try the next compatible directory name.
        }
      }
      if (!files) return null;

      const hasFile = (
        basename: string,
        requiredPathSegment?: string
      ): boolean =>
        files!.some(
          (filePath) =>
            path.basename(filePath) === basename &&
            (!requiredPathSegment ||
              filePath
                .split(path.sep)
                .some((segment) => segment === requiredPathSegment))
        );

      if (
        submission.samples &&
        !hasFile("sample_preliminary_accessions.txt", "biological_samples")
      ) {
        return null;
      }
      if (submission.samples) expectation.samples += 1;

      const readIds = entry.readIds as string[];
      if (submission.reads) {
        const readReports = files.filter(
          (filePath) =>
            path.basename(filePath) === "webin-cli.report" &&
            path
              .dirname(filePath)
              .split(path.sep)
              .some(
                (segment) =>
                  segment === "reads" || segment.startsWith("reads_")
              )
        );
        if (readReports.length < readIds.length) return null;
        expectation.reads += readIds.length;
      }

      if (submission.assembly && typeof entry.assemblyId === "string") {
        if (!hasFile("webin-cli.report", "assembly_fasta")) return null;
        expectation.assemblies += 1;
      }

      if (submission.bins && entry.bins.length > 0) {
        if (!hasFile("bin_to_preliminary_accession.tsv", "bins")) return null;
        expectation.bins += entry.bins.length;
      }
    }
    return expectation;
  } catch {
    return null;
  }
}

function selectTargetSamples(
  runId: string,
  pipelineId: string,
  inputSampleIds: string | null | undefined,
  samples: Array<{ id: string; sampleId: string }>
): Array<{ id: string; sampleId: string }> {
  if (!inputSampleIds) return samples;

  let parsed: unknown;
  try {
    parsed = JSON.parse(inputSampleIds);
  } catch {
    throw new Error(
      `Pipeline ${pipelineId} run ${runId} has invalid inputSampleIds JSON`
    );
  }
  if (
    !Array.isArray(parsed) ||
    !parsed.every(
      (sampleId) => typeof sampleId === "string" && sampleId.length > 0
    )
  ) {
    throw new Error(
      `Pipeline ${pipelineId} run ${runId} has invalid inputSampleIds`
    );
  }

  const selectedIds = new Set(parsed);
  const selected = samples.filter((sample) => selectedIds.has(sample.id));
  const missingIds = [...selectedIds].filter(
    (sampleId) => !samples.some((sample) => sample.id === sampleId)
  );
  if (missingIds.length > 0) {
    throw new Error(
      `Pipeline ${pipelineId} run ${runId} references missing target sample(s): ` +
        missingIds.join(", ")
    );
  }
  return selected;
}

function getRunTarget(run: {
  targetType?: string | null;
  studyId?: string | null;
  orderId?: string | null;
}): PipelineTarget | null {
  if (run.targetType === "order" && run.orderId) {
    return { type: "order", orderId: run.orderId };
  }
  if (run.studyId) {
    return { type: "study", studyId: run.studyId };
  }
  return null;
}

export async function processCompletedPipelineRun(runId: string, pipelineId: string): Promise<void> {
  let adapter = null;
  if (pipelineId !== "submg") {
    adapter = getAdapter(pipelineId);
    if (!adapter) {
      const genericAdapter = createGenericAdapter(pipelineId);
      if (genericAdapter) {
        registerAdapter(genericAdapter);
        adapter = genericAdapter;
      }
    }

    if (!adapter) {
      throw new Error(
        `Pipeline ${pipelineId} run ${runId} has no output adapter`
      );
    }
  }

  const run = await db.pipelineRun.findUnique({
    where: { id: runId },
    include: {
      study: {
        include: {
          samples: {
            select: { id: true, sampleId: true },
          },
        },
      },
      order: {
        include: {
          samples: {
            select: { id: true, sampleId: true },
          },
        },
      },
    },
  });

  if (!run) {
    throw new Error(`Pipeline ${pipelineId} run ${runId} no longer exists`);
  }
  if (!run.runFolder) {
    throw new Error(`Pipeline ${pipelineId} run ${runId} has no run folder`);
  }

  const target = getRunTarget(run);
  const allSamples =
    run.targetType === "order"
      ? run.order?.samples || []
      : run.study?.samples || [];
  const samples = selectTargetSamples(
    runId,
    pipelineId,
    run.inputSampleIds,
    allSamples
  );
  if (samples.length === 0) {
    throw new Error(
      `Pipeline ${pipelineId} run ${runId} has no target samples for output resolution`
    );
  }

  if (pipelineId === "submg") {
    let expectation = await inspectSubmgOutputs(run.runFolder, run.config);
    for (
      let attempt = 1;
      attempt < OUTPUT_SETTLE_ATTEMPTS && !expectation;
      attempt++
    ) {
      await delay(OUTPUT_SETTLE_DELAY_MS);
      expectation = await inspectSubmgOutputs(run.runFolder, run.config);
    }
    if (!expectation) {
      throw new Error(
        `Pipeline submg run ${runId} is missing required accession receipts after ` +
          `${OUTPUT_SETTLE_ATTEMPTS} discovery attempts`
      );
    }
    const result = await processSubmgRunResults(runId);
    const missingWritebacks: string[] = [];
    if (result.samplesUpdated < expectation.samples) {
      missingWritebacks.push(
        `samples ${result.samplesUpdated}/${expectation.samples}`
      );
    }
    if (result.readsUpdated < expectation.reads) {
      missingWritebacks.push(`reads ${result.readsUpdated}/${expectation.reads}`);
    }
    if (result.assembliesUpdated < expectation.assemblies) {
      missingWritebacks.push(
        `assemblies ${result.assembliesUpdated}/${expectation.assemblies}`
      );
    }
    if (result.binsUpdated < expectation.bins) {
      missingWritebacks.push(`bins ${result.binsUpdated}/${expectation.bins}`);
    }
    const issues = [
      ...result.errors,
      ...result.warnings,
      ...(missingWritebacks.length > 0
        ? [`missing accession writebacks: ${missingWritebacks.join(", ")}`]
        : []),
    ];
    if (issues.length > 0) {
      throw new Error(
        `Pipeline submg run ${runId} result processing failed: ${issues.join("; ")}`
      );
    }
    return;
  }

  const outputDir = path.join(run.runFolder, "output");
  const discoverOptions = {
    runId,
    outputDir,
    target: target || undefined,
    samples: samples.map((sample) => ({ id: sample.id, sampleId: sample.sampleId })),
  };

  // Re-scan while any required output is absent. Sample-scoped outputs must be
  // present for every target sample; study/order/run outputs need at least one
  // discovered file. Manifest outputs default to required, with explicit
  // required:false for genuinely optional workflow branches.
  const requiredOutputs = getRequiredOutputs(pipelineId, run.config);
  const targetSamples = samples.map((sample) => ({
    id: sample.id,
    sampleId: sample.sampleId,
  }));
  let discovered = await adapter!.discoverOutputs(discoverOptions);
  for (
    let attempt = 1;
    attempt < OUTPUT_SETTLE_ATTEMPTS &&
    missingRequiredOutputs(discovered, requiredOutputs, targetSamples).length >
      0;
    attempt++
  ) {
    await delay(OUTPUT_SETTLE_DELAY_MS);
    discovered = await adapter!.discoverOutputs(discoverOptions);
  }

  // Never finalize from a partial discovery. Throwing keeps monitor-driven runs
  // retryable and prevents false-green MAG/MultiQC/sample output completion.
  const missingOutputs = missingRequiredOutputs(
    discovered,
    requiredOutputs,
    targetSamples
  );
  if (missingOutputs.length > 0) {
    throw new Error(
      `Pipeline ${pipelineId} run ${runId} is missing required output(s) after ` +
        `${OUTPUT_SETTLE_ATTEMPTS} discovery attempts: ${missingOutputs.join(", ")}`
    );
  }

  const result = await resolveOutputs(pipelineId, runId, discovered);
  await saveRunResults(runId, result);
  if (!result.success) {
    const details = result.errors
      .map((error) => (typeof error === "string" ? error : JSON.stringify(error)))
      .join("; ");
    throw new Error(
      `Pipeline ${pipelineId} run ${runId} output resolution failed` +
        (details ? `: ${details}` : "")
    );
  }
}

export interface PipelineFinalizationOptions {
  completedAt?: Date;
  statusSource?: string;
  lastEventAt?: Date;
  queueStatus?: string | null;
  queueReason?: string | null;
  queueUpdatedAt?: Date;
}

export type PipelineFinalizationResult = "completed" | "claim-unavailable";

/**
 * Atomically owns the cancellation-vs-output boundary, processes outputs, and
 * commits terminal completion. `status` remains `running` for UI/API
 * compatibility while `statusSource=finalizing` acts as the short-lived lock.
 * Cancellation takes the reciprocal `cancelling` claim before signalling work,
 * so exactly one side can perform durable side effects.
 */
export async function finalizeCompletedPipelineRun(
  runId: string,
  pipelineId: string,
  options: PipelineFinalizationOptions = {}
): Promise<PipelineFinalizationResult> {
  const claimedAt = new Date();
  const staleBefore = new Date(
    claimedAt.getTime() - FINALIZATION_CLAIM_STALE_MS
  );
  const claim = await db.pipelineRun.updateMany({
    where: {
      id: runId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
      OR: [
        { statusSource: null },
        { statusSource: { notIn: ["finalizing", "cancelling"] } },
        {
          statusSource: "finalizing",
          lastEventAt: { lt: staleBefore },
        },
      ],
    },
    data: {
      statusSource: "finalizing",
      currentStep: "Finalizing outputs...",
      progress: 99,
      completedAt: null,
      lastEventAt: claimedAt,
    },
  });
  if (claim.count === 0) return "claim-unavailable";

  let leaseToken = claimedAt;
  let leaseLost = false;
  let renewalQueue: Promise<void> = Promise.resolve();
  const renewLease = async (): Promise<void> => {
    if (leaseLost) return;
    const renewedAt = new Date();
    const renewed = await db.pipelineRun.updateMany({
      where: {
        id: runId,
        status: { in: [...ACTIVE_RUN_STATUSES] },
        statusSource: "finalizing",
        lastEventAt: leaseToken,
      },
      data: {
        lastEventAt: renewedAt,
      },
    });
    if (renewed.count === 0) {
      leaseLost = true;
      return;
    }
    leaseToken = renewedAt;
  };
  const heartbeat = setInterval(() => {
    renewalQueue = renewalQueue
      .then(renewLease)
      .catch((error) => {
        // A transient renewal failure does not itself transfer ownership. Keep
        // the last confirmed token; the next heartbeat retries, and every
        // release/final write remains fenced by that token.
        console.error("[Pipeline completion] Failed to renew finalization lease:", error);
      });
  }, FINALIZATION_CLAIM_HEARTBEAT_MS);
  heartbeat.unref?.();

  try {
    await processCompletedPipelineRun(runId, pipelineId);
  } catch (error) {
    clearInterval(heartbeat);
    await renewalQueue;
    // Release the claim for a monitor retry or an operator cancellation. Keep
    // the run visibly at 99% so a missing NFS output never looks successful.
    if (!leaseLost) {
      await db.pipelineRun.updateMany({
        where: {
          id: runId,
          status: { in: [...ACTIVE_RUN_STATUSES] },
          statusSource: "finalizing",
          lastEventAt: leaseToken,
        },
        data: {
          status: "running",
          statusSource: options.statusSource || "output",
          currentStep: "Finalizing outputs...",
          progress: 99,
          completedAt: null,
          lastEventAt: new Date(),
        },
      });
    }
    throw error;
  }
  clearInterval(heartbeat);
  await renewalQueue;
  if (leaseLost) return "claim-unavailable";

  const completedAt = options.completedAt || new Date();
  const finalData: Prisma.PipelineRunUpdateManyMutationInput = {
    status: "completed",
    progress: 100,
    currentStep: "Completed",
    completedAt,
    statusSource: options.statusSource || "output",
    lastEventAt: options.lastEventAt || completedAt,
  };
  if (options.queueStatus !== undefined) {
    finalData.queueStatus = options.queueStatus;
  }
  if (options.queueReason !== undefined) {
    finalData.queueReason = options.queueReason;
  }
  if (options.queueUpdatedAt !== undefined) {
    finalData.queueUpdatedAt = options.queueUpdatedAt;
  }

  const completed = await db.pipelineRun.updateMany({
    where: {
      id: runId,
      status: { in: [...ACTIVE_RUN_STATUSES] },
      statusSource: "finalizing",
      lastEventAt: leaseToken,
    },
    data: finalData,
  });
  return completed.count > 0 ? "completed" : "claim-unavailable";
}

export async function inferPipelineExitCode(runFolder: string): Promise<number | null> {
  const stdoutPath = path.join(runFolder, "logs", "pipeline.out");
  const stderrPath = path.join(runFolder, "logs", "pipeline.err");

  // ONLY the canonical marker written by the run wrapper's EXIT trap is
  // authoritative. generic-executor installs
  //   trap 'echo "Pipeline completed with exit code: $? at ..." >> pipeline.out' EXIT
  // so this line is appended exactly once, on actual process exit, and carries
  // the real exit status even when a command aborts under `set -e`. Its presence
  // therefore means "the run wrapper has finished"; its absence means "still
  // running" (or hard-killed without running the trap).
  //
  // We deliberately do NOT scrape generic "exit code: N" / "exited with code N"
  // substrings. Nextflow streams task error reports, conda/mamba solver output,
  // and tool logs into this same pipeline.out / pipeline.err WHILE the run is
  // still executing, and any of those can contain such a substring (commonly
  // "...exit code: 0"). Matching them made the monitor infer EXITED mid-run and
  // finalize the run as completed before Nextflow had done its real work — e.g.
  // metaxpath was marked "completed" while still building its conda env, with
  // classification never executed (a false-green run + gate).
  const marker = /Pipeline completed with exit code:\s*(\d+)/i;

  const readAndMatch = async (filePath: string): Promise<number | null> => {
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const lines = content.split(/\r?\n/).slice(-80).join("\n");
      const match = lines.match(marker);
      if (match?.[1]) {
        const parsed = Number.parseInt(match[1], 10);
        if (!Number.isNaN(parsed)) {
          return parsed;
        }
      }
    } catch {
      // ignore
    }
    return null;
  };

  // The trap only ever writes the marker to pipeline.out; pipeline.err is checked
  // purely as a defensive fallback for the same authoritative marker.
  const stdoutCode = await readAndMatch(stdoutPath);
  if (stdoutCode !== null) {
    return stdoutCode;
  }

  return await readAndMatch(stderrPath);
}
