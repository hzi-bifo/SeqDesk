import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { spawn } from "child_process";
import path from "path";
import { existsSync } from "fs";
import { authOptions } from "@/lib/auth";
import { getWorkerSpec } from "@/lib/workers/registry";

export const runtime = "nodejs";

export async function POST() {
  const session = await getServerSession(authOptions);
  if (!session || session.user.role !== "FACILITY_ADMIN") {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const events: string[] = [];
  const log = (s: string) => {
    events.push(`[${new Date().toISOString()}] ${s}`);
    console.log(`[diag-stream-monitor] ${s}`);
  };

  const REPO_ROOT = path.resolve(process.cwd());
  log(`cwd=${REPO_ROOT} node=${process.version} platform=${process.platform}`);

  const spec = getWorkerSpec("stream-monitor");
  if (!spec) {
    return NextResponse.json({ ok: false, events, error: "stream-monitor spec not found" });
  }

  const tsxPath = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
  const scriptPath = path.join(REPO_ROOT, spec.script);
  log(`tsx-exists=${existsSync(tsxPath)} path=${tsxPath}`);
  log(`script-exists=${existsSync(scriptPath)} path=${scriptPath}`);
  log(`PATH=${process.env.PATH ?? "(unset)"}`);

  const args = [scriptPath, ...(spec.args ?? [])];

  // Capture every signal from the spawn attempt.
  let asyncError: string | null = null;
  let exitInfo: string | null = null;
  let stdoutBuf = "";
  let stderrBuf = "";

  let child;
  try {
    child = spawn(tsxPath, args, {
      cwd: REPO_ROOT,
      env: { ...process.env, ...(spec.envOverrides ?? {}) },
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    log(`SYNC THROW from spawn(): code=${e.code} syscall=${e.syscall} message=${e.message}`);
    return NextResponse.json({ ok: false, events, threwSync: true, error: e.message });
  }

  log(`pid-sync=${child.pid}`);

  child.on("error", (err) => {
    const e = err as NodeJS.ErrnoException;
    asyncError = `code=${e.code} syscall=${e.syscall} message=${e.message}`;
    log(`ASYNC ERROR EVENT: ${asyncError}`);
  });
  child.stdout?.on("data", (d) => {
    stdoutBuf += String(d);
  });
  child.stderr?.on("data", (d) => {
    stderrBuf += String(d);
  });
  child.on("exit", (code, signal) => {
    exitInfo = `code=${code} signal=${signal}`;
    log(`EXIT: ${exitInfo}`);
  });

  // Wait up to 1.5s to collect async events.
  await new Promise<void>((resolve) => setTimeout(resolve, 1500));

  // Kill if still running.
  if (child.pid && exitInfo == null) {
    try {
      process.kill(child.pid, "SIGTERM");
      log(`sent SIGTERM to ${child.pid}`);
    } catch (err) {
      log(`SIGTERM failed: ${(err as Error).message}`);
    }
  }

  return NextResponse.json({
    ok: child.pid != null,
    pidSync: child.pid ?? null,
    asyncError,
    exitInfo,
    stdoutPreview: stdoutBuf.slice(0, 800),
    stderrPreview: stderrBuf.slice(0, 800),
    events,
  });
}
