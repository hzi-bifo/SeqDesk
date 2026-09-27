import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { canManageExplore } from "@/lib/explore/authorization";
import { collectHostFacts } from "@/lib/explore/sandbox/host";
import { prepareRunSandbox, SandboxRefusedError } from "@/lib/explore/sandbox/prepare";
import { createProbeRunFolder, runSandboxProbes } from "@/lib/explore/sandbox/probe";
import { getSandboxSettings } from "@/lib/explore/sandbox/settings";
import { resolveExploreStorage } from "@/lib/explore/storage";
import { ExploreRouteError, exploreErrorResponse, requireExploreSession } from "../../_shared";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

let running = false;

/**
 * "Test the sandbox": prepares a throwaway run (and a sibling it must not
 * see) under the runs root with the saved settings, starts the isolation
 * probes inside its sandbox and removes both folders again.
 */
export async function POST() {
  try {
    const session = await requireExploreSession();
    if (!canManageExplore(session)) throw new ExploreRouteError(403, "Pipeline management permission is required to test analysis isolation");
    if (running) throw new ExploreRouteError(409, "A sandbox test is already running");
    running = true;
    try {
      return NextResponse.json(await probe());
    } finally {
      running = false;
    }
  } catch (error) {
    return exploreErrorResponse(error);
  }
}

async function probe() {
  const started = Date.now();
  const settings = await getSandboxSettings();
  const facts = await collectHostFacts({ fresh: true });
  const host = { platform: facts.platform, tool: facts.toolName, problem: facts.problem, limits: facts.limits ?? null };
  if (settings.mode === "off") {
    return { status: "unconfined", summary: "Sandboxing is switched off: runs can read and write everything this server's account can.", host, settings, probes: [], durationMs: Date.now() - started };
  }
  const storage = await resolveExploreStorage();
  const root = path.join(storage.runsRoot, `.sandbox-probe-${randomUUID()}`);
  const run = path.join(root, "run"), other = path.join(root, "other");
  // A ready environment gives the interpreter probe something to start; without one the probe is skipped.
  const environment = await db.exploreEnvironment.findFirst({ where: { status: "ready", prefixPath: { not: null } }, select: { name: true, prefixPath: true }, orderBy: { name: "asc" } }).catch(() => null);
  const prefix = environment?.prefixPath ?? path.join(root, "no-environment");
  try {
    createProbeRunFolder(run);
    createProbeRunFolder(other);
    await fs.mkdir(prefix, { recursive: true });
    let prepared;
    try {
      prepared = await prepareRunSandbox({ runFolder: run, environmentPrefix: prefix, facts, settings });
    } catch (error) {
      if (error instanceof SandboxRefusedError) return { status: "refused", summary: error.message, host, settings, probes: [], durationMs: Date.now() - started };
      throw error;
    }
    if (!prepared.plan || prepared.isolation.tool === "none" || !facts.tool || facts.problem) {
      return { status: "unconfined", summary: prepared.isolation.reason ?? facts.problem ?? "No sandbox is available on this host; runs start unconfined.", host, settings, probes: [], durationMs: Date.now() - started };
    }
    const probes = await runSandboxProbes({ run, plan: prepared.plan, app: process.cwd(), other, tables: storage.datasetsRoot, skipInterpreter: !environment, bwrap: facts.tool });
    const failed = probes.filter((entry) => !entry.ok);
    return {
      status: failed.length ? "failed" : "passed",
      summary: failed.length
        ? `${failed.length} of ${probes.length} checks did not behave as expected: ${failed.map((entry) => entry.name).join(", ")}.`
        : `All ${probes.length} checks passed: a run sees only its own folder${prepared.plan.network === "none" ? " and has no network" : ", with network access as configured"}.`,
      host,
      settings,
      tool: prepared.isolation.tool,
      environment: environment?.name ?? null,
      probes,
      durationMs: Date.now() - started,
    };
  } finally {
    await fs.rm(root, { recursive: true, force: true }).catch(() => undefined);
  }
}
