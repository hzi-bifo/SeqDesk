import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { visibleWorkers } from "@/lib/workers/registry";
import { reconcileWorker } from "@/lib/workers/process";
import { listPausedWorkers } from "@/lib/workers/pause";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isProduction = process.env.NODE_ENV === "production";
  const specs = visibleWorkers({ isProduction });
  const paused = new Set(await listPausedWorkers());

  const workers = await Promise.all(
    specs.map(async (spec) => {
      const { row } = await reconcileWorker(spec.name);
      return {
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
      };
    }),
  );

  return NextResponse.json({ workers });
}
