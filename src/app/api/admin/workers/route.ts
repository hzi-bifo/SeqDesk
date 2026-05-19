import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { visibleWorkers } from "@/lib/workers/registry";
import { reconcileWorker } from "@/lib/workers/process";
import { listPausedWorkers } from "@/lib/workers/pause";
import { getPipelineLoadSummary, type PipelineLoadSummary } from "@/lib/admin/pipeline-load";

const WORKERS_ERROR = "Some background worker status could not be loaded.";
const PIPELINE_LOAD_ERROR = "Pipeline load could not be loaded.";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let workersError: string | undefined;
  let pipelineLoadError: string | undefined;
  let workers: Array<Record<string, unknown>> = [];
  let pipelineLoad: PipelineLoadSummary | null = null;

  try {
    const isProduction = process.env.NODE_ENV === "production";
    const specs = visibleWorkers({ isProduction });
    let paused = new Set<string>();
    try {
      paused = new Set(await listPausedWorkers());
    } catch {
      workersError = WORKERS_ERROR;
    }

    const settledWorkers = await Promise.all(
      specs.map(async (spec) => {
        try {
          const { row } = await reconcileWorker(spec.name);
          return {
            error: false,
            card: {
              name: spec.name,
              label: spec.label,
              description: spec.description,
              script: spec.script,
              args: spec.args ?? [],
              supportsPause: spec.supportsPause,
              devOnly: spec.devOnly,
              settingsHref: spec.settingsHref ?? null,
              configNote: spec.configNote ?? null,
              paused: paused.has(spec.name),
              latest: row,
            },
          };
        } catch {
          return {
            error: true,
            card: {
              name: spec.name,
              label: spec.label,
              description: spec.description,
              script: spec.script,
              args: spec.args ?? [],
              supportsPause: spec.supportsPause,
              devOnly: spec.devOnly,
              settingsHref: spec.settingsHref ?? null,
              configNote: spec.configNote ?? null,
              paused: paused.has(spec.name),
              latest: null,
            },
          };
        }
      }),
    );

    if (settledWorkers.some((worker) => worker.error)) {
      workersError = WORKERS_ERROR;
    }
    workers = settledWorkers.map((worker) => worker.card);
  } catch {
    workers = [];
    workersError = WORKERS_ERROR;
  }

  try {
    pipelineLoad = await getPipelineLoadSummary();
  } catch {
    pipelineLoadError = PIPELINE_LOAD_ERROR;
  }

  return NextResponse.json({
    workers,
    pipelineLoad,
    ...(workersError ? { workersError } : {}),
    ...(pipelineLoadError ? { pipelineLoadError } : {}),
  });
}
