import fs from "fs/promises";
import path from "path";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import type { RunSandbox } from "../run-script";
import { resolveExploreStorage } from "../storage";
import { applyDarwinDenies, collectHostFacts, realPathMap, type HostFacts } from "./host";
import { buildMountPlan, describeMountPlan, mountPlanHash, renderBwrapArgs, renderSeatbeltProfile, type MountPlan } from "./mount-plan";
import { getSandboxSettings, type ExploreSandboxSettings } from "./settings";

export const CONTROL_DIR = "control";

/** What a run's page shows about its confinement; written before the run starts. */
export interface RunIsolation {
  /** The mechanism the wrapper will use; what it really used is in the log marker. */
  tool: "bubblewrap" | "seatbelt" | "none";
  mode: ExploreSandboxSettings["mode"];
  network: "none" | "host";
  planHash: string | null;
  readable: string[];
  writable: string[];
  /** Why no sandbox is planned, when tool is "none". */
  reason: string | null;
}

export class SandboxRefusedError extends Error {}

/**
 * Build the mount plan for one run, write it next to the run for audit and
 * return what the wrapper needs. Throws when the settings require a sandbox
 * the host cannot provide, so no unconfined run is ever started by mistake.
 */
export async function prepareRunSandbox(input: { runFolder: string; environmentPrefix: string; facts?: HostFacts; settings?: ExploreSandboxSettings }): Promise<{ sandbox: RunSandbox; isolation: RunIsolation; plan: MountPlan | null }> {
  const settings = input.settings ?? (await getSandboxSettings());
  const controlDir = path.join(input.runFolder, CONTROL_DIR);
  await fs.mkdir(controlDir, { recursive: true });

  if (settings.mode === "off") {
    const isolation: RunIsolation = { tool: "none", mode: "off", network: "host", planHash: null, readable: [], writable: [], reason: "sandboxing is switched off in the settings" };
    await writeIsolation(controlDir, isolation);
    return { sandbox: { kind: "none", mode: "off", reason: isolation.reason ?? "" }, isolation, plan: null };
  }

  const facts = input.facts ?? (await collectHostFacts());
  const refuse = (reason: string) => {
    if (settings.mode === "required") throw new SandboxRefusedError(`Analysis runs must be sandboxed, but ${reason}. A facility admin can install bubblewrap or relax the setting under Analysis environments.`);
  };
  if (!facts.platform) {
    refuse(`this platform (${process.platform}) has no supported sandbox`);
    const isolation: RunIsolation = { tool: "none", mode: settings.mode, network: "host", planHash: null, readable: [], writable: [], reason: `no sandbox for ${process.platform}` };
    await writeIsolation(controlDir, isolation);
    return { sandbox: { kind: "none", mode: settings.mode, reason: isolation.reason ?? "" }, isolation, plan: null };
  }
  if (facts.problem) refuse(facts.problem);

  const storage = await resolveExploreStorage();
  const execution = await getExecutionSettings();
  const condaBase = execution.condaPath?.trim();
  const condaPackageDirs = condaBase ? [path.join(condaBase, "pkgs")] : [];
  const logical = [input.runFolder, input.environmentPrefix, ...condaPackageDirs, ...settings.extraReadOnly, storage.runsRoot, storage.datasetsRoot, storage.baseDir, process.cwd(), facts.hostHome, facts.tmpRoot];
  const realPaths = await realPathMap(logical);
  const plan = buildMountPlan({
    platform: facts.platform,
    network: settings.network,
    runFolder: input.runFolder,
    environmentPrefix: input.environmentPrefix,
    condaPackageDirs,
    extraReadOnly: settings.extraReadOnly,
    roots: { runsRoot: storage.runsRoot, datasetsRoot: storage.datasetsRoot, exploreBase: storage.baseDir, appDir: process.cwd(), hostHome: facts.hostHome, tmpRoot: facts.tmpRoot },
    host: { system: facts.system, sss: facts.sss },
    realPaths,
  });
  await applyDarwinDenies(plan);
  const planHash = mountPlanHash(plan);
  await fs.writeFile(path.join(controlDir, "mount-plan.json"), JSON.stringify({ ...plan, hash: planHash }, null, 2), "utf8");
  const summary = describeMountPlan(plan);

  let sandbox: RunSandbox;
  let tool: RunIsolation["tool"];
  let reason: string | null = null;
  const mode = settings.mode === "required" ? "required" : "auto";
  if (facts.platform === "linux") {
    // The wrapper looks for bwrap where it runs (a SLURM node may differ from the app host).
    sandbox = { kind: "bubblewrap", mode, args: renderBwrapArgs(plan), planHash };
    tool = "bubblewrap";
    if (!facts.tool) reason = "bubblewrap is not installed on the app host; a run there starts unconfined";
  } else {
    const profilePath = path.join(controlDir, "sandbox.sb");
    await fs.writeFile(profilePath, renderSeatbeltProfile(plan), "utf8");
    sandbox = { kind: "seatbelt", mode, profilePath, planHash };
    tool = "seatbelt";
    if (!facts.tool) reason = "sandbox-exec is not available";
  }
  if (!facts.tool) refuse(reason ?? "the sandbox tool is missing");
  const isolation: RunIsolation = { tool, mode: settings.mode, network: plan.network, planHash, readable: summary.readable, writable: summary.writable, reason };
  await writeIsolation(controlDir, isolation);
  return { sandbox, isolation, plan };
}

async function writeIsolation(controlDir: string, isolation: RunIsolation): Promise<void> {
  await fs.writeFile(path.join(controlDir, "isolation.json"), JSON.stringify(isolation, null, 2), "utf8");
}

/** The isolation record of a run folder, or null when the run predates sandboxing. */
export async function readRunIsolation(runFolder: string | null | undefined): Promise<RunIsolation | null> {
  if (!runFolder) return null;
  try {
    const parsed = JSON.parse(await fs.readFile(path.join(runFolder, CONTROL_DIR, "isolation.json"), "utf8")) as RunIsolation;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** What the wrapper reported: the `Sandbox: …` line of the run log. */
export function sandboxFromLog(log: string | null | undefined): { used: "bubblewrap" | "seatbelt" | "none" | "refused"; detail: string } | null {
  if (!log) return null;
  const match = log.match(/^Sandbox: (bubblewrap|seatbelt|none|refused)(?: \((.*)\))?$/m);
  if (!match) return null;
  return { used: match[1] as "bubblewrap" | "seatbelt" | "none" | "refused", detail: match[2] ?? "" };
}
