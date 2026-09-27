import fs from "fs/promises";
import path from "path";
import { getExecutionSettings } from "@/lib/pipelines/execution-settings";
import type { RunSandbox } from "../run-script";
import { resolveExploreStorage } from "../storage";
import { collectHostFacts, realPathMap, type HostFacts } from "./host";
import type { LimitMechanism, RunLimitsRecord } from "./limits";
import { buildMountPlan, describeMountPlan, GROUP_FILE_NAME, mountPlanHash, PASSWD_FILE_NAME, renderBwrapArgs, renderSeatbeltProfile, syntheticIdentityFiles, type MountPlan } from "./mount-plan";
import { getSandboxSettings, type ExploreSandboxSettings, type RunResourceLimits } from "./settings";

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
  /**
   * What the analysis can read: "run" = its own run folder (inputs are staged
   * into it), the environment and system files only; "host" = anything the
   * app's user can read. Absent on runs prepared before reads were limited.
   */
  reads?: "run" | "host";
  /** Why no sandbox is planned, when tool is "none". */
  reason: string | null;
  /**
   * CPU, memory and process caps. `mechanism` is what the app host offers
   * when the run is prepared; `used` is what the wrapper applied where the
   * run ran (control/limits.json), filled in once the run has started.
   */
  limits?: RunResourceLimits & { mechanism: LimitMechanism; used?: RunLimitsRecord | null };
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

  const facts = settings.mode === "off" ? null : input.facts ?? (await collectHostFacts());
  const limits = { ...settings.limits, mechanism: (facts?.limits?.mechanism ?? (process.platform === "linux" ? "prlimit" : "ulimit")) as LimitMechanism };

  if (settings.mode === "off" || !facts) {
    const isolation: RunIsolation = { tool: "none", mode: "off", network: "host", planHash: null, readable: [], writable: [], reads: "host", reason: "sandboxing is switched off in the settings", limits };
    await writeIsolation(controlDir, isolation);
    return { sandbox: { kind: "none", mode: "off", reason: isolation.reason ?? "", limits: settings.limits }, isolation, plan: null };
  }

  const refuse = (reason: string) => {
    if (settings.mode === "required") throw new SandboxRefusedError(`Analysis runs must be sandboxed, but ${reason}. A facility admin can install bubblewrap or relax the setting under Analysis environments.`);
  };
  if (!facts.platform) {
    refuse(`this platform (${process.platform}) has no supported sandbox`);
    const isolation: RunIsolation = { tool: "none", mode: settings.mode, network: "host", planHash: null, readable: [], writable: [], reads: "host", reason: `no sandbox for ${process.platform}`, limits };
    await writeIsolation(controlDir, isolation);
    return { sandbox: { kind: "none", mode: settings.mode, reason: isolation.reason ?? "", limits: settings.limits }, isolation, plan: null };
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
  const planHash = mountPlanHash(plan);
  await fs.writeFile(path.join(controlDir, "mount-plan.json"), JSON.stringify({ ...plan, hash: planHash }, null, 2), "utf8");
  const summary = describeMountPlan(plan);

  let sandbox: RunSandbox;
  let tool: RunIsolation["tool"];
  let reason: string | null = null;
  const mode = settings.mode === "required" ? "required" : "auto";
  if (facts.platform === "linux") {
    // The account files the plan binds over /etc/passwd and /etc/group.
    const identity = syntheticIdentityFiles({ uid: process.getuid?.() ?? 65534, gid: process.getgid?.() ?? 65534, home: plan.home });
    await fs.writeFile(path.join(controlDir, PASSWD_FILE_NAME), identity.passwd, { encoding: "utf8", mode: 0o644 });
    await fs.writeFile(path.join(controlDir, GROUP_FILE_NAME), identity.group, { encoding: "utf8", mode: 0o644 });
    // The wrapper looks for bwrap where it runs (a SLURM node may differ from the app host).
    sandbox = { kind: "bubblewrap", mode, args: renderBwrapArgs(plan), planHash, limits: settings.limits };
    tool = "bubblewrap";
    if (!facts.tool) reason = "bubblewrap is not installed on the app host; a run there starts unconfined";
  } else {
    const profilePath = path.join(controlDir, "sandbox.sb");
    await fs.writeFile(profilePath, renderSeatbeltProfile(plan), "utf8");
    sandbox = { kind: "seatbelt", mode, profilePath, planHash, limits: settings.limits };
    tool = "seatbelt";
    if (!facts.tool) reason = "sandbox-exec is not available";
  }
  if (!facts.tool) refuse(reason ?? "the sandbox tool is missing");
  const isolation: RunIsolation = { tool, mode: settings.mode, network: plan.network, planHash, readable: summary.readable, writable: summary.writable, reads: facts.tool ? "run" : "host", reason, limits };
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
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.limits) {
      try {
        parsed.limits.used = JSON.parse(await fs.readFile(path.join(runFolder, CONTROL_DIR, "limits.json"), "utf8")) as RunLimitsRecord;
      } catch {
        parsed.limits.used = null;
      }
    }
    return parsed;
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

/** The short form the run and flow pages show: "Sandboxed · no network · reads its inputs only". */
export function summarizeIsolation(isolation: RunIsolation | null): { tool: RunIsolation["tool"]; network: RunIsolation["network"]; reads: "run" | "host" | "unknown"; label: string } | null {
  if (!isolation) return null;
  const reads = isolation.tool === "none" ? "host" : isolation.reads ?? "unknown";
  const parts = [isolation.tool === "none" ? "Not sandboxed" : "Sandboxed"];
  parts.push(isolation.network === "none" ? "no network" : "network allowed");
  if (reads === "run") parts.push("reads its inputs only");
  else if (reads === "host") parts.push("reads any file of the app's user");
  return { tool: isolation.tool, network: isolation.network, reads, label: parts.join(" · ") };
}
