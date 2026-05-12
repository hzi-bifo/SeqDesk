import * as fs from "fs/promises";
import * as path from "path";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveDataBasePathFromStoredValue } from "@/lib/files/data-base-path";
import {
  GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID,
  getGemmaMetaxPathExampleStatus,
  seedGemmaMetaxPathExampleDataset,
} from "@/lib/seed/gemma-metaxpath-example";
import {
  getAdminActivityJob,
  readRedactedLogTail,
  updateAdminActivityJob,
} from "@/lib/admin/activity";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const GEMMA_ACTIVITY_ID = "seed:example-dataset:gemma-metaxpath";
const RUNNING_JOB_STALE_MS = 2 * 60 * 60 * 1000;
const runningGemmaJobs = new Set<string>();

async function requireFacilityAdmin() {
  const session = await getServerSession(authOptions);
  return session?.user?.role === "FACILITY_ADMIN";
}

async function ensureWritableDataBasePath(): Promise<
  | { ok: true; resolvedBase: string }
  | { ok: false; status: number; body: { error: string; dataBasePath?: string } }
> {
  const settings = await db.siteSettings.findUnique({
    where: { id: "singleton" },
    select: { dataBasePath: true },
  });
  const resolved = resolveDataBasePathFromStoredValue(settings?.dataBasePath);
  if (!resolved.dataBasePath) {
    return {
      ok: false,
      status: 400,
      body: { error: "Data base path not configured" },
    };
  }

  const resolvedBase = path.resolve(resolved.dataBasePath);
  try {
    const stats = await fs.stat(resolvedBase);
    if (!stats.isDirectory()) {
      return {
        ok: false,
        status: 400,
        body: {
          error: `Data base path is not a directory: ${resolvedBase}`,
          dataBasePath: resolvedBase,
        },
      };
    }
    await fs.access(resolvedBase, fs.constants.W_OK);
  } catch {
    return {
      ok: false,
      status: 400,
      body: {
        error: `Data base path is not writable by the SeqDesk server process: ${resolvedBase}`,
        dataBasePath: resolvedBase,
      },
    };
  }

  return { ok: true, resolvedBase };
}

async function runGemmaDatasetActivity(resolvedBase: string) {
  try {
    await updateAdminActivityJob(GEMMA_ACTIVITY_ID, {
      type: "example-dataset",
      label: "Load Gemma MetaxPath dataset",
      state: "running",
      phase: "starting",
      targetPath: resolvedBase,
      error: undefined,
      finishedAt: undefined,
    });

    const result = await seedGemmaMetaxPathExampleDataset({
      activity: {
        update: async (update) => {
          const logPath =
            typeof update.logPath === "string" ? update.logPath : undefined;
          await updateAdminActivityJob(GEMMA_ACTIVITY_ID, {
            type: "example-dataset",
            label: "Load Gemma MetaxPath dataset",
            state: "running",
            phase: typeof update.phase === "string" ? update.phase : "downloading",
            targetPath:
              typeof update.targetPath === "string" ? update.targetPath : resolvedBase,
            bytesDownloaded:
              typeof update.bytesDownloaded === "number"
                ? update.bytesDownloaded
                : undefined,
            totalBytes:
              typeof update.totalBytes === "number" ? update.totalBytes : undefined,
            progressPercent:
              typeof update.progressPercent === "number"
                ? update.progressPercent
                : undefined,
            logAvailable: Boolean(logPath),
            logExcerpt: logPath ? await readRedactedLogTail(logPath) : undefined,
            error: undefined,
            finishedAt: undefined,
          });
        },
      },
    });
    const status = await getGemmaMetaxPathExampleStatus();
    await updateAdminActivityJob(GEMMA_ACTIVITY_ID, {
      type: "example-dataset",
      label: "Load Gemma MetaxPath dataset",
      state: "success",
      phase: "complete",
      targetPath: resolvedBase,
      progressPercent: 100,
      finishedAt: new Date().toISOString(),
      error: undefined,
      logExcerpt: [
        `Seeded ${result.seeded} fixture(s) for order ${status.orderNumber}.`,
        `${status.samplesCount} samples and ${status.readsCount} read set(s) are available.`,
      ],
    });
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Failed to seed Gemma MetaxPath example dataset";
    console.error("[Gemma MetaxPath Example Seed] Failed:", error);
    await updateAdminActivityJob(GEMMA_ACTIVITY_ID, {
      type: "example-dataset",
      label: "Load Gemma MetaxPath dataset",
      state: "error",
      phase: "failed",
      targetPath: resolvedBase,
      error: message,
      finishedAt: new Date().toISOString(),
      logExcerpt: [message],
    }).catch(() => {});
  } finally {
    runningGemmaJobs.delete(GEMMA_ACTIVITY_ID);
  }
}

function isFreshRunningJob(job: Awaited<ReturnType<typeof getAdminActivityJob>>) {
  if (job?.state !== "running") return false;
  const stamp = job.updatedAt || job.startedAt;
  if (!stamp) return true;
  const parsed = new Date(stamp).getTime();
  return Number.isNaN(parsed) || Date.now() - parsed < RUNNING_JOB_STALE_MS;
}

export async function GET() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json(await getGemmaMetaxPathExampleStatus());
}

export async function POST() {
  if (!(await requireFacilityAdmin())) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const dataPath = await ensureWritableDataBasePath();
  if (!dataPath.ok) {
    return NextResponse.json(dataPath.body, { status: dataPath.status });
  }

  const existingJob = await getAdminActivityJob(GEMMA_ACTIVITY_ID);
  if (runningGemmaJobs.has(GEMMA_ACTIVITY_ID) || isFreshRunningJob(existingJob)) {
    return NextResponse.json(
      {
        success: true,
        started: true,
        alreadyRunning: true,
        jobId: GEMMA_ACTIVITY_ID,
        fixtureId: GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID,
      },
      { status: 202 }
    );
  }

  runningGemmaJobs.add(GEMMA_ACTIVITY_ID);
  void runGemmaDatasetActivity(dataPath.resolvedBase);

  return NextResponse.json(
    {
      success: true,
      started: true,
      jobId: GEMMA_ACTIVITY_ID,
      fixtureId: GEMMA_METAXPATH_EXAMPLE_FIXTURE_ID,
    },
    { status: 202 }
  );
}
